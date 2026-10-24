package main

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// The site's theme. The admin picks one that is used all year (site_theme) and can list date ranges
// in which another one takes over by itself, such as Halloween at the end of October. The server
// works out which theme is on today (in Thai time), so every visitor sees the same one, and the web
// page (app/siteThemes.ts) only has to draw it.

var siteThemes = map[string]bool{"default": true, "halloween": true, "christmas": true, "songkran": true, "cyberpunk": true}

const maxThemeRules = 24

// themeRule: from start to end (both days included) the site uses theme. A yearly rule repeats every
// year and may run over New Year (20 Dec to 2 Jan); only its month and day count. Otherwise the
// whole date counts.
type themeRule struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Theme   string `json:"theme"`
	Start   string `json:"start"`
	End     string `json:"end"`
	Yearly  bool   `json:"yearly"`
	Enabled bool   `json:"enabled"`
}

var themeDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func thaiNow() time.Time {
	location, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		location = time.FixedZone("ICT", 7*60*60)
	}
	return time.Now().In(location)
}

func validThemeDate(value string) bool {
	if !themeDatePattern.MatchString(value) {
		return false
	}
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

// ruleCovers: is the day (as "2006-01-02") inside the rule.
func ruleCovers(rule themeRule, day string) bool {
	if !rule.Enabled || !siteThemes[rule.Theme] || !validThemeDate(rule.Start) || !validThemeDate(rule.End) || len(day) != 10 {
		return false
	}
	if !rule.Yearly {
		return day >= rule.Start && day <= rule.End
	}
	// Compare month and day only: "MM-DD".
	today, from, to := day[5:], rule.Start[5:], rule.End[5:]
	if from <= to {
		return today >= from && today <= to
	}
	return today >= from || today <= to
}

// resolveSiteTheme is the theme that is on at this moment, and the rule that turned it on (nil when
// it is the all-year theme). When several rules cover the day the first one in the list wins.
func resolveSiteTheme(base string, rules []themeRule, now time.Time) (string, *themeRule) {
	if !siteThemes[base] {
		base = "default"
	}
	day := now.Format("2006-01-02")
	for index := range rules {
		if ruleCovers(rules[index], day) {
			return rules[index].Theme, &rules[index]
		}
	}
	return base, nil
}

// cleanThemeRules checks the list the admin page sends and returns it tidied.
func cleanThemeRules(rules []themeRule) ([]themeRule, string) {
	if len(rules) > maxThemeRules {
		return nil, "ตั้งช่วงวันที่ได้ไม่เกิน 24 ช่วง"
	}
	out := make([]themeRule, 0, len(rules))
	seen := map[string]bool{}
	for _, rule := range rules {
		rule.Label = cleanText(rule.Label, 60)
		rule.Start = strings.TrimSpace(rule.Start)
		rule.End = strings.TrimSpace(rule.End)
		if !siteThemes[rule.Theme] || rule.Theme == "default" {
			return nil, "เลือกธีมของช่วงวันที่ไม่ถูกต้อง"
		}
		if !validThemeDate(rule.Start) || !validThemeDate(rule.End) {
			return nil, "วันที่ไม่ถูกต้อง"
		}
		if !rule.Yearly && rule.End < rule.Start {
			return nil, "วันสิ้นสุดต้องไม่มาก่อนวันเริ่ม"
		}
		if rule.ID == "" || seen[rule.ID] || len(rule.ID) > 40 {
			rule.ID = randomHex(6)
		}
		seen[rule.ID] = true
		out = append(out, rule)
	}
	return out, ""
}

func (s *server) loadSiteTheme(ctx context.Context) (base string, rules []themeRule, err error) {
	var raw []byte
	if err = s.db.QueryRow(ctx, `SELECT site_theme, theme_schedule FROM system_settings WHERE id=1`).Scan(&base, &raw); err != nil {
		return "default", nil, err
	}
	rules = []themeRule{}
	_ = json.Unmarshal(raw, &rules)
	if !siteThemes[base] {
		base = "default"
	}
	return base, rules, nil
}

// currentSiteTheme is the theme the public pages should wear right now; the plain look if anything fails.
func (s *server) currentSiteTheme(ctx context.Context) string {
	base, rules, err := s.loadSiteTheme(ctx)
	if err != nil {
		return "default"
	}
	theme, _ := resolveSiteTheme(base, rules, thaiNow())
	return theme
}

func (s *server) adminSiteTheme(c *fiber.Ctx) error {
	base, rules, err := s.loadSiteTheme(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	now := thaiNow()
	active, rule := resolveSiteTheme(base, rules, now)
	ruleID := ""
	if rule != nil {
		ruleID = rule.ID
	}
	return c.JSON(fiber.Map{"theme": base, "schedule": rules, "active": active, "activeRuleId": ruleID, "today": now.Format("2006-01-02")})
}

func (s *server) updateAdminSiteTheme(c *fiber.Ctx) error {
	actor := current(c)
	var body struct {
		Theme    string      `json:"theme"`
		Schedule []themeRule `json:"schedule"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	if !siteThemes[body.Theme] {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ธีมไม่ถูกต้อง", Code: "invalid_theme"})
	}
	rules, problem := cleanThemeRules(body.Schedule)
	if problem != "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: problem, Code: "invalid_schedule"})
	}
	raw, _ := json.Marshal(rules)
	if _, err := s.db.Exec(c.Context(), `UPDATE system_settings SET site_theme=$1, theme_schedule=$2::jsonb, updated_by=$3, updated_at=NOW() WHERE id=1`, body.Theme, string(raw), actor.ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.audit(c, auditEvent{Actor: actor, Category: "settings", Action: "settings.theme_updated", Target: "system", TargetID: "1",
		Metadata: map[string]any{"theme": body.Theme, "rules": len(rules)}})
	return s.adminSiteTheme(c)
}
