package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// canCreateWorkspaceToken lists the site roles that may open the code editor. It is an
// allow-list, so an empty or unknown role is refused instead of slipping past a
// "viewer" check.
func canCreateWorkspaceToken(role string) bool {
	switch role {
	case "owner", "platform_admin", "developer", "editor":
		return true
	default:
		return false
	}
}

func (s *server) createHostingWorkspaceToken(c *fiber.Ctx) error {
	actor := current(c)
	site, err := s.loadHostingSite(c.Context(), actor, c.Params("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !canCreateWorkspaceToken(site.AccessRole) {
		return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "บัญชีนี้มีสิทธิ์ดูเท่านั้น", Code: "workspace_read_only"})
	}

	var siteID int64
	var subdomain string
	err = s.db.QueryRow(c.Context(), `
		SELECT id, subdomain
		FROM hosting_sites
		WHERE public_id = $1 AND deleted_at IS NULL
	`, site.ID).Scan(&siteID, &subdomain)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบเว็บไซต์", Code: "site_not_found"})
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	token := hex.EncodeToString(tokenBytes)
	expiresAt := time.Now().Add(4 * time.Hour)

	var actorUserID *int64
	if actor != nil {
		actorUserID = &actor.ID
	}

	_, err = s.db.Exec(c.Context(), `
		INSERT INTO hosting_workspace_access_tokens
			(token_hash, site_id, site_public_id, user_id, student_code, expires_at)
		VALUES ($1, $2, $3, $4, '', $5)
	`, tokenHash(token), siteID, site.ID, actorUserID, expiresAt)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	baseDomain := strings.TrimSpace(os.Getenv("CF_HOSTING_DOMAIN"))
	if baseDomain == "" {
		baseDomain = "nkn02.com"
	}
	targetURL := fmt.Sprintf("https://code-%s.%s/?token=%s", subdomain, baseDomain, url.QueryEscape(token))

	return c.JSON(fiber.Map{
		"success":   true,
		"token":     token,
		"subdomain": subdomain,
		"url":       targetURL,
		"expiresAt": expiresAt,
	})
}
