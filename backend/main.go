package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/argon2"
)

//go:embed migrations/*.sql
var migrations embed.FS

type config struct {
	environment              string
	environmentSource        string
	port                     string
	databaseURL              string
	redisURL                 string
	allowedOrigins           map[string]bool
	cookieName               string
	cookieSecure             bool
	argonMemory              uint32
	argonIterations          uint32
	argonParallel            uint8
	argonKeyLength           uint32
	oauth                    map[string]oauthProviderConfig
	oauthBaseURL             string
	publicAPIURL             string
	s3Endpoint               string
	s3AccessKey              string
	s3SecretKey              string
	s3Bucket                 string
	s3PublicURL              string
	s3UseSSL                 bool
	jwtSecret                string
	webhookKey               string
	hostingEncryptionKey     string
	tenantMySQLDSN           string
	cfAPIToken               string
	cfZoneID                 string
	cfDomain                 string
	hostingServerIP          string
	phpMyAdminInternalSecret string
	phpMyAdminPublicURL      string
	checkSlipsAPIBaseURL     string
	checkSlipsAPIToken       string
	checkSlipsTenantID       string
	checkSlipsEncryptionKey  string
	resendAPIKey             string
	resendWebhookSecret      string
	resendAPIBaseURL         string
	stalwartAPIURL           string
	stalwartAPIToken         string
	stalwartPublicURL        string
	mailDiscordAdminIDs      map[string]bool
	discordAdminIDs          map[string]bool
	topupReceiver            checkSlipsReceiver
}

type checkSlipsReceiver struct {
	BankCode      string
	BankName      string
	AccountNumber string
	AccountName   string
}

type server struct {
	cfg               config
	db                *pgxpool.Pool
	redis             *redis.Client
	storage           objectStorage
	lockdownMu        sync.RWMutex
	lockdownLast      lockdownState
	lockdownKnown     bool
	lockdownAlertedAt time.Time
}

type authRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type sessionData struct {
	SessionID int64  `json:"sessionId"`
	UserID    int64  `json:"userId"`
	Username  string `json:"username"`
	Role      string `json:"role"`
}

type apiError struct {
	Error string `json:"error"`
	Code  string `json:"code,omitempty"`
}

var rolePermissions = map[string][]string{
	"user": {
		"account:read",
		"account:update",
		"resources:read",
		"resources:create",
		"resources:update_own",
		"resources:delete_own",
		"profile:sessions",
		"profile:activity",
		"hosting:sites",
		"hosting:create",
	},
	"admin": {
		"account:read",
		"account:update",
		"resources:read",
		"resources:create",
		"resources:update_any",
		"resources:delete_any",
		"users:read",
		"users:suspend",
		"users:sessions",
		"admin:dashboard",
		"hosting:manage",
	},
	"superadmin": {
		"*",
	},
}

func main() {
	log.Println("[INFO] Starting NEXORA API service...")
	cfg := loadConfig()
	if err := validateConfig(cfg); err != nil {
		log.Fatalf("[FATAL] validateConfig error: %v", err)
	}
	log.Printf("[INFO] Runtime environment: %s (%s)", cfg.environment, cfg.environmentSource)
	if len(cfg.mailDiscordAdminIDs) == 0 {
		log.Println("[WARN] MAIL_DISCORD_ADMIN_IDS is empty; Discord mail bind/unbind/admin are disabled")
	}
	if len(cfg.discordAdminIDs) == 0 {
		log.Println("[WARN] DISCORD_ADMIN_IDS is empty; only the Discord server owner can view other students via the bot")
	}
	ctx := context.Background()

	log.Println("[INFO] Connecting to PostgreSQL...")
	db, err := pgxpool.New(ctx, cfg.databaseURL)
	if err != nil {
		log.Fatalf("[FATAL] pgxpool.New error: %v", err)
	}
	defer db.Close()

	if err := waitForPostgres(ctx, db); err != nil {
		log.Fatalf("[FATAL] waitForPostgres error: %v", err)
	}
	log.Println("[INFO] Connected to PostgreSQL. Running migrations...")
	if err := runMigrations(ctx, db); err != nil {
		log.Fatalf("[FATAL] runMigrations error: %v", err)
	}
	log.Println("[INFO] Migrations complete. Connecting to Redis...")

	redisOptions, err := redis.ParseURL(cfg.redisURL)
	if err != nil {
		log.Fatalf("[FATAL] redis.ParseURL error: %v", err)
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()
	if err := waitForRedis(ctx, redisClient); err != nil {
		log.Fatalf("[FATAL] waitForRedis error: %v", err)
	}
	log.Println("[INFO] Redis connected. Initializing storage...")

	s := &server{cfg: cfg, db: db, redis: redisClient}
	if err := s.initStorage(ctx); err != nil {
		log.Printf("[WARN] object storage unavailable: %v", err)
	} else {
		go s.migrateAdminLibrary(ctx)
	}
	s.applyUnboundStudentAccessCutoff(ctx)
	if _, err := s.loadLockdownState(ctx, true); err != nil {
		log.Printf("[WARN] Lockdown state warmup failed: %v", err)
	}
	log.Println("[INFO] Starting background cleaners...")
	s.startAuditCleanup(ctx)
	s.startOAuthDisconnectCleanup(ctx)
	if strings.TrimSpace(cfg.stalwartAPIToken) != "" {
		s.startStalwartMessageSync(ctx)
		go func() {
			time.Sleep(3 * time.Second)
			domains, mailboxes, failures, err := s.syncAllStalwart(ctx)
			if err != nil {
				log.Printf("[WARN] Stalwart startup sync failed: %v", err)
				return
			}
			log.Printf("[INFO] Stalwart startup sync complete: domains=%d mailboxes=%d failures=%d", domains, mailboxes, len(failures))
			for _, failure := range failures {
				log.Printf("[WARN] Stalwart provisioning: %s", failure)
			}
		}()
	}
	log.Println("[INFO] Configuring Fiber web framework...")
	app := fiber.New(fiber.Config{
		AppName:      "NEXORA CLOUD API",
		BodyLimit:    int(hostingSourceCompressedLimit + 8*1024*1024),
		ProxyHeader:  fiber.HeaderXForwardedFor,
		ReadTimeout:  2 * time.Minute,
		WriteTimeout: 2 * time.Minute,
		IdleTimeout:  60 * time.Second,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "เกิดข้อผิดพลาดจากระบบ กรุณาลองใหม่อีกครั้ง"
			codeName := "internal_error"
			if fiberErr, ok := err.(*fiber.Error); ok {
				code = fiberErr.Code
				if code < 500 && strings.TrimSpace(fiberErr.Message) != "" {
					message = fiberErr.Message
					codeName = "request_error"
				}
			}
			if code >= 500 {
				log.Printf("request error: %v", err)
			}
			return c.Status(code).JSON(apiError{Error: message, Code: codeName})
		},
	})

	app.Use(recover.New())
	app.Use(logger.New(logger.Config{Format: "${time} ${status} ${method} ${path} ${latency}\n"}))
	// Helmet with cross-origin resource policy so browsers can load /api/f/* files across origins
	app.Use(helmet.New(helmet.Config{
		CrossOriginResourcePolicy: "cross-origin",
		CrossOriginOpenerPolicy:   "same-origin",
		CrossOriginEmbedderPolicy: "unsafe-none",
		XFrameOptions:             "DENY",
	}))
	app.Use(limiter.New(limiter.Config{
		Max:        150,
		Expiration: 1 * time.Minute,
		// The Discord bots call the internal API all the time (presence, status, room sync) and
		// prove who they are with the internal secret; they limit their members themselves.
		Next: func(c *fiber.Ctx) bool {
			return strings.HasPrefix(c.Path(), "/api/internal/bot/") && s.verifyBotSecret(c) == nil
		},
		KeyGenerator: func(c *fiber.Ctx) string {
			if ip := extractRealIP(c); ip != "" {
				return ip
			}
			// No forwarding header means a call from inside the server. Keyed by the socket
			// address, each service (and the host's Caddy) gets its own allowance; before, they
			// all shared the empty key and one busy caller could block the rest.
			return "direct:" + c.Context().RemoteIP().String()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(apiError{Error: "เรียกใช้งานบ่อยเกินไป กรุณารอสักครู่", Code: "global_rate_limit"})
		},
	}))
	app.Use(cors.New(cors.Config{
		AllowOriginsFunc: func(origin string) bool {
			if cfg.allowedOrigins[origin] {
				return true
			}
			return trustedRuntimeOrigin(cfg.environment, origin, cfg.cfDomain, "www."+cfg.cfDomain)
		},
		AllowHeaders:     "Origin, Content-Type, Accept, Idempotency-Key, X-Csrf-Token",
		AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		AllowCredentials: true,
		MaxAge:           600,
	}))
	app.Use(s.originGuard)
	app.Use(s.ipBanGuard)

	app.Get("/health", s.health)
	app.Get("/api/internal/lockdown/gate", s.lockdownGate)
	app.Get("/api/status-page", s.apiStatusPage)
	app.Get("/api/settings/public", s.publicSettingsHandler)
	app.Get("/api/announcements", s.publicAnnouncements)
	app.Get("/api/store/categories", s.requireStoreOpen, s.getStoreCategories)
	app.Get("/api/store/products", s.requireStoreOpen, s.getStoreProducts)
	app.Get("/api/hosting/domain-authorized", s.hostingDomainAuthorized)
	app.Post("/api/webhooks/resend", s.resendWebhook)
	app.Get("/f/:token", s.serveSecureFile)
	app.Get("/api/f/:token", s.serveSecureFile)
	auth := app.Group("/api/auth")
	auth.Post("/register", s.rateLimit("register", 5, 15*time.Minute), s.register)
	auth.Post("/login", s.rateLimit("login", loginRequestLimit, failedLoginWindow), s.login)
	auth.Post("/logout", sensitiveResponseHeaders, s.logout)
	auth.Get("/me", sensitiveResponseHeaders, s.me)
	auth.Post("/oauth/ticket", s.rateLimit("oauth_ticket", 20, 5*time.Minute), s.issueOAuthTicket)
	auth.Post("/oauth/ticket/consume", s.rateLimit("oauth_consume", 30, 5*time.Minute), s.consumeOAuthTicket)
	auth.Post("/workspace/ticket/consume", s.rateLimit("workspace_consume", 30, 5*time.Minute), s.consumeWorkspaceTicket)
	auth.Get("/oauth/:provider/callback", s.oauthCallback)
	app.Get("/api/vps-uptime/start", s.startVPSUptimeAccess)
	app.Get("/api/vps-uptime", s.vpsUptimePage)
	app.Get("/api/vps-uptime/", s.vpsUptimePage)
	app.Get("/api/vps-uptime/data", s.vpsUptimeData)
	app.Get("/api/vps-uptime/style.css", s.vpsUptimeStyle)
	app.Get("/api/vps-uptime/app.js", s.vpsUptimeScript)
	app.Post("/api/vps-uptime/exchange", s.exchangeVPSUptimeTicket)
	app.Post("/api/vps-uptime/logout", s.logoutVPSUptime)

	profile := app.Group("/api/profile", sensitiveResponseHeaders, s.requireUser)
	profile.Get("", s.getProfile)
	profile.Patch("", s.updateProfile)
	profile.Get("/", s.getProfile)
	profile.Patch("/", s.updateProfile)
	profile.Post("/password", s.changePassword)
	profile.Get("/sessions", s.listOwnSessions)
	profile.Delete("/sessions/:id", s.revokeOwnSession)
	profile.Get("/activity", s.ownActivity)
	profile.Get("/social", s.socialAccounts)
	profile.Delete("/social/:provider", s.disconnectSocial)
	profile.Post("/social/:provider/disconnect/cancel", s.cancelSocialDisconnect)
	profile.Post("/avatar", s.uploadProfileAvatar)

	publicFiles := app.Group("/api/public/files", sensitiveResponseHeaders)
	publicFiles.Get("/:token", s.getPublicSharedUserFile)
	publicFiles.Get("/:token/download", s.rateLimit("public_file_download", 60, time.Hour), s.downloadPublicSharedUserFile)
	publicFiles.Post("/:token/download", s.rateLimit("public_file_download", 60, time.Hour), s.downloadPublicSharedUserFile)
	publicCategories := app.Group("/api/public/file-categories", sensitiveResponseHeaders)
	publicCategories.Get("/:token", s.getPublicSharedUserFileCategory)
	publicCategories.Post("/:token/folders/:folderId/unlock", s.unlockPublicSharedUserCategoryFolder)
	publicCategories.Get("/:token/files/:id/download", s.rateLimit("public_category_file_download", 60, time.Hour), s.downloadPublicSharedUserCategoryFile)
	publicCategories.Post("/:token/files/:id/download", s.rateLimit("public_category_file_download", 60, time.Hour), s.downloadPublicSharedUserCategoryFile)

	topup := app.Group("/api/topup", sensitiveResponseHeaders, s.requireUser)
	topup.Get("/config", s.requireStoreOpen, s.topupConfig)
	topup.Get("/history", s.topupHistory)
	topup.Post("/slip", s.requireStoreOpen, s.rateLimit("topup_slip", 5, 10*time.Minute), s.topupWithSlip)

	storeAuth := app.Group("/api/store", sensitiveResponseHeaders, s.requireUser)
	storeAuth.Post("/buy/:id", s.requireStoreOpen, s.rateLimit("store_buy", 30, time.Minute), s.buyProduct)
	storeAuth.Get("/purchases", s.listMyPurchases)
	storeAuth.Get("/points-history", s.pointsHistory)
	storeAuth.Get("/purchases/:id/download", s.rateLimit("store_download", 120, time.Hour), s.downloadPurchasedProduct)

	files := app.Group("/api/files", sensitiveResponseHeaders, s.requireUser)
	files.Get("", s.listOwnUserFiles)
	files.Post("", s.rateLimit("user_file_upload", 120, time.Hour), s.uploadOwnUserFile)
	files.Post("/batch-delete", s.batchDeleteOwnUserFiles)
	files.Post("/batch-category", s.batchUpdateOwnUserFilesCategory)
	files.Post("/batch-folder", s.batchUpdateOwnUserFilesFolder)
	files.Get("/categories", s.listUserFileCategoriesVisible)
	files.Post("/categories", s.rateLimit("user_file_category_create", 30, time.Hour), s.createOwnUserFileCategory)
	files.Put("/categories/:id", s.updateOwnUserFileCategory)
	files.Patch("/categories/:id", s.updateOwnUserFileCategory)
	files.Delete("/categories/:id", s.deleteOwnUserFileCategory)
	files.Post("/categories/:id/verify", s.verifyCategoryPassword)
	files.Get("/categories/:categoryId/folders", s.listUserFileFolders)
	files.Post("/categories/:categoryId/folders", s.createUserFileFolder)
	files.Put("/folders/:id", s.updateUserFileFolder)
	files.Patch("/folders/:id", s.updateUserFileFolder)
	files.Delete("/folders/:id", s.deleteUserFileFolder)
	files.Post("/folders/:id/share", s.rateLimit("user_file_folder_share", 30, time.Hour), s.createOwnUserFileFolderShare)
	files.Delete("/folders/:id/share", s.revokeOwnUserFileFolderShare)
	files.Post("/categories/:id/share", s.rateLimit("user_file_category_share", 30, time.Hour), s.createOwnUserFileCategoryShare)
	files.Delete("/categories/:id/share", s.revokeOwnUserFileCategoryShare)
	files.Post("/:id/share", s.rateLimit("user_file_share", 30, time.Hour), s.createOwnUserFileShare)
	files.Delete("/:id/share", s.revokeOwnUserFileShare)
	files.Patch("/:id", s.patchOwnUserFile)
	files.Get("/:id/download", s.downloadUserFile)
	files.Post("/:id/download", s.downloadUserFile)
	files.Delete("/:id", s.deleteOwnUserFile)

	hosting := app.Group("/api/hosting", sensitiveResponseHeaders, s.requireUser, requirePasswordReady)
	hosting.Get("/sites", s.listHostingSites)
	hosting.Post("/sites", s.createHostingSite)
	hosting.Get("/sites/:id", s.getHostingSite)
	hosting.Patch("/sites/:id", s.updateHostingSite)
	hosting.Delete("/sites/:id", s.deleteHostingSite)
	hosting.Post("/sites/:id/members", s.addHostingMember)
	hosting.Delete("/sites/:id/members/:userId", s.removeHostingMember)
	hosting.Post("/sites/:id/owner", s.transferHostingOwner)
	hosting.Post("/sites/:id/operations", s.createHostingRuntimeOperation)
	hosting.Post("/sites/:id/deploy", s.deployHostingSite)
	hosting.Post("/sites/:id/generate", s.generateHostingSiteStarter)
	hosting.Get("/sites/:id/logs", s.hostingRuntimeLogs)
	hosting.Get("/sites/:id/files", s.listHostingFiles)
	hosting.Get("/sites/:id/files/content", s.readHostingFile)
	hosting.Get("/sites/:id/files/download", s.downloadHostingFile)
	hosting.Post("/sites/:id/files/preview", s.previewHostingFile)
	hosting.Post("/sites/:id/files/upload", s.uploadHostingFile)
	hosting.Put("/sites/:id/files/content", s.saveHostingFile)
	hosting.Post("/sites/:id/files/folders", s.createHostingFolder)
	hosting.Post("/sites/:id/files/move", s.moveHostingFile)
	hosting.Post("/sites/:id/files/archive", s.archiveHostingFiles)
	hosting.Post("/sites/:id/files/extract", s.extractHostingArchive)
	hosting.Delete("/sites/:id/files", s.deleteHostingFile)
	hosting.Get("/sites/:id/environment", s.listHostingEnvironment)
	hosting.Put("/sites/:id/environment", s.upsertHostingEnvironment)
	hosting.Delete("/sites/:id/environment/:name", s.deleteHostingEnvironment)
	hosting.Get("/sites/:id/database", s.getHostingSiteDatabase)
	hosting.Post("/sites/:id/database", s.provisionHostingSiteDatabase)
	hosting.Post("/sites/:id/database/test", s.testHostingSiteDatabase)
	hosting.Post("/sites/:id/database/phpmyadmin", s.createSecurePhpMyAdminTicket)
	hosting.Post("/sites/:id/workspace/token", s.createHostingWorkspaceToken)

	bots := app.Group("/api/bots", sensitiveResponseHeaders, s.requireUser, requirePasswordReady)
	bots.Get("", s.listBots)
	bots.Post("", s.rateLimit("bot_create", 20, time.Hour), s.createBot)
	bots.Get("/:id", s.getBot)
	bots.Patch("/:id", s.patchBot)
	bots.Delete("/:id", s.deleteBot)
	bots.Post("/:id/operations", s.rateLimit("bot_operation", 120, time.Hour), s.createBotOperation)
	bots.Get("/:id/logs", s.botLogs)
	bots.Post("/:id/deploy", s.rateLimit("bot_source", 60, time.Hour), s.deployBotZip)
	bots.Post("/:id/github/pull", s.rateLimit("bot_source", 60, time.Hour), s.pullBotGitHub)
	bots.Get("/:id/files", s.listBotFiles)
	bots.Get("/:id/files/content", s.readBotFile)
	bots.Put("/:id/files/content", s.rateLimit("bot_file_save", 600, time.Hour), s.saveBotFile)
	bots.Post("/:id/files/folders", s.createBotFolder)
	bots.Post("/:id/files/move", s.moveBotFile)
	bots.Delete("/:id/files", s.deleteBotFile)
	bots.Get("/:id/environment", s.listBotEnvironment)
	bots.Put("/:id/environment", s.upsertBotEnvironment)
	bots.Delete("/:id/environment/:name", s.deleteBotEnvironment)
	bots.Put("/:id/token", s.rateLimit("bot_token", 30, time.Hour), s.saveBotToken)

	mailAPI := app.Group("/api/mail", sensitiveResponseHeaders, s.requireUser, requirePasswordReady)
	mailAPI.Get("/bootstrap", s.mailBootstrap)
	mailAPI.Get("/domains", s.listMailDomains)
	mailAPI.Post("/domains", s.createMailDomain)
	mailAPI.Post("/domains/:id/verify", s.verifyMailDomain)
	mailAPI.Post("/domains/:id/dns/auto-configure", s.autoConfigureMailDomainDNS)
	mailAPI.Post("/mailboxes", s.createMailbox)
	mailAPI.Post("/mailboxes/:id/members", s.addMailboxMember)
	mailAPI.Post("/mailboxes/:id/aliases", s.createMailAlias)
	mailAPI.Get("/mailboxes/:id/device-settings", s.getMailDeviceSettings)
	mailAPI.Post("/mailboxes/:id/device-passwords", s.createMailDevicePassword)
	mailAPI.Delete("/mailboxes/:id/device-passwords/:credentialId", s.revokeMailDevicePassword)
	mailAPI.Get("/mailboxes/:id/blob", s.downloadStalwartBlob)
	mailAPI.Get("/messages", s.listMailMessages)
	mailAPI.Get("/messages/:id", s.getMailMessage)
	mailAPI.Get("/threads/:id", s.getMailThread)
	mailAPI.Post("/messages/send", s.rateLimit("mail_send", 120, 24*time.Hour), s.sendMailMessage)
	mailAPI.Post("/drafts", s.saveMailDraft)
	mailAPI.Patch("/messages/:id", s.setMailMessageState)
	mailAPI.Get("/attachments/:id", s.downloadMailAttachment)

	admin := app.Group("/api/admin", sensitiveResponseHeaders, s.requireUser, requirePasswordReady, requireRoles("admin", "superadmin"))
	admin.Get("/summary", s.adminSummary)
	admin.Get("/hosting/databases", s.adminDatabases)
	admin.Post("/hosting/databases", s.adminCreateDatabase)
	admin.Post("/hosting/databases/:id/phpmyadmin", s.adminCreatePhpMyAdminTicket)
	admin.Patch("/hosting/databases/:id/suspend", s.adminSuspendDatabase)
	admin.Post("/hosting/databases/bulk-status", s.adminBulkSuspendDatabases)
	admin.Patch("/hosting/databases/:id/password", s.adminResetDatabasePassword)
	admin.Patch("/hosting/databases/:id/transfer", s.adminTransferDatabase)
	admin.Delete("/hosting/databases/:id", s.adminDeleteDatabase)
	admin.Get("/bots", s.adminListBots)
	admin.Patch("/bots/:id", s.adminUpdateBot)
	admin.Patch("/bot-limits/:userId", s.adminSetBotLimit)
	admin.Get("/health", s.adminHealthDetails)
	admin.Get("/users", s.adminUsers)
	admin.Post("/users", s.createAdminUser)
	admin.Patch("/users/:id", s.updateAdminUser)
	admin.Patch("/users/:id/status", s.setUserStatus)
	admin.Patch("/users/:id/password", s.adminResetUserPassword)
	admin.Delete("/users/:id", s.deleteAdminUser)
	admin.Delete("/users/:id/sessions", s.adminRevokeSessions)
	admin.Get("/access", requireRoles("superadmin"), s.accessMatrix)
	admin.Patch("/access/:id/role", requireRoles("superadmin"), s.setUserRole)
	admin.Get("/logs", requireRoles("superadmin"), s.adminLogs)
	admin.Get("/settings", requireRoles("superadmin"), s.adminSettings)
	admin.Patch("/settings", requireRoles("superadmin"), s.updateAdminSettings)
	admin.Get("/topups/summary", requireRoles("superadmin", "admin"), s.adminTopupSummary)
	admin.Get("/topups/transactions", requireRoles("superadmin", "admin"), s.adminTopupTransactions)
	admin.Get("/topups/transactions/:id", requireRoles("superadmin", "admin"), s.adminTopupTransaction)
	admin.Get("/topups/settings", requireRoles("superadmin"), s.adminTopupSettings)
	admin.Patch("/topups/settings", requireRoles("superadmin"), s.updateAdminTopupSettings)
	admin.Post("/settings/revoke-all-sessions", requireRoles("superadmin"), s.revokeAllSessions)
	admin.Get("/banned-ips", requireRoles("superadmin", "admin"), s.listBannedIPs)
	admin.Post("/banned-ips", requireRoles("superadmin", "admin"), s.banIP)
	admin.Delete("/banned-ips/:ip", requireRoles("superadmin", "admin"), s.unbanIP)
	admin.Post("/assets/announcement", requireRoles("admin", "superadmin"), s.uploadAnnouncementAsset)
	admin.Post("/assets/:kind", requireRoles("superadmin"), s.uploadBrandAsset)
	admin.Delete("/assets/:kind", requireRoles("superadmin"), s.deleteBrandAsset)

	admin.Get("/files", requireRoles("superadmin", "admin"), s.listAdminFiles)
	admin.Post("/files/upload", requireRoles("superadmin", "admin"), s.uploadAdminFile)
	admin.Delete("/files", requireRoles("superadmin", "admin"), s.deleteAdminFile)
	admin.Get("/user-files", requireRoles("superadmin", "admin"), s.listAllUserFiles)
	admin.Post("/user-files/batch-delete", requireRoles("superadmin", "admin"), s.batchDeleteAdminUserFiles)
	admin.Post("/user-files/batch-category", requireRoles("superadmin", "admin"), s.batchUpdateAdminUserFilesCategory)
	admin.Post("/user-files/batch-visibility", requireRoles("superadmin", "admin"), s.batchUpdateAdminUserFilesVisibility)
	admin.Post("/user-files/:id/share", requireRoles("superadmin", "admin"), s.rateLimit("admin_user_file_share", 60, time.Hour), s.createAdminUserFileShare)
	admin.Delete("/user-files/:id/share", requireRoles("superadmin", "admin"), s.revokeAdminUserFileShare)
	admin.Patch("/user-files/:id", requireRoles("superadmin", "admin"), s.patchAdminUserFile)
	admin.Delete("/user-files/:id", requireRoles("superadmin", "admin"), s.deleteAnyUserFile)
	admin.Get("/user-file-categories", requireRoles("superadmin", "admin"), s.listUserFileCategories)
	admin.Post("/user-file-categories", requireRoles("superadmin", "admin"), s.createUserFileCategory)
	admin.Put("/user-file-categories/:id", requireRoles("superadmin", "admin"), s.updateUserFileCategory)
	admin.Patch("/user-file-categories/:id", requireRoles("superadmin", "admin"), s.updateUserFileCategory)
	admin.Delete("/user-file-categories/:id", requireRoles("superadmin", "admin"), s.deleteUserFileCategory)
	admin.Get("/user-file-categories/:categoryId/folders", requireRoles("superadmin", "admin"), s.listAdminUserFileFolders)
	admin.Post("/user-file-categories/:categoryId/folders", requireRoles("superadmin", "admin"), s.createAdminUserFileFolder)
	admin.Put("/user-file-folders/:id", requireRoles("superadmin", "admin"), s.updateAdminUserFileFolder)
	admin.Patch("/user-file-folders/:id", requireRoles("superadmin", "admin"), s.updateAdminUserFileFolder)
	admin.Delete("/user-file-folders/:id", requireRoles("superadmin", "admin"), s.deleteAdminUserFileFolder)
	admin.Post("/user-file-folders/:id/share", requireRoles("superadmin", "admin"), s.rateLimit("admin_user_file_folder_share", 60, time.Hour), s.createAdminUserFileFolderShare)
	admin.Delete("/user-file-folders/:id/share", requireRoles("superadmin", "admin"), s.revokeAdminUserFileFolderShare)
	admin.Post("/user-files/batch-folder", requireRoles("superadmin", "admin"), s.batchUpdateAdminUserFilesFolder)
	admin.Delete("/user-file-categories/:id/shares", requireRoles("superadmin", "admin"), s.revokeAllUserFileCategoryShares)
	admin.Post("/user-file-categories/:id/share", requireRoles("superadmin", "admin"), s.createAdminUserFileCategoryShare)
	admin.Delete("/user-file-categories/:id/share", requireRoles("superadmin", "admin"), s.revokeAdminUserFileCategoryShare)
	// Allow both admin and superadmin to manage announcements
	admin.Get("/announcements", requireRoles("admin", "superadmin"), s.adminAnnouncements)
	admin.Post("/announcements", requireRoles("admin", "superadmin"), s.createAnnouncement)
	admin.Patch("/announcements/:id", requireRoles("admin", "superadmin"), s.updateAnnouncement)
	admin.Delete("/announcements/:id", requireRoles("admin", "superadmin"), s.deleteAnnouncement)
	admin.Post("/settings/test-webhook", requireRoles("superadmin"), s.testWebhook)
	admin.Get("/lockdown", requireRoles("superadmin"), s.adminLockdownStatus)
	admin.Patch("/lockdown", requireRoles("superadmin"), s.adminUpdateLockdown)
	admin.Get("/mail/domains", s.adminListMailDomains)
	admin.Get("/mail/domains/:id/mailboxes", s.adminListMailDomainMailboxes)
	admin.Get("/mail/messages", s.adminListMailMessages)
	admin.Patch("/mail/domains/:id/status", s.adminSetMailDomainStatus)
	admin.Post("/mail/stalwart/sync", requireRoles("superadmin"), s.adminSyncStalwart)
	admin.Get("/mail/stalwart/health", requireRoles("admin", "superadmin"), s.adminStalwartHealth)
	admin.Get("/mail/discord-bot", requireRoles("admin", "superadmin"), s.getAdminMailDiscordBot)
	admin.Put("/mail/discord-bot", requireRoles("admin", "superadmin"), s.updateAdminMailDiscordBot)
	admin.Get("/mail/log-settings", requireRoles("superadmin"), s.getAdminMailLogSettings)
	admin.Put("/mail/log-settings", requireRoles("superadmin"), s.updateAdminMailLogSettings)
	admin.Post("/mail/log-settings/test", requireRoles("superadmin"), s.rateLimit("mail_log_test", 10, time.Minute), s.testAdminMailLog)
	admin.Get("/mail/discord-bot/self-service", requireRoles("superadmin"), s.getAdminMailBotSelfService)
	admin.Put("/mail/discord-bot/self-service", requireRoles("superadmin"), s.updateAdminMailBotSelfService)
	admin.Get("/discord-bots/:botKey/connection", requireRoles("superadmin"), s.getAdminDiscordBotConnection)
	admin.Put("/discord-bots/:botKey/token", requireRoles("superadmin"), s.rateLimit("admin_discord_bot_token", 20, time.Hour), s.updateAdminDiscordBotToken)
	admin.Delete("/discord-bots/:botKey/token", requireRoles("superadmin"), s.deleteAdminDiscordBotToken)
	admin.Get("/discord-voice-rooms", requireRoles("superadmin"), s.adminVoiceRooms)
	admin.Put("/discord-voice-rooms/settings", requireRoles("superadmin"), s.updateAdminVoiceRoomSettings)
	admin.Delete("/discord-voice-rooms/:id", requireRoles("superadmin"), s.adminDeleteVoiceRoom)
	admin.Get("/discord-voice-messages", requireRoles("superadmin"), s.adminVoiceMessages)
	admin.Get("/discord-voice-sessions", requireRoles("superadmin"), s.adminVoiceSessions)
	admin.Get("/discord-protect", requireRoles("superadmin"), s.adminDiscordProtect)
	admin.Put("/discord-protect", requireRoles("superadmin"), s.updateAdminDiscordProtect)
	admin.Get("/discord-voice-messages/:key/image", requireRoles("superadmin"), s.adminVoiceMessageImage)
	admin.Put("/discord-voice-messages/:key", requireRoles("superadmin"), s.updateAdminVoiceMessage)
	admin.Get("/discord-bots/:botKey", requireRoles("admin", "superadmin"), s.getAdminDiscordBotPresence)
	admin.Put("/discord-bots/:botKey", requireRoles("admin", "superadmin"), s.updateAdminDiscordBotPresence)
	mailSettings := app.Group("/api/admin/mail/settings", sensitiveResponseHeaders, s.requireUser, requirePasswordReady, requireRoles("superadmin"))
	mailSettings.Get("/", s.getAdminMailSettings)
	mailSettings.Put("/", s.updateAdminMailSettings)
	mailSettings.Post("/test", s.testAdminMailSettings)

	admin.Get("/store/categories", s.adminGetCategories)
	admin.Post("/store/categories", s.adminCreateCategory)
	admin.Put("/store/categories/:id", s.adminUpdateCategory)
	admin.Delete("/store/categories/:id", s.adminDeleteCategory)

	admin.Get("/store/products", s.adminGetProducts)
	admin.Post("/store/products", s.adminCreateProduct)
	admin.Put("/store/products/:id", s.adminUpdateProduct)
	admin.Delete("/store/products/:id", s.adminDeleteProduct)
	admin.Get("/store/orders", requireRoles("superadmin", "admin"), s.adminListOrders)
	admin.Get("/store/sales", requireRoles("superadmin", "admin"), s.adminStoreSales)
	admin.Post("/store/orders/:id/refund", requireRoles("superadmin", "admin"), s.rateLimit("admin_store_refund", 60, time.Hour), s.adminRefundOrder)

	admin.Get("/student-mappings", s.adminListStudentMappings)
	admin.Post("/student-mappings", s.adminSaveStudentMapping)
	admin.Delete("/student-mappings/:id", s.adminDeleteStudentMapping)
	admin.Post("/student-mappings/auto-detect", s.adminAutoDetectStudentMappings)
	admin.Post("/student-mappings/auto-detect-sites", s.adminAutoDetectSiteMappings)
	admin.Post("/student-mappings/:id/unlink-site", s.adminUnlinkStudentSite)
	admin.Post("/student-mappings/:id/unbind-discord", s.adminUnbindStudentDiscord)
	admin.Post("/student-mappings/unbind-all", s.adminUnbindAllStudentDiscord)

	app.Post("/api/internal/phpmyadmin/tickets/consume", s.consumeSecurePhpMyAdminTicket)
	app.Post("/api/internal/bot/student-db-ticket", s.botGenerateStudentTicket)
	app.Post("/api/internal/bot/student-workspace-ticket", s.botGenerateStudentWorkspaceTicket)
	app.Get("/api/internal/bot/student-mappings", s.botListStudentMappings)
	app.Post("/api/internal/bot/student-mappings", s.botSaveStudentMapping)
	app.Post("/api/internal/bot/student-mappings/auto-detect", s.botAutoDetectStudentMappings)
	app.Post("/api/internal/bot/student-mappings/auto-detect-sites", s.botAutoDetectSiteMappings)
	app.Post("/api/internal/bot/student-mappings/unbind", s.botUnbindStudentDiscord)
	app.Get("/api/internal/bot/student-by-discord/:discordUserId", s.botGetStudentByDiscord)
	app.Post("/api/internal/bot/student-mappings/batch-bind", s.botBatchBindStudentDiscord)
	app.Get("/api/internal/bot/mail/me/:discordUserId", s.botMailMe)
	app.Get("/api/internal/bot/mail/messages", s.botMailMessages)
	app.Get("/api/internal/bot/mail/messages/:id", s.botMailMessage)
	app.Post("/api/internal/bot/mail/bind", s.botMailBind)
	app.Delete("/api/internal/bot/mail/bind", s.botMailUnbind)
	app.Get("/api/internal/bot/mail/admin-summary", s.botMailAdminSummary)
	app.Get("/api/internal/bot/mail/presence", s.botMailPresence)
	app.Patch("/api/internal/bot/mail/messages/:id", s.botMailUpdateMessage)
	app.Get("/api/internal/bot/mail/create-options", s.botMailCreateOptions)
	app.Post("/api/internal/bot/mail/mailboxes", s.botMailCreateMailbox)
	app.Get("/api/internal/bot/mail/mailboxes/:id/app-passwords", s.botMailListAppPasswords)
	app.Post("/api/internal/bot/mail/mailboxes/:id/app-passwords", s.botMailCreateAppPassword)
	app.Delete("/api/internal/bot/mail/mailboxes/:id/app-passwords/:credentialId", s.botMailRevokeAppPassword)
	app.Put("/api/internal/bot/mail/notify", s.botMailSetNotify)
	app.Get("/api/internal/bot/mail/notify/poll", s.botMailNotifyPoll)
	app.Get("/api/internal/bot/mail/image", s.botMailImage)
	app.Get("/api/internal/bot/mail/admin/mailboxes", s.botMailAdminMailboxes)
	app.Post("/api/internal/bot/mail/admin/mailboxes", s.botMailAdminCreateMailbox)
	app.Get("/api/internal/bot/mail/admin/mailboxes/:id", s.botMailAdminMailbox)
	app.Post("/api/internal/bot/mail/admin/mailboxes/:id/suspend", s.botMailAdminSetMailboxStatus("suspended"))
	app.Post("/api/internal/bot/mail/admin/mailboxes/:id/resume", s.botMailAdminSetMailboxStatus("active"))
	app.Delete("/api/internal/bot/mail/admin/mailboxes/:id", s.botMailAdminDeleteMailbox)
	app.Get("/api/internal/bot/mail/admin/domains", s.botMailAdminDomains)
	app.Patch("/api/internal/bot/mail/admin/domains/:id/status", s.botMailAdminSetDomainStatus)
	app.Get("/api/internal/bot/mail/admin/settings", s.botMailAdminGetSettings)
	app.Put("/api/internal/bot/mail/admin/settings", s.botMailAdminSaveSettings)
	app.Get("/api/internal/bot/token/:botKey", s.botDiscordToken)
	app.Post("/api/internal/bot/status/:botKey", s.botDiscordStatus)
	app.Get("/api/internal/bot/voice/settings", s.botVoiceSettings)
	app.Get("/api/internal/bot/voice/rooms", s.botVoiceRooms)
	app.Post("/api/internal/bot/voice/rooms", s.botVoiceCreateRoom)
	app.Get("/api/internal/bot/voice/check", s.botVoiceCheck)
	app.Get("/api/internal/bot/voice/rooms/:id", s.botVoiceRoom)
	app.Put("/api/internal/bot/voice/rooms/:id/channel", s.botVoiceSetChannel)
	app.Post("/api/internal/bot/voice/rooms/:id/unlock", s.botVoiceUnlock)
	app.Patch("/api/internal/bot/voice/rooms/:id", s.botVoiceUpdateRoom)
	app.Post("/api/internal/bot/voice/rooms/:id/kick", s.botVoiceKick)
	app.Delete("/api/internal/bot/voice/rooms/:id", s.botVoiceDeleteRoom)
	app.Post("/api/internal/bot/voice/rooms/:id/transfer", s.botVoiceTransfer)
	app.Post("/api/internal/bot/voice/rooms/:id/denied", s.botVoiceDenied)
	app.Get("/api/internal/bot/voice/places", s.botVoicePlaces)
	app.Post("/api/internal/bot/voice/places", s.botVoiceAddPlace)
	app.Delete("/api/internal/bot/voice/places/:kind/:channelId", s.botVoiceRemovePlace)
	app.Post("/api/internal/bot/voice/places/applied", s.botVoiceMessageApplied)
	app.Post("/api/internal/bot/voice/places/deleted", s.botVoicePlaceDeleted)
	app.Get("/api/internal/bot/protect/settings", s.botDiscordProtectSettings)
	app.Post("/api/internal/bot/protect/status", s.botDiscordProtectStatus)
	app.Post("/api/internal/bot/protect/event", s.botDiscordProtectEvent)
	app.Get("/api/internal/bot/voice/messages", s.botVoiceMessages)
	app.Post("/api/internal/bot/voice/sessions/move", s.botVoiceSessionMove)
	app.Post("/api/internal/bot/voice/sessions/sync", s.botVoiceSessionSync)
	app.Get("/api/internal/bot/voice/sessions/feed", s.botVoiceSessionFeed)
	app.Post("/api/internal/bot/voice/sessions/ack", s.botVoiceSessionAck)
	app.Get("/api/internal/bot/voice/sessions/history", s.botVoiceSessionHistory)
	app.Get("/api/internal/bot/voice/messages/:key/image", s.botVoiceMessageImage)
	app.Get("/api/internal/bot/voice/feed", s.botVoiceFeed)
	app.Post("/api/internal/bot/voice/feed/ack", s.botVoiceFeedAck)
	app.Get("/api/internal/bot/voice/history", s.botVoiceHistory)
	app.Get("/api/internal/bot/presence/:botKey", s.botDiscordPresence)
	app.Get("/api/internal/bot/access/:botKey", s.botDiscordAccess)
	app.Post("/api/internal/bot/access/:botKey", s.updateBotDiscordAccess)
	app.Post("/api/internal/bot/activity", s.botActivity)
	app.Get("/api/internal/bot/lockdown", s.botLockdownStatus)
	app.Post("/api/internal/bot/uploads", s.botUploadImages)
	app.Get("/api/internal/bot/uploads", s.botUploadHistory)
	app.Post("/api/internal/bot/gallery-ticket", s.botIssueGalleryTicket)
	app.Post("/api/gallery/session", s.galleryRedeemSession)
	app.Get("/api/gallery/uploads", s.galleryListUploads)
	app.Delete("/api/gallery/uploads/:id", s.galleryDeleteUpload)
	app.Post("/api/internal/bot/lockdown", s.botUpdateLockdown)
	app.Post("/api/internal/bot/lockdown/access", s.botLockdownAccess)
	app.Get("/api/lockdown-control/t/:ticket", s.consumeLockdownAccessTicket)
	app.Get("/api/lockdown-control", s.lockdownControlPage)
	app.Post("/api/lockdown-control/disable", s.lockdownControlDisable)

	log.Printf("NEXORA CLOUD API listening on :%s", cfg.port)
	log.Fatal(app.Listen(":" + cfg.port))
}

func loadConfig() config {
	oauthBaseURL := env("OAUTH_BASE_URL", "http://localhost:8088")
	publicAppURL := env("PUBLIC_APP_URL", "")
	s3PublicURL := strings.TrimRight(env("S3_PUBLIC_URL", "http://localhost:8088/assets"), "/")
	environment, environmentSource := resolveRuntimeEnvironment(env("APP_ENV", "auto"), publicAppURL, oauthBaseURL, s3PublicURL)
	cfDomain := env("CF_HOSTING_DOMAIN", "nkn02.com")
	origins := loadAllowedOrigins(environment, env("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8088,https://nkn02.com,https://www.nkn02.com"), cfDomain)
	return config{
		environment:       environment,
		environmentSource: environmentSource,
		port:              env("PORT", "8080"),
		databaseURL:       env("DATABASE_URL", "postgres://nexora:nexora@localhost:5432/nexora?sslmode=disable"),
		redisURL:          env("REDIS_URL", "redis://:nexora-redis@localhost:6379/0"),
		allowedOrigins:    origins,
		cookieName:        env("SESSION_COOKIE_NAME", "nexora_session"),
		cookieSecure:      environment == runtimeProduction || envBool("COOKIE_SECURE", false),
		argonMemory:       64 * 1024,
		argonIterations:   3,
		argonParallel:     2,
		argonKeyLength:    32,
		oauthBaseURL:      oauthBaseURL,
		publicAPIURL:      strings.TrimRight(env("PUBLIC_API_URL", oauthBaseURL), "/"),
		oauth: map[string]oauthProviderConfig{
			"discord": {ClientID: env("DISCORD_CLIENT_ID", ""), ClientSecret: env("DISCORD_CLIENT_SECRET", "")},
			"google":  {ClientID: env("GOOGLE_CLIENT_ID", ""), ClientSecret: env("GOOGLE_CLIENT_SECRET", "")},
			"github":  {ClientID: env("GITHUB_CLIENT_ID", ""), ClientSecret: env("GITHUB_CLIENT_SECRET", "")},
		},
		s3Endpoint:               env("S3_ENDPOINT", "minio:9000"),
		s3AccessKey:              env("S3_ACCESS_KEY", "nexora"),
		s3SecretKey:              env("S3_SECRET_KEY", "change-this-minio-password"),
		s3Bucket:                 env("S3_BUCKET", "nexora-assets"),
		s3PublicURL:              s3PublicURL,
		s3UseSSL:                 envBool("S3_USE_SSL", false),
		jwtSecret:                env("JWT_SECRET", env("WEBHOOK_ENCRYPTION_KEY", "local-only-change-this-jwt-secret")),
		webhookKey:               env("WEBHOOK_ENCRYPTION_KEY", "local-only-change-this-webhook-key"),
		hostingEncryptionKey:     env("HOSTING_ENCRYPTION_KEY", "local-only-change-this-hosting-encryption-key"),
		tenantMySQLDSN:           env("TENANT_MYSQL_DSN", "root:change-this-mysql-password@tcp(tenant-db:3306)/?parseTime=true&multiStatements=false"),
		cfAPIToken:               env("CLOUDFLARE_API_TOKEN", env("CF_API_TOKEN", "")),
		cfZoneID:                 env("CF_ZONE_ID", ""),
		cfDomain:                 env("CF_HOSTING_DOMAIN", "nkn02.com"),
		hostingServerIP:          env("HOSTING_SERVER_IP", "165.101.65.23"),
		phpMyAdminInternalSecret: env("PMA_INTERNAL_SECRET", "local-only-change-this-pma-internal-secret"),
		phpMyAdminPublicURL:      strings.TrimRight(env("PMA_PUBLIC_URL", "http://db.localhost:8088"), "/"),
		checkSlipsAPIBaseURL:     strings.TrimRight(env("CHECKSLIPS_API_BASE_URL", "https://api.checkslips.com"), "/"),
		checkSlipsAPIToken:       env("CHECKSLIPS_API_TOKEN", ""),
		checkSlipsTenantID:       env("CHECKSLIPS_TENANT_ID", ""),
		checkSlipsEncryptionKey:  env("CHECKSLIPS_ENCRYPTION_KEY", env("WEBHOOK_ENCRYPTION_KEY", "local-only-change-this-checkslips-key")),
		resendAPIKey:             env("RESEND_API_KEY", ""),
		resendWebhookSecret:      env("RESEND_WEBHOOK_SECRET", ""),
		resendAPIBaseURL:         strings.TrimRight(env("RESEND_API_BASE_URL", "https://api.resend.com"), "/"),
		stalwartAPIURL:           strings.TrimRight(env("STALWART_API_URL", "http://stalwart:8080"), "/"),
		stalwartAPIToken:         env("STALWART_API_TOKEN", ""),
		stalwartPublicURL:        strings.TrimRight(env("STALWART_PUBLIC_URL", "https://mail.nkn02.com"), "/"),
		mailDiscordAdminIDs:      parseDiscordIDList(firstNonEmpty(env("MAIL_DISCORD_ADMIN_IDS", ""), env("DISCORD_ADMIN_IDS", ""))),
		discordAdminIDs:          parseDiscordIDList(firstNonEmpty(env("DISCORD_ADMIN_IDS", ""), env("MAIL_DISCORD_ADMIN_IDS", ""))),
		topupReceiver: checkSlipsReceiver{
			BankCode:      env("TOPUP_RECEIVER_BANK_CODE", ""),
			BankName:      env("TOPUP_RECEIVER_BANK_NAME", ""),
			AccountNumber: env("TOPUP_RECEIVER_ACCOUNT_NUMBER", ""),
			AccountName:   env("TOPUP_RECEIVER_ACCOUNT_NAME", ""),
		},
	}
}

func validateConfig(cfg config) error {
	if cfg.environment != runtimeDevelopment && cfg.environment != runtimeProduction {
		return fmt.Errorf("APP_ENV must be auto, development, or production")
	}
	if cfg.environment != runtimeProduction {
		return nil
	}
	if !cfg.cookieSecure {
		return fmt.Errorf("COOKIE_SECURE must be true in production")
	}
	for origin := range cfg.allowedOrigins {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
			return fmt.Errorf("ALLOWED_ORIGINS contains an unsafe production origin")
		}
	}
	secrets := map[string]string{
		"S3_SECRET_KEY":          cfg.s3SecretKey,
		"WEBHOOK_ENCRYPTION_KEY": cfg.webhookKey,
		"HOSTING_ENCRYPTION_KEY": cfg.hostingEncryptionKey,
		"PMA_INTERNAL_SECRET":    cfg.phpMyAdminInternalSecret,
	}
	for name, value := range secrets {
		lower := strings.ToLower(value)
		if len(value) < 32 || strings.Contains(lower, "change-this") || strings.Contains(lower, "local-only") || strings.Contains(lower, "replace-with") {
			return fmt.Errorf("%s must be a unique secret of at least 32 characters in production", name)
		}
	}
	return nil
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	return err == nil && parsed
}

func waitForPostgres(ctx context.Context, db *pgxpool.Pool) error {
	var lastErr error
	for attempt := 0; attempt < 30; attempt++ {
		if err := db.Ping(ctx); err == nil {
			return nil
		} else {
			lastErr = err
		}
		time.Sleep(time.Second)
	}
	return fmt.Errorf("postgres unavailable: %w", lastErr)
}

func waitForRedis(ctx context.Context, client *redis.Client) error {
	var lastErr error
	for attempt := 0; attempt < 30; attempt++ {
		if err := client.Ping(ctx).Err(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		time.Sleep(time.Second)
	}
	return fmt.Errorf("redis unavailable: %w", lastErr)
}

func runMigrations(ctx context.Context, db *pgxpool.Pool) error {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		sql, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		if _, err := db.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("migration %s failed: %w", entry.Name(), err)
		}
	}
	return nil
}

func (s *server) originGuard(c *fiber.Ctx) error {
	method := c.Method()
	if method != fiber.MethodPost && method != fiber.MethodPatch && method != fiber.MethodPut && method != fiber.MethodDelete {
		return c.Next()
	}

	if strings.EqualFold(strings.TrimSpace(c.Get("Sec-Fetch-Site")), "cross-site") {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ไม่อนุญาตต้นทางของคำขอนี้", Code: "origin_not_allowed"})
	}

	origin := strings.TrimSpace(c.Get(fiber.HeaderOrigin))
	hasSession := c.Cookies(s.cfg.cookieName) != ""
	if origin == "" && hasSession {
		if referer, err := url.Parse(strings.TrimSpace(c.Get(fiber.HeaderReferer))); err == nil && referer.Scheme != "" && referer.Host != "" {
			origin = referer.Scheme + "://" + referer.Host
		}
	}
	if origin != "" {
		if (c.Path() == "/api/vps-uptime/exchange" || c.Path() == "/api/vps-uptime/logout") &&
			strings.EqualFold(c.Hostname(), "nove666.pro") && origin == "https://nove666.pro" {
			return c.Next()
		}
		if s.cfg.allowedOrigins[origin] {
			return c.Next()
		}
		reqHost := strings.TrimSpace(c.Get("X-Forwarded-Host", c.Hostname()))
		if trustedRuntimeOrigin(s.cfg.environment, origin, reqHost, s.cfg.cfDomain, "www."+s.cfg.cfDomain) {
			return c.Next()
		}
	}
	if origin != "" || hasSession {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ไม่อนุญาตต้นทางของคำขอนี้", Code: "origin_not_allowed"})
	}
	return c.Next()
}

func sensitiveResponseHeaders(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store, private, max-age=0")
	c.Set("Pragma", "no-cache")
	c.Set("Expires", "0")
	c.Set(fiber.HeaderReferrerPolicy, "no-referrer")
	return c.Next()
}

func (s *server) rateLimit(scope string, limit int64, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := extractRealIP(c)
		sum := sha256.Sum256([]byte(ip))
		key := fmt.Sprintf("rate:%s:%s", scope, hex.EncodeToString(sum[:12]))
		count, err := s.redis.Incr(c.Context(), key).Result()
		if err != nil {
			return fiber.NewError(fiber.StatusServiceUnavailable)
		}
		if count == 1 {
			s.redis.Expire(c.Context(), key, window)
		}
		if count > limit {
			c.Set(fiber.HeaderRetryAfter, strconv.Itoa(int(window.Seconds())))
			return c.Status(fiber.StatusTooManyRequests).JSON(apiError{Error: "ลองหลายครั้งเกินไป กรุณารอสักครู่", Code: "rate_limited"})
		}
		return c.Next()
	}
}

var (
	bannedIPsCache = map[string]struct{}{}
	lastBannedSync time.Time
	bannedSyncMu   sync.RWMutex
)

func (s *server) ipBanGuard(c *fiber.Ctx) error {
	ip := extractRealIP(c)
	bannedSyncMu.RLock()
	stale := time.Since(lastBannedSync) > time.Minute
	bannedSyncMu.RUnlock()
	if stale {
		bannedSyncMu.Lock()
		if time.Since(lastBannedSync) > time.Minute {
			rows, err := s.db.Query(context.Background(), "SELECT ip_address FROM banned_ips")
			if err == nil {
				newCache := map[string]struct{}{}
				for rows.Next() {
					var ipAddr string
					if rows.Scan(&ipAddr) == nil {
						newCache[ipAddr] = struct{}{}
					}
				}
				rows.Close()
				if rows.Err() == nil {
					bannedIPsCache = newCache
					lastBannedSync = time.Now()
				}
			}
		}
		bannedSyncMu.Unlock()
	}
	bannedSyncMu.RLock()
	_, banned := bannedIPsCache[ip]
	bannedSyncMu.RUnlock()
	if banned {
		alertKey := "banned_alert:" + ip
		if ok, _ := s.redis.SetNX(c.Context(), alertKey, "1", 10*time.Minute).Result(); ok {
			s.audit(c, auditEvent{
				Category: "security",
				Action:   "ip.banned_access",
				Outcome:  "failure",
				Target:   "ip",
				TargetID: ip,
				Metadata: map[string]any{
					"reason": "ip_blacklisted",
				},
			})
		}
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "หมายเลข IP ของคุณถูกระงับการใช้งาน", Code: "ip_banned"})
	}
	return c.Next()
}

func (s *server) health(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "database unavailable"})
	}
	if err := s.redis.Ping(ctx).Err(); err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "session store unavailable"})
	}
	return c.JSON(fiber.Map{"status": "ok", "environment": s.cfg.environment})
}

func (s *server) apiStatusPage(c *fiber.Ctx) error {
	c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.SendString(apiStatusPageHTML)
}

const apiStatusPageHTML = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>NEXORA API Gateway — Operational</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg-base: #07090e;
      --bg-surface: rgba(15, 18, 26, 0.7);
      --bg-surface-hover: rgba(22, 27, 39, 0.85);
      --bg-card: rgba(18, 22, 32, 0.6);
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(255, 255, 255, 0.16);
      --border-accent: rgba(16, 185, 129, 0.3);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --emerald-glow: rgba(16, 185, 129, 0.15);
      --emerald-500: #10b981;
      --emerald-400: #34d399;
      --emerald-bg: rgba(16, 185, 129, 0.1);
      --cyan-400: #22d3ee;
      --indigo-glow: rgba(99, 102, 241, 0.08);
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      min-height: 100dvh;
      background-color: var(--bg-base);
      color: var(--text-primary);
      font-family: 'Kanit', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      position: relative;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .ambient-mesh {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      background:
        radial-gradient(ellipse 60% 40% at 50% -10%, var(--emerald-glow), transparent 70%),
        radial-gradient(ellipse 50% 30% at 85% 15%, var(--indigo-glow), transparent 60%),
        radial-gradient(ellipse 40% 30% at 15% 85%, rgba(14, 165, 233, 0.05), transparent 70%);
    }
    .grid-pattern {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      background-image:
        linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 40px 40px;
      mask-image: radial-gradient(ellipse at center, black 40%, transparent 80%);
      -webkit-mask-image: radial-gradient(ellipse at center, black 40%, transparent 80%);
    }
    .page-container {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 860px;
      margin: 0 auto;
      padding: clamp(20px, 4vw, 48px) clamp(16px, 3vw, 28px);
      display: flex;
      flex-direction: column;
      gap: 32px;
      flex: 1;
    }
    .nav-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 20px;
      border-radius: 9999px;
      background: var(--bg-surface);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-subtle);
    }
    .brand-group {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: inherit;
    }
    .brand-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(6, 182, 212, 0.1));
      border: 1px solid rgba(16, 185, 129, 0.3);
      display: grid;
      place-items: center;
      color: var(--emerald-400);
    }
    .brand-name {
      font-family: 'Kanit', 'Plus Jakarta Sans', sans-serif;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.04em;
      color: var(--text-primary);
    }
    .brand-tag {
      font-family: 'Kanit', 'Plus Jakarta Sans', sans-serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      padding: 2px 8px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-secondary);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .nav-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn-portal {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      text-decoration: none;
      padding: 6px 14px;
      border-radius: 9999px;
      border: 1px solid var(--border-subtle);
      background: rgba(255, 255, 255, 0.03);
      transition: all 0.2s ease;
    }
    .btn-portal:hover {
      color: var(--text-primary);
      border-color: var(--border-hover);
      background: rgba(255, 255, 255, 0.07);
    }
    .hero-panel {
      position: relative;
      padding: clamp(28px, 4vw, 44px);
      border-radius: 24px;
      background: var(--bg-surface);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border-subtle);
      box-shadow: 0 20px 60px -15px rgba(0, 0, 0, 0.6);
      overflow: hidden;
    }
    .hero-panel::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.4), transparent);
    }
    .status-badge-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      background: var(--emerald-bg);
      border: 1px solid var(--border-accent);
      color: var(--emerald-400);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--emerald-400);
      box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.6);
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7);
      }
      70% {
        box-shadow: 0 0 0 8px rgba(52, 211, 153, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
      }
    }
    .security-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
    }
    .hero-title {
      font-size: clamp(26px, 4.5vw, 36px);
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.25;
      color: var(--text-primary);
      margin-bottom: 12px;
    }
    .hero-desc {
      font-size: clamp(14px, 1.8vw, 16px);
      color: var(--text-secondary);
      line-height: 1.7;
      max-width: 660px;
    }
    .services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }
    .service-card {
      padding: 22px;
      border-radius: 18px;
      background: var(--bg-card);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid var(--border-subtle);
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 14px;
    }
    .service-card:hover {
      background: var(--bg-surface-hover);
      border-color: var(--border-hover);
      transform: translateY(-2px);
      box-shadow: 0 12px 30px -8px rgba(0, 0, 0, 0.4);
    }
    .card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .card-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.07);
      display: grid;
      place-items: center;
      color: var(--emerald-400);
      flex-shrink: 0;
    }
    .card-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      font-weight: 600;
      color: var(--emerald-400);
      background: var(--emerald-bg);
      padding: 3px 9px;
      border-radius: 9999px;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .card-info h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
    }
    .card-info p {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .card-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      font-family: 'Kanit', 'Plus Jakarta Sans', sans-serif;
    }
    .badge-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--text-secondary);
    }
    .diagnostic-panel {
      border-radius: 20px;
      background: #0b0e14;
      border: 1px solid var(--border-subtle);
      overflow: hidden;
    }
    .diagnostic-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      background: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--border-subtle);
    }
    .window-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .win-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
    }
    .diagnostic-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-muted);
      letter-spacing: 0.03em;
    }
    .diagnostic-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .endpoint-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      background: rgba(255, 255, 255, 0.02);
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .endpoint-spec {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }
    .method-get {
      font-weight: 700;
      color: var(--emerald-400);
      background: rgba(16, 185, 129, 0.15);
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
    }
    .endpoint-url {
      color: var(--text-secondary);
    }
    .endpoint-result {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
    .http-200 {
      color: var(--emerald-400);
      font-weight: 600;
    }
    .ping-box {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
    }
    .link-health {
      color: var(--cyan-400);
      text-decoration: none;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: opacity 0.2s;
    }
    .link-health:hover {
      opacity: 0.8;
      text-decoration: underline;
    }
    .site-footer {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 860px;
      margin: 0 auto;
      padding: 24px clamp(16px, 3vw, 28px) 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-top: 1px solid var(--border-subtle);
      font-size: 13px;
      color: var(--text-muted);
      flex-wrap: wrap;
    }
    .footer-links {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .footer-links a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer-links a:hover {
      color: var(--text-primary);
    }
    @media (max-width: 640px) {
      .nav-bar {
        border-radius: 18px;
        padding: 10px 16px;
      }
      .hero-panel {
        padding: 24px 20px;
        border-radius: 20px;
      }
      .services-grid {
        grid-template-columns: 1fr;
      }
      .site-footer {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="ambient-mesh"></div>
  <div class="grid-pattern"></div>

  <div class="page-container">
    <header class="nav-bar">
      <a href="https://nkn02.com" class="brand-group">
        <div class="brand-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
            <path d="M2 17l10 5 10-5"></path>
            <path d="M2 12l10 5 10-5"></path>
          </svg>
        </div>
        <span class="brand-name">NEXORA</span>
        <span class="brand-tag">API</span>
      </a>

      <div class="nav-actions">
        <a href="https://nkn02.com" class="btn-portal">
          <span>เข้าสู่แพลตฟอร์ม</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 17L17 7"></path>
            <path d="M7 7h10v10"></path>
          </svg>
        </a>
      </div>
    </header>

    <section class="hero-panel">
      <div class="status-badge-row">
        <div class="status-pill">
          <span class="pulse-dot"></span>
          <span>ระบบเปิดให้บริการตามปกติ</span>
        </div>
        <div class="security-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <span>TLS 1.3 Encrypted &amp; Protected</span>
        </div>
      </div>

      <h1 class="hero-title">NEXORA Cloud API Gateway</h1>
      <p class="hero-desc">
        เกตเวย์ประมวลผลคำขอเชื่อมต่อระดับโครงสร้างพื้นฐาน ให้บริการ API สำหรับระบบเว็บ โฮสติ้ง จัดเก็บไฟล์ และฐานข้อมูลคลาวด์ความเร็วสูง ภายใต้การควบคุมความปลอดภัยหลายชั้น
      </p>
    </section>

    <section class="services-grid">
      <article class="service-card">
        <div class="card-top">
          <div class="card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
              <line x1="6" y1="6" x2="6.01" y2="6"></line>
              <line x1="6" y1="18" x2="6.01" y2="18"></line>
            </svg>
          </div>
          <span class="card-status">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            พร้อมใช้งาน
          </span>
        </div>
        <div class="card-info">
          <h3>Core API Routing</h3>
          <p>ระบบจัดการคำขอความเร็วสูง ประมวลผล Authentication, Rate Limit และ Audit Logging แบบเรียลไทม์</p>
        </div>
        <div class="card-bottom">
          <span>Engine</span>
          <span class="badge-code">Go Fiber v2</span>
        </div>
      </article>

      <article class="service-card">
        <div class="card-top">
          <div class="card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <path d="M9 12l2 2 4-4"></path>
            </svg>
          </div>
          <span class="card-status">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            คุ้มครอง 24/7
          </span>
        </div>
        <div class="card-info">
          <h3>Active Defense</h3>
          <p>กำแพงไฟ UFW ร่วมกับ CrowdSec คอยตรวจจับและบล็อกการสแกนหรือการโจมตีตั้งแต่ระดับ Kernel Packet</p>
        </div>
        <div class="card-bottom">
          <span>Firewall &amp; IPS</span>
          <span class="badge-code">UFW + CrowdSec</span>
        </div>
      </article>

      <article class="service-card">
        <div class="card-top">
          <div class="card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
          </div>
          <span class="card-status">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            เข้ารหัสสมบูรณ์
          </span>
        </div>
        <div class="card-info">
          <h3>Edge Delivery</h3>
          <p>กระจายทราฟฟิกผ่าน Cloudflare Anycast พร้อมระบบจัดการใบรับรองอัตโนมัติและความปลอดภัยของ Headers</p>
        </div>
        <div class="card-bottom">
          <span>Reverse Proxy</span>
          <span class="badge-code">Caddy v2 + Cloudflare</span>
        </div>
      </article>

      <article class="service-card">
        <div class="card-top">
          <div class="card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
            </svg>
          </div>
          <span class="card-status">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            เครือข่ายปิด
          </span>
        </div>
        <div class="card-info">
          <h3>Isolated Storage</h3>
          <p>ฐานข้อมูลและ Object Storage จัดเก็บบนเครือข่ายภายในแบบปิด ไม่เปิดพอร์ตสู่สาธารณะโดยตรง</p>
        </div>
        <div class="card-bottom">
          <span>Database Nodes</span>
          <span class="badge-code">PG17 · Redis7 · MySQL8</span>
        </div>
      </article>
    </section>

    <section class="diagnostic-panel">
      <div class="diagnostic-header">
        <div class="window-controls">
          <span class="win-dot"></span>
          <span class="win-dot"></span>
          <span class="win-dot"></span>
        </div>
        <span class="diagnostic-title">API HEALTH &amp; DIAGNOSTICS</span>
      </div>

      <div class="diagnostic-body">
        <div class="endpoint-row">
          <div class="endpoint-spec">
            <span class="method-get">GET</span>
            <span class="endpoint-url">https://api.nkn02.com/health</span>
          </div>
          <div class="endpoint-result">
            <span class="http-200">HTTP 200 OK</span>
            <span class="ping-box">&bull; JSON Response</span>
            <a href="https://api.nkn02.com/health" target="_blank" rel="noopener noreferrer" class="link-health">
              <span>ตรวจสอบผลลัพธ์</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>

  <footer class="site-footer">
    <div>
      <span>&copy; 2026 NEXORA Cloud. All rights reserved.</span>
    </div>
    <div class="footer-links">
      <a href="https://nkn02.com">หน้าหลักแพลตฟอร์ม</a>
      <a href="https://api.nkn02.com/health">Health Check</a>
      <a href="https://db.nkn02.com">Database Management</a>
    </div>
  </footer>
</body>
</html>`

func (s *server) register(c *fiber.Ctx) error {
	settings, err := s.loadSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !settings.RegistrationEnabled || !settings.LocalLoginEnabled {
		s.audit(c, auditEvent{Category: "auth", Action: "auth.register", Outcome: "failure", Metadata: map[string]any{"reason": "registration_disabled"}})
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ระบบสมัครสมาชิกถูกปิดใช้งาน", Code: "registration_disabled"})
	}
	var body authRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	identifier, message := validateCredentials(body)
	if message != "" {
		s.audit(c, auditEvent{Category: "auth", Action: "auth.register", Outcome: "failure", Metadata: map[string]any{"reason": "invalid_credentials"}})
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: message, Code: "invalid_credentials"})
	}
	hash, err := s.hashPassword(body.Password)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	var userID int64
	var username, role string
	err = s.db.QueryRow(c.Context(),
		`INSERT INTO users (identifier, password_hash) VALUES ($1, $2) RETURNING id, identifier, role`,
		identifier, hash,
	).Scan(&userID, &username, &role)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			s.audit(c, auditEvent{Category: "auth", Action: "auth.register", Outcome: "failure", Metadata: map[string]any{"reason": "account_exists"}})
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้งานแล้ว", Code: "account_exists"})
		}
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	user := &currentUser{ID: userID, Username: username, Role: role, Status: "active", PasswordEnabled: true, Permissions: permissionsForRole(role)}
	if err := s.createSession(c, user); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: user, Category: "auth", Action: "auth.register", Target: "user", TargetID: strconv.FormatInt(userID, 10)})
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"user": user})
}

const (
	maxFailedLoginAttempts = 5
	ipLockoutDuration      = 15 * time.Minute
	failedLoginWindow      = 15 * time.Minute
	// loginRequestLimit caps every login request from one IP, right or wrong. It only stops
	// floods (each check hashes a password); guessing is stopped by maxFailedLoginAttempts.
	loginRequestLimit = 20
	// accountFailureAlert is how many wrong passwords one account may take in the window,
	// summed over every IP, before each further failure is slowed down and an alert is sent.
	// The account is never locked, so nobody can lock an admin out by failing on purpose.
	accountFailureAlert = 10
)

// accountFailureKey counts wrong passwords per account name across all IPs.
func accountFailureKey(identifier string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(identifier))))
	return "failed_login:acct:" + hex.EncodeToString(sum[:12])
}

// accountFailureDelay is the extra wait for one more failure on an account under attack:
// one second per failure past the alert line, at most three.
func accountFailureDelay(count int64) time.Duration {
	over := count - accountFailureAlert
	if over <= 0 {
		return 0
	}
	if over > 3 {
		over = 3
	}
	return time.Duration(over) * time.Second
}

func (s *server) login(c *fiber.Ctx) error {
	settings, err := s.loadSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !settings.LocalLoginEnabled {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "การเข้าสู่ระบบด้วยรหัสผ่านถูกปิดใช้งาน", Code: "local_login_disabled"})
	}
	var body authRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	identifier := strings.TrimSpace(body.Username)
	if identifier == "" || body.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน", Code: "missing_credentials"})
	}

	ip := extractRealIP(c)
	lockoutKey := "temp_blocked:ip:" + ip

	// 1. Check if IP is temporarily locked out
	if blocked, _ := s.redis.Exists(c.Context(), lockoutKey).Result(); blocked > 0 {
		ttl, _ := s.redis.TTL(c.Context(), lockoutKey).Result()
		minutesLeft := int(ttl.Minutes())
		if minutesLeft <= 0 {
			minutesLeft = 1
		}
		s.audit(c, auditEvent{
			Category: "auth",
			Action:   "auth.login",
			Outcome:  "failure",
			Target:   "user",
			TargetID: identifier,
			Metadata: map[string]any{
				"username":     identifier,
				"threat":       "bruteforce",
				"reason":       "ip_locked_out",
				"minutes_left": minutesLeft,
			},
		})
		return c.Status(fiber.StatusTooManyRequests).JSON(apiError{
			Error: fmt.Sprintf("IP ของคุณถูกระงับการเข้าสู่ระบบชั่วคราวเนื่องจากรหัสผ่านผิดหลายครั้ง (กรุณารออีก %d นาที)", minutesLeft),
			Code:  "ip_temp_blocked",
		})
	}

	var user currentUser
	var passwordHash string
	err = s.db.QueryRow(c.Context(),
		`SELECT id, identifier, display_name, COALESCE(email, ''), COALESCE(avatar_url, ''), password_hash, role, status, password_enabled, points FROM users WHERE LOWER(identifier) = LOWER($1)`,
		identifier,
	).Scan(&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.AvatarURL, &passwordHash, &user.Role, &user.Status, &user.PasswordEnabled, &user.Points)

	// 2. Failed credentials check
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !s.verifyPassword(body.Password, passwordHash)) {
		time.Sleep(250 * time.Millisecond)

		acctKey := accountFailureKey(identifier)
		acctCount, _ := s.redis.Incr(c.Context(), acctKey).Result()
		if acctCount == 1 {
			s.redis.Expire(c.Context(), acctKey, failedLoginWindow)
		}
		if acctCount >= accountFailureAlert && acctCount%accountFailureAlert == 0 {
			s.audit(c, auditEvent{
				Category: "auth",
				Action:   "auth.login",
				Outcome:  "failure",
				Target:   "user",
				TargetID: identifier,
				Metadata: map[string]any{
					"username":      identifier,
					"threat":        "account_targeted",
					"reason":        "account_targeted",
					"attempt_count": acctCount,
				},
			})
		}
		time.Sleep(accountFailureDelay(acctCount))

		failedKey := "failed_login:ip:" + ip
		count, _ := s.redis.Incr(c.Context(), failedKey).Result()
		if count == 1 {
			s.redis.Expire(c.Context(), failedKey, failedLoginWindow)
		}

		if count >= maxFailedLoginAttempts {
			// Trigger 15-minute IP lockout
			s.redis.Set(c.Context(), lockoutKey, "1", ipLockoutDuration)
			s.redis.Del(c.Context(), failedKey)

			s.audit(c, auditEvent{
				Category: "auth",
				Action:   "auth.login",
				Outcome:  "failure",
				Target:   "user",
				TargetID: identifier,
				Metadata: map[string]any{
					"username":      identifier,
					"threat":        "bruteforce",
					"reason":        "bruteforce_limit_reached",
					"attempt_count": count,
				},
			})

			return c.Status(fiber.StatusTooManyRequests).JSON(apiError{
				Error: "คุณกรอกรหัสผ่านผิดครบ 5 ครั้ง IP นี้ถูกพักการเข้าสู่ระบบ 15 นาที เพื่อความปลอดภัย",
				Code:  "bruteforce_blocked",
			})
		}

		s.audit(c, auditEvent{
			Category: "auth",
			Action:   "auth.login",
			Outcome:  "failure",
			Target:   "user",
			TargetID: identifier,
			Metadata: map[string]any{
				"username":      identifier,
				"reason":        "invalid_credentials",
				"attempt_count": count,
			},
		})

		return c.Status(fiber.StatusUnauthorized).JSON(apiError{
			Error: fmt.Sprintf("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (พยายามครั้งที่ %d/%d)", count, maxFailedLoginAttempts),
			Code:  "invalid_login",
		})
	}

	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	// 3. Suspended account check
	if user.Status != "active" {
		s.audit(c, auditEvent{
			Actor:    &user,
			Category: "auth",
			Action:   "auth.login",
			Outcome:  "failure",
			Target:   "user",
			TargetID: strconv.FormatInt(user.ID, 10),
			Metadata: map[string]any{
				"username": user.Username,
				"reason":   "account_suspended",
			},
		})
		return c.Status(fiber.StatusForbidden).JSON(apiError{
			Error: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
			Code:  "account_suspended",
		})
	}

	// 4. Successful login
	failedKey := "failed_login:ip:" + ip
	s.redis.Del(c.Context(), failedKey, lockoutKey, accountFailureKey(identifier))

	user.Permissions = permissionsForRole(user.Role)
	if err := s.createSession(c, &user); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.db.Exec(c.Context(), `UPDATE users SET last_login_at = NOW() WHERE id = $1`, user.ID)
	s.audit(c, auditEvent{
		Actor:    &user,
		Category: "auth",
		Action:   "auth.login",
		Target:   "user",
		TargetID: strconv.FormatInt(user.ID, 10),
	})
	return c.JSON(fiber.Map{"user": user})
}

func (s *server) logout(c *fiber.Ctx) error {
	if token := c.Cookies(s.cfg.cookieName); token != "" {
		hash := tokenHash(token)
		user, _ := s.authenticate(c)
		s.db.Exec(c.Context(), `UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = $1`, hash)
		s.redis.Del(c.Context(), "session:"+hash)
		s.audit(c, auditEvent{Actor: user, Category: "auth", Action: "auth.logout", Target: "session"})
	}
	s.clearSessionCookie(c)
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) me(c *fiber.Ctx) error {
	user, err := s.authenticate(c)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if user == nil {
		return c.JSON(fiber.Map{"authenticated": false, "user": nil})
	}

	// Return only safe, minimal fields to the client.
	// Never expose: internal ID, raw permissions, account status, session ID.
	accessLevel := "member"
	if user.Role == "admin" {
		accessLevel = "admin"
	} else if user.Role == "superadmin" {
		accessLevel = "admin"
	}

	return c.JSON(fiber.Map{
		"authenticated": true,
		"user": fiber.Map{
			"username":        user.Username,
			"displayName":     user.DisplayName,
			"email":           user.Email,
			"avatarUrl":       user.AvatarURL,
			"role":            user.Role,
			"accessLevel":     accessLevel,
			"passwordEnabled": user.PasswordEnabled,
			"points":          user.Points,
		},
	})
}

func validateCredentials(body authRequest) (string, string) {
	identifier := strings.TrimSpace(body.Username)
	length := utf8.RuneCountInString(identifier)
	if length < 4 || length > 30 {
		return "", "ชื่อผู้ใช้ต้องมี 4–30 ตัว"
	}
	for _, char := range identifier {
		isLetter := char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z'
		isNumber := char >= '0' && char <= '9'
		if !isLetter && !isNumber {
			return "", "ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ A–Z และตัวเลข 0–9"
		}
	}
	passwordLength := utf8.RuneCountInString(body.Password)
	if passwordLength < 8 || passwordLength > 128 {
		return "", "รหัสผ่านต้องมี 8–128 ตัวอักษร"
	}
	if message := validatePasswordASCII(body.Password); message != "" {
		return "", message
	}
	return identifier, ""
}

func validatePasswordASCII(password string) string {
	for _, char := range password {
		if char < 0x20 || char > 0x7E {
			return "รหัสผ่านใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และสัญลักษณ์"
		}
	}
	return ""
}

func (s *server) hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, s.cfg.argonIterations, s.cfg.argonMemory, s.cfg.argonParallel, s.cfg.argonKeyLength)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		s.cfg.argonMemory,
		s.cfg.argonIterations,
		s.cfg.argonParallel,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func (s *server) verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var memory, iterations uint32
	var parallel uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallel); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, iterations, memory, parallel, uint32(len(expected)))
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func (s *server) createSession(c *fiber.Ctx, user *currentUser) error {
	if previousToken := c.Cookies(s.cfg.cookieName); previousToken != "" {
		previousHash := tokenHash(previousToken)
		s.db.Exec(c.Context(), `
			UPDATE user_sessions
			SET revoked_at = COALESCE(revoked_at, NOW())
			WHERE token_hash = $1
		`, previousHash)
		s.redis.Del(c.Context(), "session:"+previousHash)
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	hash := tokenHash(token)
	settings, err := s.loadSettings(c.Context())
	if err != nil {
		return err
	}
	ttl := time.Duration(settings.SessionTTLMinutes) * time.Minute
	expiresAt := time.Now().Add(ttl)
	var sessionID int64
	err = s.db.QueryRow(c.Context(), `
		INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
		VALUES ($1,$2,$3,$4,$5) RETURNING id
	`, user.ID, hash, extractRealIP(c), cleanText(c.Get(fiber.HeaderUserAgent), 500), expiresAt).Scan(&sessionID)
	if err != nil {
		return err
	}
	session := sessionData{SessionID: sessionID, UserID: user.ID, Username: user.Username, Role: user.Role}
	value, err := json.Marshal(session)
	if err != nil {
		return err
	}
	if err := s.redis.Set(c.Context(), "session:"+hash, value, ttl).Err(); err != nil {
		s.db.Exec(c.Context(), `DELETE FROM user_sessions WHERE id = $1`, sessionID)
		return err
	}
	c.Cookie(&fiber.Cookie{
		Name:     s.cfg.cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HTTPOnly: true,
		Secure:   s.cfg.cookieSecure,
		SameSite: fiber.CookieSameSiteStrictMode,
	})
	return nil
}

func (s *server) clearSessionCookie(c *fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     s.cfg.cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HTTPOnly: true,
		Secure:   s.cfg.cookieSecure,
		SameSite: fiber.CookieSameSiteStrictMode,
	})
}

func sessionKey(token string) string {
	return "session:" + tokenHash(token)
}
