package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

// Bot gallery (web page) with ticket-based auto-login.
//
// Flow:
//  1. Discord bot calls POST /api/internal/bot/gallery-ticket (bot secret) with
//     the Discord user identity -> backend returns a single-use login URL:
//     https://nkn02.com/gallery?ticket=<64 hex chars> (10-minute expiry).
//  2. The /gallery web page POSTs the ticket to /api/gallery/session, which
//     validates it (hash match, unused, unexpired) in a transaction, marks it
//     used, and sets an HttpOnly+Secure+SameSite=Lax session cookie scoped to
//     that Discord user (24h expiry).
//  3. GET /api/gallery/uploads lists the user's uploads; DELETE removes one
//     (MinIO object + DB row), always filtered by the session's identity so a
//     user can never see or delete another user's files.

const (
	// galleryPublicBase must stay in sync with the web app's /gallery route.
	galleryPublicBase    = "https://nkn02.com/gallery"
	galleryTicketTTL     = 10 * time.Minute
	gallerySessionTTL    = 24 * time.Hour
	galleryCookieName    = "nexora_gallery"
	galleryTicketBytes   = 32
	gallerySessionBytes  = 32
	galleryMaxListLimit  = 100
)

type gallerySession struct {
	ID            int64
	DiscordUserID string
	Username      string
	GuildID       string
}

func newGalleryToken(n int) (string, error) {
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

// gallerySessionFromCookie loads and validates the gallery session cookie.
// Returns (nil, nil) when there is no usable session.
func (s *server) gallerySessionFromCookie(c *fiber.Ctx) (*gallerySession, error) {
	token := strings.TrimSpace(c.Cookies(galleryCookieName))
	if token == "" {
		return nil, nil
	}
	var sess gallerySession
	err := s.db.QueryRow(c.Context(), `SELECT id, discord_user_id, discord_username, guild_id
		FROM bot_gallery_sessions
		WHERE token_hash = $1 AND expires_at > NOW()`,
		tokenHash(token),
	).Scan(&sess.ID, &sess.DiscordUserID, &sess.Username, &sess.GuildID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &sess, nil
}

func (s *server) requireGallerySession(c *fiber.Ctx) (*gallerySession, bool) {
	sess, err := s.gallerySessionFromCookie(c)
	if err != nil {
		log.Printf("[gallery] session lookup error: %v", err)
		_ = c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาด", Code: "internal_error"})
		return nil, false
	}
	if sess == nil {
		_ = c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "กรุณาเข้าสู่ระบบใหม่ผ่านบอท Discord", Code: "gallery_unauthorized"})
		return nil, false
	}
	return sess, true
}

type galleryTicketRequest struct {
	DiscordUserID string `json:"discord_user_id"`
	Username      string `json:"discord_username"`
	GuildID       string `json:"guild_id"`
}

// botIssueGalleryTicket handles POST /api/internal/bot/gallery-ticket.
// Bot-only (X-Bot-Internal-Secret). Issues a single-use auto-login ticket.
func (s *server) botIssueGalleryTicket(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var req galleryTicketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	req.DiscordUserID = strings.TrimSpace(req.DiscordUserID)
	req.Username = strings.TrimSpace(req.Username)
	req.GuildID = strings.TrimSpace(req.GuildID)
	if req.DiscordUserID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ต้องระบุ discord_user_id", Code: "missing_user"})
	}

	token, err := newGalleryToken(galleryTicketBytes)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาด", Code: "internal_error"})
	}
	// Best-effort cleanup of expired tickets/sessions so the tables stay small.
	_, _ = s.db.Exec(c.Context(), `DELETE FROM bot_gallery_tickets WHERE expires_at < NOW() - INTERVAL '1 day'`)
	_, _ = s.db.Exec(c.Context(), `DELETE FROM bot_gallery_sessions WHERE expires_at < NOW() - INTERVAL '1 day'`)

	if _, err := s.db.Exec(c.Context(), `INSERT INTO bot_gallery_tickets
		(token_hash, discord_user_id, discord_username, guild_id, expires_at)
		VALUES ($1, $2, $3, $4, NOW() + $5::interval)`,
		tokenHash(token), req.DiscordUserID, req.Username, req.GuildID,
		strconv.FormatInt(int64(galleryTicketTTL/time.Second), 10)+" seconds",
	); err != nil {
		log.Printf("[gallery] ticket insert error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ออก ticket ไม่สำเร็จ", Code: "ticket_failed"})
	}
	log.Printf("[gallery] ticket issued for user=%s(%s) guild=%s", req.Username, req.DiscordUserID, req.GuildID)
	return c.JSON(fiber.Map{
		"url":        galleryPublicBase + "?ticket=" + token,
		"expires_in": int64(galleryTicketTTL / time.Second),
	})
}

type galleryRedeemRequest struct {
	Ticket string `json:"ticket"`
}

// galleryRedeemSession handles POST /api/gallery/session.
// Public endpoint: validates the single-use ticket and creates a session cookie.
func (s *server) galleryRedeemSession(c *fiber.Ctx) error {
	var req galleryRedeemRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	ticket := strings.TrimSpace(req.Ticket)
	if len(ticket) != galleryTicketBytes*2 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Ticket ไม่ถูกต้อง", Code: "invalid_ticket"})
	}

	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาด", Code: "internal_error"})
	}
	defer tx.Rollback(c.Context())

	var ticketID int64
	var discordUserID, username, guildID string
	err = tx.QueryRow(c.Context(), `SELECT id, discord_user_id, discord_username, guild_id
		FROM bot_gallery_tickets
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
		FOR UPDATE`,
		tokenHash(ticket),
	).Scan(&ticketID, &discordUserID, &username, &guildID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusGone).JSON(apiError{Error: "ลิงก์หมดอายุหรือถูกใช้แล้ว กรุณาขอลิงก์ใหม่ด้วยคำสั่ง /gallery", Code: "ticket_expired"})
	}
	if err != nil {
		log.Printf("[gallery] ticket lookup error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาด", Code: "internal_error"})
	}
	if _, err := tx.Exec(c.Context(), `UPDATE bot_gallery_tickets SET used_at = NOW() WHERE id = $1`, ticketID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาด", Code: "internal_error"})
	}

	sessionToken, err := newGalleryToken(gallerySessionBytes)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาด", Code: "internal_error"})
	}
	if _, err := tx.Exec(c.Context(), `INSERT INTO bot_gallery_sessions
		(token_hash, discord_user_id, discord_username, guild_id, expires_at)
		VALUES ($1, $2, $3, $4, NOW() + $5::interval)`,
		tokenHash(sessionToken), discordUserID, username, guildID,
		strconv.FormatInt(int64(gallerySessionTTL/time.Second), 10)+" seconds",
	); err != nil {
		log.Printf("[gallery] session insert error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาด", Code: "internal_error"})
	}
	if err := tx.Commit(c.Context()); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาด", Code: "internal_error"})
	}

	c.Cookie(&fiber.Cookie{
		Name:     galleryCookieName,
		Value:    sessionToken,
		Path:     "/",
		MaxAge:   int(gallerySessionTTL / time.Second),
		HTTPOnly: true,
		Secure:   true, // nkn02.com is https-only (HSTS)
		SameSite: fiber.CookieSameSiteLaxMode,
	})
	log.Printf("[gallery] session created for user=%s(%s) guild=%s", username, discordUserID, guildID)
	return c.JSON(fiber.Map{"ok": true, "discord_username": username})
}

type galleryUploadItem struct {
	ID          int64  `json:"id"`
	URL         string `json:"url"`
	Filename    string `json:"filename"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
	CreatedAt   string `json:"created_at"`
}

// galleryListUploads handles GET /api/gallery/uploads (session cookie required).
// Only the session owner's uploads in the ticket's guild are returned.
func (s *server) galleryListUploads(c *fiber.Ctx) error {
	sess, ok := s.requireGallerySession(c)
	if !ok {
		return nil
	}
	rows, err := s.db.Query(c.Context(), `SELECT id, url, filename, size_bytes, content_type,
		TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM bot_uploads
		WHERE discord_user_id = $1 AND guild_id = $2
		ORDER BY created_at DESC
		LIMIT $3`, sess.DiscordUserID, sess.GuildID, galleryMaxListLimit)
	if err != nil {
		log.Printf("[gallery] list query error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ดึงข้อมูลไม่สำเร็จ", Code: "list_failed"})
	}
	defer rows.Close()

	items := make([]galleryUploadItem, 0, 32)
	for rows.Next() {
		var it galleryUploadItem
		if err := rows.Scan(&it.ID, &it.URL, &it.Filename, &it.Size, &it.ContentType, &it.CreatedAt); err != nil {
			log.Printf("[gallery] row scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ดึงข้อมูลไม่สำเร็จ", Code: "list_failed"})
		}
		items = append(items, it)
	}
	return c.JSON(fiber.Map{"items": items})
}

// galleryDeleteUpload handles DELETE /api/gallery/uploads/:id (session cookie required).
// Verifies the upload belongs to the session owner before deleting the MinIO
// object and the DB row.
func (s *server) galleryDeleteUpload(c *fiber.Ctx) error {
	sess, ok := s.requireGallerySession(c)
	if !ok {
		return nil
	}
	id, err := strconv.ParseInt(strings.TrimSpace(c.Params("id")), 10, 64)
	if err != nil || id <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสรูปไม่ถูกต้อง", Code: "invalid_id"})
	}

	var objectKey, filename string
	err = s.db.QueryRow(c.Context(), `SELECT object_key, filename FROM bot_uploads
		WHERE id = $1 AND discord_user_id = $2 AND guild_id = $3`,
		id, sess.DiscordUserID, sess.GuildID,
	).Scan(&objectKey, &filename)
	if errors.Is(err, pgx.ErrNoRows) {
		// Same response whether the id doesn't exist or belongs to someone else.
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบรูปนี้", Code: "not_found"})
	}
	if err != nil {
		log.Printf("[gallery] delete lookup error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ลบไม่สำเร็จ", Code: "delete_failed"})
	}

	// Delete the object first: if this fails the DB row is kept so the user
	// can retry (and the file stays reachable, not silently orphaned).
	if s.storage != nil {
		if err := s.storage.RemoveObject(c.Context(), s.cfg.s3Bucket, objectKey, minio.RemoveObjectOptions{}); err != nil {
			log.Printf("[gallery] MinIO RemoveObject error key=%s: %v", objectKey, err)
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ลบไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง", Code: "delete_failed"})
		}
	}
	if _, err := s.db.Exec(c.Context(), `DELETE FROM bot_uploads
		WHERE id = $1 AND discord_user_id = $2 AND guild_id = $3`,
		id, sess.DiscordUserID, sess.GuildID,
	); err != nil {
		log.Printf("[gallery] delete row error id=%d: %v", id, err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ลบไม่สำเร็จ", Code: "delete_failed"})
	}
	log.Printf("[gallery] deleted id=%d key=%s file=%s by user=%s(%s)", id, objectKey, filename, sess.Username, sess.DiscordUserID)
	return c.JSON(fiber.Map{"ok": true})
}
