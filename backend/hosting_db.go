package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

func generateDatabasePassword() string {
	value := make([]byte, 24)
	if _, err := rand.Read(value); err != nil {
		panic("secure random source unavailable")
	}
	return hex.EncodeToString(value)
}

func mysqlAccountName(user string) string {
	return "'" + strings.ReplaceAll(user, "'", "''") + "'@'%'"
}

func (s *server) rotateTenantDatabasePassword(ctx context.Context, databaseID int64) error {
	if databaseID <= 0 {
		return nil
	}
	var dbName, dbUser, oldCiphertext string
	var siteID *int64
	err := s.db.QueryRow(ctx, `SELECT db_name, db_user, db_password_enc, site_id FROM hosting_databases WHERE id=$1`, databaseID).Scan(&dbName, &dbUser, &oldCiphertext, &siteID)
	if err != nil {
		return err
	}
	newPass := generateDatabasePassword()
	ciphertext, err := encryptSecret(newPass, s.cfg.hostingEncryptionKey)
	if err != nil {
		return err
	}
	admin, err := sql.Open("mysql", s.cfg.tenantMySQLDSN)
	if err != nil {
		return err
	}
	defer admin.Close()
	escapedPass := strings.ReplaceAll(newPass, "'", "''")
	if _, err := admin.ExecContext(ctx, "ALTER USER "+mysqlAccountName(dbUser)+" IDENTIFIED BY '"+escapedPass+"'"); err != nil {
		return err
	}
	if _, err = s.db.Exec(ctx, `UPDATE hosting_databases SET db_password_enc=$1, updated_at=NOW() WHERE id=$2`, ciphertext, databaseID); err != nil {
		return err
	}
	if siteID != nil {
		if oldPass, decryptErr := decryptSecret(oldCiphertext, s.cfg.hostingEncryptionKey); decryptErr == nil {
			s.updateSitePasswordVariables(ctx, *siteID, oldPass, newPass)
		}
	}
	return nil
}

// updateSitePasswordVariables gives the new database password to the website that uses it. A
// site keeps its database password in environment variables (DB_PASS, DB_PASSWORD...); after a
// rotation those still held the old one and the site lost its database (124snru, 2026-10). Every
// variable whose value was the old password gets the new one, and the site is restarted.
func (s *server) updateSitePasswordVariables(ctx context.Context, siteID int64, oldPass, newPass string) {
	if oldPass == "" {
		return
	}
	rows, err := s.db.Query(ctx, `SELECT id, value_ciphertext FROM hosting_environment_variables WHERE site_id=$1`, siteID)
	if err != nil {
		log.Printf("[ERROR] site %d password variables: %v", siteID, err)
		return
	}
	var matches []int64
	for rows.Next() {
		var id int64
		var value string
		if rows.Scan(&id, &value) != nil {
			continue
		}
		if plain, err := decryptSecret(value, s.cfg.hostingEncryptionKey); err == nil && plain == oldPass {
			matches = append(matches, id)
		}
	}
	rows.Close()
	if len(matches) == 0 {
		return
	}
	newCiphertext, err := encryptSecret(newPass, s.cfg.hostingEncryptionKey)
	if err != nil {
		return
	}
	if _, err := s.db.Exec(ctx, `UPDATE hosting_environment_variables SET value_ciphertext=$1, updated_at=NOW() WHERE id = ANY($2)`, newCiphertext, matches); err != nil {
		log.Printf("[ERROR] site %d password variables update: %v", siteID, err)
		return
	}
	// Restart so the running container reads the new value; skipped when another job is running,
	// which restarts it anyway.
	_, err = s.db.Exec(ctx, `
		INSERT INTO hosting_operations
		  (operation_id,site_id,actor_user_id,kind,idempotency_key,request_hash,state,phase,
		   started_at,timeout_seconds,error_code,error_message,retryable,metadata)
		SELECT $1, s.id, s.owner_user_id, 'runtime.restart', $2, $3, 'queued', 'pending', NOW(), 300, '', '', TRUE,
		       jsonb_build_object('sitePublicId', s.public_id, 'reason', 'database_password_rotated')
		FROM hosting_sites s
		WHERE s.id=$4 AND s.deleted_at IS NULL AND s.status='running'
		ON CONFLICT DO NOTHING
	`, randomHex(16), "db-rotate-"+randomHex(12), requestDigest("runtime.restart", []byte(newCiphertext)), siteID)
	if err != nil {
		log.Printf("[ERROR] site %d restart after password rotation: %v", siteID, err)
	}
}

func quoteMySQLIdentifier(value string) string {
	return "`" + strings.ReplaceAll(value, "`", "``") + "`"
}

func (s *server) provisionDatabase(ctx context.Context, siteID int64, sitePublicID string) (string, string, string, error) {
	shortID := strings.ToLower(strings.ReplaceAll(sitePublicID, "-", ""))
	if len(shortID) > 12 {
		shortID = shortID[:12]
	}
	suffix := randomHex(4)
	dbName := "nxdb_" + shortID + "_" + suffix
	dbUser := "nxu_" + shortID + "_" + suffix
	dbPass := generateDatabasePassword()
	publicID := randomHex(16)
	ciphertext, err := encryptSecret(dbPass, s.cfg.hostingEncryptionKey)
	if err != nil {
		return "", "", "", err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return "", "", "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, siteID); err != nil {
		return "", "", "", err
	}
	var maximum, count int
	var ownerID int64
	if err := tx.QueryRow(ctx, `SELECT max_databases, owner_user_id FROM hosting_sites WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, siteID).Scan(&maximum, &ownerID); err != nil {
		return "", "", "", err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM hosting_databases WHERE site_id=$1 AND status='error'`, siteID); err != nil {
		return "", "", "", err
	}
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM hosting_databases WHERE site_id=$1 AND status <> 'deleted'`, siteID).Scan(&count); err != nil {
		return "", "", "", err
	}
	if count >= maximum {
		return "", "", "", errors.New("database quota exceeded")
	}
	isPrimary := count == 0
	_, err = tx.Exec(ctx, `
		INSERT INTO hosting_databases
			(public_id,site_id,owner_id,db_name,db_user,db_password_enc,status,engine,host,port,is_primary)
		VALUES ($1,$2,$3,$4,$5,$6,'provisioning','mysql','nexora-tenant-db',3306,$7)
	`, publicID, siteID, ownerID, dbName, dbUser, ciphertext, isPrimary)
	if err != nil {
		return "", "", "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", "", err
	}

	admin, err := sql.Open("mysql", s.cfg.tenantMySQLDSN)
	if err != nil {
		log.Printf("tenant MySQL open error: %v", err)
		s.markDatabaseProvisionFailed(ctx, publicID, "tenant_database_unavailable")
		return "", "", "", errors.New("tenant MySQL unavailable: " + err.Error())
	}
	defer admin.Close()
	if err := admin.PingContext(ctx); err != nil {
		log.Printf("tenant MySQL ping error (DSN=%s): %v", s.cfg.tenantMySQLDSN, err)
		s.markDatabaseProvisionFailed(ctx, publicID, "tenant_database_unavailable")
		return "", "", "", errors.New("tenant MySQL unavailable: " + err.Error())
	}
	dbIdentifier := quoteMySQLIdentifier(dbName)
	userAccount := "'" + dbUser + "'@'%'"
	cleanup := true
	defer func() {
		if cleanup {
			_, _ = admin.ExecContext(context.Background(), "DROP DATABASE IF EXISTS "+dbIdentifier)
			_, _ = admin.ExecContext(context.Background(), "DROP USER IF EXISTS "+userAccount)
		}
	}()
	if _, err := admin.ExecContext(ctx, "CREATE DATABASE "+dbIdentifier+" CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); err != nil {
		s.markDatabaseProvisionFailed(ctx, publicID, "database_create_failed")
		return "", "", "", err
	}
	if _, err := admin.ExecContext(ctx, fmt.Sprintf("CREATE USER %s IDENTIFIED BY '%s'", userAccount, dbPass)); err != nil {
		s.markDatabaseProvisionFailed(ctx, publicID, "user_create_failed")
		return "", "", "", err
	}
	if _, err := admin.ExecContext(ctx, "GRANT ALL PRIVILEGES ON "+dbIdentifier+".* TO "+userAccount); err != nil {
		s.markDatabaseProvisionFailed(ctx, publicID, "grant_failed")
		return "", "", "", err
	}
	if _, err := admin.ExecContext(ctx, "ALTER USER "+userAccount+" WITH MAX_USER_CONNECTIONS 10"); err != nil {
		s.markDatabaseProvisionFailed(ctx, publicID, "connection_limit_failed")
		return "", "", "", err
	}
	cleanup = false
	_, err = s.db.Exec(ctx, `
		UPDATE hosting_databases
		SET status='running',last_checked_at=NOW(),last_error_code='',updated_at=NOW()
		WHERE public_id=$1
	`, publicID)
	if err != nil {
		return "", "", "", err
	}
	return dbName, dbUser, dbPass, nil
}

func (s *server) markDatabaseProvisionFailed(ctx context.Context, publicID, code string) {
	_, _ = s.db.Exec(ctx, `
		UPDATE hosting_databases
		SET status='error',last_error_code=$2,last_checked_at=NOW(),updated_at=NOW()
		WHERE public_id=$1
	`, publicID, code)
}

func (s *server) testTenantDatabaseConnection(ctx context.Context, name, user, password string) error {
	connection, err := sql.Open("mysql", fmt.Sprintf("%s:%s@tcp(tenant-db:3306)/%s?parseTime=true&timeout=5s", user, password, name))
	if err != nil {
		return err
	}
	defer connection.Close()
	var one int
	return connection.QueryRowContext(ctx, "SELECT 1").Scan(&one)
}

func (s *server) ensureTenantDatabaseCredential(ctx context.Context, name, user, password string) error {
	err := s.testTenantDatabaseConnection(ctx, name, user, password)
	if err == nil {
		return nil
	}

	var mysqlErr *mysql.MySQLError
	if !errors.As(err, &mysqlErr) || mysqlErr.Number != 1045 {
		return err
	}

	admin, openErr := sql.Open("mysql", s.cfg.tenantMySQLDSN)
	if openErr != nil {
		return openErr
	}
	defer admin.Close()

	userAccount := "'" + strings.ReplaceAll(user, "'", "''") + "'@'%'"
	escapedPassword := strings.ReplaceAll(password, "'", "''")
	if _, repairErr := admin.ExecContext(ctx, fmt.Sprintf("ALTER USER %s IDENTIFIED BY '%s'", userAccount, escapedPassword)); repairErr != nil {
		return repairErr
	}

	return s.testTenantDatabaseConnection(ctx, name, user, password)
}

func (s *server) testHostingSiteDatabase(c *fiber.Ctx) error {
	actor := current(c)
	site, err := s.loadHostingSite(c.Context(), actor, c.Params("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if site.AccessRole == "viewer" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์ตรวจสอบการเชื่อมต่อฐานข้อมูล", Code: "hosting_access_denied"})
	}
	var databaseID int64
	var publicID, name, user, ciphertext string
	err = s.db.QueryRow(c.Context(), `
		SELECT id,public_id,db_name,db_user,db_password_enc
		FROM hosting_databases
		WHERE site_id=(SELECT id FROM hosting_sites WHERE public_id=$1 AND deleted_at IS NULL)
		  AND status<>'deleted'
		ORDER BY is_primary DESC,id ASC LIMIT 1
	`, site.ID).Scan(&databaseID, &publicID, &name, &user, &ciphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบฐานข้อมูล", Code: "database_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	password, err := decryptSecret(ciphertext, s.cfg.hostingEncryptionKey)
	if err != nil || password == "" {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ไม่สามารถอ่านข้อมูลเชื่อมต่อฐานข้อมูลได้", Code: "credential_unavailable"})
	}
	if err = s.testTenantDatabaseConnection(c.Context(), name, user, password); err != nil {
		_, _ = s.db.Exec(c.Context(), `UPDATE hosting_databases SET status='error',last_checked_at=NOW(),last_error_code='connection_failed',updated_at=NOW() WHERE id=$1`, databaseID)
		s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.database.connection_tested", Target: "hosting_database", TargetID: publicID, Outcome: "failed"})
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ", Code: "connection_failed"})
	}
	_, _ = s.db.Exec(c.Context(), `UPDATE hosting_databases SET status='running',last_checked_at=NOW(),last_error_code='',updated_at=NOW() WHERE id=$1`, databaseID)
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.database.connection_tested", Target: "hosting_database", TargetID: publicID})
	return c.JSON(fiber.Map{"ok": true, "status": "running"})
}

func (s *server) provisionStandaloneDatabase(ctx context.Context, ownerID int64) (string, string, string, error) {
	suffix := randomHex(6)
	dbName := "nxdb_sa_" + suffix
	dbUser := "nxu_sa_" + suffix
	dbPass := generateDatabasePassword()
	publicID := randomHex(16)
	ciphertext, err := encryptSecret(dbPass, s.cfg.hostingEncryptionKey)
	if err != nil {
		return "", "", "", err
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return "", "", "", err
	}
	defer tx.Rollback(ctx)

	// No quota check for admins right now, since it's an admin action
	_, err = tx.Exec(ctx, `
		INSERT INTO hosting_databases
			(public_id,site_id,owner_id,db_name,db_user,db_password_enc,status,engine,host,port,is_primary)
		VALUES ($1,NULL,$2,$3,$4,$5,'provisioning','mysql','tenant-db',3306,false)
	`, publicID, ownerID, dbName, dbUser, ciphertext)
	if err != nil {
		return "", "", "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", "", err
	}

	admin, err := sql.Open("mysql", s.cfg.tenantMySQLDSN)
	if err != nil {
		s.markDatabaseProvisionFailed(ctx, publicID, "tenant_database_unavailable")
		return "", "", "", errors.New("tenant MySQL unavailable")
	}
	defer admin.Close()

	dbIdentifier := quoteMySQLIdentifier(dbName)
	userAccount := "'" + dbUser + "'@'%'"

	if _, err := admin.ExecContext(ctx, "CREATE DATABASE "+dbIdentifier+" CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"); err != nil {
		s.markDatabaseProvisionFailed(ctx, publicID, "database_create_failed")
		return "", "", "", err
	}
	if _, err := admin.ExecContext(ctx, fmt.Sprintf("CREATE USER %s IDENTIFIED BY '%s'", userAccount, dbPass)); err != nil {
		s.markDatabaseProvisionFailed(ctx, publicID, "user_create_failed")
		return "", "", "", err
	}
	if _, err := admin.ExecContext(ctx, "GRANT ALL PRIVILEGES ON "+dbIdentifier+".* TO "+userAccount); err != nil {
		s.markDatabaseProvisionFailed(ctx, publicID, "user_grant_failed")
		return "", "", "", err
	}

	_, _ = s.db.Exec(ctx, "UPDATE hosting_databases SET status='provisioned' WHERE public_id=$1", publicID)
	return dbName, dbUser, dbPass, nil
}
