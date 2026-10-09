package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

var webhookEventOptions = map[string]bool{
	"auth.login": true, "auth.register": true, "auth.oauth": true, "auth.logout": true,
	"password.changed": true, "user.status_changed": true, "user.role_changed": true,
	"user.updated": true, "user.deleted": true,
	"session.revoked": true, "sessions.revoked_all": true, "settings.updated": true,
	"announcement.created": true, "announcement.updated": true, "announcement.deleted": true,
	"topup.settings_updated": true,
	"discord.bot.activity":   true,
	"hosting.site.created":   true, "hosting.site.updated": true, "hosting.site.deleted": true,
	"hosting.database.created": true, "hosting.database.deleted": true,
	"lockdown.state_read_failed": true,
	"user.created":               true, "user.password_reset": true, "sessions.revoked_for_user": true, "social.connected": true,
	"ip.banned": true, "ip.unbanned": true, "ip.banned_access": true,
	"lockdown.enabled": true, "lockdown.disabled": true, "workspace.security_alert": true,
	"hosting.database.suspended": true, "hosting.database.unsuspended": true,
	"discord.voice.locked_out": true, "discord.voice.entry_denied": true,
	"discord.bot_token.updated": true, "discord.bot_token.removed": true,
}

func sanitizeWebhookEvents(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if webhookEventOptions[value] && !seen[value] {
			result = append(result, value)
			seen[value] = true
		}
	}
	return result
}

func validDiscordWebhookURL(value string) bool {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "discord.com" && !strings.HasSuffix(host, ".discord.com") &&
		host != "discordapp.com" && !strings.HasSuffix(host, ".discordapp.com") {
		return false
	}
	return strings.HasPrefix(parsed.Path, "/api/webhooks/")
}

func encryptSecret(secret, passphrase string) (string, error) {
	if secret == "" {
		return "", nil
	}
	key := sha256.Sum256([]byte(passphrase))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(secret), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptSecret(ciphertext, passphrase string) (string, error) {
	if ciphertext == "" {
		return "", nil
	}
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
		return "", errors.New("invalid webhook ciphertext")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(plain), err
}

func (s *server) dispatchWebhook(event auditEvent) {
	// The test button posts its own message, so its audit entry must not post a second one.
	if event.Action == "webhook.tested" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	var enabled bool
	var ciphertext string
	var rawEvents []byte
	if err := s.db.QueryRow(ctx, `
		SELECT webhook_enabled, discord_webhook_ciphertext, webhook_events
		FROM system_settings WHERE id = 1
	`).Scan(&enabled, &ciphertext, &rawEvents); err != nil || !enabled || ciphertext == "" {
		return
	}
	var configured []string
	if json.Unmarshal(rawEvents, &configured) != nil {
		return
	}
	// A failed lockdown read is always worth knowing about, whatever is ticked.
	allowed := event.Action == "lockdown.state_read_failed"
	for _, value := range configured {
		allowed = allowed || value == event.Action
	}
	if !allowed {
		return
	}
	webhookURL, err := decryptSecret(ciphertext, s.cfg.webhookKey)
	if err != nil || !validDiscordWebhookURL(webhookURL) {
		return
	}

	event.TargetName = s.securityTargetName(ctx, event)
	payload := fiber.Map{
		"username":         "NEXORA Security",
		"embeds":           []fiber.Map{buildDiscordEmbed(event)},
		"allowed_mentions": fiber.Map{"parse": []string{}},
	}
	if err := sendDiscordWebhook(ctx, webhookURL, payload); err != nil {
		// Do not log the error text: HTTP errors can contain the webhook token.
		fmt.Printf("webhook delivery failed: action=%s\n", event.Action)
	}
}

func sendDiscordWebhook(ctx context.Context, webhookURL string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		return fmt.Errorf("discord returned %d: %s", response.StatusCode, strings.TrimSpace(string(snippet)))
	}
	return nil
}

func (s *server) testWebhook(c *fiber.Ctx) error {
	var body struct {
		WebhookURL string `json:"webhookUrl"`
	}
	if len(c.Body()) > 0 && c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	webhookURL := strings.TrimSpace(body.WebhookURL)
	if webhookURL == "" {
		var ciphertext string
		if err := s.db.QueryRow(c.Context(), `SELECT discord_webhook_ciphertext FROM system_settings WHERE id=1`).Scan(&ciphertext); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		var err error
		webhookURL, err = decryptSecret(ciphertext, s.cfg.webhookKey)
		if err != nil || webhookURL == "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ยังไม่ได้ตั้งค่า Discord Webhook URL"})
		}
	}
	if !validDiscordWebhookURL(webhookURL) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Discord Webhook URL ไม่ถูกต้อง"})
	}

	actor := current(c)
	realIP := extractRealIP(c)
	geo := lookupGeo(realIP, c)

	testEvent := auditEvent{
		Actor:     actor,
		Category:  "settings",
		Action:    "webhook.tested",
		Target:    "system",
		TargetID:  "1",
		Outcome:   "success",
		IPAddress: realIP,
		UserAgent: c.Get(fiber.HeaderUserAgent),
		Geo:       &geo,
	}

	payload := fiber.Map{
		"username":         "NEXORA Security",
		"embeds":           []fiber.Map{buildDiscordEmbed(testEvent)},
		"allowed_mentions": fiber.Map{"parse": []string{}},
	}
	if err := sendDiscordWebhook(c.Context(), webhookURL, payload); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(apiError{Error: "ส่งข้อความไป Discord ไม่สำเร็จ"})
	}
	s.audit(c, testEvent)
	return c.SendStatus(fiber.StatusNoContent)
}
