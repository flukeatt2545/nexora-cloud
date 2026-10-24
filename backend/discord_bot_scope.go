package main

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

// Actor and roles are asserted only by the authenticated internal bot, never by public clients.
// Admin status comes from DISCORD_ADMIN_IDS or the access-rule table, never from a request
// header: a header claiming admin would hand every scope to whoever holds the bot secret.
func (s *server) hasDiscordBotScope(c *fiber.Ctx, scope string) bool {
	actor := strings.TrimSpace(c.Get("X-Bot-Actor-Discord-Id"))
	if !validDiscordSnowflake(actor) || !botCommandScopes[scope] {
		return false
	}
	if s.isDiscordStudentAdmin(actor) {
		return true
	}
	if s.db == nil {
		return false
	}
	roles := []string{}
	raw := c.Get("X-Bot-Actor-Discord-Roles")
	if len(raw) > 2500 {
		return false
	}
	for _, role := range strings.Split(raw, ",") {
		if role == "" {
			continue
		}
		if !validDiscordSnowflake(role) {
			return false
		}
		roles = append(roles, role)
	}
	var allowed bool
	err := s.db.QueryRow(c.Context(), `SELECT EXISTS (SELECT 1 FROM discord_bot_command_access_rules WHERE bot_key='nexora' AND command_scope=$1 AND ((subject_type='user' AND discord_id=$2) OR (subject_type='role' AND discord_id=ANY($3::text[]))))`, scope, actor, roles).Scan(&allowed)
	return err == nil && allowed
}

func (s *server) requireBotScope(c *fiber.Ctx, scope string) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	if !s.hasDiscordBotScope(c, scope) {
		return fiber.NewError(fiber.StatusForbidden, "คุณไม่มีสิทธิ์ใช้คำสั่งนี้")
	}
	return nil
}
