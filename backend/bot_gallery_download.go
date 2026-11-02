package main

import (
	"archive/zip"
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/gofiber/fiber/v2"
	"github.com/minio/minio-go/v7"
)

const galleryZipTimeout = 10 * time.Minute

// galleryZipName gives every picture a safe, unique name inside the zip: no folders, and a second
// "cat.png" becomes "cat (2).png".
func galleryZipName(filename string, used map[string]bool) string {
	name := strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || unicode.IsControl(r) {
			return '_'
		}
		return r
	}, strings.TrimSpace(filename))
	name = strings.TrimLeft(name, ".")
	if name == "" {
		name = "image"
	}
	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	candidate := name
	for i := 2; used[strings.ToLower(candidate)]; i++ {
		candidate = fmt.Sprintf("%s (%d)%s", stem, i, ext)
	}
	used[strings.ToLower(candidate)] = true
	return candidate
}

// galleryDownload handles POST /api/gallery/download (session cookie required): the chosen pictures
// as one zip. Only the session owner's pictures are ever included, as in the rest of the gallery.
func (s *server) galleryDownload(c *fiber.Ctx) error {
	sess, ok := s.requireGallerySession(c)
	if !ok {
		return nil
	}
	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบเก็บไฟล์ยังไม่พร้อม", Code: "storage_unavailable"})
	}
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.IDs) == 0 || len(req.IDs) > galleryMaxListLimit {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เลือกรูปก่อน", Code: "invalid_ids"})
	}
	rows, err := s.db.Query(c.Context(), `SELECT object_key, filename FROM bot_uploads
		WHERE id = ANY($1) AND discord_user_id = $2 AND guild_id = $3
		ORDER BY created_at DESC`, req.IDs, sess.DiscordUserID, sess.GuildID)
	if err != nil {
		log.Printf("[gallery] download query error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "โหลดไม่สำเร็จ", Code: "download_failed"})
	}
	defer rows.Close()
	type picture struct{ key, filename string }
	pictures := []picture{}
	for rows.Next() {
		var p picture
		if err := rows.Scan(&p.key, &p.filename); err != nil {
			log.Printf("[gallery] download scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "โหลดไม่สำเร็จ", Code: "download_failed"})
		}
		pictures = append(pictures, p)
	}
	if len(pictures) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบรูปที่เลือก", Code: "not_found"})
	}

	c.Set(fiber.HeaderContentType, "application/zip")
	c.Set(fiber.HeaderContentDisposition, `attachment; filename="nexora-gallery.zip"`)
	c.Set(fiber.HeaderCacheControl, "no-store")
	bucket, storage, username := s.cfg.s3Bucket, s.storage, sess.Username
	// Sent as it is written, so the pictures are never all held in memory. The headers are gone by
	// then, so a picture that cannot be read is named in a note inside the zip rather than breaking it.
	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		ctx, cancel := context.WithTimeout(context.Background(), galleryZipTimeout)
		defer cancel()
		archive := zip.NewWriter(w)
		used := map[string]bool{}
		missing := []string{}
		for _, p := range pictures {
			name := galleryZipName(p.filename, used)
			object, err := storage.GetObject(ctx, bucket, p.key, minio.GetObjectOptions{})
			if err == nil {
				_, err = object.Stat()
			}
			if err != nil {
				log.Printf("[gallery] download object error key=%s: %v", p.key, err)
				missing = append(missing, name)
				continue
			}
			// Pictures are already compressed, so they are stored as they are.
			entry, err := archive.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store, Modified: time.Now().UTC()})
			if err == nil {
				_, err = io.Copy(entry, object)
			}
			object.Close()
			if err != nil {
				// The browser went away, or the stream broke partway; the zip cannot be finished.
				log.Printf("[gallery] download stopped user=%s: %v", username, err)
				return
			}
		}
		if len(missing) > 0 {
			if note, err := archive.Create(galleryZipName("โหลดไม่ได้.txt", used)); err == nil {
				_, _ = io.WriteString(note, strings.Join(missing, "\n")+"\n")
			}
		}
		_ = archive.Close()
		_ = w.Flush()
	})
	return nil
}
