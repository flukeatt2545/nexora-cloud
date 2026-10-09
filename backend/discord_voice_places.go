package main

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Channels the voice bot uses (Join to Create channels, button panels and the log channel), and
// the room events behind the log channel and /room history.

// Kinds the bot adds now. category rows were written by an earlier version; the bot removes them
// on its next check, so removing still accepts every kind.
var voicePlaceAddKinds = map[string]bool{"hub": true, "panel": true, "log": true, "voicelog": true}
var voicePlaceKinds = map[string]bool{"hub": true, "panel": true, "log": true, "category": true, "voicelog": true}

// One room log and one join/leave log per server: setting a new one replaces the old.
var voicePlaceSingle = map[string]bool{"log": true, "voicelog": true}

// Room events posted to the log channel: rooms made and deleted, nothing else. Passwords, locks,
// kicks and wrong passwords stay out of it; the owner sees them with /room history.
var voiceFeedActions = []string{"created", "deleted"}

// A channel the bot uses. For a panel or the log channel, MessageID is the message the bot posted
// there and MessageVersion the version of its text and image that message shows.
type voicePlace struct {
	Kind           string `json:"kind"`
	ChannelID      string `json:"channelId"`
	GuildID        string `json:"guildId"`
	MessageID      string `json:"messageId"`
	MessageVersion int64  `json:"messageVersion"`
}

type voiceEventRow struct {
	ID       int64     `json:"id"`
	GuildID  string    `json:"guildId"`
	RoomName string    `json:"roomName"`
	Owner    string    `json:"ownerDiscordId"`
	Action   string    `json:"action"`
	Actor    string    `json:"actorDiscordId"`
	Member   string    `json:"memberDiscordId"`
	Detail   string    `json:"detail"`
	At       time.Time `json:"createdAt"`
}

// voiceEvent notes what happened in a room. It reads the room as it is now, so call it before
// deleting one. A failure is only logged: the action itself already happened.
func (s *server) voiceEvent(ctx context.Context, roomID int64, action, actor, member, detail string) {
	if !validDiscordSnowflake(actor) {
		actor = ""
	}
	if !validDiscordSnowflake(member) {
		member = ""
	}
	if _, err := s.db.Exec(ctx, `
		INSERT INTO voice_room_events (guild_id, room_id, room_name, owner_discord_id, action, actor_discord_id, member_discord_id, detail)
		SELECT guild_id, id, name, owner_discord_id, $2, $3, $4, $5 FROM voice_rooms WHERE id=$1
	`, roomID, action, actor, member, detail); err != nil {
		log.Printf("[WARN] voice room event %s: %v", action, err)
	}
}

// voiceActorID is the member the bot acts for, or "" when it acts on its own.
func voiceActorID(c *fiber.Ctx) string {
	id := strings.TrimSpace(c.Get("X-Bot-Actor-Discord-Id"))
	if validDiscordSnowflake(id) {
		return id
	}
	return ""
}

func (s *server) loadVoicePlaces(ctx context.Context, guildID string) ([]voicePlace, error) {
	rows, err := s.db.Query(ctx, `
		SELECT kind, channel_id, guild_id, message_id, message_version FROM voice_bot_places
		WHERE ($1='' OR guild_id=$1)
		ORDER BY array_position(ARRAY['hub','panel','log','category']::varchar[], kind), created_at
	`, guildID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	places := []voicePlace{}
	for rows.Next() {
		var p voicePlace
		if err := rows.Scan(&p.Kind, &p.ChannelID, &p.GuildID, &p.MessageID, &p.MessageVersion); err != nil {
			return nil, err
		}
		places = append(places, p)
	}
	return places, rows.Err()
}

// Bot side

func (s *server) botVoicePlaces(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	places, err := s.loadVoicePlaces(c.Context(), strings.TrimSpace(c.Query("guildId")))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"places": places})
}

// botVoiceAddPlace records a channel the bot starts using: from a setup command, or a panel
// posted earlier that someone pressed.
func (s *server) botVoiceAddPlace(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		Kind           string `json:"kind"`
		GuildID        string `json:"guildId"`
		ChannelID      string `json:"channelId"`
		MessageID      string `json:"messageId"`
		MessageVersion int64  `json:"messageVersion"`
		Name           string `json:"name"`
	}
	if c.BodyParser(&input) != nil || !voicePlaceAddKinds[input.Kind] || !validDiscordSnowflake(input.GuildID) || !validDiscordSnowflake(input.ChannelID) ||
		(input.MessageID != "" && !validDiscordSnowflake(input.MessageID)) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	name := cleanText(input.Name, 100)
	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())
	if voicePlaceSingle[input.Kind] {
		if _, err := tx.Exec(c.Context(), `DELETE FROM voice_bot_places WHERE kind=$1 AND guild_id=$2 AND channel_id<>$3`, input.Kind, input.GuildID, input.ChannelID); err != nil {
			return err
		}
	}
	var added bool
	if err := tx.QueryRow(c.Context(), `
		INSERT INTO voice_bot_places (kind, channel_id, guild_id, message_id, message_version, name, checked_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (kind, channel_id) DO UPDATE
		SET message_id=EXCLUDED.message_id, message_version=EXCLUDED.message_version,
		    name=CASE WHEN EXCLUDED.name<>'' THEN EXCLUDED.name ELSE voice_bot_places.name END,
		    missing=FALSE, stop_requested_at=NULL, checked_at=NOW()
		RETURNING xmax = 0
	`, input.Kind, input.ChannelID, input.GuildID, input.MessageID, input.MessageVersion, name).Scan(&added); err != nil {
		return err
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	if added {
		meta := voiceAuditMeta(c, name)
		meta["place"] = input.Kind
		s.audit(c, auditEvent{Category: "discord", Action: "discord.voice.place_added", Target: "voice_bot_place", TargetID: input.ChannelID, Metadata: meta})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoiceRemovePlace forgets a channel deleted in Discord (or a row of a kind no longer used).
func (s *server) botVoiceRemovePlace(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	kind, channelID := c.Params("kind"), c.Params("channelId")
	if !voicePlaceKinds[kind] || !validDiscordSnowflake(channelID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	var name string
	err := s.db.QueryRow(c.Context(), `DELETE FROM voice_bot_places WHERE kind=$1 AND channel_id=$2 RETURNING name`, kind, channelID).Scan(&name)
	if err == nil {
		s.audit(c, auditEvent{Category: "discord", Action: "discord.voice.place_removed", Target: "voice_bot_place", TargetID: channelID,
			Metadata: map[string]any{"name": name, "place": kind}})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoicePlaceDeleted: someone deleted one of the bot's channels and the bot put it back (or
// could not). The old row goes; the bot records the new channel with its usual add call.
func (s *server) botVoicePlaceDeleted(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		Kind         string `json:"kind"`
		GuildID      string `json:"guildId"`
		ChannelID    string `json:"channelId"`
		NewChannelID string `json:"newChannelId"`
		Name         string `json:"name"`
		DeleterID    string `json:"deleterId"`
		DeleterName  string `json:"deleterName"`
	}
	if c.BodyParser(&input) != nil || !voicePlaceKinds[input.Kind] || !validDiscordSnowflake(input.GuildID) || !validDiscordSnowflake(input.ChannelID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	if _, err := s.db.Exec(c.Context(), `DELETE FROM voice_bot_places WHERE kind=$1 AND channel_id=$2`, input.Kind, input.ChannelID); err != nil {
		return err
	}
	meta := map[string]any{"name": cleanText(input.Name, 100), "place": input.Kind, "recreated": validDiscordSnowflake(input.NewChannelID)}
	if validDiscordSnowflake(input.DeleterID) {
		meta["deleterId"] = input.DeleterID
		meta["deleterName"] = cleanText(input.DeleterName, 64)
	}
	s.audit(c, auditEvent{Category: "security", Action: "discord.voice.place_deleted", Target: "voice_bot_place", TargetID: input.ChannelID,
		Outcome: "denied", Metadata: meta})
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoiceFeed returns room events the log channel has not shown yet. Only events after the log
// channel was set, and from the last 15 minutes, so a bot that was down does not flood it.
func (s *server) botVoiceFeed(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT e.id, e.guild_id, e.room_name, e.owner_discord_id, e.action, e.actor_discord_id, e.member_discord_id, e.detail, e.created_at
		FROM voice_room_events e
		JOIN voice_bot_places p ON p.kind='log' AND p.guild_id=e.guild_id AND p.stop_requested_at IS NULL AND NOT p.missing
		WHERE e.posted_at IS NULL AND ($1='' OR e.guild_id=$1) AND e.action = ANY($2)
		  AND e.created_at >= p.created_at AND e.created_at > NOW() - INTERVAL '15 minutes'
		ORDER BY e.id
		LIMIT 10
	`, strings.TrimSpace(c.Query("guildId")), voiceFeedActions)
	if err != nil {
		return err
	}
	events, err := scanVoiceEvents(rows)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"events": events})
}

func (s *server) botVoiceFeedAck(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		IDs []int64 `json:"ids"`
	}
	if c.BodyParser(&input) != nil || len(input.IDs) > 50 {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	if len(input.IDs) > 0 {
		if _, err := s.db.Exec(c.Context(), `UPDATE voice_room_events SET posted_at=NOW() WHERE id = ANY($1)`, input.IDs); err != nil {
			return err
		}
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoiceHistory is /room history: the last events in rooms the member owns, wrong passwords
// included. Only the member sees the reply.
func (s *server) botVoiceHistory(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	actor, err := voiceActor(c)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT id, guild_id, room_name, owner_discord_id, action, actor_discord_id, member_discord_id, detail, created_at
		FROM voice_room_events
		WHERE owner_discord_id=$1 AND created_at > NOW() - INTERVAL '30 days'
		ORDER BY id DESC
		LIMIT 25
	`, actor)
	if err != nil {
		return err
	}
	events, err := scanVoiceEvents(rows)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"events": events})
}

type voiceEventRows interface {
	Next() bool
	Scan(...any) error
	Err() error
	Close()
}

func scanVoiceEvents(rows voiceEventRows) ([]voiceEventRow, error) {
	defer rows.Close()
	events := []voiceEventRow{}
	for rows.Next() {
		var e voiceEventRow
		if err := rows.Scan(&e.ID, &e.GuildID, &e.RoomName, &e.Owner, &e.Action, &e.Actor, &e.Member, &e.Detail, &e.At); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}
