package main

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Password-locked voice rooms. The voice bot owns the Discord side (channels and permission
// overwrites); this file keeps the rooms, hashed passwords, who may enter and the wrong-try
// lockout, so the rules hold even if the bot restarts.

type voiceRoomSettings struct {
	Enabled            bool `json:"enabled"`
	MaxRoomsPerUser    int  `json:"maxRoomsPerUser"`
	EmptyDeleteMinutes int  `json:"emptyDeleteMinutes"`
	MaxFailures        int  `json:"maxFailures"`
	LockoutMinutes     int  `json:"lockoutMinutes"`
}

type voiceRoom struct {
	ID              int64     `json:"id"`
	GuildID         string    `json:"guildId"`
	GuildName       string    `json:"guildName"`
	ChannelID       string    `json:"channelId"`
	OwnerDiscordID  string    `json:"ownerDiscordId"`
	OwnerUsername   string    `json:"ownerUsername"`
	Name            string    `json:"name"`
	Locked          bool      `json:"locked"`
	UserLimit       int       `json:"userLimit"`
	DeleteRequested bool      `json:"deleteRequested"`
	AccessCount     int       `json:"accessCount"`
	Kind            string    `json:"kind"`
	HasPassword     bool      `json:"hasPassword"`
	CreatedAt       time.Time `json:"createdAt"`
	SiteUsername    string    `json:"siteUsername,omitempty"`
}

const voiceRoomColumns = `r.id, r.guild_id, COALESCE(r.channel_id, ''), r.owner_discord_id, r.owner_username, r.name, r.locked, r.user_limit,
	r.delete_requested_at IS NOT NULL, (SELECT COUNT(*) FROM voice_room_access a WHERE a.room_id=r.id), r.created_at,
	r.kind, r.password_hash <> '', r.guild_name`

func scanVoiceRoom(row pgx.Row, extra ...any) (voiceRoom, error) {
	var room voiceRoom
	dest := []any{&room.ID, &room.GuildID, &room.ChannelID, &room.OwnerDiscordID, &room.OwnerUsername, &room.Name, &room.Locked,
		&room.UserLimit, &room.DeleteRequested, &room.AccessCount, &room.CreatedAt, &room.Kind, &room.HasPassword, &room.GuildName}
	err := row.Scan(append(dest, extra...)...)
	return room, err
}

func (s *server) loadVoiceRoomSettings(ctx context.Context) (voiceRoomSettings, error) {
	var settings voiceRoomSettings
	err := s.db.QueryRow(ctx, `
		SELECT enabled, max_rooms_per_user, empty_delete_minutes, max_failures, lockout_minutes
		FROM voice_room_settings WHERE singleton=TRUE
	`).Scan(&settings.Enabled, &settings.MaxRoomsPerUser, &settings.EmptyDeleteMinutes, &settings.MaxFailures, &settings.LockoutMinutes)
	if errors.Is(err, pgx.ErrNoRows) {
		return voiceRoomSettings{Enabled: true, MaxRoomsPerUser: 3, EmptyDeleteMinutes: 5, MaxFailures: 5, LockoutMinutes: 10}, nil
	}
	return settings, err
}

func cleanVoiceRoomName(raw string) string {
	var builder strings.Builder
	for _, r := range raw {
		if r < 32 || r == 127 {
			builder.WriteRune(' ')
			continue
		}
		builder.WriteRune(r)
	}
	return cleanText(strings.Join(strings.Fields(builder.String()), " "), 100)
}

func validVoiceRoomPassword(password string) bool {
	count := utf8.RuneCountInString(password)
	return count >= 4 && count <= 32 && strings.TrimSpace(password) == password
}

// voiceActor is the Discord member the bot is acting for. The header is trusted only because
// verifyBotSecret has already checked the internal secret.
func voiceActor(c *fiber.Ctx) (string, error) {
	actor := strings.TrimSpace(c.Get("X-Bot-Actor-Discord-Id"))
	if !validDiscordSnowflake(actor) {
		return "", fiber.NewError(fiber.StatusBadRequest, "ไม่พบผู้ใช้ Discord")
	}
	return actor, nil
}

// voiceAuditMeta starts the log details for something a member did through the bot: the room,
// their Discord id (a mention in Discord alerts) and their username (shown on the logs page).
func voiceAuditMeta(c *fiber.Ctx, room string) map[string]any {
	meta := map[string]any{"name": room}
	if id := strings.TrimSpace(c.Get("X-Bot-Actor-Discord-Id")); validDiscordSnowflake(id) {
		meta["discordActor"] = id
	}
	if name := cleanText(c.Get("X-Bot-Actor-Username"), 64); name != "" {
		meta["actorName"] = name
	}
	return meta
}

func voiceAudit(c *fiber.Ctx, s *server, action string, roomID int64, meta map[string]any) {
	s.audit(c, auditEvent{Category: "discord", Action: action, Target: "voice_room", TargetID: strconv.FormatInt(roomID, 10), Metadata: meta})
}

func voiceRoomID(c *fiber.Ctx) (int64, bool) {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	return id, err == nil && id > 0
}

func (s *server) voiceRoomByID(ctx context.Context, id int64) (voiceRoom, error) {
	return scanVoiceRoom(s.db.QueryRow(ctx, `SELECT `+voiceRoomColumns+` FROM voice_rooms r WHERE r.id=$1`, id))
}

// voiceRoomForManager loads a room the actor owns. In Discord only the owner manages a room;
// site admins remove rooms from the web page.
func (s *server) voiceRoomForManager(c *fiber.Ctx) (voiceRoom, string, error) {
	if err := s.verifyBotSecret(c); err != nil {
		return voiceRoom{}, "", err
	}
	actor, err := voiceActor(c)
	if err != nil {
		return voiceRoom{}, "", err
	}
	id, ok := voiceRoomID(c)
	if !ok {
		return voiceRoom{}, "", fiber.NewError(fiber.StatusBadRequest, "ห้องไม่ถูกต้อง")
	}
	room, err := s.voiceRoomByID(c.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		return voiceRoom{}, "", fiber.NewError(fiber.StatusNotFound, "ไม่พบห้องนี้ อาจถูกลบไปแล้ว")
	}
	if err != nil {
		return voiceRoom{}, "", err
	}
	if room.OwnerDiscordID != actor {
		return voiceRoom{}, "", fiber.NewError(fiber.StatusForbidden, "จัดการได้เฉพาะเจ้าของห้อง")
	}
	return room, actor, nil
}

func (s *server) botVoiceSettings(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	settings, err := s.loadVoiceRoomSettings(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(settings)
}

// botVoiceRooms lists the rooms the bot should be looking after. Rooms whose channel was never
// made (the bot failed half way) are dropped after ten minutes.
func (s *server) botVoiceRooms(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	_, _ = s.db.Exec(c.Context(), `DELETE FROM voice_rooms WHERE channel_id IS NULL AND created_at < NOW() - INTERVAL '10 minutes'`)
	_, _ = s.db.Exec(c.Context(), `DELETE FROM voice_room_events WHERE created_at < NOW() - INTERVAL '30 days'`)
	_, _ = s.db.Exec(c.Context(), `DELETE FROM voice_sessions WHERE joined_at < NOW() - INTERVAL '90 days'`)
	guildID := strings.TrimSpace(c.Query("guildId"))
	rows, err := s.db.Query(c.Context(), `
		SELECT `+voiceRoomColumns+` FROM voice_rooms r
		WHERE r.channel_id IS NOT NULL AND ($1='' OR r.guild_id=$1)
		ORDER BY r.id
	`, guildID)
	if err != nil {
		return err
	}
	defer rows.Close()
	rooms := []voiceRoom{}
	for rows.Next() {
		room, err := scanVoiceRoom(rows)
		if err != nil {
			return err
		}
		rooms = append(rooms, room)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"rooms": rooms})
}

func (s *server) botVoiceCreateRoom(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	actor, err := voiceActor(c)
	if err != nil {
		return err
	}
	var input struct {
		GuildID       string `json:"guildId"`
		GuildName     string `json:"guildName"`
		Name          string `json:"name"`
		Password      string `json:"password"`
		UserLimit     int    `json:"userLimit"`
		OwnerUsername string `json:"ownerUsername"`
		// Rooms from Join to Create have no password yet. They start closed: only the owner
		// can connect until a password is set or the room is opened to everyone.
		Open bool `json:"open"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	name := cleanVoiceRoomName(input.Name)
	if !validDiscordSnowflake(input.GuildID) || name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตั้งชื่อห้องก่อน", Code: "invalid_name"})
	}
	if !(input.Open && input.Password == "") && !validVoiceRoomPassword(input.Password) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสต้องยาว 4–32 ตัว และไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง", Code: "invalid_password"})
	}
	if input.UserLimit < 0 || input.UserLimit > 99 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "จำนวนคนต้องอยู่ระหว่าง 0–99 (0 คือไม่จำกัด)", Code: "invalid_limit"})
	}
	settings, err := s.loadVoiceRoomSettings(c.Context())
	if err != nil {
		return err
	}
	if !settings.Enabled {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ตอนนี้ปิดการสร้างห้องอยู่", Code: "disabled"})
	}
	hash := ""
	if input.Password != "" {
		if hash, err = s.hashPassword(input.Password); err != nil {
			return err
		}
	}
	kind := "command"
	if input.Open {
		kind = "join"
	}
	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())
	// One owner at a time, so two quick clicks cannot both pass the room limit. The limit is per
	// server: the bot can be in several.
	if _, err := tx.Exec(c.Context(), `SELECT pg_advisory_xact_lock(hashtext('voice_room_owner:' || $1 || ':' || $2))`, input.GuildID, actor); err != nil {
		return err
	}
	var owned int
	if err := tx.QueryRow(c.Context(), `SELECT COUNT(*) FROM voice_rooms WHERE owner_discord_id=$1 AND guild_id=$2`, actor, input.GuildID).Scan(&owned); err != nil {
		return err
	}
	if owned >= settings.MaxRoomsPerUser {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "มีห้องครบ " + strconv.Itoa(settings.MaxRoomsPerUser) + " ห้องแล้ว ลบห้องเก่าก่อน", Code: "room_limit"})
	}
	var id int64
	if err := tx.QueryRow(c.Context(), `
		INSERT INTO voice_rooms (guild_id, guild_name, owner_discord_id, owner_username, name, password_hash, user_limit, kind, locked)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
	`, input.GuildID, cleanText(input.GuildName, 100), actor, cleanText(input.OwnerUsername, 64), name, hash, input.UserLimit, kind, true).Scan(&id); err != nil {
		return err
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	meta := voiceAuditMeta(c, name)
	meta["kind"] = kind
	if _, ok := meta["actorName"]; !ok && input.OwnerUsername != "" {
		meta["actorName"] = cleanText(input.OwnerUsername, 64)
	}
	voiceAudit(c, s, "discord.voice.room_created", id, meta)
	s.voiceEvent(c.Context(), id, "created", actor, "", kind)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": id, "name": name})
}

func (s *server) botVoiceSetChannel(c *fiber.Ctx) error {
	room, _, err := s.voiceRoomForManager(c)
	if err != nil {
		return err
	}
	var input struct {
		ChannelID string `json:"channelId"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.ChannelID) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ห้องไม่ถูกต้อง", Code: "invalid_channel"})
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE voice_rooms SET channel_id=$2, updated_at=NOW() WHERE id=$1`, room.ID, input.ChannelID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) botVoiceRoom(c *fiber.Ctx) error {
	room, _, err := s.voiceRoomForManager(c)
	if err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `SELECT discord_id FROM voice_room_access WHERE room_id=$1 ORDER BY granted_at DESC LIMIT 100`, room.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	access := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		access = append(access, id)
	}
	return c.JSON(fiber.Map{"room": room, "access": access})
}

// botVoiceCheck says whether a member may be in a room channel. The bot asks this when someone
// joins, and disconnects them when the answer is no.
func (s *server) botVoiceCheck(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	channelID := strings.TrimSpace(c.Query("channelId"))
	discordID := strings.TrimSpace(c.Query("discordId"))
	if !validDiscordSnowflake(channelID) || !validDiscordSnowflake(discordID) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_query"})
	}
	var id int64
	var owner string
	var locked, granted bool
	err := s.db.QueryRow(c.Context(), `
		SELECT r.id, r.owner_discord_id, r.locked,
		       EXISTS (SELECT 1 FROM voice_room_access a WHERE a.room_id=r.id AND a.discord_id=$2)
		FROM voice_rooms r WHERE r.channel_id=$1
	`, channelID, discordID).Scan(&id, &owner, &locked, &granted)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(fiber.Map{"room": false, "allowed": true})
	}
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"room": true, "roomId": id, "allowed": !locked || granted || owner == discordID, "ownerDiscordId": owner})
}

func (s *server) botVoiceUnlock(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	actor, err := voiceActor(c)
	if err != nil {
		return err
	}
	id, ok := voiceRoomID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ห้องไม่ถูกต้อง", Code: "invalid_room"})
	}
	var input struct {
		Password string `json:"password"`
	}
	if c.BodyParser(&input) != nil || input.Password == "" || utf8.RuneCountInString(input.Password) > 64 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ใส่รหัสก่อน", Code: "invalid_password"})
	}
	settings, err := s.loadVoiceRoomSettings(c.Context())
	if err != nil {
		return err
	}
	var hash, name, owner string
	err = s.db.QueryRow(c.Context(), `SELECT password_hash, name, owner_discord_id FROM voice_rooms WHERE id=$1 AND channel_id IS NOT NULL`, id).Scan(&hash, &name, &owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบห้องนี้ อาจถูกลบไปแล้ว", Code: "not_found"})
	}
	if err != nil {
		return err
	}
	if hash == "" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "เจ้าของยังไม่ได้ตั้งรหัส ตอนนี้เข้าได้เฉพาะเจ้าของ", Code: "no_password"})
	}
	var lockedUntil *time.Time
	_ = s.db.QueryRow(c.Context(), `SELECT locked_until FROM voice_room_attempts WHERE room_id=$1 AND discord_id=$2`, id, actor).Scan(&lockedUntil)
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"error": "ใส่รหัสผิดหลายครั้ง ลองใหม่ได้ <t:" + strconv.FormatInt(lockedUntil.Unix(), 10) + ":R>", "code": "locked_out",
			"lockedUntil": lockedUntil,
		})
	}
	if s.verifyPassword(input.Password, hash) {
		if _, err := s.db.Exec(c.Context(), `
			INSERT INTO voice_room_access (room_id, discord_id) VALUES ($1, $2) ON CONFLICT DO NOTHING
		`, id, actor); err != nil {
			return err
		}
		_, _ = s.db.Exec(c.Context(), `DELETE FROM voice_room_attempts WHERE room_id=$1 AND discord_id=$2`, id, actor)
		voiceAudit(c, s, "discord.voice.access_granted", id, voiceAuditMeta(c, name))
		s.voiceEvent(c.Context(), id, "entered", "", actor, "")
		return c.JSON(fiber.Map{"ok": true})
	}
	// A wrong try. Count it, and lock this member out of the room after too many.
	var failures int
	err = s.db.QueryRow(c.Context(), `
		INSERT INTO voice_room_attempts (room_id, discord_id, failures, last_failed_at)
		VALUES ($1, $2, 1, NOW())
		ON CONFLICT (room_id, discord_id) DO UPDATE
		SET failures = CASE WHEN voice_room_attempts.locked_until IS NOT NULL THEN 1 ELSE voice_room_attempts.failures + 1 END,
		    locked_until = NULL,
		    last_failed_at = NOW()
		RETURNING failures
	`, id, actor).Scan(&failures)
	if err != nil {
		return err
	}
	if failures >= settings.MaxFailures {
		until := time.Now().Add(time.Duration(settings.LockoutMinutes) * time.Minute)
		_, _ = s.db.Exec(c.Context(), `UPDATE voice_room_attempts SET locked_until=$3 WHERE room_id=$1 AND discord_id=$2`, id, actor, until)
		meta := voiceAuditMeta(c, name)
		meta["failures"] = failures
		meta["lockoutMinutes"] = settings.LockoutMinutes
		s.audit(c, auditEvent{Category: "security", Action: "discord.voice.locked_out", Target: "voice_room", TargetID: strconv.FormatInt(id, 10), Outcome: "denied", Metadata: meta})
		s.voiceEvent(c.Context(), id, "locked_out", "", actor, "")
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"error": "ใส่รหัสผิดครบ " + strconv.Itoa(failures) + " ครั้ง ลองใหม่ได้ <t:" + strconv.FormatInt(until.Unix(), 10) + ":R>", "code": "locked_out",
			"lockedUntil": until, "lockedNow": true, "ownerDiscordId": owner,
		})
	}
	s.voiceEvent(c.Context(), id, "wrong_password", "", actor, "")
	return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
		"error": "รหัสไม่ถูกต้อง ลองได้อีก " + strconv.Itoa(settings.MaxFailures-failures) + " ครั้ง", "code": "wrong_password",
		"remaining": settings.MaxFailures - failures,
	})
}

func (s *server) botVoiceUpdateRoom(c *fiber.Ctx) error {
	room, actor, err := s.voiceRoomForManager(c)
	if err != nil {
		return err
	}
	var input struct {
		Name      *string `json:"name"`
		Password  *string `json:"password"`
		Locked    *bool   `json:"locked"`
		UserLimit *int    `json:"userLimit"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	revoked := []string{}
	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())
	if input.Name != nil {
		name := cleanVoiceRoomName(*input.Name)
		if name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตั้งชื่อห้องก่อน", Code: "invalid_name"})
		}
		if _, err := tx.Exec(c.Context(), `UPDATE voice_rooms SET name=$2, updated_at=NOW() WHERE id=$1`, room.ID, name); err != nil {
			return err
		}
	}
	if input.UserLimit != nil {
		if *input.UserLimit < 0 || *input.UserLimit > 99 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "จำนวนคนต้องอยู่ระหว่าง 0–99 (0 คือไม่จำกัด)", Code: "invalid_limit"})
		}
		if _, err := tx.Exec(c.Context(), `UPDATE voice_rooms SET user_limit=$2, updated_at=NOW() WHERE id=$1`, room.ID, *input.UserLimit); err != nil {
			return err
		}
	}
	if input.Locked != nil {
		if _, err := tx.Exec(c.Context(), `UPDATE voice_rooms SET locked=$2, updated_at=NOW() WHERE id=$1`, room.ID, *input.Locked); err != nil {
			return err
		}
	}
	if input.Password != nil {
		if !validVoiceRoomPassword(*input.Password) {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสต้องยาว 4–32 ตัว และไม่ขึ้นต้นหรือลงท้ายด้วยช่องว่าง", Code: "invalid_password"})
		}
		hash, err := s.hashPassword(*input.Password)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(c.Context(), `UPDATE voice_rooms SET password_hash=$2, updated_at=NOW() WHERE id=$1`, room.ID, hash); err != nil {
			return err
		}
		// Everyone who knew the old password has to give the new one.
		rows, err := tx.Query(c.Context(), `DELETE FROM voice_room_access WHERE room_id=$1 RETURNING discord_id`, room.ID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				revoked = append(revoked, id)
			}
		}
		rows.Close()
		if _, err := tx.Exec(c.Context(), `DELETE FROM voice_room_attempts WHERE room_id=$1`, room.ID); err != nil {
			return err
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	if input.Password != nil {
		meta := voiceAuditMeta(c, room.Name)
		meta["revoked"] = len(revoked)
		meta["firstPassword"] = !room.HasPassword
		voiceAudit(c, s, "discord.voice.password_changed", room.ID, meta)
		event := "password_changed"
		if !room.HasPassword {
			event = "password_set"
		}
		s.voiceEvent(c.Context(), room.ID, event, actor, "", "")
	}
	if input.Locked != nil && *input.Locked != room.Locked {
		action, event := "discord.voice.unlocked", "unlocked"
		if *input.Locked {
			action, event = "discord.voice.locked", "locked"
		}
		voiceAudit(c, s, action, room.ID, voiceAuditMeta(c, room.Name))
		// Setting the first password locks the room too; one line in the log is enough.
		if input.Password == nil {
			s.voiceEvent(c.Context(), room.ID, event, actor, "", "")
		}
	}
	if input.Name != nil || input.UserLimit != nil {
		meta := voiceAuditMeta(c, room.Name)
		if input.Name != nil && cleanVoiceRoomName(*input.Name) != room.Name {
			meta["newName"] = cleanVoiceRoomName(*input.Name)
		}
		if input.UserLimit != nil {
			meta["userLimit"] = *input.UserLimit
		}
		voiceAudit(c, s, "discord.voice.room_updated", room.ID, meta)
	}
	updated, err := s.voiceRoomByID(c.Context(), room.ID)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"room": updated, "revoked": revoked})
}

func (s *server) botVoiceKick(c *fiber.Ctx) error {
	room, actor, err := s.voiceRoomForManager(c)
	if err != nil {
		return err
	}
	var input struct {
		DiscordID string `json:"discordId"`
		Username  string `json:"username"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.DiscordID) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เลือกคนก่อน", Code: "invalid_member"})
	}
	if input.DiscordID == room.OwnerDiscordID {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เตะเจ้าของห้องไม่ได้", Code: "owner"})
	}
	if _, err := s.db.Exec(c.Context(), `DELETE FROM voice_room_access WHERE room_id=$1 AND discord_id=$2`, room.ID, input.DiscordID); err != nil {
		return err
	}
	meta := voiceAuditMeta(c, room.Name)
	meta["memberId"] = input.DiscordID
	meta["memberName"] = cleanText(input.Username, 64)
	voiceAudit(c, s, "discord.voice.member_kicked", room.ID, meta)
	s.voiceEvent(c.Context(), room.ID, "kicked", actor, input.DiscordID, "")
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoiceDenied records that the bot disconnected someone who joined a locked room without the
// password (moved in by someone else, or an admin who skips channel permissions).
func (s *server) botVoiceDenied(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	id, ok := voiceRoomID(c)
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "ห้องไม่ถูกต้อง")
	}
	var input struct {
		DiscordID string `json:"discordId"`
		Username  string `json:"username"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.DiscordID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	var name string
	if err := s.db.QueryRow(c.Context(), `SELECT name FROM voice_rooms WHERE id=$1`, id).Scan(&name); err != nil {
		return c.SendStatus(fiber.StatusNoContent)
	}
	s.audit(c, auditEvent{Category: "discord", Action: "discord.voice.entry_denied", Target: "voice_room", TargetID: strconv.FormatInt(id, 10), Outcome: "denied",
		Metadata: map[string]any{"name": name, "memberId": input.DiscordID, "memberName": cleanText(input.Username, 64)}})
	s.voiceEvent(c.Context(), id, "denied", "", input.DiscordID, "")
	return c.SendStatus(fiber.StatusNoContent)
}

// botVoiceDeleteRoom forgets a room. reason=empty|missing is the bot cleaning up on its own
// (empty for too long, or the channel was deleted in Discord); otherwise the owner asked.
func (s *server) botVoiceDeleteRoom(c *fiber.Ctx) error {
	reason := c.Query("reason")
	var room voiceRoom
	if reason == "empty" || reason == "missing" || reason == "admin" {
		if err := s.verifyBotSecret(c); err != nil {
			return err
		}
		id, ok := voiceRoomID(c)
		if !ok {
			return fiber.NewError(fiber.StatusBadRequest, "ห้องไม่ถูกต้อง")
		}
		found, err := s.voiceRoomByID(c.Context(), id)
		if errors.Is(err, pgx.ErrNoRows) {
			return c.SendStatus(fiber.StatusNoContent)
		}
		if err != nil {
			return err
		}
		room = found
	} else {
		found, _, err := s.voiceRoomForManager(c)
		if err != nil {
			return err
		}
		room, reason = found, "owner"
	}
	s.voiceEvent(c.Context(), room.ID, "deleted", voiceActorID(c), "", reason)
	if _, err := s.db.Exec(c.Context(), `DELETE FROM voice_rooms WHERE id=$1`, room.ID); err != nil {
		return err
	}
	meta := voiceAuditMeta(c, room.Name)
	meta["reason"] = reason
	meta["ownerName"] = room.OwnerUsername
	voiceAudit(c, s, "discord.voice.room_deleted", room.ID, meta)
	return c.SendStatus(fiber.StatusNoContent)
}

// Web admin (superadmin): the limits, and the rooms that exist right now.

func (s *server) adminVoiceRooms(c *fiber.Ctx) error {
	settings, err := s.loadVoiceRoomSettings(c.Context())
	if err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT `+voiceRoomColumns+`, COALESCE(u.identifier, '')
		FROM voice_rooms r
		LEFT JOIN oauth_accounts o ON o.provider='discord' AND o.provider_user_id=r.owner_discord_id
		LEFT JOIN users u ON u.id=o.user_id
		WHERE r.channel_id IS NOT NULL
		ORDER BY r.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		return err
	}
	defer rows.Close()
	rooms := []voiceRoom{}
	for rows.Next() {
		var site string
		room, err := scanVoiceRoom(rows, &site)
		if err != nil {
			return err
		}
		room.SiteUsername = site
		rooms = append(rooms, room)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"settings": settings, "rooms": rooms})
}

func (s *server) updateAdminVoiceRoomSettings(c *fiber.Ctx) error {
	var input voiceRoomSettings
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	switch {
	case input.MaxRoomsPerUser < 0 || input.MaxRoomsPerUser > 20:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ห้องต่อคนต้องอยู่ระหว่าง 0–20", Code: "invalid_max_rooms"})
	case input.EmptyDeleteMinutes < 1 || input.EmptyDeleteMinutes > 1440:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เวลาลบห้องว่างต้องอยู่ระหว่าง 1–1440 นาที", Code: "invalid_empty_minutes"})
	case input.MaxFailures < 1 || input.MaxFailures > 20:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "จำนวนครั้งที่ใส่ผิดได้ต้องอยู่ระหว่าง 1–20", Code: "invalid_max_failures"})
	case input.LockoutMinutes < 1 || input.LockoutMinutes > 1440:
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เวลาห้ามลองต้องอยู่ระหว่าง 1–1440 นาที", Code: "invalid_lockout"})
	}
	actor := current(c)
	if _, err := s.db.Exec(c.Context(), `
		INSERT INTO voice_room_settings (singleton, enabled, max_rooms_per_user, empty_delete_minutes, max_failures, lockout_minutes, updated_by)
		VALUES (TRUE, $1, $2, $3, $4, $5, $6)
		ON CONFLICT (singleton) DO UPDATE
		SET enabled=EXCLUDED.enabled, max_rooms_per_user=EXCLUDED.max_rooms_per_user, empty_delete_minutes=EXCLUDED.empty_delete_minutes,
		    max_failures=EXCLUDED.max_failures, lockout_minutes=EXCLUDED.lockout_minutes, updated_by=EXCLUDED.updated_by, updated_at=NOW()
	`, input.Enabled, input.MaxRoomsPerUser, input.EmptyDeleteMinutes, input.MaxFailures, input.LockoutMinutes, actor.ID); err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "discord", Action: "discord.voice.settings_updated", Target: "voice_room_settings",
		Metadata: map[string]any{"enabled": input.Enabled, "maxRoomsPerUser": input.MaxRoomsPerUser, "emptyDeleteMinutes": input.EmptyDeleteMinutes,
			"maxFailures": input.MaxFailures, "lockoutMinutes": input.LockoutMinutes}})
	saved, err := s.loadVoiceRoomSettings(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(saved)
}

// adminDeleteVoiceRoom asks the bot to delete the channel; the bot removes the room once done.
func (s *server) adminDeleteVoiceRoom(c *fiber.Ctx) error {
	id, ok := voiceRoomID(c)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ห้องไม่ถูกต้อง", Code: "invalid_room"})
	}
	var name string
	err := s.db.QueryRow(c.Context(), `
		UPDATE voice_rooms SET delete_requested_at=COALESCE(delete_requested_at, NOW()), updated_at=NOW()
		WHERE id=$1 RETURNING name
	`, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบห้องนี้ อาจถูกลบไปแล้ว", Code: "not_found"})
	}
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "discord", Action: "discord.voice.delete_requested", Target: "voice_room", TargetID: strconv.FormatInt(id, 10),
		Metadata: map[string]any{"name": name}})
	return c.SendStatus(fiber.StatusAccepted)
}

// botVoiceTransfer hands a room to someone still in it after its owner left. Only the bot
// decides this (no member acts here), so the internal secret is enough.
func (s *server) botVoiceTransfer(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	id, ok := voiceRoomID(c)
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "ห้องไม่ถูกต้อง")
	}
	var input struct {
		DiscordID string `json:"discordId"`
		Username  string `json:"username"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.DiscordID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	var name, previous, previousName string
	err := s.db.QueryRow(c.Context(), `
		UPDATE voice_rooms r SET owner_discord_id=$2, owner_username=$3, updated_at=NOW()
		FROM (SELECT owner_discord_id, owner_username FROM voice_rooms WHERE id=$1) old
		WHERE r.id=$1 RETURNING r.name, old.owner_discord_id, old.owner_username
	`, id, input.DiscordID, cleanText(input.Username, 64)).Scan(&name, &previous, &previousName)
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบห้องนี้")
	}
	if err != nil {
		return err
	}
	// Both keep a way back in: the new owner, and the old one who was in the room.
	_, _ = s.db.Exec(c.Context(), `
		INSERT INTO voice_room_access (room_id, discord_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING
	`, id, input.DiscordID, previous)
	s.audit(c, auditEvent{Category: "discord", Action: "discord.voice.owner_transferred", Target: "voice_room", TargetID: strconv.FormatInt(id, 10),
		Metadata: map[string]any{"name": name, "from": previous, "fromName": previousName, "to": input.DiscordID, "toName": cleanText(input.Username, 64)}})
	s.voiceEvent(c.Context(), id, "owner_changed", previous, input.DiscordID, "")
	return c.SendStatus(fiber.StatusNoContent)
}
