package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

func (s *server) adminCreateDatabase(c *fiber.Ctx) error {
	var body struct {
		OwnerUsername string `json:"ownerUsername"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request")
	}
	var ownerID int64
	if body.OwnerUsername == "" {
		cur := current(c)
		if cur == nil {
			return fiber.NewError(fiber.StatusUnauthorized, "unauthorized")
		}
		ownerID = cur.ID
	} else {
		if err := s.db.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(identifier)=LOWER($1) AND status='active'`, body.OwnerUsername).Scan(&ownerID); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "user not found or inactive")
		}
	}

	dbName, dbUser, dbPass, err := s.provisionStandaloneDatabase(c.Context(), ownerID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	forgetTenantDatabaseSizes()
	s.audit(c, auditEvent{Actor: current(c), Category: "hosting", Action: "hosting.database.created", Target: "hosting_database", TargetID: dbName,
		Metadata: map[string]any{"name": dbName, "ownerUserId": ownerID}})

	return c.JSON(fiber.Map{"success": true, "dbName": dbName, "dbUser": dbUser, "dbPass": dbPass})
}

var mysqlAccountNamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{1,32}$`)

// setDatabaseSuspended suspends or restores one tenant database. Suspending locks the MySQL
// account and closes its open connections, so sites using it really stop reaching the data;
// restoring unlocks it. MySQL is changed first: if that fails, the status stays as it was.
func (s *server) setDatabaseSuspended(ctx context.Context, publicID string, suspend bool) (string, error) {
	var dbName, dbUser string
	if err := s.db.QueryRow(ctx, `SELECT db_name, db_user FROM hosting_databases WHERE public_id=$1`, publicID).Scan(&dbName, &dbUser); err != nil {
		return "", err
	}
	if !mysqlAccountNamePattern.MatchString(dbUser) {
		return dbName, errors.New("unexpected database user name")
	}
	pool := s.tenantMySQLPool()
	if pool == nil {
		return dbName, errors.New("tenant MySQL unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	hosts, err := pool.QueryContext(ctx, `SELECT host FROM mysql.user WHERE user = ?`, dbUser)
	if err != nil {
		return dbName, err
	}
	accounts := []string{}
	for hosts.Next() {
		var host string
		if hosts.Scan(&host) == nil {
			accounts = append(accounts, "'"+dbUser+"'@'"+strings.ReplaceAll(host, "'", "''")+"'")
		}
	}
	hosts.Close()
	lock := "ACCOUNT UNLOCK"
	if suspend {
		lock = "ACCOUNT LOCK"
	}
	for _, account := range accounts {
		if _, err := pool.ExecContext(ctx, "ALTER USER "+account+" "+lock); err != nil {
			return dbName, err
		}
	}
	if suspend {
		// A lock only refuses new logins; connections already open would keep working.
		if open, err := pool.QueryContext(ctx, `SELECT id FROM information_schema.processlist WHERE user = ?`, dbUser); err == nil {
			ids := []int64{}
			for open.Next() {
				var id int64
				if open.Scan(&id) == nil {
					ids = append(ids, id)
				}
			}
			open.Close()
			for _, id := range ids {
				_, _ = pool.ExecContext(ctx, "KILL "+strconv.FormatInt(id, 10))
			}
		}
	}
	status := "provisioned"
	if suspend {
		status = "suspended"
	}
	if _, err := s.db.Exec(ctx, `UPDATE hosting_databases SET status=$1, updated_at=NOW() WHERE public_id=$2`, status, publicID); err != nil {
		return dbName, err
	}
	return dbName, nil
}

func databaseSuspendAction(suspend bool) string {
	if suspend {
		return "hosting.database.suspended"
	}
	return "hosting.database.unsuspended"
}

func (s *server) adminSuspendDatabase(c *fiber.Ctx) error {
	publicID := c.Params("id")
	var body struct {
		Suspend bool `json:"suspend"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request")
	}
	dbName, err := s.setDatabaseSuspended(c.Context(), publicID, body.Suspend)
	if errors.Is(err, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusNotFound, "database not found")
	}
	if err != nil {
		log.Printf("database suspend failed: id=%s suspend=%v", publicID, body.Suspend)
		return c.Status(fiber.StatusBadGateway).JSON(apiError{Error: "เปลี่ยนสถานะใน MySQL ไม่สำเร็จ สถานะเดิมยังไม่ถูกเปลี่ยน", Code: "mysql_lock_failed"})
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "hosting", Action: databaseSuspendAction(body.Suspend), Target: "hosting_database", TargetID: publicID,
		Metadata: map[string]any{"name": dbName}})
	return c.SendStatus(fiber.StatusNoContent)
}

// adminBulkSuspendDatabases changes several databases at once and writes one audit entry
// (one alert) for the whole batch instead of one per database.
func (s *server) adminBulkSuspendDatabases(c *fiber.Ctx) error {
	var body struct {
		IDs     []string `json:"ids"`
		Suspend bool     `json:"suspend"`
	}
	if err := c.BodyParser(&body); err != nil || len(body.IDs) == 0 || len(body.IDs) > 200 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เลือกฐานข้อมูล 1–200 รายการ", Code: "invalid_selection"})
	}
	done, failed := []string{}, []string{}
	seen := map[string]bool{}
	for _, id := range body.IDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		name, err := s.setDatabaseSuspended(c.Context(), id, body.Suspend)
		if err != nil {
			failed = append(failed, firstNonEmpty(name, id))
			continue
		}
		done = append(done, name)
	}
	if len(done) > 0 {
		s.audit(c, auditEvent{Actor: current(c), Category: "hosting", Action: databaseSuspendAction(body.Suspend), Target: "hosting_database",
			TargetID: strconv.Itoa(len(done)) + " databases",
			Metadata: map[string]any{"name": strings.Join(done, ", "), "count": len(done), "failed": strings.Join(failed, ", ")}})
	}
	return c.JSON(fiber.Map{"done": done, "failed": failed})
}

func (s *server) adminResetDatabasePassword(c *fiber.Ctx) error {
	publicID := c.Params("id")

	var dbName, dbUser string
	if err := s.db.QueryRow(c.Context(), "SELECT db_name, db_user FROM hosting_databases WHERE public_id=$1", publicID).Scan(&dbName, &dbUser); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fiber.NewError(fiber.StatusNotFound, "database not found")
		}
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	newPass := generateDatabasePassword()
	ciphertext, err := encryptSecret(newPass, s.cfg.hostingEncryptionKey)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	admin, err := sql.Open("mysql", s.cfg.tenantMySQLDSN)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "tenant database connection failed")
	}
	defer admin.Close()

	userAccount := "'" + dbUser + "'@'%'"
	if _, err := admin.ExecContext(c.Context(), fmt.Sprintf("ALTER USER %s IDENTIFIED BY '%s'", userAccount, newPass)); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to update password in mysql")
	}

	if _, err := s.db.Exec(c.Context(), "UPDATE hosting_databases SET db_password_enc=$1, updated_at=NOW() WHERE public_id=$2", ciphertext, publicID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to update password record")
	}

	return c.JSON(fiber.Map{"success": true, "newPassword": newPass})
}

func (s *server) adminTransferDatabase(c *fiber.Ctx) error {
	publicID := c.Params("id")
	var body struct {
		OwnerUsername string `json:"ownerUsername"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request")
	}
	if body.OwnerUsername == "" {
		return fiber.NewError(fiber.StatusBadRequest, "ownerUsername is required")
	}

	var newOwnerID int64
	if err := s.db.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(identifier)=LOWER($1) AND status='active'`, body.OwnerUsername).Scan(&newOwnerID); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "user not found or inactive")
	}

	cmd, err := s.db.Exec(c.Context(), "UPDATE hosting_databases SET owner_id=$1, updated_at=NOW() WHERE public_id=$2", newOwnerID, publicID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "database error")
	}
	if cmd.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "database not found")
	}

	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) adminDeleteDatabase(c *fiber.Ctx) error {
	publicID := c.Params("id")

	var dbName, dbUser string
	if err := s.db.QueryRow(c.Context(), "SELECT db_name, db_user FROM hosting_databases WHERE public_id=$1", publicID).Scan(&dbName, &dbUser); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fiber.NewError(fiber.StatusNotFound, "database not found")
		}
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	// Remove from MySQL
	admin, err := sql.Open("mysql", s.cfg.tenantMySQLDSN)
	if err == nil {
		dbIdentifier := quoteMySQLIdentifier(dbName)
		userAccount := "'" + dbUser + "'@'%'"
		_, _ = admin.ExecContext(c.Context(), "DROP DATABASE IF EXISTS "+dbIdentifier)
		_, _ = admin.ExecContext(c.Context(), "DROP USER IF EXISTS "+userAccount)
		admin.Close()
	}

	// Remove from pg
	if _, err := s.db.Exec(c.Context(), "DELETE FROM hosting_databases WHERE public_id=$1", publicID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to delete record")
	}
	forgetTenantDatabaseSizes()
	s.audit(c, auditEvent{Actor: current(c), Category: "hosting", Action: "hosting.database.deleted", Target: "hosting_database", TargetID: publicID,
		Metadata: map[string]any{"name": dbName}})

	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) adminCreatePhpMyAdminTicket(c *fiber.Ctx) error {
	actor := current(c)
	dbIDStr := c.Params("id")

	var dbPublicID, engine, status string
	var realDbID int64
	var siteID sql.NullInt64

	err := s.db.QueryRow(c.Context(), `
		SELECT id, public_id, engine, site_id, status
		FROM hosting_databases
		WHERE public_id = $1 OR id::text = $1
	`, dbIDStr).Scan(&realDbID, &dbPublicID, &engine, &siteID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบฐานข้อมูล", Code: "database_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if engine != "mysql" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "phpMyAdmin ใช้ได้กับ MySQL เท่านั้น", Code: "engine_not_supported"})
	}
	if blocked := databaseAccessBlocked(status); blocked != nil {
		return c.Status(fiber.StatusLocked).JSON(blocked)
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	token := hex.EncodeToString(raw)
	expiresAt := time.Now().UTC().Add(45 * time.Second)

	var sID *int64
	if siteID.Valid {
		sID = &siteID.Int64
	}

	_, err = s.db.Exec(c.Context(), `
		INSERT INTO hosting_database_access_tickets
			(token_hash, user_id, session_id, site_id, database_id, ip_hash, user_agent_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, tokenHash(token), actor.ID, actor.SessionID, sID, realDbID,
		hashBinding(requestForwardedIP(c)), hashBinding(strings.TrimSpace(c.Get(fiber.HeaderUserAgent))), expiresAt)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	s.audit(c, auditEvent{
		Actor: actor, Category: "admin", Action: "admin.database.phpmyadmin_ticket_created",
		Target: "hosting_database", TargetID: dbPublicID,
	})

	pmaURL := s.cfg.phpMyAdminPublicURL
	if host := c.Get("X-Forwarded-Host"); host != "" && !strings.Contains(host, "localhost") {
		proto := c.Get("X-Forwarded-Proto")
		if proto == "" {
			proto = "https"
		}
		pmaURL = fmt.Sprintf("%s://db.%s", proto, host)
	} else if host := c.Hostname(); host != "" && !strings.Contains(host, "localhost") {
		pmaURL = fmt.Sprintf("https://db.%s", host)
	}

	return c.JSON(fiber.Map{
		"url":       pmaURL + "/login",
		"ticket":    token,
		"expiresIn": 45,
	})
}
