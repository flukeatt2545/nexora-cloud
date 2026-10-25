package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	subdomainPattern       = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$`)
	domainPattern          = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	idempotencyPattern     = regexp.MustCompile(`^[A-Za-z0-9._:-]{16,128}$`)
	errIdempotencyConflict = errors.New("idempotency conflict")
)

var reservedSubdomains = map[string]bool{
	"admin": true, "api": true, "app": true, "assets": true, "cdn": true,
	"mail": true, "smtp": true, "status": true, "support": true, "www": true,
}

type hostingSite struct {
	ID                  string     `json:"id"`
	Name                string     `json:"name"`
	Subdomain           string     `json:"subdomain"`
	CustomDomain        string     `json:"customDomain"`
	ProjectType         string     `json:"projectType"`
	DetectedProjectType string     `json:"detectedProjectType"`
	PackageManager      string     `json:"packageManager"`
	Status              string     `json:"status"`
	MaintenanceMode     bool       `json:"maintenanceMode"`
	ExpiresAt           *time.Time `json:"expiresAt"`
	ExpiryAction        string     `json:"expiryAction"`
	OwnerID             int64      `json:"ownerId"`
	OwnerUsername       string     `json:"ownerUsername"`
	AccessRole          string     `json:"accessRole"`
	MemberCount         int        `json:"memberCount"`
	RuntimePort         *int       `json:"runtimePort"`
	HealthStatus        string     `json:"healthStatus"`
	HealthCheckedAt     *time.Time `json:"healthCheckedAt"`
	CPUMillicores       int        `json:"cpuMillicores"`
	MemoryMB            int        `json:"memoryMb"`
	ProcessLimit        int        `json:"processLimit"`
	DiskLimitMB         int        `json:"diskLimitMb"`
	Version             int64      `json:"version"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`

	// The custom domain is only served once the owner has published the TXT record named here.
	CustomDomainVerified bool   `json:"customDomainVerified"`
	CustomDomainTxtName  string `json:"customDomainTxtName,omitempty"`
	CustomDomainTxtValue string `json:"customDomainTxtValue,omitempty"`
	customDomainToken    string
}

type hostingSiteInput struct {
	Name           string `json:"name"`
	Subdomain      string `json:"subdomain"`
	CustomDomain   string `json:"customDomain"`
	ProjectType    string `json:"projectType"`
	PackageManager string `json:"packageManager"`
	OwnerUsername  string `json:"ownerUsername"`
}

type hostingOperation struct {
	OperationID  string     `json:"operationId"`
	Kind         string     `json:"kind"`
	State        string     `json:"state"`
	Phase        string     `json:"phase"`
	StartedAt    time.Time  `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt"`
	Timeout      int        `json:"timeoutSeconds"`
	ErrorCode    string     `json:"errorCode"`
	ErrorMessage string     `json:"errorMessage"`
	Retryable    bool       `json:"retryable"`
	Attempt      int        `json:"attempt"`
}

type siteAccess struct {
	DBID       int64
	PublicID   string
	OwnerID    int64
	AccessRole string
}

func normalizeSubdomain(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	// "code-<x>" is the code-server host of site <x> (the gateway and the TLS check strip the
	// prefix), so a site named that way could never be reached and <x> would take over its host.
	if len(value) < 3 || len(value) > 63 || reservedSubdomains[value] || strings.HasPrefix(value, "code-") || !subdomainPattern.MatchString(value) {
		return "", false
	}
	return value, true
}

// platformBaseDomain is the hosting domain whose names belong to the platform and its tenants.
func platformBaseDomain() string {
	if value := strings.ToLower(strings.TrimSpace(os.Getenv("CF_HOSTING_DOMAIN"))); value != "" {
		return strings.TrimSuffix(value, ".")
	}
	return "nkn02.com"
}

func normalizeCustomDomain(value string) (string, bool) {
	value = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), ".")
	if value == "" {
		return "", true
	}
	if len(value) > 253 || !domainPattern.MatchString(value) {
		return "", false
	}
	// The platform's own names, and every tenant's <subdomain>.<base> host, are not custom domains:
	// a claim there would be served under a name another site or the platform already uses.
	if base := platformBaseDomain(); value == base || strings.HasSuffix(value, "."+base) {
		return "", false
	}
	return value, true
}

func validProjectType(value string) bool {
	return value == "auto" || value == "static" || value == "php" || value == "node"
}

func validPackageManager(value string) bool {
	return value == "npm" || value == "pnpm" || value == "yarn"
}

func requestDigest(kind string, body []byte) string {
	sum := sha256.Sum256(append([]byte(kind+"\n"), body...))
	return hex.EncodeToString(sum[:])
}

func operationKey(c *fiber.Ctx) (string, error) {
	value := strings.TrimSpace(c.Get("Idempotency-Key"))
	if !idempotencyPattern.MatchString(value) {
		return "", errors.New("invalid idempotency key")
	}
	return value, nil
}

func hostingConflict(c *fiber.Ctx, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "hosting_sites_subdomain_active_unique":
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Subdomain นี้ถูกใช้งานแล้ว", Code: "subdomain_taken"})
		case "hosting_sites_custom_domain_verified_unique":
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Domain นี้ถูกยืนยันโดยเว็บไซต์อื่นแล้ว", Code: "domain_taken"})
		case "hosting_operations_one_active_per_site":
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "เว็บไซต์นี้มีรายการที่กำลังทำงานอยู่", Code: "operation_in_progress"})
		case "hosting_operations_actor_user_id_idempotency_key_key":
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Idempotency key ถูกใช้งานแล้ว", Code: "idempotency_conflict"})
		}
	}
	if errors.As(err, &pgErr) {
		log.Printf("hosting database error: code=%s constraint=%s", pgErr.Code, pgErr.ConstraintName)
	} else {
		log.Printf("hosting operation error: %T", err)
	}
	return fiber.NewError(fiber.StatusInternalServerError)
}

func (s *server) listHostingSites(c *fiber.Ctx) error {
	actor := current(c)
	query := cleanText(c.Query("q"), 80)
	status := cleanText(c.Query("status"), 20)
	cursor, _ := strconv.ParseInt(c.Query("cursor"), 10, 64)
	limit := parseLimit(c, 30, 100)

	rows, err := s.db.Query(c.Context(), `
		SELECT s.id, s.public_id, s.name, s.subdomain, COALESCE(s.custom_domain, ''),
		       s.custom_domain_verified_at IS NOT NULL, COALESCE(s.custom_domain_token, ''),
		       s.project_type, COALESCE(s.detected_project_type, ''), s.package_manager,
		       s.status, s.maintenance_mode, s.expires_at, s.expiry_action,
		       s.owner_user_id, owner.identifier,
		       CASE
		         WHEN s.owner_user_id = $1 THEN 'owner'
		         WHEN $2 IN ('admin','superadmin') THEN 'platform_admin'
		         ELSE COALESCE(member.role, '')
		       END,
		       (SELECT COUNT(*) FROM hosting_site_members count_member WHERE count_member.site_id = s.id),
		       s.runtime_port, s.health_status, s.health_checked_at,
		       s.cpu_millicores, s.memory_mb, s.process_limit, s.disk_limit_mb,
		       s.version, s.created_at, s.updated_at
		FROM hosting_sites s
		JOIN users owner ON owner.id = s.owner_user_id
		LEFT JOIN hosting_site_members member ON member.site_id = s.id AND member.user_id = $1
		WHERE s.deleted_at IS NULL
		  AND ($2 IN ('admin','superadmin') OR s.owner_user_id = $1 OR member.user_id IS NOT NULL)
		  AND ($3 = '' OR s.name ILIKE '%' || $3 || '%' OR s.subdomain ILIKE '%' || $3 || '%' OR COALESCE(s.custom_domain,'') ILIKE '%' || $3 || '%')
		  AND ($4 = '' OR s.status = $4)
		  AND ($5 = 0 OR s.id < $5)
		ORDER BY s.id DESC
		LIMIT $6
	`, actor.ID, actor.Role, query, status, cursor, limit)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	items := []hostingSite{}
	var nextCursor int64
	for rows.Next() {
		var item hostingSite
		var dbID int64
		if err := rows.Scan(
			&dbID, &item.ID, &item.Name, &item.Subdomain, &item.CustomDomain,
			&item.CustomDomainVerified, &item.customDomainToken,
			&item.ProjectType, &item.DetectedProjectType, &item.PackageManager,
			&item.Status, &item.MaintenanceMode, &item.ExpiresAt, &item.ExpiryAction,
			&item.OwnerID, &item.OwnerUsername, &item.AccessRole, &item.MemberCount,
			&item.RuntimePort, &item.HealthStatus, &item.HealthCheckedAt,
			&item.CPUMillicores, &item.MemoryMB, &item.ProcessLimit, &item.DiskLimitMB,
			&item.Version, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		nextCursor = dbID
		item.fillDomainProof()
		items = append(items, item)
	}
	return c.JSON(fiber.Map{"items": items, "nextCursor": nextCursor})
}

func (s *server) loadHostingSite(ctx context.Context, actor *currentUser, publicID string) (hostingSite, error) {
	var item hostingSite
	err := s.db.QueryRow(ctx, `
		SELECT s.public_id, s.name, s.subdomain, COALESCE(s.custom_domain, ''),
		       s.custom_domain_verified_at IS NOT NULL, COALESCE(s.custom_domain_token, ''),
		       s.project_type, COALESCE(s.detected_project_type, ''), s.package_manager,
		       s.status, s.maintenance_mode, s.expires_at, s.expiry_action,
		       s.owner_user_id, owner.identifier,
		       CASE
		         WHEN s.owner_user_id = $2 THEN 'owner'
		         WHEN $3 IN ('admin','superadmin') THEN 'platform_admin'
		         ELSE COALESCE(member.role, '')
		       END,
		       (SELECT COUNT(*) FROM hosting_site_members count_member WHERE count_member.site_id = s.id),
		       s.runtime_port, s.health_status, s.health_checked_at,
		       s.cpu_millicores, s.memory_mb, s.process_limit, s.disk_limit_mb,
		       s.version, s.created_at, s.updated_at
		FROM hosting_sites s
		JOIN users owner ON owner.id = s.owner_user_id
		LEFT JOIN hosting_site_members member ON member.site_id = s.id AND member.user_id = $2
		WHERE s.public_id = $1 AND s.deleted_at IS NULL
		  AND ($3 IN ('admin','superadmin') OR s.owner_user_id = $2 OR member.user_id IS NOT NULL)
	`, publicID, actor.ID, actor.Role).Scan(
		&item.ID, &item.Name, &item.Subdomain, &item.CustomDomain,
		&item.CustomDomainVerified, &item.customDomainToken,
		&item.ProjectType, &item.DetectedProjectType, &item.PackageManager,
		&item.Status, &item.MaintenanceMode, &item.ExpiresAt, &item.ExpiryAction,
		&item.OwnerID, &item.OwnerUsername, &item.AccessRole, &item.MemberCount,
		&item.RuntimePort, &item.HealthStatus, &item.HealthCheckedAt,
		&item.CPUMillicores, &item.MemoryMB, &item.ProcessLimit, &item.DiskLimitMB,
		&item.Version, &item.CreatedAt, &item.UpdatedAt,
	)
	item.fillDomainProof()
	return item, err
}

const customDomainTxtPrefix = "_nexora-verify."

// fillDomainProof tells the owner which TXT record proves the domain. The token is not a secret:
// it only has to be unique to this site and domain, and only someone who controls the domain's DNS
// can publish it.
func (h *hostingSite) fillDomainProof() {
	if h.CustomDomain == "" || h.CustomDomainVerified || h.customDomainToken == "" {
		return
	}
	h.CustomDomainTxtName = customDomainTxtPrefix + h.CustomDomain
	h.CustomDomainTxtValue = "nexora-verify=" + h.customDomainToken
}

// lookupDomainTXT is a variable so tests can supply DNS answers.
var lookupDomainTXT = func(ctx context.Context, name string) ([]string, error) {
	return net.DefaultResolver.LookupTXT(ctx, name)
}

func txtProvesDomain(records []string, token string) bool {
	if token == "" {
		return false
	}
	want := "nexora-verify=" + token
	for _, record := range records {
		if strings.TrimSpace(record) == want {
			return true
		}
	}
	return false
}

// verifyHostingDomain checks the site's TXT record and, when it is there, starts serving the domain.
func (s *server) verifyHostingDomain(c *fiber.Ctx) error {
	actor := current(c)
	publicID := c.Params("id")
	item, err := s.loadHostingSite(c.Context(), actor, publicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if item.AccessRole == "viewer" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "สิทธิ์ Viewer ยืนยัน Domain ไม่ได้", Code: "forbidden"})
	}
	if item.CustomDomain == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เว็บไซต์นี้ยังไม่ได้ตั้ง Domain", Code: "no_custom_domain"})
	}
	if item.CustomDomainVerified {
		return c.JSON(fiber.Map{"site": item, "verified": true})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 6*time.Second)
	defer cancel()
	records, lookupErr := lookupDomainTXT(ctx, customDomainTxtPrefix+item.CustomDomain)
	if lookupErr != nil && len(records) == 0 {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ยังไม่พบ TXT record ของ Domain นี้ รอ DNS อัปเดตสักครู่แล้วลองใหม่", Code: "txt_not_found"})
	}
	if !txtProvesDomain(records, item.customDomainToken) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "TXT record ไม่ตรงกับค่าที่ระบบกำหนด", Code: "txt_mismatch"})
	}

	tag, err := s.db.Exec(c.Context(), `
		UPDATE hosting_sites
		SET custom_domain_verified_at=NOW(), version=version+1, updated_at=NOW()
		WHERE public_id=$1 AND deleted_at IS NULL AND custom_domain_verified_at IS NULL
		  AND LOWER(custom_domain)=LOWER($2) AND custom_domain_token=$3
	`, publicID, item.CustomDomain, item.customDomainToken)
	if err != nil {
		return hostingConflict(c, err)
	}
	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Domain เปลี่ยนไประหว่างตรวจสอบ ลองใหม่อีกครั้ง", Code: "domain_changed"})
	}
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.domain.verified", Target: "hosting_site", TargetID: publicID, Metadata: map[string]any{"domain": item.CustomDomain}})
	updated, err := s.loadHostingSite(c.Context(), actor, publicID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"site": updated, "verified": true})
}

func (s *server) getHostingSite(c *fiber.Ctx) error {
	actor := current(c)
	item, err := s.loadHostingSite(c.Context(), actor, c.Params("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	members, err := s.hostingMembers(c.Context(), actor, item.ID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	operations, err := s.hostingOperations(c.Context(), actor, item.ID, 20)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"site": item, "members": members, "operations": operations})
}

func sanitizeHostingInput(input *hostingSiteInput) (string, string) {
	input.Name = cleanText(input.Name, 80)
	input.OwnerUsername = strings.ToLower(cleanText(input.OwnerUsername, 30))
	input.ProjectType = strings.ToLower(strings.TrimSpace(input.ProjectType))
	input.PackageManager = strings.ToLower(strings.TrimSpace(input.PackageManager))
	subdomain, ok := normalizeSubdomain(input.Subdomain)
	if !ok {
		return "subdomain", "Subdomain ใช้ได้เฉพาะ a-z, 0-9 และขีดกลาง ความยาว 3–63 ตัว"
	}
	customDomain, ok := normalizeCustomDomain(input.CustomDomain)
	if !ok {
		return "customDomain", "รูปแบบ Domain ไม่ถูกต้อง"
	}
	input.Subdomain = subdomain
	input.CustomDomain = customDomain
	if len([]rune(input.Name)) < 2 {
		return "name", "ชื่อเว็บไซต์ต้องมีอย่างน้อย 2 ตัวอักษร"
	}
	if !validProjectType(input.ProjectType) {
		return "projectType", "ประเภทโปรเจกต์ไม่ถูกต้อง"
	}
	if !validPackageManager(input.PackageManager) {
		return "packageManager", "Package Manager ไม่ถูกต้อง"
	}
	return "", ""
}

func (s *server) createHostingSite(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอนี้ไม่มี Idempotency key ที่ปลอดภัย", Code: "invalid_idempotency_key"})
	}
	var input hostingSiteInput
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	if field, message := sanitizeHostingInput(&input); message != "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": message, "code": "validation_error", "field": field})
	}
	hash := requestDigest("site.create", c.Body())

	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())

	if existingID, replay, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "site.create"); err != nil {
		return hostingIdempotencyError(c, err)
	} else if replay {
		if err := tx.Commit(c.Context()); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		item, loadErr := s.loadHostingSite(c.Context(), actor, existingID)
		if loadErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"site": item, "replayed": true})
	}

	ownerID := actor.ID
	if input.OwnerUsername != "" && input.OwnerUsername != actor.Username {
		if actor.Role != "admin" && actor.Role != "superadmin" {
			return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "ไม่มีสิทธิ์กำหนด Owner ให้ผู้อื่น", Code: "forbidden"})
		}
		if err := tx.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(identifier)=LOWER($1) AND status='active'`, input.OwnerUsername).Scan(&ownerID); errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบบัญชี Owner ที่ใช้งานได้", Code: "owner_not_found"})
		} else if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}

	publicID := randomHex(16)
	var siteDBID int64
	err = tx.QueryRow(c.Context(), `
		INSERT INTO hosting_sites
		  (public_id, owner_user_id, name, subdomain, custom_domain, custom_domain_token, project_type, package_manager)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),CASE WHEN $5 <> '' THEN $8::text END,$6,$7)
		RETURNING id
	`, publicID, ownerID, input.Name, input.Subdomain, input.CustomDomain, input.ProjectType, input.PackageManager, randomHex(16)).Scan(&siteDBID)
	if err != nil {
		return hostingConflict(c, err)
	}
	if err := insertHostingOperation(c.Context(), tx, siteDBID, actor.ID, "site.create", key, hash, publicID); err != nil {
		return hostingConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return hostingConflict(c, err)
	}

	// Create Cloudflare DNS Record
	go func(sub string) {
		if err := s.createDnsRecord(sub); err != nil {
			log.Printf("Failed to create DNS record for %s: %v", sub, err)
		}
	}(input.Subdomain)
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.site.created", Target: "hosting_site", TargetID: publicID, Metadata: map[string]any{"subdomain": input.Subdomain, "ownerUserId": ownerID}})
	item, err := s.loadHostingSite(c.Context(), actor, publicID)
	if err != nil {
		log.Printf("hosting created site reload failed: %T", err)
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"site": item, "replayed": false})
}

func (s *server) updateHostingSite(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอนี้ไม่มี Idempotency key ที่ปลอดภัย", Code: "invalid_idempotency_key"})
	}
	var input hostingSiteInput
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	if field, message := sanitizeHostingInput(&input); message != "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": message, "code": "validation_error", "field": field})
	}
	hash := requestDigest("site.update", c.Body())
	publicID := c.Params("id")

	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())

	if existingID, replay, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "site.update"); err != nil {
		return hostingIdempotencyError(c, err)
	} else if replay {
		if existingID != publicID {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Idempotency key ไม่ตรงกับเว็บไซต์", Code: "idempotency_conflict"})
		}
		if err := tx.Commit(c.Context()); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		item, loadErr := s.loadHostingSite(c.Context(), actor, publicID)
		if loadErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		return c.JSON(fiber.Map{"site": item, "replayed": true})
	}

	access, err := lockHostingSite(c.Context(), tx, actor, publicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if access.AccessRole == "viewer" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "สิทธิ์ Viewer แก้ไขเว็บไซต์ไม่ได้", Code: "forbidden"})
	}
	_, err = tx.Exec(c.Context(), `
		UPDATE hosting_sites
		SET name=$1, subdomain=$2, custom_domain=NULLIF($3,''), project_type=$4,
		    package_manager=$5, version=version+1, updated_at=NOW(),
		    -- a different domain has to be proved again; the same one keeps its proof
		    custom_domain_verified_at = CASE WHEN LOWER(COALESCE(custom_domain,'')) = LOWER($3) THEN custom_domain_verified_at END,
		    custom_domain_token = CASE
		      WHEN $3 = '' THEN NULL
		      WHEN LOWER(COALESCE(custom_domain,'')) = LOWER($3) THEN custom_domain_token
		      ELSE $7::text
		    END
		WHERE id=$6
	`, input.Name, input.Subdomain, input.CustomDomain, input.ProjectType, input.PackageManager, access.DBID, randomHex(16))
	if err != nil {
		return hostingConflict(c, err)
	}
	if err := insertHostingOperation(c.Context(), tx, access.DBID, actor.ID, "site.update", key, hash, publicID); err != nil {
		return hostingConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return hostingConflict(c, err)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.site.updated", Target: "hosting_site", TargetID: publicID})
	item, err := s.loadHostingSite(c.Context(), actor, publicID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.JSON(fiber.Map{"site": item, "replayed": false})
}

func (s *server) deleteHostingSite(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปแบบ Idempotency key ไม่ถูกต้อง", Code: "invalid_idempotency_key"})
	}
	publicID := c.Params("id")
	hash := requestDigest("site.delete", []byte(publicID))
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())

	if existingID, replay, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "site.delete"); err != nil {
		return hostingIdempotencyError(c, err)
	} else if replay {
		if existingID != publicID {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Idempotency key ถูกใช้งานไปแล้ว", Code: "idempotency_conflict"})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
	access, err := lockHostingSite(c.Context(), tx, actor, publicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบข้อมูลเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if access.AccessRole != "owner" && access.AccessRole != "platform_admin" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "เฉพาะเจ้าของเว็บเท่านั้นที่สามารถลบได้", Code: "forbidden"})
	}

	var subdomain string
	_ = tx.QueryRow(c.Context(), `SELECT subdomain FROM hosting_sites WHERE id=$1`, access.DBID).Scan(&subdomain)

	// Secrets are intentionally destroyed immediately. A soft-deleted site must
	// never retain credentials that could later be recovered from the database.
	if _, err := tx.Exec(c.Context(), `DELETE FROM hosting_environment_variables WHERE site_id=$1`, access.DBID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := tx.Exec(c.Context(), `UPDATE hosting_sites SET deleted_at=NOW(), version=version+1, updated_at=NOW() WHERE id=$1`, access.DBID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := enqueueHostingOperation(c.Context(), tx, access.DBID, actor.ID, "site.delete", key, hash, publicID, 600); err != nil {
		return hostingConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return hostingConflict(c, err)
	}

	go func(sub string) {
		if sub != "" {
			if err := s.deleteDnsRecord(sub); err != nil {
				log.Printf("Failed to delete DNS record for %s: %v", sub, err)
			}
		}
	}(subdomain)

	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.site.deleted", Target: "hosting_site", TargetID: publicID})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) createHostingRuntimeOperation(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอนี้ไม่มี Idempotency key ที่ปลอดภัย", Code: "invalid_idempotency_key"})
	}
	var body struct {
		Action string `json:"action"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	body.Action = strings.ToLower(strings.TrimSpace(body.Action))
	allowed := map[string]int{"start": 300, "stop": 180, "restart": 300, "rebuild": 900, "redeploy": 900}
	timeout, ok := allowed[body.Action]
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำสั่ง Runtime ไม่ถูกต้อง", Code: "invalid_operation"})
	}
	publicID := c.Params("id")
	kind := "runtime." + body.Action
	hash := requestDigest(kind, c.Body())
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())

	if existingID, replay, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, kind); err != nil {
		return hostingIdempotencyError(c, err)
	} else if replay {
		if existingID != publicID {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Idempotency key ไม่ตรงกับเว็บไซต์", Code: "idempotency_conflict"})
		}
		var operation hostingOperation
		if err := scanHostingOperation(tx.QueryRow(c.Context(), `
			SELECT operation_id,kind,state,phase,started_at,finished_at,timeout_seconds,
			       error_code,error_message,retryable,attempt
			FROM hosting_operations WHERE actor_user_id=$1 AND idempotency_key=$2
		`, actor.ID, key), &operation); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		return c.JSON(fiber.Map{"operation": operation, "replayed": true})
	}

	access, err := lockHostingSite(c.Context(), tx, actor, publicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if access.AccessRole == "viewer" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "Viewer สั่งงาน Runtime ไม่ได้", Code: "forbidden"})
	}
	var status string
	if err := tx.QueryRow(c.Context(), `SELECT status FROM hosting_sites WHERE id=$1`, access.DBID).Scan(&status); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if status == "expired" {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "เว็บไซต์หมดอายุแล้ว กรุณาต่ออายุก่อน", Code: "site_expired"})
	}
	if body.Action == "start" && status == "running" {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "เว็บไซต์กำลังทำงานอยู่แล้ว", Code: "already_running"})
	}
	if body.Action == "stop" && status == "stopped" {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "เว็บไซต์หยุดทำงานอยู่แล้ว", Code: "already_stopped"})
	}
	if err := enqueueHostingOperation(c.Context(), tx, access.DBID, actor.ID, kind, key, hash, publicID, timeout); err != nil {
		return hostingConflict(c, err)
	}
	if body.Action != "stop" {
		if _, err := tx.Exec(c.Context(), `
			UPDATE hosting_sites SET status='provisioning',health_status='starting',updated_at=NOW() WHERE id=$1
		`, access.DBID); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		return hostingConflict(c, err)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting." + kind + ".requested", Target: "hosting_site", TargetID: publicID})
	var operation hostingOperation
	if err := scanHostingOperation(s.db.QueryRow(c.Context(), `
		SELECT operation_id,kind,state,phase,started_at,finished_at,timeout_seconds,
		       error_code,error_message,retryable,attempt
		FROM hosting_operations WHERE actor_user_id=$1 AND idempotency_key=$2
	`, actor.ID, key), &operation); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"operation": operation, "replayed": false})
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanHostingOperation(row rowScanner, item *hostingOperation) error {
	return row.Scan(
		&item.OperationID, &item.Kind, &item.State, &item.Phase,
		&item.StartedAt, &item.FinishedAt, &item.Timeout,
		&item.ErrorCode, &item.ErrorMessage, &item.Retryable, &item.Attempt,
	)
}

func (s *server) hostingRuntimeLogs(c *fiber.Ctx) error {
	actor := current(c)
	item, err := s.loadHostingSite(c.Context(), actor, c.Params("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	cursor, _ := strconv.ParseInt(c.Query("cursor"), 10, 64)
	limit := parseLimit(c, 100, 300)
	rows, err := s.db.Query(c.Context(), `
		SELECT log.id,log.operation_id,log.stream,log.message,log.created_at
		FROM hosting_runtime_logs log
		JOIN hosting_sites site ON site.id=log.site_id
		WHERE site.public_id=$1 AND ($2=0 OR log.id<$2)
		ORDER BY log.id DESC LIMIT $3
	`, item.ID, cursor, limit)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()
	logs := []fiber.Map{}
	var nextCursor int64
	for rows.Next() {
		var id int64
		var operationID *string
		var stream, message string
		var createdAt time.Time
		if err := rows.Scan(&id, &operationID, &stream, &message, &createdAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		nextCursor = id
		logs = append(logs, fiber.Map{"id": id, "operationId": operationID, "stream": stream, "message": message, "createdAt": createdAt})
	}
	return c.JSON(fiber.Map{"items": logs, "nextCursor": nextCursor})
}

func (s *server) addHostingMember(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอนี้ไม่มี Idempotency key ที่ปลอดภัย", Code: "invalid_idempotency_key"})
	}
	var body struct {
		Username string `json:"username"`
		Role     string `json:"role"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	body.Username = strings.ToLower(cleanText(body.Username, 30))
	if body.Role != "developer" && body.Role != "viewer" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "สิทธิ์ผู้ร่วมงานไม่ถูกต้อง"})
	}
	publicID := c.Params("id")
	hash := requestDigest("member.upsert", c.Body())
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	if existingID, replay, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "member.upsert"); err != nil {
		return hostingIdempotencyError(c, err)
	} else if replay {
		if existingID != publicID {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Idempotency key ไม่ตรงกับเว็บไซต์", Code: "idempotency_conflict"})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
	access, err := lockHostingSite(c.Context(), tx, actor, publicID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์"})
	}
	if access.AccessRole != "owner" && access.AccessRole != "admin" && access.AccessRole != "platform_admin" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "เฉพาะ Owner หรือ Admin ของเว็บไซต์เท่านั้นที่จัดการผู้ร่วมงานได้", Code: "forbidden"})
	}
	var subdomain string
	_ = tx.QueryRow(c.Context(), "SELECT subdomain FROM hosting_sites WHERE id=$1", access.DBID).Scan(&subdomain)
	var userID int64
	if err := tx.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(identifier)=LOWER($1) AND status='active'`, body.Username).Scan(&userID); errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบผู้ใช้ที่ใช้งานได้", Code: "user_not_found"})
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if userID == access.OwnerID {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ผู้ใช้นี้เป็น Owner อยู่แล้ว", Code: "already_owner"})
	}
	if _, err := tx.Exec(c.Context(), `
		INSERT INTO hosting_site_members (site_id,user_id,role,added_by)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (site_id,user_id)
		DO UPDATE SET role=EXCLUDED.role, added_by=EXCLUDED.added_by, updated_at=NOW()
	`, access.DBID, userID, body.Role, actor.ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if body.Role == "viewer" {
		if err := revokeHostingWorkspaceTokens(c.Context(), tx, access.DBID, userID); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
	}
	if err := insertHostingOperation(c.Context(), tx, access.DBID, actor.ID, "member.upsert", key, hash, publicID); err != nil {
		return hostingConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return hostingConflict(c, err)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.member.upserted", Target: "hosting_site", TargetID: publicID, Metadata: map[string]any{"username": body.Username, "role": body.Role}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) removeHostingMember(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอนี้ไม่มี Idempotency key ที่ปลอดภัย", Code: "invalid_idempotency_key"})
	}
	userID, err := strconv.ParseInt(c.Params("userId"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ผู้ใช้ไม่ถูกต้อง"})
	}
	publicID := c.Params("id")
	hash := requestDigest("member.remove", []byte(publicID+":"+strconv.FormatInt(userID, 10)))
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	if existingID, replay, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "member.remove"); err != nil {
		return hostingIdempotencyError(c, err)
	} else if replay {
		if existingID != publicID {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Idempotency key ไม่ตรงกับเว็บไซต์", Code: "idempotency_conflict"})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
	access, err := lockHostingSite(c.Context(), tx, actor, publicID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์"})
	}
	if access.AccessRole != "owner" && access.AccessRole != "admin" && access.AccessRole != "platform_admin" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "เฉพาะ Owner หรือ Admin ของเว็บไซต์เท่านั้นที่จัดการผู้ร่วมงานได้", Code: "forbidden"})
	}
	if userID == access.OwnerID {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ไม่สามารถลบ Owner ออกจากรายชื่อผู้ร่วมงานได้", Code: "owner_protected"})
	}
	var subdomain string
	_ = tx.QueryRow(c.Context(), "SELECT subdomain FROM hosting_sites WHERE id=$1", access.DBID).Scan(&subdomain)
	if _, err := tx.Exec(c.Context(), `DELETE FROM hosting_site_members WHERE site_id=$1 AND user_id=$2`, access.DBID, userID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := revokeHostingWorkspaceTokens(c.Context(), tx, access.DBID, userID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := insertHostingOperation(c.Context(), tx, access.DBID, actor.ID, "member.remove", key, hash, publicID); err != nil {
		return hostingConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return hostingConflict(c, err)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.member.removed", Target: "hosting_site", TargetID: publicID, Metadata: map[string]any{"userId": userID}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) transferHostingOwner(c *fiber.Ctx) error {
	actor := current(c)
	key, err := operationKey(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "คำขอนี้ไม่มี Idempotency key ที่ปลอดภัย", Code: "invalid_idempotency_key"})
	}
	var body struct {
		Username string `json:"username"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง"})
	}
	body.Username = strings.ToLower(cleanText(body.Username, 30))
	publicID := c.Params("id")
	hash := requestDigest("owner.transfer", c.Body())
	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	if existingID, replay, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "owner.transfer"); err != nil {
		return hostingIdempotencyError(c, err)
	} else if replay {
		if existingID != publicID {
			return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Idempotency key ไม่ตรงกับเว็บไซต์", Code: "idempotency_conflict"})
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
	access, err := lockHostingSite(c.Context(), tx, actor, publicID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์"})
	}
	if access.AccessRole != "owner" && actor.Role != "superadmin" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "เฉพาะ Owner หรือผู้ดูแลระบบเท่านั้นที่โอนเว็บไซต์ได้", Code: "forbidden"})
	}
	var newOwnerID int64
	if err := tx.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(identifier)=LOWER($1) AND status='active'`, body.Username).Scan(&newOwnerID); errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่พบผู้ใช้ที่ใช้งานได้", Code: "owner_not_found"})
	} else if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if newOwnerID == access.OwnerID {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ผู้ใช้นี้เป็น Owner อยู่แล้ว", Code: "already_owner"})
	}
	if _, err := tx.Exec(c.Context(), `UPDATE hosting_sites SET owner_user_id=$1, version=version+1, updated_at=NOW() WHERE id=$2`, newOwnerID, access.DBID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := tx.Exec(c.Context(), `DELETE FROM hosting_site_members WHERE site_id=$1 AND user_id=$2`, access.DBID, newOwnerID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := tx.Exec(c.Context(), `
		INSERT INTO hosting_site_members (site_id,user_id,role,added_by)
		VALUES ($1,$2,'developer',$3)
		ON CONFLICT (site_id,user_id) DO UPDATE SET role='developer', updated_at=NOW()
	`, access.DBID, access.OwnerID, actor.ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := insertHostingOperation(c.Context(), tx, access.DBID, actor.ID, "owner.transfer", key, hash, publicID); err != nil {
		return hostingConflict(c, err)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return hostingConflict(c, err)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "hosting.owner.transferred", Target: "hosting_site", TargetID: publicID, Metadata: map[string]any{"newOwner": body.Username}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) hostingMembers(ctx context.Context, actor *currentUser, publicID string) ([]fiber.Map, error) {
	var siteDBID, ownerID int64
	var ownerUsername string
	err := s.db.QueryRow(ctx, `
		SELECT s.id,s.owner_user_id,owner.identifier
		FROM hosting_sites s JOIN users owner ON owner.id=s.owner_user_id
		LEFT JOIN hosting_site_members member ON member.site_id=s.id AND member.user_id=$2
		WHERE s.public_id=$1 AND s.deleted_at IS NULL
		  AND ($3 IN ('admin','superadmin') OR s.owner_user_id=$2 OR member.user_id IS NOT NULL)
	`, publicID, actor.ID, actor.Role).Scan(&siteDBID, &ownerID, &ownerUsername)
	if err != nil {
		return nil, err
	}
	items := []fiber.Map{{"userId": ownerID, "username": ownerUsername, "role": "owner"}}
	rows, err := s.db.Query(ctx, `
		SELECT member.user_id,u.identifier,u.display_name,member.role,member.created_at
		FROM hosting_site_members member JOIN users u ON u.id=member.user_id
		WHERE member.site_id=$1 ORDER BY member.created_at
	`, siteDBID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var userID int64
		var username, displayName, role string
		var createdAt time.Time
		if err := rows.Scan(&userID, &username, &displayName, &role, &createdAt); err != nil {
			return nil, err
		}
		items = append(items, fiber.Map{"userId": userID, "username": username, "displayName": displayName, "role": role, "createdAt": createdAt})
	}
	return items, nil
}

func (s *server) hostingOperations(ctx context.Context, actor *currentUser, publicID string, limit int) ([]hostingOperation, error) {
	var siteDBID int64
	err := s.db.QueryRow(ctx, `
		SELECT s.id FROM hosting_sites s
		LEFT JOIN hosting_site_members member ON member.site_id=s.id AND member.user_id=$2
		WHERE s.public_id=$1 AND s.deleted_at IS NULL
		  AND ($3 IN ('admin','superadmin') OR s.owner_user_id=$2 OR member.user_id IS NOT NULL)
	`, publicID, actor.ID, actor.Role).Scan(&siteDBID)
	if err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT operation_id,kind,state,phase,started_at,finished_at,timeout_seconds,
		       error_code,error_message,retryable,attempt
		FROM hosting_operations WHERE site_id=$1 ORDER BY id DESC LIMIT $2
	`, siteDBID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []hostingOperation{}
	for rows.Next() {
		var item hostingOperation
		if err := rows.Scan(&item.OperationID, &item.Kind, &item.State, &item.Phase, &item.StartedAt, &item.FinishedAt, &item.Timeout, &item.ErrorCode, &item.ErrorMessage, &item.Retryable, &item.Attempt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func lockHostingSite(ctx context.Context, tx pgx.Tx, actor *currentUser, publicID string) (siteAccess, error) {
	var access siteAccess
	err := tx.QueryRow(ctx, `
		SELECT s.id,s.public_id,s.owner_user_id,
		       CASE
		         WHEN s.owner_user_id=$2 THEN 'owner'
		         WHEN $3 IN ('admin','superadmin') THEN 'platform_admin'
		         ELSE COALESCE(member.role,'')
		       END
		FROM hosting_sites s
		LEFT JOIN hosting_site_members member ON member.site_id=s.id AND member.user_id=$2
		WHERE s.public_id=$1 AND s.deleted_at IS NULL
		  AND ($3 IN ('admin','superadmin') OR s.owner_user_id=$2 OR member.user_id IS NOT NULL)
		FOR UPDATE OF s
	`, publicID, actor.ID, actor.Role).Scan(&access.DBID, &access.PublicID, &access.OwnerID, &access.AccessRole)
	return access, err
}

func checkHostingIdempotency(ctx context.Context, tx pgx.Tx, actorID int64, key, hash, kind string) (string, bool, error) {
	var storedHash, storedKind, sitePublicID string
	err := tx.QueryRow(ctx, `
		SELECT operation.request_hash,operation.kind,COALESCE(site.public_id,'')
		FROM hosting_operations operation
		LEFT JOIN hosting_sites site ON site.id=operation.site_id
		WHERE operation.actor_user_id=$1 AND operation.idempotency_key=$2
	`, actorID, key).Scan(&storedHash, &storedKind, &sitePublicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fiber.NewError(fiber.StatusInternalServerError)
	}
	if storedHash != hash || storedKind != kind {
		return "", false, errIdempotencyConflict
	}
	return sitePublicID, true, nil
}

func hostingIdempotencyError(c *fiber.Ctx, err error) error {
	if errors.Is(err, errIdempotencyConflict) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "Idempotency key ถูกใช้กับคำขออื่นแล้ว", Code: "idempotency_conflict"})
	}
	return err
}

func insertHostingOperation(ctx context.Context, tx pgx.Tx, siteID, actorID int64, kind, key, hash, sitePublicID string) error {
	operationID := randomHex(16)
	now := time.Now().UTC()
	_, err := tx.Exec(ctx, `
		INSERT INTO hosting_operations
		  (operation_id,site_id,actor_user_id,kind,idempotency_key,request_hash,state,phase,
		   started_at,finished_at,timeout_seconds,error_code,error_message,retryable,metadata)
		VALUES ($1,$2,$3,$4,$5,$6,'succeeded','completed',$7,$7,30,'','',FALSE,jsonb_build_object('sitePublicId',$8::text))
	`, operationID, siteID, actorID, kind, key, hash, now, sitePublicID)
	return err
}

func enqueueHostingOperation(ctx context.Context, tx pgx.Tx, siteID, actorID int64, kind, key, hash, sitePublicID string, timeoutSeconds int) error {
	operationID := randomHex(16)
	now := time.Now().UTC()
	_, err := tx.Exec(ctx, `
		INSERT INTO hosting_operations
		  (operation_id,site_id,actor_user_id,kind,idempotency_key,request_hash,state,phase,
		   started_at,timeout_seconds,error_code,error_message,retryable,metadata)
		VALUES ($1,$2,$3,$4,$5,$6,'queued','pending',$7,$8,'','',TRUE,
		        jsonb_build_object('sitePublicId',$9::text))
	`, operationID, siteID, actorID, kind, key, hash, now, timeoutSeconds, sitePublicID)
	return err
}

func enqueueHostingDeployOperation(ctx context.Context, tx pgx.Tx, siteID, actorID int64, key, hash, sitePublicID, objectKey string) error {
	operationID := randomHex(16)
	now := time.Now().UTC()
	_, err := tx.Exec(ctx, `
		INSERT INTO hosting_operations
		  (operation_id,site_id,actor_user_id,kind,idempotency_key,request_hash,state,phase,
		   started_at,timeout_seconds,error_code,error_message,retryable,metadata)
		VALUES ($1,$2,$3,'runtime.redeploy',$4,$5,'queued','pending',$6,900,'','',TRUE,
		        jsonb_build_object('sitePublicId',$7::text, 'deploymentKey', $8::text))
	`, operationID, siteID, actorID, key, hash, now, sitePublicID, objectKey)
	return err
}

func (s *server) deployHostingSite(c *fiber.Ctx) error {
	actor := current(c)
	publicID := strings.TrimSpace(c.Params("id"))

	key := strings.TrimSpace(c.Get("Idempotency-Key"))
	if key == "" || len(key) < 16 || len(key) > 128 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "โปรดระบุ Idempotency-Key ให้ถูกต้อง", Code: "invalid_idempotency_key"})
	}
	hash := "deploy-" + key

	tx, err := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())

	_, processed, err := checkHostingIdempotency(c.Context(), tx, actor.ID, key, hash, "runtime.redeploy")
	if err != nil {
		return hostingIdempotencyError(c, err)
	}
	if processed {
		_ = tx.Rollback(c.Context())
		return c.SendStatus(fiber.StatusNoContent)
	}

	access, err := lockHostingSite(c.Context(), tx, actor, publicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "not_found"})
	}
	if err != nil {
		return err
	}
	if access.AccessRole == "viewer" {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์เผยแพร่เว็บไซต์นี้", Code: "forbidden"})
	}

	objectKey, err := s.uploadDeployment(c, access.DBID)
	if err != nil {
		return err
	}

	if err := enqueueHostingDeployOperation(c.Context(), tx, access.DBID, actor.ID, key, hash, access.PublicID, objectKey); err != nil {
		return err
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}

	s.audit(c, auditEvent{Actor: actor, Category: "hosting", Action: "runtime.redeploy", Target: "site", TargetID: access.PublicID, Metadata: fiber.Map{"deploymentKey": objectKey}})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) getHostingSiteDatabase(c *fiber.Ctx) error {
	publicID := c.Params("id")
	var siteID int64
	var maxDatabases int
	if err := s.db.QueryRow(c.Context(), `SELECT id, max_databases FROM hosting_sites WHERE public_id = $1`, publicID).Scan(&siteID, &maxDatabases); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบข้อมูลเว็บไซต์", Code: "not_found"})
	}

	user := current(c)
	if !s.canManageSite(c.Context(), siteID, user) {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์เข้าถึงเว็บไซต์นี้", Code: "forbidden"})
	}

	rows, err := s.db.Query(c.Context(), `
		SELECT public_id,db_name,db_user,status,engine,host,port,is_primary,last_checked_at
		FROM hosting_databases WHERE site_id=$1 ORDER BY created_at ASC
	`, siteID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	var databases []fiber.Map
	for rows.Next() {
		var publicID, dbName, dbUser, status, engine, host string
		var port int
		var isPrimary bool
		var lastCheckedAt *time.Time
		if err := rows.Scan(&publicID, &dbName, &dbUser, &status, &engine, &host, &port, &isPrimary, &lastCheckedAt); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		databases = append(databases, fiber.Map{
			"id": publicID, "dbName": dbName, "dbUser": dbUser,
			"status": status, "engine": engine, "host": host, "port": port,
			"isPrimary": isPrimary, "lastCheckedAt": lastCheckedAt,
			"connectionString": fmt.Sprintf("mysql://%s:••••••••@%s:%d/%s", dbUser, host, port, dbName),
		})
	}

	if databases == nil {
		databases = []fiber.Map{}
	}

	return c.JSON(fiber.Map{
		"databases":    databases,
		"maxDatabases": maxDatabases,
	})
}

func (s *server) provisionHostingSiteDatabase(c *fiber.Ctx) error {
	publicID := c.Params("id")
	key, keyErr := operationKey(c)
	if keyErr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาส่ง Idempotency-Key ที่ถูกต้อง", Code: "invalid_idempotency_key"})
	}
	hash := requestDigest("database.provision", c.Body())
	var siteID int64
	var maxDatabases int
	if err := s.db.QueryRow(c.Context(), `SELECT id, max_databases FROM hosting_sites WHERE public_id = $1`, publicID).Scan(&siteID, &maxDatabases); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบข้อมูลเว็บไซต์", Code: "not_found"})
	}

	user := current(c)
	if !s.canManageSite(c.Context(), siteID, user) {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณไม่มีสิทธิ์เข้าถึงเว็บไซต์นี้", Code: "forbidden"})
	}

	access, accessErr := s.loadHostingSite(c.Context(), user, publicID)
	if accessErr != nil || (access.AccessRole != "owner" && access.AccessRole != "platform_admin") {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "เฉพาะเจ้าของเว็บไซต์หรือผู้ดูแลระบบเท่านั้น", Code: "forbidden"})
	}

	replayTx, replayErr := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if replayErr != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	_, alreadyProcessed, replayErr := checkHostingIdempotency(c.Context(), replayTx, user.ID, key, hash, "database.provision")
	_ = replayTx.Rollback(c.Context())
	if replayErr != nil {
		return hostingIdempotencyError(c, replayErr)
	}
	if alreadyProcessed {
		return c.JSON(fiber.Map{"replayed": true, "notice": "คำขอนี้ถูกดำเนินการแล้ว ระบบจะไม่แสดงรหัสผ่านซ้ำ"})
	}

	var count int
	if err := s.db.QueryRow(c.Context(), `SELECT count(*) FROM hosting_databases WHERE site_id = $1 AND status NOT IN ('error','deleted')`, siteID).Scan(&count); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if count >= maxDatabases {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "เกินโควต้าฐานข้อมูลที่กำหนด", Code: "quota_exceeded"})
	}

	operationID := randomHex(16)
	opTx, opErr := s.db.BeginTx(c.Context(), pgx.TxOptions{})
	if opErr != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer opTx.Rollback(c.Context())
	_, replayed, opErr := checkHostingIdempotency(c.Context(), opTx, user.ID, key, hash, "database.provision")
	if opErr != nil {
		return hostingIdempotencyError(c, opErr)
	}
	if replayed {
		return c.JSON(fiber.Map{"replayed": true, "notice": "คำขอนี้ถูกดำเนินการแล้ว ระบบจะไม่แสดงรหัสผ่านซ้ำ"})
	}
	_, opErr = opTx.Exec(c.Context(), `
		INSERT INTO hosting_operations
			(operation_id,site_id,actor_user_id,kind,idempotency_key,request_hash,state,phase,
			 started_at,timeout_seconds,error_code,error_message,retryable,metadata)
		VALUES ($1,$2,$3,'database.provision',$4,$5,'running','creating_database',
		        NOW(),120,'','',FALSE,jsonb_build_object('sitePublicId',$6::text))
	`, operationID, siteID, user.ID, key, hash, publicID)
	if opErr != nil {
		return hostingConflict(c, opErr)
	}
	if opErr = opTx.Commit(c.Context()); opErr != nil {
		return hostingConflict(c, opErr)
	}

	sitePublicID := publicID

	dbName, dbUser, dbPass, err := s.provisionDatabase(c.Context(), siteID, sitePublicID)
	if err != nil {
		_, _ = s.db.Exec(c.Context(), `
			UPDATE hosting_operations SET state='failed',phase='failed',finished_at=NOW(),
			       error_code='database_provision_failed',error_message='สร้างฐานข้อมูลไม่สำเร็จ',updated_at=NOW()
			WHERE operation_id=$1
		`, operationID)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาดในการสร้างฐานข้อมูล", Code: "provision_failed"})
	}

	_, _ = s.db.Exec(c.Context(), `
		UPDATE hosting_operations SET state='succeeded',phase='completed',finished_at=NOW(),updated_at=NOW()
		WHERE operation_id=$1
	`, operationID)
	s.audit(c, auditEvent{Actor: user, Category: "hosting", Action: "hosting.database_provisioned", Target: "hosting_site", TargetID: strconv.FormatInt(siteID, 10)})
	return c.JSON(fiber.Map{
		"dbName":      dbName,
		"dbUser":      dbUser,
		"dbPass":      dbPass,
		"status":      "running",
		"engine":      "mysql",
		"host":        "tenant-db",
		"port":        3306,
		"operationId": operationID,
		"notice":      "รหัสผ่านแสดงเพียงครั้งเดียว โปรดเก็บไว้ในที่ปลอดภัย",
	})
}

func (s *server) canManageSite(ctx context.Context, siteID int64, user *currentUser) bool {
	if user.Role == "admin" || user.Role == "superadmin" {
		return true
	}
	var count int
	err := s.db.QueryRow(ctx, `SELECT count(*) FROM hosting_sites s LEFT JOIN hosting_site_members member ON member.site_id = s.id WHERE s.id = $1 AND (s.owner_user_id = $2 OR (member.user_id = $2 AND member.role != 'viewer'))`, siteID, user.ID).Scan(&count)
	return err == nil && count > 0
}

// revokeHostingWorkspaceTokens ends a user's code-server tokens for one site. The gateway only
// checks the token row, so losing site access (removed, made a viewer) has to revoke it here.
func revokeHostingWorkspaceTokens(ctx context.Context, tx pgx.Tx, siteID, userID int64) error {
	_, err := tx.Exec(ctx, `
		UPDATE hosting_workspace_access_tokens
		SET revoked_at = COALESCE(revoked_at, NOW())
		WHERE site_id = $1 AND user_id = $2 AND revoked_at IS NULL
	`, siteID, userID)
	return err
}
