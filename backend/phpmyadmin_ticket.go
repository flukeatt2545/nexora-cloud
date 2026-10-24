package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

const phpMyAdminTicketTTL = 45 * time.Second

func hashBinding(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func requestForwardedIP(c *fiber.Ctx) string {
	return extractRealIP(c)
}

func (s *server) createSecurePhpMyAdminTicket(c *fiber.Ctx) error {
	actor := current(c)
	site, err := s.loadHostingSite(c.Context(), actor, c.Params("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if site.AccessRole == "viewer" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "บัญชีนี้ไม่มีสิทธิ์เปิด phpMyAdmin", Code: "forbidden"})
	}
	var body struct {
		DatabaseID string `json:"databaseId"`
		DbName     string `json:"dbName"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	var siteID, databaseID int64
	var databasePublicID, engine, status string
	err = s.db.QueryRow(c.Context(), `
		SELECT site.id,database.id,database.public_id,database.engine,database.status
		FROM hosting_sites site
		JOIN hosting_databases database ON database.site_id=site.id
		WHERE site.public_id=$1 AND site.deleted_at IS NULL
		  AND (($2 <> '' AND database.public_id=$2) OR ($2 = '' AND database.db_name=$3))
	`, site.ID, strings.TrimSpace(body.DatabaseID), strings.TrimSpace(body.DbName)).Scan(
		&siteID, &databaseID, &databasePublicID, &engine, &status,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบฐานข้อมูล", Code: "database_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if blocked := databaseAccessBlocked(status); blocked != nil {
		return c.Status(fiber.StatusLocked).JSON(blocked)
	}
	if engine != "mysql" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "phpMyAdmin ใช้ได้กับ MySQL เท่านั้น", Code: "engine_not_supported"})
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	token := hex.EncodeToString(raw)
	expiresAt := time.Now().UTC().Add(phpMyAdminTicketTTL)
	_, err = s.db.Exec(c.Context(), `
		INSERT INTO hosting_database_access_tickets
			(token_hash,user_id,session_id,site_id,database_id,ip_hash,user_agent_hash,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, tokenHash(token), actor.ID, actor.SessionID, siteID, databaseID,
		hashBinding(requestForwardedIP(c)), hashBinding(strings.TrimSpace(c.Get(fiber.HeaderUserAgent))), expiresAt)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	_, _ = s.db.Exec(c.Context(), `DELETE FROM hosting_database_access_tickets WHERE expires_at < NOW() - INTERVAL '10 minutes'`)
	s.audit(c, auditEvent{
		Actor: actor, Category: "hosting", Action: "hosting.database.phpmyadmin_ticket_created",
		Target: "hosting_database", TargetID: databasePublicID,
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
		"expiresAt": expiresAt,
	})
}

type consumePhpMyAdminTicketInput struct {
	Ticket    string   `json:"ticket"`
	ClientIP  string   `json:"clientIp"`
	ClientIPs []string `json:"clientIps"`
	UserAgent string   `json:"userAgent"`
}

// databaseAccessBlocked refuses phpMyAdmin for a database that is suspended or deleted. The
// MySQL account is locked as well, but this gives a clear message instead of a login error.
func databaseAccessBlocked(status string) *apiError {
	switch status {
	case "suspended":
		return &apiError{Error: "ฐานข้อมูลนี้ถูกระงับอยู่ เปิด phpMyAdmin ไม่ได้จนกว่าแอดมินจะปลดระงับ", Code: "database_suspended"}
	case "deleted":
		return &apiError{Error: "ฐานข้อมูลนี้ถูกลบแล้ว", Code: "database_deleted"}
	}
	return nil
}

func normalizeTicketIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	if parsed := net.ParseIP(value); parsed != nil {
		return parsed.String()
	}
	return value
}

func ticketIPMatches(storedHash string, ips []string) bool {
	seen := map[string]bool{}
	for _, raw := range ips {
		ip := normalizeTicketIP(raw)
		if ip == "" || seen[ip] {
			continue
		}
		seen[ip] = true
		// Only the requester's own address matches. A private address used to pass for anyone,
		// and phpMyAdmin's REMOTE_ADDR (the proxy's container address) is always private.
		if subtle.ConstantTimeCompare([]byte(storedHash), []byte(hashBinding(ip))) == 1 {
			return true
		}
	}
	return false
}

func (s *server) consumeSecurePhpMyAdminTicket(c *fiber.Ctx) error {
	providedSecret := []byte(c.Get("X-PMA-Internal-Secret"))
	expectedSecret := []byte(s.cfg.phpMyAdminInternalSecret)
	if len(providedSecret) != len(expectedSecret) || subtle.ConstantTimeCompare(providedSecret, expectedSecret) != 1 {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ไม่อนุญาต", Code: "forbidden"})
	}
	var body consumePhpMyAdminTicketInput
	if c.BodyParser(&body) != nil || len(body.Ticket) != 64 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Ticket ไม่ถูกต้อง", Code: "invalid_ticket"})
	}
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	var ticketID, userID int64
	var databasePublicID, dbName, dbUser, ciphertext, host, engine, ipHash, userAgentHash, dbStatus string
	var port int
	err = tx.QueryRow(c.Context(), `
		SELECT ticket.id,ticket.user_id,database.public_id,database.db_name,database.db_user,
		       database.db_password_enc,database.host,database.port,database.engine,
		       COALESCE(ticket.ip_hash, ''),COALESCE(ticket.user_agent_hash, ''),database.status
		FROM hosting_database_access_tickets ticket
		JOIN hosting_databases database ON database.id=ticket.database_id
		LEFT JOIN user_sessions session ON session.id=ticket.session_id
		JOIN users actor ON actor.id=ticket.user_id
		WHERE ticket.token_hash=$1 AND ticket.used_at IS NULL AND ticket.expires_at>NOW()
		  AND (ticket.session_id IS NULL OR (session.revoked_at IS NULL AND session.expires_at>NOW()))
		  AND actor.status='active' AND database.engine='mysql'
		FOR UPDATE OF ticket
	`, tokenHash(body.Ticket)).Scan(
		&ticketID, &userID, &databasePublicID, &dbName, &dbUser, &ciphertext,
		&host, &port, &engine, &ipHash, &userAgentHash, &dbStatus,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		log.Printf("consumeTicket error: ticket not found or expired for token_hash=%s", tokenHash(body.Ticket))
		return c.Status(fiber.StatusGone).JSON(apiError{Error: "Ticket หมดอายุหรือถูกใช้แล้ว", Code: "ticket_expired"})
	}
	if err != nil {
		log.Printf("consumeTicket query error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	// A ticket issued before the database was suspended must not open it afterwards.
	if blocked := databaseAccessBlocked(dbStatus); blocked != nil {
		return c.Status(fiber.StatusLocked).JSON(blocked)
	}
	clientIPs := append([]string{body.ClientIP}, body.ClientIPs...)
	ipMatch := ipHash == "" || ticketIPMatches(ipHash, clientIPs)
	uaMatch := userAgentHash == "" || subtle.ConstantTimeCompare([]byte(userAgentHash), []byte(hashBinding(strings.TrimSpace(body.UserAgent)))) == 1

	if !ipMatch || !uaMatch {
		log.Printf("consumeTicket mismatch: ipHash=%s candidates=%v uaMatch=%v", ipHash, clientIPs, uaMatch)
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "Ticket ไม่ตรงกับอุปกรณ์ที่ร้องขอ", Code: "ticket_binding_mismatch"})
	}
	password, err := decryptSecret(ciphertext, s.cfg.hostingEncryptionKey)
	if err != nil {
		password, err = decryptSecret(ciphertext, s.cfg.webhookKey)
	}
	if err != nil {
		log.Printf("consumeTicket decrypt error for db %s: %v", dbName, err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{
			Error: "ไม่สามารถอ่านรหัสผ่านฐานข้อมูลได้",
			Code:  "credential_unavailable",
		})
	}
	if err := s.ensureTenantDatabaseCredential(c.Context(), dbName, dbUser, password); err != nil {
		log.Printf("consumeTicket database credential error for db %s: %v", dbName, err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{
			Error: "ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาลองใหม่อีกครั้ง",
			Code:  "database_connection_failed",
		})
	}
	if _, err := tx.Exec(c.Context(), `UPDATE hosting_database_access_tickets SET used_at=NOW() WHERE id=$1`, ticketID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	auditIP := normalizeTicketIP(body.ClientIP)
	for _, candidate := range clientIPs {
		if ip := normalizeTicketIP(candidate); ip != "" && !isPrivateIP(ip) {
			auditIP = ip
			break
		}
		if auditIP == "" {
			auditIP = normalizeTicketIP(candidate)
		}
	}
	_, _ = s.db.Exec(c.Context(), `
		INSERT INTO audit_logs
			(actor_user_id,actor_username,actor_role,category,action,target_type,target_id,outcome,ip_address,user_agent,metadata)
		SELECT id,identifier,role,'hosting','hosting.database.phpmyadmin_opened',
		       'hosting_database',$2,'success',$3,$4,jsonb_build_object('db_name',$5::text)
		FROM users WHERE id=$1
	`, userID, databasePublicID, auditIP, body.UserAgent, dbName)
	return c.JSON(fiber.Map{
		"username": dbUser, "password": password, "database": dbName,
		"host": host, "port": port, "engine": engine,
	})
}
