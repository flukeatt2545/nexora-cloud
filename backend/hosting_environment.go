package main

import (
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

var hostingEnvironmentNamePattern = regexp.MustCompile(`^[A-Z_][A-Z0-9_]{0,63}$`)

var reservedHostingEnvironmentNames = map[string]bool{
	"PORT": true, "HOME": true, "HOSTNAME": true, "NODE_ENV": true,
	"PATH": true, "PWD": true, "USER": true, "SHELL": true,
}

type hostingEnvironmentInput struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	IsSecret bool   `json:"isSecret"`
}

func validHostingEnvironmentName(name string) bool {
	return hostingEnvironmentNamePattern.MatchString(name) && !reservedHostingEnvironmentNames[name]
}

func (s *server) hostingEnvironmentAccess(c *fiber.Ctx, write bool) (sourceAccess, error) {
	access, err := s.hostingSourceAccess(c, false)
	if err != nil {
		return sourceAccess{}, err
	}
	if write && access.Role != "owner" && access.Role != "platform_admin" {
		return sourceAccess{}, fiber.NewError(fiber.StatusForbidden, "เฉพาะเจ้าของเว็บไซต์หรือผู้ดูแลระบบเท่านั้น")
	}
	return access, nil
}

func (s *server) listHostingEnvironment(c *fiber.Ctx) error {
	access, err := s.hostingEnvironmentAccess(c, false)
	if err != nil {
		return err
	}
	canManage := access.Role == "owner" || access.Role == "platform_admin"
	rows, err := s.db.Query(c.Context(), `
		SELECT name,value_ciphertext,is_secret,updated_at
		FROM hosting_environment_variables WHERE site_id=$1 ORDER BY name
	`, access.SiteID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := make([]fiber.Map, 0)
	for rows.Next() {
		var name, ciphertext string
		var isSecret bool
		var updatedAt time.Time
		if err := rows.Scan(&name, &ciphertext, &isSecret, &updatedAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		value := ""
		if canManage && !isSecret {
			value, err = decryptSecret(ciphertext, s.cfg.hostingEncryptionKey)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ไม่สามารถอ่านค่าตัวแปรได้", Code: "environment_decrypt_failed"})
			}
		}
		items = append(items, fiber.Map{"name": name, "value": value, "isSecret": isSecret, "masked": isSecret, "updatedAt": updatedAt})
	}
	return c.JSON(fiber.Map{"items": items, "canManage": canManage})
}

func (s *server) upsertHostingEnvironment(c *fiber.Ctx) error {
	actor := current(c)
	access, err := s.hostingEnvironmentAccess(c, true)
	if err != nil {
		return err
	}
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาส่ง Idempotency-Key ที่ถูกต้อง", Code: "invalid_idempotency_key"})
	}
	var input hostingEnvironmentInput
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	input.Name = strings.ToUpper(strings.TrimSpace(input.Name))
	if !validHostingEnvironmentName(input.Name) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อต้องเป็น A-Z, 0-9 หรือ _ และห้ามใช้ชื่อที่ระบบสงวนไว้", Code: "invalid_environment_name"})
	}
	if len(input.Value) > 32*1024 {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(apiError{Error: "ค่ายาวเกิน 32 KB", Code: "environment_value_too_large"})
	}
	hash := requestDigest("environment.upsert", c.Body())
	ciphertext, err := encryptSecret(input.Value, s.cfg.hostingEncryptionKey)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	_, processed, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "environment.upsert")
	if err != nil {
		return hostingIdempotencyError(c, err)
	}
	if processed {
		return c.JSON(fiber.Map{"ok": true, "replayed": true, "restartRequired": true})
	}
	_, err = tx.Exec(c.Context(), `
		INSERT INTO hosting_environment_variables (site_id,name,value_ciphertext,is_secret,created_by,updated_by)
		VALUES ($1,$2,$3,$4,$5,$5)
		ON CONFLICT (site_id,name) DO UPDATE
		SET value_ciphertext=EXCLUDED.value_ciphertext,is_secret=EXCLUDED.is_secret,
		    updated_by=EXCLUDED.updated_by,updated_at=NOW()
	`, access.SiteID, input.Name, ciphertext, input.IsSecret, actor.ID)
	if err == nil {
		err = insertHostingOperation(c.Context(), tx, access.SiteID, actor.ID, "environment.upsert", key, hash, access.PublicID)
	}
	if err != nil {
		return hostingConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.environment.updated", Target: "hosting_site", TargetID: access.PublicID, Metadata: map[string]any{"name": input.Name, "isSecret": input.IsSecret}})
	return c.JSON(fiber.Map{"ok": true, "restartRequired": true})
}

func (s *server) deleteHostingEnvironment(c *fiber.Ctx) error {
	actor := current(c)
	access, err := s.hostingEnvironmentAccess(c, true)
	if err != nil {
		return err
	}
	name := strings.ToUpper(strings.TrimSpace(c.Params("name")))
	if !validHostingEnvironmentName(name) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อตัวแปรไม่ถูกต้อง", Code: "invalid_environment_name"})
	}
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาส่ง Idempotency-Key ที่ถูกต้อง", Code: "invalid_idempotency_key"})
	}
	hash := requestDigest("environment.delete", []byte(name))
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	_, processed, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "environment.delete")
	if err != nil {
		return hostingIdempotencyError(c, err)
	}
	if processed {
		return c.JSON(fiber.Map{"ok": true, "replayed": true, "restartRequired": true})
	}
	tag, err := tx.Exec(c.Context(), `DELETE FROM hosting_environment_variables WHERE site_id=$1 AND name=$2`, access.SiteID, name)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบตัวแปรนี้", Code: "environment_not_found"})
	}
	if err := insertHostingOperation(c.Context(), tx, access.SiteID, actor.ID, "environment.delete", key, hash, access.PublicID); err != nil {
		return hostingConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.environment.deleted", Target: "hosting_site", TargetID: access.PublicID, Metadata: map[string]any{"name": name}})
	return c.JSON(fiber.Map{"ok": true, "restartRequired": true})
}
