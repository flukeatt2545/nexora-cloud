package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *server) adminSummary(c *fiber.Ctx) error {
	var total, active, suspended, sessions, logins, failed int64
	err := s.db.QueryRow(c.Context(), `
		SELECT
		  (SELECT COUNT(*) FROM users),
		  (SELECT COUNT(*) FROM users WHERE status = 'active'),
		  (SELECT COUNT(*) FROM users WHERE status = 'suspended'),
		  (SELECT COUNT(*) FROM user_sessions WHERE revoked_at IS NULL AND expires_at > NOW()),
		  (SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.login' AND outcome = 'success' AND created_at > NOW() - INTERVAL '24 hours'),
		  (SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.login' AND outcome = 'failure' AND created_at > NOW() - INTERVAL '24 hours')
	`).Scan(&total, &active, &suspended, &sessions, &logins, &failed)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"totalUsers": total, "activeUsers": active, "suspendedUsers": suspended, "activeSessions": sessions, "logins24h": logins, "failedLogins24h": failed})
}

// Orders the users list accepts; anything else falls back to newest first.
var adminUserSorts = map[string]string{
	"newest":    "u.id DESC",
	"oldest":    "u.id ASC",
	"name":      "LOWER(u.identifier) ASC, u.id ASC",
	"lastLogin": "u.last_login_at DESC NULLS LAST, u.id DESC",
}

// Filters shared by the count and the list. Admins only ever see regular users, so that is
// filtered here too, keeping the total and the pages in step with what is shown.
const adminUsersWhere = `
	($1 = '' OR u.identifier ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%' OR COALESCE(u.email, '') ILIKE '%' || $1 || '%')
	AND ($2 = '' OR u.status = $2)
	AND ($3 = '' OR u.role = $3)
	AND (NOT $4 OR u.role = 'user')`

const adminUsersColumns = `
	SELECT u.id, u.identifier, u.display_name, COALESCE(u.email, ''), COALESCE(u.avatar_url, ''),
	       u.role, u.status, u.created_at, u.last_login_at,
	       (SELECT COUNT(*) FROM user_sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW())
	FROM users u`

// adminUsers lists accounts. With ?page= it returns numbered pages and the total; without it,
// the older cursor form (?cursor=<last id>) still works for callers that only need a batch.
func (s *server) adminUsers(c *fiber.Ctx) error {
	actor := current(c)
	limit := parseLimit(c, 30, 100)
	query := cleanText(c.Query("q"), 80)
	status := c.Query("status")
	role := c.Query("role")
	usersOnly := actor.Role == "admin"

	var rows pgx.Rows
	var err error
	page, _ := strconv.Atoi(c.Query("page"))
	paged := page > 0
	var total int64
	if paged {
		page = min(page, 100000)
		order, ok := adminUserSorts[c.Query("sort")]
		if !ok {
			order = adminUserSorts["newest"]
		}
		if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM users u WHERE `+adminUsersWhere, query, status, role, usersOnly).Scan(&total); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		rows, err = s.db.Query(c.Context(), adminUsersColumns+` WHERE `+adminUsersWhere+` ORDER BY `+order+` LIMIT $5 OFFSET $6`,
			query, status, role, usersOnly, limit, (page-1)*limit)
	} else {
		cursor, _ := strconv.ParseInt(c.Query("cursor"), 10, 64)
		rows, err = s.db.Query(c.Context(), adminUsersColumns+` WHERE `+adminUsersWhere+` AND ($5 = 0 OR u.id < $5) ORDER BY u.id DESC LIMIT $6`,
			query, status, role, usersOnly, cursor, limit)
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := []fiber.Map{}
	var nextCursor int64
	for rows.Next() {
		var id, sessionCount int64
		var username, displayName, email, avatar, userRole, userStatus string
		var created time.Time
		var lastLogin *time.Time
		if rows.Scan(&id, &username, &displayName, &email, &avatar, &userRole, &userStatus, &created, &lastLogin, &sessionCount) == nil {
			nextCursor = id
			items = append(items, fiber.Map{"id": id, "username": username, "displayName": displayName, "email": email, "avatarUrl": avatar, "role": userRole, "status": userStatus, "createdAt": created, "lastLoginAt": lastLogin, "activeSessions": sessionCount})
		}
	}
	if rows.Err() != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if paged {
		return c.JSON(fiber.Map{"items": items, "total": total, "page": page})
	}
	return c.JSON(fiber.Map{"items": items, "nextCursor": nextCursor})
}

func (s *server) createAdminUser(c *fiber.Ctx) error {
	actor := current(c)
	var body struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
		Role        string `json:"role"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	username, credentialError := validateCredentials(authRequest{Username: body.Username, Password: body.Password})
	if credentialError != "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: credentialError})
	}
	username = strings.ToLower(username)
	role := body.Role
	if role == "" {
		role = "user"
	}
	if role != "user" && role != "admin" && role != "superadmin" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "สิทธิ์ไม่ถูกต้อง"})
	}
	if actor.Role == "admin" && role != "user" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "แอดมินสร้างได้เฉพาะผู้ใช้ทั่วไป"})
	}

	hash, err := s.hashPassword(body.Password)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	displayName := cleanText(body.DisplayName, 80)
	email := strings.ToLower(cleanText(body.Email, 254))
	if email != "" && (!strings.Contains(email, "@") || strings.ContainsAny(email, " \t\r\n")) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปแบบอีเมลไม่ถูกต้อง"})
	}

	var newID int64
	err = s.db.QueryRow(c.Context(), `
		INSERT INTO users (identifier, password_hash, display_name, email, role, status)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5, 'active')
		RETURNING id
	`, username, hash, displayName, email, role).Scan(&newID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้งานแล้ว"})
		}
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor:    actor,
		Category: "admin",
		Action:   "user.created",
		Target:   "user",
		TargetID: strconv.FormatInt(newID, 10),
		Metadata: map[string]any{"username": username, "role": role},
	})

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": newID, "username": username})
}

func (s *server) updateAdminUser(c *fiber.Ctx) error {
	actor := current(c)
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ผู้ใช้ไม่ถูกต้อง"})
	}
	var body struct {
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	body.DisplayName = cleanText(body.DisplayName, 80)
	body.Email = strings.ToLower(cleanText(body.Email, 254))
	if body.Email != "" && (!strings.Contains(body.Email, "@") || strings.ContainsAny(body.Email, " \t\r\n")) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปแบบอีเมลไม่ถูกต้อง"})
	}
	var targetRole, username string
	if err := s.db.QueryRow(c.Context(), `SELECT role, identifier FROM users WHERE id=$1`, targetID).Scan(&targetRole, &username); errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบผู้ใช้"})
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if actor.Role == "admin" && targetRole != "user" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "แอดมินแก้ไขได้เฉพาะผู้ใช้ทั่วไป"})
	}
	if _, err := s.db.Exec(c.Context(), `
		UPDATE users SET display_name=$1, email=NULLIF($2,''), updated_at=NOW() WHERE id=$3
	`, body.DisplayName, body.Email, targetID); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "อีเมลนี้ถูกใช้งานแล้ว"})
		}
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "admin", Action: "user.updated", Target: "user", TargetID: strconv.FormatInt(targetID, 10), Metadata: map[string]any{"username": username}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) deleteAdminUser(c *fiber.Ctx) error {
	actor := current(c)
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || targetID == actor.ID {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถลบบัญชีนี้ได้"})
	}
	var targetRole, username string
	if err := s.db.QueryRow(c.Context(), `SELECT role, identifier FROM users WHERE id=$1`, targetID).Scan(&targetRole, &username); errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบผู้ใช้"})
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if actor.Role == "admin" && targetRole != "user" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "แอดมินลบได้เฉพาะผู้ใช้ทั่วไป"})
	}
	if targetRole == "superadmin" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ไม่สามารถลบบัญชีผู้ดูแลระบบ"})
	}
	var ownedHostingSites int
	if err := s.db.QueryRow(c.Context(), `
		SELECT COUNT(*) FROM hosting_sites WHERE owner_user_id=$1 AND deleted_at IS NULL
	`, targetID).Scan(&ownedHostingSites); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if ownedHostingSites > 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "ผู้ใช้นี้ยังเป็นเจ้าของเว็บไซต์ กรุณาโอนเจ้าของเว็บไซต์ก่อนลบบัญชี",
			"code":  "hosting_owner_transfer_required",
		})
	}
	s.revokeUserSessions(c, targetID)
	if _, err := s.db.Exec(c.Context(), `DELETE FROM users WHERE id=$1`, targetID); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			log.Printf("[WARN] delete user %d blocked by %s: %s", targetID, pgErr.TableName, pgErr.ConstraintName)
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ลบบัญชีไม่ได้ เพราะยังมีข้อมูลอื่นผูกกับบัญชีนี้อยู่", Code: "user_in_use"})
		}
		log.Printf("[ERROR] delete user %d: %v", targetID, err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "admin", Action: "user.deleted", Target: "user", TargetID: strconv.FormatInt(targetID, 10), Metadata: map[string]any{"username": username, "role": targetRole}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) setUserStatus(c *fiber.Ctx) error {
	actor := current(c)
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || targetID == actor.ID {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถเปลี่ยนสถานะบัญชีนี้ได้"})
	}
	var body struct {
		Status string `json:"status"`
	}
	if c.BodyParser(&body) != nil || (body.Status != "active" && body.Status != "suspended" && body.Status != "banned") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "สถานะไม่ถูกต้อง"})
	}
	var targetRole, username string
	err = s.db.QueryRow(c.Context(), `SELECT role, identifier FROM users WHERE id = $1`, targetID).Scan(&targetRole, &username)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบผู้ใช้"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if actor.Role == "admin" && targetRole != "user" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "แอดมินจัดการได้เฉพาะผู้ใช้ทั่วไป", Code: "forbidden"})
	}
	if targetRole == "superadmin" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ไม่สามารถระงับผู้ดูแลระบบได้", Code: "protected_account"})
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`, body.Status, targetID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if body.Status == "suspended" || body.Status == "banned" {
		s.revokeUserSessions(c, targetID)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "admin", Action: "user.status_changed", Target: "user", TargetID: strconv.FormatInt(targetID, 10), Metadata: map[string]any{"username": username, "status": body.Status}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) setUserRole(c *fiber.Ctx) error {
	actor := current(c)
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || targetID == actor.ID {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่สามารถเปลี่ยนสิทธิ์บัญชีนี้ได้"})
	}
	var body struct {
		Role string `json:"role"`
	}
	if c.BodyParser(&body) != nil || (body.Role != "user" && body.Role != "admin" && body.Role != "superadmin") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ระดับสิทธิ์ไม่ถูกต้อง"})
	}
	var oldRole, username string
	err = s.db.QueryRow(c.Context(), `SELECT role, identifier FROM users WHERE id = $1`, targetID).Scan(&oldRole, &username)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบผู้ใช้"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	// Same role: nothing to change, and no reason to sign the account out everywhere.
	if oldRole == body.Role {
		return c.SendStatus(fiber.StatusNoContent)
	}
	if oldRole == "superadmin" {
		// Count the active superadmins that would remain, so demoting a suspended one is not blocked.
		var count int
		if s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM users WHERE role = 'superadmin' AND status = 'active' AND id <> $1`, targetID).Scan(&count) != nil || count < 1 {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ต้องเหลือผู้ดูแลระบบสูงสุดที่ใช้งานได้อย่างน้อย 1 บัญชี", Code: "last_superadmin"})
		}
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`, body.Role, targetID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.revokeUserSessions(c, targetID)
	s.audit(c, auditEvent{Actor: actor, Category: "admin", Action: "user.role_changed", Target: "user", TargetID: strconv.FormatInt(targetID, 10), Metadata: map[string]any{"username": username, "oldRole": oldRole, "newRole": body.Role}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) revokeUserSessions(c *fiber.Ctx, userID int64) {
	// A suspended, demoted or password-reset account must not keep a code-server token either.
	_, _ = s.db.Exec(c.Context(), `UPDATE hosting_workspace_access_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	rows, err := s.db.Query(c.Context(), `UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL RETURNING token_hash`, userID)
	if err != nil {
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

func (s *server) adminRevokeSessions(c *fiber.Ctx) error {
	actor := current(c)
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ผู้ใช้ไม่ถูกต้อง"})
	}
	var targetRole string
	if err := s.db.QueryRow(c.Context(), `SELECT role FROM users WHERE id = $1`, targetID).Scan(&targetRole); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบผู้ใช้"})
	}
	if actor.Role == "admin" && targetRole != "user" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "แอดมินจัดการได้เฉพาะผู้ใช้ทั่วไป"})
	}
	s.revokeUserSessions(c, targetID)
	s.audit(c, auditEvent{Actor: actor, Category: "admin", Action: "sessions.revoked_for_user", Target: "user", TargetID: strconv.FormatInt(targetID, 10)})
	return c.SendStatus(fiber.StatusNoContent)
}

// logDate accepts a YYYY-MM-DD day from the date pickers; anything else is ignored rather
// than reaching Postgres as a bad cast.
func logDate(value string) string {
	value = strings.TrimSpace(value)
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ""
	}
	return value
}

// Filters shared by the count and the list. Days are Thai calendar days, so a log from
// 01:00 Bangkok time lands on that day rather than the previous UTC one. Search also
// covers the IP address and the target name kept in metadata.
const adminLogsWhere = `
	($1 = '' OR actor_username ILIKE '%' || $1 || '%' OR target_id ILIKE '%' || $1 || '%'
	         OR action ILIKE '%' || $1 || '%' OR ip_address ILIKE '%' || $1 || '%'
	         OR metadata->>'username' ILIKE '%' || $1 || '%')
	AND ($2 = '' OR action = $2)
	AND ($3 = '' OR outcome = $3)
	AND ($4 = '' OR category = $4)
	AND ($5 = '' OR created_at >= ($5::date::timestamp AT TIME ZONE 'Asia/Bangkok'))
	AND ($6 = '' OR created_at < (($6::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok'))`

// adminLogs lists audit entries. With ?page= it returns numbered pages and the total; without
// it, the cursor form (?cursor=<last id>) still serves the overview's recent list.
// auditTargetNameSQL looks up what a log entry was about by its id (a file category's name, a
// user's username, a site's name...), so the logs page can say "หมวดหมู่ไฟล์ "งาน"" instead of
// "หมวดหมู่ไฟล์ (5)". It is empty when the thing has since been deleted.
const auditTargetNameSQL = `COALESCE(CASE audit_logs.target_type
	WHEN 'user' THEN (SELECT u.identifier FROM users u WHERE u.id::text = audit_logs.target_id)
	WHEN 'user_file' THEN (SELECT f.original_name FROM user_files f WHERE f.public_id = audit_logs.target_id)
	WHEN 'user_file_category' THEN (SELECT k.name FROM user_file_categories k WHERE k.id::text = audit_logs.target_id)
	WHEN 'user_file_folder' THEN (SELECT d.name FROM user_file_folders d WHERE d.id::text = audit_logs.target_id)
	WHEN 'hosting_site' THEN (SELECT h.name FROM hosting_sites h WHERE h.public_id = audit_logs.target_id)
	WHEN 'hosting_database' THEN (SELECT b.db_name FROM hosting_databases b WHERE b.public_id = audit_logs.target_id OR b.db_name = audit_logs.target_id LIMIT 1)
	WHEN 'announcement' THEN (SELECT n.title FROM announcements n WHERE n.id::text = audit_logs.target_id)
	WHEN 'product' THEN (SELECT p.title FROM products p WHERE p.id::text = audit_logs.target_id)
	WHEN 'category' THEN (SELECT pc.name FROM product_categories pc WHERE pc.id::text = audit_logs.target_id)
	WHEN 'mailbox' THEN (SELECT m.local_part || '@' || md.domain FROM mailboxes m JOIN mail_domains md ON md.id = m.domain_id WHERE m.public_id = audit_logs.target_id)
	WHEN 'mail_domain' THEN (SELECT md.domain FROM mail_domains md WHERE md.public_id = audit_logs.target_id)
	WHEN 'bot' THEN (SELECT a.name FROM bot_apps a WHERE a.public_id = audit_logs.target_id)
	WHEN 'voice_room' THEN (SELECT r.name FROM voice_rooms r WHERE r.id::text = audit_logs.target_id)
END, '')`

func (s *server) adminLogs(c *fiber.Ctx) error {
	limit := parseLimit(c, 50, 200)
	query := cleanText(c.Query("q"), 80)
	action := cleanText(c.Query("action"), 80)
	outcome := cleanText(c.Query("outcome"), 20)
	category := cleanText(c.Query("category"), 40)
	dateFrom := logDate(c.Query("dateFrom"))
	dateTo := logDate(c.Query("dateTo"))
	args := []any{query, action, outcome, category, dateFrom, dateTo}
	const columns = `SELECT id, actor_username, actor_role, category, action, target_type, target_id,
	       outcome, ip_address, user_agent, metadata, created_at, ` + auditTargetNameSQL + ` AS target_name FROM audit_logs WHERE `

	var rows pgx.Rows
	var err error
	page, _ := strconv.Atoi(c.Query("page"))
	paged := page > 0
	var total int64
	if paged {
		page = min(page, 100000)
		if err := s.db.QueryRow(c.Context(), `SELECT COUNT(*) FROM audit_logs WHERE `+adminLogsWhere, args...).Scan(&total); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		rows, err = s.db.Query(c.Context(), columns+adminLogsWhere+` ORDER BY id DESC LIMIT $7 OFFSET $8`, append(args, limit, (page-1)*limit)...)
	} else {
		cursor, _ := strconv.ParseInt(c.Query("cursor"), 10, 64)
		rows, err = s.db.Query(c.Context(), columns+adminLogsWhere+` AND ($7 = 0 OR id < $7) ORDER BY id DESC LIMIT $8`, append(args, cursor, limit)...)
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := []fiber.Map{}
	var nextCursor int64
	for rows.Next() {
		var id int64
		var username, role, category, eventAction, target, targetID, result, ip, agent, targetName string
		var metadata json.RawMessage
		var created time.Time
		if rows.Scan(&id, &username, &role, &category, &eventAction, &target, &targetID, &result, &ip, &agent, &metadata, &created, &targetName) == nil {
			nextCursor = id
			items = append(items, fiber.Map{"id": id, "actorUsername": username, "actorRole": role, "category": category, "action": eventAction, "targetType": target, "targetId": targetID, "targetName": targetName, "outcome": result, "ipAddress": ip, "userAgent": agent, "metadata": metadata, "createdAt": created})
		}
	}
	if rows.Err() != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if paged {
		return c.JSON(fiber.Map{"items": items, "total": total, "page": page})
	}
	return c.JSON(fiber.Map{"items": items, "nextCursor": nextCursor})
}

func (s *server) adminSettings(c *fiber.Ctx) error {
	settings, err := s.loadSettings(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	var ciphertext string
	var rawEvents []byte
	if err := s.db.QueryRow(c.Context(), `
		SELECT webhook_enabled, discord_webhook_ciphertext, webhook_events
		FROM system_settings WHERE id=1
	`).Scan(&settings.WebhookEnabled, &ciphertext, &rawEvents); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	// The URL itself never leaves the server; the page only needs to know one is saved.
	settings.WebhookConfigured = ciphertext != ""
	_ = json.Unmarshal(rawEvents, &settings.WebhookEvents)
	settings.WebhookEvents = sanitizeWebhookEvents(settings.WebhookEvents)
	if err := s.loadOAuthAdminSettings(c.Context(), &settings); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	settings.LogoURL = s.sanitizeAssetURL(c, settings.LogoURL)
	settings.FaviconURL = s.sanitizeAssetURL(c, settings.FaviconURL)
	settings.AuthBackgroundURL = s.sanitizeAssetURL(c, settings.AuthBackgroundURL)
	settings.OGImageURL = s.sanitizeAssetURL(c, settings.OGImageURL)
	return c.JSON(settings)
}

// hasSignInMethod is false when saving these settings would leave nobody, admins included, a way in.
func hasSignInMethod(settings publicSettings) bool {
	return settings.LocalLoginEnabled || settings.DiscordEnabled || settings.GoogleEnabled || settings.GitHubEnabled
}

func (s *server) updateAdminSettings(c *fiber.Ctx) error {
	actor := current(c)
	var body publicSettings
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	// The store switch is only changed when the request carries it, so a page that was
	// loaded before the switch existed cannot close the store by leaving it out.
	var store struct {
		Enabled *bool   `json:"storeEnabled"`
		Message *string `json:"storeClosedMessage"`
	}
	_ = c.BodyParser(&store)
	if store.Message != nil {
		cleaned := cleanText(*store.Message, 200)
		store.Message = &cleaned
	}
	body.BrandName = cleanText(body.BrandName, 80)
	body.SiteTitle = cleanText(body.SiteTitle, 120)
	if body.SiteTitleMode == "" {
		body.SiteTitleMode = "page"
	}
	body.SiteDescription = cleanText(body.SiteDescription, 300)
	body.LoginTitle = cleanText(body.LoginTitle, 120)
	body.LoginSubtitle = cleanText(body.LoginSubtitle, 200)
	body.RegisterTitle = cleanText(body.RegisterTitle, 120)
	body.RegisterSubtitle = cleanText(body.RegisterSubtitle, 200)
	if body.BrandName == "" || body.SiteTitle == "" || body.LoginTitle == "" || body.RegisterTitle == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณากรอกข้อมูลสำคัญให้ครบ"})
	}
	// Seconds are the setting; an older web build only sends whole minutes.
	if body.SessionTTLSeconds == 0 {
		body.SessionTTLSeconds = body.SessionTTLMinutes * 60
	}
	if body.SessionTTLSeconds < 10 || body.SessionTTLSeconds > 2592000 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "อายุ Session ต้องอยู่ระหว่าง 10 วินาที ถึง 30 วัน"})
	}
	if !validHexColor(body.PrimaryColor) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "สีหลักไม่ถูกต้อง"})
	}
	if body.ThemeMode != "light" && body.ThemeMode != "dark" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ธีมไม่ถูกต้อง"})
	}
	if body.SiteTitleMode != "page" && body.SiteTitleMode != "custom" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปแบบชื่อแท็บไม่ถูกต้อง"})
	}
	body.DiscordWebhookURL = strings.TrimSpace(body.DiscordWebhookURL)
	if body.DiscordWebhookURL != "" && !validDiscordWebhookURL(body.DiscordWebhookURL) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Discord Webhook URL ไม่ถูกต้อง"})
	}
	var ciphertext, previousLogoURL, previousFaviconURL, previousAuthBackgroundURL, previousOGImageURL string
	var previousStoreEnabled bool
	if err := s.db.QueryRow(c.Context(), `
		SELECT discord_webhook_ciphertext, logo_url, favicon_url, auth_background_url, COALESCE(og_image_url, ''), store_enabled
		FROM system_settings WHERE id=1
	`).Scan(&ciphertext, &previousLogoURL, &previousFaviconURL, &previousAuthBackgroundURL, &previousOGImageURL, &previousStoreEnabled); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if body.ClearDiscordWebhook {
		ciphertext = ""
	} else if body.DiscordWebhookURL != "" {
		var encryptErr error
		ciphertext, encryptErr = encryptSecret(body.DiscordWebhookURL, s.cfg.webhookKey)
		if encryptErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}
	if body.WebhookEnabled && ciphertext == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณากำหนด Discord Webhook URL ก่อนเปิดใช้งาน"})
	}
	body.WebhookEvents = sanitizeWebhookEvents(body.WebhookEvents)
	rawEvents, _ := json.Marshal(body.WebhookEvents)
	if !hasSignInMethod(body) {
		keys, err := s.activeAdminKeys(c.Context(), actor.ID)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if keys == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ปิดทุกทางได้เมื่อมีคีย์เข้าระบบสำรองแล้ว สร้างคีย์ก่อน หรือเปิดไว้อย่างน้อยหนึ่งทาง", Code: "no_sign_in_method"})
		}
	}
	if err := s.saveOAuthSettings(c.Context(), actor.ID, body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณากรอก Client ID และ Client Secret ให้ครบ"})
	}
	if body.DiscordEnabled && !s.oauthConfigured(c.Context(), "discord") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาตั้งค่า Discord Client ID และ Secret ก่อนเปิดใช้งาน"})
	}
	if body.GoogleEnabled && !s.oauthConfigured(c.Context(), "google") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาตั้งค่า Google Client ID และ Secret ก่อนเปิดใช้งาน"})
	}
	if body.GitHubEnabled && !s.oauthConfigured(c.Context(), "github") {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาตั้งค่า GitHub Client ID และ Secret ก่อนเปิดใช้งาน"})
	}
	body.OGTitle = strings.TrimSpace(body.OGTitle)
	body.OGDescription = strings.TrimSpace(body.OGDescription)
	body.OGImageURL = strings.TrimSpace(body.OGImageURL)
	body.OGCardType = strings.TrimSpace(body.OGCardType)
	if body.OGCardType != "summary" && body.OGCardType != "summary_large_image" {
		body.OGCardType = "summary_large_image"
	}
	body.OGColor = strings.TrimSpace(body.OGColor)
	if !validHexColor(body.OGColor) {
		body.OGColor = "#5e5ee6"
	}
	_, err := s.db.Exec(c.Context(), `
		UPDATE system_settings SET
		  brand_name=$1, site_title=$2, site_description=$3, primary_color=$4, theme_mode=$5,
		  logo_url=$6, favicon_url=$7, auth_background_url=$8,
		  login_title=$9, login_subtitle=$10, register_title=$11, register_subtitle=$12,
		  local_login_enabled=$13, registration_enabled=$14, store_section_enabled=$15, quick_actions_enabled=$16, footer_enabled=$17, discord_enabled=$18,
		  google_enabled=$19, github_enabled=$20, session_ttl_seconds=$21,
		  session_ttl_minutes=LEAST(43200, GREATEST(5, ($21::int + 59) / 60)),
		  webhook_enabled=$22, discord_webhook_ciphertext=$23, webhook_events=$24,
		  updated_by=$25, site_title_mode=$26, auth_background_tint_enabled=$27,
		  og_title=$28, og_description=$29, og_image_url=$30, og_card_type=$31, og_color=$32,
		  store_enabled=COALESCE($33, store_enabled), store_closed_message=COALESCE($34, store_closed_message), updated_at=NOW()
		WHERE id=1
	`, body.BrandName, body.SiteTitle, body.SiteDescription, body.PrimaryColor, body.ThemeMode,
		body.LogoURL, body.FaviconURL, body.AuthBackgroundURL, body.LoginTitle,
		body.LoginSubtitle, body.RegisterTitle, body.RegisterSubtitle,
		body.LocalLoginEnabled, body.RegistrationEnabled, body.StoreSectionEnabled, body.QuickActionsEnabled, body.FooterEnabled, body.DiscordEnabled,
		body.GoogleEnabled, body.GitHubEnabled, body.SessionTTLSeconds,
		body.WebhookEnabled, ciphertext, rawEvents, actor.ID, body.SiteTitleMode, body.AuthBackgroundTint,
		body.OGTitle, body.OGDescription, body.OGImageURL, body.OGCardType, body.OGColor,
		store.Enabled, store.Message)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if previousLogoURL != body.LogoURL {
		s.removeReplacedBrandAsset(c.Context(), previousLogoURL, "brand/logo")
	}
	if previousFaviconURL != body.FaviconURL {
		s.removeReplacedBrandAsset(c.Context(), previousFaviconURL, "brand/favicon")
	}
	if previousAuthBackgroundURL != body.AuthBackgroundURL {
		s.removeReplacedBrandAsset(c.Context(), previousAuthBackgroundURL, "brand/auth-background")
	}
	if previousOGImageURL != body.OGImageURL {
		s.removeReplacedBrandAsset(c.Context(), previousOGImageURL, "brand/og-image")
	}
	if store.Enabled != nil && *store.Enabled != previousStoreEnabled {
		action := "settings.store_opened"
		if !*store.Enabled {
			action = "settings.store_closed"
		}
		s.audit(c, auditEvent{Actor: actor, Category: "settings", Action: action, Target: "system", TargetID: "1"})
	}
	s.audit(c, auditEvent{Actor: actor, Category: "settings", Action: "settings.updated", Target: "system", TargetID: "1"})
	return s.adminSettings(c)
}

func validHexColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", char) {
			return false
		}
	}
	return true
}

func (s *server) revokeAllSessions(c *fiber.Ctx) error {
	actor := current(c)
	rows, err := s.db.Query(c.Context(), `UPDATE user_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL RETURNING token_hash`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	for rows.Next() {
		var hash string
		if rows.Scan(&hash) == nil {
			s.redis.Del(c.Context(), "session:"+hash)
		}
	}
	s.audit(c, auditEvent{Actor: actor, Category: "security", Action: "sessions.revoked_all", Target: "system", TargetID: "all"})
	s.clearSessionCookie(c)
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) accessMatrix(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"roles": []fiber.Map{
		{"role": "user", "label": "ผู้ใช้", "permissions": permissionsForRole("user")},
		{"role": "admin", "label": "แอดมิน", "permissions": permissionsForRole("admin")},
		{"role": "superadmin", "label": "ผู้ดูแลระบบ", "permissions": permissionsForRole("superadmin")},
	}})
}

func (s *server) adminHealthDetails(c *fiber.Ctx) error {
	var dbSize string
	s.db.QueryRow(c.Context(), `SELECT pg_size_pretty(pg_database_size(current_database()))`).Scan(&dbSize)
	return c.JSON(fiber.Map{"database": "online", "redis": "online", "databaseSize": dbSize, "time": time.Now()})
}

func (s *server) listBannedIPs(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `SELECT ip_address, reason, banned_at, banned_by_user_id FROM banned_ips ORDER BY banned_at DESC`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	items := []fiber.Map{}
	for rows.Next() {
		var ip, reason string
		var bannedAt time.Time
		var bannedBy *int64
		if rows.Scan(&ip, &reason, &bannedAt, &bannedBy) == nil {
			items = append(items, fiber.Map{"ip": ip, "reason": reason, "bannedAt": bannedAt, "bannedBy": bannedBy})
		}
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) banIP(c *fiber.Ctx) error {
	actor := current(c)
	var body struct {
		IP     string `json:"ip"`
		Reason string `json:"reason"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	body.IP = strings.TrimSpace(body.IP)
	body.Reason = cleanText(body.Reason, 200)
	if body.IP == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุ IP Address"})
	}
	_, err := s.db.Exec(c.Context(), `
		INSERT INTO banned_ips (ip_address, reason, banned_by_user_id) VALUES ($1, $2, $3)
		ON CONFLICT (ip_address) DO UPDATE SET reason = EXCLUDED.reason, banned_at = NOW(), banned_by_user_id = EXCLUDED.banned_by_user_id
	`, body.IP, body.Reason, actor.ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	// Force immediate sync across instances by touching lastBannedSync
	bannedSyncMu.Lock()
	lastBannedSync = time.Time{}
	bannedSyncMu.Unlock()
	s.audit(c, auditEvent{Actor: actor, Category: "security", Action: "ip.banned", Target: "ip", TargetID: body.IP, Metadata: map[string]any{"reason": body.Reason}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) unbanIP(c *fiber.Ctx) error {
	actor := current(c)
	ip := c.Params("ip")
	if ip == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบ IP"})
	}
	_, err := s.db.Exec(c.Context(), `DELETE FROM banned_ips WHERE ip_address = $1`, ip)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	bannedSyncMu.Lock()
	lastBannedSync = time.Time{}
	bannedSyncMu.Unlock()
	s.audit(c, auditEvent{Actor: actor, Category: "security", Action: "ip.unbanned", Target: "ip", TargetID: ip})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) adminDatabases(c *fiber.Ctx) error {
	limit := parseLimit(c, 50, 200)
	query := cleanText(c.Query("q"), 80)
	cursor, _ := strconv.ParseInt(c.Query("cursor"), 10, 64)

	// MySQL sizes load alongside the Postgres list; both are usually instant.
	sizesReady := make(chan map[string]int64, 1)
	go func() { sizesReady <- s.tenantDatabaseSizes(context.Background()) }()

	rows, err := s.db.Query(c.Context(), `
		SELECT d.id, d.public_id, d.db_name, d.db_user, d.status, d.engine, d.host, d.port, d.created_at,
		       s.public_id, s.name, s.subdomain,
		       u.identifier as owner_username, u.display_name as owner_display
		FROM hosting_databases d
		LEFT JOIN hosting_sites s ON d.site_id = s.id
		JOIN users u ON d.owner_id = u.id
		WHERE ($1 = '' OR d.db_name ILIKE '%' || $1 || '%' OR s.name ILIKE '%' || $1 || '%')
		  AND ($2 = 0 OR d.id < $2)
		ORDER BY d.id DESC LIMIT $3
	`, query, cursor, limit)

	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	dbSizes := <-sizesReady

	items := []fiber.Map{}
	var nextCursor int64
	for rows.Next() {
		var id int64
		var publicID, dbName, dbUser, status, engine, host, ownerUsername string
		var sitePublicID, siteName, siteSubdomain, ownerDisplay *string
		var port int
		var createdAt time.Time

		if rows.Scan(&id, &publicID, &dbName, &dbUser, &status, &engine, &host, &port, &createdAt, &sitePublicID, &siteName, &siteSubdomain, &ownerUsername, &ownerDisplay) == nil {
			nextCursor = id

			displayName := ownerUsername
			if ownerDisplay != nil && *ownerDisplay != "" {
				displayName = *ownerDisplay
			}

			items = append(items, fiber.Map{
				"id":               publicID,
				"dbName":           dbName,
				"dbUser":           dbUser,
				"status":           status,
				"engine":           engine,
				"host":             host,
				"port":             port,
				"sizeBytes":        dbSizes[dbName],
				"createdAt":        createdAt,
				"siteId":           ptrToString(sitePublicID),
				"siteName":         ptrToString(siteName),
				"siteSubdomain":    ptrToString(siteSubdomain),
				"ownerUsername":    ownerUsername,
				"ownerDisplayName": displayName,
			})
		}
	}
	return c.JSON(fiber.Map{"items": items, "nextCursor": nextCursor})
}

func ptrToString(ptr *string) string {
	if ptr == nil {
		return ""
	}
	return *ptr
}

func (s *server) adminResetUserPassword(c *fiber.Ctx) error {
	actor := current(c)
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ผู้ใช้ไม่ถูกต้อง"})
	}
	var body struct {
		NewPassword string `json:"newPassword"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	passwordLength := utf8.RuneCountInString(body.NewPassword)
	if passwordLength < 8 || passwordLength > 128 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสผ่านต้องมี 8–128 ตัวอักษร"})
	}
	if message := validatePasswordASCII(body.NewPassword); message != "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: message, Code: "invalid_password"})
	}
	var targetRole, username string
	if err := s.db.QueryRow(c.Context(), `SELECT role, identifier FROM users WHERE id=$1`, targetID).Scan(&targetRole, &username); errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบผู้ใช้"})
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if actor.Role == "admin" && targetRole != "user" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "แอดมินเปลี่ยนรหัสผ่านได้เฉพาะผู้ใช้ทั่วไป"})
	}
	if targetRole == "superadmin" && actor.ID != targetID {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ไม่สามารถเปลี่ยนรหัสผ่านผู้ดูแลระบบสูงสุดได้"})
	}
	hash, err := s.hashPassword(body.NewPassword)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2`, hash, targetID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.revokeUserSessions(c, targetID)
	s.audit(c, auditEvent{Actor: actor, Category: "admin", Action: "user.password_reset", Target: "user", TargetID: strconv.FormatInt(targetID, 10), Metadata: map[string]any{"username": username}})
	return c.JSON(fiber.Map{"success": true, "message": "เปลี่ยนรหัสผ่านผู้ใช้แล้ว"})
}
