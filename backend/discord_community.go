package main

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// The community bot (discord-community-bot) looks after one Discord server: welcome and
// verification, self roles, tickets, temporary voice rooms, stats channels and website status
// alerts. Admins set it up on the admin Discord bot page or with /setup in Discord; both save
// the same settings here and the bot applies them within about 15 seconds.

type communitySettings struct {
	GuildID string `json:"guildId"`

	WelcomeEnabled   bool   `json:"welcomeEnabled"`
	WelcomeChannelID string `json:"welcomeChannelId"`
	WelcomeMessage   string `json:"welcomeMessage"`
	VerifyEnabled    bool   `json:"verifyEnabled"`
	VerifyChannelID  string `json:"verifyChannelId"`
	VerifyMessage    string `json:"verifyMessage"`
	// Given on verification. Leave verification off to give it as soon as someone joins.
	MemberRoleID string `json:"memberRoleId"`

	RolesChannelID string   `json:"rolesChannelId"`
	RolesMessage   string   `json:"rolesMessage"`
	SelfRoleIDs    []string `json:"selfRoleIds"`

	// Besides server admins: who may run /setup and /create, who handles tickets, and who may
	// open tickets and make voice rooms (empty = every member).
	ManagerRoleIDs []string `json:"managerRoleIds"`
	StaffRoleIDs   []string `json:"staffRoleIds"`
	UsageRoleIDs   []string `json:"usageRoleIds"`

	TicketsEnabled     bool   `json:"ticketsEnabled"`
	TicketChannelID    string `json:"ticketChannelId"`
	TicketCategoryID   string `json:"ticketCategoryId"`
	TicketLogChannelID string `json:"ticketLogChannelId"`
	TicketMessage      string `json:"ticketMessage"`
	TicketMaxOpen      int    `json:"ticketMaxOpen"`

	TempVoiceEnabled bool   `json:"tempVoiceEnabled"`
	TempHubChannelID string `json:"tempHubChannelId"`
	TempNameTemplate string `json:"tempNameTemplate"`

	StatsEnabled          bool   `json:"statsEnabled"`
	StatsCategoryID       string `json:"statsCategoryId"`
	StatsMembersChannelID string `json:"statsMembersChannelId"`
	StatsOnlineChannelID  string `json:"statsOnlineChannelId"`
	StatsSiteChannelID    string `json:"statsSiteChannelId"`

	StatusEnabled       bool   `json:"statusEnabled"`
	StatusChannelID     string `json:"statusChannelId"`
	StatusMentionRoleID string `json:"statusMentionRoleId"`
}

// A message the bot posted for one of its panels, so it can edit it (or delete it from the old
// channel when the panel moves). The bot fills these in itself; the web page never changes them.
type communityPanel struct {
	ChannelID string `json:"channelId"`
	MessageID string `json:"messageId"`
}

type communityPanels struct {
	Verify communityPanel `json:"verify"`
	Roles  communityPanel `json:"roles"`
	Ticket communityPanel `json:"ticket"`
}

type communityChannel struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	ParentID string `json:"parentId"`
	Position int    `json:"position"`
}

type communityRole struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    int    `json:"color"`
	Position int    `json:"position"`
	// Managed roles (bots, boosts) and roles above the bot's own cannot be given by the bot.
	Assignable bool `json:"assignable"`
}

type communityGuild struct {
	GuildID        string             `json:"guildId"`
	GuildName      string             `json:"guildName"`
	MemberCount    int                `json:"memberCount"`
	Channels       []communityChannel `json:"channels"`
	Roles          []communityRole    `json:"roles"`
	AppliedVersion int64              `json:"appliedVersion"`
	Problems       []string           `json:"problems"`
	UpdatedAt      time.Time          `json:"updatedAt"`
}

type communityTicket struct {
	ID            int64      `json:"id"`
	GuildID       string     `json:"guildId"`
	ChannelID     string     `json:"channelId"`
	OpenerID      string     `json:"openerId"`
	OpenerName    string     `json:"openerName"`
	Subject       string     `json:"subject"`
	Status        string     `json:"status"`
	ClaimedByID   string     `json:"claimedById"`
	ClaimedByName string     `json:"claimedByName"`
	ClosedByID    string     `json:"closedById"`
	ClosedByName  string     `json:"closedByName"`
	CloseReason   string     `json:"closeReason"`
	MessageCount  int        `json:"messageCount"`
	CreatedAt     time.Time  `json:"createdAt"`
	ClosedAt      *time.Time `json:"closedAt"`
}

type communityIncident struct {
	ID        int64     `json:"id"`
	Target    string    `json:"target"`
	StartedAt time.Time `json:"startedAt"`
	EndedAt   time.Time `json:"endedAt"`
	Detail    string    `json:"detail"`
}

const (
	communityDefaultWelcome = "ยินดีต้อนรับ {user} สู่ **{server}** 🎉\nคุณเป็นสมาชิกคนที่ {count} ของเซิร์ฟเรา"
	communityDefaultVerify  = "กดปุ่ม **ยืนยันตัวตน** ด้านล่าง เพื่อเห็นห้องอื่น ๆ ในเซิร์ฟ"
	communityDefaultRoles   = "เลือกยศที่อยากได้จากเมนูด้านล่าง เลือกซ้ำเพื่อเอาออก"
	communityDefaultTicket  = "มีปัญหาหรืออยากติดต่อทีมงาน กดปุ่ม **เปิด Ticket** แล้วเล่าเรื่องสั้น ๆ\nจะได้ห้องส่วนตัวที่เห็นแค่คุณกับทีมงาน"
	communityDefaultTemp    = "ห้องของ {user}"
)

func defaultCommunitySettings() communitySettings {
	return communitySettings{
		WelcomeEnabled: true, WelcomeMessage: communityDefaultWelcome,
		VerifyEnabled: true, VerifyMessage: communityDefaultVerify,
		RolesMessage: communityDefaultRoles, SelfRoleIDs: []string{},
		ManagerRoleIDs: []string{}, StaffRoleIDs: []string{}, UsageRoleIDs: []string{},
		TicketsEnabled: true, TicketMessage: communityDefaultTicket, TicketMaxOpen: 1,
		TempVoiceEnabled: true, TempNameTemplate: communityDefaultTemp,
		StatsEnabled: true, StatusEnabled: true,
	}
}

// cleanCommunityIDs keeps the valid Discord ids in a list, once each.
func cleanCommunityIDs(ids []string, max int, label string) ([]string, error) {
	out := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		if !validDiscordSnowflake(id) {
			return nil, errors.New(label + "ไม่ถูกต้อง")
		}
		seen[id] = true
		out = append(out, id)
	}
	if len(out) > max {
		return nil, errors.New(label + " ใส่ได้ไม่เกิน " + strconv.Itoa(max) + " ยศ")
	}
	return out, nil
}

// validateCommunitySettings checks a whole settings object (from the web page, or the current
// one with a change from Discord merged in) and tidies it.
func validateCommunitySettings(in communitySettings) (communitySettings, error) {
	single := map[string]*string{
		"Server ID ": &in.GuildID, "ห้องต้อนรับ": &in.WelcomeChannelID, "ห้องยืนยันตัวตน": &in.VerifyChannelID,
		"ยศสมาชิก": &in.MemberRoleID, "ห้องเลือกยศ": &in.RolesChannelID, "ห้อง Ticket": &in.TicketChannelID,
		"หมวด Ticket": &in.TicketCategoryID, "ห้อง log Ticket": &in.TicketLogChannelID, "ห้องสร้างห้องเสียง": &in.TempHubChannelID,
		"หมวดสถิติ": &in.StatsCategoryID, "ห้องจำนวนสมาชิก": &in.StatsMembersChannelID, "ห้องคนออนไลน์": &in.StatsOnlineChannelID,
		"ห้องสถานะเว็บ": &in.StatsSiteChannelID, "ห้องแจ้งสถานะ": &in.StatusChannelID, "ยศที่แท็กตอนเว็บล่ม": &in.StatusMentionRoleID,
	}
	for label, value := range single {
		*value = strings.TrimSpace(*value)
		if *value != "" && !validDiscordSnowflake(*value) {
			return in, errors.New(label + "ไม่ถูกต้อง")
		}
	}
	var err error
	if in.SelfRoleIDs, err = cleanCommunityIDs(in.SelfRoleIDs, 25, "ยศในเมนูเลือกยศ"); err != nil {
		return in, err
	}
	if in.ManagerRoleIDs, err = cleanCommunityIDs(in.ManagerRoleIDs, 10, "ยศผู้ดูแลบอท"); err != nil {
		return in, err
	}
	if in.StaffRoleIDs, err = cleanCommunityIDs(in.StaffRoleIDs, 10, "ยศทีมงาน"); err != nil {
		return in, err
	}
	if in.UsageRoleIDs, err = cleanCommunityIDs(in.UsageRoleIDs, 10, "ยศที่ใช้บอทได้"); err != nil {
		return in, err
	}
	texts := []struct {
		value    *string
		fallback string
		max      int
		label    string
	}{
		{&in.WelcomeMessage, communityDefaultWelcome, 1500, "ข้อความต้อนรับ"},
		{&in.VerifyMessage, communityDefaultVerify, 1500, "ข้อความยืนยันตัวตน"},
		{&in.RolesMessage, communityDefaultRoles, 1500, "ข้อความเลือกยศ"},
		{&in.TicketMessage, communityDefaultTicket, 1500, "ข้อความ Ticket"},
		{&in.TempNameTemplate, communityDefaultTemp, 60, "ชื่อห้องเสียง"},
	}
	for _, text := range texts {
		*text.value = strings.TrimSpace(strings.ReplaceAll(*text.value, "\r\n", "\n"))
		if *text.value == "" {
			*text.value = text.fallback
		}
		if utf8.RuneCountInString(*text.value) > text.max {
			return in, errors.New(text.label + "ยาวได้ไม่เกิน " + strconv.Itoa(text.max) + " ตัว")
		}
	}
	if in.TicketMaxOpen < 1 || in.TicketMaxOpen > 5 {
		return in, errors.New("Ticket ที่เปิดค้างได้ต่อคนต้องอยู่ระหว่าง 1–5")
	}
	return in, nil
}

func (s *server) loadCommunitySettings(ctx context.Context) (communitySettings, communityPanels, int64, error) {
	settings := defaultCommunitySettings()
	var panels communityPanels
	var config, panelJSON []byte
	var version int64
	err := s.db.QueryRow(ctx, `SELECT config, panels, version FROM discord_community_settings WHERE singleton=TRUE`).Scan(&config, &panelJSON, &version)
	if err != nil {
		return settings, panels, 0, err
	}
	// Fields missing from the stored JSON keep their defaults.
	if err := json.Unmarshal(config, &settings); err != nil {
		return settings, panels, 0, err
	}
	_ = json.Unmarshal(panelJSON, &panels)
	if validated, err := validateCommunitySettings(settings); err == nil {
		settings = validated
	}
	return settings, panels, version, nil
}

func (s *server) saveCommunitySettings(ctx context.Context, settings communitySettings, userID any) error {
	config, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `
		UPDATE discord_community_settings SET config=$1::jsonb, version=$2, updated_by=$3, updated_at=NOW() WHERE singleton=TRUE
	`, string(config), time.Now().UnixMilli(), userID)
	return err
}

// communityActorMeta: the Discord member the bot is acting for, for the logs page.
func communityActorMeta(c *fiber.Ctx, meta map[string]any) map[string]any {
	if id := strings.TrimSpace(c.Get("X-Bot-Actor-Discord-Id")); validDiscordSnowflake(id) {
		meta["discordActor"] = id
	}
	if name := cleanText(c.Get("X-Bot-Actor-Username"), 64); name != "" {
		meta["actorName"] = name
	}
	return meta
}

const communityTicketColumns = `id, guild_id, COALESCE(channel_id, ''), opener_id, opener_name, subject, status, claimed_by_id, claimed_by_name,
	closed_by_id, closed_by_name, close_reason, message_count, created_at, closed_at`

func scanCommunityTicket(row pgx.Row) (communityTicket, error) {
	var t communityTicket
	err := row.Scan(&t.ID, &t.GuildID, &t.ChannelID, &t.OpenerID, &t.OpenerName, &t.Subject, &t.Status, &t.ClaimedByID, &t.ClaimedByName,
		&t.ClosedByID, &t.ClosedByName, &t.CloseReason, &t.MessageCount, &t.CreatedAt, &t.ClosedAt)
	return t, err
}

func (s *server) communityTickets(ctx context.Context, where string, limit int, args ...any) ([]communityTicket, error) {
	rows, err := s.db.Query(ctx, `SELECT `+communityTicketColumns+` FROM discord_community_tickets WHERE `+where+
		` ORDER BY id DESC LIMIT `+strconv.Itoa(limit), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tickets := []communityTicket{}
	for rows.Next() {
		ticket, err := scanCommunityTicket(rows)
		if err != nil {
			return nil, err
		}
		tickets = append(tickets, ticket)
	}
	return tickets, rows.Err()
}

func communityTicketID(c *fiber.Ctx) (int64, error) {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, fiber.NewError(fiber.StatusNotFound, "ไม่พบ Ticket นี้")
	}
	return id, nil
}

func (s *server) communityTicketAudit(c *fiber.Ctx, action string, ticket communityTicket, extra map[string]any) {
	meta := communityActorMeta(c, map[string]any{"name": "#" + strconv.FormatInt(ticket.ID, 10) + " " + ticket.Subject, "openerName": ticket.OpenerName})
	for key, value := range extra {
		meta[key] = value
	}
	s.audit(c, auditEvent{Category: "discord", Action: action, Target: "community_ticket", TargetID: strconv.FormatInt(ticket.ID, 10), Metadata: meta})
}

// Bot side

func (s *server) botCommunitySettings(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	settings, panels, version, err := s.loadCommunitySettings(c.Context())
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"settings": settings, "panels": panels, "version": version})
}

// botUpdateCommunitySettings saves a change made with /setup in Discord: only the fields sent
// change, the rest stay as they are.
func (s *server) botUpdateCommunitySettings(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	settings, _, _, err := s.loadCommunitySettings(c.Context())
	if err != nil {
		return err
	}
	var changed map[string]json.RawMessage
	if json.Unmarshal(c.Body(), &changed) != nil || len(changed) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	if json.Unmarshal(c.Body(), &settings) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	if settings, err = validateCommunitySettings(settings); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_settings"})
	}
	if err := s.saveCommunitySettings(c.Context(), settings, nil); err != nil {
		return err
	}
	fields := make([]string, 0, len(changed))
	for key := range changed {
		fields = append(fields, key)
	}
	s.audit(c, auditEvent{Category: "discord", Action: "discord.community.settings_updated", Target: "community_settings",
		Metadata: communityActorMeta(c, map[string]any{"source": "discord", "fields": strings.Join(fields, ", ")})})
	return s.botCommunitySettings(c)
}

// botCommunityPanels remembers the messages the bot posted for its panels.
func (s *server) botCommunityPanels(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input communityPanels
	if c.BodyParser(&input) != nil {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	for _, panel := range []communityPanel{input.Verify, input.Roles, input.Ticket} {
		for _, id := range []string{panel.ChannelID, panel.MessageID} {
			if id != "" && !validDiscordSnowflake(id) {
				return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
			}
		}
	}
	panels, _ := json.Marshal(input)
	if _, err := s.db.Exec(c.Context(), `UPDATE discord_community_settings SET panels=$1::jsonb WHERE singleton=TRUE`, string(panels)); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botCommunityGuild: the server's channels and roles (for the web page's pickers), and what the
// bot could not apply there.
func (s *server) botCommunityGuild(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input communityGuild
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.GuildID) || len(input.Channels) > 600 || len(input.Roles) > 300 || len(input.Problems) > 30 {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	for i := range input.Channels {
		input.Channels[i].Name = cleanText(input.Channels[i].Name, 100)
	}
	for i := range input.Roles {
		input.Roles[i].Name = cleanText(input.Roles[i].Name, 100)
	}
	problems := make([]string, 0, len(input.Problems))
	for _, p := range input.Problems {
		if p = cleanText(p, 200); p != "" {
			problems = append(problems, p)
		}
	}
	channels, _ := json.Marshal(input.Channels)
	roles, _ := json.Marshal(input.Roles)
	if _, err := s.db.Exec(c.Context(), `
		INSERT INTO discord_community_guilds (guild_id, guild_name, member_count, channels, roles, applied_version, problems, updated_at)
		VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW())
		ON CONFLICT (guild_id) DO UPDATE
		SET guild_name=EXCLUDED.guild_name, member_count=EXCLUDED.member_count, channels=EXCLUDED.channels, roles=EXCLUDED.roles,
		    applied_version=EXCLUDED.applied_version, problems=EXCLUDED.problems, updated_at=NOW()
	`, input.GuildID, cleanText(input.GuildName, 100), max(input.MemberCount, 0), string(channels), string(roles), input.AppliedVersion,
		strings.Join(problems, "\n")); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) botCommunityOpenTicket(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		GuildID    string `json:"guildId"`
		OpenerID   string `json:"openerId"`
		OpenerName string `json:"openerName"`
		Subject    string `json:"subject"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.GuildID) || !validDiscordSnowflake(input.OpenerID) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	subject := cleanText(strings.ReplaceAll(input.Subject, "\n", " "), 100)
	if subject == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ใส่หัวข้อก่อน", Code: "missing_subject"})
	}
	settings, _, _, err := s.loadCommunitySettings(c.Context())
	if err != nil {
		return err
	}
	// A ticket whose channel never got made does not count against the member.
	_, _ = s.db.Exec(c.Context(), `
		UPDATE discord_community_tickets SET status='closed', close_reason='สร้างห้องไม่สำเร็จ', closed_at=NOW()
		WHERE status='open' AND channel_id IS NULL AND created_at < NOW() - INTERVAL '10 minutes'
	`)
	var open int
	if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM discord_community_tickets WHERE status='open' AND opener_id=$1`, input.OpenerID).Scan(&open); err != nil {
		return err
	}
	if open >= settings.TicketMaxOpen {
		return c.Status(fiber.StatusConflict).JSON(apiError{
			Error: "คุณมี Ticket ที่ยังเปิดอยู่ " + strconv.Itoa(open) + " อัน ปิดอันเดิมก่อนแล้วค่อยเปิดใหม่", Code: "too_many_tickets"})
	}
	ticket, err := scanCommunityTicket(s.db.QueryRow(c.Context(), `
		INSERT INTO discord_community_tickets (guild_id, opener_id, opener_name, subject) VALUES ($1, $2, $3, $4)
		RETURNING `+communityTicketColumns, input.GuildID, input.OpenerID, cleanText(input.OpenerName, 64), subject))
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(ticket)
}

func (s *server) botCommunityTicketChannel(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	id, err := communityTicketID(c)
	if err != nil {
		return err
	}
	var input struct {
		ChannelID string `json:"channelId"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.ChannelID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	ticket, err := scanCommunityTicket(s.db.QueryRow(c.Context(), `
		UPDATE discord_community_tickets SET channel_id=$2 WHERE id=$1 AND status='open' RETURNING `+communityTicketColumns, id, input.ChannelID))
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "ไม่พบ Ticket นี้")
	}
	if err != nil {
		return err
	}
	s.communityTicketAudit(c, "discord.community.ticket_opened", ticket, nil)
	return c.JSON(ticket)
}

func (s *server) botCommunityClaimTicket(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	id, err := communityTicketID(c)
	if err != nil {
		return err
	}
	var input struct {
		StaffID   string `json:"staffId"`
		StaffName string `json:"staffName"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.StaffID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	ticket, err := scanCommunityTicket(s.db.QueryRow(c.Context(), `
		UPDATE discord_community_tickets SET claimed_by_id=$2, claimed_by_name=$3 WHERE id=$1 AND status='open' RETURNING `+communityTicketColumns,
		id, input.StaffID, cleanText(input.StaffName, 64)))
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "Ticket นี้ปิดไปแล้ว")
	}
	if err != nil {
		return err
	}
	s.communityTicketAudit(c, "discord.community.ticket_claimed", ticket, nil)
	return c.JSON(ticket)
}

func (s *server) botCommunityCloseTicket(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	id, err := communityTicketID(c)
	if err != nil {
		return err
	}
	var input struct {
		ClosedByID   string `json:"closedById"`
		ClosedByName string `json:"closedByName"`
		Reason       string `json:"reason"`
		MessageCount int    `json:"messageCount"`
	}
	if c.BodyParser(&input) != nil || (input.ClosedByID != "" && !validDiscordSnowflake(input.ClosedByID)) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	ticket, err := scanCommunityTicket(s.db.QueryRow(c.Context(), `
		UPDATE discord_community_tickets SET status='closed', closed_by_id=$2, closed_by_name=$3, close_reason=$4, message_count=$5, closed_at=NOW()
		WHERE id=$1 AND status='open' RETURNING `+communityTicketColumns,
		id, input.ClosedByID, cleanText(input.ClosedByName, 64), cleanText(input.Reason, 200), min(max(input.MessageCount, 0), 100000)))
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "Ticket นี้ปิดไปแล้ว")
	}
	if err != nil {
		return err
	}
	s.communityTicketAudit(c, "discord.community.ticket_closed", ticket, map[string]any{"reason": ticket.CloseReason, "messages": ticket.MessageCount})
	return c.JSON(ticket)
}

func (s *server) botCommunityOpenTickets(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	tickets, err := s.communityTickets(c.Context(), `status='open'`, 500)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"tickets": tickets})
}

func (s *server) botCommunityTempRooms(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `SELECT channel_id, guild_id, owner_id FROM discord_community_temp_rooms ORDER BY created_at`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type room struct {
		ChannelID string `json:"channelId"`
		GuildID   string `json:"guildId"`
		OwnerID   string `json:"ownerId"`
	}
	rooms := []room{}
	for rows.Next() {
		var r room
		if err := rows.Scan(&r.ChannelID, &r.GuildID, &r.OwnerID); err != nil {
			return err
		}
		rooms = append(rooms, r)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"rooms": rooms})
}

func (s *server) botCommunityAddTempRoom(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		ChannelID string `json:"channelId"`
		GuildID   string `json:"guildId"`
		OwnerID   string `json:"ownerId"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.ChannelID) || !validDiscordSnowflake(input.GuildID) || !validDiscordSnowflake(input.OwnerID) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	if _, err := s.db.Exec(c.Context(), `
		INSERT INTO discord_community_temp_rooms (channel_id, guild_id, owner_id) VALUES ($1, $2, $3)
		ON CONFLICT (channel_id) DO UPDATE SET owner_id=EXCLUDED.owner_id
	`, input.ChannelID, input.GuildID, input.OwnerID); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) botCommunityRemoveTempRoom(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	if _, err := s.db.Exec(c.Context(), `DELETE FROM discord_community_temp_rooms WHERE channel_id=$1`, c.Params("channelId")); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// botCommunityIncident records a time the website or the API was down (sent once it is back).
func (s *server) botCommunityIncident(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		Target    string    `json:"target"`
		StartedAt time.Time `json:"startedAt"`
		EndedAt   time.Time `json:"endedAt"`
		Detail    string    `json:"detail"`
	}
	if c.BodyParser(&input) != nil || (input.Target != "web" && input.Target != "api") || input.StartedAt.IsZero() || input.EndedAt.Before(input.StartedAt) {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	if _, err := s.db.Exec(c.Context(), `
		INSERT INTO discord_community_incidents (target, started_at, ended_at, detail) VALUES ($1, $2, $3, $4)
	`, input.Target, input.StartedAt, input.EndedAt, cleanText(input.Detail, 200)); err != nil {
		return err
	}
	_, _ = s.db.Exec(c.Context(), `DELETE FROM discord_community_incidents WHERE ended_at < NOW() - INTERVAL '180 days'`)
	s.audit(c, auditEvent{Category: "discord", Action: "discord.community.site_down", Target: "community_status", TargetID: input.Target,
		Outcome: "failure", Metadata: map[string]any{"name": map[string]string{"web": "เว็บไซต์", "api": "API"}[input.Target],
			"minutes": int(input.EndedAt.Sub(input.StartedAt).Minutes()), "detail": cleanText(input.Detail, 200)}})
	return c.SendStatus(fiber.StatusNoContent)
}

// botCommunityEvent logs something an admin did through the bot (made a channel, category or
// role, ran the setup).
func (s *server) botCommunityEvent(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		Kind    string   `json:"kind"`
		GuildID string   `json:"guildId"`
		Name    string   `json:"name"`
		ID      string   `json:"id"`
		Created []string `json:"created"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.GuildID) || len(input.Created) > 50 {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	action, target := "", "discord_channel"
	switch input.Kind {
	case "channel":
		action = "discord.community.channel_created"
	case "category":
		action = "discord.community.category_created"
	case "role":
		action, target = "discord.community.role_created", "discord_role"
	case "setup":
		action, target = "discord.community.setup_ran", "community_settings"
	default:
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	meta := communityActorMeta(c, map[string]any{"name": cleanText(input.Name, 100)})
	if len(input.Created) > 0 {
		created := make([]string, 0, len(input.Created))
		for _, name := range input.Created {
			created = append(created, cleanText(name, 100))
		}
		meta["created"] = strings.Join(created, ", ")
	}
	targetID := input.ID
	if !validDiscordSnowflake(targetID) {
		targetID = input.GuildID
	}
	s.audit(c, auditEvent{Category: "discord", Action: action, Target: target, TargetID: targetID, Metadata: meta})
	return c.SendStatus(fiber.StatusNoContent)
}

// Web admin (superadmin)

func (s *server) adminDiscordCommunity(c *fiber.Ctx) error {
	settings, _, version, err := s.loadCommunitySettings(c.Context())
	if err != nil {
		return err
	}
	// The server the settings point at, or else the one the bot reported last.
	var guild *communityGuild
	var g communityGuild
	var channels, roles []byte
	var problems string
	err = s.db.QueryRow(c.Context(), `
		SELECT guild_id, guild_name, member_count, channels, roles, applied_version, problems, updated_at FROM discord_community_guilds
		ORDER BY (guild_id=$1) DESC, updated_at DESC LIMIT 1
	`, settings.GuildID).Scan(&g.GuildID, &g.GuildName, &g.MemberCount, &channels, &roles, &g.AppliedVersion, &problems, &g.UpdatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil {
		_ = json.Unmarshal(channels, &g.Channels)
		_ = json.Unmarshal(roles, &g.Roles)
		g.Problems = splitLines(problems)
		guild = &g
	}
	tickets, err := s.communityTickets(c.Context(), `TRUE`, 30)
	if err != nil {
		return err
	}
	var openTickets int
	if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM discord_community_tickets WHERE status='open'`).Scan(&openTickets); err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `SELECT id, target, started_at, ended_at, detail FROM discord_community_incidents ORDER BY started_at DESC LIMIT 10`)
	if err != nil {
		return err
	}
	defer rows.Close()
	incidents := []communityIncident{}
	for rows.Next() {
		var item communityIncident
		if err := rows.Scan(&item.ID, &item.Target, &item.StartedAt, &item.EndedAt, &item.Detail); err != nil {
			return err
		}
		incidents = append(incidents, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"settings": settings, "version": version, "guild": guild, "tickets": tickets, "openTickets": openTickets, "incidents": incidents})
}

func (s *server) updateAdminDiscordCommunity(c *fiber.Ctx) error {
	input := defaultCommunitySettings()
	var seen struct {
		Version int64 `json:"version"`
	}
	if c.BodyParser(&input) != nil || json.Unmarshal(c.Body(), &seen) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	// Someone may have changed it with /setup in Discord while this page was open.
	_, _, version, err := s.loadCommunitySettings(c.Context())
	if err != nil {
		return err
	}
	if seen.Version != 0 && seen.Version != version {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "มีคนแก้การตั้งค่านี้ใน Discord ระหว่างนี้ โหลดใหม่แล้วแก้อีกครั้ง", Code: "settings_changed"})
	}
	settings, err := validateCommunitySettings(input)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_settings"})
	}
	actor := current(c)
	if err := s.saveCommunitySettings(c.Context(), settings, actor.ID); err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "discord", Action: "discord.community.settings_updated", Target: "community_settings",
		Metadata: map[string]any{"source": "web", "guildId": settings.GuildID, "welcome": settings.WelcomeEnabled, "verify": settings.VerifyEnabled,
			"tickets": settings.TicketsEnabled, "tempVoice": settings.TempVoiceEnabled, "stats": settings.StatsEnabled, "status": settings.StatusEnabled}})
	return s.adminDiscordCommunity(c)
}
