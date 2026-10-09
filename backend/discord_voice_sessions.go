package main

import (
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Who was in which voice channel and for how long, in every server the voice bot is in. The bot
// reports joins, leaves and moves; the times are the site's, so they are consistent.

type voiceSession struct {
	ID          int64      `json:"id"`
	GuildID     string     `json:"guildId"`
	GuildName   string     `json:"guildName"`
	ChannelID   string     `json:"channelId"`
	ChannelName string     `json:"channelName"`
	DiscordID   string     `json:"discordId"`
	Username    string     `json:"username"`
	DisplayName string     `json:"displayName"`
	JoinedAt    time.Time  `json:"joinedAt"`
	LeftAt      *time.Time `json:"leftAt"`
	// For a session still going, how long so far.
	Seconds int64 `json:"seconds"`
}

const voiceSessionColumns = `id, guild_id, guild_name, channel_id, channel_name, discord_id, username, display_name, joined_at, left_at,
	COALESCE(seconds, GREATEST(0, EXTRACT(EPOCH FROM NOW() - joined_at))::bigint)`

func scanVoiceSessions(rows voiceEventRows) ([]voiceSession, error) {
	defer rows.Close()
	sessions := []voiceSession{}
	for rows.Next() {
		var v voiceSession
		if err := rows.Scan(&v.ID, &v.GuildID, &v.GuildName, &v.ChannelID, &v.ChannelName, &v.DiscordID, &v.Username, &v.DisplayName, &v.JoinedAt, &v.LeftAt, &v.Seconds); err != nil {
			return nil, err
		}
		sessions = append(sessions, v)
	}
	return sessions, rows.Err()
}

type voicePresence struct {
	DiscordID   string `json:"discordId"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	ChannelID   string `json:"channelId"`
	ChannelName string `json:"channelName"`
}

// Bot side

// botVoiceSessionMove: a member left a voice channel, joined one, or moved. Any open session of
// theirs in that server ends now; a new one starts when channelId is set.
func (s *server) botVoiceSessionMove(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		GuildID   string `json:"guildId"`
		GuildName string `json:"guildName"`
		voicePresence
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.GuildID) || !validDiscordSnowflake(input.DiscordID) ||
		(input.ChannelID != "" && !validDiscordSnowflake(input.ChannelID)) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())
	if _, err := tx.Exec(c.Context(), `SELECT pg_advisory_xact_lock(hashtext('voice_session:' || $1 || ':' || $2))`, input.GuildID, input.DiscordID); err != nil {
		return err
	}
	if _, err := tx.Exec(c.Context(), `
		UPDATE voice_sessions SET left_at=NOW(), seconds=GREATEST(0, EXTRACT(EPOCH FROM NOW() - joined_at))::bigint
		WHERE guild_id=$1 AND discord_id=$2 AND left_at IS NULL
	`, input.GuildID, input.DiscordID); err != nil {
		return err
	}
	if input.ChannelID != "" {
		if _, err := tx.Exec(c.Context(), `
			INSERT INTO voice_sessions (guild_id, guild_name, channel_id, channel_name, discord_id, username, display_name)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, input.GuildID, cleanText(input.GuildName, 100), input.ChannelID, cleanText(input.ChannelName, 100), input.DiscordID,
			cleanText(input.Username, 64), cleanText(input.DisplayName, 100)); err != nil {
			return err
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoiceSessionSync runs when the bot starts: who is in voice right now. Sessions it no longer
// sees ended while the bot was away; they end now and are not posted (the time is a guess).
// People already in a channel get a session from now on.
func (s *server) botVoiceSessionSync(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		GuildID   string          `json:"guildId"`
		GuildName string          `json:"guildName"`
		Present   []voicePresence `json:"present"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.GuildID) || len(input.Present) > 5000 {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	keys := make([]string, 0, len(input.Present))
	for _, p := range input.Present {
		if validDiscordSnowflake(p.DiscordID) && validDiscordSnowflake(p.ChannelID) {
			keys = append(keys, p.DiscordID+":"+p.ChannelID)
		}
	}
	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())
	if _, err := tx.Exec(c.Context(), `
		UPDATE voice_sessions SET left_at=NOW(), seconds=GREATEST(0, EXTRACT(EPOCH FROM NOW() - joined_at))::bigint, posted_at=NOW()
		WHERE guild_id=$1 AND left_at IS NULL AND NOT (discord_id || ':' || channel_id = ANY($2))
	`, input.GuildID, keys); err != nil {
		return err
	}
	for _, p := range input.Present {
		if !validDiscordSnowflake(p.DiscordID) || !validDiscordSnowflake(p.ChannelID) {
			continue
		}
		if _, err := tx.Exec(c.Context(), `
			INSERT INTO voice_sessions (guild_id, guild_name, channel_id, channel_name, discord_id, username, display_name)
			SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::varchar, $7::varchar
			WHERE NOT EXISTS (SELECT 1 FROM voice_sessions WHERE guild_id=$1 AND discord_id=$5 AND left_at IS NULL)
		`, input.GuildID, cleanText(input.GuildName, 100), p.ChannelID, cleanText(p.ChannelName, 100), p.DiscordID,
			cleanText(p.Username, 64), cleanText(p.DisplayName, 100)); err != nil {
			return err
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoiceSessionFeed returns ended sessions the join/leave log channel has not shown yet: only
// after that channel was set, and from the last 15 minutes.
func (s *server) botVoiceSessionFeed(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT `+voiceSessionColumns+`
		FROM voice_sessions v
		WHERE v.posted_at IS NULL AND v.left_at IS NOT NULL AND v.left_at > NOW() - INTERVAL '15 minutes'
		  AND EXISTS (SELECT 1 FROM voice_bot_places p WHERE p.kind='voicelog' AND p.guild_id=v.guild_id AND v.left_at >= p.created_at)
		ORDER BY v.id
		LIMIT 20
	`)
	if err != nil {
		return err
	}
	sessions, err := scanVoiceSessions(rows)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"sessions": sessions})
}

func (s *server) botVoiceSessionAck(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		IDs []int64 `json:"ids"`
	}
	if c.BodyParser(&input) != nil || len(input.IDs) > 100 {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	if len(input.IDs) > 0 {
		if _, err := s.db.Exec(c.Context(), `UPDATE voice_sessions SET posted_at=NOW() WHERE id = ANY($1)`, input.IDs); err != nil {
			return err
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoiceSessionHistory is /voice-history: one member's time in voice in this server.
func (s *server) botVoiceSessionHistory(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	guildID, discordID := strings.TrimSpace(c.Query("guildId")), strings.TrimSpace(c.Query("discordId"))
	if !validDiscordSnowflake(guildID) || !validDiscordSnowflake(discordID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT `+voiceSessionColumns+` FROM voice_sessions
		WHERE guild_id=$1 AND discord_id=$2 ORDER BY id DESC LIMIT 15
	`, guildID, discordID)
	if err != nil {
		return err
	}
	sessions, err := scanVoiceSessions(rows)
	if err != nil {
		return err
	}
	var week, month int64
	if err := s.db.QueryRow(c.Context(), `
		SELECT
		  COALESCE(SUM(COALESCE(seconds, EXTRACT(EPOCH FROM NOW() - joined_at)::bigint)) FILTER (WHERE joined_at > NOW() - INTERVAL '7 days'), 0),
		  COALESCE(SUM(COALESCE(seconds, EXTRACT(EPOCH FROM NOW() - joined_at)::bigint)) FILTER (WHERE joined_at > NOW() - INTERVAL '30 days'), 0)
		FROM voice_sessions WHERE guild_id=$1 AND discord_id=$2
	`, guildID, discordID).Scan(&week, &month); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"sessions": sessions, "weekSeconds": week, "monthSeconds": month})
}

// Web admin (superadmin)

// adminVoiceSessions lists sessions, newest first, optionally filtered by member, channel or
// server name; before is the last id of the previous page.
func (s *server) adminVoiceSessions(c *fiber.Ctx) error {
	q := strings.TrimSpace(c.Query("q"))
	if len([]rune(q)) > 100 {
		q = string([]rune(q)[:100])
	}
	before, _ := strconv.ParseInt(c.Query("before"), 10, 64)
	pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(q) + "%"
	const match = `($1='' OR username ILIKE $2 OR display_name ILIKE $2 OR channel_name ILIKE $2 OR guild_name ILIKE $2 OR discord_id=$1)`
	rows, err := s.db.Query(c.Context(), `
		SELECT `+voiceSessionColumns+` FROM voice_sessions
		WHERE `+match+` AND ($3=0 OR id < $3)
		ORDER BY id DESC LIMIT 51
	`, q, pattern, before)
	if err != nil {
		return err
	}
	sessions, err := scanVoiceSessions(rows)
	if err != nil {
		return err
	}
	hasMore := len(sessions) > 50
	if hasMore {
		sessions = sessions[:50]
	}
	var count, total int64
	var people int64
	if err := s.db.QueryRow(c.Context(), `
		SELECT COUNT(*), COALESCE(SUM(COALESCE(seconds, EXTRACT(EPOCH FROM NOW() - joined_at)::bigint)), 0), COUNT(DISTINCT discord_id)
		FROM voice_sessions WHERE `+match, q, pattern).Scan(&count, &total, &people); err != nil {
		return err
	}
	var guilds int64
	_ = s.db.QueryRow(c.Context(), `SELECT COUNT(DISTINCT guild_id) FROM voice_sessions`).Scan(&guilds)
	return c.JSON(fiber.Map{"sessions": sessions, "hasMore": hasMore, "count": count, "totalSeconds": total, "people": people, "guilds": guilds})
}
