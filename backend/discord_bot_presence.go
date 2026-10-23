package main

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

func parseDiscordBotKey(raw string) (string, string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "mail":
		return "mail", "เมลของคุณ", true
	case "nexora", "main", "student":
		return "nexora", "NEXORA", true
	case "voice":
		return "voice", "ห้องเสียง", true
	case "community":
		return "community", "เซิร์ฟเวอร์", true
	default:
		return "", "", false
	}
}

func normalizeMailDiscordActivity(activityType, activityText string) (string, string, error) {
	switch strings.ToLower(strings.TrimSpace(activityType)) {
	case "playing", "watching", "listening", "competing", "custom":
		activityType = strings.ToLower(strings.TrimSpace(activityType))
	default:
		return "", "", errors.New("invalid_activity_type")
	}
	var builder strings.Builder
	for _, r := range strings.TrimSpace(activityText) {
		if r == '\n' || r == '\r' || r == '\t' {
			builder.WriteRune(' ')
			continue
		}
		if r < 32 || r == 127 {
			continue
		}
		builder.WriteRune(r)
	}
	text := strings.Join(strings.Fields(builder.String()), " ")
	if text == "" {
		return "", "", errors.New("invalid_activity_text")
	}
	if utf8.RuneCountInString(text) > 128 {
		return "", "", errors.New("activity_text_too_long")
	}
	return activityType, text, nil
}

func mailDiscordActivityPreview(activityType, activityText string) string {
	switch activityType {
	case "playing":
		return "กำลังเล่น " + activityText
	case "listening":
		return "กำลังฟัง " + activityText
	case "competing":
		return "กำลังแข่ง " + activityText
	case "custom":
		return activityText
	default:
		return "กำลังดู " + activityText
	}
}

func mailDiscordActivityPayload(botKey, activityType, activityText string) fiber.Map {
	return fiber.Map{
		"botKey":       botKey,
		"activityType": activityType,
		"activityText": activityText,
		"preview":      mailDiscordActivityPreview(activityType, activityText),
	}
}

func (s *server) loadDiscordBotPresence(ctx context.Context, botKey string) (string, string, error) {
	key, fallbackText, ok := parseDiscordBotKey(botKey)
	if !ok {
		return "", "", errors.New("unknown_bot")
	}
	var activityType, activityText string
	err := s.db.QueryRow(ctx, `
		SELECT activity_type, activity_text FROM discord_bot_presence_settings WHERE bot_key=$1
	`, key).Scan(&activityType, &activityText)
	if errors.Is(err, pgx.ErrNoRows) && key == "mail" {
		err = s.db.QueryRow(ctx, `
			SELECT activity_type, activity_text FROM mail_discord_bot_settings WHERE singleton=TRUE
		`).Scan(&activityType, &activityText)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return "watching", fallbackText, nil
	}
	if err != nil {
		return "", "", err
	}
	activityType, activityText, err = normalizeMailDiscordActivity(activityType, activityText)
	if err != nil {
		return "watching", fallbackText, nil
	}
	return activityType, activityText, nil
}

func (s *server) respondDiscordBotPresence(c *fiber.Ctx, botKey string) error {
	key, _, ok := parseDiscordBotKey(botKey)
	if !ok {
		return c.Status(404).JSON(apiError{Error: "ไม่พบบอทนี้", Code: "unknown_bot"})
	}
	activityType, activityText, err := s.loadDiscordBotPresence(c.Context(), key)
	if err != nil {
		return err
	}
	return c.JSON(mailDiscordActivityPayload(key, activityType, activityText))
}

func (s *server) saveDiscordBotPresence(c *fiber.Ctx, botKey string) error {
	actor := current(c)
	key, _, ok := parseDiscordBotKey(botKey)
	if !ok {
		return c.Status(404).JSON(apiError{Error: "ไม่พบบอทนี้", Code: "unknown_bot"})
	}
	var input struct {
		ActivityType string `json:"activityType"`
		ActivityText string `json:"activityText"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	activityType, activityText, err := normalizeMailDiscordActivity(input.ActivityType, input.ActivityText)
	if err != nil {
		return c.Status(400).JSON(apiError{Error: "เลือกประเภทและข้อความสถานะให้ถูกต้อง", Code: err.Error()})
	}
	_, err = s.db.Exec(c.Context(), `
		INSERT INTO discord_bot_presence_settings (bot_key, activity_type, activity_text, updated_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (bot_key) DO UPDATE
		SET activity_type=EXCLUDED.activity_type,
		    activity_text=EXCLUDED.activity_text,
		    updated_by=EXCLUDED.updated_by,
		    updated_at=NOW()
	`, key, activityType, activityText, actor.ID)
	if err != nil {
		return err
	}
	if key == "mail" {
		_, _ = s.db.Exec(c.Context(), `
			INSERT INTO mail_discord_bot_settings (singleton, activity_type, activity_text, updated_by)
			VALUES (TRUE, $1, $2, $3)
			ON CONFLICT (singleton) DO UPDATE
			SET activity_type=EXCLUDED.activity_type,
			    activity_text=EXCLUDED.activity_text,
			    updated_by=EXCLUDED.updated_by,
			    updated_at=NOW()
		`, activityType, activityText, actor.ID)
	}
	s.audit(c, auditEvent{
		Actor:    actor,
		Category: "discord",
		Action:   "discord.presence.updated",
		Target:   "discord_bot",
		TargetID: key,
		Metadata: map[string]any{"botKey": key, "activityType": activityType, "activityText": activityText},
	})
	return c.JSON(mailDiscordActivityPayload(key, activityType, activityText))
}

func (s *server) getAdminDiscordBotPresence(c *fiber.Ctx) error {
	return s.respondDiscordBotPresence(c, c.Params("botKey"))
}

func (s *server) updateAdminDiscordBotPresence(c *fiber.Ctx) error {
	return s.saveDiscordBotPresence(c, c.Params("botKey"))
}

func (s *server) botDiscordPresence(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	return s.respondDiscordBotPresence(c, c.Params("botKey"))
}
