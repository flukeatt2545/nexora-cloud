package main

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Emergency keys: a way in for a superadmin when password and social sign-in are off or broken.
// A key is 256 random bits, so hashing it once is enough and guessing is not a concern; the secret
// page that takes it (Ctrl+Z twice) only hides the door, the key is what opens it.

const (
	adminKeyPrefix    = "nxk_"
	adminKeyMaxActive = 5
)

var adminKeyPattern = regexp.MustCompile(`^nxk_[A-Za-z0-9_-]{43}$`)

type adminKeyInput struct {
	Label         string `json:"label"`
	ExpiresInDays int    `json:"expiresInDays"`
}

func validAdminKeyExpiry(days int) bool {
	return days == 0 || days == 30 || days == 90 || days == 365
}

func newAdminKey() string {
	return adminKeyPrefix + randomURLToken(32)
}

// createAdminKey stores a new key for this superadmin and returns it; it is never readable again.
func (s *server) createAdminKey(ctx context.Context, userID int64, input adminKeyInput, via string) (string, int64, *apiError) {
	label := cleanText(input.Label, 60)
	if label == "" {
		return "", 0, &apiError{Error: "ตั้งชื่อคีย์ก่อน เช่น โน้ตบุ๊กที่บ้าน", Code: "label_required"}
	}
	if !validAdminKeyExpiry(input.ExpiresInDays) {
		return "", 0, &apiError{Error: "อายุคีย์ไม่ถูกต้อง", Code: "invalid_expiry"}
	}
	active, err := s.activeAdminKeys(ctx, userID)
	if err != nil {
		return "", 0, &apiError{Error: "ตอนนี้สร้างคีย์ไม่ได้ ลองใหม่อีกครั้ง"}
	}
	if active >= adminKeyMaxActive {
		return "", 0, &apiError{Error: "มีคีย์ครบ 5 อันแล้ว ยกเลิกอันที่ไม่ใช้ก่อน", Code: "too_many_keys"}
	}
	var expiresAt *time.Time
	if input.ExpiresInDays > 0 {
		at := time.Now().AddDate(0, 0, input.ExpiresInDays)
		expiresAt = &at
	}
	key := newAdminKey()
	var id int64
	if err := s.db.QueryRow(ctx, `
		INSERT INTO admin_emergency_keys (user_id, label, key_hash, key_hint, created_via, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
	`, userID, label, tokenHash(key), key[len(key)-4:], via, expiresAt).Scan(&id); err != nil {
		return "", 0, &apiError{Error: "ตอนนี้สร้างคีย์ไม่ได้ ลองใหม่อีกครั้ง"}
	}
	return key, id, nil
}

// activeAdminKeys counts the keys that would sign this user in right now.
func (s *server) activeAdminKeys(ctx context.Context, userID int64) (int, error) {
	var count int
	err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM admin_emergency_keys
		WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
	`, userID).Scan(&count)
	return count, err
}

func (s *server) adminListKeys(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
		SELECT k.id, k.label, k.key_hint, k.created_via, k.expires_at, k.last_used_at, k.last_used_ip, k.revoked_at, k.created_at
		FROM admin_emergency_keys k
		WHERE k.user_id = $1
		ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC
		LIMIT 50
	`, current(c).ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var id int64
		var label, hint, via, lastIP string
		var expiresAt, lastUsedAt, revokedAt *time.Time
		var createdAt time.Time
		if rows.Scan(&id, &label, &hint, &via, &expiresAt, &lastUsedAt, &lastIP, &revokedAt, &createdAt) != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		items = append(items, fiber.Map{
			"id": id, "label": label, "hint": hint, "createdVia": via, "expiresAt": expiresAt,
			"lastUsedAt": lastUsedAt, "lastUsedIp": lastIP, "revokedAt": revokedAt, "createdAt": createdAt,
		})
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) adminCreateKey(c *fiber.Ctx) error {
	var input adminKeyInput
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	actor := current(c)
	key, id, failure := s.createAdminKey(c.Context(), actor.ID, input, "web")
	if failure != nil {
		return c.Status(fiber.StatusBadRequest).JSON(failure)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "security", Action: "admin_key.created", Target: "admin_key", TargetID: strconv.FormatInt(id, 10),
		Metadata: map[string]any{"via": "web", "label": cleanText(input.Label, 60)}})
	return c.JSON(fiber.Map{"key": key, "id": id})
}

func (s *server) adminRevokeKey(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	actor := current(c)
	// With every sign-in off, this user's last working key is the only way back in.
	settings, err := s.loadSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !hasSignInMethod(settings) {
		var others int
		if err := s.db.QueryRow(c.Context(), `
			SELECT COUNT(*) FROM admin_emergency_keys
			WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
		`, actor.ID, id).Scan(&others); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if others == 0 {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ตอนนี้ปิดการเข้าสู่ระบบทุกทางอยู่ นี่คือคีย์สุดท้าย เปิดทางอื่นหรือสร้างคีย์ใหม่ก่อน", Code: "last_key"})
		}
	}
	tag, err := s.db.Exec(c.Context(), `
		UPDATE admin_emergency_keys SET revoked_at = NOW()
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
	`, id, actor.ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบคีย์นี้"})
	}
	s.audit(c, auditEvent{Actor: actor, Category: "security", Action: "admin_key.revoked", Target: "admin_key", TargetID: strconv.FormatInt(id, 10)})
	return c.SendStatus(fiber.StatusNoContent)
}

// emergencyLogin signs a superadmin in with a key. It works whatever the sign-in settings say, which
// is the point of it. Every failure answers the same way so nothing can be learned from the reply.
func (s *server) emergencyLogin(c *fiber.Ctx) error {
	denied := func(reason string) error {
		s.audit(c, auditEvent{Category: "security", Action: "admin_key.login", Outcome: "failure", Target: "admin_key", Metadata: map[string]any{"reason": reason}})
		return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "คีย์ใช้ไม่ได้", Code: "invalid_key"})
	}
	var body struct {
		Key string `json:"key"`
	}
	if c.BodyParser(&body) != nil {
		return denied("bad_body")
	}
	key := strings.TrimSpace(body.Key)
	if !adminKeyPattern.MatchString(key) {
		return denied("bad_format")
	}
	var keyID int64
	var user currentUser
	err := s.db.QueryRow(c.Context(), `
		SELECT k.id, u.id, u.identifier, u.display_name, COALESCE(u.email, ''), COALESCE(u.avatar_url, ''), u.role, u.status, u.password_enabled, u.points
		FROM admin_emergency_keys k
		JOIN users u ON u.id = k.user_id
		WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > NOW())
		  AND u.role = 'superadmin' AND u.status = 'active'
	`, tokenHash(key)).Scan(&keyID, &user.ID, &user.Username, &user.DisplayName, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.PasswordEnabled, &user.Points)
	if errors.Is(err, pgx.ErrNoRows) {
		return denied("unknown_key")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	user.Permissions = permissionsForRole(user.Role)
	if err := s.createSession(c, &user); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.db.Exec(c.Context(), `UPDATE admin_emergency_keys SET last_used_at = NOW(), last_used_ip = $2 WHERE id = $1`, keyID, extractRealIP(c))
	s.db.Exec(c.Context(), `UPDATE users SET last_login_at = NOW() WHERE id = $1`, user.ID)
	s.audit(c, auditEvent{Actor: &user, Category: "security", Action: "admin_key.login", Target: "admin_key", TargetID: strconv.FormatInt(keyID, 10)})
	return c.JSON(fiber.Map{"user": user})
}

// botCreateAdminKey makes a key from Discord. The member must be linked to an active superadmin
// account on the site; holding a Discord role is not enough.
func (s *server) botCreateAdminKey(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	discordID := c.Get("X-Bot-Actor-Discord-Id")
	if !validDiscordSnowflake(discordID) {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ใช้ได้เฉพาะแอดมินสูงสุดที่ผูก Discord กับเว็บไว้", Code: "not_allowed"})
	}
	var user currentUser
	err := s.db.QueryRow(c.Context(), `
		SELECT u.id, u.identifier, u.role FROM oauth_accounts a
		JOIN users u ON u.id = a.user_id
		WHERE a.provider = 'discord' AND a.provider_user_id = $1 AND u.role = 'superadmin' AND u.status = 'active'
	`, discordID).Scan(&user.ID, &user.Username, &user.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		s.audit(c, auditEvent{Category: "security", Action: "admin_key.created", Outcome: "failure", Target: "admin_key",
			Metadata: map[string]any{"via": "discord", "discordActor": discordID, "reason": "not_superadmin"}})
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ใช้ได้เฉพาะแอดมินสูงสุดที่ผูก Discord กับเว็บไว้", Code: "not_allowed"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	var input adminKeyInput
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	key, id, failure := s.createAdminKey(c.Context(), user.ID, input, "discord")
	if failure != nil {
		return c.Status(fiber.StatusBadRequest).JSON(failure)
	}
	s.audit(c, auditEvent{Actor: &user, Category: "security", Action: "admin_key.created", Target: "admin_key", TargetID: strconv.FormatInt(id, 10),
		Metadata: map[string]any{"via": "discord", "discordActor": discordID, "label": cleanText(input.Label, 60)}})
	return c.JSON(fiber.Map{"key": key, "id": id})
}
