package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	mailaddr "net/mail"
	"net/textproto"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/minio/minio-go/v7"
)

type stalwartMailbox struct {
	ID   string `json:"id"`
	Role string `json:"role"`
}

type stalwartAddress struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type stalwartBodyPart struct {
	PartID      string `json:"partId"`
	BlobID      string `json:"blobId"`
	Type        string `json:"type"`
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	CID         string `json:"cid"`
	Disposition string `json:"disposition"`
}

type stalwartBodyValue struct {
	Value string `json:"value"`
}

type stalwartEmail struct {
	ID            string                       `json:"id"`
	ThreadID      string                       `json:"threadId"`
	BlobID        string                       `json:"blobId"`
	MailboxIDs    map[string]bool              `json:"mailboxIds"`
	Keywords      map[string]bool              `json:"keywords"`
	From          []stalwartAddress            `json:"from"`
	To            []stalwartAddress            `json:"to"`
	CC            []stalwartAddress            `json:"cc"`
	BCC           []stalwartAddress            `json:"bcc"`
	Subject       string                       `json:"subject"`
	Preview       string                       `json:"preview"`
	Size          int64                        `json:"size"`
	ReceivedAt    time.Time                    `json:"receivedAt"`
	MessageID     []string                     `json:"messageId"`
	InReplyTo     []string                     `json:"inReplyTo"`
	References    []string                     `json:"references"`
	TextBody      []stalwartBodyPart           `json:"textBody"`
	HTMLBody      []stalwartBodyPart           `json:"htmlBody"`
	Attachments   []stalwartBodyPart           `json:"attachments"`
	BodyValues    map[string]stalwartBodyValue `json:"bodyValues"`
	HasAttachment bool                         `json:"hasAttachment"`
}

func (s *server) stalwartAuthorization() string {
	value := strings.TrimSpace(s.cfg.stalwartAPIToken)
	if !strings.HasPrefix(value, "Basic ") && !strings.HasPrefix(value, "Bearer ") {
		value = "Bearer " + value
	}
	return value
}

func (s *server) stalwartAccountForMailbox(ctx context.Context, mailboxID int64) (string, error) {
	var accountID string
	err := s.db.QueryRow(ctx, `SELECT COALESCE(stalwart_account_id,'') FROM mailboxes WHERE id=$1`, mailboxID).Scan(&accountID)
	return accountID, err
}

func (s *server) stalwartMailboxRoles(ctx context.Context, accountID string) (map[string]string, error) {
	raw, err := s.stalwartMethod(ctx, "Mailbox/get", map[string]any{"accountId": accountID})
	if err != nil {
		return nil, err
	}
	var result struct {
		List []stalwartMailbox `json:"list"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	roles := map[string]string{}
	for _, mailbox := range result.List {
		if mailbox.Role != "" {
			roles[mailbox.Role] = mailbox.ID
		}
	}
	return roles, nil
}

func (s *server) stalwartGetEmails(ctx context.Context, accountID string, ids []string) ([]stalwartEmail, error) {
	if len(ids) == 0 {
		return []stalwartEmail{}, nil
	}
	raw, err := s.stalwartMethod(ctx, "Email/get", map[string]any{
		"accountId": accountID,
		"ids":       ids,
		"properties": []string{
			"id", "threadId", "blobId", "mailboxIds", "keywords", "from", "to", "cc", "bcc",
			"subject", "preview", "size", "receivedAt", "messageId", "inReplyTo", "references",
			"textBody", "htmlBody", "attachments", "bodyValues", "hasAttachment",
		},
		"fetchTextBodyValues": true,
		"fetchHTMLBodyValues": true,
		"fetchAllBodyValues":  true,
		"maxBodyValueBytes":   2 * 1024 * 1024,
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

func stalwartRecipients(email stalwartEmail) []fiber.Map {
	items := []fiber.Map{}
	for _, group := range []struct {
		kind   string
		values []stalwartAddress
	}{{"to", email.To}, {"cc", email.CC}, {"bcc", email.BCC}} {
		for _, address := range group.values {
			items = append(items, fiber.Map{"kind": group.kind, "address": address.Email, "name": address.Name})
		}
	}
	return items
}

func stalwartBody(parts []stalwartBodyPart, values map[string]stalwartBodyValue) string {
	var result strings.Builder
	for _, part := range parts {
		result.WriteString(values[part.PartID].Value)
	}
	return result.String()
}

func (s *server) listStalwartMessages(c *fiber.Ctx, accountID, folder, query string, cursor int) error {
	roles, err := s.stalwartMailboxRoles(c.Context(), accountID)
	if err != nil {
		return err
	}
	role := map[string]string{"draft": "drafts"}[folder]
	if role == "" {
		role = folder
	}
	folderID := roles[role]
	if folderID == "" {
		return c.JSON(fiber.Map{"items": []fiber.Map{}, "nextCursor": 0})
	}
	filter := map[string]any{"inMailbox": folderID}
	if query != "" {
		filter["text"] = query
	}
	raw, err := s.stalwartMethod(c.Context(), "Email/query", map[string]any{
		"accountId": accountID,
		"filter":    filter,
		"sort":      []map[string]any{{"property": "receivedAt", "isAscending": false}},
		"position":  cursor,
		"limit":     51,
	})
	if err != nil {
		return err
	}
	var result struct {
		IDs []string `json:"ids"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return err
	}
	next := 0
	ids := result.IDs
	if len(ids) > 50 {
		ids = ids[:50]
		next = cursor + 50
	}
	emails, err := s.stalwartGetEmails(c.Context(), accountID, ids)
	if err != nil {
		return err
	}
	byID := map[string]stalwartEmail{}
	for _, email := range emails {
		byID[email.ID] = email
	}
	items := []fiber.Map{}
	for _, id := range ids {
		email, ok := byID[id]
		if !ok {
			continue
		}
		from, fromName := "", ""
		if len(email.From) > 0 {
			from, fromName = email.From[0].Email, email.From[0].Name
		}
		status, direction := "received", "inbound"
		if folder == "sent" {
			status, direction = "sent", "outbound"
		} else if folder == "draft" {
			status, direction = "draft", "outbound"
		}
		items = append(items, fiber.Map{
			"id": id, "threadId": email.ThreadID, "direction": direction, "folder": map[string]string{"drafts": "draft"}[folder],
			"status": status, "from": from, "fromName": fromName, "subject": email.Subject, "preview": email.Preview,
			"sizeBytes": email.Size, "date": email.ReceivedAt, "read": email.Keywords["$seen"], "starred": email.Keywords["$flagged"],
			"recipients": stalwartRecipients(email), "hasAttachments": email.HasAttachment || len(email.Attachments) > 0,
		})
		if items[len(items)-1]["folder"] == "" {
			items[len(items)-1]["folder"] = folder
		}
	}
	return c.JSON(fiber.Map{"items": items, "nextCursor": next})
}

// stalwartAttachmentURL is the webmail download path for one attachment of a message.
func stalwartAttachmentURL(mailboxPublic string, part stalwartBodyPart) string {
	return fmt.Sprintf("/api/mail/mailboxes/%s/blob?blobId=%s&name=%s", mailboxPublic, url.QueryEscape(part.BlobID), url.QueryEscape(firstNonEmpty(part.Name, "attachment")))
}

// stalwartMessageHTML is the sanitized HTML body with src="cid:…" images pointed at their
// attachments. It also returns the attachments the body already shows, so they are not listed twice.
func stalwartMessageHTML(email stalwartEmail, mailboxPublic string) (string, map[string]bool) {
	body := safeMailBodyHTML(stalwartBody(email.HTMLBody, email.BodyValues), stalwartBody(email.TextBody, email.BodyValues))
	shown := map[string]bool{}
	for _, part := range email.Attachments {
		cid := mailContentID(part.CID)
		if cid == "" || !strings.HasPrefix(strings.ToLower(part.Type), "image/") {
			continue
		}
		reference := `src="cid:` + cid + `"`
		if strings.Contains(body, reference) {
			body = strings.ReplaceAll(body, reference, `src="`+html.EscapeString(stalwartAttachmentURL(mailboxPublic, part))+`"`)
			shown[part.BlobID] = true
		}
	}
	return body, shown
}

func (s *server) getStalwartMessage(c *fiber.Ctx, accountID, mailboxPublic, emailID string) error {
	emails, err := s.stalwartGetEmails(c.Context(), accountID, []string{emailID})
	if err != nil {
		return err
	}
	if len(emails) == 0 {
		return c.SendStatus(404)
	}
	email := emails[0]
	roles, _ := s.stalwartMailboxRoles(c.Context(), accountID)
	folder := "inbox"
	for role, id := range roles {
		if email.MailboxIDs[id] && (role == "inbox" || role == "sent" || role == "drafts" || role == "trash") {
			folder = map[string]string{"drafts": "draft"}[role]
			if folder == "" {
				folder = role
			}
			break
		}
	}
	from, fromName := "", ""
	if len(email.From) > 0 {
		from, fromName = email.From[0].Email, email.From[0].Name
	}
	body, shownInBody := stalwartMessageHTML(email, mailboxPublic)
	attachments := []fiber.Map{}
	for _, attachment := range email.Attachments {
		attachments = append(attachments, fiber.Map{
			"id": attachment.BlobID, "filename": firstNonEmpty(attachment.Name, "attachment"), "contentType": attachment.Type, "sizeBytes": attachment.Size,
			"downloadUrl": stalwartAttachmentURL(mailboxPublic, attachment), "inBody": shownInBody[attachment.BlobID],
		})
	}
	_, _ = s.stalwartMethod(c.Context(), "Email/set", map[string]any{"accountId": accountID, "update": map[string]any{
		emailID: map[string]any{"keywords/$seen": true},
	}})
	status, direction := "received", "inbound"
	if folder == "sent" {
		status, direction = "sent", "outbound"
	} else if folder == "draft" {
		status, direction = "draft", "outbound"
	}
	return c.JSON(fiber.Map{
		"id": email.ID, "direction": direction, "folder": folder, "status": status, "from": from, "fromName": fromName,
		"subject": email.Subject, "text": stalwartBody(email.TextBody, email.BodyValues), "html": body,
		"internetMessageId": firstString(email.MessageID), "inReplyTo": firstString(email.InReplyTo), "references": email.References,
		"sentAt": email.ReceivedAt, "receivedAt": email.ReceivedAt, "recipients": stalwartRecipients(email), "attachments": attachments,
	})
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func writeMailAddressHeader(values []mailRecipientInput) string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		address := normalizeRecipient(value.Address)
		if strings.TrimSpace(value.Name) != "" {
			// Quote the name: a bare name such as 'x <a@b>, y' would add recipients to the header.
			result = append(result, (&mailaddr.Address{Name: strings.TrimSpace(value.Name), Address: address}).String())
		} else {
			result = append(result, address)
		}
	}
	return strings.Join(result, ", ")
}

// headerToken makes a caller-supplied header value one line: any CR, LF or NUL is dropped so the
// value cannot start a new header (Bcc, Cc, ...).
func headerToken(value string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == 0 {
			return -1
		}
		return r
	}, value))
}

func buildStalwartEML(from, fromName, subject, textBody, htmlBody, inReplyTo string, references []string, input mailComposeInput) ([]byte, int64, error) {
	inReplyTo = headerToken(inReplyTo)
	cleanRefs := make([]string, 0, len(references))
	for _, ref := range references {
		if ref = headerToken(ref); ref != "" {
			cleanRefs = append(cleanRefs, ref)
		}
	}
	references = cleanRefs
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	headers := []string{
		"From: " + writeMailAddressHeader([]mailRecipientInput{{Address: from, Name: fromName}}),
		"To: " + writeMailAddressHeader(input.To),
		"Subject: " + mime.QEncoding.Encode("UTF-8", subject),
		"Date: " + time.Now().UTC().Format(time.RFC1123Z),
		"Message-ID: <" + randomHex(16) + "@nexora.mail>",
		"MIME-Version: 1.0",
		"Content-Type: multipart/mixed; boundary=\"" + writer.Boundary() + "\"",
	}
	if len(input.CC) > 0 {
		headers = append(headers, "Cc: "+writeMailAddressHeader(input.CC))
	}
	if inReplyTo != "" {
		headers = append(headers, "In-Reply-To: "+inReplyTo)
	}
	if len(references) > 0 {
		headers = append(headers, "References: "+strings.Join(references, " "))
	}
	var alternativeBody bytes.Buffer
	altWriter := multipart.NewWriter(&alternativeBody)
	textHeader := textproto.MIMEHeader{}
	textHeader.Set("Content-Type", "text/plain; charset=UTF-8")
	textPart, _ := altWriter.CreatePart(textHeader)
	_, _ = io.WriteString(textPart, textBody)
	htmlHeader := textproto.MIMEHeader{}
	htmlHeader.Set("Content-Type", "text/html; charset=UTF-8")
	htmlPart, _ := altWriter.CreatePart(htmlHeader)
	_, _ = io.WriteString(htmlPart, htmlBody)
	_ = altWriter.Close()
	alternative := textproto.MIMEHeader{}
	alternative.Set("Content-Type", "multipart/alternative; boundary=\""+altWriter.Boundary()+"\"")
	alternativePart, err := writer.CreatePart(alternative)
	if err != nil {
		return nil, 0, err
	}
	_, _ = alternativePart.Write(alternativeBody.Bytes())
	var attachmentBytes int64
	for _, attachment := range input.Attachments {
		data, err := base64.StdEncoding.DecodeString(attachment.Content)
		if err != nil {
			return nil, 0, fmt.Errorf("ข้อมูลไฟล์แนบไม่ถูกต้อง")
		}
		attachmentBytes += int64(len(data))
		if attachmentBytes > mailMaxAttachmentBytes {
			return nil, 0, fmt.Errorf("ไฟล์แนบรวมต้องไม่เกิน 20 MB")
		}
		partHeader := textproto.MIMEHeader{}
		contentType := firstNonEmpty(strings.TrimSpace(attachment.ContentType), http.DetectContentType(data))
		partHeader.Set("Content-Type", mime.FormatMediaType(contentType, map[string]string{"name": attachment.Filename}))
		partHeader.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": attachment.Filename}))
		if cid := mailContentID(attachment.ContentID); cid != "" {
			// Keeps images that the HTML body shows with src="cid:…" linked to this part.
			partHeader.Set("Content-ID", "<"+cid+">")
		}
		partHeader.Set("Content-Transfer-Encoding", "base64")
		part, err := writer.CreatePart(partHeader)
		if err != nil {
			return nil, 0, err
		}
		encoder := base64.NewEncoder(base64.StdEncoding, part)
		_, _ = encoder.Write(data)
		_ = encoder.Close()
	}
	_ = writer.Close()
	return append([]byte(strings.Join(headers, "\r\n")+"\r\n\r\n"), body.Bytes()...), attachmentBytes, nil
}

func (s *server) stalwartUpload(ctx context.Context, accountID string, content []byte, contentType string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.stalwartAPIURL+"/jmap/upload/"+url.PathEscape(accountID), bytes.NewReader(content))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", s.stalwartAuthorization())
	req.Header.Set("Content-Type", contentType)
	resp, err := (&http.Client{Timeout: 45 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result struct {
		BlobID string `json:"blobId"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&result); err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || result.BlobID == "" {
		return "", fmt.Errorf("Stalwart upload HTTP %d", resp.StatusCode)
	}
	return result.BlobID, nil
}

func (s *server) saveOrSendStalwartMessage(c *fiber.Ctx, mailboxID int64, mailboxPublic, from, fromName, textBody, htmlBody string, input mailComposeInput, send bool, idempotency string) error {
	accountID, err := s.stalwartAccountForMailbox(c.Context(), mailboxID)
	if err != nil || accountID == "" {
		return fmt.Errorf("กล่องอีเมลยังไม่พร้อมบน Stalwart")
	}
	subject := strings.TrimSpace(input.Subject)
	content, _, err := buildStalwartEML(from, fromName, subject, textBody, htmlBody, strings.TrimSpace(input.InReplyTo), input.References, input)
	if err != nil {
		return err
	}
	blobID, err := s.stalwartUpload(c.Context(), accountID, content, "message/rfc822")
	if err != nil {
		return err
	}
	roles, err := s.stalwartMailboxRoles(c.Context(), accountID)
	if err != nil {
		return err
	}
	role := "drafts"
	if send {
		role = "sent"
	}
	raw, err := s.stalwartMethod(c.Context(), "Email/import", map[string]any{
		"accountId": accountID,
		"emails": map[string]any{"message": map[string]any{
			"blobId": blobID, "mailboxIds": map[string]bool{roles[role]: true}, "keywords": map[string]bool{"$seen": true}, "receivedAt": time.Now().UTC(),
		}},
	})
	if err != nil {
		return err
	}
	created, err := decodeStalwartSet(raw, "message")
	if err != nil || created.ID == "" {
		return firstError(err, fmt.Errorf("Stalwart ไม่คืนค่า Email ID"))
	}
	if send {
		identityRaw, err := s.stalwartMethod(c.Context(), "EmailIdentity/get", map[string]any{"accountId": accountID})
		if err != nil {
			return err
		}
		var identities struct {
			List []struct {
				ID string `json:"id"`
			} `json:"list"`
		}
		if err := json.Unmarshal(identityRaw, &identities); err != nil || len(identities.List) == 0 {
			return fmt.Errorf("ไม่พบ Email Identity")
		}
		submitRaw, err := s.stalwartMethod(c.Context(), "EmailSubmission/set", map[string]any{
			"accountId": accountID,
			"create": map[string]any{"submission": map[string]any{
				"emailId": created.ID, "identityId": identities.List[0].ID,
			}},
		})
		if err != nil {
			return err
		}
		if _, err := decodeStalwartSet(submitRaw, "submission"); err != nil {
			return err
		}
	}
	publicID := randomHex(16)
	direction, folder, status := "outbound", "draft", "draft"
	if send {
		folder, status = "sent", "sent"
	}
	var dbMessageID int64
	err = s.db.QueryRow(c.Context(), `
		INSERT INTO mail_messages(public_id,mailbox_id,provider_message_id,stalwart_email_id,stalwart_migrated_at,idempotency_key,
		direction,folder,delivery_status,from_address,from_name,subject,body_text,body_html,size_bytes,created_by,sent_at)
		VALUES($1,$2,$3,$3,NOW(),NULLIF($4,''),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $6='sent' THEN NOW() END) RETURNING id`,
		publicID, mailboxID, created.ID, idempotency, direction, folder, status, from, fromName, subject, textBody, htmlBody, len(content), current(c).ID).Scan(&dbMessageID)
	if err != nil {
		return err
	}
	for _, group := range []struct {
		kind   string
		values []mailRecipientInput
	}{{"to", input.To}, {"cc", input.CC}, {"bcc", input.BCC}} {
		for _, recipient := range group.values {
			_, _ = s.db.Exec(c.Context(), `INSERT INTO mail_recipients(message_id,kind,address,display_name) VALUES($1,$2,$3,$4)`, dbMessageID, group.kind, normalizeRecipient(recipient.Address), strings.TrimSpace(recipient.Name))
		}
	}
	code := fiber.StatusCreated
	if send {
		code = fiber.StatusAccepted
	}
	return c.Status(code).JSON(fiber.Map{"id": created.ID, "status": status, "mailboxId": mailboxPublic})
}

func firstError(errors ...error) error {
	for _, err := range errors {
		if err != nil {
			return err
		}
	}
	return nil
}

var errMailFolderMissing = errors.New("mail folder missing")

// stalwartSetMessage marks a message read or unread and/or moves it to inbox, sent, draft or trash.
func (s *server) stalwartSetMessage(ctx context.Context, accountID, emailID string, read *bool, folder string) error {
	update := map[string]any{}
	if read != nil {
		update["keywords/$seen"] = *read
	}
	if folder != "" {
		roles, err := s.stalwartMailboxRoles(ctx, accountID)
		if err != nil {
			return err
		}
		role := map[string]string{"draft": "drafts"}[folder]
		if role == "" {
			role = folder
		}
		if roles[role] == "" {
			return errMailFolderMissing
		}
		update["mailboxIds"] = map[string]bool{roles[role]: true}
	}
	raw, err := s.stalwartMethod(ctx, "Email/set", map[string]any{"accountId": accountID, "update": map[string]any{emailID: update}})
	if err != nil {
		return err
	}
	_, err = decodeStalwartSet(raw, "")
	return err
}

func (s *server) updateStalwartMessage(c *fiber.Ctx, accountID, emailID string, read *bool, folder string) error {
	err := s.stalwartSetMessage(c.Context(), accountID, emailID, read, folder)
	if errors.Is(err, errMailFolderMissing) {
		return c.SendStatus(400)
	}
	if errors.Is(err, errStalwartNotFound) {
		return c.SendStatus(404)
	}
	if err != nil {
		return err
	}
	return c.SendStatus(204)
}

func (s *server) downloadStalwartBlob(c *fiber.Ctx) error {
	actor := current(c)
	_, _, _, _, err := s.mailboxAccess(c.Context(), c.Params("id"), actor.ID)
	if err != nil {
		return c.SendStatus(404)
	}
	var accountID string
	if err := s.db.QueryRow(c.Context(), `SELECT COALESCE(stalwart_account_id,'') FROM mailboxes WHERE public_id=$1`, c.Params("id")).Scan(&accountID); err != nil || accountID == "" {
		return c.SendStatus(404)
	}
	blobID, filename := c.Query("blobId"), c.Query("name", "attachment")
	target := s.cfg.stalwartAPIURL + "/jmap/download/" + url.PathEscape(accountID) + "/" + url.PathEscape(blobID) + "/" + url.PathEscape(filename)
	req, _ := http.NewRequestWithContext(c.Context(), http.MethodGet, target, nil)
	req.Header.Set("Authorization", s.stalwartAuthorization())
	resp, err := (&http.Client{Timeout: 45 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return c.SendStatus(resp.StatusCode)
	}
	c.Set(fiber.HeaderContentType, firstNonEmpty(resp.Header.Get("Content-Type"), "application/octet-stream"))
	c.Set(fiber.HeaderContentDisposition, mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	return c.SendStream(resp.Body)
}

func (s *server) startStalwartMessageSync(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.syncPendingMessagesToStalwart(ctx); err != nil {
					fmt.Printf("[WARN] Stalwart message sync: %v\n", err)
				}
			}
		}
	}()
}

func (s *server) syncPendingMessagesToStalwart(ctx context.Context) error {
	rows, err := s.db.Query(ctx, `
		SELECT m.id,m.public_id,m.mailbox_id,mb.public_id,COALESCE(mb.stalwart_account_id,''),m.folder,
		       m.from_address,m.from_name,m.subject,m.body_text,m.body_html,COALESCE(m.in_reply_to,''),m.message_references,
		       m.direction, mb.local_part || '@' || d.domain
		FROM mail_messages m JOIN mailboxes mb ON mb.id=m.mailbox_id JOIN mail_domains d ON d.id=mb.domain_id
		WHERE m.stalwart_email_id IS NULL AND mb.stalwart_account_id IS NOT NULL
		      AND m.delivery_status <> 'queued'
		ORDER BY m.id LIMIT 20`)
	if err != nil {
		return err
	}
	type pendingMessage struct {
		id, mailboxID                                          int64
		publicID, mailboxPublic, accountID, folder             string
		from, fromName, subject, textBody, htmlBody, inReplyTo string
		references                                             []string
		direction, address                                     string
	}
	pending := []pendingMessage{}
	for rows.Next() {
		var item pendingMessage
		if err := rows.Scan(&item.id, &item.publicID, &item.mailboxID, &item.mailboxPublic, &item.accountID, &item.folder, &item.from, &item.fromName, &item.subject, &item.textBody, &item.htmlBody, &item.inReplyTo, &item.references, &item.direction, &item.address); err != nil {
			rows.Close()
			return err
		}
		pending = append(pending, item)
	}
	rows.Close()
	for _, item := range pending {
		compose := mailComposeInput{MailboxID: item.mailboxPublic, Subject: item.subject, Text: item.textBody, HTML: item.htmlBody, InReplyTo: item.inReplyTo, References: item.references}
		recipientRows, err := s.db.Query(ctx, `SELECT kind,address,display_name FROM mail_recipients WHERE message_id=$1 ORDER BY id`, item.id)
		if err != nil {
			continue
		}
		for recipientRows.Next() {
			var kind string
			var recipient mailRecipientInput
			if recipientRows.Scan(&kind, &recipient.Address, &recipient.Name) == nil {
				switch kind {
				case "to":
					compose.To = append(compose.To, recipient)
				case "cc":
					compose.CC = append(compose.CC, recipient)
				case "bcc":
					compose.BCC = append(compose.BCC, recipient)
				}
			}
		}
		recipientRows.Close()
		if s.storage != nil {
			attachmentRows, queryErr := s.db.Query(ctx, `SELECT object_key,filename,content_type,COALESCE(content_id,'') FROM mail_attachments WHERE message_id=$1 ORDER BY id`, item.id)
			if queryErr == nil {
				for attachmentRows.Next() {
					var objectKey, filename, contentType, contentID string
					if attachmentRows.Scan(&objectKey, &filename, &contentType, &contentID) != nil {
						continue
					}
					object, getErr := s.storage.GetObject(ctx, s.cfg.s3Bucket, objectKey, minio.GetObjectOptions{})
					if getErr != nil {
						continue
					}
					data, readErr := io.ReadAll(io.LimitReader(object, mailMaxAttachmentBytes+1))
					object.Close()
					if readErr == nil && int64(len(data)) <= mailMaxAttachmentBytes {
						compose.Attachments = append(compose.Attachments, mailAttachmentInput{Filename: filename, ContentType: contentType, Content: base64.StdEncoding.EncodeToString(data), ContentID: contentID})
					}
				}
				attachmentRows.Close()
			}
		}
		content, _, err := buildStalwartEML(item.from, item.fromName, item.subject, item.textBody, item.htmlBody, item.inReplyTo, item.references, compose)
		if err != nil {
			_, _ = s.db.Exec(ctx, `UPDATE mail_messages SET stalwart_migration_error=$2 WHERE id=$1`, item.id, err.Error())
			continue
		}
		blobID, err := s.stalwartUpload(ctx, item.accountID, content, "message/rfc822")
		if err != nil {
			_, _ = s.db.Exec(ctx, `UPDATE mail_messages SET stalwart_migration_error=$2 WHERE id=$1`, item.id, err.Error())
			continue
		}
		roles, err := s.stalwartMailboxRoles(ctx, item.accountID)
		if err != nil {
			continue
		}
		role := map[string]string{"draft": "drafts"}[item.folder]
		if role == "" {
			role = item.folder
		}
		raw, err := s.stalwartMethod(ctx, "Email/import", map[string]any{"accountId": item.accountID, "emails": map[string]any{
			"pending": map[string]any{"blobId": blobID, "mailboxIds": map[string]bool{roles[role]: true}, "keywords": map[string]bool{"$seen": false}, "receivedAt": time.Now().UTC()},
		}})
		if err != nil {
			continue
		}
		created, err := decodeStalwartSet(raw, "pending")
		if err == nil && created.ID != "" {
			_, _ = s.db.Exec(ctx, `UPDATE mail_messages SET stalwart_email_id=$2,stalwart_migrated_at=NOW(),stalwart_migration_error='' WHERE id=$1`, item.id, created.ID)
			if item.direction == "inbound" {
				s.audit(nil, auditEvent{Category: "mail", Action: "mail.message.received", Target: "mailbox", TargetID: item.mailboxPublic,
					Metadata: map[string]any{
						"address": item.address, "from": strings.TrimSpace(item.fromName + " <" + item.from + ">"),
						"to": mailRecipientList(compose.To, compose.CC), "subject": firstNonEmpty(strings.TrimSpace(item.subject), "(ไม่มีหัวข้อ)"),
					}})
			}
		}
	}
	return nil
}
