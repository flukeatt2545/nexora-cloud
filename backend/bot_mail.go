package main

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

type botMailBindRequest struct {
	DiscordUserID   string `json:"discordUserId"`
	DiscordUsername string `json:"discordUsername"`
	Address         string `json:"address"`
}

type botMailMailbox struct {
	ID          string `json:"id"`
	Address     string `json:"address"`
	DisplayName string `json:"displayName"`
	Unread      int64  `json:"unread"`
	Source      string `json:"-"`
}

var (
	htmlTagPattern          = regexp.MustCompile(`(?s)<[^>]*>`)
	htmlSpacePattern        = regexp.MustCompile(`[ \t\r\n\f]+`)
	discordSnowflakePattern = regexp.MustCompile(`^[0-9]{17,20}$`)
	mailboxPublicIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)
	mailMessageIDPattern    = regexp.MustCompile(`^[A-Za-z0-9._:/=+-]{1,128}$`)
)

func parseDiscordIDList(raw string) map[string]bool {
	ids := make(map[string]bool)
	for _, part := range strings.Split(raw, ",") {
		id := strings.TrimSpace(part)
		if validDiscordSnowflake(id) {
			ids[id] = true
		}
	}
	return ids
}

func validDiscordSnowflake(id string) bool {
	return discordSnowflakePattern.MatchString(strings.TrimSpace(id))
}

func validMailboxPublicID(id string) bool {
	return mailboxPublicIDPattern.MatchString(strings.TrimSpace(id))
}

func validMailMessageID(id string) bool {
	return mailMessageIDPattern.MatchString(strings.TrimSpace(id))
}

func (s *server) requireBotMailAdmin(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	actor := strings.TrimSpace(c.Get("X-Bot-Actor-Discord-Id"))
	if !validDiscordSnowflake(actor) || s.cfg.mailDiscordAdminIDs == nil || !s.cfg.mailDiscordAdminIDs[actor] {
		return fiber.NewError(fiber.StatusForbidden, "ไม่มีสิทธิ์ทำรายการนี้")
	}
	return nil
}

func (s *server) botMailActorID(c *fiber.Ctx) string {
	return strings.TrimSpace(c.Get("X-Bot-Actor-Discord-Id"))
}

func stripMailHTML(value string) string {
	text := strings.ReplaceAll(value, "<br>", "\n")
	text = strings.ReplaceAll(text, "<br/>", "\n")
	text = strings.ReplaceAll(text, "<br />", "\n")
	text = strings.ReplaceAll(text, "</p>", "\n")
	text = strings.ReplaceAll(text, "</div>", "\n")
	text = htmlTagPattern.ReplaceAllString(text, "")
	text = html.UnescapeString(text)
	text = htmlSpacePattern.ReplaceAllString(strings.TrimSpace(text), " ")
	return strings.TrimSpace(text)
}

func clipDiscordText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:limit-1])) + "…"
}

func (s *server) botMailUserID(ctx context.Context, discordUserID string) (int64, error) {
	var userID int64
	err := s.db.QueryRow(ctx, `
		SELECT user_id FROM oauth_accounts
		WHERE provider='discord' AND provider_user_id=$1
	`, discordUserID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return userID, err
}

func (s *server) botMailAccessibleMailbox(ctx context.Context, discordUserID, mailboxPublic string) (int64, string, error) {
	userID, err := s.botMailUserID(ctx, discordUserID)
	if err != nil {
		return 0, "", err
	}
	var mailboxID int64
	var address string
	err = s.db.QueryRow(ctx, `
		SELECT m.id, m.local_part || '@' || d.domain
		FROM mailboxes m
		JOIN mail_domains d ON d.id=m.domain_id
		WHERE m.public_id=$1 AND m.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active' AND m.status='active'
		  AND (
		    EXISTS (
		      SELECT 1 FROM mailbox_members mm
		      WHERE mm.mailbox_id=m.id AND mm.user_id=$2 AND $2 <> 0
		    )
		    OR EXISTS (
		      SELECT 1 FROM mail_discord_bindings b
		      WHERE b.mailbox_id=m.id AND b.discord_user_id=$3
		    )
		  )
	`, mailboxPublic, userID, discordUserID).Scan(&mailboxID, &address)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", nil
	}
	return mailboxID, address, err
}

func (s *server) botListAccessibleMailboxes(ctx context.Context, discordUserID string) ([]botMailMailbox, error) {
	userID, err := s.botMailUserID(ctx, discordUserID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT m.public_id, m.local_part || '@' || d.domain, m.display_name,
		       CASE WHEN $2 <> 0 AND EXISTS (
		         SELECT 1 FROM mailbox_members mm WHERE mm.mailbox_id=m.id AND mm.user_id=$2
		       ) THEN 'oauth' ELSE 'bind' END
		FROM mailboxes m
		JOIN mail_domains d ON d.id=m.domain_id
		WHERE m.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active' AND m.status='active'
		  AND (
		    ($2 <> 0 AND EXISTS (SELECT 1 FROM mailbox_members mm WHERE mm.mailbox_id=m.id AND mm.user_id=$2))
		    OR EXISTS (SELECT 1 FROM mail_discord_bindings b WHERE b.mailbox_id=m.id AND b.discord_user_id=$1)
		  )
		ORDER BY 2
	`, discordUserID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []botMailMailbox{}
	for rows.Next() {
		var item botMailMailbox
		if err := rows.Scan(&item.ID, &item.Address, &item.DisplayName, &item.Source); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// botMailFolders are the folders the bot can list; the value is the Stalwart mailbox role.
var botMailFolders = map[string]string{"inbox": "inbox", "sent": "sent", "trash": "trash"}

const botMailPageSize = 10

// botCollectMailMessages returns one page of a folder, newest first, and whether more pages follow.
func (s *server) botCollectMailMessages(ctx context.Context, mailboxID int64, folder string, page int) ([]fiber.Map, bool, error) {
	offset := page * botMailPageSize
	accountID, err := s.stalwartAccountForMailbox(ctx, mailboxID)
	if err == nil && accountID != "" {
		return s.botCollectStalwartMessages(ctx, accountID, folder, offset)
	}
	rows, err := s.db.Query(ctx, `
		SELECT m.public_id, m.from_address, m.from_name, m.subject, m.body_text,
		       COALESCE(m.received_at, m.sent_at, m.created_at),
		       us.read_at IS NOT NULL
		FROM mail_messages m
		LEFT JOIN mail_message_user_state us ON us.message_id=m.id
		WHERE m.mailbox_id=$1 AND m.folder=$2
		ORDER BY m.id DESC
		OFFSET $3 LIMIT $4
	`, mailboxID, folder, offset, botMailPageSize+1)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, from, fromName, subject, preview string
		var at time.Time
		var read bool
		if err := rows.Scan(&id, &from, &fromName, &subject, &preview, &at, &read); err != nil {
			return nil, false, err
		}
		items = append(items, fiber.Map{
			"id": id, "from": from, "fromName": fromName, "subject": subject,
			"preview": clipDiscordText(preview, 140), "date": at, "read": read,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(items) > botMailPageSize
	if hasMore {
		items = items[:botMailPageSize]
	}
	return items, hasMore, nil
}

// stalwartEmailSummaries loads only what a message list needs, without bodies.
func (s *server) stalwartEmailSummaries(ctx context.Context, accountID string, ids []string) ([]stalwartEmail, error) {
	if len(ids) == 0 {
		return []stalwartEmail{}, nil
	}
	raw, err := s.stalwartMethod(ctx, "Email/get", map[string]any{
		"accountId":  accountID,
		"ids":        ids,
		"properties": []string{"id", "mailboxIds", "keywords", "from", "to", "subject", "preview", "receivedAt", "hasAttachment"},
	})
	if err != nil {
		return nil, err
	}
	var result struct {
		List []stalwartEmail `json:"list"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result.List, nil
}

// botMailSummary shows the sender, or for sent mail the first recipient.
func botMailSummary(email stalwartEmail, folder string) fiber.Map {
	people := email.From
	if folder == "sent" {
		people = email.To
	}
	address, name := "", ""
	if len(people) > 0 {
		address, name = people[0].Email, people[0].Name
	}
	return fiber.Map{
		"id": email.ID, "from": address, "fromName": name, "subject": email.Subject,
		"preview": clipDiscordText(email.Preview, 140), "date": email.ReceivedAt, "read": email.Keywords["$seen"],
		"hasAttachment": email.HasAttachment,
	}
}

func (s *server) botCollectStalwartMessages(ctx context.Context, accountID, folder string, offset int) ([]fiber.Map, bool, error) {
	roles, err := s.stalwartMailboxRoles(ctx, accountID)
	if err != nil {
		return nil, false, err
	}
	folderID := roles[botMailFolders[folder]]
	if folderID == "" {
		return []fiber.Map{}, false, nil
	}
	raw, err := s.stalwartMethod(ctx, "Email/query", map[string]any{
		"accountId": accountID,
		"filter":    map[string]any{"inMailbox": folderID},
		"sort":      []map[string]any{{"property": "receivedAt", "isAscending": false}},
		"position":  offset,
		"limit":     botMailPageSize + 1,
	})
	if err != nil {
		return nil, false, err
	}
	var result struct {
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, false, err
	}
	ids := result.IDs
	hasMore := len(ids) > botMailPageSize
	if hasMore {
		ids = ids[:botMailPageSize]
	}
	emails, err := s.stalwartEmailSummaries(ctx, accountID, ids)
	if err != nil {
		return nil, false, err
	}
	byID := map[string]stalwartEmail{}
	for _, email := range emails {
		byID[email.ID] = email
	}
	items := []fiber.Map{}
	for _, id := range ids {
		if email, ok := byID[id]; ok {
			items = append(items, botMailSummary(email, folder))
		}
	}
	return items, hasMore, nil
}

// botLoadMailMessage loads one message for reading. With markRead it also marks a Stalwart message as read.
func (s *server) botLoadMailMessage(ctx context.Context, mailboxID int64, messageID string, markRead bool) (fiber.Map, error) {
	accountID, err := s.stalwartAccountForMailbox(ctx, mailboxID)
	if err == nil && accountID != "" {
		emails, err := s.stalwartGetEmails(ctx, accountID, []string{messageID})
		if err != nil {
			return nil, err
		}
		if len(emails) == 0 {
			return nil, pgx.ErrNoRows
		}
		email := emails[0]
		from, fromName := "", ""
		if len(email.From) > 0 {
			from, fromName = email.From[0].Email, email.From[0].Name
		}
		text := strings.TrimSpace(stalwartBody(email.TextBody, email.BodyValues))
		if text == "" {
			text = stripMailHTML(stalwartBody(email.HTMLBody, email.BodyValues))
		}
		folder := "inbox"
		if roles, err := s.stalwartMailboxRoles(ctx, accountID); err == nil {
			for name, role := range botMailFolders {
				if roles[role] != "" && email.MailboxIDs[roles[role]] {
					folder = name
				}
			}
		}
		attachments := []fiber.Map{}
		for _, part := range email.Attachments {
			if len(attachments) == 10 {
				break
			}
			attachments = append(attachments, fiber.Map{
				"blobId": part.BlobID, "name": firstNonEmpty(part.Name, "attachment"), "type": strings.ToLower(part.Type), "size": part.Size,
			})
		}
		read := email.Keywords["$seen"]
		if markRead && !read {
			seen := true
			if s.stalwartSetMessage(ctx, accountID, email.ID, &seen, "") == nil {
				read = true
			}
		}
		return fiber.Map{
			"id": email.ID, "from": from, "fromName": fromName, "subject": email.Subject,
			"text": clipDiscordText(text, 3500), "date": email.ReceivedAt, "folder": folder, "read": read, "canManage": true,
			"attachments": attachments,
		}, nil
	}
	var from, fromName, subject, textBody, htmlBody, folder string
	var at time.Time
	err = s.db.QueryRow(ctx, `
		SELECT from_address, from_name, subject, body_text, body_html, COALESCE(received_at, sent_at, created_at), folder
		FROM mail_messages WHERE mailbox_id=$1 AND public_id=$2
	`, mailboxID, messageID).Scan(&from, &fromName, &subject, &textBody, &htmlBody, &at, &folder)
	if err != nil {
		return nil, err
	}
	text := strings.TrimSpace(textBody)
	if text == "" {
		text = stripMailHTML(htmlBody)
	}
	return fiber.Map{
		"id": messageID, "from": from, "fromName": fromName, "subject": subject,
		"text": clipDiscordText(text, 3500), "date": at, "folder": folder, "read": true, "canManage": false,
	}, nil
}

func (s *server) botMailMe(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	discordUserID := strings.TrimSpace(c.Params("discordUserId"))
	if !validDiscordSnowflake(discordUserID) {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_discord_user"})
	}
	userID, err := s.botMailUserID(c.Context(), discordUserID)
	if err != nil {
		return err
	}
	mailboxes, err := s.botListAccessibleMailboxes(c.Context(), discordUserID)
	if err != nil {
		return err
	}
	linked := userID != 0 || len(mailboxes) > 0
	return c.JSON(fiber.Map{
		"linked":    linked,
		"oauth":     userID != 0,
		"mailboxes": mailboxes,
		"webmail":   strings.TrimRight(s.cfg.oauthBaseURL, "/") + "/mail",
	})
}

func (s *server) botMailMessages(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	discordUserID := strings.TrimSpace(c.Query("discordUserId"))
	mailboxPublic := strings.TrimSpace(c.Query("mailboxId"))
	if !validDiscordSnowflake(discordUserID) || !validMailboxPublicID(mailboxPublic) {
		return c.Status(404).JSON(apiError{Error: "ไม่พบกล่องเมลนี้", Code: "mailbox_forbidden"})
	}
	folder := firstNonEmpty(strings.TrimSpace(c.Query("folder")), "inbox")
	if _, ok := botMailFolders[folder]; !ok {
		return c.Status(400).JSON(apiError{Error: "ไม่รู้จักโฟลเดอร์นี้", Code: "invalid_folder"})
	}
	page := c.QueryInt("page", 0)
	if page < 0 || page > 200 {
		page = 0
	}
	mailboxID, address, err := s.botMailAccessibleMailbox(c.Context(), discordUserID, mailboxPublic)
	if err != nil {
		return err
	}
	if mailboxID == 0 {
		return c.Status(404).JSON(apiError{Error: "ไม่พบกล่องเมลนี้", Code: "mailbox_forbidden"})
	}
	items, hasMore, err := s.botCollectMailMessages(c.Context(), mailboxID, folder, page)
	if err != nil {
		return err
	}
	s.auditMailAccess(c, "d"+discordUserID, mailboxPublic, auditEvent{Category: "mail", Action: "mail.access.bot", Target: "mailbox", TargetID: mailboxPublic,
		Metadata: map[string]any{"address": address, "actorDiscordId": discordUserID}})
	var notify, member bool
	_ = s.db.QueryRow(c.Context(), `
		SELECT EXISTS(SELECT 1 FROM mail_bot_notify_subscriptions WHERE discord_user_id=$1 AND mailbox_id=$2),
		       EXISTS(SELECT 1 FROM mailbox_members mm JOIN oauth_accounts oa ON oa.user_id=mm.user_id
		              WHERE mm.mailbox_id=$2 AND oa.provider='discord' AND oa.provider_user_id=$1)
	`, discordUserID, mailboxID).Scan(&notify, &member)
	return c.JSON(fiber.Map{
		"mailboxId": mailboxPublic, "address": address, "folder": folder, "page": page, "hasMore": hasMore,
		"items": items, "notify": notify, "canAppPasswords": member,
	})
}

func (s *server) botMailMessage(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	discordUserID := strings.TrimSpace(c.Query("discordUserId"))
	mailboxPublic := strings.TrimSpace(c.Query("mailboxId"))
	messageID := strings.TrimSpace(c.Params("id"))
	if !validDiscordSnowflake(discordUserID) || !validMailboxPublicID(mailboxPublic) || !validMailMessageID(messageID) {
		return c.Status(404).JSON(apiError{Error: "ไม่พบกล่องเมลนี้", Code: "mailbox_forbidden"})
	}
	mailboxID, address, err := s.botMailAccessibleMailbox(c.Context(), discordUserID, mailboxPublic)
	if err != nil {
		return err
	}
	if mailboxID == 0 {
		return c.Status(404).JSON(apiError{Error: "ไม่พบกล่องเมลนี้", Code: "mailbox_forbidden"})
	}
	item, err := s.botLoadMailMessage(c.Context(), mailboxID, messageID, c.QueryBool("markRead"))
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(404).JSON(apiError{Error: "ไม่พบข้อความนี้", Code: "message_not_found"})
	}
	if err != nil {
		return err
	}
	item["address"] = address
	item["webmail"] = strings.TrimRight(s.cfg.oauthBaseURL, "/") + "/mail"
	return c.JSON(item)
}

func (s *server) botMailBind(c *fiber.Ctx) error {
	if err := s.requireBotMailAdmin(c); err != nil {
		return err
	}
	var req botMailBindRequest
	if c.BodyParser(&req) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	discordUserID := strings.TrimSpace(req.DiscordUserID)
	address := normalizeRecipient(req.Address)
	if !validDiscordSnowflake(discordUserID) || address == "" {
		return c.Status(400).JSON(apiError{Error: "กรุณาระบุสมาชิกและที่อยู่อีเมล", Code: "invalid_bind"})
	}
	var mailboxID int64
	var publicID, resolved string
	err := s.db.QueryRow(c.Context(), `
		SELECT m.id, m.public_id, m.local_part || '@' || d.domain
		FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id
		WHERE LOWER(m.local_part || '@' || d.domain)=LOWER($1)
		  AND m.deleted_at IS NULL AND d.deleted_at IS NULL
		  AND m.status='active' AND d.status='active'
	`, address).Scan(&mailboxID, &publicID, &resolved)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(404).JSON(apiError{Error: "ไม่พบกล่องเมลนี้", Code: "mailbox_not_found"})
	}
	if err != nil {
		return err
	}
	username := clipDiscordText(strings.TrimSpace(req.DiscordUsername), 80)
	_, err = s.db.Exec(c.Context(), `
		INSERT INTO mail_discord_bindings (discord_user_id, discord_username, mailbox_id)
		VALUES ($1,$2,$3)
		ON CONFLICT (discord_user_id, mailbox_id) DO UPDATE
		SET discord_username=EXCLUDED.discord_username
	`, discordUserID, username, mailboxID)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{
		Category: "mail",
		Action:   "mail.discord.bind",
		Target:   "mailbox",
		TargetID: publicID,
		Metadata: map[string]any{
			"discordUserId":  discordUserID,
			"actorDiscordId": s.botMailActorID(c),
			"address":        resolved,
		},
	})
	return c.JSON(fiber.Map{"ok": true, "mailboxId": publicID, "address": resolved})
}

func (s *server) botMailUnbind(c *fiber.Ctx) error {
	if err := s.requireBotMailAdmin(c); err != nil {
		return err
	}
	var req botMailBindRequest
	if c.BodyParser(&req) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	discordUserID := strings.TrimSpace(req.DiscordUserID)
	address := normalizeRecipient(req.Address)
	if !validDiscordSnowflake(discordUserID) {
		return c.Status(400).JSON(apiError{Error: "กรุณาระบุสมาชิก", Code: "invalid_unbind"})
	}
	query := `DELETE FROM mail_discord_bindings WHERE discord_user_id=$1`
	args := []any{discordUserID}
	if address != "" {
		query += ` AND mailbox_id=(
			SELECT m.id FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id
			WHERE LOWER(m.local_part || '@' || d.domain)=LOWER($2) AND m.deleted_at IS NULL
		)`
		args = append(args, address)
	}
	tag, err := s.db.Exec(c.Context(), query, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return c.Status(404).JSON(apiError{Error: "ไม่พบการผูกบัญชีนี้", Code: "binding_not_found"})
	}
	s.audit(c, auditEvent{
		Category: "mail",
		Action:   "mail.discord.unbind",
		Target:   "mailbox",
		TargetID: firstNonEmpty(address, discordUserID),
		Metadata: map[string]any{
			"discordUserId":  discordUserID,
			"actorDiscordId": s.botMailActorID(c),
			"address":        address,
			"removed":        tag.RowsAffected(),
		},
	})
	return c.JSON(fiber.Map{"ok": true, "removed": tag.RowsAffected()})
}

func (s *server) botMailAdminSummary(c *fiber.Ctx) error {
	if err := s.requireBotMailAdmin(c); err != nil {
		return err
	}
	var domains, mailboxes, pending, suspended int64
	if err := s.db.QueryRow(c.Context(), `
		SELECT (SELECT COUNT(*) FROM mail_domains WHERE deleted_at IS NULL),
		       (SELECT COUNT(*) FROM mailboxes WHERE deleted_at IS NULL),
		       (SELECT COUNT(*) FROM mail_domains WHERE deleted_at IS NULL AND status='pending_approval'),
		       (SELECT COUNT(*) FROM mailboxes WHERE deleted_at IS NULL AND status='suspended')
	`).Scan(&domains, &mailboxes, &pending, &suspended); err != nil {
		return err
	}
	settings, err := s.loadMailBotSettings(c.Context())
	if err != nil {
		return err
	}
	healthy := false
	if s.cfg.stalwartAPIToken != "" {
		_, err := s.stalwartMethod(c.Context(), "x:Domain/query", map[string]any{"filter": map[string]any{}, "limit": 1})
		healthy = err == nil
	}
	return c.JSON(fiber.Map{
		"domains":   domains,
		"mailboxes": mailboxes,
		"pending":   pending,
		"suspended": suspended,
		"settings":  settings,
		"stalwart":  healthy,
		"publicUrl": s.cfg.stalwartPublicURL,
		"webmail":   strings.TrimRight(s.cfg.oauthBaseURL, "/") + "/mail",
	})
}

func (s *server) getAdminMailDiscordBot(c *fiber.Ctx) error {
	return s.respondDiscordBotPresence(c, "mail")
}

func (s *server) updateAdminMailDiscordBot(c *fiber.Ctx) error {
	return s.saveDiscordBotPresence(c, "mail")
}

func (s *server) botMailPresence(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	return s.respondDiscordBotPresence(c, "mail")
}
