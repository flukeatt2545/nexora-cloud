package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

const (
	vpsUptimeHost          = "nove666.pro"
	vpsUptimeStartHost     = "nkn02.com"
	vpsUptimeCookie        = "nove_vps_access"
	vpsUptimeTicketPrefix  = "vps-uptime:ticket:"
	vpsUptimeSessionPrefix = "vps-uptime:session:"
	vpsUptimeTicketTTL     = 2 * time.Minute
	vpsUptimeSessionTTL    = 15 * time.Minute
)

type vpsUptimeGrant struct {
	UserID      int64  `json:"userId"`
	SessionHash string `json:"sessionHash"`
}

func vpsUptimeHeaders(c *fiber.Ctx) {
	c.Set(fiber.HeaderCacheControl, "no-store, private, max-age=0")
	c.Set("Pragma", "no-cache")
	c.Set("Referrer-Policy", "no-referrer")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; font-src 'self' data:; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
}

func isVPSUptimeHost(c *fiber.Ctx) bool {
	return strings.EqualFold(c.Hostname(), vpsUptimeHost)
}

func newVPSUptimeToken() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func (s *server) startVPSUptimeAccess(c *fiber.Ctx) error {
	vpsUptimeHeaders(c)
	if !strings.EqualFold(c.Hostname(), vpsUptimeStartHost) {
		return c.SendStatus(fiber.StatusNotFound)
	}
	user, err := s.authenticate(c)
	if err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	if user == nil {
		return c.Redirect("https://nkn02.com/?next=vps-uptime#login", fiber.StatusSeeOther)
	}
	if (user.Role != "admin" && user.Role != "superadmin") || !user.PasswordEnabled {
		return c.Redirect("https://nove666.pro/vps/?denied=1", fiber.StatusSeeOther)
	}
	token, err := newVPSUptimeToken()
	if err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	grant := vpsUptimeGrant{UserID: user.ID, SessionHash: tokenHash(c.Cookies(s.cfg.cookieName))}
	value, err := json.Marshal(grant)
	if err != nil || s.redis.Set(c.Context(), vpsUptimeTicketPrefix+tokenHash(token), value, vpsUptimeTicketTTL).Err() != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	s.audit(c, auditEvent{Actor: user, Category: "security", Action: "vps_uptime.access_issued", Target: "system", Outcome: "success"})
	return c.Redirect("https://nove666.pro/vps/#ticket="+token, fiber.StatusSeeOther)
}

func (s *server) activeVPSUptimeAdmin(ctx context.Context, grant vpsUptimeGrant) (bool, error) {
	if grant.UserID <= 0 || len(grant.SessionHash) != 64 {
		return false, nil
	}
	exists, err := s.redis.Exists(ctx, "session:"+grant.SessionHash).Result()
	if err != nil || exists == 0 {
		return false, err
	}
	var userID int64
	var role, status string
	var passwordEnabled bool
	err = s.db.QueryRow(ctx, `
		SELECT u.id, u.role, u.status, u.password_enabled
		FROM user_sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
	`, grant.SessionHash).Scan(&userID, &role, &status, &passwordEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return userID == grant.UserID && status == "active" && passwordEnabled && (role == "admin" || role == "superadmin"), nil
}

func (s *server) exchangeVPSUptimeTicket(c *fiber.Ctx) error {
	vpsUptimeHeaders(c)
	if !isVPSUptimeHost(c) || c.Get(fiber.HeaderOrigin) != "https://nove666.pro" {
		return c.SendStatus(fiber.StatusForbidden)
	}
	var input struct {
		Ticket string `json:"ticket"`
	}
	if c.BodyParser(&input) != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(input.Ticket)
	if err != nil || len(decoded) != 32 {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	value, err := s.redis.GetDel(c.Context(), vpsUptimeTicketPrefix+tokenHash(input.Ticket)).Bytes()
	if err != nil {
		return c.SendStatus(fiber.StatusGone)
	}
	var grant vpsUptimeGrant
	if json.Unmarshal(value, &grant) != nil {
		return c.SendStatus(fiber.StatusGone)
	}
	allowed, err := s.activeVPSUptimeAdmin(c.Context(), grant)
	if err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	if !allowed {
		return c.SendStatus(fiber.StatusForbidden)
	}
	sessionToken, err := newVPSUptimeToken()
	if err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	if err := s.redis.Set(c.Context(), vpsUptimeSessionPrefix+tokenHash(sessionToken), value, vpsUptimeSessionTTL).Err(); err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	c.Cookie(&fiber.Cookie{
		Name: vpsUptimeCookie, Value: sessionToken, Path: "/vps", MaxAge: int(vpsUptimeSessionTTL.Seconds()),
		Secure: true, HTTPOnly: true, SameSite: fiber.CookieSameSiteStrictMode,
	})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) vpsUptimeAuthorized(c *fiber.Ctx) (bool, error) {
	token := c.Cookies(vpsUptimeCookie)
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(decoded) != 32 {
		return false, nil
	}
	value, err := s.redis.Get(c.Context(), vpsUptimeSessionPrefix+tokenHash(token)).Bytes()
	if err != nil {
		return false, nil
	}
	var grant vpsUptimeGrant
	if json.Unmarshal(value, &grant) != nil {
		return false, nil
	}
	return s.activeVPSUptimeAdmin(c.Context(), grant)
}

func (s *server) vpsUptimePage(c *fiber.Ctx) error {
	vpsUptimeHeaders(c)
	if !isVPSUptimeHost(c) {
		return c.SendStatus(fiber.StatusNotFound)
	}
	allowed, err := s.vpsUptimeAuthorized(c)
	if err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	c.Type("html", "utf-8")
	if !allowed {
		return c.Status(fiber.StatusUnauthorized).SendString(vpsUptimeAccessHTML(c.Query("denied") == "1"))
	}
	return c.SendString(vpsUptimeDashboardHTML)
}

func parseVPSUptime(raw string) (int64, error) {
	parts := strings.Fields(raw)
	if len(parts) == 0 {
		return 0, errors.New("missing uptime")
	}
	value, err := strconv.ParseFloat(parts[0], 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1e12 {
		return 0, errors.New("invalid uptime")
	}
	return int64(value), nil
}

func (s *server) vpsUptimeData(c *fiber.Ctx) error {
	vpsUptimeHeaders(c)
	if !isVPSUptimeHost(c) {
		return c.SendStatus(fiber.StatusNotFound)
	}
	allowed, err := s.vpsUptimeAuthorized(c)
	if err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	if !allowed {
		return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "กรุณาเข้าสู่ระบบแอดมิน", Code: "unauthenticated"})
	}
	raw, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	seconds, err := parseVPSUptime(string(raw))
	if err != nil {
		return c.SendStatus(fiber.StatusServiceUnavailable)
	}
	now := time.Now().UTC()
	return c.JSON(fiber.Map{
		"uptimeSeconds": seconds,
		"bootedAt":      time.Unix(now.Unix()-seconds, 0).UTC().Format(time.RFC3339),
		"checkedAt":     now.Format(time.RFC3339),
	})
}

func (s *server) logoutVPSUptime(c *fiber.Ctx) error {
	vpsUptimeHeaders(c)
	if !isVPSUptimeHost(c) || c.Get(fiber.HeaderOrigin) != "https://nove666.pro" {
		return c.SendStatus(fiber.StatusForbidden)
	}
	if token := c.Cookies(vpsUptimeCookie); token != "" {
		s.redis.Del(c.Context(), vpsUptimeSessionPrefix+tokenHash(token))
	}
	c.Cookie(&fiber.Cookie{
		Name: vpsUptimeCookie, Value: "", Path: "/vps", MaxAge: -1, Expires: time.Unix(1, 0),
		Secure: true, HTTPOnly: true, SameSite: fiber.CookieSameSiteStrictMode,
	})
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) vpsUptimeStyle(c *fiber.Ctx) error {
	vpsUptimeHeaders(c)
	if !isVPSUptimeHost(c) {
		return c.SendStatus(fiber.StatusNotFound)
	}
	c.Type("css", "utf-8")
	return c.SendString(lockdownFontFaceCSS + vpsUptimeCSS)
}

func (s *server) vpsUptimeScript(c *fiber.Ctx) error {
	vpsUptimeHeaders(c)
	if !isVPSUptimeHost(c) {
		return c.SendStatus(fiber.StatusNotFound)
	}
	c.Type("js", "utf-8")
	return c.SendString(vpsUptimeJS)
}
