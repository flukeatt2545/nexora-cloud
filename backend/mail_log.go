package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Mail activity log. Every audit event in the "mail" category is also posted to a Discord
// webhook of its own, set in the admin mail settings, when its group is switched on.

var mailLogGroupOrder = []string{"access", "traffic", "manage", "messages"}

const mailLogAccessEvery = 30 * time.Minute

type mailLogSettings struct {
	Enabled    bool     `json:"enabled"`
	Groups     []string `json:"groups"`
	Configured bool     `json:"configured"`
	// Write-only: the saved URL is never sent back.
	WebhookURL   string `json:"webhookUrl,omitempty"`
	ClearWebhook bool   `json:"clearWebhook,omitempty"`
}

// mailLogGroup sorts a mail action into the group an admin switches on or off.
func mailLogGroup(action string) string {
	switch {
	case strings.HasPrefix(action, "mail.access."):
		return "access"
	case action == "mail.message.sent" || action == "mail.message.received":
		return "traffic"
	case action == "mail.discord.message_moved" || strings.HasPrefix(action, "mail.message."):
		return "messages"
	default:
		return "manage"
	}
}

func sanitizeMailLogGroups(values []string) []string {
	wanted := map[string]bool{}
	for _, value := range values {
		wanted[strings.TrimSpace(value)] = true
	}
	groups := []string{}
	for _, group := range mailLogGroupOrder {
		if wanted[group] {
			groups = append(groups, group)
		}
	}
	return groups
}

func (s *server) loadMailLogSettings(ctx context.Context) (mailLogSettings, string, error) {
	settings := mailLogSettings{Groups: []string{"access", "traffic", "manage"}}
	var ciphertext string
	var rawGroups []byte
	err := s.db.QueryRow(ctx, `SELECT enabled, webhook_ciphertext, groups FROM mail_log_settings WHERE singleton`).
		Scan(&settings.Enabled, &ciphertext, &rawGroups)
	if errors.Is(err, pgx.ErrNoRows) {
		return settings, "", nil
	}
	if err != nil {
		return settings, "", err
	}
	var groups []string
	if json.Unmarshal(rawGroups, &groups) == nil {
		settings.Groups = sanitizeMailLogGroups(groups)
	}
	settings.Configured = ciphertext != ""
	return settings, ciphertext, nil
}

// auditMailAccess logs that someone opened a mailbox, at most once per person and mailbox
// every 30 minutes, so webmail refreshes and bot clicks do not flood the log.
func (s *server) auditMailAccess(c *fiber.Ctx, who, mailboxPublic string, event auditEvent) {
	key := "mail:access:" + who + ":" + mailboxPublic
	if ok, err := s.redis.SetNX(c.Context(), key, "1", mailLogAccessEvery).Result(); err != nil || !ok {
		return
	}
	s.audit(c, event)
}

// dispatchMailLog posts one mail event to the mail log webhook. Errors are not logged in
// detail because Discord error bodies can echo the webhook token.
func (s *server) dispatchMailLog(event auditEvent) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	settings, ciphertext, err := s.loadMailLogSettings(ctx)
	if err != nil || !settings.Enabled || ciphertext == "" {
		return
	}
	group := mailLogGroup(event.Action)
	allowed := false
	for _, value := range settings.Groups {
		allowed = allowed || value == group
	}
	if !allowed {
		return
	}
	webhookURL, err := decryptSecret(ciphertext, s.cfg.webhookKey)
	if err != nil || !validDiscordWebhookURL(webhookURL) {
		return
	}
	payload := fiber.Map{
		"username":         "NEXORA Mail Log",
		"embeds":           []fiber.Map{buildMailLogEmbed(event)},
		"allowed_mentions": fiber.Map{"parse": []string{}},
	}
	if err := sendDiscordWebhook(ctx, webhookURL, payload); err != nil {
		fmt.Printf("mail log delivery failed: action=%s\n", event.Action)
	}
}

var mailLogTitles = map[string]string{
	"mail.access.webmail":                  "เปิดกล่องเมลบนเว็บ",
	"mail.access.bot":                      "เปิดกล่องเมลผ่านบอท",
	"mail.message.sent":                    "ส่งเมล",
	"mail.message.received":                "มีเมลเข้า",
	"mail.mailbox.created":                 "สร้างกล่องเมล",
	"mail.mailbox.member_added":            "เพิ่มสมาชิกในกล่อง",
	"mail.alias.created":                   "เพิ่มชื่อแฝง (alias)",
	"mail.app_password.created":            "สร้างรหัสผ่านแอป",
	"mail.app_password.revoked":            "ยกเลิกรหัสผ่านแอป",
	"mail.domain.created":                  "เพิ่มโดเมน",
	"mail.domain.verified":                 "ตรวจ DNS โดเมน",
	"mail.domain.status":                   "เปลี่ยนสถานะโดเมน",
	"mail.domain.dns_auto_configured":      "ตั้ง DNS อัตโนมัติ",
	"mail.stalwart.synced":                 "ซิงก์เซิร์ฟเวอร์เมล",
	"mail.resend_settings.updated":         "แก้ไขการตั้งค่า Resend",
	"mail.bot_settings_updated":            "แก้ไขการสร้างเมลผ่านบอท",
	"mail.log_settings.updated":            "แก้ไขการตั้งค่า log อีเมล",
	"mail.discord.bind":                    "เพิ่มคนดูเมลผ่านบอท",
	"mail.discord.unbind":                  "เอาคนออกจากกล่อง (บอท)",
	"mail.discord.mailbox_created":         "สร้างกล่องเมลผ่านบอท",
	"mail.discord.app_password_created":    "สร้างรหัสผ่านแอปผ่านบอท",
	"mail.discord.app_password_revoked":    "ยกเลิกรหัสผ่านแอปผ่านบอท",
	"mail.discord.message_moved":           "ย้ายเมลผ่านบอท",
	"mail.discord.admin_mailbox_created":   "แอดมินสร้างกล่องเมล (บอท)",
	"mail.discord.admin_mailbox_suspended": "แอดมินระงับกล่องเมล (บอท)",
	"mail.discord.admin_mailbox_resumed":   "แอดมินเปิดกล่องเมลคืน (บอท)",
	"mail.discord.admin_mailbox_deleted":   "แอดมินลบกล่องเมล (บอท)",
	"mail.discord.admin_domain_status":     "แอดมินเปลี่ยนสถานะโดเมน (บอท)",
	"mail.discord.settings_updated":        "แอดมินแก้ไขการสร้างเมล (บอท)",
	"mail.message.moved":                   "ย้ายเมล",
	"mail.log_settings.tested":             "ทดสอบเว็บฮุก log อีเมล",
}

// discordText escapes Discord markdown in text that comes from users or mail.
func discordText(value string, limit int) string {
	value = clipDiscordText(strings.ReplaceAll(value, "\n", " "), limit)
	replacer := strings.NewReplacer(`\`, `\\`, "*", `\*`, "_", `\_`, "~", `\~`, "`", "\\`", "|", `\|`, ">", `\>`, "[", `\[`, "]", `\]`)
	return replacer.Replace(value)
}

func mailLogMeta(event auditEvent, key string) string {
	if event.Metadata == nil {
		return ""
	}
	switch value := event.Metadata[key].(type) {
	case string:
		return strings.TrimSpace(value)
	case []string:
		return strings.Join(value, ", ")
	case int, int64, float64, bool:
		return fmt.Sprint(value)
	default:
		return ""
	}
}

func buildMailLogEmbed(event auditEvent) fiber.Map {
	title := mailLogTitles[event.Action]
	if title == "" {
		title = event.Action
	}
	color := map[string]int{"access": 0x6B7A90, "traffic": 0x2E7EFF, "manage": 0xE3AA52, "messages": 0x8B5CF6}[mailLogGroup(event.Action)]
	for _, word := range []string{"deleted", "suspended", "revoked", "unbind"} {
		if strings.Contains(event.Action, word) {
			color = 0xF43F5E
		}
	}
	if event.Outcome == "failure" {
		color = 0xF43F5E
		title += " (ไม่สำเร็จ)"
	}

	actor := "ระบบ"
	if event.Actor != nil && event.Actor.Username != "" {
		actor = "@" + discordText(event.Actor.Username, 60)
	}
	if discordID := mailLogMeta(event, "actorDiscordId"); validDiscordSnowflake(discordID) {
		if actor == "ระบบ" {
			actor = "<@" + discordID + ">"
		} else {
			actor += " · <@" + discordID + ">"
		}
	}

	fields := []fiber.Map{{"name": "ทำโดย", "value": actor, "inline": true}}
	add := func(name, value string, inline bool) {
		if strings.TrimSpace(value) != "" {
			fields = append(fields, fiber.Map{"name": name, "value": value, "inline": inline})
		}
	}
	add("กล่องเมล", discordText(firstNonEmpty(mailLogMeta(event, "address"), mailLogMeta(event, "mailbox")), 120), true)
	add("โดเมน", discordText(mailLogMeta(event, "domain"), 120), true)
	add("จาก", discordText(mailLogMeta(event, "from"), 200), false)
	add("ถึง", discordText(mailLogMeta(event, "to"), 400), false)
	add("หัวเรื่อง", discordText(mailLogMeta(event, "subject"), 200), false)
	add("สถานะ", discordText(mailLogMeta(event, "status"), 60), true)
	add("รายละเอียด", discordText(mailLogMeta(event, "detail"), 300), false)
	// Bot requests come from the bot container, so their IP and "device" say nothing useful.
	if event.IPAddress != "" && !isPrivateIP(event.IPAddress) {
		where := event.IPAddress
		if event.Geo != nil && event.Geo.Country != "" {
			where += " · " + event.Geo.Country
		}
		add("IP", discordText(where, 120), true)
		add("อุปกรณ์", discordText(mailLogMeta(event, "device"), 120), true)
	}

	return fiber.Map{
		"title":  title,
		"color":  color,
		"fields": fields,
		"footer": fiber.Map{"text": "NEXORA Mail Log · " + thaiDateTime(time.Now())},
	}
}

// mailRecipientList joins recipient addresses for the log ("a@x, b@y +3").
func mailRecipientList(groups ...[]mailRecipientInput) string {
	addresses := []string{}
	for _, group := range groups {
		for _, recipient := range group {
			if address := normalizeRecipient(recipient.Address); address != "" {
				addresses = append(addresses, address)
			}
		}
	}
	if len(addresses) > 5 {
		return strings.Join(addresses[:5], ", ") + fmt.Sprintf(" +%d", len(addresses)-5)
	}
	return strings.Join(addresses, ", ")
}

func (s *server) getAdminMailLogSettings(c *fiber.Ctx) error {
	settings, _, err := s.loadMailLogSettings(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(settings)
}

func (s *server) updateAdminMailLogSettings(c *fiber.Ctx) error {
	var input mailLogSettings
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	_, ciphertext, err := s.loadMailLogSettings(c.Context())
	if err != nil {
		return err
	}
	webhookURL := strings.TrimSpace(input.WebhookURL)
	switch {
	case input.ClearWebhook:
		ciphertext = ""
	case webhookURL != "":
		if !validDiscordWebhookURL(webhookURL) {
			return fiber.NewError(fiber.StatusBadRequest, "URL ต้องเป็น Discord Webhook (https://discord.com/api/webhooks/…)")
		}
		ciphertext, err = encryptSecret(webhookURL, s.cfg.webhookKey)
		if err != nil {
			return err
		}
	}
	if input.Enabled && ciphertext == "" {
		return fiber.NewError(fiber.StatusBadRequest, "ใส่ Discord Webhook URL ก่อนเปิดใช้")
	}
	groups := sanitizeMailLogGroups(input.Groups)
	rawGroups, _ := json.Marshal(groups)
	if _, err := s.db.Exec(c.Context(), `
		INSERT INTO mail_log_settings (singleton, enabled, webhook_ciphertext, groups, updated_at)
		VALUES (TRUE, $1, $2, $3, NOW())
		ON CONFLICT (singleton) DO UPDATE SET enabled=EXCLUDED.enabled, webhook_ciphertext=EXCLUDED.webhook_ciphertext,
			groups=EXCLUDED.groups, updated_at=NOW()
	`, input.Enabled, ciphertext, rawGroups); err != nil {
		return err
	}
	detail := "หมวด: " + strings.Join(groups, ", ")
	if input.ClearWebhook {
		detail += " · ลบเว็บฮุก"
	} else if webhookURL != "" {
		detail += " · ตั้งเว็บฮุกใหม่"
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "mail", Action: "mail.log_settings.updated", Target: "mail_log_settings",
		Metadata: map[string]any{"status": map[bool]string{true: "เปิด", false: "ปิด"}[input.Enabled], "detail": detail}})
	saved, _, err := s.loadMailLogSettings(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(saved)
}

// testAdminMailLog sends a sample entry to the saved webhook, or to an unsaved URL being typed.
func (s *server) testAdminMailLog(c *fiber.Ctx) error {
	var input struct {
		WebhookURL string `json:"webhookUrl"`
	}
	_ = c.BodyParser(&input)
	webhookURL := strings.TrimSpace(input.WebhookURL)
	if webhookURL == "" {
		_, ciphertext, err := s.loadMailLogSettings(c.Context())
		if err != nil {
			return err
		}
		if ciphertext != "" {
			webhookURL, _ = decryptSecret(ciphertext, s.cfg.webhookKey)
		}
	}
	if !validDiscordWebhookURL(webhookURL) {
		return fiber.NewError(fiber.StatusBadRequest, "ยังไม่มี Discord Webhook URL ที่ใช้ได้")
	}
	event := auditEvent{Actor: current(c), Category: "mail", Action: "mail.log_settings.tested", Outcome: "success",
		IPAddress: extractRealIP(c), Metadata: map[string]any{"detail": "ถ้าเห็นข้อความนี้ แปลว่าเว็บฮุกใช้งานได้"}}
	payload := fiber.Map{
		"username":         "NEXORA Mail Log",
		"embeds":           []fiber.Map{buildMailLogEmbed(event)},
		"allowed_mentions": fiber.Map{"parse": []string{}},
	}
	if err := sendDiscordWebhook(c.Context(), webhookURL, payload); err != nil {
		return fiber.NewError(fiber.StatusBadGateway, "ส่งไป Discord ไม่สำเร็จ ตรวจว่า URL ถูกต้องและเว็บฮุกยังไม่ถูกลบ")
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// auditMailSent logs a sent message: the mailbox, the recipients and the subject, never the body.
func (s *server) auditMailSent(c *fiber.Ctx, actor *currentUser, input mailComposeInput, from string) {
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.message.sent", Target: "mailbox", TargetID: input.MailboxID,
		Metadata: map[string]any{
			"address": from, "from": from, "to": mailRecipientList(input.To, input.CC, input.BCC),
			"subject": firstNonEmpty(strings.TrimSpace(input.Subject), "(ไม่มีหัวข้อ)"),
		}})
}
