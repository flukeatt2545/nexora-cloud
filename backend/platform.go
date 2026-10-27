package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

const currentUserKey = "currentUser"

type currentUser struct {
	ID              int64    `json:"id"`
	SessionID       int64    `json:"-"`
	Username        string   `json:"username"`
	DisplayName     string   `json:"displayName"`
	Email           string   `json:"email"`
	AvatarURL       string   `json:"avatarUrl"`
	Role            string   `json:"role"`
	Status          string   `json:"status"`
	PasswordEnabled bool     `json:"passwordEnabled"`
	Points          float64  `json:"points"`
	Permissions     []string `json:"permissions"`
}

type publicSettings struct {
	BrandName           string   `json:"brandName"`
	SiteTitle           string   `json:"siteTitle"`
	SiteTitleMode       string   `json:"siteTitleMode"`
	SiteDescription     string   `json:"siteDescription"`
	OGTitle             string   `json:"ogTitle"`
	OGDescription       string   `json:"ogDescription"`
	OGImageURL          string   `json:"ogImageUrl"`
	OGCardType          string   `json:"ogCardType"`
	OGColor             string   `json:"ogColor"`
	PrimaryColor        string   `json:"primaryColor"`
	ThemeMode           string   `json:"themeMode"`
	UIShape             string   `json:"uiShape"` // "round" or "square"; saved by updateAdminUIShape
	LogoURL             string   `json:"logoUrl"`
	FaviconURL          string   `json:"faviconUrl"`
	AuthBackgroundURL   string   `json:"authBackgroundUrl"`
	AuthBackgroundTint  bool     `json:"authBackgroundTintEnabled"`
	LoginTitle          string   `json:"loginTitle"`
	LoginSubtitle       string   `json:"loginSubtitle"`
	RegisterTitle       string   `json:"registerTitle"`
	RegisterSubtitle    string   `json:"registerSubtitle"`
	LocalLoginEnabled   bool     `json:"localLoginEnabled"`
	RegistrationEnabled bool     `json:"registrationEnabled"`
	StoreSectionEnabled bool     `json:"storeSectionEnabled"`
	StoreEnabled        bool     `json:"storeEnabled"`
	StoreClosedMessage  string   `json:"storeClosedMessage"`
	QuickActionsEnabled bool     `json:"quickActionsEnabled"`
	FooterEnabled       bool     `json:"footerEnabled"`
	DiscordEnabled      bool     `json:"discordEnabled"`
	GoogleEnabled       bool     `json:"googleEnabled"`
	GitHubEnabled       bool     `json:"githubEnabled"`
	SessionTTLMinutes   int      `json:"sessionTtlMinutes,omitempty"` // whole minutes, rounded up; kept for older web builds
	SessionTTLSeconds   int      `json:"sessionTtlSeconds,omitempty"`
	DiscordConfigured   bool     `json:"discordConfigured"`
	GoogleConfigured    bool     `json:"googleConfigured"`
	GitHubConfigured    bool     `json:"githubConfigured"`
	DiscordClientID     string   `json:"discordClientId,omitempty"`
	GoogleClientID      string   `json:"googleClientId,omitempty"`
	GitHubClientID      string   `json:"githubClientId,omitempty"`
	DiscordClientSecret string   `json:"discordClientSecret,omitempty"`
	GoogleClientSecret  string   `json:"googleClientSecret,omitempty"`
	GitHubClientSecret  string   `json:"githubClientSecret,omitempty"`
	ClearDiscordOAuth   bool     `json:"clearDiscordOAuth,omitempty"`
	ClearGoogleOAuth    bool     `json:"clearGoogleOAuth,omitempty"`
	ClearGitHubOAuth    bool     `json:"clearGitHubOAuth,omitempty"`
	WebhookEnabled      bool     `json:"webhookEnabled,omitempty"`
	WebhookEvents       []string `json:"webhookEvents,omitempty"`
	WebhookConfigured   bool     `json:"webhookConfigured,omitempty"`
	DiscordWebhookURL   string   `json:"discordWebhookUrl,omitempty"`
	ClearDiscordWebhook bool     `json:"clearDiscordWebhook,omitempty"`
}

type GeoLocation struct {
	Country     string  `json:"country,omitempty"`
	CountryCode string  `json:"countryCode,omitempty"`
	City        string  `json:"city,omitempty"`
	Region      string  `json:"region,omitempty"`
	Lat         float64 `json:"lat,omitempty"`
	Lon         float64 `json:"lon,omitempty"`
	ISP         string  `json:"isp,omitempty"`
}

type auditEvent struct {
	Actor     *currentUser
	Category  string
	Action    string
	Target    string
	TargetID  string
	Outcome   string
	Metadata  map[string]any
	IPAddress string
	LanIP     string
	UserAgent string
	Geo       *GeoLocation
	// TargetName is a readable name for TargetID, filled in only for the security webhook.
	TargetName string
}

var (
	geoMu     sync.RWMutex
	geoCache  = make(map[string]GeoLocation)
	geoClient = &http.Client{Timeout: 3 * time.Second}
)

func isPrivateIP(ipStr string) bool {
	ip := net.ParseIP(strings.TrimSpace(ipStr))
	if ip == nil {
		return true
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

func extractClientLAN(c *fiber.Ctx) string {
	if c == nil {
		return ""
	}
	lan := strings.TrimSpace(c.Get("X-Client-LAN-IP"))
	if lan == "" {
		lan = strings.TrimSpace(c.Get("X-Local-IP"))
	}
	if lan != "" {
		if host, _, err := net.SplitHostPort(lan); err == nil {
			lan = host
		}
		if parsed := net.ParseIP(lan); parsed != nil {
			return strings.Clone(parsed.String())
		}
	}
	return ""
}

func extractRealIP(c *fiber.Ctx) string {
	if c == nil {
		return ""
	}
	headers := []string{"CF-Connecting-IP", "True-Client-IP", "X-Real-IP", "X-Forwarded-For", "Forwarded"}
	var firstPrivate string

	for _, header := range headers {
		raw := strings.TrimSpace(c.Get(header))
		if raw == "" {
			continue
		}
		parts := strings.Split(raw, ",")
		for _, part := range parts {
			ip := strings.TrimSpace(part)
			if ip == "" {
				continue
			}
			if host, _, err := net.SplitHostPort(ip); err == nil {
				ip = host
			}
			if parsed := net.ParseIP(ip); parsed != nil {
				if !isPrivateIP(ip) {
					return strings.Clone(parsed.String())
				}
				if firstPrivate == "" {
					firstPrivate = parsed.String()
				}
			}
		}
	}

	if firstPrivate != "" {
		return strings.Clone(firstPrivate)
	}
	ipStr := strings.TrimSpace(c.IP())
	if parsed := net.ParseIP(ipStr); parsed != nil {
		return strings.Clone(parsed.String())
	}
	return strings.Clone(ipStr)
}

func lookupGeo(ip string, c *fiber.Ctx) GeoLocation {
	ip = strings.Clone(strings.TrimSpace(ip))
	if ip == "" || isPrivateIP(ip) {
		return GeoLocation{
			Country: "เครือข่ายภายใน",
			City:    "Local Network",
		}
	}

	// 1. Check in-memory mutex cache
	geoMu.RLock()
	if cached, ok := geoCache[ip]; ok {
		geoMu.RUnlock()
		return cached
	}
	geoMu.RUnlock()

	// 2. Fetch from ip-api.com (with ISP & location details)
	resp, err := geoClient.Get(fmt.Sprintf("http://ip-api.com/json/%s?fields=status,country,countryCode,regionName,city,lat,lon,isp,org", url.PathEscape(ip)))
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == 200 {
			var res struct {
				Status      string  `json:"status"`
				Country     string  `json:"country"`
				CountryCode string  `json:"countryCode"`
				City        string  `json:"city"`
				RegionName  string  `json:"regionName"`
				Lat         float64 `json:"lat"`
				Lon         float64 `json:"lon"`
				ISP         string  `json:"isp"`
				Org         string  `json:"org"`
			}
			if json.NewDecoder(resp.Body).Decode(&res) == nil && res.Status == "success" {
				ispName := res.ISP
				if ispName == "" {
					ispName = res.Org
				}
				geo := GeoLocation{
					Country:     strings.Clone(res.Country),
					CountryCode: strings.Clone(res.CountryCode),
					City:        strings.Clone(res.City),
					Region:      strings.Clone(res.RegionName),
					Lat:         res.Lat,
					Lon:         res.Lon,
					ISP:         strings.Clone(ispName),
				}
				geoMu.Lock()
				if len(geoCache) > 10000 {
					geoCache = make(map[string]GeoLocation)
				}
				geoCache[ip] = geo
				geoMu.Unlock()
				return geo
			}
		}
	}

	// 3. Fallback to Cloudflare HTTP headers if available
	if c != nil {
		country := strings.Clone(strings.TrimSpace(c.Get("CF-IPCountry")))
		city := strings.Clone(strings.TrimSpace(c.Get("CF-IPCity")))
		latStr := strings.TrimSpace(c.Get("CF-IPLatitude"))
		lonStr := strings.TrimSpace(c.Get("CF-IPLongitude"))
		if country != "" || latStr != "" {
			lat, _ := strconv.ParseFloat(latStr, 64)
			lon, _ := strconv.ParseFloat(lonStr, 64)
			return GeoLocation{
				Country: country,
				City:    city,
				Lat:     lat,
				Lon:     lon,
			}
		}
	}

	return GeoLocation{
		Country: "ไม่ทราบประเทศ",
		City:    "ไม่ทราบตำแหน่ง",
	}
}

func permissionsForRole(role string) []string {
	permissions, ok := rolePermissions[role]
	if !ok {
		return rolePermissions["user"]
	}
	return permissions
}

func (s *server) authenticate(c *fiber.Ctx) (*currentUser, error) {
	token := c.Cookies(s.cfg.cookieName)
	if token == "" {
		return nil, nil
	}
	hash := tokenHash(token)
	if exists, err := s.redis.Exists(c.Context(), "session:"+hash).Result(); err != nil || exists == 0 {
		s.clearSessionCookie(c)
		return nil, nil
	}
	var user currentUser
	err := s.db.QueryRow(c.Context(), `
		SELECT u.id, s.id, u.identifier, u.display_name, COALESCE(u.email, ''),
		       COALESCE(u.avatar_url, ''), u.role, u.status, u.password_enabled, u.points
		FROM user_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
	`, hash).Scan(&user.ID, &user.SessionID, &user.Username, &user.DisplayName, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.PasswordEnabled, &user.Points)
	if errors.Is(err, pgx.ErrNoRows) || user.Status != "active" {
		s.redis.Del(c.Context(), "session:"+hash)
		s.clearSessionCookie(c)
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	user.Permissions = permissionsForRole(user.Role)
	// A request the page sends by itself while nobody touches it (refreshing a list, polling a
	// console) carries X-Nexora-Idle and must not keep the session alive, or "logged out after
	// N idle minutes" would never happen with such a page open.
	if c.Get(sessionIdleHeader) != "1" {
		s.extendSession(c, &user, hash, token, false)
	}
	return &user, nil
}

const sessionIdleHeader = "X-Nexora-Idle"

// extendSession moves the session's end to now + the configured idle time. It writes at most
// once per minute (or tenth of the idle time) unless forced, and re-sends the cookie each time:
// the cookie's own lifetime was fixed at login and used to end a busy session early.
func (s *server) extendSession(c *fiber.Ctx, user *currentUser, hash, token string, force bool) {
	var ttlSeconds int
	err := s.db.QueryRow(c.Context(), `
		UPDATE user_sessions s
		SET last_seen_at = NOW(),
		    expires_at = NOW() + make_interval(secs => t.ttl)
		FROM (SELECT COALESCE((SELECT session_ttl_seconds FROM system_settings WHERE id = 1), 1800)::float8 AS ttl) t
		WHERE s.id = $1
		  AND ($2 OR s.last_seen_at < NOW() - LEAST(INTERVAL '5 minutes', make_interval(secs => t.ttl / 10)))
		RETURNING t.ttl::int
	`, user.SessionID, force).Scan(&ttlSeconds)
	if err != nil || ttlSeconds <= 0 {
		return
	}
	ttl := time.Duration(ttlSeconds) * time.Second
	s.redis.Expire(c.Context(), "session:"+hash, ttl)
	c.Cookie(&fiber.Cookie{
		Name:     s.cfg.cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		HTTPOnly: true,
		Secure:   s.cfg.cookieSecure,
		SameSite: fiber.CookieSameSiteStrictMode,
	})
}

// sessionStatus tells the page when the session ends, so it can warn before and show a notice
// after. It never extends the session itself.
func (s *server) sessionStatus(c *fiber.Ctx) error {
	c.Request().Header.Set(sessionIdleHeader, "1")
	user, err := s.authenticate(c)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "เซสชันหมดอายุแล้ว", Code: "unauthenticated"})
	}
	return s.writeSessionStatus(c, user)
}

// extendSessionNow is the "stay signed in" button and the page's report that someone is using it.
func (s *server) extendSessionNow(c *fiber.Ctx) error {
	c.Request().Header.Set(sessionIdleHeader, "1")
	user, err := s.authenticate(c)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "เซสชันหมดอายุแล้ว", Code: "unauthenticated"})
	}
	token := c.Cookies(s.cfg.cookieName)
	s.extendSession(c, user, tokenHash(token), token, true)
	return s.writeSessionStatus(c, user)
}

func (s *server) writeSessionStatus(c *fiber.Ctx, user *currentUser) error {
	var expiresAt time.Time
	var ttlSeconds int
	if err := s.db.QueryRow(c.Context(), `
		SELECT s.expires_at, COALESCE((SELECT session_ttl_seconds FROM system_settings WHERE id = 1), 1800)
		FROM user_sessions s WHERE s.id = $1
	`, user.SessionID).Scan(&expiresAt, &ttlSeconds); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"expiresAt": expiresAt, "now": time.Now(), "ttlSeconds": ttlSeconds, "ttlMinutes": (ttlSeconds + 59) / 60})
}

func (s *server) requireUser(c *fiber.Ctx) error {
	user, err := s.authenticate(c)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "กรุณาเข้าสู่ระบบ", Code: "unauthenticated"})
	}
	c.Locals(currentUserKey, user)
	return c.Next()
}

func requirePasswordReady(c *fiber.Ctx) error {
	user := current(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "กรุณาเข้าสู่ระบบ", Code: "unauthenticated"})
	}
	if !user.PasswordEnabled {
		return c.Status(fiber.StatusPreconditionRequired).JSON(apiError{Error: "กรุณาตั้งรหัสผ่านก่อนใช้งาน", Code: "password_setup_required"})
	}
	return c.Next()
}

func current(c *fiber.Ctx) *currentUser {
	user, _ := c.Locals(currentUserKey).(*currentUser)
	return user
}

func requireRoles(roles ...string) fiber.Handler {
	allowed := map[string]bool{}
	for _, role := range roles {
		allowed[role] = true
	}
	return func(c *fiber.Ctx) error {
		user := current(c)
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "กรุณาเข้าสู่ระบบ", Code: "unauthenticated"})
		}
		if !allowed[user.Role] {
			return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์ดำเนินการนี้", Code: "forbidden"})
		}
		return c.Next()
	}
}

func (s *server) loadSettings(ctx context.Context) (publicSettings, error) {
	var settings publicSettings
	err := s.db.QueryRow(ctx, `
		SELECT brand_name, site_title, site_description, primary_color, theme_mode, logo_url, favicon_url,
		       auth_background_url, login_title, login_subtitle, register_title, register_subtitle,
		       local_login_enabled, registration_enabled, store_section_enabled, quick_actions_enabled, footer_enabled, discord_enabled, google_enabled,
		       github_enabled, session_ttl_seconds, site_title_mode, auth_background_tint_enabled,
		       COALESCE(og_title, ''), COALESCE(og_description, ''), COALESCE(og_image_url, ''),
		       COALESCE(og_card_type, 'summary_large_image'), COALESCE(og_color, '#5e5ee6'),
		       store_enabled, store_closed_message, ui_shape
		FROM system_settings WHERE id = 1
	`).Scan(
		&settings.BrandName, &settings.SiteTitle, &settings.SiteDescription, &settings.PrimaryColor, &settings.ThemeMode,
		&settings.LogoURL, &settings.FaviconURL, &settings.AuthBackgroundURL, &settings.LoginTitle,
		&settings.LoginSubtitle, &settings.RegisterTitle, &settings.RegisterSubtitle,
		&settings.LocalLoginEnabled, &settings.RegistrationEnabled, &settings.StoreSectionEnabled, &settings.QuickActionsEnabled, &settings.FooterEnabled, &settings.DiscordEnabled,
		&settings.GoogleEnabled, &settings.GitHubEnabled, &settings.SessionTTLSeconds, &settings.SiteTitleMode, &settings.AuthBackgroundTint,
		&settings.OGTitle, &settings.OGDescription, &settings.OGImageURL, &settings.OGCardType, &settings.OGColor,
		&settings.StoreEnabled, &settings.StoreClosedMessage, &settings.UIShape,
	)
	settings.SessionTTLMinutes = (settings.SessionTTLSeconds + 59) / 60
	settings.DiscordConfigured = s.oauthConfigured(ctx, "discord")
	settings.GoogleConfigured = s.oauthConfigured(ctx, "google")
	settings.GitHubConfigured = s.oauthConfigured(ctx, "github")
	return settings, err
}

func (s *server) sanitizeAssetURL(c *fiber.Ctx, rawURL string) string {
	if strings.TrimSpace(rawURL) == "" {
		return ""
	}
	if strings.HasPrefix(rawURL, "http://localhost:8088/assets") {
		reqHost := strings.Split(strings.TrimSpace(c.Get("X-Forwarded-Host", c.Hostname())), ":")[0]
		if reqHost != "" && !strings.Contains(reqHost, "localhost") && !strings.Contains(reqHost, "127.0.0.1") {
			return strings.Replace(rawURL, "http://localhost:8088/assets", "https://"+reqHost+"/assets", 1)
		}
	}
	if strings.HasPrefix(rawURL, "http://") && !strings.Contains(rawURL, "localhost") && !strings.Contains(rawURL, "127.0.0.1") {
		return "https://" + strings.TrimPrefix(rawURL, "http://")
	}
	return rawURL
}

func (s *server) publicSettingsHandler(c *fiber.Ctx) error {
	settings, err := s.loadSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	settings.LogoURL = s.sanitizeAssetURL(c, settings.LogoURL)
	settings.FaviconURL = s.sanitizeAssetURL(c, settings.FaviconURL)
	settings.AuthBackgroundURL = s.sanitizeAssetURL(c, settings.AuthBackgroundURL)
	settings.OGImageURL = s.sanitizeAssetURL(c, settings.OGImageURL)
	settings.SessionTTLMinutes = 0
	settings.SessionTTLSeconds = 0
	settings.WebhookEnabled = false
	settings.WebhookEvents = nil
	settings.WebhookConfigured = false
	settings.DiscordWebhookURL = ""
	settings.ClearDiscordWebhook = false
	settings.DiscordClientID = ""
	settings.GoogleClientID = ""
	settings.GitHubClientID = ""
	settings.DiscordClientSecret = ""
	settings.GoogleClientSecret = ""
	settings.GitHubClientSecret = ""
	settings.ClearDiscordOAuth = false
	settings.ClearGoogleOAuth = false
	settings.ClearGitHubOAuth = false
	return c.JSON(settings)
}

func (s *server) audit(c *fiber.Ctx, event auditEvent) {
	if event.IPAddress == "" && c != nil {
		event.IPAddress = extractRealIP(c)
	}
	if event.LanIP == "" && c != nil {
		event.LanIP = extractClientLAN(c)
	}
	if event.UserAgent == "" && c != nil {
		event.UserAgent = strings.Clone(c.Get(fiber.HeaderUserAgent))
	}
	if event.Outcome == "" {
		event.Outcome = "success"
	}

	geo := lookupGeo(event.IPAddress, c)
	event.Geo = &geo

	if event.Metadata == nil {
		event.Metadata = map[string]any{}
	}
	event.Metadata["geo"] = geo
	event.Metadata["realIP"] = event.IPAddress
	if event.LanIP != "" {
		event.Metadata["lanIP"] = event.LanIP
	}
	event.Metadata["device"] = parseUserAgent(event.UserAgent)

	metadata, _ := json.Marshal(event.Metadata)
	var actorID any
	var username, role string
	if event.Actor != nil {
		actorID = event.Actor.ID
		username = event.Actor.Username
		role = event.Actor.Role
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := s.db.Exec(ctx, `
		INSERT INTO audit_logs
		    (actor_user_id, actor_username, actor_role, category, action, target_type,
		     target_id, outcome, ip_address, user_agent, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, actorID, username, role, event.Category, event.Action, event.Target, event.TargetID,
		event.Outcome, event.IPAddress, event.UserAgent, metadata)
	if err != nil {
		fmt.Printf("audit write failed: %v\n", err)
		return
	}
	go s.dispatchWebhook(event)
	if event.Category == "mail" {
		go s.dispatchMailLog(event)
	}
}

func (s *server) startAuditCleanup(ctx context.Context) {
	cleanup := func() {
		if _, err := s.db.Exec(ctx, `DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '180 days'`); err != nil {
			fmt.Printf("audit cleanup failed: %v\n", err)
		}
	}
	cleanup()
	ticker := time.NewTicker(24 * time.Hour)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanup()
			}
		}
	}()
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func parseLimit(c *fiber.Ctx, fallback, maximum int) int {
	value, err := strconv.Atoi(c.Query("limit"))
	if err != nil || value < 1 {
		return fallback
	}
	if value > maximum {
		return maximum
	}
	return value
}

func cleanText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) > maximum {
		return string([]rune(value)[:maximum])
	}
	return value
}
