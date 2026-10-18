package main

import (
	"errors"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
)

// Admin view of Discord bot uploads.
//
// GET /api/admin/bot-uploads lists every file uploaded via the Discord
// /upload feature across all users and guilds (admin/superadmin only,
// enforced by the /api/admin group middleware).
// DELETE /api/admin/bot-uploads/:id removes one upload (MinIO object + DB
// row) regardless of owner — moderation use only. The per-user /gallery
// endpoints stay owner-scoped; this one is intentionally not.

const (
	adminBotUploadsDefaultLimit = 50
	adminBotUploadsMaxLimit     = 100
)

type adminBotUploadItem struct {
	ID            int64  `json:"id"`
	GuildID       string `json:"guild_id"`
	DiscordUserID string `json:"discord_user_id"`
	Username      string `json:"discord_username"`
	URL           string `json:"url"`
	Filename      string `json:"filename"`
	Size          int64  `json:"size"`
	ContentType   string `json:"content_type"`
	CreatedAt     string `json:"created_at"`
}

func (s *server) adminListBotUploads(c *fiber.Ctx) error {
	guildID := strings.TrimSpace(c.Query("guild_id"))
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > adminBotUploadsMaxLimit {
		limit = adminBotUploadsDefaultLimit
	}
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}

	args := []any{}
	conds := []string{}
	if guildID != "" {
		args = append(args, guildID)
		conds = append(conds, "guild_id = $"+strconv.Itoa(len(args)))
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		conds = append(conds, "(discord_username ILIKE $"+strconv.Itoa(len(args))+" OR filename ILIKE $"+strconv.Itoa(len(args))+")")
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	var total int64
	if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM bot_uploads `+where, args...).Scan(&total); err != nil {
		log.Printf("[admin bot-uploads] count error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ดึงข้อมูลไม่สำเร็จ", Code: "list_failed"})
	}

	args = append(args, limit, offset)
	rows, err := s.db.Query(c.Context(), `SELECT id, guild_id, discord_user_id, discord_username, url, filename,
		size_bytes, content_type,
		TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM bot_uploads `+where+`
		ORDER BY created_at DESC
		LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		log.Printf("[admin bot-uploads] list query error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ดึงข้อมูลไม่สำเร็จ", Code: "list_failed"})
	}
	defer rows.Close()

	items := make([]adminBotUploadItem, 0, limit)
	for rows.Next() {
		var it adminBotUploadItem
		if err := rows.Scan(&it.ID, &it.GuildID, &it.DiscordUserID, &it.Username, &it.URL, &it.Filename, &it.Size, &it.ContentType, &it.CreatedAt); err != nil {
			log.Printf("[admin bot-uploads] row scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ดึงข้อมูลไม่สำเร็จ", Code: "list_failed"})
		}
		items = append(items, it)
	}
	return c.JSON(fiber.Map{"items": items, "total": total, "limit": limit, "offset": offset})
}

func (s *server) adminDeleteBotUpload(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Params("id")), 10, 64)
	if err != nil || id <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสรูปไม่ถูกต้อง", Code: "invalid_id"})
	}

	var objectKey, filename, username, guildID string
	err = s.db.QueryRow(c.Context(), `SELECT object_key, filename, discord_username, guild_id
		FROM bot_uploads WHERE id = $1`, id).Scan(&objectKey, &filename, &username, &guildID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบรูปนี้", Code: "not_found"})
	}
	if err != nil {
		log.Printf("[admin bot-uploads] delete lookup error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ลบไม่สำเร็จ", Code: "delete_failed"})
	}

	// Delete the object first: if this fails the DB row is kept so the
	// file stays reachable (not silently orphaned) and the delete can retry.
	if s.storage != nil {
		if err := s.storage.RemoveObject(c.Context(), s.cfg.s3Bucket, objectKey, minio.RemoveObjectOptions{}); err != nil {
			log.Printf("[admin bot-uploads] MinIO RemoveObject error key=%s: %v", objectKey, err)
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ลบไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง", Code: "delete_failed"})
		}
	}
	if _, err := s.db.Exec(c.Context(), `DELETE FROM bot_uploads WHERE id = $1`, id); err != nil {
		log.Printf("[admin bot-uploads] delete row error id=%d: %v", id, err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ลบไม่สำเร็จ", Code: "delete_failed"})
	}
	log.Printf("[admin bot-uploads] deleted id=%d key=%s file=%s user=%s guild=%s", id, objectKey, filename, username, guildID)
	return c.JSON(fiber.Map{"ok": true})
}
