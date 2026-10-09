package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"nexora-cloud-api/internal/mailsanitize"
)

const maxInboundAttachmentBytes int64 = 20 * 1024 * 1024

type config struct {
	databaseURL, resendKey, resendBase, encryptionKey string
	s3Endpoint, s3Access, s3Secret, s3Bucket          string
	s3SSL                                             bool
}

type worker struct {
	cfg     config
	db      *pgxpool.Pool
	storage *minio.Client
	http    *http.Client
}

type resendReceived struct {
	ID          string            `json:"id"`
	MessageID   string            `json:"message_id"`
	From        string            `json:"from"`
	To          []string          `json:"to"`
	CC          []string          `json:"cc"`
	BCC         []string          `json:"bcc"`
	ReplyTo     []string          `json:"reply_to"`
	Subject     string            `json:"subject"`
	HTML        string            `json:"html"`
	Text        string            `json:"text"`
	Headers     map[string]string `json:"headers"`
	Attachments []struct {
		ID                 string `json:"id"`
		Filename           string `json:"filename"`
		ContentType        string `json:"content_type"`
		ContentDisposition string `json:"content_disposition"`
		ContentID          string `json:"content_id"`
		Size               int64  `json:"size"`
	} `json:"attachments"`
}

type recipient struct{ Kind, Address, Name string }
type attachment struct {
	ID, ObjectKey, Filename, ContentType string
	Size                                 int64
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
func envBool(name string) bool {
	value := strings.TrimSpace(os.Getenv(name))
	return value == "1" || strings.EqualFold(value, "true")
}

func main() {
	cfg := config{databaseURL: env("DATABASE_URL", "postgres://nexora:nexora@localhost:5432/nexora?sslmode=disable"), resendKey: env("RESEND_API_KEY", ""), resendBase: strings.TrimRight(env("RESEND_API_BASE_URL", "https://api.resend.com"), "/"), encryptionKey: env("WEBHOOK_ENCRYPTION_KEY", "local-only-change-this-webhook-key"), s3Endpoint: env("S3_ENDPOINT", "minio:9000"), s3Access: env("S3_ACCESS_KEY", "nexora"), s3Secret: env("S3_SECRET_KEY", ""), s3Bucket: env("S3_BUCKET", "nexora-assets"), s3SSL: envBool("S3_USE_SSL")}
	ctx := context.Background()
	db, err := pgxpool.New(ctx, cfg.databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	for attempt := 0; attempt < 30; attempt++ {
		if db.Ping(ctx) == nil {
			break
		}
		time.Sleep(time.Second)
	}
	storage, err := minio.New(cfg.s3Endpoint, &minio.Options{Creds: credentials.NewStaticV4(cfg.s3Access, cfg.s3Secret, ""), Secure: cfg.s3SSL})
	if err != nil {
		log.Fatal(err)
	}
	w := &worker{cfg: cfg, db: db, storage: storage, http: &http.Client{Timeout: 45 * time.Second}}
	log.Println("NEXORA mail worker started")
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	purgeTicker := time.NewTicker(time.Hour)
	defer purgeTicker.Stop()
	for {
		select {
		case <-ticker.C:
			w.processJob(ctx)
			w.processWebhook(ctx)
		case <-purgeTicker.C:
			w.purgeTrash(ctx)
		}
	}
}

func (w *worker) request(ctx context.Context, method, path string, input, output any) error {
	apiKey, err := w.effectiveResendKey(ctx)
	if err != nil {
		return err
	}
	if apiKey == "" {
		return errors.New("RESEND_API_KEY is not configured")
	}
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, w.cfg.resendBase+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 45*1024*1024))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("resend HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if output != nil {
		return json.Unmarshal(data, output)
	}
	return nil
}

func decryptSetting(ciphertext, passphrase string) (string, error) {
	raw, err := base64.RawStdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid mail setting ciphertext")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(plain), err
}

func (w *worker) effectiveResendKey(ctx context.Context) (string, error) {
	var ciphertext string
	err := w.db.QueryRow(ctx, `SELECT resend_api_key_ciphertext FROM mail_provider_settings WHERE singleton=TRUE`).Scan(&ciphertext)
	if errors.Is(err, pgx.ErrNoRows) || ciphertext == "" {
		return w.cfg.resendKey, nil
	}
	if err != nil {
		return "", err
	}
	return decryptSetting(ciphertext, w.cfg.encryptionKey)
}

// trustedResendHost accepts Resend's own domains. Received attachments are served from
// cdn.resend.app, so allowing only *.resend.com dropped every inbound attachment.
func trustedResendHost(host string) bool {
	host = strings.ToLower(host)
	for _, domain := range []string{"resend.com", "resend.app"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

func (w *worker) downloadAttachment(ctx context.Context, emailID, attachmentID string) ([]byte, string, error) {
	var info struct {
		Size        int64  `json:"size"`
		ContentType string `json:"content_type"`
		DownloadURL string `json:"download_url"`
	}
	if err := w.request(ctx, http.MethodGet, "/emails/receiving/"+emailID+"/attachments/"+attachmentID, nil, &info); err != nil {
		return nil, "", err
	}
	if info.Size > maxInboundAttachmentBytes || info.DownloadURL == "" {
		return nil, "", errors.New("attachment exceeds 20 MB or has no download URL")
	}
	parsed, err := url.Parse(info.DownloadURL)
	if err != nil || parsed.Scheme != "https" || !trustedResendHost(parsed.Hostname()) {
		return nil, "", errors.New("untrusted attachment download URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, info.DownloadURL, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := w.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxInboundAttachmentBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxInboundAttachmentBytes {
		return nil, "", errors.New("attachment exceeds 20 MB")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("resend attachment download HTTP %d", resp.StatusCode)
	}
	contentType := info.ContentType
	if contentType == "" {
		contentType = resp.Header.Get("Content-Type")
	}
	return data, contentType, nil
}

func (w *worker) processJob(ctx context.Context) {
	tx, err := w.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var jobID, messageID int64
	err = tx.QueryRow(ctx, `SELECT id,message_id FROM mail_jobs WHERE state='queued' AND kind='send' AND available_at<=NOW() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&jobID, &messageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return
	}
	if err != nil {
		return
	}
	if _, err = tx.Exec(ctx, `UPDATE mail_jobs SET state='processing',attempts=attempts+1,updated_at=NOW() WHERE id=$1`, jobID); err != nil {
		return
	}
	if tx.Commit(ctx) != nil {
		return
	}
	err = w.send(ctx, messageID)
	if err == nil {
		_, _ = w.db.Exec(ctx, `UPDATE mail_jobs SET state='succeeded',last_error='',updated_at=NOW() WHERE id=$1`, jobID)
		return
	}
	var attempts int
	_ = w.db.QueryRow(ctx, `SELECT attempts FROM mail_jobs WHERE id=$1`, jobID).Scan(&attempts)
	if attempts >= 5 {
		_, _ = w.db.Exec(ctx, `UPDATE mail_jobs SET state='failed',last_error=$2,updated_at=NOW() WHERE id=$1`, jobID, shortError(err))
		_, _ = w.db.Exec(ctx, `UPDATE mail_messages SET delivery_status='failed',updated_at=NOW() WHERE id=$1`, messageID)
		return
	}
	delay := time.Duration(attempts*attempts) * time.Minute
	_, _ = w.db.Exec(ctx, `UPDATE mail_jobs SET state='queued',available_at=NOW()+$2::interval,last_error=$3,updated_at=NOW() WHERE id=$1`, jobID, fmt.Sprintf("%d seconds", int(delay.Seconds())), shortError(err))
}

func (w *worker) send(ctx context.Context, messageID int64) error {
	var from, fromName, subject, textBody, htmlBody, inReply, idempotency string
	var refs []string
	err := w.db.QueryRow(ctx, `SELECT from_address,from_name,subject,body_text,body_html,COALESCE(in_reply_to,''),message_references,COALESCE(idempotency_key,'') FROM mail_messages WHERE id=$1 AND delivery_status IN ('queued','sending')`, messageID).Scan(&from, &fromName, &subject, &textBody, &htmlBody, &inReply, &refs, &idempotency)
	if err != nil {
		return err
	}
	_, _ = w.db.Exec(ctx, `UPDATE mail_messages SET delivery_status='sending',updated_at=NOW() WHERE id=$1`, messageID)
	rows, err := w.db.Query(ctx, `SELECT kind,address,display_name FROM mail_recipients WHERE message_id=$1 ORDER BY id`, messageID)
	if err != nil {
		return err
	}
	recipients := []recipient{}
	for rows.Next() {
		var r recipient
		if rows.Scan(&r.Kind, &r.Address, &r.Name) == nil {
			recipients = append(recipients, r)
		}
	}
	rows.Close()
	to, cc, bcc := []string{}, []string{}, []string{}
	for _, r := range recipients {
		value := r.Address
		if r.Name != "" {
			value = r.Name + " <" + r.Address + ">"
		}
		switch r.Kind {
		case "to":
			to = append(to, value)
		case "cc":
			cc = append(cc, value)
		case "bcc":
			bcc = append(bcc, value)
		}
	}
	attachmentRows, err := w.db.Query(ctx, `SELECT public_id,object_key,filename,content_type,size_bytes FROM mail_attachments WHERE message_id=$1 ORDER BY id`, messageID)
	if err != nil {
		return err
	}
	attachments := []map[string]any{}
	for attachmentRows.Next() {
		var a attachment
		if err := attachmentRows.Scan(&a.ID, &a.ObjectKey, &a.Filename, &a.ContentType, &a.Size); err != nil {
			attachmentRows.Close()
			return err
		}
		object, err := w.storage.GetObject(ctx, w.cfg.s3Bucket, a.ObjectKey, minio.GetObjectOptions{})
		if err != nil {
			attachmentRows.Close()
			return err
		}
		data, err := io.ReadAll(io.LimitReader(object, maxInboundAttachmentBytes+1))
		object.Close()
		if err != nil || int64(len(data)) > maxInboundAttachmentBytes {
			attachmentRows.Close()
			return errors.New("cannot read outbound attachment")
		}
		attachments = append(attachments, map[string]any{"filename": a.Filename, "content": base64.StdEncoding.EncodeToString(data), "content_type": a.ContentType})
	}
	attachmentRows.Close()
	payload := map[string]any{"from": from, "to": to, "subject": subject, "text": textBody, "html": htmlBody}
	if fromName != "" {
		payload["from"] = fromName + " <" + from + ">"
	}
	if len(cc) > 0 {
		payload["cc"] = cc
	}
	if len(bcc) > 0 {
		payload["bcc"] = bcc
	}
	if len(attachments) > 0 {
		payload["attachments"] = attachments
	}
	headers := map[string]string{}
	if inReply != "" {
		headers["In-Reply-To"] = inReply
	}
	if len(refs) > 0 {
		headers["References"] = strings.Join(refs, " ")
	}
	if len(headers) > 0 {
		payload["headers"] = headers
	}
	var response struct {
		ID string `json:"id"`
	}
	if err := w.request(ctx, http.MethodPost, "/emails", payload, &response); err != nil {
		return err
	}
	_, err = w.db.Exec(ctx, `UPDATE mail_messages SET provider_message_id=$2,delivery_status='sent',sent_at=NOW(),updated_at=NOW() WHERE id=$1`, messageID, response.ID)
	return err
}

func (w *worker) processWebhook(ctx context.Context) {
	tx, err := w.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	var id, eventType string
	var payload []byte
	err = tx.QueryRow(ctx, `SELECT provider_event_id,event_type,payload FROM mail_webhook_events WHERE state='queued' AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&id, &eventType, &payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return
	}
	if err != nil {
		return
	}
	if _, err = tx.Exec(ctx, `UPDATE mail_webhook_events SET state='processing',attempts=attempts+1 WHERE provider_event_id=$1`, id); err != nil {
		return
	}
	if tx.Commit(ctx) != nil {
		return
	}
	err = w.handleWebhook(ctx, id, eventType, payload)
	if err == nil {
		_, _ = w.db.Exec(ctx, `UPDATE mail_webhook_events SET state='processed',processed_at=NOW(),last_error='' WHERE provider_event_id=$1`, id)
		return
	}
	var attempts int
	_ = w.db.QueryRow(ctx, `SELECT attempts FROM mail_webhook_events WHERE provider_event_id=$1`, id).Scan(&attempts)
	if attempts >= 5 {
		_, _ = w.db.Exec(ctx, `UPDATE mail_webhook_events SET state='failed',last_error=$2 WHERE provider_event_id=$1`, id, shortError(err))
		return
	}
	_, _ = w.db.Exec(ctx, `UPDATE mail_webhook_events SET state='queued',available_at=NOW()+$2::interval,last_error=$3 WHERE provider_event_id=$1`, id, fmt.Sprintf("%d seconds", attempts*attempts*60), shortError(err))
}

func (w *worker) handleWebhook(ctx context.Context, id, eventType string, payload []byte) error {
	var envelope struct {
		Data struct {
			EmailID string `json:"email_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return err
	}
	emailID := envelope.Data.EmailID
	if emailID == "" {
		return errors.New("event has no email_id")
	}
	if eventType == "email.received" {
		return w.receive(ctx, id, emailID)
	}
	statusMap := map[string]string{"email.sent": "sent", "email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.bounced": "bounced", "email.failed": "failed", "email.complained": "failed"}
	status, ok := statusMap[eventType]
	if !ok {
		_, _ = w.db.Exec(ctx, `UPDATE mail_webhook_events SET state='ignored',processed_at=NOW() WHERE provider_event_id=$1`, id)
		return nil
	}
	var messageID *int64
	_ = w.db.QueryRow(ctx, `SELECT id FROM mail_messages WHERE provider_message_id=$1 LIMIT 1`, emailID).Scan(&messageID)
	_, err := w.db.Exec(ctx, `INSERT INTO mail_delivery_events(message_id,provider_event_id,event_type,payload) VALUES($1,$2,$3,$4) ON CONFLICT(provider_event_id) DO NOTHING`, messageID, id, eventType, payload)
	if err != nil {
		return err
	}
	_, err = w.db.Exec(ctx, `UPDATE mail_messages SET delivery_status=$2,updated_at=NOW() WHERE provider_message_id=$1`, emailID, status)
	return err
}

func parseAddress(value string) (string, string) {
	value = strings.TrimSpace(value)
	start := strings.LastIndex(value, "<")
	end := strings.LastIndex(value, ">")
	if start >= 0 && end > start {
		return strings.TrimSpace(value[:start]), strings.ToLower(strings.TrimSpace(value[start+1 : end]))
	}
	return "", strings.ToLower(value)
}
func normalizeSubject(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	prefix := regexp.MustCompile(`^(re|fw|fwd):\s*`)
	for prefix.MatchString(value) {
		value = prefix.ReplaceAllString(value, "")
	}
	return value
}

func sanitize(value string) string {
	return mailsanitize.Sanitize(value)
}

func (w *worker) receive(ctx context.Context, eventID, emailID string) error {
	var received resendReceived
	if err := w.request(ctx, http.MethodGet, "/emails/receiving/"+emailID, nil, &received); err != nil {
		return err
	}
	if received.ID == "" {
		received.ID = emailID
	}
	targets := map[int64]struct{}{}
	for _, raw := range append(append([]string{}, received.To...), append(received.CC, received.BCC...)...) {
		_, address := parseAddress(raw)
		parts := strings.Split(address, "@")
		if len(parts) != 2 {
			continue
		}
		var mailboxID int64
		err := w.db.QueryRow(ctx, `
		SELECT mailbox_id FROM (
		 SELECT m.id AS mailbox_id FROM mailboxes m JOIN mail_domains d ON d.id=m.domain_id WHERE LOWER(m.local_part)=LOWER($1) AND LOWER(d.domain)=LOWER($2) AND m.deleted_at IS NULL AND m.status='active' AND d.status='active'
		 UNION ALL SELECT a.mailbox_id FROM mail_aliases a JOIN mail_domains d ON d.id=a.domain_id JOIN mailboxes m ON m.id=a.mailbox_id WHERE LOWER(a.local_part)=LOWER($1) AND LOWER(d.domain)=LOWER($2) AND a.deleted_at IS NULL AND m.deleted_at IS NULL AND m.status='active' AND d.status='active'
		) target LIMIT 1`, parts[0], parts[1]).Scan(&mailboxID)
		if err == nil {
			targets[mailboxID] = struct{}{}
		}
	}
	if len(targets) == 0 {
		payload, _ := json.Marshal(map[string]any{"email_id": emailID, "reason": "unknown_recipient", "to": received.To, "cc": received.CC, "bcc": received.BCC})
		_, _ = w.db.Exec(ctx, `INSERT INTO mail_delivery_events(provider_event_id,event_type,payload) VALUES($1,'email.received.discarded_unknown',$2) ON CONFLICT(provider_event_id) DO NOTHING`, eventID, payload)
		return nil
	}
	fromName, fromAddress := parseAddress(received.From)
	headers, _ := json.Marshal(received.Headers)
	inReply := received.Headers["in-reply-to"]
	if inReply == "" {
		inReply = received.Headers["In-Reply-To"]
	}
	references := strings.Fields(received.Headers["references"])
	if len(references) == 0 {
		references = strings.Fields(received.Headers["References"])
	}
	for mailboxID := range targets {
		var quota, used int64
		var mailboxPublic string
		if err := w.db.QueryRow(ctx, `SELECT public_id,quota_bytes,used_bytes FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxPublic, &quota, &used); err != nil {
			return err
		}
		safeHTML := sanitize(received.HTML)
		size := int64(len(received.Text) + len(safeHTML))
		if size+used > quota {
			continue
		}
		tx, err := w.db.Begin(ctx)
		if err != nil {
			return err
		}
		var existing bool
		_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mail_messages WHERE mailbox_id=$1 AND provider_message_id=$2)`, mailboxID, emailID).Scan(&existing)
		if existing {
			tx.Rollback(ctx)
			continue
		}
		var threadID int64
		if inReply != "" {
			_ = tx.QueryRow(ctx, `SELECT thread_id FROM mail_messages WHERE mailbox_id=$1 AND internet_message_id=$2 AND thread_id IS NOT NULL ORDER BY id DESC LIMIT 1`, mailboxID, inReply).Scan(&threadID)
		}
		if threadID == 0 {
			_ = tx.QueryRow(ctx, `SELECT id FROM mail_threads WHERE mailbox_id=$1 AND subject_normalized=$2 ORDER BY latest_message_at DESC LIMIT 1`, mailboxID, normalizeSubject(received.Subject)).Scan(&threadID)
		}
		if threadID == 0 {
			if err := tx.QueryRow(ctx, `INSERT INTO mail_threads(public_id,mailbox_id,subject_normalized) VALUES($1,$2,$3) RETURNING id`, strings.ReplaceAll(uuid.NewString(), "-", ""), mailboxID, normalizeSubject(received.Subject)).Scan(&threadID); err != nil {
				tx.Rollback(ctx)
				return err
			}
		}
		messagePublic := strings.ReplaceAll(uuid.NewString(), "-", "")
		var messageID int64
		receivedAt := time.Now()
		if err := tx.QueryRow(ctx, `INSERT INTO mail_messages(public_id,mailbox_id,thread_id,provider_message_id,internet_message_id,in_reply_to,message_references,direction,folder,delivery_status,from_address,from_name,subject,body_text,body_html,headers,size_bytes,received_at) VALUES($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''),$7,'inbound','inbox','received',$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`, messagePublic, mailboxID, threadID, emailID, received.MessageID, inReply, references, fromAddress, fromName, received.Subject, received.Text, safeHTML, headers, size, receivedAt).Scan(&messageID); err != nil {
			tx.Rollback(ctx)
			return err
		}
		for _, group := range []struct {
			kind   string
			values []string
		}{{"to", received.To}, {"cc", received.CC}, {"bcc", received.BCC}} {
			for _, raw := range group.values {
				name, address := parseAddress(raw)
				_, _ = tx.Exec(ctx, `INSERT INTO mail_recipients(message_id,kind,address,display_name) VALUES($1,$2,$3,$4)`, messageID, group.kind, address, name)
			}
		}
		attachmentBytes := int64(0)
		for _, meta := range received.Attachments {
			if attachmentBytes+meta.Size > maxInboundAttachmentBytes {
				log.Printf("inbound mail %s: skipped attachment %s: over the 20 MB total", emailID, meta.ID)
				continue
			}
			data, ct, err := w.downloadAttachment(ctx, emailID, meta.ID)
			if err != nil {
				log.Printf("inbound mail %s: skipped attachment %s: %v", emailID, meta.ID, err)
				continue
			}
			attachmentBytes += int64(len(data))
			if size+attachmentBytes+used > quota {
				log.Printf("inbound mail %s: skipped attachment %s: mailbox quota full", emailID, meta.ID)
				continue
			}
			sum := sha256.Sum256(data)
			attachmentPublic := strings.ReplaceAll(uuid.NewString(), "-", "")
			key := "mail/" + mailboxPublic + "/" + attachmentPublic
			if _, err = w.storage.PutObject(ctx, w.cfg.s3Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: ct}); err != nil {
				log.Printf("inbound mail %s: skipped attachment %s: storage: %v", emailID, meta.ID, err)
				continue
			}
			filename := strings.ReplaceAll(strings.ReplaceAll(meta.Filename, "/", "_"), "\\", "_")
			_, _ = tx.Exec(ctx, `INSERT INTO mail_attachments(public_id,message_id,provider_attachment_id,object_key,filename,content_type,content_id,size_bytes,sha256_hex) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9)`, attachmentPublic, messageID, meta.ID, key, filename, ct, meta.ContentID, len(data), hex.EncodeToString(sum[:]))
		}
		total := size + attachmentBytes
		_, _ = tx.Exec(ctx, `UPDATE mail_messages SET size_bytes=$2 WHERE id=$1`, messageID, total)
		_, _ = tx.Exec(ctx, `UPDATE mailboxes SET used_bytes=used_bytes+$2,updated_at=NOW() WHERE id=$1`, mailboxID, total)
		_, _ = tx.Exec(ctx, `UPDATE mail_threads SET message_count=message_count+1,latest_message_at=$2 WHERE id=$1`, threadID, receivedAt)
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (w *worker) purgeTrash(ctx context.Context) {
	rows, err := w.db.Query(ctx, `SELECT a.object_key FROM mail_attachments a JOIN mail_messages m ON m.id=a.message_id WHERE m.folder='trash' AND m.trashed_at<NOW()-INTERVAL '30 days'`)
	if err == nil {
		for rows.Next() {
			var key string
			if rows.Scan(&key) == nil {
				_ = w.storage.RemoveObject(ctx, w.cfg.s3Bucket, key, minio.RemoveObjectOptions{})
			}
		}
		rows.Close()
	}
	_, _ = w.db.Exec(ctx, `WITH removed AS (DELETE FROM mail_messages WHERE folder='trash' AND trashed_at<NOW()-INTERVAL '30 days' RETURNING mailbox_id,size_bytes) UPDATE mailboxes m SET used_bytes=GREATEST(0,m.used_bytes-r.total),updated_at=NOW() FROM (SELECT mailbox_id,SUM(size_bytes) total FROM removed GROUP BY mailbox_id) r WHERE m.id=r.mailbox_id`)
}
func shortError(err error) string {
	value := err.Error()
	if len(value) > 1000 {
		return value[:1000]
	}
	return value
}
