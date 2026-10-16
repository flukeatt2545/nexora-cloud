package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"net/http"
	mailaddr "net/mail"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"

	"nexora-cloud-api/internal/mailsanitize"
)

const (
	mailDefaultQuota       int64 = 1024 * 1024 * 1024
	mailMaxAttachmentBytes int64 = 20 * 1024 * 1024
	mailMaxRecipients            = 20
	mailDefaultDailyLimit        = 100
)

var (
	mailDomainPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	mailLocalPattern  = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$`)
	mailTagStripper   = regexp.MustCompile(`(?s)<[^>]*>`)
)

type mailRecipientInput struct {
	Address string `json:"address"`
	Name    string `json:"name"`
}

type mailAttachmentInput struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
	// ContentID is set only for received mail copied into Stalwart; webmail uploads have none.
	ContentID string `json:"-"`
}

var mailContentIDPattern = regexp.MustCompile(`^[A-Za-z0-9!#$%&'*+/=?^_{|}~.@-]{1,200}$`)

// mailContentID strips the angle brackets from a Content-ID and rejects anything that could
// break the MIME header or the HTML attribute it ends up in.
func mailContentID(value string) string {
	value = strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(value), "<"), ">")
	if !mailContentIDPattern.MatchString(value) {
		return ""
	}
	return value
}

type mailComposeInput struct {
	MailboxID   string                `json:"mailboxId"`
	To          []mailRecipientInput  `json:"to"`
	CC          []mailRecipientInput  `json:"cc"`
	BCC         []mailRecipientInput  `json:"bcc"`
	Subject     string                `json:"subject"`
	HTML        string                `json:"html"`
	Text        string                `json:"text"`
	InReplyTo   string                `json:"inReplyTo"`
	References  []string              `json:"references"`
	Attachments []mailAttachmentInput `json:"attachments"`
}

type resendDomainResponse struct {
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Status  string          `json:"status"`
	Records json.RawMessage `json:"records"`
}

func normalizeMailDomain(value string) string {
	value = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(value), "."))
	if len(value) > 253 || !mailDomainPattern.MatchString(value) {
		return ""
	}
	return value
}

func normalizeMailLocal(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) < 1 || len(value) > 64 || !mailLocalPattern.MatchString(value) {
		return ""
	}
	return value
}

func normalizeRecipient(value string) string {
	parsed, err := mailaddr.ParseAddress(strings.TrimSpace(value))
	if err != nil || len(parsed.Address) > 254 {
		return ""
	}
	parts := strings.Split(parsed.Address, "@")
	if len(parts) != 2 || normalizeMailLocal(parts[0]) == "" || normalizeMailDomain(parts[1]) == "" {
		return ""
	}
	return strings.ToLower(parsed.Address)
}

func sanitizeMailHTML(value string) string {
	return mailsanitize.Sanitize(value)
}

func safeMailBodyHTML(htmlBody, textBody string) string {
	if strings.TrimSpace(htmlBody) != "" {
		return sanitizeMailHTML(htmlBody)
	}
	escaped := html.EscapeString(textBody)
	return "<p>" + strings.ReplaceAll(escaped, "\n", "<br>") + "</p>"
}

func mailPlainText(htmlBody, fallback string) string {
	if strings.TrimSpace(fallback) != "" {
		return strings.TrimSpace(fallback)
	}
	plain := mailTagStripper.ReplaceAllString(strings.ReplaceAll(htmlBody, "<br>", "\n"), " ")
	plain = html.UnescapeString(plain)
	return strings.TrimSpace(strings.Join(strings.Fields(plain), " "))
}

func (s *server) effectiveResendSettings(ctx context.Context) (string, string, error) {
	apiKey, webhookSecret := s.cfg.resendAPIKey, s.cfg.resendWebhookSecret
	var apiCiphertext, webhookCiphertext string
	err := s.db.QueryRow(ctx, `SELECT resend_api_key_ciphertext,resend_webhook_secret_ciphertext FROM mail_provider_settings WHERE singleton=TRUE`).Scan(&apiCiphertext, &webhookCiphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		return apiKey, webhookSecret, nil
	}
	if err != nil {
		return "", "", err
	}
	if apiCiphertext != "" {
		apiKey, err = decryptSecret(apiCiphertext, s.cfg.webhookKey)
		if err != nil {
			return "", "", fmt.Errorf("decrypt resend api key: %w", err)
		}
	}
	if webhookCiphertext != "" {
		webhookSecret, err = decryptSecret(webhookCiphertext, s.cfg.webhookKey)
		if err != nil {
			return "", "", fmt.Errorf("decrypt resend webhook secret: %w", err)
		}
	}
	return strings.TrimSpace(apiKey), strings.TrimSpace(webhookSecret), nil
}

func (s *server) resendRequestWithKey(ctx context.Context, apiKey, method, path string, input any, output any) error {
	if apiKey == "" {
		return fiber.NewError(fiber.StatusServiceUnavailable, "ยังไม่ได้ตั้งค่า Resend API Key")
	}
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.cfg.resendAPIBaseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var providerErr struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &providerErr)
		if providerErr.Message == "" {
			providerErr.Message = fmt.Sprintf("Resend ตอบกลับ HTTP %d", resp.StatusCode)
		}
		return fmt.Errorf("resend: %s", providerErr.Message)
	}
	if output != nil && len(data) > 0 {
		return json.Unmarshal(data, output)
	}
	return nil
}

func (s *server) resendRequest(ctx context.Context, method, path string, input any, output any) error {
	apiKey, _, err := s.effectiveResendSettings(ctx)
	if err != nil {
		return err
	}
	return s.resendRequestWithKey(ctx, apiKey, method, path, input, output)
}

func (s *server) resendConfigured(ctx context.Context) bool {
	apiKey, webhookSecret, err := s.effectiveResendSettings(ctx)
	return err == nil && apiKey != "" && webhookSecret != ""
}

func mailDomainJSON(records json.RawMessage) []byte {
	if len(records) == 0 || string(records) == "null" {
		return []byte("[]")
	}
	return records
}

func (s *server) listMailDomains(c *fiber.Ctx) error {
	actor := current(c)
	rows, err := s.db.Query(c.Context(), `
		SELECT d.public_id,d.domain,d.kind,d.status,d.dns_records,d.verified_at,d.approved_at,
		       d.owner_user_id,COALESCE(u.identifier,''),COUNT(m.id) FILTER (WHERE m.deleted_at IS NULL)
		FROM mail_domains d
		LEFT JOIN users u ON u.id=d.owner_user_id
		LEFT JOIN mailboxes m ON m.domain_id=d.id
		WHERE d.deleted_at IS NULL AND (d.owner_user_id=$1 OR EXISTS(
			SELECT 1 FROM mailboxes mb JOIN mailbox_members mm ON mm.mailbox_id=mb.id
			WHERE mb.domain_id=d.id AND mm.user_id=$1 AND mb.deleted_at IS NULL
		))
		GROUP BY d.id,u.identifier ORDER BY d.created_at DESC`, actor.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, domain, kind, status, ownerName string
		var records []byte
		var verifiedAt, approvedAt *time.Time
		var ownerID, count int64
		if err := rows.Scan(&id, &domain, &kind, &status, &records, &verifiedAt, &approvedAt, &ownerID, &ownerName, &count); err != nil {
			return err
		}
		var dns any
		_ = json.Unmarshal(records, &dns)
		items = append(items, fiber.Map{"id": id, "domain": domain, "kind": kind, "status": status, "dnsRecords": dns, "verifiedAt": verifiedAt, "approvedAt": approvedAt, "ownerUserId": ownerID, "ownerUsername": ownerName, "mailboxCount": count})
	}
	return c.JSON(fiber.Map{"items": items, "providerConfigured": s.resendConfigured(c.Context())})
}

func (s *server) createMailDomain(c *fiber.Ctx) error {
	actor := current(c)
	var input struct {
		Domain string `json:"domain"`
		Kind   string `json:"kind"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	domain := normalizeMailDomain(input.Domain)
	if domain == "" {
		return c.Status(400).JSON(apiError{Error: "รูปแบบโดเมนไม่ถูกต้อง", Code: "invalid_domain"})
	}
	kind := "custom"
	if input.Kind == "platform" {
		if actor.Role != "superadmin" {
			return c.SendStatus(fiber.StatusForbidden)
		}
		kind = "platform"
	}
	var provider resendDomainResponse
	if err := s.resendRequest(c.Context(), http.MethodPost, "/domains", map[string]any{"name": domain, "capabilities": map[string]string{"sending": "enabled", "receiving": "enabled"}}, &provider); err != nil {
		return c.Status(502).JSON(apiError{Error: err.Error(), Code: "provider_error"})
	}
	publicID := randomHex(16)
	_, err := s.db.Exec(c.Context(), `
		INSERT INTO mail_domains(public_id,owner_user_id,domain,kind,provider_domain_id,status,dns_records,provider_status)
		VALUES($1,$2,$3,$4,$5,'pending_dns',$6,$7)`, publicID, actor.ID, domain, kind, provider.ID, mailDomainJSON(provider.Records), []byte(`{"status":"created"}`))
	if err != nil {
		if strings.Contains(err.Error(), "mail_domains_domain_active_unique") {
			return c.Status(409).JSON(apiError{Error: "โดเมนนี้ถูกเพิ่มแล้ว", Code: "domain_exists"})
		}
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.domain.created", Target: "mail_domain", TargetID: publicID, Metadata: map[string]any{"domain": domain}})
	return c.Status(201).JSON(fiber.Map{"id": publicID, "domain": domain, "status": "pending_dns", "dnsRecords": json.RawMessage(mailDomainJSON(provider.Records))})
}

func (s *server) verifyMailDomain(c *fiber.Ctx) error {
	actor := current(c)
	var dbID int64
	var providerID string
	err := s.db.QueryRow(c.Context(), `SELECT id,COALESCE(provider_domain_id,'') FROM mail_domains WHERE public_id=$1 AND deleted_at IS NULL AND (owner_user_id=$2 OR $3 IN ('admin','superadmin'))`, c.Params("id"), actor.ID, actor.Role).Scan(&dbID, &providerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	if providerID == "" {
		return c.Status(409).JSON(apiError{Error: "โดเมนยังไม่เชื่อมกับ Resend"})
	}
	_ = s.resendRequest(c.Context(), http.MethodPost, "/domains/"+providerID+"/verify", nil, nil)
	var provider resendDomainResponse
	if err := s.resendRequest(c.Context(), http.MethodGet, "/domains/"+providerID, nil, &provider); err != nil {
		return c.Status(502).JSON(apiError{Error: err.Error(), Code: "provider_error"})
	}
	verified := strings.EqualFold(provider.Status, "verified")
	status := "pending_dns"
	if verified {
		status = "pending_approval"
	}
	_, err = s.db.Exec(c.Context(), `UPDATE mail_domains SET status=$2,dns_records=$3,provider_status=$4,verified_at=CASE WHEN $5 THEN COALESCE(verified_at,NOW()) ELSE verified_at END,updated_at=NOW() WHERE id=$1`, dbID, status, mailDomainJSON(provider.Records), []byte(fmt.Sprintf(`{"status":%q}`, provider.Status)), verified)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"status": status, "providerStatus": provider.Status, "dnsRecords": json.RawMessage(mailDomainJSON(provider.Records))})
}

func (s *server) autoConfigureMailDomainDNS(c *fiber.Ctx) error {
	actor := current(c)
	var dbID int64
	var providerID, domain string
	err := s.db.QueryRow(c.Context(), `SELECT id,COALESCE(provider_domain_id,''),domain FROM mail_domains WHERE public_id=$1 AND deleted_at IS NULL AND (owner_user_id=$2 OR $3 IN ('admin','superadmin'))`, c.Params("id"), actor.ID, actor.Role).Scan(&dbID, &providerID, &domain)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	if providerID == "" {
		return c.Status(409).JSON(apiError{Error: "โดเมนยังไม่เชื่อมกับ Resend"})
	}
	var provider resendDomainResponse
	if err := s.resendRequest(c.Context(), http.MethodGet, "/domains/"+providerID, nil, &provider); err != nil {
		return c.Status(502).JSON(apiError{Error: err.Error(), Code: "provider_error"})
	}
	var records []map[string]any
	if err := json.Unmarshal(mailDomainJSON(provider.Records), &records); err != nil || len(records) == 0 {
		return c.Status(409).JSON(apiError{Error: "Resend ยังไม่ส่งรายการ DNS สำหรับโดเมนนี้"})
	}
	zoneID, err := s.cloudflareZoneForDomain(c.Context(), domain)
	if err != nil {
		return c.Status(400).JSON(apiError{Error: err.Error(), Code: "cloudflare_zone_not_found"})
	}
	configured := 0
	for _, record := range records {
		payload, recordType, name, parseErr := cloudflareMailRecord(record, domain)
		if parseErr != nil {
			return c.Status(400).JSON(apiError{Error: parseErr.Error(), Code: "unsupported_dns_record"})
		}
		if err := s.upsertCloudflareMailRecord(c.Context(), zoneID, payload, recordType, name); err != nil {
			return c.Status(502).JSON(apiError{Error: "ตั้งค่า " + recordType + " " + name + " ไม่สำเร็จ: " + err.Error(), Code: "cloudflare_error"})
		}
		configured++
	}
	_, err = s.db.Exec(c.Context(), `UPDATE mail_domains SET dns_records=$2,updated_at=NOW() WHERE id=$1`, dbID, mailDomainJSON(provider.Records))
	if err != nil {
		return err
	}
	_ = s.resendRequest(c.Context(), http.MethodPost, "/domains/"+providerID+"/verify", nil, nil)
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.domain.dns_auto_configured", Target: "mail_domain", TargetID: c.Params("id"), Metadata: map[string]any{"domain": domain, "recordCount": configured}})
	return c.JSON(fiber.Map{"configured": configured, "message": fmt.Sprintf("ตั้งค่า DNS บน Cloudflare แล้ว %d รายการ", configured)})
}

func (s *server) mailboxAccess(ctx context.Context, publicID string, userID int64) (int64, string, string, string, error) {
	var id int64
	var local, domain, role string
	err := s.db.QueryRow(ctx, `SELECT m.id,m.local_part,d.domain,mm.role FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id JOIN mailbox_members mm ON mm.mailbox_id=m.id WHERE m.public_id=$1 AND mm.user_id=$2 AND m.status='active' AND m.deleted_at IS NULL AND d.deleted_at IS NULL`, publicID, userID).Scan(&id, &local, &domain, &role)
	return id, local, domain, role, err
}

func (s *server) mailBootstrap(c *fiber.Ctx) error {
	actor := current(c)
	rows, err := s.db.Query(c.Context(), `
		SELECT m.public_id,m.local_part,d.domain,m.display_name,m.quota_bytes,m.used_bytes,m.daily_send_limit,m.status,mm.role,
		(SELECT COUNT(*) FROM mail_messages msg LEFT JOIN mail_message_user_state us ON us.message_id=msg.id AND us.user_id=$1 WHERE msg.mailbox_id=m.id AND msg.folder='inbox' AND us.read_at IS NULL)
		FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id JOIN mailbox_members mm ON mm.mailbox_id=m.id
		WHERE mm.user_id=$1 AND m.status='active' AND m.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active' ORDER BY d.domain,m.local_part`, actor.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	var totalUnread int64
	for rows.Next() {
		var id, local, domain, name, status, role string
		var quota, used, unread int64
		var limit int
		if err := rows.Scan(&id, &local, &domain, &name, &quota, &used, &limit, &status, &role, &unread); err != nil {
			return err
		}
		totalUnread += unread
		items = append(items, fiber.Map{"id": id, "address": local + "@" + domain, "displayName": name, "quotaBytes": quota, "usedBytes": used, "dailySendLimit": limit, "status": status, "role": role, "unread": unread})
	}
	return c.JSON(fiber.Map{"mailboxes": items, "unread": totalUnread, "limits": fiber.Map{"maxRecipients": mailMaxRecipients, "maxAttachmentBytes": mailMaxAttachmentBytes}})
}

var errMailAddressTaken = errors.New("mail address taken")

type mailboxCreated struct {
	PublicID       string
	Address        string
	ProvisionState string
	ProvisionError string
}

// createMailboxRecord inserts a mailbox with its owner and provisions it in Stalwart.
// Callers decide who may use the domain and pass a normalised local part and a checked quota.
func (s *server) createMailboxRecord(ctx context.Context, domainID int64, domain, local, displayName string, ownerID, createdBy, quota int64) (mailboxCreated, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return mailboxCreated{}, err
	}
	defer tx.Rollback(ctx)
	var collision bool
	_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mailboxes WHERE domain_id=$1 AND LOWER(local_part)=LOWER($2) AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM mail_aliases WHERE domain_id=$1 AND LOWER(local_part)=LOWER($2) AND deleted_at IS NULL)`, domainID, local).Scan(&collision)
	if collision {
		return mailboxCreated{}, errMailAddressTaken
	}
	publicID := randomHex(16)
	var mailboxID int64
	err = tx.QueryRow(ctx, `INSERT INTO mailboxes(public_id,domain_id,local_part,display_name,quota_bytes,daily_send_limit,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, publicID, domainID, local, strings.TrimSpace(displayName), quota, mailDefaultDailyLimit, createdBy).Scan(&mailboxID)
	if err != nil {
		return mailboxCreated{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO mailbox_members(mailbox_id,user_id,role) VALUES($1,$2,'owner')`, mailboxID, ownerID); err != nil {
		return mailboxCreated{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return mailboxCreated{}, err
	}
	result := mailboxCreated{PublicID: publicID, Address: local + "@" + domain, ProvisionState: "provisioned"}
	if _, err := s.provisionStalwartMailbox(ctx, mailboxID); err != nil {
		result.ProvisionState = "failed"
		result.ProvisionError = err.Error()
		_, _ = s.db.Exec(ctx, `UPDATE mailboxes SET stalwart_provision_state='failed',stalwart_last_error=$2 WHERE id=$1`, mailboxID, result.ProvisionError)
	}
	return result, nil
}

func (s *server) createMailbox(c *fiber.Ctx) error {
	actor := current(c)
	var input struct {
		DomainID, LocalPart, DisplayName, OwnerUsername string
		QuotaBytes                                      int64
	}
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	local := normalizeMailLocal(input.LocalPart)
	if local == "" {
		return c.Status(400).JSON(apiError{Error: "ชื่ออีเมลไม่ถูกต้อง"})
	}
	var domainID, ownerID int64
	var domain string
	err := s.db.QueryRow(c.Context(), `SELECT id,domain,owner_user_id FROM mail_domains WHERE public_id=$1 AND status='active' AND deleted_at IS NULL AND (owner_user_id=$2 OR $3 IN ('admin','superadmin'))`, input.DomainID, actor.ID, actor.Role).Scan(&domainID, &domain, &ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(404).JSON(apiError{Error: "ไม่พบโดเมนที่พร้อมใช้งาน"})
	}
	if err != nil {
		return err
	}
	if input.OwnerUsername != "" {
		if err := s.db.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(identifier)=LOWER($1) AND status='active'`, strings.TrimSpace(input.OwnerUsername)).Scan(&ownerID); err != nil {
			return c.Status(404).JSON(apiError{Error: "ไม่พบผู้ใช้เจ้าของกล่อง"})
		}
	}
	quota := input.QuotaBytes
	if quota == 0 {
		quota = mailDefaultQuota
	}
	if quota < 10*1024*1024 || quota > 100*1024*1024*1024 {
		return c.Status(400).JSON(apiError{Error: "โควตาต้องอยู่ระหว่าง 10 MB ถึง 100 GB"})
	}
	created, err := s.createMailboxRecord(c.Context(), domainID, domain, local, input.DisplayName, ownerID, actor.ID, quota)
	if errors.Is(err, errMailAddressTaken) {
		return c.Status(409).JSON(apiError{Error: "ที่อยู่อีเมลนี้ถูกใช้แล้ว"})
	}
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.mailbox.created", Target: "mailbox", TargetID: created.PublicID,
		Metadata: map[string]any{"address": created.Address, "detail": fmt.Sprintf("พื้นที่ %d MB", quota/(1024*1024))}})
	return c.Status(201).JSON(fiber.Map{"id": created.PublicID, "address": created.Address, "provisionState": created.ProvisionState, "provisionError": created.ProvisionError})
}

func (s *server) addMailboxMember(c *fiber.Ctx) error {
	actor := current(c)
	mailboxID, boxLocal, boxDomain, role, err := s.mailboxAccess(c.Context(), c.Params("id"), actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	if role != "owner" && actor.Role != "superadmin" {
		return c.SendStatus(403)
	}
	var input struct {
		Username string `json:"username"`
	}
	if c.BodyParser(&input) != nil {
		return c.SendStatus(400)
	}
	var userID int64
	if err := s.db.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(identifier)=LOWER($1) AND status='active'`, strings.TrimSpace(input.Username)).Scan(&userID); err != nil {
		return c.Status(404).JSON(apiError{Error: "ไม่พบผู้ใช้"})
	}
	_, err = s.db.Exec(c.Context(), `INSERT INTO mailbox_members(mailbox_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT(mailbox_id,user_id) DO NOTHING`, mailboxID, userID)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.mailbox.member_added", Target: "mailbox", TargetID: c.Params("id"),
		Metadata: map[string]any{"address": boxLocal + "@" + boxDomain, "detail": "เพิ่ม @" + strings.TrimSpace(input.Username)}})
	return c.SendStatus(204)
}

func (s *server) createMailAlias(c *fiber.Ctx) error {
	actor := current(c)
	mailboxID, boxLocal, domain, role, err := s.mailboxAccess(c.Context(), c.Params("id"), actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	if role != "owner" && actor.Role != "superadmin" {
		return c.SendStatus(403)
	}
	var input struct {
		LocalPart string `json:"localPart"`
	}
	if c.BodyParser(&input) != nil {
		return c.SendStatus(400)
	}
	local := normalizeMailLocal(input.LocalPart)
	if local == "" {
		return c.Status(400).JSON(apiError{Error: "Alias ไม่ถูกต้อง"})
	}
	var domainID int64
	if err := s.db.QueryRow(c.Context(), `SELECT domain_id FROM mailboxes WHERE id=$1`, mailboxID).Scan(&domainID); err != nil {
		return err
	}
	var collision bool
	_ = s.db.QueryRow(c.Context(), `SELECT EXISTS(SELECT 1 FROM mailboxes WHERE domain_id=$1 AND LOWER(local_part)=LOWER($2) AND deleted_at IS NULL) OR EXISTS(SELECT 1 FROM mail_aliases WHERE domain_id=$1 AND LOWER(local_part)=LOWER($2) AND deleted_at IS NULL)`, domainID, local).Scan(&collision)
	if collision {
		return c.Status(409).JSON(apiError{Error: "ที่อยู่นี้ถูกใช้แล้ว"})
	}
	id := randomHex(16)
	_, err = s.db.Exec(c.Context(), `INSERT INTO mail_aliases(public_id,domain_id,mailbox_id,local_part,created_by) VALUES($1,$2,$3,$4,$5)`, id, domainID, mailboxID, local, actor.ID)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.alias.created", Target: "mailbox", TargetID: c.Params("id"),
		Metadata: map[string]any{"address": boxLocal + "@" + domain, "detail": "ชื่อแฝง " + local + "@" + domain}})
	return c.Status(201).JSON(fiber.Map{"id": id, "address": local + "@" + domain})
}

func parseMailCursor(value string) int64 { parsed, _ := strconv.ParseInt(value, 10, 64); return parsed }

func (s *server) listMailMessages(c *fiber.Ctx) error {
	actor := current(c)
	mailboxID, boxLocal, boxDomain, _, err := s.mailboxAccess(c.Context(), c.Query("mailboxId"), actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	s.auditMailAccess(c, fmt.Sprintf("u%d", actor.ID), c.Query("mailboxId"), auditEvent{Actor: actor, Category: "mail", Action: "mail.access.webmail",
		Target: "mailbox", TargetID: c.Query("mailboxId"), Metadata: map[string]any{"address": boxLocal + "@" + boxDomain}})
	folder := strings.ToLower(c.Query("folder", "inbox"))
	if folder != "inbox" && folder != "sent" && folder != "draft" && folder != "trash" {
		return c.SendStatus(400)
	}
	query := strings.TrimSpace(c.Query("q"))
	cursor := parseMailCursor(c.Query("cursor"))
	accountID, accountErr := s.stalwartAccountForMailbox(c.Context(), mailboxID)
	if accountErr == nil && accountID != "" {
		return s.listStalwartMessages(c, accountID, folder, query, int(cursor))
	}
	if cursor <= 0 {
		cursor = 1 << 62
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT m.id,m.public_id,COALESCE(t.public_id,''),m.direction,m.folder,m.delivery_status,m.from_address,m.from_name,m.subject,m.body_text,m.size_bytes,
		       COALESCE(m.received_at,m.sent_at,m.created_at),us.read_at IS NOT NULL,us.starred_at IS NOT NULL,
		       COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',r.kind,'address',r.address,'name',r.display_name) ORDER BY r.id) FROM mail_recipients r WHERE r.message_id=m.id),'[]'::jsonb),
		       EXISTS(SELECT 1 FROM mail_attachments a WHERE a.message_id=m.id)
		FROM mail_messages m LEFT JOIN mail_threads t ON t.id=m.thread_id LEFT JOIN mail_message_user_state us ON us.message_id=m.id AND us.user_id=$2
		WHERE m.mailbox_id=$1 AND m.folder=$3 AND m.id<$4 AND ($5='' OR to_tsvector('simple',m.subject||' '||m.body_text) @@ plainto_tsquery('simple',$5))
		ORDER BY m.id DESC LIMIT 51`, mailboxID, actor.ID, folder, cursor, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	var next int64
	for rows.Next() {
		var dbID, size int64
		var id, thread, direction, folderValue, status, from, fromName, subject, preview string
		var at time.Time
		var read, starred, hasAttachments bool
		var recipients []byte
		if err := rows.Scan(&dbID, &id, &thread, &direction, &folderValue, &status, &from, &fromName, &subject, &preview, &size, &at, &read, &starred, &recipients, &hasAttachments); err != nil {
			return err
		}
		if len(items) == 50 {
			next = dbID
			break
		}
		if len(preview) > 180 {
			preview = preview[:180]
		}
		items = append(items, fiber.Map{"id": id, "threadId": thread, "direction": direction, "folder": folderValue, "status": status, "from": from, "fromName": fromName, "subject": subject, "preview": preview, "sizeBytes": size, "date": at, "read": read, "starred": starred, "recipients": json.RawMessage(recipients), "hasAttachments": hasAttachments})
	}
	return c.JSON(fiber.Map{"items": items, "nextCursor": next})
}

func (s *server) getMailMessage(c *fiber.Ctx) error {
	actor := current(c)
	if mailboxPublic := strings.TrimSpace(c.Query("mailboxId")); mailboxPublic != "" {
		mailboxID, _, _, _, err := s.mailboxAccess(c.Context(), mailboxPublic, actor.ID)
		if err != nil {
			return c.SendStatus(404)
		}
		accountID, err := s.stalwartAccountForMailbox(c.Context(), mailboxID)
		if err == nil && accountID != "" {
			return s.getStalwartMessage(c, accountID, mailboxPublic, c.Params("id"))
		}
	}
	var mailboxPublic string
	if err := s.db.QueryRow(c.Context(), `SELECT mb.public_id FROM mail_messages m JOIN mailboxes mb ON mb.id=m.mailbox_id WHERE m.public_id=$1`, c.Params("id")).Scan(&mailboxPublic); err != nil {
		return c.SendStatus(404)
	}
	_, _, _, _, err := s.mailboxAccess(c.Context(), mailboxPublic, actor.ID)
	if err != nil {
		return c.SendStatus(404)
	}
	var id, direction, folder, status, from, fromName, subject, textBody, htmlBody, internetMessageID, inReply string
	var refs []string
	var sentAt, receivedAt *time.Time
	var recipients []byte
	err = s.db.QueryRow(c.Context(), `SELECT m.public_id,m.direction,m.folder,m.delivery_status,m.from_address,m.from_name,m.subject,m.body_text,m.body_html,COALESCE(m.internet_message_id,''),COALESCE(m.in_reply_to,''),m.message_references,m.sent_at,m.received_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',r.kind,'address',r.address,'name',r.display_name) ORDER BY r.id) FROM mail_recipients r WHERE r.message_id=m.id),'[]'::jsonb) FROM mail_messages m WHERE m.public_id=$1`, c.Params("id")).Scan(&id, &direction, &folder, &status, &from, &fromName, &subject, &textBody, &htmlBody, &internetMessageID, &inReply, &refs, &sentAt, &receivedAt, &recipients)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `SELECT a.public_id,a.filename,a.content_type,a.size_bytes FROM mail_attachments a JOIN mail_messages m ON m.id=a.message_id WHERE m.public_id=$1 ORDER BY a.id`, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	attachments := []fiber.Map{}
	for rows.Next() {
		var aid, name, ct string
		var size int64
		if err := rows.Scan(&aid, &name, &ct, &size); err != nil {
			return err
		}
		attachments = append(attachments, fiber.Map{"id": aid, "filename": name, "contentType": ct, "sizeBytes": size})
	}
	_, _ = s.db.Exec(c.Context(), `INSERT INTO mail_message_user_state(message_id,user_id,read_at) SELECT id,$2,NOW() FROM mail_messages WHERE public_id=$1 ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=NOW()`, id, actor.ID)
	return c.JSON(fiber.Map{"id": id, "direction": direction, "folder": folder, "status": status, "from": from, "fromName": fromName, "subject": subject, "text": textBody, "html": safeMailBodyHTML(htmlBody, textBody), "internetMessageId": internetMessageID, "inReplyTo": inReply, "references": refs, "sentAt": sentAt, "receivedAt": receivedAt, "recipients": json.RawMessage(recipients), "attachments": attachments})
}

func (s *server) getMailThread(c *fiber.Ctx) error {
	actor := current(c)
	if mailboxPublic := strings.TrimSpace(c.Query("mailboxId")); mailboxPublic != "" {
		mailboxID, _, _, _, err := s.mailboxAccess(c.Context(), mailboxPublic, actor.ID)
		if err != nil {
			return c.SendStatus(404)
		}
		accountID, err := s.stalwartAccountForMailbox(c.Context(), mailboxID)
		if err == nil && accountID != "" {
			raw, err := s.stalwartMethod(c.Context(), "Email/query", map[string]any{"accountId": accountID, "filter": map[string]any{"inThread": c.Params("id")}})
			if err != nil {
				return err
			}
			var queryResult struct {
				IDs []string `json:"ids"`
			}
			if err := json.Unmarshal(raw, &queryResult); err != nil {
				return err
			}
			emails, err := s.stalwartGetEmails(c.Context(), accountID, queryResult.IDs)
			if err != nil {
				return err
			}
			items := []fiber.Map{}
			for _, email := range emails {
				from, fromName := "", ""
				if len(email.From) > 0 {
					from, fromName = email.From[0].Email, email.From[0].Name
				}
				textBody := stalwartBody(email.TextBody, email.BodyValues)
				body, _ := stalwartMessageHTML(email, mailboxPublic)
				items = append(items, fiber.Map{"id": email.ID, "threadId": email.ThreadID, "from": from, "fromName": fromName, "subject": email.Subject, "text": textBody, "html": body, "date": email.ReceivedAt, "recipients": stalwartRecipients(email)})
			}
			return c.JSON(fiber.Map{"items": items})
		}
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT m.public_id,m.direction,m.folder,m.delivery_status,m.from_address,m.from_name,m.subject,m.body_text,m.body_html,
		       COALESCE(m.internet_message_id,''),COALESCE(m.in_reply_to,''),m.message_references,COALESCE(m.received_at,m.sent_at,m.created_at),
		       COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',r.kind,'address',r.address,'name',r.display_name) ORDER BY r.id) FROM mail_recipients r WHERE r.message_id=m.id),'[]'::jsonb)
		FROM mail_threads t JOIN mail_messages m ON m.thread_id=t.id JOIN mailbox_members mm ON mm.mailbox_id=t.mailbox_id
		WHERE t.public_id=$1 AND mm.user_id=$2 ORDER BY m.created_at`, c.Params("id"), actor.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, direction, folder, status, from, fromName, subject, textBody, htmlBody, internetMessageID, inReply string
		var refs []string
		var at time.Time
		var recipients []byte
		if err := rows.Scan(&id, &direction, &folder, &status, &from, &fromName, &subject, &textBody, &htmlBody, &internetMessageID, &inReply, &refs, &at, &recipients); err != nil {
			return err
		}
		items = append(items, fiber.Map{"id": id, "direction": direction, "folder": folder, "status": status, "from": from, "fromName": fromName, "subject": subject, "text": textBody, "html": safeMailBodyHTML(htmlBody, textBody), "internetMessageId": internetMessageID, "inReplyTo": inReply, "references": refs, "date": at, "recipients": json.RawMessage(recipients)})
	}
	if len(items) == 0 {
		return c.SendStatus(404)
	}
	return c.JSON(fiber.Map{"items": items})
}

func normalizedRecipients(groups ...[]mailRecipientInput) ([]mailRecipientInput, error) {
	result := []mailRecipientInput{}
	seen := map[string]bool{}
	for _, group := range groups {
		for _, item := range group {
			address := normalizeRecipient(item.Address)
			if address == "" {
				return nil, fmt.Errorf("อีเมลผู้รับไม่ถูกต้อง: %s", item.Address)
			}
			if !seen[address] {
				seen[address] = true
				item.Address = address
				item.Name = strings.TrimSpace(item.Name)
				result = append(result, item)
			}
		}
	}
	if len(result) == 0 {
		return nil, errors.New("กรุณาระบุผู้รับ")
	}
	if len(result) > mailMaxRecipients {
		return nil, fmt.Errorf("ผู้รับรวมต้องไม่เกิน %d คน", mailMaxRecipients)
	}
	return result, nil
}

type storedMailAttachment struct {
	PublicID, ObjectKey, Filename, ContentType, SHA256 string
	Size                                               int64
	ContentBase64                                      string
}

func (s *server) storeComposeAttachments(ctx context.Context, mailboxPublic string, inputs []mailAttachmentInput) ([]storedMailAttachment, error) {
	if len(inputs) == 0 {
		return nil, nil
	}
	if s.storage == nil {
		return nil, fiber.NewError(503, "object storage unavailable")
	}
	var total int64
	result := make([]storedMailAttachment, 0, len(inputs))
	for _, input := range inputs {
		name := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(input.Filename, "/", "_"), "\\", "_"))
		if name == "" || len(name) > 180 {
			return nil, errors.New("ชื่อไฟล์แนบไม่ถูกต้อง")
		}
		data, err := base64.StdEncoding.DecodeString(input.Content)
		if err != nil {
			return nil, errors.New("ข้อมูลไฟล์แนบไม่ถูกต้อง")
		}
		total += int64(len(data))
		if total > mailMaxAttachmentBytes {
			return nil, fmt.Errorf("ไฟล์แนบรวมต้องไม่เกิน 20 MB")
		}
		sum := sha256.Sum256(data)
		publicID := randomHex(16)
		key := "mail/" + mailboxPublic + "/" + publicID
		ct := strings.TrimSpace(input.ContentType)
		if ct == "" {
			ct = http.DetectContentType(data)
		}
		if _, err = s.storage.PutObject(ctx, s.cfg.s3Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: ct}); err != nil {
			return nil, err
		}
		result = append(result, storedMailAttachment{publicID, key, name, ct, hex.EncodeToString(sum[:]), int64(len(data)), input.Content})
	}
	return result, nil
}

func (s *server) sendMailMessage(c *fiber.Ctx) error {
	actor := current(c)
	var input mailComposeInput
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	mailboxID, local, domain, _, err := s.mailboxAccess(c.Context(), input.MailboxID, actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	idempotency := strings.TrimSpace(c.Get("Idempotency-Key"))
	if len(idempotency) < 16 || len(idempotency) > 128 {
		return c.Status(400).JSON(apiError{Error: "กรุณาส่ง Idempotency-Key ที่ถูกต้อง", Code: "invalid_idempotency_key"})
	}
	var replayed string
	err = s.db.QueryRow(c.Context(), `SELECT public_id FROM mail_messages WHERE mailbox_id=$1 AND idempotency_key=$2`, mailboxID, idempotency).Scan(&replayed)
	if err == nil {
		return c.JSON(fiber.Map{"id": replayed, "replayed": true})
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var mailboxStatus, domainStatus, displayName string
	var dailyLimit int
	var quota, used int64
	err = s.db.QueryRow(c.Context(), `SELECT m.status,d.status,m.display_name,m.daily_send_limit,m.quota_bytes,m.used_bytes FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id WHERE m.id=$1`, mailboxID).Scan(&mailboxStatus, &domainStatus, &displayName, &dailyLimit, &quota, &used)
	if err != nil {
		return err
	}
	if mailboxStatus != "active" || domainStatus != "active" {
		return c.Status(409).JSON(apiError{Error: "กล่องหรือโดเมนถูกระงับ", Code: "mailbox_inactive"})
	}
	all, err := normalizedRecipients(input.To, input.CC, input.BCC)
	if err != nil {
		return c.Status(400).JSON(apiError{Error: err.Error()})
	}
	_ = all
	safeHTML := sanitizeMailHTML(input.HTML)
	textBody := mailPlainText(safeHTML, input.Text)
	if textBody == "" && safeHTML == "" {
		return c.Status(400).JSON(apiError{Error: "กรุณากรอกเนื้อหาอีเมล"})
	}
	if accountID, accountErr := s.stalwartAccountForMailbox(c.Context(), mailboxID); accountErr == nil && accountID != "" {
		if err := s.saveOrSendStalwartMessage(c, mailboxID, input.MailboxID, local+"@"+domain, displayName, textBody, safeHTML, input, true, idempotency); err != nil {
			return c.Status(502).JSON(apiError{Error: err.Error(), Code: "stalwart_send_failed"})
		}
		s.auditMailSent(c, actor, input, local+"@"+domain)
		return nil
	}
	attachments, err := s.storeComposeAttachments(c.Context(), input.MailboxID, input.Attachments)
	if err != nil {
		return c.Status(400).JSON(apiError{Error: err.Error()})
	}
	attachmentsCommitted := false
	defer func() {
		if attachmentsCommitted || s.storage == nil {
			return
		}
		for _, attachment := range attachments {
			_ = s.storage.RemoveObject(context.Background(), s.cfg.s3Bucket, attachment.ObjectKey, minio.RemoveObjectOptions{})
		}
	}()
	var attachmentBytes int64
	for _, a := range attachments {
		attachmentBytes += a.Size
	}
	messageBytes := attachmentBytes + int64(len(textBody)+len(safeHTML))
	if used+messageBytes > quota {
		return c.Status(409).JSON(apiError{Error: "พื้นที่กล่องอีเมลไม่เพียงพอ", Code: "quota_exceeded"})
	}
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())
	var existing string
	err = tx.QueryRow(c.Context(), `SELECT public_id FROM mail_messages WHERE mailbox_id=$1 AND idempotency_key=$2`, mailboxID, idempotency).Scan(&existing)
	if err == nil {
		return c.JSON(fiber.Map{"id": existing, "replayed": true})
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err = tx.QueryRow(c.Context(), `SELECT quota_bytes,used_bytes FROM mailboxes WHERE id=$1 FOR UPDATE`, mailboxID).Scan(&quota, &used); err != nil {
		return err
	}
	if used+messageBytes > quota {
		return c.Status(409).JSON(apiError{Error: "พื้นที่กล่องอีเมลไม่เพียงพอ", Code: "quota_exceeded"})
	}
	var count int
	err = tx.QueryRow(c.Context(), `INSERT INTO mail_daily_usage(mailbox_id,usage_date,sent_count) VALUES($1,CURRENT_DATE,1) ON CONFLICT(mailbox_id,usage_date) DO UPDATE SET sent_count=mail_daily_usage.sent_count+1 WHERE mail_daily_usage.sent_count<$2 RETURNING sent_count`, mailboxID, dailyLimit).Scan(&count)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(429).JSON(apiError{Error: "ส่งอีเมลครบโควตาประจำวันแล้ว", Code: "daily_limit"})
	}
	if err != nil {
		return err
	}
	threadID := int64(0)
	subject := strings.TrimSpace(input.Subject)
	if len(subject) > 300 {
		subject = subject[:300]
	}
	if strings.TrimSpace(input.InReplyTo) != "" {
		_ = tx.QueryRow(c.Context(), `SELECT thread_id FROM mail_messages WHERE mailbox_id=$1 AND internet_message_id=$2 AND thread_id IS NOT NULL ORDER BY id DESC LIMIT 1`, mailboxID, strings.TrimSpace(input.InReplyTo)).Scan(&threadID)
	}
	if threadID == 0 {
		err = tx.QueryRow(c.Context(), `INSERT INTO mail_threads(public_id,mailbox_id,subject_normalized,message_count) VALUES($1,$2,LOWER(REGEXP_REPLACE($3,'^(re|fw|fwd):\s*','','i')),1) RETURNING id`, randomHex(16), mailboxID, subject).Scan(&threadID)
		if err != nil {
			return err
		}
	} else {
		if _, err = tx.Exec(c.Context(), `UPDATE mail_threads SET message_count=message_count+1,latest_message_at=NOW() WHERE id=$1`, threadID); err != nil {
			return err
		}
	}
	messagePublic := randomHex(16)
	var messageID int64
	err = tx.QueryRow(c.Context(), `INSERT INTO mail_messages(public_id,mailbox_id,thread_id,idempotency_key,in_reply_to,message_references,direction,folder,delivery_status,from_address,from_name,subject,body_text,body_html,size_bytes,created_by) VALUES($1,$2,$3,$4,NULLIF($5,''),$6,'outbound','sent','queued',$7,$8,$9,$10,$11,$12,$13) RETURNING id`, messagePublic, mailboxID, threadID, idempotency, strings.TrimSpace(input.InReplyTo), input.References, local+"@"+domain, displayName, subject, textBody, safeHTML, messageBytes, actor.ID).Scan(&messageID)
	if err != nil {
		return err
	}
	insertRecipients := func(kind string, values []mailRecipientInput) error {
		for _, r := range values {
			addr := normalizeRecipient(r.Address)
			if _, err := tx.Exec(c.Context(), `INSERT INTO mail_recipients(message_id,kind,address,display_name) VALUES($1,$2,$3,$4)`, messageID, kind, addr, strings.TrimSpace(r.Name)); err != nil {
				return err
			}
		}
		return nil
	}
	if err = insertRecipients("to", input.To); err != nil {
		return err
	}
	if err = insertRecipients("cc", input.CC); err != nil {
		return err
	}
	if err = insertRecipients("bcc", input.BCC); err != nil {
		return err
	}
	for _, a := range attachments {
		if _, err = tx.Exec(c.Context(), `INSERT INTO mail_attachments(public_id,message_id,object_key,filename,content_type,size_bytes,sha256_hex) VALUES($1,$2,$3,$4,$5,$6,$7)`, a.PublicID, messageID, a.ObjectKey, a.Filename, a.ContentType, a.Size, a.SHA256); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(c.Context(), `INSERT INTO mail_jobs(public_id,kind,message_id) VALUES($1,'send',$2)`, randomHex(16), messageID); err != nil {
		return err
	}
	if _, err = tx.Exec(c.Context(), `UPDATE mailboxes SET used_bytes=used_bytes+$2,updated_at=NOW() WHERE id=$1`, mailboxID, messageBytes); err != nil {
		return err
	}
	if err = tx.Commit(c.Context()); err != nil {
		return err
	}
	attachmentsCommitted = true
	s.auditMailSent(c, actor, input, local+"@"+domain)
	return c.Status(202).JSON(fiber.Map{"id": messagePublic, "status": "queued"})
}

func (s *server) saveMailDraft(c *fiber.Ctx) error {
	actor := current(c)
	var input mailComposeInput
	if c.BodyParser(&input) != nil {
		return c.SendStatus(400)
	}
	mailboxID, local, domain, _, err := s.mailboxAccess(c.Context(), input.MailboxID, actor.ID)
	if err != nil {
		return c.SendStatus(404)
	}
	safeHTML := sanitizeMailHTML(input.HTML)
	textBody := mailPlainText(safeHTML, input.Text)
	if len(input.To)+len(input.CC)+len(input.BCC) > 0 {
		if _, err := normalizedRecipients(input.To, input.CC, input.BCC); err != nil {
			return c.Status(400).JSON(apiError{Error: err.Error()})
		}
	}
	if accountID, accountErr := s.stalwartAccountForMailbox(c.Context(), mailboxID); accountErr == nil && accountID != "" {
		if err := s.saveOrSendStalwartMessage(c, mailboxID, input.MailboxID, local+"@"+domain, "", textBody, safeHTML, input, false, ""); err != nil {
			return c.Status(502).JSON(apiError{Error: err.Error(), Code: "stalwart_draft_failed"})
		}
		return nil
	}
	attachments, err := s.storeComposeAttachments(c.Context(), input.MailboxID, input.Attachments)
	if err != nil {
		return c.Status(400).JSON(apiError{Error: err.Error()})
	}
	committed := false
	defer func() {
		if committed || s.storage == nil {
			return
		}
		for _, attachment := range attachments {
			_ = s.storage.RemoveObject(context.Background(), s.cfg.s3Bucket, attachment.ObjectKey, minio.RemoveObjectOptions{})
		}
	}()
	messageBytes := int64(len(textBody) + len(safeHTML))
	for _, attachment := range attachments {
		messageBytes += attachment.Size
	}
	publicID := randomHex(16)
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())
	var quota, used int64
	if err = tx.QueryRow(c.Context(), `SELECT quota_bytes,used_bytes FROM mailboxes WHERE id=$1 FOR UPDATE`, mailboxID).Scan(&quota, &used); err != nil {
		return err
	}
	if used+messageBytes > quota {
		return c.Status(409).JSON(apiError{Error: "พื้นที่กล่องอีเมลไม่เพียงพอ", Code: "quota_exceeded"})
	}
	var messageID int64
	err = tx.QueryRow(c.Context(), `INSERT INTO mail_messages(public_id,mailbox_id,in_reply_to,message_references,direction,folder,delivery_status,from_address,subject,body_text,body_html,size_bytes,created_by) VALUES($1,$2,NULLIF($3,''),$4,'outbound','draft','draft',$5,$6,$7,$8,$9,$10) RETURNING id`, publicID, mailboxID, strings.TrimSpace(input.InReplyTo), input.References, local+"@"+domain, strings.TrimSpace(input.Subject), textBody, safeHTML, messageBytes, actor.ID).Scan(&messageID)
	if err != nil {
		return err
	}
	for _, group := range []struct {
		kind       string
		recipients []mailRecipientInput
	}{{"to", input.To}, {"cc", input.CC}, {"bcc", input.BCC}} {
		for _, recipient := range group.recipients {
			if _, err = tx.Exec(c.Context(), `INSERT INTO mail_recipients(message_id,kind,address,display_name) VALUES($1,$2,$3,$4)`, messageID, group.kind, normalizeRecipient(recipient.Address), strings.TrimSpace(recipient.Name)); err != nil {
				return err
			}
		}
	}
	for _, attachment := range attachments {
		if _, err = tx.Exec(c.Context(), `INSERT INTO mail_attachments(public_id,message_id,object_key,filename,content_type,size_bytes,sha256_hex) VALUES($1,$2,$3,$4,$5,$6,$7)`, attachment.PublicID, messageID, attachment.ObjectKey, attachment.Filename, attachment.ContentType, attachment.Size, attachment.SHA256); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(c.Context(), `UPDATE mailboxes SET used_bytes=used_bytes+$2,updated_at=NOW() WHERE id=$1`, mailboxID, messageBytes); err != nil {
		return err
	}
	if err = tx.Commit(c.Context()); err != nil {
		return err
	}
	committed = true
	return c.Status(201).JSON(fiber.Map{"id": publicID})
}

func (s *server) setMailMessageState(c *fiber.Ctx) error {
	actor := current(c)
	var input struct {
		Read   *bool  `json:"read"`
		Folder string `json:"folder"`
	}
	if c.BodyParser(&input) != nil {
		return c.SendStatus(400)
	}
	if mailboxPublic := strings.TrimSpace(c.Query("mailboxId")); mailboxPublic != "" {
		mailboxID, _, _, _, err := s.mailboxAccess(c.Context(), mailboxPublic, actor.ID)
		if err != nil {
			return c.SendStatus(404)
		}
		accountID, err := s.stalwartAccountForMailbox(c.Context(), mailboxID)
		if err == nil && accountID != "" {
			if input.Folder != "" {
				s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.message.moved", Target: "mailbox", TargetID: mailboxPublic,
					Metadata: map[string]any{"status": "ย้ายไป " + input.Folder}})
			}
			return s.updateStalwartMessage(c, accountID, c.Params("id"), input.Read, input.Folder)
		}
	}
	var messageID, mailboxID int64
	err := s.db.QueryRow(c.Context(), `SELECT m.id,m.mailbox_id FROM mail_messages m JOIN mailbox_members mm ON mm.mailbox_id=m.mailbox_id WHERE m.public_id=$1 AND mm.user_id=$2`, c.Params("id"), actor.ID).Scan(&messageID, &mailboxID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	if input.Read != nil {
		if *input.Read {
			_, err = s.db.Exec(c.Context(), `INSERT INTO mail_message_user_state(message_id,user_id,read_at) VALUES($1,$2,NOW()) ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=NOW()`, messageID, actor.ID)
		} else {
			_, err = s.db.Exec(c.Context(), `INSERT INTO mail_message_user_state(message_id,user_id,read_at) VALUES($1,$2,NULL) ON CONFLICT(message_id,user_id) DO UPDATE SET read_at=NULL`, messageID, actor.ID)
		}
		if err != nil {
			return err
		}
	}
	if input.Folder != "" {
		if input.Folder != "trash" && input.Folder != "inbox" && input.Folder != "sent" {
			return c.SendStatus(400)
		}
		_, err = s.db.Exec(c.Context(), `UPDATE mail_messages SET folder=$2,trashed_at=CASE WHEN $2='trash' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1`, messageID, input.Folder)
		if err != nil {
			return err
		}
	}
	return c.SendStatus(204)
}

func (s *server) downloadMailAttachment(c *fiber.Ctx) error {
	actor := current(c)
	var objectKey, filename, contentType string
	err := s.db.QueryRow(c.Context(), `SELECT a.object_key,a.filename,a.content_type FROM mail_attachments a JOIN mail_messages m ON m.id=a.message_id JOIN mailbox_members mm ON mm.mailbox_id=m.mailbox_id WHERE a.public_id=$1 AND mm.user_id=$2`, c.Params("id"), actor.ID).Scan(&objectKey, &filename, &contentType)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	if s.storage == nil {
		return c.SendStatus(503)
	}
	object, err := s.storage.GetObject(c.Context(), s.cfg.s3Bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		return err
	}
	c.Set(fiber.HeaderContentType, contentType)
	c.Set(fiber.HeaderContentDisposition, mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	return c.SendStream(object)
}

func (s *server) adminListMailDomains(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT d.public_id,d.domain,d.kind,d.status,d.dns_records,d.verified_at,d.approved_at,COALESCE(u.identifier,''),COUNT(m.id) FILTER(WHERE m.deleted_at IS NULL),COALESCE(SUM(m.used_bytes) FILTER(WHERE m.deleted_at IS NULL),0),d.stalwart_provision_state,d.stalwart_last_error FROM mail_domains d LEFT JOIN users u ON u.id=d.owner_user_id LEFT JOIN mailboxes m ON m.domain_id=d.id WHERE d.deleted_at IS NULL GROUP BY d.id,u.identifier ORDER BY d.created_at DESC`)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, domain, kind, status, owner, stalwartState, stalwartError string
		var dns []byte
		var verified, approved *time.Time
		var count, used int64
		if err := rows.Scan(&id, &domain, &kind, &status, &dns, &verified, &approved, &owner, &count, &used, &stalwartState, &stalwartError); err != nil {
			return err
		}
		items = append(items, fiber.Map{"id": id, "domain": domain, "kind": kind, "status": status, "dnsRecords": json.RawMessage(dns), "verifiedAt": verified, "approvedAt": approved, "ownerUsername": owner, "mailboxCount": count, "usedBytes": used, "stalwartProvisionState": stalwartState, "stalwartLastError": stalwartError})
	}
	return c.JSON(fiber.Map{"items": items, "providerConfigured": s.resendConfigured(c.Context())})
}

// adminListMailDomainMailboxes lists the mailboxes of one domain for the admin mail page:
// address, owner and members, aliases, usage, and whether the mail server has the account.
func (s *server) adminListMailDomainMailboxes(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
		SELECT m.public_id,m.local_part||'@'||d.domain,m.display_name,m.quota_bytes,m.used_bytes,m.daily_send_limit,m.status,m.created_at,
		       m.stalwart_provision_state,m.stalwart_last_error,
		       COALESCE((SELECT u.identifier FROM mailbox_members mm JOIN users u ON u.id=mm.user_id WHERE mm.mailbox_id=m.id AND mm.role='owner' ORDER BY mm.created_at LIMIT 1),''),
		       COALESCE((SELECT array_agg(u.identifier ORDER BY u.identifier) FROM mailbox_members mm JOIN users u ON u.id=mm.user_id WHERE mm.mailbox_id=m.id AND mm.role<>'owner'),'{}'),
		       COALESCE((SELECT array_agg(a.local_part||'@'||d.domain ORDER BY a.local_part) FROM mail_aliases a WHERE a.mailbox_id=m.id AND a.deleted_at IS NULL),'{}')
		FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id
		WHERE d.public_id=$1 AND d.deleted_at IS NULL AND m.deleted_at IS NULL
		ORDER BY m.local_part`, c.Params("id"))
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, address, name, status, provisionState, provisionError, owner string
		var quota, used int64
		var limit int
		var created time.Time
		var members, aliases []string
		if err := rows.Scan(&id, &address, &name, &quota, &used, &limit, &status, &created, &provisionState, &provisionError, &owner, &members, &aliases); err != nil {
			return err
		}
		items = append(items, fiber.Map{"id": id, "address": address, "displayName": name, "quotaBytes": quota, "usedBytes": used, "dailySendLimit": limit,
			"status": status, "createdAt": created, "provisionState": provisionState, "provisionError": provisionError,
			"owner": owner, "members": members, "aliases": aliases})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) adminListMailMessages(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT m.public_id,m.from_address,m.subject,m.delivery_status,COALESCE(m.sent_at,m.created_at),COALESCE((SELECT string_agg(r.address,', ' ORDER BY r.id) FROM mail_recipients r WHERE r.message_id=m.id AND r.kind='to'),'') FROM mail_messages m WHERE m.direction='outbound' AND m.folder<>'draft' ORDER BY m.created_at DESC LIMIT 100`)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id, from, subject, status, to string
		var at time.Time
		if err := rows.Scan(&id, &from, &subject, &status, &at, &to); err != nil {
			return err
		}
		items = append(items, fiber.Map{"id": id, "from": from, "to": to, "subject": subject, "status": status, "date": at})
	}
	return c.JSON(fiber.Map{"items": items})
}

type adminMailSettingsInput struct {
	APIKey             string `json:"apiKey"`
	WebhookSecret      string `json:"webhookSecret"`
	ClearAPIKey        bool   `json:"clearApiKey"`
	ClearWebhookSecret bool   `json:"clearWebhookSecret"`
}

func validResendAPIKey(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, "re_") && len(value) >= 12 && len(value) <= 256
}

func validResendWebhookSecret(value string) bool {
	value = strings.TrimPrefix(strings.TrimSpace(value), "whsec_")
	decoded, err := base64.StdEncoding.DecodeString(value)
	return err == nil && len(decoded) >= 16
}

func (s *server) getAdminMailSettings(c *fiber.Ctx) error {
	apiKey, webhookSecret, err := s.effectiveResendSettings(c.Context())
	if err != nil {
		return err
	}
	var stored bool
	_ = s.db.QueryRow(c.Context(), `SELECT EXISTS(SELECT 1 FROM mail_provider_settings WHERE singleton=TRUE AND (resend_api_key_ciphertext<>'' OR resend_webhook_secret_ciphertext<>''))`).Scan(&stored)
	return c.JSON(fiber.Map{
		"apiKeyConfigured":        apiKey != "",
		"webhookSecretConfigured": webhookSecret != "",
		"providerConfigured":      apiKey != "" && webhookSecret != "",
		"source":                  map[bool]string{true: "database", false: "environment"}[stored],
		"webhookUrl":              strings.TrimRight(s.cfg.oauthBaseURL, "/") + "/api/webhooks/resend",
	})
}

func (s *server) updateAdminMailSettings(c *fiber.Ctx) error {
	actor := current(c)
	var input adminMailSettingsInput
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	input.APIKey = strings.TrimSpace(input.APIKey)
	input.WebhookSecret = strings.TrimSpace(input.WebhookSecret)
	if input.APIKey != "" && !validResendAPIKey(input.APIKey) {
		return c.Status(400).JSON(apiError{Error: "รูปแบบ Resend API Key ไม่ถูกต้อง"})
	}
	if input.WebhookSecret != "" && !validResendWebhookSecret(input.WebhookSecret) {
		return c.Status(400).JSON(apiError{Error: "รูปแบบ Webhook Secret ไม่ถูกต้อง"})
	}
	if input.APIKey != "" {
		var domains struct {
			Data []json.RawMessage `json:"data"`
		}
		if err := s.resendRequestWithKey(c.Context(), input.APIKey, http.MethodGet, "/domains", nil, &domains); err != nil {
			return c.Status(400).JSON(apiError{Error: "ตรวจสอบ API Key ไม่สำเร็จ: " + err.Error(), Code: "invalid_resend_key"})
		}
	}
	var apiCiphertext, webhookCiphertext string
	err := s.db.QueryRow(c.Context(), `SELECT resend_api_key_ciphertext,resend_webhook_secret_ciphertext FROM mail_provider_settings WHERE singleton=TRUE`).Scan(&apiCiphertext, &webhookCiphertext)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if input.ClearAPIKey {
		apiCiphertext = ""
	}
	if input.ClearWebhookSecret {
		webhookCiphertext = ""
	}
	if input.APIKey != "" {
		apiCiphertext, err = encryptSecret(input.APIKey, s.cfg.webhookKey)
		if err != nil {
			return err
		}
	}
	if input.WebhookSecret != "" {
		webhookCiphertext, err = encryptSecret(input.WebhookSecret, s.cfg.webhookKey)
		if err != nil {
			return err
		}
	}
	_, err = s.db.Exec(c.Context(), `INSERT INTO mail_provider_settings(singleton,resend_api_key_ciphertext,resend_webhook_secret_ciphertext,updated_by) VALUES(TRUE,$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET resend_api_key_ciphertext=EXCLUDED.resend_api_key_ciphertext,resend_webhook_secret_ciphertext=EXCLUDED.resend_webhook_secret_ciphertext,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, apiCiphertext, webhookCiphertext, actor.ID)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.resend_settings.updated", Target: "mail_settings", Metadata: map[string]any{"apiKeyChanged": input.APIKey != "" || input.ClearAPIKey, "webhookSecretChanged": input.WebhookSecret != "" || input.ClearWebhookSecret}})
	return c.SendStatus(204)
}

func (s *server) testAdminMailSettings(c *fiber.Ctx) error {
	var input struct {
		APIKey string `json:"apiKey"`
	}
	_ = c.BodyParser(&input)
	apiKey := strings.TrimSpace(input.APIKey)
	if apiKey == "" {
		var err error
		apiKey, _, err = s.effectiveResendSettings(c.Context())
		if err != nil {
			return err
		}
	}
	if !validResendAPIKey(apiKey) {
		return c.Status(400).JSON(apiError{Error: "ยังไม่ได้ตั้งค่า API Key"})
	}
	var result struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := s.resendRequestWithKey(c.Context(), apiKey, http.MethodGet, "/domains", nil, &result); err != nil {
		return c.Status(400).JSON(apiError{Error: "เชื่อมต่อ Resend ไม่สำเร็จ: " + err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true, "domainCount": len(result.Data)})
}

var errMailDomainNotVerified = errors.New("mail domain not verified")

// stalwartSyncError means the database change was saved but Stalwart did not accept it.
type stalwartSyncError struct{ err error }

func (e stalwartSyncError) Error() string { return e.err.Error() }
func (e stalwartSyncError) Unwrap() error { return e.err }

// setMailDomainStatus approves or suspends a domain and mirrors the change in Stalwart.
// approvedBy is recorded on approval; 0 leaves it empty.
func (s *server) setMailDomainStatus(ctx context.Context, publicID, status string, approvedBy int64) error {
	tag, err := s.db.Exec(ctx, `UPDATE mail_domains SET status=$2,approved_at=CASE WHEN $2='active' THEN NOW() ELSE approved_at END,approved_by=CASE WHEN $2='active' THEN NULLIF($3,0) ELSE approved_by END,updated_at=NOW() WHERE public_id=$1 AND deleted_at IS NULL AND ($2<>'active' OR verified_at IS NOT NULL)`, publicID, status, approvedBy)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errMailDomainNotVerified
	}
	var dbID int64
	var domain, stalwartID string
	if err := s.db.QueryRow(ctx, `SELECT id,domain,COALESCE(stalwart_domain_id,'') FROM mail_domains WHERE public_id=$1`, publicID).Scan(&dbID, &domain, &stalwartID); err == nil {
		if _, err := s.provisionStalwartDomain(ctx, dbID, domain, status, stalwartID); err != nil {
			_, _ = s.db.Exec(ctx, `UPDATE mail_domains SET stalwart_provision_state='failed',stalwart_last_error=$2 WHERE id=$1`, dbID, err.Error())
			return stalwartSyncError{err}
		}
	}
	return nil
}

func (s *server) adminSetMailDomainStatus(c *fiber.Ctx) error {
	actor := current(c)
	var input struct {
		Status string `json:"status"`
	}
	if c.BodyParser(&input) != nil {
		return c.SendStatus(400)
	}
	if input.Status != "active" && input.Status != "suspended" {
		return c.SendStatus(400)
	}
	err := s.setMailDomainStatus(c.Context(), c.Params("id"), input.Status, actor.ID)
	if errors.Is(err, errMailDomainNotVerified) {
		return c.Status(409).JSON(apiError{Error: "โดเมนยังไม่ผ่านการยืนยัน DNS"})
	}
	if err == nil {
		var domainName string
		_ = s.db.QueryRow(c.Context(), `SELECT domain FROM mail_domains WHERE public_id=$1`, c.Params("id")).Scan(&domainName)
		s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.domain.status", Target: "mail_domain", TargetID: c.Params("id"),
			Metadata: map[string]any{"domain": domainName, "status": map[string]string{"active": "เปิดใช้", "suspended": "ระงับ"}[input.Status]}})
	}
	var syncErr stalwartSyncError
	if errors.As(err, &syncErr) {
		return c.Status(502).JSON(apiError{Error: "อัปเดตสถานะแล้ว แต่ซิงก์ Stalwart ไม่สำเร็จ: " + syncErr.Error(), Code: "stalwart_provision_failed"})
	}
	if err != nil {
		return err
	}
	return c.SendStatus(204)
}

func verifyResendWebhook(secret string, body []byte, id, timestamp, signatures string) bool {
	if secret == "" || id == "" || timestamp == "" || signatures == "" {
		return false
	}
	unix, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || time.Since(time.Unix(unix, 0)) > 5*time.Minute || time.Until(time.Unix(unix, 0)) > time.Minute {
		return false
	}
	rawSecret := strings.TrimPrefix(secret, "whsec_")
	key, err := base64.StdEncoding.DecodeString(rawSecret)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + timestamp + "."))
	mac.Write(body)
	expected := mac.Sum(nil)
	for _, part := range strings.Fields(signatures) {
		pieces := strings.SplitN(part, ",", 2)
		if len(pieces) != 2 || pieces[0] != "v1" {
			continue
		}
		actual, err := base64.StdEncoding.DecodeString(pieces[1])
		if err == nil && hmac.Equal(expected, actual) {
			return true
		}
	}
	return false
}

func (s *server) resendWebhook(c *fiber.Ctx) error {
	body := append([]byte(nil), c.Body()...)
	eventID := strings.TrimSpace(c.Get("svix-id"))
	_, webhookSecret, err := s.effectiveResendSettings(c.Context())
	if err != nil {
		return err
	}
	if !verifyResendWebhook(webhookSecret, body, eventID, c.Get("svix-timestamp"), c.Get("svix-signature")) {
		return c.Status(401).JSON(apiError{Error: "ลายเซ็น webhook ไม่ถูกต้อง", Code: "invalid_signature"})
	}
	var event struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if json.Unmarshal(body, &event) != nil || event.Type == "" {
		return c.SendStatus(400)
	}
	tag, err := s.db.Exec(c.Context(), `INSERT INTO mail_webhook_events(provider_event_id,event_type,payload) VALUES($1,$2,$3) ON CONFLICT(provider_event_id) DO NOTHING`, eventID, event.Type, body)
	if err != nil {
		return err
	}
	return c.Status(202).JSON(fiber.Map{"accepted": tag.RowsAffected() > 0})
}
