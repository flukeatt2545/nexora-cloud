package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Bot tokens set from the admin web page instead of .env (a token in .env still wins).
// The page can replace or remove a token but never read it back.

var discordTokenFormat = regexp.MustCompile(`^[A-Za-z0-9_-]{20,40}\.[A-Za-z0-9_-]{4,10}\.[A-Za-z0-9_-]{20,60}$`)

// The permissions each bot asks for in its invite link.
var webTokenBots = map[string]string{
	// View, send, manage messages (it deletes !code/!db messages), embed links, attach files, read history.
	"nexora": "125952",
	// View, send, embed links, attach files, read history.
	"mail": "117760",
	// Manage channels and permissions, view audit log (who deleted a channel), manage server
	// (AutoMod rules), manage messages and timeout members (stopping floods), view, send, embed
	// links, attach files (pictures set on the web page), read history (panels posted earlier),
	// connect, move members.
	"voice": "1099798015152",
}

type discordBotStatus struct {
	State      string     `json:"state"`
	Source     string     `json:"source"`
	BotTag     string     `json:"botTag"`
	GuildCount int        `json:"guildCount"`
	ReportedAt *time.Time `json:"reportedAt"`
	Online     bool       `json:"online"`
}

type discordBotConnection struct {
	BotKey        string           `json:"botKey"`
	Configured    bool             `json:"configured"`
	Hint          string           `json:"hint"`
	ApplicationID string           `json:"applicationId"`
	BotUsername   string           `json:"botUsername"`
	BotAvatarURL  string           `json:"botAvatarUrl"`
	UpdatedAt     *time.Time       `json:"updatedAt"`
	InviteURL     string           `json:"inviteUrl"`
	Status        discordBotStatus `json:"status"`
}

func webTokenBotKey(c *fiber.Ctx) (string, error) {
	key, _, ok := parseDiscordBotKey(c.Params("botKey"))
	if _, allowed := webTokenBots[key]; !ok || !allowed {
		return "", fiber.NewError(fiber.StatusNotFound, "บอทนี้ยังตั้ง token จากหน้าเว็บไม่ได้")
	}
	return key, nil
}

func (s *server) loadDiscordBotConnection(ctx context.Context, key string) (discordBotConnection, error) {
	connection := discordBotConnection{BotKey: key}
	var updatedAt time.Time
	var avatar string
	err := s.db.QueryRow(ctx, `
		SELECT token_hint, application_id, bot_username, bot_avatar, updated_at FROM discord_bot_tokens WHERE bot_key=$1
	`, key).Scan(&connection.Hint, &connection.ApplicationID, &connection.BotUsername, &avatar, &updatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return connection, err
	}
	if err == nil {
		connection.Configured = true
		connection.UpdatedAt = &updatedAt
		if avatar != "" && connection.ApplicationID != "" {
			connection.BotAvatarURL = "https://cdn.discordapp.com/avatars/" + connection.ApplicationID + "/" + avatar + ".png?size=96"
		}
		if connection.ApplicationID != "" {
			connection.InviteURL = "https://discord.com/oauth2/authorize?client_id=" + connection.ApplicationID +
				"&scope=bot%20applications.commands&permissions=" + webTokenBots[key]
		}
	}
	var reportedAt time.Time
	err = s.db.QueryRow(ctx, `
		SELECT state, source, bot_tag, guild_count, reported_at FROM discord_bot_status WHERE bot_key=$1
	`, key).Scan(&connection.Status.State, &connection.Status.Source, &connection.Status.BotTag, &connection.Status.GuildCount, &reportedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return connection, err
	}
	if err == nil {
		connection.Status.ReportedAt = &reportedAt
		// The bot reports every 30 seconds; give it a little slack before calling it offline.
		connection.Status.Online = connection.Status.State == "online" && time.Since(reportedAt) < 90*time.Second
	}
	return connection, nil
}

// discordBotIdentity asks Discord who the token belongs to, so a mistyped token is caught here
// instead of the bot failing to log in later.
func discordBotIdentity(ctx context.Context, token string) (id, username, avatar string, status int, err error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://discord.com/api/v10/users/@me", nil)
	if err != nil {
		return "", "", "", 0, err
	}
	request.Header.Set("Authorization", "Bot "+token)
	request.Header.Set("User-Agent", "DiscordBot (https://nkn02.com, 1.0)")
	response, err := (&http.Client{Timeout: 8 * time.Second}).Do(request)
	if err != nil {
		return "", "", "", 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", "", "", response.StatusCode, nil
	}
	var me struct {
		ID       string  `json:"id"`
		Username string  `json:"username"`
		Avatar   *string `json:"avatar"`
		Bot      bool    `json:"bot"`
	}
	if err := json.NewDecoder(response.Body).Decode(&me); err != nil {
		return "", "", "", 0, err
	}
	if !me.Bot {
		return "", "", "", http.StatusForbidden, nil
	}
	if me.Avatar != nil {
		avatar = *me.Avatar
	}
	return me.ID, me.Username, avatar, http.StatusOK, nil
}

func (s *server) getAdminDiscordBotConnection(c *fiber.Ctx) error {
	key, err := webTokenBotKey(c)
	if err != nil {
		return err
	}
	connection, err := s.loadDiscordBotConnection(c.Context(), key)
	if err != nil {
		return err
	}
	return c.JSON(connection)
}

func (s *server) updateAdminDiscordBotToken(c *fiber.Ctx) error {
	key, err := webTokenBotKey(c)
	if err != nil {
		return err
	}
	var input struct {
		Token string `json:"token"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	token := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(input.Token), "Bot "))
	if !discordTokenFormat.MatchString(token) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปแบบ token ไม่ถูกต้อง คัดลอกจากหน้า Bot ใน Discord Developer Portal มาทั้งหมด", Code: "invalid_token_format"})
	}
	id, username, avatar, status, err := discordBotIdentity(c.Context(), token)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(apiError{Error: "ติดต่อ Discord ไม่ได้ ลองใหม่อีกครั้ง", Code: "discord_unreachable"})
	}
	if status == http.StatusUnauthorized {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Discord ไม่รับ token นี้ อาจหมดอายุหรือถูก Reset ไปแล้ว", Code: "invalid_token"})
	}
	if status != http.StatusOK {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตรวจ token กับ Discord ไม่ผ่าน", Code: "token_check_failed"})
	}
	ciphertext, err := encryptSecret(token, s.cfg.webhookKey)
	if err != nil {
		return err
	}
	actor := current(c)
	if _, err := s.db.Exec(c.Context(), `
		INSERT INTO discord_bot_tokens (bot_key, token_ciphertext, token_hint, application_id, bot_username, bot_avatar, version, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (bot_key) DO UPDATE
		SET token_ciphertext=EXCLUDED.token_ciphertext, token_hint=EXCLUDED.token_hint, application_id=EXCLUDED.application_id,
		    bot_username=EXCLUDED.bot_username, bot_avatar=EXCLUDED.bot_avatar, version=EXCLUDED.version,
		    updated_by=EXCLUDED.updated_by, updated_at=NOW()
	`, key, ciphertext, token[len(token)-4:], id, cleanText(username, 64), avatar, time.Now().UnixMilli(), actor.ID); err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "discord", Action: "discord.bot_token.updated", Target: "discord_bot", TargetID: key,
		Metadata: map[string]any{"botKey": key, "botUsername": username, "applicationId": id}})
	connection, err := s.loadDiscordBotConnection(c.Context(), key)
	if err != nil {
		return err
	}
	return c.JSON(connection)
}

func (s *server) deleteAdminDiscordBotToken(c *fiber.Ctx) error {
	key, err := webTokenBotKey(c)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(c.Context(), `DELETE FROM discord_bot_tokens WHERE bot_key=$1`, key); err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "discord", Action: "discord.bot_token.removed", Target: "discord_bot", TargetID: key,
		Metadata: map[string]any{"botKey": key}})
	connection, err := s.loadDiscordBotConnection(c.Context(), key)
	if err != nil {
		return err
	}
	return c.JSON(connection)
}

// botDiscordToken hands the bot its token. version lets it notice a new token and log in again.
func (s *server) botDiscordToken(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	key, err := webTokenBotKey(c)
	if err != nil {
		return err
	}
	var ciphertext string
	var version int64
	err = s.db.QueryRow(c.Context(), `SELECT token_ciphertext, version FROM discord_bot_tokens WHERE bot_key=$1`, key).Scan(&ciphertext, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(fiber.Map{"token": "", "version": 0})
	}
	if err != nil {
		return err
	}
	token, err := decryptSecret(ciphertext, s.cfg.webhookKey)
	if err != nil {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ถอดรหัส token ไม่ได้ ใส่ token ใหม่ในหน้าเว็บ", Code: "token_unreadable"})
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{"token": token, "version": version})
}

func (s *server) botDiscordStatus(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	key, _, ok := parseDiscordBotKey(c.Params("botKey"))
	if !ok {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบบอทนี้")
	}
	var input struct {
		State      string `json:"state"`
		Source     string `json:"source"`
		BotTag     string `json:"botTag"`
		GuildCount int    `json:"guildCount"`
	}
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	switch input.State {
	case "online", "invalid_token", "no_token", "error":
	default:
		return fiber.NewError(fiber.StatusBadRequest, "สถานะไม่ถูกต้อง")
	}
	if input.Source != "env" && input.Source != "web" {
		input.Source = ""
	}
	if input.GuildCount < 0 || input.GuildCount > 100000 {
		input.GuildCount = 0
	}
	_, err := s.db.Exec(c.Context(), `
		INSERT INTO discord_bot_status (bot_key, state, source, bot_tag, guild_count, reported_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (bot_key) DO UPDATE
		SET state=EXCLUDED.state, source=EXCLUDED.source, bot_tag=EXCLUDED.bot_tag, guild_count=EXCLUDED.guild_count, reported_at=NOW()
	`, key, input.State, input.Source, cleanText(input.BotTag, 64), input.GuildCount)
	if err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}
