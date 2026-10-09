package main

import (
	"regexp"
	"sort"
	"strings"

	"github.com/gofiber/fiber/v2"
)

var discordAccessSnowflakePattern = regexp.MustCompile(`^[0-9]{17,20}$`)

type discordBotAccessState struct {
	BotKey        string                               `json:"botKey"`
	AccessMode    string                               `json:"accessMode"`
	Visibility    string                               `json:"visibility"`
	Users         []string                             `json:"users"`
	Roles         []string                             `json:"roles"`
	CommandAccess map[string]discordBotCommandSubjects `json:"commandAccess"`
}

type discordBotCommandSubjects struct {
	Users []string `json:"users"`
	Roles []string `json:"roles"`
}

var botCommandScopes = map[string]bool{
	"db": true, "code": true, "setup-panel": true, "bot-panel": true,
	"admin-map.list": true, "admin-map.set": true, "admin-map.unbind": true,
	"bot.status": true, "bot.mode": true, "bot.users": true, "bot.roles": true, "bot.permissions": true, "bot.visibility": true,
	"crowdsec.bans": true, "crowdsec.ban": true, "crowdsec.unban": true,
	"lockdown.status": true, "lockdown.manage": true, "lockdown.access": true,
}

func (s *server) loadDiscordBotAccess(c *fiber.Ctx, botKey string) (discordBotAccessState, error) {
	state := discordBotAccessState{BotKey: botKey, AccessMode: "everyone", Visibility: "online", Users: []string{}, Roles: []string{}}
	err := s.db.QueryRow(c.Context(), `
		SELECT access_mode, visibility FROM discord_bot_access_settings WHERE bot_key=$1
	`, botKey).Scan(&state.AccessMode, &state.Visibility)
	if err != nil {
		return state, err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT subject_type, discord_id FROM discord_bot_access_rules WHERE bot_key=$1
	`, botKey)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var subjectType, id string
		if err := rows.Scan(&subjectType, &id); err != nil {
			return state, err
		}
		if subjectType == "user" {
			state.Users = append(state.Users, id)
		} else if subjectType == "role" {
			state.Roles = append(state.Roles, id)
		}
	}
	sort.Strings(state.Users)
	sort.Strings(state.Roles)
	if err := rows.Err(); err != nil {
		return state, err
	}
	rows.Close()
	state.CommandAccess = map[string]discordBotCommandSubjects{}
	scoped, err := s.db.Query(c.Context(), `SELECT command_scope, subject_type, discord_id FROM discord_bot_command_access_rules WHERE bot_key=$1 ORDER BY discord_id`, botKey)
	if err != nil {
		return state, err
	}
	defer scoped.Close()
	for scoped.Next() {
		var scope, subject, id string
		if err := scoped.Scan(&scope, &subject, &id); err != nil {
			return state, err
		}
		rule, ok := state.CommandAccess[scope]
		if !ok {
			rule = discordBotCommandSubjects{Users: []string{}, Roles: []string{}}
		}
		if subject == "user" {
			rule.Users = append(rule.Users, id)
		} else {
			rule.Roles = append(rule.Roles, id)
		}
		state.CommandAccess[scope] = rule
	}
	return state, scoped.Err()
}

func (s *server) botDiscordAccess(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	key, _, ok := parseDiscordBotKey(c.Params("botKey"))
	if !ok {
		return c.Status(404).JSON(apiError{Error: "ไม่พบบอทนี้", Code: "unknown_bot"})
	}
	state, err := s.loadDiscordBotAccess(c, key)
	if err != nil {
		return err
	}
	return c.JSON(state)
}

func (s *server) updateBotDiscordAccess(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	if !discordAccessSnowflakePattern.MatchString(c.Get("X-Bot-Actor-Discord-Id")) {
		return c.Status(400).JSON(apiError{Error: "ไม่พบผู้ดำเนินการ", Code: "invalid_actor"})
	}
	key, _, ok := parseDiscordBotKey(c.Params("botKey"))
	if !ok {
		return c.Status(404).JSON(apiError{Error: "ไม่พบบอทนี้", Code: "unknown_bot"})
	}
	var input struct {
		Action      string `json:"action"`
		Value       string `json:"value"`
		SubjectType string `json:"subjectType"`
		DiscordID   string `json:"discordId"`
		Scope       string `json:"scope"`
	}
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	input.Value = strings.ToLower(strings.TrimSpace(input.Value))
	input.SubjectType = strings.ToLower(strings.TrimSpace(input.SubjectType))
	input.DiscordID = strings.TrimSpace(input.DiscordID)
	input.Scope = strings.TrimSpace(input.Scope)
	if input.Scope != "" {
		if !botCommandScopes[input.Scope] || (input.Action != "allow" && input.Action != "remove") || (input.SubjectType != "user" && input.SubjectType != "role") || !discordAccessSnowflakePattern.MatchString(input.DiscordID) {
			return c.Status(400).JSON(apiError{Error: "สิทธิ์เมนูไม่ถูกต้อง", Code: "invalid_scope"})
		}
		var err error
		if input.Action == "allow" {
			if !s.hasDiscordBotScope(c, "bot.permissions") {
				return c.Status(403).JSON(apiError{Error: "คุณไม่มีสิทธิ์ใช้คำสั่งนี้", Code: "bot_scope_forbidden"})
			}
			_, err = s.db.Exec(c.Context(), `INSERT INTO discord_bot_command_access_rules (bot_key,command_scope,subject_type,discord_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, key, input.Scope, input.SubjectType, input.DiscordID)
		} else {
			if !s.hasDiscordBotScope(c, "bot.permissions") {
				return c.Status(403).JSON(apiError{Error: "คุณไม่มีสิทธิ์ใช้คำสั่งนี้", Code: "bot_scope_forbidden"})
			}
			_, err = s.db.Exec(c.Context(), `DELETE FROM discord_bot_command_access_rules WHERE bot_key=$1 AND command_scope=$2 AND subject_type=$3 AND discord_id=$4`, key, input.Scope, input.SubjectType, input.DiscordID)
		}
		if err != nil {
			return err
		}
		state, err := s.loadDiscordBotAccess(c, key)
		if err != nil {
			return err
		}
		return c.JSON(state)
	}

	switch input.Action {
	case "set_mode":
		if input.Value != "everyone" && input.Value != "allowlist" {
			return c.Status(400).JSON(apiError{Error: "โหมดไม่ถูกต้อง", Code: "invalid_mode"})
		}
		if !s.hasDiscordBotScope(c, "bot.mode") {
			return c.Status(403).JSON(apiError{Error: "คุณไม่มีสิทธิ์ใช้คำสั่งนี้", Code: "bot_scope_forbidden"})
		}
		_, err := s.db.Exec(c.Context(), `UPDATE discord_bot_access_settings SET access_mode=$2, updated_at=NOW() WHERE bot_key=$1`, key, input.Value)
		if err != nil {
			return err
		}
	case "set_visibility":
		if input.Value != "online" && input.Value != "hidden" {
			return c.Status(400).JSON(apiError{Error: "สถานะไม่ถูกต้อง", Code: "invalid_visibility"})
		}
		if !s.hasDiscordBotScope(c, "bot.visibility") {
			return c.Status(403).JSON(apiError{Error: "คุณไม่มีสิทธิ์ใช้คำสั่งนี้", Code: "bot_scope_forbidden"})
		}
		_, err := s.db.Exec(c.Context(), `UPDATE discord_bot_access_settings SET visibility=$2, updated_at=NOW() WHERE bot_key=$1`, key, input.Value)
		if err != nil {
			return err
		}
	case "allow", "remove":
		if (input.SubjectType != "user" && input.SubjectType != "role") || !discordAccessSnowflakePattern.MatchString(input.DiscordID) {
			return c.Status(400).JSON(apiError{Error: "ผู้ใช้หรือยศไม่ถูกต้อง", Code: "invalid_subject"})
		}
		scope := "bot.users"
		if input.SubjectType == "role" {
			scope = "bot.roles"
		}
		if !s.hasDiscordBotScope(c, scope) {
			return c.Status(403).JSON(apiError{Error: "คุณไม่มีสิทธิ์ใช้คำสั่งนี้", Code: "bot_scope_forbidden"})
		}
		if input.Action == "allow" {
			_, err := s.db.Exec(c.Context(), `INSERT INTO discord_bot_access_rules (bot_key, subject_type, discord_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, key, input.SubjectType, input.DiscordID)
			if err != nil {
				return err
			}
		} else {
			_, err := s.db.Exec(c.Context(), `DELETE FROM discord_bot_access_rules WHERE bot_key=$1 AND subject_type=$2 AND discord_id=$3`, key, input.SubjectType, input.DiscordID)
			if err != nil {
				return err
			}
		}
	default:
		return c.Status(400).JSON(apiError{Error: "คำสั่งไม่ถูกต้อง", Code: "invalid_action"})
	}
	state, err := s.loadDiscordBotAccess(c, key)
	if err != nil {
		return err
	}
	return c.JSON(state)
}
