package main

import (
	"net"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func (s *server) hostingDomainAuthorized(c *fiber.Ctx) error {
	domain := canonicalDomain(c.Query("domain"))
	base := canonicalDomain(s.cfg.cfDomain)
	if domain == "" || base == "" {
		return c.SendStatus(fiber.StatusForbidden)
	}
	if domain == base || domain == "www."+base || domain == "db."+base || domain == "status."+base {
		return c.SendStatus(fiber.StatusOK)
	}

	subdomain := ""
	if strings.HasSuffix(domain, "."+base) {
		subdomain = strings.TrimSuffix(domain, "."+base)
		if subdomain == "" || strings.Contains(subdomain, ".") {
			return c.SendStatus(fiber.StatusForbidden)
		}
	}
	lookupSub := subdomain
	if strings.HasPrefix(lookupSub, "code-") {
		lookupSub = strings.TrimPrefix(lookupSub, "code-")
	}
	var exists bool
	err := s.db.QueryRow(c.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM hosting_sites
			WHERE deleted_at IS NULL
			  AND (($1 <> '' AND LOWER(subdomain)=LOWER($1))
			       OR (custom_domain IS NOT NULL AND LOWER(custom_domain)=LOWER($2)))
		)
	`, lookupSub, domain).Scan(&exists)
	if err != nil || !exists {
		return c.SendStatus(fiber.StatusForbidden)
	}
	return c.SendStatus(fiber.StatusOK)
}

func canonicalDomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	value = strings.TrimSuffix(value, ".")
	if value == "" || len(value) > 253 || strings.ContainsAny(value, `/\\@ :`) {
		return ""
	}
	labels := strings.Split(value, ".")
	if len(labels) < 2 {
		return ""
	}
	for _, label := range labels {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return ""
		}
		for _, character := range label {
			if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '-' {
				continue
			}
			return ""
		}
	}
	return value
}
