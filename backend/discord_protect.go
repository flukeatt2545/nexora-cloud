package main

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

// Server protection, run by the voice bot in every server it is in: deleted channels come back,
// and links, invites, spam, mass mentions, blocked words and message floods are stopped. Rules are
// set on the admin Discord bot page; what the bot stops is logged here for admins only.

type discordProtectSettings struct {
	ProtectChannels     bool      `json:"protectChannels"`
	BlockLinks          bool      `json:"blockLinks"`
	AllowedDomains      []string  `json:"allowedDomains"`
	BlockInvites        bool      `json:"blockInvites"`
	BlockSpam           bool      `json:"blockSpam"`
	MentionLimit        int       `json:"mentionLimit"`
	BlockedWords        []string  `json:"blockedWords"`
	FloodEnabled        bool      `json:"floodEnabled"`
	FloodMessages       int       `json:"floodMessages"`
	FloodSeconds        int       `json:"floodSeconds"`
	FloodTimeoutMinutes int       `json:"floodTimeoutMinutes"`
	Version             int64     `json:"version"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type discordProtectGuild struct {
	GuildID        string    `json:"guildId"`
	GuildName      string    `json:"guildName"`
	AppliedVersion int64     `json:"appliedVersion"`
	Problems       []string  `json:"problems"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func splitLines(raw string) []string {
	out := []string{}
	for _, line := range strings.Split(raw, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out
}

func (s *server) loadDiscordProtect(ctx context.Context) (discordProtectSettings, error) {
	var p discordProtectSettings
	var domains, words string
	err := s.db.QueryRow(ctx, `
		SELECT protect_channels, block_links, allowed_domains, block_invites, block_spam, mention_limit, blocked_words,
		       flood_enabled, flood_messages, flood_seconds, flood_timeout_minutes, version, updated_at
		FROM discord_protect_settings WHERE singleton=TRUE
	`).Scan(&p.ProtectChannels, &p.BlockLinks, &domains, &p.BlockInvites, &p.BlockSpam, &p.MentionLimit, &words,
		&p.FloodEnabled, &p.FloodMessages, &p.FloodSeconds, &p.FloodTimeoutMinutes, &p.Version, &p.UpdatedAt)
	p.AllowedDomains, p.BlockedWords = splitLines(domains), splitLines(words)
	return p, err
}

// Bot side

func (s *server) botDiscordProtectSettings(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	settings, err := s.loadDiscordProtect(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(settings)
}

// botDiscordProtectStatus: what the bot could apply in one server, and what it is missing.
func (s *server) botDiscordProtectStatus(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		GuildID   string   `json:"guildId"`
		GuildName string   `json:"guildName"`
		Version   int64    `json:"version"`
		Problems  []string `json:"problems"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.GuildID) || len(input.Problems) > 20 {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	problems := make([]string, 0, len(input.Problems))
	for _, p := range input.Problems {
		if p = cleanText(p, 200); p != "" {
			problems = append(problems, p)
		}
	}
	if _, err := s.db.Exec(c.Context(), `
		INSERT INTO discord_protect_guilds (guild_id, guild_name, applied_version, problems, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (guild_id) DO UPDATE
		SET guild_name=EXCLUDED.guild_name, applied_version=EXCLUDED.applied_version, problems=EXCLUDED.problems, updated_at=NOW()
	`, input.GuildID, cleanText(input.GuildName, 100), input.Version, strings.Join(problems, "\n")); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botDiscordProtectEvent logs something the protection stopped. Only admins see it (logs page).
func (s *server) botDiscordProtectEvent(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		Kind        string `json:"kind"`
		GuildID     string `json:"guildId"`
		GuildName   string `json:"guildName"`
		UserID      string `json:"userId"`
		UserName    string `json:"userName"`
		ChannelID   string `json:"channelId"`
		ChannelName string `json:"channelName"`
		Detail      string `json:"detail"`
		Count       int    `json:"count"`
		Restored    bool   `json:"restored"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.GuildID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	var action string
	switch input.Kind {
	case "link":
		action = "discord.protect.link_blocked"
	case "invite":
		action = "discord.protect.invite_blocked"
	case "word":
		action = "discord.protect.word_blocked"
	case "spam":
		action = "discord.protect.spam_blocked"
	case "mention":
		action = "discord.protect.mention_blocked"
	case "flood":
		action = "discord.protect.flood_timeout"
	case "channel":
		action = "discord.protect.channel_restored"
	default:
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	meta := map[string]any{"guildName": cleanText(input.GuildName, 100), "name": cleanText(input.ChannelName, 100)}
	if validDiscordSnowflake(input.UserID) {
		meta["userId"] = input.UserID
		meta["userName"] = cleanText(input.UserName, 64)
	}
	if detail := cleanText(input.Detail, 120); detail != "" {
		meta["detail"] = detail
	}
	if input.Count > 1 {
		meta["times"] = input.Count
	}
	if input.Kind == "channel" {
		meta["restored"] = input.Restored
	}
	target := input.ChannelID
	if !validDiscordSnowflake(target) {
		target = input.GuildID
	}
	s.audit(c, auditEvent{Category: "security", Action: action, Target: "discord_channel", TargetID: target, Outcome: "denied", Metadata: meta})
	return c.SendStatus(fiber.StatusNoContent)
}

// Web admin (superadmin)

func (s *server) adminDiscordProtect(c *fiber.Ctx) error {
	settings, err := s.loadDiscordProtect(c.Context())
	if err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `SELECT guild_id, guild_name, applied_version, problems, updated_at FROM discord_protect_guilds ORDER BY guild_name`)
	if err != nil {
		return err
	}
	defer rows.Close()
	guilds := []discordProtectGuild{}
	for rows.Next() {
		var g discordProtectGuild
		var problems string
		if err := rows.Scan(&g.GuildID, &g.GuildName, &g.AppliedVersion, &problems, &g.UpdatedAt); err != nil {
			return err
		}
		g.Problems = splitLines(problems)
		guilds = append(guilds, g)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"settings": settings, "guilds": guilds})
}

func cleanDomain(raw string) string {
	d := strings.ToLower(strings.TrimSpace(raw))
	d = strings.TrimPrefix(strings.TrimPrefix(d, "https://"), "http://")
	d = strings.TrimPrefix(d, "www.")
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	return d
}

func (s *server) updateAdminDiscordProtect(c *fiber.Ctx) error {
	var input discordProtectSettings
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	domains := []string{}
	seen := map[string]bool{}
	for _, raw := range input.AllowedDomains {
		d := cleanDomain(raw)
		if d == "" || seen[d] {
			continue
		}
		if len(d) > 60 || strings.ContainsAny(d, " *\t") || !strings.Contains(d, ".") {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อเว็บไม่ถูกต้อง: " + cleanText(raw, 60), Code: "invalid_domain"})
		}
		seen[d] = true
		domains = append(domains, d)
	}
	words := []string{}
	seenWord := map[string]bool{}
	for _, raw := range input.BlockedWords {
		w := strings.TrimSpace(raw)
		if w == "" || seenWord[strings.ToLower(w)] {
			continue
		}
		if utf8.RuneCountInString(w) > 60 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำต้องห้ามยาวได้ไม่เกิน 60 ตัว: " + cleanText(w, 60), Code: "invalid_word"})
		}
		seenWord[strings.ToLower(w)] = true
		words = append(words, w)
	}
	switch {
	case len(domains) > 90:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เว็บที่อนุญาตใส่ได้ไม่เกิน 90 เว็บ", Code: "too_many_domains"})
	case len(words) > 900:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำต้องห้ามใส่ได้ไม่เกิน 900 คำ", Code: "too_many_words"})
	case input.MentionLimit < 0 || input.MentionLimit > 50:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "จำนวนแท็กต้องอยู่ระหว่าง 0–50", Code: "invalid_mentions"})
	case input.FloodMessages < 3 || input.FloodMessages > 30:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "จำนวนข้อความต้องอยู่ระหว่าง 3–30", Code: "invalid_flood_messages"})
	case input.FloodSeconds < 2 || input.FloodSeconds > 60:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ช่วงเวลาต้องอยู่ระหว่าง 2–60 วินาที", Code: "invalid_flood_seconds"})
	case input.FloodTimeoutMinutes < 1 || input.FloodTimeoutMinutes > 1440:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เวลาพักต้องอยู่ระหว่าง 1–1440 นาที", Code: "invalid_timeout"})
	}
	actor := current(c)
	if _, err := s.db.Exec(c.Context(), `
		UPDATE discord_protect_settings SET protect_channels=$1, block_links=$2, allowed_domains=$3, block_invites=$4, block_spam=$5,
		       mention_limit=$6, blocked_words=$7, flood_enabled=$8, flood_messages=$9, flood_seconds=$10, flood_timeout_minutes=$11,
		       version=$12, updated_by=$13, updated_at=NOW()
		WHERE singleton=TRUE
	`, input.ProtectChannels, input.BlockLinks, strings.Join(domains, "\n"), input.BlockInvites, input.BlockSpam, input.MentionLimit,
		strings.Join(words, "\n"), input.FloodEnabled, input.FloodMessages, input.FloodSeconds, input.FloodTimeoutMinutes,
		time.Now().UnixMilli(), actor.ID); err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "discord", Action: "discord.protect.settings_updated", Target: "discord_protect_settings",
		Metadata: map[string]any{"protectChannels": input.ProtectChannels, "blockLinks": input.BlockLinks, "allowedDomains": len(domains),
			"blockInvites": input.BlockInvites, "blockSpam": input.BlockSpam, "mentionLimit": input.MentionLimit, "blockedWords": len(words),
			"floodEnabled": input.FloodEnabled}})
	return s.adminDiscordProtect(c)
}
