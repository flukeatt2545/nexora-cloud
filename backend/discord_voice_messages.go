package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// The messages the voice bot posts and keeps up to date: the button panel and the log channel
// welcome. A superadmin sets their title, text and picture on the Discord bot page; the bot
// edits every posted copy within a few seconds.

const voiceMessageImageLimit = 4 * 1024 * 1024

var voiceMessageImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true}

// What a message says until it is changed on the web page.
var voiceMessageDefaults = map[string]voiceMessage{
	"panel":    {Key: "panel", Title: "ห้องเสียง", Body: "สร้างห้องของตัวเองแล้วตั้งรหัสได้ หรือใส่รหัสเข้าห้องเพื่อน\nห้องไหนไม่มีใครอยู่ เดี๋ยวหายไปเอง"},
	"log":      {Key: "log", Title: "ห้อง log ห้องเสียง", Body: "มีห้องใหม่หรือห้องถูกลบ บอทจะมาบอกที่นี่"},
	"voicelog": {Key: "voicelog", Title: "ประวัติเข้าออกห้องเสียง", Body: "ใครออกจากห้องเสียง บอทจะมาบอกที่นี่ว่าอยู่ห้องไหน นานแค่ไหน"},
}

// Which posted message each kind of place carries.
var voiceMessageKinds = map[string]bool{"panel": true, "log": true, "voicelog": true}

type voiceMessage struct {
	Key       string     `json:"key"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	HasImage  bool       `json:"hasImage"`
	ImageType string     `json:"imageType"`
	Version   int64      `json:"version"`
	UpdatedAt *time.Time `json:"updatedAt"`
	// Web page only: how many posted copies there are, and how many still show an older version.
	Posted  int `json:"posted"`
	Pending int `json:"pending"`
}

func (s *server) loadVoiceMessages(ctx context.Context) (map[string]voiceMessage, error) {
	messages := map[string]voiceMessage{}
	for key, value := range voiceMessageDefaults {
		messages[key] = value
	}
	rows, err := s.db.Query(ctx, `SELECT key, title, body, image IS NOT NULL, image_type, version, updated_at FROM voice_bot_messages`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m voiceMessage
		var updated time.Time
		if err := rows.Scan(&m.Key, &m.Title, &m.Body, &m.HasImage, &m.ImageType, &m.Version, &updated); err != nil {
			return nil, err
		}
		m.UpdatedAt = &updated
		messages[m.Key] = m
	}
	return messages, rows.Err()
}

func (s *server) voiceMessageImage(c *fiber.Ctx) error {
	key := c.Params("key")
	if _, ok := voiceMessageDefaults[key]; !ok {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบข้อความนี้")
	}
	var image []byte
	var imageType string
	err := s.db.QueryRow(c.Context(), `SELECT image, image_type FROM voice_bot_messages WHERE key=$1 AND image IS NOT NULL`, key).Scan(&image, &imageType)
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่มีรูป")
	}
	if err != nil {
		return err
	}
	c.Set(fiber.HeaderContentType, imageType)
	c.Set(fiber.HeaderCacheControl, "private, no-store")
	c.Set("X-Content-Type-Options", "nosniff")
	return c.Send(image)
}

// Bot side

func (s *server) botVoiceMessages(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	messages, err := s.loadVoiceMessages(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"messages": messages})
}

func (s *server) botVoiceMessageImage(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	return s.voiceMessageImage(c)
}

// botVoiceMessageApplied records which version a posted message now shows. An empty messageId
// means the message is gone (deleted in Discord), so there is nothing left to update.
func (s *server) botVoiceMessageApplied(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		Kind      string `json:"kind"`
		ChannelID string `json:"channelId"`
		MessageID string `json:"messageId"`
		Version   int64  `json:"version"`
	}
	if c.BodyParser(&input) != nil || !voiceMessageKinds[input.Kind] || !validDiscordSnowflake(input.ChannelID) ||
		(input.MessageID != "" && !validDiscordSnowflake(input.MessageID)) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	if _, err := s.db.Exec(c.Context(), `
		UPDATE voice_bot_places SET message_id=$3, message_version=$4, checked_at=NOW() WHERE kind=$1 AND channel_id=$2
	`, input.Kind, input.ChannelID, input.MessageID, input.Version); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// Web admin (superadmin)

func (s *server) adminVoiceMessages(c *fiber.Ctx) error {
	messages, err := s.loadVoiceMessages(c.Context())
	if err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `SELECT kind, message_version FROM voice_bot_places WHERE kind IN ('panel', 'log', 'voicelog') AND message_id<>''`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var kind string
		var version int64
		if err := rows.Scan(&kind, &version); err != nil {
			return err
		}
		m := messages[kind]
		m.Posted++
		if version < m.Version {
			m.Pending++
		}
		messages[kind] = m
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"messages": messages, "defaults": voiceMessageDefaults})
}

func (s *server) adminVoiceMessageImage(c *fiber.Ctx) error {
	return s.voiceMessageImage(c)
}

// updateAdminVoiceMessage saves a message's title, text and picture (multipart form: title, body,
// image file, removeImage=1). Leaving the picture out keeps the one already saved.
func (s *server) updateAdminVoiceMessage(c *fiber.Ctx) error {
	key := c.Params("key")
	if _, ok := voiceMessageDefaults[key]; !ok {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบข้อความนี้", Code: "not_found"})
	}
	title := strings.TrimSpace(c.FormValue("title"))
	body := strings.TrimSpace(strings.ReplaceAll(c.FormValue("body"), "\r\n", "\n"))
	switch {
	case utf8.RuneCountInString(title) > 256:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "หัวข้อยาวได้ไม่เกิน 256 ตัว", Code: "invalid_title"})
	case utf8.RuneCountInString(body) > 2000:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อความยาวได้ไม่เกิน 2000 ตัว", Code: "invalid_body"})
	}

	var image []byte
	imageType := ""
	keepImage := c.FormValue("removeImage") != "1"
	if header, err := c.FormFile("image"); err == nil {
		if header.Size <= 0 || header.Size > voiceMessageImageLimit {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปต้องไม่เกิน 4MB", Code: "image_too_large"})
		}
		file, err := header.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "อ่านรูปไม่ได้", Code: "image_unreadable"})
		}
		data, err := io.ReadAll(io.LimitReader(file, voiceMessageImageLimit+1))
		file.Close()
		if err != nil || len(data) > voiceMessageImageLimit {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปต้องไม่เกิน 4MB", Code: "image_too_large"})
		}
		imageType = http.DetectContentType(data)
		if !voiceMessageImageTypes[imageType] {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ใช้รูป PNG, JPG, GIF หรือ WebP", Code: "image_type"})
		}
		image, keepImage = data, false
	}

	var hasImage bool
	if keepImage {
		_ = s.db.QueryRow(c.Context(), `SELECT image IS NOT NULL FROM voice_bot_messages WHERE key=$1`, key).Scan(&hasImage)
	} else {
		hasImage = image != nil
	}
	if title == "" && body == "" && !hasImage {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ใส่หัวข้อ ข้อความ หรือรูปอย่างน้อยหนึ่งอย่าง", Code: "empty"})
	}

	actor := current(c)
	version := time.Now().UnixMilli()
	if _, err := s.db.Exec(c.Context(), `
		INSERT INTO voice_bot_messages (key, title, body, image, image_type, version, updated_by, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (key) DO UPDATE
		SET title=EXCLUDED.title, body=EXCLUDED.body,
		    image=CASE WHEN $8 THEN voice_bot_messages.image ELSE EXCLUDED.image END,
		    image_type=CASE WHEN $8 THEN voice_bot_messages.image_type ELSE EXCLUDED.image_type END,
		    version=EXCLUDED.version, updated_by=EXCLUDED.updated_by, updated_at=NOW()
	`, key, title, body, image, imageType, version, actor.ID, keepImage); err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "discord", Action: "discord.voice.message_updated", Target: "voice_bot_message", TargetID: key,
		Metadata: map[string]any{"name": voiceMessageDefaults[key].Title, "hasImage": hasImage}})
	return s.adminVoiceMessages(c)
}
