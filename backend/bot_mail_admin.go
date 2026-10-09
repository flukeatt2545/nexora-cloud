package main

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Routes for the mail bot's admin panel. Every one checks requireBotMailAdmin, so only Discord
// IDs listed in MAIL_DISCORD_ADMIN_IDS can use them.

// botMailAdminActor returns the admin's linked site account (or nil) for audit logs and ownership.
func (s *server) botMailAdminActor(c *fiber.Ctx) (string, *currentUser, error) {
	if err := s.requireBotMailAdmin(c); err != nil {
		return "", nil, err
	}
	discordID := s.botMailActorID(c)
	user, err := s.botMailSiteUser(c.Context(), discordID)
	return discordID, user, err
}

func (s *server) botMailAdminAudit(c *fiber.Ctx, actor *currentUser, discordID, action, targetID string, metadata map[string]any) {
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["actorDiscordId"] = discordID
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: action, Target: "mailbox", TargetID: targetID, Metadata: metadata})
}

func (s *server) botMailAdminMailboxes(c *fiber.Ctx) error {
	if _, _, err := s.botMailAdminActor(c); err != nil {
		return err
	}
	query := strings.ToLower(clipDiscordText(c.Query("q"), 80))
	page := c.QueryInt("page", 0)
	if page < 0 || page > 500 {
		page = 0
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT m.public_id, m.local_part || '@' || d.domain, m.display_name, m.status, m.quota_bytes, m.created_at,
		       COALESCE(u.identifier,''),
		       (SELECT COUNT(*) FROM mail_discord_bindings b WHERE b.mailbox_id=m.id)
		FROM mailboxes m
		JOIN mail_domains d ON d.id=m.domain_id
		LEFT JOIN mailbox_members mm ON mm.mailbox_id=m.id AND mm.role='owner'
		LEFT JOIN users u ON u.id=mm.user_id
		WHERE m.deleted_at IS NULL AND d.deleted_at IS NULL
		  AND ($1='' OR POSITION($1 IN LOWER(m.local_part || '@' || d.domain))>0 OR POSITION($1 IN LOWER(COALESCE(u.identifier,'')))>0)
		ORDER BY d.domain, m.local_part
		OFFSET $2 LIMIT $3
	`, query, page*botMailPageSize, botMailPageSize+1)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, address, name, status, owner string
		var quota, bindings int64
		var createdAt time.Time
		if err := rows.Scan(&id, &address, &name, &status, &quota, &createdAt, &owner, &bindings); err != nil {
			return err
		}
		items = append(items, fiber.Map{
			"id": id, "address": address, "displayName": name, "status": status, "quotaBytes": quota,
			"createdAt": createdAt, "owner": owner, "discordBindings": bindings,
		})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	hasMore := len(items) > botMailPageSize
	if hasMore {
		items = items[:botMailPageSize]
	}
	return c.JSON(fiber.Map{"items": items, "page": page, "hasMore": hasMore, "query": query})
}

func (s *server) botMailAdminMailbox(c *fiber.Ctx) error {
	if _, _, err := s.botMailAdminActor(c); err != nil {
		return err
	}
	var mailboxID, quota int64
	var address, name, status, owner, provision string
	var createdAt time.Time
	err := s.db.QueryRow(c.Context(), `
		SELECT m.id, m.local_part || '@' || d.domain, m.display_name, m.status, m.quota_bytes, m.created_at,
		       COALESCE(u.identifier,''), COALESCE(m.stalwart_provision_state,'')
		FROM mailboxes m
		JOIN mail_domains d ON d.id=m.domain_id
		LEFT JOIN mailbox_members mm ON mm.mailbox_id=m.id AND mm.role='owner'
		LEFT JOIN users u ON u.id=mm.user_id
		WHERE m.public_id=$1 AND m.deleted_at IS NULL
	`, c.Params("id")).Scan(&mailboxID, &address, &name, &status, &quota, &createdAt, &owner, &provision)
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบกล่องเมลนี้")
	}
	if err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `SELECT discord_user_id, discord_username FROM mail_discord_bindings WHERE mailbox_id=$1 ORDER BY created_at LIMIT 20`, mailboxID)
	if err != nil {
		return err
	}
	defer rows.Close()
	bindings := []fiber.Map{}
	for rows.Next() {
		var discordID, username string
		if err := rows.Scan(&discordID, &username); err != nil {
			return err
		}
		bindings = append(bindings, fiber.Map{"discordUserId": discordID, "username": username})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	var appPasswords, members int64
	_ = s.db.QueryRow(c.Context(), `
		SELECT (SELECT COUNT(*) FROM mail_device_credentials WHERE mailbox_id=$1 AND revoked_at IS NULL),
		       (SELECT COUNT(*) FROM mailbox_members WHERE mailbox_id=$1)
	`, mailboxID).Scan(&appPasswords, &members)
	return c.JSON(fiber.Map{
		"id": c.Params("id"), "address": address, "displayName": name, "status": status, "quotaBytes": quota,
		"createdAt": createdAt, "owner": owner, "provisionState": provision, "bindings": bindings,
		"appPasswords": appPasswords, "members": members,
	})
}

func (s *server) botMailAdminCreateMailbox(c *fiber.Ctx) error {
	discordID, actor, err := s.botMailAdminActor(c)
	if err != nil {
		return err
	}
	var input struct {
		DomainID       string  `json:"domainId"`
		LocalPart      string  `json:"localPart"`
		DisplayName    string  `json:"displayName"`
		QuotaGB        float64 `json:"quotaGb"`
		OwnerDiscordID string  `json:"ownerDiscordId"`
		OwnerUsername  string  `json:"ownerUsername"`
	}
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	local := normalizeMailLocal(input.LocalPart)
	if local == "" {
		return fiber.NewError(fiber.StatusBadRequest, "ชื่ออีเมลใช้ได้เฉพาะ a-z 0-9 . _ + - และขึ้นต้น/ลงท้ายด้วยตัวอักษรหรือตัวเลข")
	}
	quota := mailDefaultQuota
	if input.QuotaGB > 0 {
		quota = int64(input.QuotaGB * 1024 * 1024 * 1024)
	}
	if quota < mailBotMinQuotaBytes || quota > mailBotMaxQuotaBytes {
		return fiber.NewError(fiber.StatusBadRequest, "พื้นที่ต้องอยู่ระหว่าง 0.01 ถึง 100 GB")
	}
	var domainID int64
	var domain string
	err = s.db.QueryRow(c.Context(), `SELECT id,domain FROM mail_domains WHERE public_id=$1 AND status='active' AND deleted_at IS NULL`, strings.TrimSpace(input.DomainID)).Scan(&domainID, &domain)
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบโดเมนที่พร้อมใช้งาน")
	}
	if err != nil {
		return err
	}

	// Owner: the target's linked site account, then the username given, then the admin's own account.
	// A target Discord user without a site account is bound to the mailbox so they can still read it.
	ownerDiscordID := strings.TrimSpace(input.OwnerDiscordID)
	if ownerDiscordID != "" && !validDiscordSnowflake(ownerDiscordID) {
		return fiber.NewError(fiber.StatusBadRequest, "ผู้ใช้ Discord ไม่ถูกต้อง")
	}
	var ownerID int64
	bindTarget := false
	if ownerDiscordID != "" {
		owner, err := s.botMailSiteUser(c.Context(), ownerDiscordID)
		if err != nil {
			return err
		}
		if owner != nil {
			ownerID = owner.ID
		} else {
			bindTarget = true
		}
	}
	if ownerID == 0 && strings.TrimSpace(input.OwnerUsername) != "" {
		err := s.db.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(identifier)=LOWER($1) AND status='active'`, strings.TrimSpace(input.OwnerUsername)).Scan(&ownerID)
		if errors.Is(err, pgx.ErrNoRows) {
			return fiber.NewError(fiber.StatusNotFound, "ไม่พบบัญชีเว็บชื่อนี้")
		}
		if err != nil {
			return err
		}
	}
	if ownerID == 0 && actor != nil {
		ownerID = actor.ID
	}
	if ownerID == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "ใส่ชื่อบัญชีเว็บของเจ้าของ หรือผูก Discord ของคุณกับบัญชีเว็บก่อน")
	}
	createdBy := ownerID
	if actor != nil {
		createdBy = actor.ID
	}
	created, err := s.createMailboxRecord(c.Context(), domainID, domain, local, clipDiscordText(input.DisplayName, 80), ownerID, createdBy, quota)
	if errors.Is(err, errMailAddressTaken) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ที่อยู่นี้มีอยู่แล้ว", Code: "mail_address_taken"})
	}
	if err != nil {
		return err
	}
	if bindTarget {
		_, err := s.db.Exec(c.Context(), `
			INSERT INTO mail_discord_bindings (discord_user_id, mailbox_id, created_by)
			SELECT $1, id, NULLIF($3,0) FROM mailboxes WHERE public_id=$2
			ON CONFLICT (discord_user_id, mailbox_id) DO NOTHING
		`, ownerDiscordID, created.PublicID, createdBy)
		if err != nil {
			return err
		}
	}
	s.botMailAdminAudit(c, actor, discordID, "mail.discord.admin_mailbox_created", created.PublicID, map[string]any{
		"address": created.Address, "ownerDiscordId": ownerDiscordID, "boundDiscord": bindTarget, "quotaBytes": quota,
	})
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id": created.PublicID, "address": created.Address, "provisionState": created.ProvisionState, "boundDiscord": bindTarget,
	})
}

// botMailAdminFindMailbox loads a live mailbox by public ID for suspend, resume and delete.
func (s *server) botMailAdminFindMailbox(ctx context.Context, publicID string) (int64, string, string, error) {
	var mailboxID int64
	var address, accountID string
	err := s.db.QueryRow(ctx, `
		SELECT m.id, m.local_part || '@' || d.domain, COALESCE(m.stalwart_account_id,'')
		FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id
		WHERE m.public_id=$1 AND m.deleted_at IS NULL
	`, publicID).Scan(&mailboxID, &address, &accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", "", fiber.NewError(fiber.StatusNotFound, "ไม่พบกล่องเมลนี้")
	}
	return mailboxID, address, accountID, err
}

// revokeAllDevicePasswords signs out every IMAP/SMTP client. Mailboxes have no other password,
// so this is what stops a suspended mailbox from being used outside the site.
func (s *server) revokeAllDevicePasswords(ctx context.Context, mailboxID int64) (int, error) {
	rows, err := s.db.Query(ctx, `SELECT public_id FROM mail_device_credentials WHERE mailbox_id=$1 AND revoked_at IS NULL`, mailboxID)
	if err != nil {
		return 0, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	revoked := 0
	for _, id := range ids {
		if err := s.revokeDevicePassword(ctx, mailboxID, id); err != nil {
			return revoked, err
		}
		revoked++
	}
	return revoked, nil
}

func (s *server) botMailAdminSetMailboxStatus(status string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		discordID, actor, err := s.botMailAdminActor(c)
		if err != nil {
			return err
		}
		mailboxID, address, _, err := s.botMailAdminFindMailbox(c.Context(), c.Params("id"))
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(c.Context(), `UPDATE mailboxes SET status=$2, updated_at=NOW() WHERE id=$1`, mailboxID, status); err != nil {
			return err
		}
		revoked := 0
		if status == "suspended" {
			revoked, err = s.revokeAllDevicePasswords(c.Context(), mailboxID)
			if err != nil {
				return fiber.NewError(fiber.StatusBadGateway, "ระงับแล้ว แต่ยกเลิกรหัสผ่านแอปบางอันไม่สำเร็จ ลองกดระงับอีกครั้ง")
			}
		}
		action := "mail.discord.admin_mailbox_resumed"
		if status == "suspended" {
			action = "mail.discord.admin_mailbox_suspended"
		}
		s.botMailAdminAudit(c, actor, discordID, action, c.Params("id"), map[string]any{"address": address, "appPasswordsRevoked": revoked})
		return c.JSON(fiber.Map{"status": status, "address": address, "appPasswordsRevoked": revoked})
	}
}

func (s *server) botMailAdminDeleteMailbox(c *fiber.Ctx) error {
	discordID, actor, err := s.botMailAdminActor(c)
	if err != nil {
		return err
	}
	var input struct {
		ConfirmAddress string `json:"confirmAddress"`
	}
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	mailboxID, address, accountID, err := s.botMailAdminFindMailbox(c.Context(), c.Params("id"))
	if err != nil {
		return err
	}
	if !strings.EqualFold(strings.TrimSpace(input.ConfirmAddress), address) {
		return fiber.NewError(fiber.StatusBadRequest, "พิมพ์ที่อยู่อีเมลไม่ตรง ยังไม่ได้ลบ")
	}
	// Remove the Stalwart account first; if that fails nothing is marked deleted and the admin can retry.
	if accountID != "" {
		raw, err := s.stalwartMethod(c.Context(), "x:Account/set", map[string]any{"destroy": []string{accountID}})
		if err == nil {
			_, err = decodeStalwartSet(raw, "")
		}
		if err != nil {
			return fiber.NewError(fiber.StatusBadGateway, "ลบบัญชีบนเซิร์ฟเวอร์เมลไม่สำเร็จ ยังไม่ได้ลบ ลองใหม่ภายหลัง")
		}
	}
	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())
	statements := []string{
		`UPDATE mailboxes SET deleted_at=NOW(), status='suspended', stalwart_account_id=NULL, stalwart_provision_state='disabled', updated_at=NOW() WHERE id=$1`,
		`UPDATE mail_aliases SET deleted_at=NOW() WHERE mailbox_id=$1 AND deleted_at IS NULL`,
		`UPDATE mail_device_credentials SET revoked_at=NOW() WHERE mailbox_id=$1 AND revoked_at IS NULL`,
		`DELETE FROM mail_discord_bindings WHERE mailbox_id=$1`,
		`DELETE FROM mail_bot_notify_subscriptions WHERE mailbox_id=$1`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(c.Context(), statement, mailboxID); err != nil {
			return err
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	s.botMailAdminAudit(c, actor, discordID, "mail.discord.admin_mailbox_deleted", c.Params("id"), map[string]any{"address": address})
	return c.JSON(fiber.Map{"deleted": true, "address": address})
}

func (s *server) botMailAdminDomains(c *fiber.Ctx) error {
	if _, _, err := s.botMailAdminActor(c); err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT d.public_id, d.domain, d.kind, d.status, d.verified_at IS NOT NULL, COALESCE(u.identifier,''),
		       (SELECT COUNT(*) FROM mailboxes m WHERE m.domain_id=d.id AND m.deleted_at IS NULL)
		FROM mail_domains d LEFT JOIN users u ON u.id=d.owner_user_id
		WHERE d.deleted_at IS NULL
		ORDER BY d.kind='platform' DESC, d.status='pending_approval' DESC, d.domain
		LIMIT 25
	`)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, domain, kind, status, owner string
		var verified bool
		var mailboxes int64
		if err := rows.Scan(&id, &domain, &kind, &status, &verified, &owner, &mailboxes); err != nil {
			return err
		}
		items = append(items, fiber.Map{
			"id": id, "domain": domain, "kind": kind, "status": status, "verified": verified, "owner": owner, "mailboxes": mailboxes,
		})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) botMailAdminSetDomainStatus(c *fiber.Ctx) error {
	discordID, actor, err := s.botMailAdminActor(c)
	if err != nil {
		return err
	}
	var input struct {
		Status string `json:"status"`
	}
	if c.BodyParser(&input) != nil || (input.Status != "active" && input.Status != "suspended") {
		return fiber.NewError(fiber.StatusBadRequest, "สถานะไม่ถูกต้อง")
	}
	var approvedBy int64
	if actor != nil {
		approvedBy = actor.ID
	}
	err = s.setMailDomainStatus(c.Context(), c.Params("id"), input.Status, approvedBy)
	if errors.Is(err, errMailDomainNotVerified) {
		return fiber.NewError(fiber.StatusConflict, "โดเมนยังไม่ผ่านการยืนยัน DNS อนุมัติไม่ได้")
	}
	var syncErr stalwartSyncError
	if errors.As(err, &syncErr) {
		return fiber.NewError(fiber.StatusBadGateway, "เปลี่ยนสถานะแล้ว แต่ซิงก์เซิร์ฟเวอร์เมลไม่สำเร็จ")
	}
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.discord.admin_domain_status", Target: "mail_domain", TargetID: c.Params("id"),
		Metadata: map[string]any{"actorDiscordId": discordID, "status": input.Status}})
	return c.JSON(fiber.Map{"status": input.Status})
}

// saveMailBotSettings validates and stores the self-service settings; the web and the bot share it.
func (s *server) saveMailBotSettings(ctx context.Context, settings mailBotSettings) (mailBotSettings, error) {
	if settings.MaxMailboxesPerUser < 0 || settings.MaxMailboxesPerUser > mailBotMaxMailboxesLimit {
		return settings, fiber.NewError(fiber.StatusBadRequest, "จำนวนกล่องต่อคนต้องอยู่ระหว่าง 0 ถึง 50")
	}
	if settings.QuotaBytes < mailBotMinQuotaBytes || settings.QuotaBytes > mailBotMaxQuotaBytes {
		return settings, fiber.NewError(fiber.StatusBadRequest, "พื้นที่ต่อกล่องต้องอยู่ระหว่าง 10 MB ถึง 100 GB")
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO mail_bot_settings (singleton, self_service_enabled, max_mailboxes_per_user, self_service_quota_bytes, updated_at)
		VALUES (TRUE, $1, $2, $3, NOW())
		ON CONFLICT (singleton) DO UPDATE SET self_service_enabled=EXCLUDED.self_service_enabled,
			max_mailboxes_per_user=EXCLUDED.max_mailboxes_per_user, self_service_quota_bytes=EXCLUDED.self_service_quota_bytes, updated_at=NOW()
	`, settings.SelfServiceEnabled, settings.MaxMailboxesPerUser, settings.QuotaBytes)
	return settings, err
}

func (s *server) botMailAdminGetSettings(c *fiber.Ctx) error {
	if _, _, err := s.botMailAdminActor(c); err != nil {
		return err
	}
	settings, err := s.loadMailBotSettings(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(settings)
}

func (s *server) botMailAdminSaveSettings(c *fiber.Ctx) error {
	discordID, actor, err := s.botMailAdminActor(c)
	if err != nil {
		return err
	}
	var input mailBotSettings
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	saved, err := s.saveMailBotSettings(c.Context(), input)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.discord.settings_updated", Target: "mail_bot_settings",
		Metadata: map[string]any{"actorDiscordId": discordID, "selfServiceEnabled": saved.SelfServiceEnabled, "maxMailboxesPerUser": saved.MaxMailboxesPerUser, "quotaBytes": saved.QuotaBytes}})
	return c.JSON(saved)
}

// Web admin: the same settings, edited from the Discord bot settings page (superadmin).
func (s *server) getAdminMailBotSelfService(c *fiber.Ctx) error {
	settings, err := s.loadMailBotSettings(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(settings)
}

func (s *server) updateAdminMailBotSelfService(c *fiber.Ctx) error {
	var input mailBotSettings
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	saved, err := s.saveMailBotSettings(c.Context(), input)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "mail", Action: "mail.bot_settings_updated", Target: "mail_bot_settings",
		Metadata: map[string]any{"selfServiceEnabled": saved.SelfServiceEnabled, "maxMailboxesPerUser": saved.MaxMailboxesPerUser, "quotaBytes": saved.QuotaBytes}})
	return c.JSON(saved)
}
