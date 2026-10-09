package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Routes the Discord mail bot calls for one member: create a mailbox, move or mark messages,
// app passwords and new-mail DMs. The member is the Discord user in X-Bot-Actor-Discord-Id.

type mailBotSettings struct {
	SelfServiceEnabled  bool  `json:"selfServiceEnabled"`
	MaxMailboxesPerUser int   `json:"maxMailboxesPerUser"`
	QuotaBytes          int64 `json:"quotaBytes"`
}

const (
	mailBotDailyCreateLimit  = 3
	mailBotMaxAppPasswords   = 10
	mailBotMinQuotaBytes     = 10 * 1024 * 1024
	mailBotMaxQuotaBytes     = 100 * 1024 * 1024 * 1024
	mailBotMaxMailboxesLimit = 50
)

// Addresses members cannot take on the shared platform domain.
var mailBotReservedLocals = map[string]bool{
	"admin": true, "administrator": true, "postmaster": true, "abuse": true, "root": true,
	"noreply": true, "no-reply": true, "support": true, "info": true, "webmaster": true,
	"hostmaster": true, "security": true, "billing": true, "mailer-daemon": true, "nkn": true, "nexora": true,
}

func (s *server) loadMailBotSettings(ctx context.Context) (mailBotSettings, error) {
	settings := mailBotSettings{SelfServiceEnabled: true, MaxMailboxesPerUser: 3, QuotaBytes: mailDefaultQuota}
	err := s.db.QueryRow(ctx, `SELECT self_service_enabled,max_mailboxes_per_user,self_service_quota_bytes FROM mail_bot_settings WHERE singleton`).
		Scan(&settings.SelfServiceEnabled, &settings.MaxMailboxesPerUser, &settings.QuotaBytes)
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, nil
	}
	return settings, err
}

// botMailActor checks the bot secret and returns the Discord user the bot is acting for.
func (s *server) botMailActor(c *fiber.Ctx) (string, error) {
	if err := s.verifyBotSecret(c); err != nil {
		return "", err
	}
	discordID := s.botMailActorID(c)
	if !validDiscordSnowflake(discordID) {
		return "", fiber.NewError(fiber.StatusBadRequest, "ไม่พบผู้ใช้ Discord")
	}
	return discordID, nil
}

// botMailSiteUser returns the active site account linked to a Discord user, or nil when there is none.
func (s *server) botMailSiteUser(ctx context.Context, discordID string) (*currentUser, error) {
	var user currentUser
	err := s.db.QueryRow(ctx, `
		SELECT u.id,u.identifier,u.display_name,u.role,u.status
		FROM oauth_accounts oa JOIN users u ON u.id=oa.user_id
		WHERE oa.provider='discord' AND oa.provider_user_id=$1 AND u.status='active'
	`, discordID).Scan(&user.ID, &user.Username, &user.DisplayName, &user.Role, &user.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// botMailRequireSiteUser is for actions that need a site account: owning a mailbox or holding a password.
func (s *server) botMailRequireSiteUser(c *fiber.Ctx, discordID string) (*currentUser, error) {
	user, err := s.botMailSiteUser(c.Context(), discordID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, fiber.NewError(fiber.StatusConflict, "ล็อกอินเว็บด้วย Discord ก่อน แล้วลองอีกครั้ง")
	}
	return user, nil
}

// botMailAccessible is botMailAccessibleMailbox with a 404 when the member has no access.
func (s *server) botMailAccessible(c *fiber.Ctx, discordID, mailboxPublic string) (int64, string, error) {
	if !validMailboxPublicID(mailboxPublic) {
		return 0, "", fiber.NewError(fiber.StatusNotFound, "ไม่พบกล่องเมลนี้")
	}
	mailboxID, address, err := s.botMailAccessibleMailbox(c.Context(), discordID, mailboxPublic)
	if err != nil {
		return 0, "", err
	}
	if mailboxID == 0 {
		return 0, "", fiber.NewError(fiber.StatusNotFound, "ไม่พบกล่องเมลนี้")
	}
	return mailboxID, address, nil
}

func (s *server) botMailUpdateMessage(c *fiber.Ctx) error {
	discordID, err := s.botMailActor(c)
	if err != nil {
		return err
	}
	var input struct {
		MailboxID string `json:"mailboxId"`
		Read      *bool  `json:"read"`
		Folder    string `json:"folder"`
	}
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	messageID := strings.TrimSpace(c.Params("id"))
	if !validMailMessageID(messageID) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบข้อความนี้")
	}
	if input.Folder != "" && input.Folder != "inbox" && input.Folder != "trash" {
		return fiber.NewError(fiber.StatusBadRequest, "ย้ายได้เฉพาะกล่องเข้าและถังขยะ")
	}
	if input.Read == nil && input.Folder == "" {
		return fiber.NewError(fiber.StatusBadRequest, "ไม่มีอะไรให้เปลี่ยน")
	}
	mailboxID, address, err := s.botMailAccessible(c, discordID, strings.TrimSpace(input.MailboxID))
	if err != nil {
		return err
	}
	accountID, err := s.stalwartAccountForMailbox(c.Context(), mailboxID)
	if err != nil {
		return err
	}
	if accountID == "" {
		return fiber.NewError(fiber.StatusConflict, "กล่องนี้ยังจัดการผ่านบอทไม่ได้ ใช้ Webmail แทน")
	}
	err = s.stalwartSetMessage(c.Context(), accountID, messageID, input.Read, input.Folder)
	if errors.Is(err, errMailFolderMissing) {
		return fiber.NewError(fiber.StatusConflict, "ไม่พบโฟลเดอร์ปลายทางในกล่องนี้")
	}
	if errors.Is(err, errStalwartNotFound) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบเมลนี้ อาจถูกลบไปแล้ว")
	}
	if err != nil {
		return err
	}
	if input.Folder != "" {
		s.audit(c, auditEvent{Category: "mail", Action: "mail.discord.message_moved", Target: "mailbox", TargetID: input.MailboxID,
			Metadata: map[string]any{"actorDiscordId": discordID, "address": address, "folder": input.Folder}})
	}
	return c.SendStatus(204)
}

type botMailDomainOption struct {
	ID     string `json:"id"`
	Domain string `json:"domain"`
	Shared bool   `json:"shared"`
}

// botMailCreatableDomains lists the domains a member may add a mailbox to: the shared platform
// domain when self-service is on, and active domains they own.
func (s *server) botMailCreatableDomains(ctx context.Context, userID int64, settings mailBotSettings) ([]botMailDomainOption, error) {
	rows, err := s.db.Query(ctx, `
		SELECT public_id,domain,kind='platform'
		FROM mail_domains
		WHERE deleted_at IS NULL AND status='active'
		  AND ((kind='platform' AND $2) OR owner_user_id=$1)
		ORDER BY kind='platform' DESC, domain
		LIMIT 25
	`, userID, settings.SelfServiceEnabled)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []botMailDomainOption{}
	for rows.Next() {
		var item botMailDomainOption
		if err := rows.Scan(&item.ID, &item.Domain, &item.Shared); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// botMailSharedMailboxCount counts the mailboxes a member owns on the shared platform domain.
func (s *server) botMailSharedMailboxCount(ctx context.Context, userID int64) (int, error) {
	var count int
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM mailboxes m
		JOIN mail_domains d ON d.id=m.domain_id
		JOIN mailbox_members mm ON mm.mailbox_id=m.id AND mm.role='owner'
		WHERE mm.user_id=$1 AND d.kind='platform' AND m.deleted_at IS NULL
	`, userID).Scan(&count)
	return count, err
}

func (s *server) botMailCreateOptions(c *fiber.Ctx) error {
	discordID, err := s.botMailActor(c)
	if err != nil {
		return err
	}
	settings, err := s.loadMailBotSettings(c.Context())
	if err != nil {
		return err
	}
	user, err := s.botMailSiteUser(c.Context(), discordID)
	if err != nil {
		return err
	}
	if user == nil {
		return c.JSON(fiber.Map{"linked": false, "enabled": settings.SelfServiceEnabled, "domains": []botMailDomainOption{}})
	}
	domains, err := s.botMailCreatableDomains(c.Context(), user.ID, settings)
	if err != nil {
		return err
	}
	used, err := s.botMailSharedMailboxCount(c.Context(), user.ID)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{
		"linked": true, "enabled": settings.SelfServiceEnabled, "domains": domains,
		"used": used, "limit": settings.MaxMailboxesPerUser, "quotaBytes": settings.QuotaBytes,
	})
}

func (s *server) botMailCreateMailbox(c *fiber.Ctx) error {
	discordID, err := s.botMailActor(c)
	if err != nil {
		return err
	}
	var input struct {
		DomainID    string `json:"domainId"`
		LocalPart   string `json:"localPart"`
		DisplayName string `json:"displayName"`
	}
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	user, err := s.botMailRequireSiteUser(c, discordID)
	if err != nil {
		return err
	}
	local := normalizeMailLocal(input.LocalPart)
	if local == "" {
		return fiber.NewError(fiber.StatusBadRequest, "ชื่ออีเมลใช้ได้เฉพาะ a-z 0-9 . _ + - และขึ้นต้น/ลงท้ายด้วยตัวอักษรหรือตัวเลข")
	}
	displayName := clipDiscordText(input.DisplayName, 80)
	settings, err := s.loadMailBotSettings(c.Context())
	if err != nil {
		return err
	}
	domains, err := s.botMailCreatableDomains(c.Context(), user.ID, settings)
	if err != nil {
		return err
	}
	var chosen *botMailDomainOption
	for i := range domains {
		if domains[i].ID == strings.TrimSpace(input.DomainID) {
			chosen = &domains[i]
		}
	}
	if chosen == nil {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบโดเมนที่สร้างเมลได้")
	}

	// One create at a time per member, so two quick clicks cannot both pass the limit check.
	lockKey := "mailbot:create:" + discordID
	if ok, err := s.redis.SetNX(c.Context(), lockKey, "1", 30*time.Second).Result(); err != nil || !ok {
		return fiber.NewError(fiber.StatusTooManyRequests, "กำลังสร้างกล่องก่อนหน้าอยู่ รอสักครู่")
	}
	defer s.redis.Del(context.Background(), lockKey)

	quota := mailDefaultQuota
	if chosen.Shared {
		if mailBotReservedLocals[local] {
			return fiber.NewError(fiber.StatusBadRequest, "ชื่อนี้สงวนไว้สำหรับระบบ เลือกชื่ออื่น")
		}
		used, err := s.botMailSharedMailboxCount(c.Context(), user.ID)
		if err != nil {
			return err
		}
		if used >= settings.MaxMailboxesPerUser {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "สร้างครบจำนวนที่ได้แล้ว", Code: "mailbox_limit_reached"})
		}
		var today int
		if err := s.db.QueryRow(c.Context(), `
			SELECT COUNT(*) FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id
			WHERE m.created_by=$1 AND d.kind='platform' AND m.created_at > NOW() - INTERVAL '24 hours'
		`, user.ID).Scan(&today); err != nil {
			return err
		}
		if today >= mailBotDailyCreateLimit {
			return fiber.NewError(fiber.StatusTooManyRequests, "วันนี้สร้างครบแล้ว ลองใหม่พรุ่งนี้")
		}
		quota = settings.QuotaBytes
	}

	var domainID int64
	if err := s.db.QueryRow(c.Context(), `SELECT id FROM mail_domains WHERE public_id=$1`, chosen.ID).Scan(&domainID); err != nil {
		return err
	}
	created, err := s.createMailboxRecord(c.Context(), domainID, chosen.Domain, local, displayName, user.ID, user.ID, quota)
	if errors.Is(err, errMailAddressTaken) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ที่อยู่นี้มีคนใช้แล้ว เลือกชื่ออื่น", Code: "mail_address_taken"})
	}
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: user, Category: "mail", Action: "mail.discord.mailbox_created", Target: "mailbox", TargetID: created.PublicID,
		Metadata: map[string]any{"actorDiscordId": discordID, "address": created.Address, "provisionState": created.ProvisionState}})
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id": created.PublicID, "address": created.Address, "provisionState": created.ProvisionState,
	})
}

// botMailMemberMailbox is for app passwords: the member must belong to the mailbox through their site account.
func (s *server) botMailMemberMailbox(c *fiber.Ctx, discordID string) (*currentUser, int64, string, error) {
	user, err := s.botMailRequireSiteUser(c, discordID)
	if err != nil {
		return nil, 0, "", err
	}
	mailboxID, local, domain, _, err := s.mailboxAccess(c.Context(), c.Params("id"), user.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, "", fiber.NewError(fiber.StatusNotFound, "ไม่พบกล่องเมลนี้ในบัญชีเว็บของคุณ")
	}
	if err != nil {
		return nil, 0, "", err
	}
	return user, mailboxID, local + "@" + domain, nil
}

func (s *server) botMailListAppPasswords(c *fiber.Ctx) error {
	discordID, err := s.botMailActor(c)
	if err != nil {
		return err
	}
	_, mailboxID, address, err := s.botMailMemberMailbox(c, discordID)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT public_id,description,created_at FROM mail_device_credentials
		WHERE mailbox_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 25
	`, mailboxID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, description string
		var createdAt time.Time
		if err := rows.Scan(&id, &description, &createdAt); err != nil {
			return err
		}
		items = append(items, fiber.Map{"id": id, "description": description, "createdAt": createdAt})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"address": address, "items": items, "max": mailBotMaxAppPasswords})
}

func (s *server) botMailCreateAppPassword(c *fiber.Ctx) error {
	discordID, err := s.botMailActor(c)
	if err != nil {
		return err
	}
	user, mailboxID, address, err := s.botMailMemberMailbox(c, discordID)
	if err != nil {
		return err
	}
	var input struct {
		Description string `json:"description"`
	}
	_ = c.BodyParser(&input)
	var active int
	if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM mail_device_credentials WHERE mailbox_id=$1 AND revoked_at IS NULL`, mailboxID).Scan(&active); err != nil {
		return err
	}
	if active >= mailBotMaxAppPasswords {
		return fiber.NewError(fiber.StatusConflict, "มีรหัสผ่านแอปครบ 10 อันแล้ว ยกเลิกอันที่ไม่ใช้ก่อน")
	}
	created, err := s.createDevicePassword(c.Context(), mailboxID, user.ID, clipDiscordText(input.Description, 60))
	var syncErr stalwartSyncError
	if errors.As(err, &syncErr) {
		return fiber.NewError(fiber.StatusBadGateway, "เซิร์ฟเวอร์เมลสร้างรหัสผ่านไม่สำเร็จ ลองใหม่ภายหลัง")
	}
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: user, Category: "mail", Action: "mail.discord.app_password_created", Target: "mailbox", TargetID: c.Params("id"),
		Metadata: map[string]any{"actorDiscordId": discordID, "address": address}})
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id": created.PublicID, "address": address, "password": created.Secret,
		"host": s.mailDeviceHost(), "imapPort": 993, "smtpPort": 465,
	})
}

func (s *server) botMailRevokeAppPassword(c *fiber.Ctx) error {
	discordID, err := s.botMailActor(c)
	if err != nil {
		return err
	}
	user, mailboxID, address, err := s.botMailMemberMailbox(c, discordID)
	if err != nil {
		return err
	}
	err = s.revokeDevicePassword(c.Context(), mailboxID, c.Params("credentialId"))
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบรหัสผ่านนี้")
	}
	var syncErr stalwartSyncError
	if errors.As(err, &syncErr) {
		return fiber.NewError(fiber.StatusBadGateway, "เซิร์ฟเวอร์เมลยกเลิกรหัสผ่านไม่สำเร็จ ลองใหม่ภายหลัง")
	}
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: user, Category: "mail", Action: "mail.discord.app_password_revoked", Target: "mailbox", TargetID: c.Params("id"),
		Metadata: map[string]any{"actorDiscordId": discordID, "address": address}})
	return c.SendStatus(204)
}

func (s *server) botMailSetNotify(c *fiber.Ctx) error {
	discordID, err := s.botMailActor(c)
	if err != nil {
		return err
	}
	var input struct {
		MailboxID string `json:"mailboxId"`
		Enabled   bool   `json:"enabled"`
	}
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	mailboxID, address, err := s.botMailAccessible(c, discordID, strings.TrimSpace(input.MailboxID))
	if err != nil {
		return err
	}
	if !input.Enabled {
		_, err := s.db.Exec(c.Context(), `DELETE FROM mail_bot_notify_subscriptions WHERE discord_user_id=$1 AND mailbox_id=$2`, discordID, mailboxID)
		if err != nil {
			return err
		}
		return c.JSON(fiber.Map{"notify": false, "address": address})
	}
	accountID, err := s.stalwartAccountForMailbox(c.Context(), mailboxID)
	if err != nil {
		return err
	}
	if accountID == "" {
		return fiber.NewError(fiber.StatusConflict, "กล่องนี้ยังเปิดแจ้งเตือนไม่ได้")
	}
	// Start from the current state so only mail that arrives from now on is sent.
	state, _ := s.stalwartEmailState(c.Context(), accountID)
	_, err = s.db.Exec(c.Context(), `
		INSERT INTO mail_bot_notify_subscriptions (discord_user_id,mailbox_id,jmap_state) VALUES ($1,$2,$3)
		ON CONFLICT (discord_user_id,mailbox_id) DO NOTHING
	`, discordID, mailboxID, state)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"notify": true, "address": address})
}

// Images the bot can show in Discord. SVG is left out because it can carry script.
var botMailImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

const botMailMaxImageBytes = 8 * 1024 * 1024

var stalwartBlobIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.=-]{1,160}$`)

// botMailImage returns one image attachment of a message the member can read, so the bot can
// upload it to Discord. The type is taken from the bytes, not from the mail.
func (s *server) botMailImage(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	discordID := strings.TrimSpace(c.Query("discordUserId"))
	blobID := strings.TrimSpace(c.Query("blobId"))
	if !validDiscordSnowflake(discordID) || !stalwartBlobIDPattern.MatchString(blobID) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบรูปนี้")
	}
	mailboxID, _, err := s.botMailAccessible(c, discordID, strings.TrimSpace(c.Query("mailboxId")))
	if err != nil {
		return err
	}
	accountID, err := s.stalwartAccountForMailbox(c.Context(), mailboxID)
	if err != nil || accountID == "" {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบรูปนี้")
	}
	target := s.cfg.stalwartAPIURL + "/jmap/download/" + url.PathEscape(accountID) + "/" + url.PathEscape(blobID) + "/image"
	req, _ := http.NewRequestWithContext(c.Context(), http.MethodGet, target, nil)
	req.Header.Set("Authorization", s.stalwartAuthorization())
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบรูปนี้")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, botMailMaxImageBytes+1))
	if err != nil {
		return err
	}
	if len(data) > botMailMaxImageBytes {
		return fiber.NewError(fiber.StatusRequestEntityTooLarge, "รูปใหญ่เกิน 8 MB")
	}
	contentType := http.DetectContentType(data)
	if !botMailImageTypes[contentType] {
		return fiber.NewError(fiber.StatusUnsupportedMediaType, "ไฟล์นี้ไม่ใช่รูปที่แสดงได้")
	}
	c.Set(fiber.HeaderContentType, contentType)
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.Send(data)
}
