package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/minio/minio-go/v7"
)

// botUploadPublicBase is the public base URL for images uploaded via the Discord bot.
// Caddy serves it: /assets/<nested-path> is rewritten to /nexora-assets/<nested-path>
// and reverse-proxied to MinIO (bucket "nexora-assets"). Must stay in sync with
// the @uploaded_asset handle in /opt/app/nexora/Caddyfile.
const botUploadPublicBase = "https://nkn02.com/assets"

const (
	botUploadMaxFiles = 10
	botUploadMaxBytes = 25 * 1024 * 1024 // 25MB per file, matches Discord's attachment limit
	botUploadPrefix   = "uploads"
)

// botUploadAllowedTypes maps sniffed content types to file extensions.
var botUploadAllowedTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

type botUploadedItem struct {
	URL      string `json:"url"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}

// botUploadImages handles POST /api/internal/bot/uploads.
//
// Expects multipart form data:
//   - fields: guild_id, discord_user_id, discord_username (metadata for logging)
//   - files: one or more parts named "file" (max 10, max 25MB each, images only)
//
// Requires the X-Bot-Internal-Secret header (same secret as the other bot APIs).
// Each file is stored in MinIO under "uploads/<random>.<ext>" and the response is:
//
//	{ "items": [{ "url": "https://nkn02.com/assets/uploads/...", "filename": "...", "size": 123 }] }
func (s *server) botUploadImages(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบจัดเก็บไฟล์ไม่พร้อมใช้งาน", Code: "storage_unavailable"})
	}

	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	files := form.File["file"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาแนบไฟล์รูปภาพ", Code: "no_files"})
	}
	if len(files) > botUploadMaxFiles {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{
			Error: fmt.Sprintf("อัปโหลดได้สูงสุด %d ไฟล์ต่อครั้ง", botUploadMaxFiles),
			Code:  "too_many_files",
		})
	}

	guildID := strings.TrimSpace(c.FormValue("guild_id"))
	discordUserID := strings.TrimSpace(c.FormValue("discord_user_id"))
	discordUsername := strings.TrimSpace(c.FormValue("discord_username"))

	items := make([]botUploadedItem, 0, len(files))
	for _, fh := range files {
		if fh.Size <= 0 || fh.Size > botUploadMaxBytes {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{
				Error: fmt.Sprintf("ไฟล์ %s มีขนาดไม่ถูกต้อง (สูงสุด 25MB)", fh.Filename),
				Code:  "invalid_file_size",
			})
		}
		f, err := fh.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "อ่านไฟล์ไม่สำเร็จ", Code: "file_read_error"})
		}
		data, err := io.ReadAll(io.LimitReader(f, botUploadMaxBytes+1))
		f.Close()
		if err != nil || int64(len(data)) > botUploadMaxBytes {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์มีขนาดใหญ่เกินไป", Code: "file_too_large"})
		}
		contentType := http.DetectContentType(data)
		ext, ok := botUploadAllowedTypes[contentType]
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{
				Error: fmt.Sprintf("ไฟล์ %s ไม่ใช่รูปภาพที่รองรับ (JPG, PNG, GIF, WebP)", fh.Filename),
				Code:  "unsupported_type",
			})
		}

		random := make([]byte, 12)
		if _, err := rand.Read(random); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาดภายใน", Code: "internal_error"})
		}
		key := botUploadPrefix + "/" + hex.EncodeToString(random) + ext
		if _, err := s.storage.PutObject(c.Context(), s.cfg.s3Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: contentType}); err != nil {
			log.Printf("[botUploadImages] MinIO PutObject error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "อัปโหลดไฟล์ไม่สำเร็จ", Code: "upload_failed"})
		}

		url := botUploadPublicBase + "/" + key
		items = append(items, botUploadedItem{URL: url, Filename: fh.Filename, Size: int64(len(data))})
		log.Printf("[botUploadImages] guild=%s user=%s(%s) -> %s (%d bytes)", guildID, discordUsername, discordUserID, key, len(data))

		// Best-effort history record: the file is already stored, so a DB
		// failure must not fail the upload itself.
		if _, err := s.db.Exec(c.Context(), `INSERT INTO bot_uploads
			(guild_id, discord_user_id, discord_username, object_key, url, filename, size_bytes, content_type)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			guildID, discordUserID, discordUsername, key, url, fh.Filename, int64(len(data)), contentType,
		); err != nil {
			log.Printf("[botUploadImages] DB insert error (history skipped): %v", err)
		}
	}

	return c.JSON(fiber.Map{"items": items})
}

type botUploadHistoryItem struct {
	URL         string `json:"url"`
	Filename    string `json:"filename"`
	Size        int64  `json:"size"`
	ContentType string `json:"content_type"`
	CreatedAt   string `json:"created_at"`
}

// botUploadHistory handles GET /api/internal/bot/uploads.
//
// Query params: discord_user_id (required), guild_id (optional, "" = all guilds),
// limit (optional, default 10, max 25). Returns the user's uploads, newest first:
//
//	{ "items": [{ "url": "...", "filename": "...", "size": 123,
//	              "content_type": "image/jpeg", "created_at": "2026-10-03T..." }] }
func (s *server) botUploadHistory(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	discordUserID := strings.TrimSpace(c.Query("discord_user_id"))
	if discordUserID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ต้องระบุ discord_user_id", Code: "missing_user"})
	}
	guildID := strings.TrimSpace(c.Query("guild_id"))
	limit := 10
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			limit = n
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 25 {
		limit = 25
	}

	rows, err := s.db.Query(c.Context(), `SELECT url, filename, size_bytes, content_type, created_at
		FROM bot_uploads
		WHERE discord_user_id = $1 AND ($2 = '' OR guild_id = $2)
		ORDER BY created_at DESC
		LIMIT $3`, discordUserID, guildID, limit)
	if err != nil {
		log.Printf("[botUploadHistory] DB query error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ดึงประวัติไม่สำเร็จ", Code: "history_failed"})
	}
	defer rows.Close()

	items := make([]botUploadHistoryItem, 0, limit)
	for rows.Next() {
		var it botUploadHistoryItem
		var createdAt time.Time
		var size int64
		if err := rows.Scan(&it.URL, &it.Filename, &size, &it.ContentType, &createdAt); err != nil {
			log.Printf("[botUploadHistory] row scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ดึงประวัติไม่สำเร็จ", Code: "history_failed"})
		}
		it.Size = size
		it.CreatedAt = createdAt.Format(time.RFC3339)
		items = append(items, it)
	}
	return c.JSON(fiber.Map{"items": items})
}
