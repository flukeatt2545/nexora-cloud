package main

import (
	"errors"
	"log"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

func safeUserResponse(user *currentUser) fiber.Map {
	return fiber.Map{
		"username":        user.Username,
		"displayName":     user.DisplayName,
		"email":           user.Email,
		"avatarUrl":       user.AvatarURL,
		"role":            user.Role,
		"passwordEnabled": user.PasswordEnabled,
	}
}

func (s *server) getProfile(c *fiber.Ctx) error {
	user := current(c)
	return c.JSON(fiber.Map{"user": safeUserResponse(user)})
}

func (s *server) updateProfile(c *fiber.Ctx) error {
	user := current(c)
	var body struct {
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	body.DisplayName = cleanText(body.DisplayName, 80)
	body.Email = strings.ToLower(cleanText(body.Email, 254))
	if body.Email != "" && (!strings.Contains(body.Email, "@") || strings.ContainsAny(body.Email, " \t\r\n")) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปแบบอีเมลไม่ถูกต้อง", Code: "invalid_email"})
	}
	_, err := s.db.Exec(c.Context(), `
		UPDATE users SET display_name = $1, email = NULLIF($2, ''), updated_at = NOW() WHERE id = $3
	`, body.DisplayName, body.Email, user.ID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "อีเมลนี้ถูกใช้งานแล้ว", Code: "email_exists"})
		}
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	user.DisplayName, user.Email = body.DisplayName, body.Email
	s.audit(c, auditEvent{Actor: user, Category: "profile", Action: "profile.updated", Target: "user", TargetID: strconv.FormatInt(user.ID, 10)})
	return c.JSON(fiber.Map{"user": safeUserResponse(user)})
}

func (s *server) changePassword(c *fiber.Ctx) error {
	user := current(c)
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	if utf8.RuneCountInString(body.NewPassword) < 8 || utf8.RuneCountInString(body.NewPassword) > 128 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสผ่านใหม่ต้องมี 8–128 ตัวอักษร", Code: "invalid_password"})
	}
	if message := validatePasswordASCII(body.NewPassword); message != "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: message, Code: "invalid_password"})
	}
	var currentHash string
	var passwordEnabled bool
	if err := s.db.QueryRow(c.Context(), `SELECT password_hash, password_enabled FROM users WHERE id = $1`, user.ID).Scan(&currentHash, &passwordEnabled); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if passwordEnabled && !s.verifyPassword(body.CurrentPassword, currentHash) {
		s.audit(c, auditEvent{Actor: user, Category: "security", Action: "password.changed", Target: "user", TargetID: strconv.FormatInt(user.ID, 10), Outcome: "failure"})
		return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "รหัสผ่านปัจจุบันไม่ถูกต้อง", Code: "invalid_password"})
	}
	hash, err := s.hashPassword(body.NewPassword)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE users SET password_hash = $1, password_enabled = TRUE, updated_at = NOW() WHERE id = $2`, hash, user.ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	user.PasswordEnabled = true
	s.revokeOtherUserSessions(c, user.ID, user.SessionID)
	s.audit(c, auditEvent{Actor: user, Category: "security", Action: "password.changed", Target: "user", TargetID: strconv.FormatInt(user.ID, 10)})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) revokeOtherUserSessions(c *fiber.Ctx, userID, currentSessionID int64) {
	rows, err := s.db.Query(c.Context(), `
		UPDATE user_sessions SET revoked_at = NOW()
		WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
		RETURNING token_hash
	`, userID, currentSessionID)
	if err != nil {
		log.Printf("revoke sessions after password change: %v", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var hash string
		if rows.Scan(&hash) == nil {
			s.redis.Del(c.Context(), "session:"+hash)
		}
	}
}

func (s *server) listOwnSessions(c *fiber.Ctx) error {
	user := current(c)
	rows, err := s.db.Query(c.Context(), `
		SELECT id, ip_address, user_agent, created_at, last_seen_at, expires_at, id = $2
		FROM user_sessions
		WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
		ORDER BY last_seen_at DESC
	`, user.ID, user.SessionID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id int64
		var ip, agent string
		var created, seen, expires time.Time
		var isCurrent bool
		if rows.Scan(&id, &ip, &agent, &created, &seen, &expires, &isCurrent) == nil {
			items = append(items, fiber.Map{"id": id, "ipAddress": ip, "userAgent": agent, "createdAt": created, "lastSeenAt": seen, "expiresAt": expires, "current": isCurrent})
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) revokeOwnSession(c *fiber.Ctx) error {
	user := current(c)
	sessionID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Session ไม่ถูกต้อง"})
	}
	var tokenHashValue string
	err = s.db.QueryRow(c.Context(), `
		UPDATE user_sessions SET revoked_at = NOW()
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
		RETURNING token_hash
	`, sessionID, user.ID).Scan(&tokenHashValue)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบ Session"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.redis.Del(c.Context(), "session:"+tokenHashValue)
	if sessionID == user.SessionID {
		s.clearSessionCookie(c)
	}
	s.audit(c, auditEvent{Actor: user, Category: "security", Action: "session.revoked", Target: "session", TargetID: strconv.FormatInt(sessionID, 10)})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) ownActivity(c *fiber.Ctx) error {
	user := current(c)
	limit := parseLimit(c, 30, 100)
	// page=<n> (from 1) is used by the numbered pager; before=<id> still pages back from an
	// entry for older callers. Without either, the newest entries come first.
	before := int64(c.QueryInt("before", 0))
	if before < 0 {
		before = 0
	}
	var total int64
	if err := s.db.QueryRow(c.Context(), `SELECT count(*) FROM audit_logs WHERE actor_user_id = $1`, user.ID).Scan(&total); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	page := c.QueryInt("page", 0)
	offset := 0
	if page > 0 {
		before = 0
		offset = (page - 1) * limit
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT id, category, action, target_type, target_id, outcome, ip_address, metadata, created_at
		FROM audit_logs WHERE actor_user_id = $1 AND ($3::bigint = 0 OR id < $3::bigint)
		ORDER BY id DESC LIMIT $2 OFFSET $4
	`, user.ID, limit, before, offset)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id int64
		var category, action, target, targetID, outcome, ip string
		var metadata []byte
		var created time.Time
		if rows.Scan(&id, &category, &action, &target, &targetID, &outcome, &ip, &metadata, &created) == nil {
			items = append(items, fiber.Map{"id": id, "category": category, "action": action, "targetType": target, "targetId": targetID, "outcome": outcome, "ipAddress": ip, "metadata": string(metadata), "createdAt": created})
		}
	}
	return c.JSON(fiber.Map{"items": items, "total": total})
}

func (s *server) socialAccounts(c *fiber.Ctx) error {
	user := current(c)
	if err := s.finalizeOAuthDisconnects(c.Context()); err != nil {
		log.Printf("finalizeOAuthDisconnects error: %v", err)
	}
	items := []fiber.Map{}
	rows, err := s.db.Query(c.Context(), `
		SELECT provider, COALESCE(provider_email, ''), created_at, disconnect_requested_at, disconnect_scheduled_for
		FROM oauth_accounts WHERE user_id = $1 ORDER BY provider
	`, user.ID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var provider, email string
			var created time.Time
			var disconnectRequestedAt, disconnectScheduledFor *time.Time
			if rows.Scan(&provider, &email, &created, &disconnectRequestedAt, &disconnectScheduledFor) == nil {
				items = append(items, fiber.Map{
					"provider": provider, "email": email, "connectedAt": created,
					"disconnectRequestedAt": disconnectRequestedAt, "disconnectScheduledFor": disconnectScheduledFor,
				})
			}
		}
	} else {
		log.Printf("socialAccounts query error: %v", err)
	}
	policy, err := loadSocialConnectPolicy(c.Context(), s.db, user.ID, time.Now())
	if err != nil {
		log.Printf("loadSocialConnectPolicy error: %v", err)
		policy = socialConnectPolicy{CanConnect: true, RemainingToday: 3}
	}
	if !user.PasswordEnabled {
		policy.CanConnect = false
		policy.Code = "password_setup_required"
		policy.AvailableAt = nil
	}
	return c.JSON(fiber.Map{"items": items, "policy": fiber.Map{
		"canConnect": policy.CanConnect, "remainingToday": policy.RemainingToday,
		"availableAt": policy.AvailableAt, "code": policy.Code,
	}})
}

func (s *server) disconnectSocial(c *fiber.Ctx) error {
	user := current(c)
	provider := strings.ToLower(c.Params("provider"))
	if !validOAuthProvider(provider) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่รองรับบริการนี้", Code: "invalid_provider"})
	}
	if !user.PasswordEnabled {
		return c.Status(fiber.StatusPreconditionRequired).JSON(apiError{Error: "กรุณาตั้งรหัสผ่านก่อนใช้งาน", Code: "password_setup_required"})
	}
	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())

	var scheduledFor time.Time
	err = tx.QueryRow(c.Context(), `
		UPDATE oauth_accounts
		SET disconnect_requested_at=NOW(),
		    disconnect_scheduled_for=$3,
		    updated_at=NOW()
		WHERE user_id=$1 AND provider=$2 AND disconnect_scheduled_for IS NULL
		RETURNING disconnect_scheduled_for
	`, user.ID, provider, time.Now().Add(socialDisconnectDelay)).Scan(&scheduledFor)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(c.Context(), `
			SELECT disconnect_scheduled_for FROM oauth_accounts
			WHERE user_id=$1 AND provider=$2
		`, user.ID, provider).Scan(&scheduledFor)
		if errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ยังไม่ได้เชื่อมบัญชีนี้", Code: "social_not_connected"})
		}
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"scheduledFor": scheduledFor})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := tx.Exec(c.Context(), `INSERT INTO oauth_account_events (user_id, provider, action) VALUES ($1,$2,'disconnect_requested')`, user.ID, provider); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: user, Category: "security", Action: "social.disconnect_requested", Target: "oauth", TargetID: provider, Metadata: map[string]any{"scheduledFor": scheduledFor}})
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"scheduledFor": scheduledFor})
}

func (s *server) cancelSocialDisconnect(c *fiber.Ctx) error {
	user := current(c)
	provider := strings.ToLower(c.Params("provider"))
	if !validOAuthProvider(provider) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่รองรับบริการนี้", Code: "invalid_provider"})
	}
	result, err := s.db.Exec(c.Context(), `
		UPDATE oauth_accounts
		SET disconnect_requested_at=NULL, disconnect_scheduled_for=NULL, updated_at=NOW()
		WHERE user_id=$1 AND provider=$2 AND disconnect_scheduled_for IS NOT NULL
	`, user.ID, provider)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if result.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบคำขอยกเลิกการเชื่อม", Code: "disconnect_request_not_found"})
	}
	if _, err := s.db.Exec(c.Context(), `INSERT INTO oauth_account_events (user_id, provider, action) VALUES ($1,$2,'disconnect_cancelled')`, user.ID, provider); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: user, Category: "security", Action: "social.disconnect_cancelled", Target: "oauth", TargetID: provider})
	return c.SendStatus(fiber.StatusNoContent)
}
