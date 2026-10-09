package main

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

type runtimeSecurityAlertRequest struct {
	SitePublicID string `json:"sitePublicId"`
	Host         string `json:"host"`
	Reason       string `json:"reason"`
	IPAddress    string `json:"ipAddress"`
	Attempts     int    `json:"attempts"`
}

func (s *server) runtimeSecurityAlert(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}

	var body runtimeSecurityAlertRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	body.SitePublicID = cleanText(body.SitePublicID, 64)
	body.Host = cleanText(body.Host, 180)
	body.Reason = cleanText(body.Reason, 80)
	body.IPAddress = strings.TrimSpace(body.IPAddress)
	if body.SitePublicID == "" || body.Attempts < 1 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ครบถ้วน", Code: "invalid_alert"})
	}

	s.audit(c, auditEvent{
		Category:  "security",
		Action:    "workspace.security_alert",
		Target:    "hosting_site",
		TargetID:  body.SitePublicID,
		Outcome:   "blocked",
		IPAddress: body.IPAddress,
		Metadata: map[string]any{
			"host":     body.Host,
			"reason":   body.Reason,
			"attempts": body.Attempts,
		},
	})
	return c.SendStatus(fiber.StatusNoContent)
}
