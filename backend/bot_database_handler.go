package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

type BotStudentTicketRequest struct {
	StudentCode     string `json:"studentCode"`
	PreferredDomain string `json:"preferredDomain"`
	DiscordUserID   string `json:"discordUserId"`
	DiscordUsername string `json:"discordUsername"`
	IsAdmin         bool   `json:"isAdmin"`
}

type StudentMappingRecord struct {
	ID              int64     `json:"id"`
	StudentCode     string    `json:"studentCode"`
	StudentName     string    `json:"studentName"`
	DatabaseID      *int64    `json:"databaseId,omitempty"`
	DbPublicID      string    `json:"dbPublicId,omitempty"`
	DbName          string    `json:"dbName,omitempty"`
	DbUser          string    `json:"dbUser,omitempty"`
	SiteID          *int64    `json:"siteId,omitempty"`
	SitePublicID    string    `json:"sitePublicId,omitempty"`
	SiteName        string    `json:"siteName,omitempty"`
	SiteSubdomain   string    `json:"siteSubdomain,omitempty"`
	OwnerName       string    `json:"ownerName"`
	DiscordUserID   string    `json:"discordUserId"`
	DiscordUsername string    `json:"discordUsername"`
	Notes           string    `json:"notes"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// WorkspaceSSOTicket represents the payload stored in Redis for one-time workspace SSO launch.
type WorkspaceSSOTicket struct {
	StudentCode     string    `json:"studentCode"`
	SiteID          int64     `json:"siteId"`
	SitePublicID    string    `json:"sitePublicId"`
	OwnerUserID     int64     `json:"ownerUserId"`
	DiscordUserID   string    `json:"discordUserId"`
	DiscordUsername string    `json:"discordUsername"`
	IsAdmin         bool      `json:"isAdmin"`
	CreatedAt       time.Time `json:"createdAt"`
}

type workspaceTicketConsumeRequest struct {
	Ticket string `json:"ticket"`
}

func workspaceLaunchKey(ticket string) string {
	return "workspace:launch:" + tokenHash(ticket)
}

func (s *server) isDiscordStudentAdmin(discordUserID string) bool {
	id := strings.TrimSpace(discordUserID)
	if !validDiscordSnowflake(id) || s.cfg.discordAdminIDs == nil {
		return false
	}
	return s.cfg.discordAdminIDs[id]
}

func (s *server) requireBotStudentAdmin(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	actor := strings.TrimSpace(c.Get("X-Bot-Actor-Discord-Id"))
	if !s.isDiscordStudentAdmin(actor) {
		return fiber.NewError(fiber.StatusForbidden, "คำสั่งนี้ใช้ได้เฉพาะเจ้าของเซิร์ฟเวอร์ Discord")
	}
	return nil
}

func (s *server) isStudentDiscordRevoked(ctx context.Context, studentCode, discordUserID string) bool {
	code := strings.TrimSpace(studentCode)
	userID := strings.TrimSpace(discordUserID)
	if code == "" || !validDiscordSnowflake(userID) {
		return false
	}
	var exists bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM student_discord_revocations
			WHERE LOWER(student_code) = LOWER($1) AND discord_user_id = $2
		)
	`, code, userID).Scan(&exists)
	return err == nil && exists
}

func (s *server) expireStudentDatabaseTickets(ctx context.Context, databaseID int64) {
	if databaseID <= 0 {
		return
	}
	_, _ = s.db.Exec(ctx, `
		UPDATE hosting_database_access_tickets
		SET expires_at = NOW(), used_at = COALESCE(used_at, NOW())
		WHERE database_id = $1 AND used_at IS NULL AND expires_at > NOW()
	`, databaseID)
}

func (s *server) revokeStudentWorkspaceTokens(ctx context.Context, studentCode string) {
	code := strings.TrimSpace(studentCode)
	if code == "" {
		return
	}
	_, _ = s.db.Exec(ctx, `
		UPDATE hosting_workspace_access_tokens
		SET revoked_at = COALESCE(revoked_at, NOW())
		WHERE LOWER(student_code) = LOWER($1) AND revoked_at IS NULL
	`, code)
}

func (s *server) recordStudentDiscordRevocation(ctx context.Context, studentCode, discordUserID, discordUsername string) {
	code := strings.TrimSpace(studentCode)
	userID := strings.TrimSpace(discordUserID)
	if code == "" || !validDiscordSnowflake(userID) {
		return
	}
	_, _ = s.db.Exec(ctx, `
		INSERT INTO student_discord_revocations (student_code, discord_user_id, discord_username)
		VALUES ($1, $2, $3)
		ON CONFLICT (student_code, discord_user_id) DO UPDATE
		SET discord_username = EXCLUDED.discord_username, revoked_at = NOW()
	`, code, userID, strings.TrimSpace(discordUsername))
}

func (s *server) cutStudentLiveAccess(ctx context.Context, studentCode string, databaseID int64) {
	s.expireStudentDatabaseTickets(ctx, databaseID)
	s.revokeStudentWorkspaceTokens(ctx, studentCode)
	if databaseID > 0 {
		if err := s.rotateTenantDatabasePassword(ctx, databaseID); err != nil {
			log.Printf("[ERROR] cutStudentLiveAccess rotate password for db %d: %v", databaseID, err)
		}
	}
}

func studentAccessRevokedJSON() apiError {
	return apiError{
		Error: "ใช้บัญชีนี้กับรหัสเดิมไม่ได้แล้ว ถ้ายังไม่มีคนใช้ สามารถลงทะเบียนใหม่ได้",
		Code:  "student_access_revoked",
	}
}

var studentCodePattern = regexp.MustCompile(`^[A-Za-z0-9]{2,10}$`)

const (
	studentDiscordBindIfFreeSQL = `
		UPDATE student_db_mappings
		SET discord_user_id = $1, discord_username = $2, updated_at = NOW()
		WHERE id = $3 AND COALESCE(discord_user_id, '') = ''
	`
	studentDiscordBindWorkspaceIfFreeSQL = `
		UPDATE student_db_mappings
		SET discord_user_id = $1, discord_username = $2, site_id = COALESCE(site_id, $3), updated_at = NOW()
		WHERE id = $4 AND COALESCE(discord_user_id, '') = ''
	`
	clearStudentDiscordRevocationSQL = `
		DELETE FROM student_discord_revocations
		WHERE LOWER(student_code) = LOWER($1) AND discord_user_id = $2
	`
)

type studentDiscordBindDecision string

const (
	studentBindAllow         studentDiscordBindDecision = "allow"
	studentBindBoundToOther  studentDiscordBindDecision = "student_code_bound_to_other"
	studentBindAlreadyMapped studentDiscordBindDecision = "discord_user_already_has_mapping"
)

func validStudentCode(code string) bool {
	return studentCodePattern.MatchString(strings.TrimSpace(code))
}

func boundDiscordID(id *string) string {
	if id == nil {
		return ""
	}
	return strings.TrimSpace(*id)
}

func studentCodeBoundToOtherJSON() apiError {
	return apiError{
		Error: "รหัสนี้มีคนใช้แล้ว ถ้าเป็นรหัสของคุณ ติดต่อผู้ดูแลได้เลย",
		Code:  "student_code_bound_to_other",
	}
}

func discordUserAlreadyMappedJSON(_ string) apiError {
	return apiError{
		Error: "บัญชีนี้มีรหัสอยู่แล้ว ถ้าต้องการเปลี่ยน ติดต่อผู้ดูแลได้เลย",
		Code:  "discord_user_already_has_mapping",
	}
}

func normalizeBotStudentTicket(req BotStudentTicketRequest) (string, string, string, apiError) {
	code := strings.TrimSpace(req.StudentCode)
	if code == "" {
		return "", "", "", apiError{Error: "กรุณาระบุรหัส 3 ตัวท้ายของคุณ", Code: "missing_code"}
	}
	if !validStudentCode(code) {
		return "", "", "", apiError{Error: "รหัสต้องเป็นตัวอักษรหรือตัวเลข 2–10 ตัว", Code: "invalid_student_code"}
	}
	discordUserID := strings.TrimSpace(req.DiscordUserID)
	if discordUserID != "" && !validDiscordSnowflake(discordUserID) {
		return "", "", "", apiError{Error: "บัญชี Discord ไม่ถูกต้อง", Code: "invalid_discord_user"}
	}
	return code, discordUserID, strings.TrimSpace(req.DiscordUsername), apiError{}
}

func decideStudentDiscordBind(isAdmin bool, callerID, boundID, otherMappedCode string) studentDiscordBindDecision {
	if isAdmin {
		return studentBindAllow
	}
	callerID = strings.TrimSpace(callerID)
	boundID = strings.TrimSpace(boundID)
	otherMappedCode = strings.TrimSpace(otherMappedCode)
	if boundID != "" && boundID != callerID {
		return studentBindBoundToOther
	}
	if otherMappedCode != "" {
		return studentBindAlreadyMapped
	}
	return studentBindAllow
}

func claimFreeDiscordBinding(current *string, caller string) bool {
	if current == nil {
		return false
	}
	if strings.TrimSpace(*current) != "" {
		return false
	}
	*current = caller
	return true
}

func shouldClearStudentDiscordRevocation(bindWon bool, boundID, callerID string) bool {
	callerID = strings.TrimSpace(callerID)
	return bindWon || (callerID != "" && strings.TrimSpace(boundID) == callerID)
}

func (s *server) lookupOtherStudentMapping(ctx context.Context, discordUserID, studentCode string) string {
	if !validDiscordSnowflake(discordUserID) {
		return ""
	}
	var otherCode string
	err := s.db.QueryRow(ctx, `
		SELECT student_code FROM student_db_mappings
		WHERE discord_user_id = $1 AND LOWER(student_code) != LOWER($2)
		LIMIT 1
	`, discordUserID, studentCode).Scan(&otherCode)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(otherCode)
}

func (s *server) clearStudentDiscordRevocation(ctx context.Context, studentCode, discordUserID string) {
	code := strings.TrimSpace(studentCode)
	userID := strings.TrimSpace(discordUserID)
	if code == "" || !validDiscordSnowflake(userID) {
		return
	}
	_, _ = s.db.Exec(ctx, clearStudentDiscordRevocationSQL, code, userID)
}

func (s *server) bindStudentDiscordIfFree(ctx context.Context, mappingID int64, discordUserID, discordUsername string, siteID int64) (bool, error) {
	if mappingID <= 0 || !validDiscordSnowflake(discordUserID) {
		return false, nil
	}
	var (
		tag interface{ RowsAffected() int64 }
		err error
	)
	if siteID > 0 {
		tag, err = s.db.Exec(ctx, studentDiscordBindWorkspaceIfFreeSQL, discordUserID, discordUsername, siteID, mappingID)
	} else {
		tag, err = s.db.Exec(ctx, studentDiscordBindIfFreeSQL, discordUserID, discordUsername, mappingID)
	}
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *server) enforceStudentDiscordBind(ctx context.Context, isAdmin bool, mappingID int64, studentCode, discordUserID, discordUsername string, boundID *string, siteID int64) apiError {
	if discordUserID == "" {
		return apiError{}
	}
	if !validDiscordSnowflake(discordUserID) {
		return apiError{Error: "บัญชี Discord ไม่ถูกต้อง", Code: "invalid_discord_user"}
	}
	currentBound := boundDiscordID(boundID)
	otherCode := ""
	if !isAdmin {
		otherCode = s.lookupOtherStudentMapping(ctx, discordUserID, studentCode)
	}
	switch decideStudentDiscordBind(isAdmin, discordUserID, currentBound, otherCode) {
	case studentBindBoundToOther:
		return studentCodeBoundToOtherJSON()
	case studentBindAlreadyMapped:
		return discordUserAlreadyMappedJSON(otherCode)
	}
	if isAdmin {
		return apiError{}
	}
	if currentBound == discordUserID {
		if shouldClearStudentDiscordRevocation(false, currentBound, discordUserID) {
			s.clearStudentDiscordRevocation(ctx, studentCode, discordUserID)
		}
		return apiError{}
	}
	if mappingID <= 0 {
		return apiError{}
	}
	won, err := s.bindStudentDiscordIfFree(ctx, mappingID, discordUserID, discordUsername, siteID)
	if err != nil {
		log.Printf("[ERROR] bindStudentDiscordIfFree: %v", err)
		return apiError{Error: "ระบบไม่สามารถประมวลผลคำขอได้ในขณะนี้", Code: "bind_failed"}
	}
	if !won {
		return studentCodeBoundToOtherJSON()
	}
	if shouldClearStudentDiscordRevocation(true, currentBound, discordUserID) {
		s.clearStudentDiscordRevocation(ctx, studentCode, discordUserID)
	}
	return apiError{}
}

func studentBindDenyStatus(code string) int {
	switch code {
	case "invalid_discord_user", "invalid_student_code", "missing_code":
		return fiber.StatusBadRequest
	case "bind_failed":
		return fiber.StatusInternalServerError
	default:
		return fiber.StatusForbidden
	}
}

func studentBindLogStatus(code string) string {
	switch code {
	case "student_code_bound_to_other":
		return "blocked_different_account"
	case "discord_user_already_has_mapping":
		return "blocked_user_has_other_mapping"
	default:
		return "blocked_bind"
	}
}

func (s *server) applyUnboundStudentAccessCutoff(ctx context.Context) {
	tag, err := s.db.Exec(ctx, `
		INSERT INTO student_discord_revocations (student_code, discord_user_id, discord_username)
		VALUES ('_system', 'cut_unbound_live_access', '')
		ON CONFLICT (student_code, discord_user_id) DO NOTHING
	`)
	if err != nil {
		log.Printf("[WARN] applyUnboundStudentAccessCutoff marker: %v", err)
		return
	}
	if tag.RowsAffected() == 0 {
		return
	}
	_, _ = s.db.Exec(ctx, `
		INSERT INTO student_discord_revocations (student_code, discord_user_id, discord_username)
		SELECT DISTINCT ON (m.student_code)
			m.student_code, l.discord_user_id, COALESCE(NULLIF(l.discord_username, ''), 'revoked')
		FROM student_db_mappings m
		JOIN student_db_access_logs l ON LOWER(l.student_code) = LOWER(m.student_code)
		WHERE COALESCE(m.discord_user_id, '') = ''
		  AND l.discord_user_id ~ '^[0-9]{17,20}$'
		  AND l.status = 'success'
		ORDER BY m.student_code, l.created_at DESC
		ON CONFLICT (student_code, discord_user_id) DO NOTHING
	`)
	_, _ = s.db.Exec(ctx, `
		INSERT INTO student_discord_revocations (student_code, discord_user_id, discord_username)
		SELECT DISTINCT l.student_code, l.discord_user_id, COALESCE(NULLIF(l.discord_username, ''), 'revoked')
		FROM student_db_access_logs l
		JOIN student_db_mappings m ON LOWER(m.student_code) = LOWER(l.student_code)
		WHERE l.status = 'success'
		  AND l.discord_user_id ~ '^[0-9]{17,20}$'
		  AND l.discord_user_id <> COALESCE(m.discord_user_id, '')
		ON CONFLICT (student_code, discord_user_id) DO NOTHING
	`)
	rows, err := s.db.Query(ctx, `
		SELECT student_code, database_id
		FROM student_db_mappings
		WHERE COALESCE(discord_user_id, '') = '' AND database_id IS NOT NULL
	`)
	if err != nil {
		log.Printf("[WARN] applyUnboundStudentAccessCutoff list: %v", err)
		return
	}
	defer rows.Close()
	rotated := 0
	for rows.Next() {
		var code string
		var databaseID *int64
		if scanErr := rows.Scan(&code, &databaseID); scanErr != nil || databaseID == nil {
			continue
		}
		s.cutStudentLiveAccess(ctx, code, *databaseID)
		rotated++
	}
	log.Printf("[INFO] applyUnboundStudentAccessCutoff rotated %d unbound student databases", rotated)
}

// verifyBotSecret verifies that the request has a valid X-Bot-Internal-Secret header.
// It returns an error so callers stop; writing the 403 body and returning nil let handlers carry on.
func (s *server) verifyBotSecret(c *fiber.Ctx) error {
	secret := strings.TrimSpace(c.Get("X-Bot-Internal-Secret"))
	if secret == "" {
		secret = strings.TrimSpace(c.Get("X-PMA-Internal-Secret"))
	}
	expected := s.cfg.phpMyAdminInternalSecret
	if secret == "" || expected == "" || subtle.ConstantTimeCompare([]byte(secret), []byte(expected)) != 1 {
		return fiber.NewError(fiber.StatusForbidden, "บอทไม่ได้รับอนุญาตให้เรียกใช้ API นี้")
	}
	return nil
}

// botGenerateStudentTicket handles Discord Bot requests to get a 1-click SSO ticket for a student.
func (s *server) botGenerateStudentTicket(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}

	var req BotStudentTicketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}

	cleanCode, discordUserID, discordUsername, reqErr := normalizeBotStudentTicket(req)
	if reqErr.Code != "" {
		return c.Status(studentBindDenyStatus(reqErr.Code)).JSON(reqErr)
	}
	isAdmin := s.isDiscordStudentAdmin(discordUserID)

	// 1. Check explicit mapping table first
	var databaseID, mappingID int64
	var studentName, notes, matchedBy string
	var dbPublicID, dbName, dbUser, ciphertext, host, engine string
	var boundDiscordUserID, boundDiscordUsername *string
	var port int
	var ownerID int64

	err := s.db.QueryRow(c.Context(), `
		SELECT m.id, m.student_name, m.notes, d.id, d.public_id, d.db_name, d.db_user,
		       d.db_password_enc, d.host, d.port, d.engine, d.owner_id,
		       m.discord_user_id, m.discord_username
		FROM student_db_mappings m
		JOIN hosting_databases d ON d.id = m.database_id
		WHERE LOWER(m.student_code) = LOWER($1)
	`, cleanCode).Scan(
		&mappingID, &studentName, &notes, &databaseID, &dbPublicID, &dbName, &dbUser,
		&ciphertext, &host, &port, &engine, &ownerID,
		&boundDiscordUserID, &boundDiscordUsername,
	)

	if err == nil {
		matchedBy = "mapping"
	} else if errors.Is(err, pgx.ErrNoRows) && isAdmin {
		// Auto-match is owner-only. Regular users cannot guess another student's database.
		pattern := "%" + cleanCode + "%"
		err = s.db.QueryRow(c.Context(), `
			SELECT d.id, d.public_id, d.db_name, d.db_user,
			       d.db_password_enc, d.host, d.port, d.engine, d.owner_id
			FROM hosting_databases d
			WHERE (d.db_name ILIKE $1 OR d.db_user ILIKE $1)
			  AND d.engine = 'mysql'
			ORDER BY d.id ASC
			LIMIT 1
		`, pattern).Scan(
			&databaseID, &dbPublicID, &dbName, &dbUser,
			&ciphertext, &host, &port, &engine, &ownerID,
		)
		if err == nil {
			matchedBy = "auto_db_pattern"
		} else if errors.Is(err, pgx.ErrNoRows) {
			// 3. Auto-match by user identifier containing the student code
			err = s.db.QueryRow(c.Context(), `
				SELECT d.id, d.public_id, d.db_name, d.db_user,
				       d.db_password_enc, d.host, d.port, d.engine, d.owner_id, u.identifier
				FROM users u
				JOIN hosting_databases d ON d.owner_id = u.id
				WHERE (u.identifier ILIKE $1 OR u.display_name ILIKE $1)
				  AND d.engine = 'mysql' AND u.status = 'active'
				ORDER BY d.id DESC
				LIMIT 1
			`, pattern).Scan(
				&databaseID, &dbPublicID, &dbName, &dbUser,
				&ciphertext, &host, &port, &engine, &ownerID, &studentName,
			)
			if err == nil {
				matchedBy = "auto_user_pattern"
			}
		}
	}

	if databaseID == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{
			Error: "ไม่พบรหัสนี้ ตรวจอีกครั้ง หรือติดต่อผู้ดูแล",
			Code:  "student_db_not_found",
		})
	}

	if !isAdmin && mappingID == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{
			Error: "ไม่พบรหัสนี้ ตรวจอีกครั้ง หรือติดต่อผู้ดูแล",
			Code:  "student_db_not_found",
		})
	}

	if deny := s.enforceStudentDiscordBind(c.Context(), isAdmin, mappingID, cleanCode, discordUserID, discordUsername, boundDiscordUserID, 0); deny.Code != "" {
		_, _ = s.db.Exec(c.Context(), `
			INSERT INTO student_db_access_logs (student_code, database_id, discord_user_id, discord_username, status, ip)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, cleanCode, databaseID, discordUserID, discordUsername, studentBindLogStatus(deny.Code), c.IP())
		return c.Status(studentBindDenyStatus(deny.Code)).JSON(deny)
	}

	// Checked after the Discord bind, so only the student who owns the code learns the status.
	var dbStatus string
	if err := s.db.QueryRow(c.Context(), `SELECT status FROM hosting_databases WHERE id=$1`, databaseID).Scan(&dbStatus); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if blocked := databaseAccessBlocked(dbStatus); blocked != nil {
		return c.Status(fiber.StatusLocked).JSON(blocked)
	}

	// Record success audit log
	_, _ = s.db.Exec(c.Context(), `
		INSERT INTO student_db_access_logs (student_code, database_id, discord_user_id, discord_username, status, ip)
		VALUES ($1, $2, $3, $4, 'success', $5)
	`, cleanCode, databaseID, discordUserID, discordUsername, c.IP())

	// Decrypt password
	password, err := decryptSecret(ciphertext, s.cfg.hostingEncryptionKey)
	if err != nil {
		password, err = decryptSecret(ciphertext, s.cfg.webhookKey)
	}
	if err != nil {
		log.Printf("[ERROR] botGenerateStudentTicket decrypt error for db %s: %v", dbName, err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ไม่สามารถถอดรหัสรหัสผ่านฐานข้อมูลได้", Code: "decrypt_failed"})
	}

	// Make sure tenant DB credential exists
	if err := s.ensureTenantDatabaseCredential(c.Context(), dbName, dbUser, password); err != nil {
		log.Printf("[WARN] botGenerateStudentTicket ensure credential error for db %s: %v", dbName, err)
	}

	// Generate SSO Ticket (valid for 5 minutes)
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	token := hex.EncodeToString(raw)
	expiresAt := time.Now().UTC().Add(5 * time.Minute)

	_, err = s.db.Exec(c.Context(), `
		INSERT INTO hosting_database_access_tickets
			(token_hash, user_id, session_id, site_id, database_id, ip_hash, user_agent_hash, expires_at)
		VALUES ($1, $2, NULL, NULL, $3, NULL, NULL, $4)
	`, tokenHash(token), ownerID, databaseID, expiresAt)
	if err != nil {
		log.Printf("[ERROR] botGenerateStudentTicket insert ticket error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	// Target SSO Domain (user specified https://db.nkn02.com)
	baseDomain := strings.TrimRight(strings.TrimSpace(req.PreferredDomain), "/")
	if baseDomain == "" {
		baseDomain = "https://db.nkn02.com"
	}
	ssoURL := fmt.Sprintf("%s/login?ticket=%s", baseDomain, token)

	publicHost := "db.nkn02.com"
	if host != "" && !strings.Contains(host, "tenant-db") {
		publicHost = host
	}

	return c.JSON(fiber.Map{
		"success":     true,
		"studentCode": cleanCode,
		"studentName": studentName,
		"matchedBy":   matchedBy,
		"ticket":      token,
		"url":         ssoURL,
		"expiresAt":   expiresAt,
		"database": fiber.Map{
			"id":     dbPublicID,
			"name":   dbName,
			"user":   dbUser,
			"host":   publicHost,
			"port":   port,
			"engine": engine,
		},
	})
}

// adminListStudentMappings lists all registered student mappings for Admin.
func (s *server) adminListStudentMappings(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
		SELECT m.id, m.student_code, m.student_name, m.database_id,
		       COALESCE(d.public_id, ''), COALESCE(d.db_name, ''), COALESCE(d.db_user, ''),
		       m.site_id,
		       COALESCE(s.public_id, ''), COALESCE(s.name, ''), COALESCE(s.subdomain, ''),
		       COALESCE(u.identifier, COALESCE(su.identifier, '')),
		       COALESCE(m.discord_user_id, ''), COALESCE(m.discord_username, ''),
		       m.notes, m.created_at, m.updated_at
		FROM student_db_mappings m
		LEFT JOIN hosting_databases d ON d.id = m.database_id
		LEFT JOIN users u ON u.id = d.owner_id
		LEFT JOIN hosting_sites s ON s.id = m.site_id AND s.deleted_at IS NULL
		LEFT JOIN users su ON su.id = s.owner_user_id
		ORDER BY m.student_code ASC
	`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	defer rows.Close()

	items := make([]StudentMappingRecord, 0)
	for rows.Next() {
		var item StudentMappingRecord
		if err := rows.Scan(
			&item.ID, &item.StudentCode, &item.StudentName, &item.DatabaseID,
			&item.DbPublicID, &item.DbName, &item.DbUser,
			&item.SiteID,
			&item.SitePublicID, &item.SiteName, &item.SiteSubdomain,
			&item.OwnerName,
			&item.DiscordUserID, &item.DiscordUsername,
			&item.Notes, &item.CreatedAt, &item.UpdatedAt,
		); err == nil {
			items = append(items, item)
		} else {
			log.Printf("[ERROR] adminListStudentMappings scan error: %v", err)
		}
	}

	return c.JSON(fiber.Map{"items": items})
}

// adminSaveStudentMapping creates or updates a mapping for Admin.
func (s *server) adminSaveStudentMapping(c *fiber.Ctx) error {
	var body struct {
		ID           int64  `json:"id"`
		StudentCode  string `json:"studentCode"`
		StudentName  string `json:"studentName"`
		DatabaseID   *int64 `json:"databaseId"`
		DbPublicID   string `json:"dbPublicId"`
		SiteID       *int64 `json:"siteId"`
		SitePublicID string `json:"sitePublicId"`
		Notes        string `json:"notes"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}

	code := strings.TrimSpace(body.StudentCode)
	if code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัส 3 ตัวท้าย", Code: "missing_code"})
	}

	var dbID *int64
	if body.DatabaseID != nil && *body.DatabaseID > 0 {
		dbID = body.DatabaseID
	} else if body.DbPublicID != "" {
		var foundDbID int64
		if err := s.db.QueryRow(c.Context(), `SELECT id FROM hosting_databases WHERE public_id = $1 OR db_name = $1`, body.DbPublicID).Scan(&foundDbID); err == nil && foundDbID > 0 {
			dbID = &foundDbID
		}
	}

	var siteID *int64
	if body.SiteID != nil && *body.SiteID > 0 {
		siteID = body.SiteID
	} else if body.SitePublicID != "" {
		var foundSiteID int64
		if err := s.db.QueryRow(c.Context(), `SELECT id FROM hosting_sites WHERE (public_id = $1 OR subdomain = $1) AND deleted_at IS NULL`, body.SitePublicID).Scan(&foundSiteID); err == nil && foundSiteID > 0 {
			siteID = &foundSiteID
		}
	}

	if dbID == nil && siteID == nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกฐานข้อมูลหรือเว็บไซต์อย่างน้อยหนึ่งรายการ", Code: "missing_target"})
	}

	var savedID int64
	err := s.db.QueryRow(c.Context(), `
		INSERT INTO student_db_mappings (student_code, student_name, database_id, site_id, notes, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (student_code) DO UPDATE
		SET student_name = EXCLUDED.student_name,
		    database_id = EXCLUDED.database_id,
		    site_id = EXCLUDED.site_id,
		    notes = EXCLUDED.notes,
		    updated_at = NOW()
		RETURNING id
	`, code, strings.TrimSpace(body.StudentName), dbID, siteID, strings.TrimSpace(body.Notes)).Scan(&savedID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	return c.JSON(fiber.Map{"success": true, "id": savedID, "studentCode": code})
}

// adminUnlinkStudentSite unlinks the hosting site from a student mapping record.
func (s *server) adminUnlinkStudentSite(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || id <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Invalid ID", Code: "invalid_id"})
	}
	_, err = s.db.Exec(c.Context(), `
		UPDATE student_db_mappings
		SET site_id = NULL, updated_at = NOW()
		WHERE id = $1
	`, id)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(fiber.Map{"success": true, "message": "ปลดการผูกเว็บไซต์เรียบร้อยแล้ว"})
}

// adminAutoDetectSiteMappings scans active hosting sites and automatically maps matching 3-digit student codes.
func (s *server) adminAutoDetectSiteMappings(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
		SELECT id, name, subdomain, public_id
		FROM hosting_sites
		WHERE deleted_at IS NULL
	`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	defer rows.Close()

	digitRegex := regexp.MustCompile(`(?:^|\D)(\d{3})(?:\D|$)`)
	mappedCount := 0

	for rows.Next() {
		var id int64
		var name, subdomain, pubID string
		if err := rows.Scan(&id, &name, &subdomain, &pubID); err != nil {
			continue
		}

		targetText := fmt.Sprintf("%s %s", subdomain, name)
		matches := digitRegex.FindStringSubmatch(targetText)
		var code string
		if len(matches) > 1 && matches[1] != "" {
			code = matches[1]
		}

		if code != "" {
			_, err := s.db.Exec(c.Context(), `
				INSERT INTO student_db_mappings (student_code, student_name, site_id, notes, updated_at)
				VALUES ($1, '', $2, 'ตรวจจับเว็บไซต์อัตโนมัติ', NOW())
				ON CONFLICT (student_code) DO UPDATE
				SET site_id = COALESCE(student_db_mappings.site_id, EXCLUDED.site_id),
				    updated_at = NOW()
				WHERE student_db_mappings.site_id IS NULL
			`, code, id)
			if err == nil {
				mappedCount++
			}
		}
	}

	return c.JSON(fiber.Map{"success": true, "mappedCount": mappedCount})
}

// botAutoDetectSiteMappings allows Discord Bot Admin to trigger auto-detection of site mappings.
func (s *server) botAutoDetectSiteMappings(c *fiber.Ctx) error {
	if err := s.requireBotStudentAdmin(c); err != nil {
		return err
	}
	return s.adminAutoDetectSiteMappings(c)
}

// adminDeleteStudentMapping deletes a mapping by ID.
func (s *server) adminDeleteStudentMapping(c *fiber.Ctx) error {
	idStr := c.Params("id")
	id, _ := strconv.ParseInt(idStr, 10, 64)
	if id == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รหัสไม่ถูกต้อง", Code: "invalid_id"})
	}

	_, err := s.db.Exec(c.Context(), `DELETE FROM student_db_mappings WHERE id = $1`, id)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// adminAutoDetectStudentMappings scans existing databases and automatically maps matching 3-digit student codes.
func (s *server) adminAutoDetectStudentMappings(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
		SELECT id, db_name, db_user, public_id
		FROM hosting_databases
		WHERE engine = 'mysql'
	`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	defer rows.Close()

	digitRegex := regexp.MustCompile(`(?:^|\D)(\d{3})(?:\D|$)`)
	mappedCount := 0

	for rows.Next() {
		var id int64
		var dbName, dbUser, pubID string
		if err := rows.Scan(&id, &dbName, &dbUser, &pubID); err != nil {
			continue
		}

		targetText := fmt.Sprintf("%s %s", dbName, dbUser)
		matches := digitRegex.FindStringSubmatch(targetText)
		var code string
		if len(matches) > 1 && matches[1] != "" {
			code = matches[1]
		}

		if code != "" {
			_, err := s.db.Exec(c.Context(), `
				INSERT INTO student_db_mappings (student_code, student_name, database_id, notes, updated_at)
				VALUES ($1, $2, $3, 'ตรวจจับอัตโนมัติ', NOW())
				ON CONFLICT (student_code) DO NOTHING
			`, code, "", id)
			if err == nil {
				mappedCount++
			}
		}
	}

	return c.JSON(fiber.Map{"success": true, "mappedCount": mappedCount})
}

// botListStudentMappings allows Discord Bot Admin to list mappings.
func (s *server) botListStudentMappings(c *fiber.Ctx) error {
	scope := "admin-map.list"
	if c.Get("X-Bot-Command-Scope") == "admin-map.scan-discord" {
		scope = "admin-map.scan-discord"
	}
	if err := s.requireBotScope(c, scope); err != nil {
		return err
	}
	return s.adminListStudentMappings(c)
}

// botSaveStudentMapping allows Discord Bot Admin to set a mapping.
func (s *server) botSaveStudentMapping(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "admin-map.set"); err != nil {
		return err
	}
	return s.adminSaveStudentMapping(c)
}

// botAutoDetectStudentMappings allows Discord Bot Admin to trigger auto-detection.
func (s *server) botAutoDetectStudentMappings(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "admin-map.auto-detect"); err != nil {
		return err
	}
	return s.adminAutoDetectStudentMappings(c)
}

// adminUnbindStudentDiscord unbinds discord account from student mapping
func (s *server) adminUnbindStudentDiscord(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil || id <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Invalid ID", Code: "invalid_id"})
	}
	var studentCode, discordUserID, discordUsername string
	var databaseID *int64
	err = s.db.QueryRow(c.Context(), `
		SELECT student_code, COALESCE(discord_user_id, ''), COALESCE(discord_username, ''), database_id
		FROM student_db_mappings WHERE id = $1
	`, id).Scan(&studentCode, &discordUserID, &discordUsername, &databaseID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบรหัสนี้ในระบบ", Code: "not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	s.recordStudentDiscordRevocation(c.Context(), studentCode, discordUserID, discordUsername)
	_, err = s.db.Exec(c.Context(), `
		UPDATE student_db_mappings
		SET discord_user_id = NULL, discord_username = NULL, updated_at = NOW()
		WHERE id = $1
	`, id)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	var dbID int64
	if databaseID != nil {
		dbID = *databaseID
	}
	s.cutStudentLiveAccess(c.Context(), studentCode, dbID)
	return c.JSON(fiber.Map{"success": true, "message": "ปลดการผูกบัญชี Discord และตัดสิทธิ์เข้าใช้งานเรียบร้อยแล้ว"})
}

// adminUnbindAllStudentDiscord unbinds all discord accounts from all student mappings
func (s *server) adminUnbindAllStudentDiscord(c *fiber.Ctx) error {
	rows, err := s.db.Query(c.Context(), `
		SELECT student_code, COALESCE(discord_user_id, ''), COALESCE(discord_username, ''), database_id
		FROM student_db_mappings
		WHERE discord_user_id IS NOT NULL AND discord_user_id <> ''
	`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	defer rows.Close()
	type pendingCut struct {
		code          string
		discordUserID string
		discordName   string
		databaseID    int64
	}
	var cuts []pendingCut
	for rows.Next() {
		var item pendingCut
		var databaseID *int64
		if scanErr := rows.Scan(&item.code, &item.discordUserID, &item.discordName, &databaseID); scanErr != nil {
			continue
		}
		if databaseID != nil {
			item.databaseID = *databaseID
		}
		cuts = append(cuts, item)
	}
	tag, err := s.db.Exec(c.Context(), `
		UPDATE student_db_mappings
		SET discord_user_id = NULL, discord_username = NULL, updated_at = NOW()
		WHERE discord_user_id IS NOT NULL AND discord_user_id <> ''
	`)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	for _, item := range cuts {
		s.cutStudentLiveAccess(c.Context(), item.code, item.databaseID)
	}
	return c.JSON(fiber.Map{
		"success":      true,
		"unboundCount": tag.RowsAffected(),
		"message":      "ปลดการผูกบัญชี Discord ทั้งหมด และตัดสิทธิ์เข้าใช้งานเรียบร้อยแล้ว",
	})
}

// botUnbindStudentDiscord allows Bot to unbind by student code
func (s *server) botUnbindStudentDiscord(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "admin-map.unbind"); err != nil {
		return err
	}
	var body struct {
		StudentCode string `json:"studentCode"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	code := strings.TrimSpace(body.StudentCode)
	if code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุรหัส 3 ตัวท้าย", Code: "missing_code"})
	}
	var discordUserID, discordUsername string
	var databaseID *int64
	err := s.db.QueryRow(c.Context(), `
		SELECT COALESCE(discord_user_id, ''), COALESCE(discord_username, ''), database_id
		FROM student_db_mappings WHERE LOWER(student_code) = LOWER($1)
	`, code).Scan(&discordUserID, &discordUsername, &databaseID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบรหัสนี้ในระบบ", Code: "not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	s.recordStudentDiscordRevocation(c.Context(), code, discordUserID, discordUsername)
	res, err := s.db.Exec(c.Context(), `
		UPDATE student_db_mappings
		SET discord_user_id = NULL, discord_username = NULL, updated_at = NOW()
		WHERE LOWER(student_code) = LOWER($1)
	`, code)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	if res.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบรหัสนี้ในระบบ", Code: "not_found"})
	}
	var dbID int64
	if databaseID != nil {
		dbID = *databaseID
	}
	s.cutStudentLiveAccess(c.Context(), code, dbID)
	return c.JSON(fiber.Map{"success": true, "message": fmt.Sprintf("ปลดการผูก Discord ของรหัส %s และตัดสิทธิ์เข้าใช้งานเรียบร้อยแล้ว", code)})
}

// botGetStudentByDiscord checks if a discord user ID is already bound to a student mapping (database and/or site).
func (s *server) botGetStudentByDiscord(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	discordUserID := strings.TrimSpace(c.Params("discordUserId"))
	if discordUserID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Missing discord user ID", Code: "missing_id"})
	}

	var item StudentMappingRecord
	err := s.db.QueryRow(c.Context(), `
		SELECT m.id, m.student_code, m.student_name, m.database_id,
		       COALESCE(d.public_id, ''), COALESCE(d.db_name, ''), COALESCE(d.db_user, ''),
		       m.site_id,
		       COALESCE(s.public_id, ''), COALESCE(s.name, ''), COALESCE(s.subdomain, ''),
		       COALESCE(u.identifier, COALESCE(su.identifier, '')),
		       COALESCE(m.discord_user_id, ''), COALESCE(m.discord_username, ''),
		       m.notes, m.created_at, m.updated_at
		FROM student_db_mappings m
		LEFT JOIN hosting_databases d ON d.id = m.database_id
		LEFT JOIN users u ON u.id = d.owner_id
		LEFT JOIN hosting_sites s ON s.id = m.site_id AND s.deleted_at IS NULL
		LEFT JOIN users su ON su.id = s.owner_user_id
		WHERE m.discord_user_id = $1
		LIMIT 1
	`, discordUserID).Scan(
		&item.ID, &item.StudentCode, &item.StudentName, &item.DatabaseID,
		&item.DbPublicID, &item.DbName, &item.DbUser,
		&item.SiteID,
		&item.SitePublicID, &item.SiteName, &item.SiteSubdomain,
		&item.OwnerName,
		&item.DiscordUserID, &item.DiscordUsername,
		&item.Notes, &item.CreatedAt, &item.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(fiber.Map{"bound": false})
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	res := fiber.Map{
		"bound":       true,
		"studentCode": item.StudentCode,
		"studentName": item.StudentName,
	}
	if item.DbPublicID != "" {
		res["database"] = fiber.Map{
			"id":   item.DbPublicID,
			"name": item.DbName,
			"user": item.DbUser,
		}
	}
	if item.SitePublicID != "" {
		res["site"] = fiber.Map{
			"id":        item.SitePublicID,
			"name":      item.SiteName,
			"subdomain": item.SiteSubdomain,
		}
	}
	return c.JSON(res)
}

// botBatchBindStudentDiscord allows the bot to batch bind members detected from discord guild
func (s *server) botBatchBindStudentDiscord(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "admin-map.scan-discord"); err != nil {
		return err
	}
	var body struct {
		Mappings []struct {
			StudentCode     string `json:"studentCode"`
			DiscordUserID   string `json:"discordUserId"`
			DiscordUsername string `json:"discordUsername"`
		} `json:"mappings"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Invalid body", Code: "invalid_body"})
	}

	boundCount := 0
	for _, m := range body.Mappings {
		code := strings.TrimSpace(m.StudentCode)
		dID := strings.TrimSpace(m.DiscordUserID)
		dUser := strings.TrimSpace(m.DiscordUsername)
		if code == "" || dID == "" {
			continue
		}
		// Only update if not already bound
		res, err := s.db.Exec(c.Context(), `
			UPDATE student_db_mappings
			SET discord_user_id = $1, discord_username = $2, updated_at = NOW()
			WHERE LOWER(student_code) = LOWER($3) AND (discord_user_id IS NULL OR discord_user_id = '')
		`, dID, dUser, code)
		if err == nil && res.RowsAffected() > 0 {
			boundCount++
		}
	}

	return c.JSON(fiber.Map{"success": true, "boundCount": boundCount})
}

// botGenerateStudentWorkspaceTicket handles Discord Bot requests to get a 1-click SSO ticket for Code Workspace.
func (s *server) botGenerateStudentWorkspaceTicket(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}

	var req BotStudentTicketRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}

	cleanCode, discordUserID, discordUsername, reqErr := normalizeBotStudentTicket(req)
	if reqErr.Code != "" {
		return c.Status(studentBindDenyStatus(reqErr.Code)).JSON(reqErr)
	}
	isAdmin := s.isDiscordStudentAdmin(discordUserID)

	type siteMatch struct {
		ID           int64
		PublicID     string
		Name         string
		Subdomain    string
		CustomDomain string
		ProjectType  string
		Status       string
		OwnerUserID  int64
	}

	var site siteMatch
	var mappingID int64
	var studentName, notes, matchedBy string
	var boundDiscordUserID, boundDiscordUsername *string
	var existingDbID *int64

	// Tier 1: Explicit mapping in student_db_mappings with site_id
	err := s.db.QueryRow(c.Context(), `
		SELECT m.id, m.student_name, m.notes, m.database_id,
		       s.id, s.public_id, s.name, s.subdomain, COALESCE(s.custom_domain, ''), s.project_type, s.status, s.owner_user_id,
		       m.discord_user_id, m.discord_username
		FROM student_db_mappings m
		JOIN hosting_sites s ON s.id = m.site_id AND s.deleted_at IS NULL
		WHERE LOWER(m.student_code) = LOWER($1)
	`, cleanCode).Scan(
		&mappingID, &studentName, &notes, &existingDbID,
		&site.ID, &site.PublicID, &site.Name, &site.Subdomain, &site.CustomDomain, &site.ProjectType, &site.Status, &site.OwnerUserID,
		&boundDiscordUserID, &boundDiscordUsername,
	)

	if err == nil {
		matchedBy = "mapping"
	} else if errors.Is(err, pgx.ErrNoRows) {
		// Fetch any existing mapping row without site_id (e.g. database-only or initial binding)
		_ = s.db.QueryRow(c.Context(), `
			SELECT id, student_name, notes, database_id, discord_user_id, discord_username
			FROM student_db_mappings
			WHERE LOWER(student_code) = LOWER($1)
		`, cleanCode).Scan(&mappingID, &studentName, &notes, &existingDbID, &boundDiscordUserID, &boundDiscordUsername)

		if existingDbID != nil && *existingDbID > 0 {
			err = s.db.QueryRow(c.Context(), `
				SELECT s.id, s.public_id, s.name, s.subdomain, COALESCE(s.custom_domain, ''), s.project_type, s.status, s.owner_user_id
				FROM hosting_sites s
				JOIN hosting_databases d ON d.site_id = s.id
				WHERE d.id = $1 AND s.deleted_at IS NULL
				ORDER BY s.id ASC
				LIMIT 1
			`, *existingDbID).Scan(
				&site.ID, &site.PublicID, &site.Name, &site.Subdomain, &site.CustomDomain, &site.ProjectType, &site.Status, &site.OwnerUserID,
			)
			if err == nil {
				matchedBy = "db_linked_site"
			}
		}

		if site.ID == 0 && isAdmin {
			pattern := "%" + cleanCode + "%"
			err = s.db.QueryRow(c.Context(), `
				SELECT s.id, s.public_id, s.name, s.subdomain, COALESCE(s.custom_domain, ''), s.project_type, s.status, s.owner_user_id
				FROM hosting_sites s
				WHERE (s.subdomain ILIKE $1 OR s.name ILIKE $1)
				  AND s.deleted_at IS NULL
				ORDER BY s.id ASC
				LIMIT 1
			`, pattern).Scan(
				&site.ID, &site.PublicID, &site.Name, &site.Subdomain, &site.CustomDomain, &site.ProjectType, &site.Status, &site.OwnerUserID,
			)
			if err == nil {
				matchedBy = "auto_site_pattern"
			} else if site.ID == 0 {
				var uIdent string
				err = s.db.QueryRow(c.Context(), `
					SELECT s.id, s.public_id, s.name, s.subdomain, COALESCE(s.custom_domain, ''), s.project_type, s.status, s.owner_user_id, u.identifier
					FROM users u
					JOIN hosting_sites s ON s.owner_user_id = u.id
					WHERE (u.identifier ILIKE $1 OR u.display_name ILIKE $1)
					  AND s.deleted_at IS NULL AND u.status = 'active'
					ORDER BY s.id DESC
					LIMIT 1
				`, pattern).Scan(
					&site.ID, &site.PublicID, &site.Name, &site.Subdomain, &site.CustomDomain, &site.ProjectType, &site.Status, &site.OwnerUserID, &uIdent,
				)
				if err == nil {
					matchedBy = "auto_user_pattern"
				}
			}
		}
	}

	if site.ID == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{
			Error: "ไม่พบรหัสนี้ ตรวจอีกครั้ง หรือติดต่อผู้ดูแล",
			Code:  "site_not_found",
		})
	}

	if !isAdmin && mappingID == 0 {
		return c.Status(fiber.StatusNotFound).JSON(apiError{
			Error: "ไม่พบรหัสนี้ ตรวจอีกครั้ง หรือติดต่อผู้ดูแล",
			Code:  "site_not_found",
		})
	}

	if deny := s.enforceStudentDiscordBind(c.Context(), isAdmin, mappingID, cleanCode, discordUserID, discordUsername, boundDiscordUserID, site.ID); deny.Code != "" {
		var logSiteID any = site.ID
		if site.ID <= 0 {
			logSiteID = nil
		}
		_, _ = s.db.Exec(c.Context(), `
			INSERT INTO student_workspace_access_logs (student_code, site_id, discord_user_id, discord_username, status, ip)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, cleanCode, logSiteID, discordUserID, discordUsername, studentBindLogStatus(deny.Code), c.IP())
		return c.Status(studentBindDenyStatus(deny.Code)).JSON(deny)
	}

	// Generate SSO Ticket (32 bytes crypto random hex string, 64 chars)
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	token := hex.EncodeToString(raw)
	expiresAt := time.Now().UTC().Add(5 * time.Minute)

	ticketPayload := WorkspaceSSOTicket{
		StudentCode:     cleanCode,
		SiteID:          site.ID,
		SitePublicID:    site.PublicID,
		OwnerUserID:     site.OwnerUserID,
		DiscordUserID:   discordUserID,
		DiscordUsername: discordUsername,
		IsAdmin:         isAdmin,
		CreatedAt:       time.Now().UTC(),
	}

	ticketBytes, err := json.Marshal(ticketPayload)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if err := s.redis.Set(c.Context(), workspaceLaunchKey(token), ticketBytes, 5*time.Minute).Err(); err != nil {
		log.Printf("[ERROR] botGenerateStudentWorkspaceTicket redis set error: %v", err)
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}

	// Record success audit log
	var logSiteID any = site.ID
	if site.ID <= 0 {
		logSiteID = nil
	}
	_, _ = s.db.Exec(c.Context(), `
		INSERT INTO student_workspace_access_logs (student_code, site_id, discord_user_id, discord_username, status, ip)
		VALUES ($1, $2, $3, $4, 'success', $5)
	`, cleanCode, logSiteID, discordUserID, discordUsername, c.IP())

	// Build destination URLs
	baseDomain := strings.TrimRight(strings.TrimSpace(req.PreferredDomain), "/")
	if baseDomain == "" {
		baseDomain = "https://nkn02.com"
	}
	codeURL := fmt.Sprintf("https://code-%s.nkn02.com", site.Subdomain)
	if baseDomain != "https://nkn02.com" && strings.Contains(baseDomain, "localhost") {
		codeURL = fmt.Sprintf("http://code-%s.localhost:8088", site.Subdomain)
	}

	return c.JSON(fiber.Map{
		"success":      true,
		"studentCode":  cleanCode,
		"studentName":  studentName,
		"matchedBy":    matchedBy,
		"ticket":       token,
		"url":          codeURL,
		"workspaceUrl": codeURL,
		"cUrl":         codeURL,
		"expiresAt":    expiresAt,
		"site": fiber.Map{
			"id":           site.PublicID,
			"name":         site.Name,
			"subdomain":    site.Subdomain,
			"customDomain": site.CustomDomain,
			"projectType":  site.ProjectType,
			"status":       site.Status,
		},
	})
}

// consumeWorkspaceTicket handles direct POST /api/auth/workspace/ticket/consume.
func (s *server) consumeWorkspaceTicket(c *fiber.Ctx) error {
	var body workspaceTicketConsumeRequest
	if err := c.BodyParser(&body); err != nil || len(body.Ticket) < 24 || len(body.Ticket) > 128 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ลิงก์ไม่ถูกต้อง", Code: "invalid_ticket"})
	}
	return s.consumeWorkspaceTicketWithTicket(c, body.Ticket)
}

// consumeWorkspaceTicketWithTicket performs atomic single-use redemption of a workspace launch ticket.
func (s *server) consumeWorkspaceTicketWithTicket(c *fiber.Ctx, ticket string) error {
	value, err := s.redis.GetDel(c.Context(), workspaceLaunchKey(ticket)).Bytes()
	if err != nil {
		return c.Status(fiber.StatusGone).JSON(apiError{
			Error: "ลิงก์นี้หมดอายุแล้ว หรือถูกใช้งานไปแล้ว",
			Code:  "ticket_expired",
		})
	}

	var ticketData WorkspaceSSOTicket
	if err := json.Unmarshal(value, &ticketData); err != nil || ticketData.OwnerUserID <= 0 || ticketData.SitePublicID == "" {
		return c.Status(fiber.StatusGone).JSON(apiError{
			Error: "ลิงก์นี้หมดอายุแล้ว หรือถูกใช้งานไปแล้ว",
			Code:  "ticket_expired",
		})
	}

	var ownerUser currentUser
	err = s.db.QueryRow(c.Context(), `
		SELECT id, identifier, display_name, COALESCE(email, ''), COALESCE(avatar_url, ''),
		       role, status, password_enabled, points
		FROM users
		WHERE id = $1
	`, ticketData.OwnerUserID).Scan(
		&ownerUser.ID,
		&ownerUser.Username,
		&ownerUser.DisplayName,
		&ownerUser.Email,
		&ownerUser.AvatarURL,
		&ownerUser.Role,
		&ownerUser.Status,
		&ownerUser.PasswordEnabled,
		&ownerUser.Points,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusNotFound).JSON(apiError{
				Error: "ไม่พบบัญชีผู้ใช้งานที่เป็นเจ้าของเว็บไซต์นี้",
				Code:  "user_not_found",
			})
		}
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	if ownerUser.Status != "active" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{
			Error: "บัญชีเจ้าของเว็บไซต์นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
			Code:  "account_suspended",
		})
	}

	if !ticketData.IsAdmin && s.isStudentDiscordRevoked(c.Context(), ticketData.StudentCode, ticketData.DiscordUserID) {
		return c.Status(fiber.StatusForbidden).JSON(studentAccessRevokedJSON())
	}

	ownerUser.Permissions = permissionsForRole(ownerUser.Role)

	if err := s.createSession(c, &ownerUser); err != nil {
		log.Printf("[ERROR] consumeWorkspaceTicket createSession failed: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.db.Exec(c.Context(), `UPDATE users SET last_login_at = NOW() WHERE id = $1`, ownerUser.ID)

	var logSiteID any = ticketData.SiteID
	if ticketData.SiteID <= 0 {
		logSiteID = nil
	}
	_, _ = s.db.Exec(c.Context(), `
		INSERT INTO student_workspace_access_logs
			(student_code, site_id, discord_user_id, discord_username, status, ip)
		VALUES ($1, $2, $3, $4, 'sso_redeemed', $5)
	`, ticketData.StudentCode, logSiteID, ticketData.DiscordUserID, ticketData.DiscordUsername, c.IP())

	s.audit(c, auditEvent{
		Actor:    &ownerUser,
		Category: "workspace",
		Action:   "workspace.sso_login",
		Target:   "hosting_site",
		TargetID: ticketData.SitePublicID,
		Outcome:  "success",
		Metadata: map[string]any{
			"studentCode":     ticketData.StudentCode,
			"siteId":          ticketData.SiteID,
			"sitePublicId":    ticketData.SitePublicID,
			"discordUserId":   ticketData.DiscordUserID,
			"discordUsername": ticketData.DiscordUsername,
			"isAdmin":         ticketData.IsAdmin,
			"loginType":       "1click_sso",
		},
	})

	// Pre-create code-server access token for seamless VS Code SSO
	rawToken := make([]byte, 32)
	_, _ = rand.Read(rawToken)
	workspaceToken := hex.EncodeToString(rawToken)
	_, _ = s.db.Exec(c.Context(), `
		INSERT INTO hosting_workspace_access_tokens
			(token_hash, site_id, site_public_id, user_id, student_code, expires_at)
		VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '4 HOURS')
	`, tokenHash(workspaceToken), ticketData.SiteID, ticketData.SitePublicID, ownerUser.ID, ticketData.StudentCode)

	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{
		"success":        true,
		"siteId":         ticketData.SitePublicID,
		"redirectUrl":    "/workspace?id=" + ticketData.SitePublicID,
		"workspaceToken": workspaceToken,
	})
}
