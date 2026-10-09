package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

const stalwartCapability = "urn:stalwart:jmap"

type stalwartSetResponse struct {
	Created      map[string]stalwartCreated `json:"created"`
	NotCreated   map[string]stalwartError   `json:"notCreated"`
	NotUpdated   map[string]stalwartError   `json:"notUpdated"`
	NotDestroyed map[string]stalwartError   `json:"notDestroyed"`
}

type stalwartCreated struct {
	ID     string `json:"id"`
	Secret string `json:"secret"`
}

type stalwartError struct {
	Type             string `json:"type"`
	Description      string `json:"description"`
	ValidationErrors []struct {
		Type     string `json:"type"`
		Property string `json:"property"`
	} `json:"validationErrors"`
}

func (s *server) stalwartMethod(ctx context.Context, method string, args any) (json.RawMessage, error) {
	if strings.TrimSpace(s.cfg.stalwartAPIToken) == "" {
		return nil, errors.New("ยังไม่ได้ตั้งค่า STALWART_API_TOKEN")
	}
	body, err := json.Marshal(map[string]any{
		"using":       []string{"urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission", stalwartCapability},
		"methodCalls": []any{[]any{method, args, "nexora"}},
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.stalwartAPIURL+"/jmap", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	authorization := strings.TrimSpace(s.cfg.stalwartAPIToken)
	if !strings.HasPrefix(authorization, "Basic ") && !strings.HasPrefix(authorization, "Bearer ") {
		authorization = "Bearer " + authorization
	}
	req.Header.Set("Authorization", authorization)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("เชื่อมต่อ Stalwart ไม่สำเร็จ: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Stalwart ตอบกลับ HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	var envelope struct {
		MethodResponses [][]json.RawMessage `json:"methodResponses"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil || len(envelope.MethodResponses) == 0 || len(envelope.MethodResponses[0]) < 2 {
		return nil, fmt.Errorf("รูปแบบคำตอบจาก Stalwart ไม่ถูกต้อง")
	}
	var responseName string
	_ = json.Unmarshal(envelope.MethodResponses[0][0], &responseName)
	if responseName == "error" {
		var apiErr stalwartError
		_ = json.Unmarshal(envelope.MethodResponses[0][1], &apiErr)
		return nil, fmt.Errorf("Stalwart: %s", firstNonEmpty(apiErr.Description, apiErr.Type, "request failed"))
	}
	return envelope.MethodResponses[0][1], nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// errStalwartNotFound means the object (for example a message deleted in another client) no longer exists.
var errStalwartNotFound = errors.New("Stalwart: notFound")

func stalwartItemError(item stalwartError) error {
	if item.Type == "notFound" {
		return errStalwartNotFound
	}
	return fmt.Errorf("Stalwart: %s", firstNonEmpty(item.Description, item.Type))
}

func decodeStalwartSet(raw json.RawMessage, creationID string) (stalwartCreated, error) {
	var result stalwartSetResponse
	if err := json.Unmarshal(raw, &result); err != nil {
		return stalwartCreated{}, err
	}
	if created, ok := result.Created[creationID]; ok {
		return created, nil
	}
	if item, ok := result.NotCreated[creationID]; ok {
		detail := firstNonEmpty(item.Description, item.Type)
		if len(item.ValidationErrors) > 0 {
			detail += " (" + item.ValidationErrors[0].Property + ": " + item.ValidationErrors[0].Type + ")"
		}
		return stalwartCreated{}, fmt.Errorf("Stalwart: %s", detail)
	}
	for _, item := range result.NotUpdated {
		return stalwartCreated{}, stalwartItemError(item)
	}
	for _, item := range result.NotDestroyed {
		return stalwartCreated{}, stalwartItemError(item)
	}
	return stalwartCreated{}, nil
}

func (s *server) stalwartQueryOne(ctx context.Context, object string, filter map[string]any) (string, error) {
	raw, err := s.stalwartMethod(ctx, "x:"+object+"/query", map[string]any{"filter": filter, "limit": 1})
	if err != nil {
		return "", err
	}
	var result struct {
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", err
	}
	if len(result.IDs) == 0 {
		return "", nil
	}
	return result.IDs[0], nil
}

func (s *server) provisionStalwartDomain(ctx context.Context, dbID int64, domain, status, existingID string) (string, error) {
	if existingID == "" {
		found, err := s.stalwartQueryOne(ctx, "Domain", map[string]any{"name": domain})
		if err != nil {
			return "", err
		}
		existingID = found
	}
	enabled := status != "suspended"
	if existingID != "" {
		raw, err := s.stalwartMethod(ctx, "x:Domain/set", map[string]any{"update": map[string]any{
			existingID: map[string]any{"isEnabled": enabled},
		}})
		if err != nil {
			return "", err
		}
		if _, err := decodeStalwartSet(raw, ""); err != nil {
			return "", err
		}
	} else {
		raw, err := s.stalwartMethod(ctx, "x:Domain/set", map[string]any{"create": map[string]any{
			"domain": map[string]any{
				"name":                  domain,
				"aliases":               map[string]bool{},
				"certificateManagement": map[string]any{"@type": "Manual"},
				"dkimManagement":        map[string]any{"@type": "Automatic"},
				"dnsManagement":         map[string]any{"@type": "Manual"},
				"subAddressing":         map[string]any{"@type": "Enabled"},
				"isEnabled":             enabled,
			},
		}})
		if err != nil {
			return "", err
		}
		created, err := decodeStalwartSet(raw, "domain")
		if err != nil {
			return "", err
		}
		existingID = created.ID
	}
	_, err := s.db.Exec(ctx, `UPDATE mail_domains SET stalwart_domain_id=$2,stalwart_provision_state='provisioned',stalwart_last_error='',updated_at=NOW() WHERE id=$1`, dbID, existingID)
	return existingID, err
}

func (s *server) provisionStalwartMailbox(ctx context.Context, mailboxID int64) (string, error) {
	var local, domain, domainID, accountID, state string
	var quota int64
	err := s.db.QueryRow(ctx, `
		SELECT m.local_part,d.domain,COALESCE(d.stalwart_domain_id,''),COALESCE(m.stalwart_account_id,''),d.status,m.quota_bytes
		FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id WHERE m.id=$1 AND m.deleted_at IS NULL`, mailboxID).
		Scan(&local, &domain, &domainID, &accountID, &state, &quota)
	if err != nil {
		return "", err
	}
	if domainID == "" {
		var dbDomainID int64
		if err := s.db.QueryRow(ctx, `SELECT d.id FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id WHERE m.id=$1`, mailboxID).Scan(&dbDomainID); err != nil {
			return "", err
		}
		domainID, err = s.provisionStalwartDomain(ctx, dbDomainID, domain, state, "")
		if err != nil {
			return "", err
		}
	}
	if accountID == "" {
		found, err := s.stalwartQueryOne(ctx, "Account", map[string]any{"name": local, "domainId": domainID})
		if err != nil {
			return "", err
		}
		accountID = found
	}
	if accountID == "" {
		raw, err := s.stalwartMethod(ctx, "x:Account/set", map[string]any{"create": map[string]any{
			"account": map[string]any{
				"@type":            "User",
				"name":             local,
				"domainId":         domainID,
				"credentials":      map[string]any{},
				"memberGroupIds":   map[string]bool{},
				"roles":            map[string]any{"@type": "User"},
				"permissions":      map[string]any{"@type": "Inherit"},
				"quotas":           map[string]any{"maxDiskQuota": quota},
				"aliases":          map[string]any{},
				"encryptionAtRest": map[string]any{"@type": "Disabled"},
				"description":      local + "@" + domain,
			},
		}})
		if err != nil {
			return "", err
		}
		created, err := decodeStalwartSet(raw, "account")
		if err != nil {
			return "", err
		}
		accountID = created.ID
	}
	_, err = s.db.Exec(ctx, `UPDATE mailboxes SET stalwart_account_id=$2,stalwart_provision_state='provisioned',stalwart_last_error='',updated_at=NOW() WHERE id=$1`, mailboxID, accountID)
	return accountID, err
}

func (s *server) getMailDeviceSettings(c *fiber.Ctx) error {
	actor := current(c)
	mailboxID, local, domain, _, err := s.mailboxAccess(c.Context(), c.Params("id"), actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	var accountID, state, lastError string
	if err := s.db.QueryRow(c.Context(), `SELECT COALESCE(stalwart_account_id,''),stalwart_provision_state,stalwart_last_error FROM mailboxes WHERE id=$1`, mailboxID).Scan(&accountID, &state, &lastError); err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `SELECT public_id,description,created_at FROM mail_device_credentials WHERE mailbox_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`, mailboxID)
	if err != nil {
		return err
	}
	defer rows.Close()
	credentials := []fiber.Map{}
	for rows.Next() {
		var id, description string
		var createdAt time.Time
		if err := rows.Scan(&id, &description, &createdAt); err != nil {
			return err
		}
		credentials = append(credentials, fiber.Map{"id": id, "description": description, "createdAt": createdAt})
	}
	return c.JSON(fiber.Map{
		"ready":          state == "provisioned" && accountID != "",
		"provisionState": state,
		"lastError":      lastError,
		"address":        local + "@" + domain,
		"incoming":       fiber.Map{"host": strings.TrimPrefix(s.cfg.stalwartPublicURL, "https://"), "port": 993, "security": "TLS"},
		"outgoing":       fiber.Map{"host": strings.TrimPrefix(s.cfg.stalwartPublicURL, "https://"), "port": 465, "security": "TLS"},
		"credentials":    credentials,
	})
}

type mailDevicePassword struct {
	PublicID string
	Secret   string
}

// createDevicePassword makes a Stalwart app password for IMAP/SMTP clients. The secret is only returned here.
func (s *server) createDevicePassword(ctx context.Context, mailboxID, createdBy int64, description string) (mailDevicePassword, error) {
	description = strings.TrimSpace(description)
	if description == "" {
		description = "iPhone"
	}
	accountID, err := s.provisionStalwartMailbox(ctx, mailboxID)
	if err != nil {
		return mailDevicePassword{}, stalwartSyncError{err}
	}
	raw, err := s.stalwartMethod(ctx, "x:AppPassword/set", map[string]any{
		"accountId": accountID,
		"create": map[string]any{"device": map[string]any{
			"description": description,
			"allowedIps":  map[string]bool{},
			"permissions": map[string]any{"@type": "Inherit"},
		}},
	})
	if err != nil {
		return mailDevicePassword{}, stalwartSyncError{err}
	}
	created, err := decodeStalwartSet(raw, "device")
	if err != nil || created.ID == "" || created.Secret == "" {
		return mailDevicePassword{}, stalwartSyncError{errors.New(firstNonEmpty(errorString(err), "Stalwart ไม่ส่งรหัสผ่านกลับมา"))}
	}
	publicID := randomHex(16)
	if _, err := s.db.Exec(ctx, `INSERT INTO mail_device_credentials(public_id,mailbox_id,provider_credential_id,description,created_by) VALUES($1,$2,$3,$4,$5)`, publicID, mailboxID, created.ID, description, createdBy); err != nil {
		return mailDevicePassword{}, err
	}
	return mailDevicePassword{PublicID: publicID, Secret: created.Secret}, nil
}

// revokeDevicePassword removes one app password from Stalwart and marks it revoked.
func (s *server) revokeDevicePassword(ctx context.Context, mailboxID int64, credentialPublicID string) error {
	var providerID, accountID string
	err := s.db.QueryRow(ctx, `
		SELECT dc.provider_credential_id,COALESCE(m.stalwart_account_id,'')
		FROM mail_device_credentials dc JOIN mailboxes m ON m.id=dc.mailbox_id
		WHERE dc.public_id=$1 AND dc.mailbox_id=$2 AND dc.revoked_at IS NULL`, credentialPublicID, mailboxID).Scan(&providerID, &accountID)
	if err != nil {
		return err
	}
	raw, err := s.stalwartMethod(ctx, "x:AppPassword/set", map[string]any{"accountId": accountID, "destroy": []string{providerID}})
	if err != nil {
		return stalwartSyncError{err}
	}
	if _, err := decodeStalwartSet(raw, ""); err != nil {
		return stalwartSyncError{err}
	}
	_, err = s.db.Exec(ctx, `UPDATE mail_device_credentials SET revoked_at=NOW() WHERE public_id=$1`, credentialPublicID)
	return err
}

func (s *server) mailDeviceHost() string {
	return strings.TrimPrefix(s.cfg.stalwartPublicURL, "https://")
}

func (s *server) createMailDevicePassword(c *fiber.Ctx) error {
	actor := current(c)
	mailboxID, local, domain, _, err := s.mailboxAccess(c.Context(), c.Params("id"), actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	var input struct {
		Description string `json:"description"`
	}
	_ = c.BodyParser(&input)
	created, err := s.createDevicePassword(c.Context(), mailboxID, actor.ID, input.Description)
	var syncErr stalwartSyncError
	if errors.As(err, &syncErr) {
		return c.Status(502).JSON(apiError{Error: syncErr.Error(), Code: "stalwart_credential_failed"})
	}
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.app_password.created", Target: "mailbox", TargetID: c.Params("id"),
		Metadata: map[string]any{"address": local + "@" + domain, "detail": "อุปกรณ์: " + firstNonEmpty(strings.TrimSpace(input.Description), "iPhone")}})
	return c.Status(201).JSON(fiber.Map{
		"id":        created.PublicID,
		"address":   local + "@" + domain,
		"password":  created.Secret,
		"shownOnce": true,
		"incoming":  fiber.Map{"host": s.mailDeviceHost(), "port": 993, "security": "TLS"},
		"outgoing":  fiber.Map{"host": s.mailDeviceHost(), "port": 465, "security": "TLS"},
	})
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func (s *server) revokeMailDevicePassword(c *fiber.Ctx) error {
	actor := current(c)
	mailboxID, local, domain, _, err := s.mailboxAccess(c.Context(), c.Params("id"), actor.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	err = s.revokeDevicePassword(c.Context(), mailboxID, c.Params("credentialId"))
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(404)
	}
	var syncErr stalwartSyncError
	if errors.As(err, &syncErr) {
		return c.Status(502).JSON(apiError{Error: syncErr.Error(), Code: "stalwart_credential_failed"})
	}
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "mail", Action: "mail.app_password.revoked", Target: "mailbox", TargetID: c.Params("id"),
		Metadata: map[string]any{"address": local + "@" + domain}})
	return c.SendStatus(204)
}

func (s *server) adminStalwartHealth(c *fiber.Ctx) error {
	if s.cfg.stalwartAPIToken == "" {
		return c.JSON(fiber.Map{"configured": false, "healthy": false})
	}
	_, err := s.stalwartMethod(c.Context(), "x:Domain/query", map[string]any{"filter": map[string]any{}, "limit": 1})
	return c.JSON(fiber.Map{"configured": true, "healthy": err == nil, "error": errorString(err), "publicUrl": s.cfg.stalwartPublicURL})
}

func (s *server) adminSyncStalwart(c *fiber.Ctx) error {
	domainCount, mailboxCount, failures, err := s.syncAllStalwart(c.Context())
	if err != nil {
		return c.Status(502).JSON(apiError{Error: "ตั้งค่า Resend relay ไม่สำเร็จ: " + err.Error(), Code: "stalwart_relay_failed"})
	}
	status := fiber.StatusOK
	if len(failures) > 0 {
		status = fiber.StatusMultiStatus
	}
	return c.Status(status).JSON(fiber.Map{"domains": domainCount, "mailboxes": mailboxCount, "failures": failures})
}

func (s *server) syncAllStalwart(ctx context.Context) (int, int, []string, error) {
	if err := s.ensureStalwartRelay(ctx); err != nil {
		return 0, 0, nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT id,domain,status,COALESCE(stalwart_domain_id,'') FROM mail_domains WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		return 0, 0, nil, err
	}
	type domainRow struct {
		id                         int64
		domain, status, stalwartID string
	}
	domains := []domainRow{}
	for rows.Next() {
		var item domainRow
		if err := rows.Scan(&item.id, &item.domain, &item.status, &item.stalwartID); err != nil {
			rows.Close()
			return 0, 0, nil, err
		}
		domains = append(domains, item)
	}
	rows.Close()
	domainCount, mailboxCount := 0, 0
	failures := []string{}
	for _, item := range domains {
		if _, err := s.provisionStalwartDomain(ctx, item.id, item.domain, item.status, item.stalwartID); err != nil {
			failures = append(failures, item.domain+": "+err.Error())
			_, _ = s.db.Exec(ctx, `UPDATE mail_domains SET stalwart_provision_state='failed',stalwart_last_error=$2 WHERE id=$1`, item.id, err.Error())
			continue
		}
		domainCount++
	}
	boxRows, err := s.db.Query(ctx, `SELECT id,local_part FROM mailboxes WHERE deleted_at IS NULL ORDER BY id`)
	if err != nil {
		return domainCount, 0, failures, err
	}
	for boxRows.Next() {
		var id int64
		var local string
		if err := boxRows.Scan(&id, &local); err != nil {
			boxRows.Close()
			return domainCount, mailboxCount, failures, err
		}
		if _, err := s.provisionStalwartMailbox(ctx, id); err != nil {
			failures = append(failures, local+": "+err.Error())
			_, _ = s.db.Exec(ctx, `UPDATE mailboxes SET stalwart_provision_state='failed',stalwart_last_error=$2 WHERE id=$1`, id, err.Error())
			continue
		}
		mailboxCount++
	}
	boxRows.Close()
	return domainCount, mailboxCount, failures, nil
}

func (s *server) ensureStalwartRelay(ctx context.Context) error {
	resendKey, _, err := s.effectiveResendSettings(ctx)
	if err != nil {
		return err
	}
	if resendKey == "" {
		return errors.New("ยังไม่ได้ตั้งค่า Resend API Key")
	}
	routeID, err := s.stalwartQueryOne(ctx, "MtaRoute", map[string]any{"name": "resend"})
	if err != nil {
		return err
	}
	if routeID == "" {
		raw, err := s.stalwartMethod(ctx, "x:MtaRoute/set", map[string]any{"create": map[string]any{
			"resend": map[string]any{
				"@type":             "Relay",
				"name":              "resend",
				"address":           "smtp.resend.com",
				"port":              465,
				"protocol":          "smtp",
				"implicitTls":       true,
				"allowInvalidCerts": false,
				"authUsername":      "resend",
				"authSecret":        map[string]any{"@type": "Value", "secret": resendKey},
				"description":       "Resend outbound relay managed by Nexora",
			},
		}})
		if err != nil {
			return err
		}
		created, err := decodeStalwartSet(raw, "resend")
		if err != nil {
			return err
		}
		routeID = created.ID
	}
	if routeID == "" {
		return errors.New("ไม่พบ route ที่สร้าง")
	}
	raw, err := s.stalwartMethod(ctx, "x:MtaOutboundStrategy/set", map[string]any{"update": map[string]any{
		"singleton": map[string]any{"route": map[string]any{
			"match": map[string]any{"0": map[string]string{"if": "is_local_domain(rcpt_domain)", "then": "'local'"}},
			"else":  "'" + routeID + "'",
		}},
	}})
	if err != nil {
		return err
	}
	_, err = decodeStalwartSet(raw, "")
	return err
}
