package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// The outside uptime checker: a Cloudflare Worker (uptime-worker/) that checks the site every
// minute from Cloudflare's network, so it still speaks up when this whole server is down.
// It reads its settings from GET /api/uptime-worker/config (keeping a copy for when the API is
// down) and sends results to POST /api/uptime-worker/report, queueing them while it cannot.
// Discord's webhook URL lives only in the Worker; nothing here knows it.
// Admins set it up and read the results on /admin/discord-bot (GET/PUT /api/admin/uptime).

type uptimeTarget struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
	Enabled bool   `json:"enabled"`
}

type uptimeSettings struct {
	Enabled         bool           `json:"enabled"`
	Targets         []uptimeTarget `json:"targets"`
	FailuresForDown int            `json:"failuresForDown"`
	SlowMs          int            `json:"slowMs"`
	MentionRoleID   string         `json:"mentionRoleId"`
	SenderName      string         `json:"senderName"`
	MinorMode       string         `json:"minorMode"`
	Version         int64          `json:"version"`
}

// What the Worker has told us about itself.
type uptimeWorkerState struct {
	TestRequestedAt *time.Time `json:"testRequestedAt"`
	TestSentAt      *time.Time `json:"testSentAt"`
	TestError       string     `json:"testError"`
	LastReportAt    *time.Time `json:"lastReportAt"`
}

const (
	uptimeMaxTargets   = 10
	uptimeKeepChecks   = 8 * 24 * time.Hour
	uptimeMaxChecks    = 5000
	uptimeMaxIncidents = 500
)

var uptimeTargetID = regexp.MustCompile(`^[a-z0-9-]{1,40}$`)

// validateUptimeWorkerSecret: the Worker's secret is its own. Empty leaves the checker off.
func validateUptimeWorkerSecret(cfg config) error {
	value := cfg.uptimeWorkerSecret
	if value == "" {
		return nil
	}
	lower := strings.ToLower(value)
	if len(value) < 32 || strings.Contains(lower, "change-this") || strings.Contains(lower, "local-only") || strings.Contains(lower, "replace-with") {
		return fmt.Errorf("UPTIME_WORKER_SECRET must be a unique secret of at least 32 characters in production")
	}
	if value == cfg.botInternalSecret || value == cfg.phpMyAdminInternalSecret || value == cfg.jwtSecret || value == cfg.webhookKey {
		return fmt.Errorf("UPTIME_WORKER_SECRET must differ from the other secrets")
	}
	return nil
}

func (s *server) verifyUptimeWorker(c *fiber.Ctx) error {
	secret := strings.TrimSpace(c.Get("X-Uptime-Worker-Secret"))
	expected := s.cfg.uptimeWorkerSecret
	if secret == "" || expected == "" || expected == s.cfg.botInternalSecret || expected == s.cfg.phpMyAdminInternalSecret ||
		subtle.ConstantTimeCompare([]byte(secret), []byte(expected)) != 1 {
		return fiber.NewError(fiber.StatusForbidden, "ไม่ได้รับอนุญาต")
	}
	return nil
}

func (s *server) loadUptimeSettings(ctx context.Context) (uptimeSettings, uptimeWorkerState, error) {
	var settings uptimeSettings
	var worker uptimeWorkerState
	var targets []byte
	err := s.db.QueryRow(ctx, `
		SELECT enabled, targets, failures_for_down, slow_ms, mention_role_id, sender_name, minor_mode, version,
			test_requested_at, test_sent_at, test_error, last_report_at
		FROM uptime_settings WHERE id = 1
	`).Scan(&settings.Enabled, &targets, &settings.FailuresForDown, &settings.SlowMs, &settings.MentionRoleID, &settings.SenderName,
		&settings.MinorMode, &settings.Version, &worker.TestRequestedAt, &worker.TestSentAt, &worker.TestError, &worker.LastReportAt)
	if err != nil {
		return settings, worker, err
	}
	if err := json.Unmarshal(targets, &settings.Targets); err != nil || settings.Targets == nil {
		settings.Targets = []uptimeTarget{}
	}
	return settings, worker, nil
}

func newUptimeTargetID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "t-" + hex.EncodeToString(b)
}

func validateUptimeSettings(input uptimeSettings) (uptimeSettings, error) {
	out := input
	out.SenderName = cleanText(input.SenderName, 80)
	out.MentionRoleID = strings.TrimSpace(input.MentionRoleID)
	if len(input.Targets) > uptimeMaxTargets {
		return out, fmt.Errorf("เช็กได้ไม่เกิน %d รายการ", uptimeMaxTargets)
	}
	if out.FailuresForDown < 1 || out.FailuresForDown > 10 {
		return out, errors.New("จำนวนรอบที่พลาดก่อนแจ้งต้องอยู่ระหว่าง 1 ถึง 10")
	}
	if out.SlowMs < 500 || out.SlowMs > 10000 {
		return out, errors.New("เกณฑ์ว่าช้าต้องอยู่ระหว่าง 0.5 ถึง 10 วินาที")
	}
	if out.MentionRoleID != "" && !validDiscordSnowflake(out.MentionRoleID) {
		return out, errors.New("ID ของ role ไม่ถูกต้อง")
	}
	lowerName := strings.ToLower(out.SenderName)
	if out.SenderName == "" || strings.Contains(lowerName, "discord") || strings.Contains(lowerName, "clyde") {
		// Discord refuses webhook names with these words in them.
		return out, errors.New("ใส่ชื่อผู้ส่ง และห้ามมีคำว่า discord หรือ clyde")
	}
	if out.MinorMode != "off" && out.MinorMode != "quiet" && out.MinorMode != "daily" {
		return out, errors.New("เลือกวิธีแจ้งการพลาดที่ไม่ถึงเกณฑ์ไม่ถูกต้อง")
	}
	seen := map[string]bool{}
	out.Targets = make([]uptimeTarget, 0, len(input.Targets))
	for _, target := range input.Targets {
		target.ID = strings.TrimSpace(target.ID)
		if target.ID == "" {
			target.ID = newUptimeTargetID()
		}
		target.Name = cleanText(target.Name, 60)
		target.URL = strings.TrimSpace(target.URL)
		if !uptimeTargetID.MatchString(target.ID) || seen[target.ID] {
			return out, errors.New("รายการที่เช็กมี ID ซ้ำหรือไม่ถูกต้อง")
		}
		seen[target.ID] = true
		if target.Name == "" {
			return out, errors.New("ใส่ชื่อที่แสดงของทุกรายการ")
		}
		parsed, err := url.Parse(target.URL)
		if err != nil || len(target.URL) > 300 || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil {
			return out, fmt.Errorf("URL ของ %s ไม่ถูกต้อง ต้องขึ้นต้นด้วย https:// หรือ http://", target.Name)
		}
		out.Targets = append(out.Targets, target)
	}
	return out, nil
}

// Worker side

func (s *server) uptimeWorkerConfig(c *fiber.Ctx) error {
	if err := s.verifyUptimeWorker(c); err != nil {
		return err
	}
	settings, worker, err := s.loadUptimeSettings(c.Context())
	if err != nil {
		return err
	}
	targets := []uptimeTarget{}
	for _, target := range settings.Targets {
		if target.Enabled {
			targets = append(targets, target)
		}
	}
	settings.Targets = targets
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{"settings": settings, "testRequestedAt": worker.TestRequestedAt})
}

type uptimeCheckReport struct {
	TargetID  string    `json:"targetId"`
	CheckedAt time.Time `json:"checkedAt"`
	OK        bool      `json:"ok"`
	Status    int       `json:"status"`
	LatencyMs int       `json:"latencyMs"`
	Colo      string    `json:"colo"`
	Error     string    `json:"error"`
	Retried   bool      `json:"retried"`
	Slow      bool      `json:"slow"`
}

type uptimeIncidentReport struct {
	TargetID   string     `json:"targetId"`
	TargetName string     `json:"targetName"`
	Kind       string     `json:"kind"`
	StartedAt  time.Time  `json:"startedAt"`
	EndedAt    *time.Time `json:"endedAt"`
	Detail     string     `json:"detail"`
}

type uptimeReport struct {
	Checks    []uptimeCheckReport    `json:"checks"`
	Incidents []uptimeIncidentReport `json:"incidents"`
	// Set when the Worker handled a test request: when it was sent, or why it could not be.
	Test *struct {
		SentAt time.Time `json:"sentAt"`
		Error  string    `json:"error"`
	} `json:"test"`
}

// usable: a report the Worker could have made, not one from the far future or long ago.
func uptimeTimeUsable(at, now time.Time) bool {
	return !at.IsZero() && at.Before(now.Add(5*time.Minute)) && at.After(now.Add(-30*24*time.Hour))
}

func (s *server) uptimeWorkerReport(c *fiber.Ctx) error {
	if err := s.verifyUptimeWorker(c); err != nil {
		return err
	}
	var input uptimeReport
	if c.BodyParser(&input) != nil || len(input.Checks) > uptimeMaxChecks || len(input.Incidents) > uptimeMaxIncidents {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	now := time.Now()
	var ids, colos, errs []string
	var times []time.Time
	var oks, retried, slow []bool
	var statuses, latencies []int32
	for _, check := range input.Checks {
		if !uptimeTargetID.MatchString(check.TargetID) || !uptimeTimeUsable(check.CheckedAt, now) {
			continue
		}
		ids = append(ids, check.TargetID)
		times = append(times, check.CheckedAt)
		oks = append(oks, check.OK)
		statuses = append(statuses, int32(min(max(check.Status, 0), 999)))
		latencies = append(latencies, int32(min(max(check.LatencyMs, 0), 600000)))
		colos = append(colos, cleanText(check.Colo, 8))
		errs = append(errs, cleanText(check.Error, 200))
		retried = append(retried, check.Retried)
		slow = append(slow, check.Slow)
	}
	ctx := c.Context()
	if len(ids) > 0 {
		if _, err := s.db.Exec(ctx, `
			INSERT INTO uptime_checks (target_id, checked_at, ok, status_code, latency_ms, colo, error, retried, slow)
			SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::bool[], $4::int2[], $5::int4[], $6::text[], $7::text[], $8::bool[], $9::bool[])
			ON CONFLICT (target_id, checked_at) DO NOTHING
		`, ids, times, oks, statuses, latencies, colos, errs, retried, slow); err != nil {
			return err
		}
	}
	for _, incident := range input.Incidents {
		if !uptimeTargetID.MatchString(incident.TargetID) || (incident.Kind != "down" && incident.Kind != "minor") || !uptimeTimeUsable(incident.StartedAt, now) {
			continue
		}
		if incident.EndedAt != nil && incident.EndedAt.Before(incident.StartedAt) {
			continue
		}
		// Sent once when it starts and again when it ends; a resend changes nothing.
		if _, err := s.db.Exec(ctx, `
			INSERT INTO uptime_incidents (target_id, target_name, kind, started_at, ended_at, detail) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (target_id, kind, started_at) DO UPDATE
			SET ended_at = COALESCE(EXCLUDED.ended_at, uptime_incidents.ended_at), detail = EXCLUDED.detail, target_name = EXCLUDED.target_name
		`, incident.TargetID, cleanText(incident.TargetName, 60), incident.Kind, incident.StartedAt, incident.EndedAt, cleanText(incident.Detail, 300)); err != nil {
			return err
		}
	}
	if input.Test != nil && uptimeTimeUsable(input.Test.SentAt, now) {
		if _, err := s.db.Exec(ctx, `UPDATE uptime_settings SET test_sent_at = $1, test_error = $2 WHERE id = 1`,
			input.Test.SentAt, cleanText(input.Test.Error, 200)); err != nil {
			return err
		}
	}
	if _, err := s.db.Exec(ctx, `UPDATE uptime_settings SET last_report_at = NOW() WHERE id = 1`); err != nil {
		return err
	}
	_, _ = s.db.Exec(ctx, `DELETE FROM uptime_checks WHERE checked_at < $1`, now.Add(-uptimeKeepChecks))
	_, _ = s.db.Exec(ctx, `DELETE FROM uptime_incidents WHERE started_at < NOW() - INTERVAL '180 days'`)
	return c.SendStatus(fiber.StatusNoContent)
}

// Web admin (superadmin)

type uptimeLastCheck struct {
	CheckedAt  time.Time `json:"checkedAt"`
	OK         bool      `json:"ok"`
	StatusCode int       `json:"statusCode"`
	LatencyMs  int       `json:"latencyMs"`
	Colo       string    `json:"colo"`
	Error      string    `json:"error"`
	Retried    bool      `json:"retried"`
	Slow       bool      `json:"slow"`
}

type uptimeTargetResult struct {
	uptimeTarget
	Last      *uptimeLastCheck `json:"last"`
	Uptime24h *float64         `json:"uptime24h"`
	Uptime7d  *float64         `json:"uptime7d"`
	Checks24h int              `json:"checks24h"`
}

type uptimeIncident struct {
	ID         int64      `json:"id"`
	TargetID   string     `json:"targetId"`
	TargetName string     `json:"targetName"`
	Kind       string     `json:"kind"`
	StartedAt  time.Time  `json:"startedAt"`
	EndedAt    *time.Time `json:"endedAt"`
	Detail     string     `json:"detail"`
}

// uptimeShare: per target, the share of good rounds since `since` and how many rounds there were.
func (s *server) uptimeShare(ctx context.Context, since time.Time) (map[string]float64, map[string]int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT target_id, COUNT(*) FILTER (WHERE ok), COUNT(*) FROM uptime_checks WHERE checked_at > $1 GROUP BY target_id
	`, since)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	share, count := map[string]float64{}, map[string]int{}
	for rows.Next() {
		var id string
		var good, all int
		if err := rows.Scan(&id, &good, &all); err != nil {
			return nil, nil, err
		}
		if all > 0 {
			share[id] = float64(good) * 100 / float64(all)
		}
		count[id] = all
	}
	return share, count, rows.Err()
}

func (s *server) adminUptime(c *fiber.Ctx) error {
	ctx := c.Context()
	settings, worker, err := s.loadUptimeSettings(ctx)
	if err != nil {
		return err
	}
	now := time.Now()
	day, dayCount, err := s.uptimeShare(ctx, now.Add(-24*time.Hour))
	if err != nil {
		return err
	}
	week, _, err := s.uptimeShare(ctx, now.Add(-7*24*time.Hour))
	if err != nil {
		return err
	}
	last := map[string]*uptimeLastCheck{}
	rows, err := s.db.Query(ctx, `
		SELECT DISTINCT ON (target_id) target_id, checked_at, ok, status_code, latency_ms, colo, error, retried, slow
		FROM uptime_checks WHERE checked_at > $1 ORDER BY target_id, checked_at DESC
	`, now.Add(-uptimeKeepChecks))
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var item uptimeLastCheck
		if err := rows.Scan(&id, &item.CheckedAt, &item.OK, &item.StatusCode, &item.LatencyMs, &item.Colo, &item.Error, &item.Retried, &item.Slow); err != nil {
			rows.Close()
			return err
		}
		last[id] = &item
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	results := make([]uptimeTargetResult, 0, len(settings.Targets))
	for _, target := range settings.Targets {
		result := uptimeTargetResult{uptimeTarget: target, Last: last[target.ID], Checks24h: dayCount[target.ID]}
		if value, ok := day[target.ID]; ok {
			result.Uptime24h = &value
		}
		if value, ok := week[target.ID]; ok {
			result.Uptime7d = &value
		}
		results = append(results, result)
	}

	incidents := []uptimeIncident{}
	rows, err = s.db.Query(ctx, `
		SELECT id, target_id, target_name, kind, started_at, ended_at, detail FROM uptime_incidents ORDER BY started_at DESC LIMIT 50
	`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item uptimeIncident
		if err := rows.Scan(&item.ID, &item.TargetID, &item.TargetName, &item.Kind, &item.StartedAt, &item.EndedAt, &item.Detail); err != nil {
			rows.Close()
			return err
		}
		incidents = append(incidents, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// The Discord bot's own checks (from this server), shown apart so the two are not mixed up.
	botIncidents := []communityIncident{}
	rows, err = s.db.Query(ctx, `SELECT id, target, started_at, ended_at, detail FROM discord_community_incidents ORDER BY started_at DESC LIMIT 20`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var item communityIncident
		if err := rows.Scan(&item.ID, &item.Target, &item.StartedAt, &item.EndedAt, &item.Detail); err != nil {
			rows.Close()
			return err
		}
		botIncidents = append(botIncidents, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	return c.JSON(fiber.Map{
		"settings": settings, "worker": worker, "secretReady": s.cfg.uptimeWorkerSecret != "",
		"targets": results, "incidents": incidents, "botIncidents": botIncidents, "now": now,
	})
}

func (s *server) updateAdminUptime(c *fiber.Ctx) error {
	var input uptimeSettings
	if c.BodyParser(&input) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	settings, err := validateUptimeSettings(input)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: err.Error(), Code: "invalid_settings"})
	}
	targets, err := json.Marshal(settings.Targets)
	if err != nil {
		return err
	}
	actor := current(c)
	var actorID *int64
	if actor != nil {
		actorID = &actor.ID
	}
	// The version the page loaded must still be the saved one, or someone else saved in between.
	tag, err := s.db.Exec(c.Context(), `
		UPDATE uptime_settings SET enabled = $1, targets = $2, failures_for_down = $3, slow_ms = $4, mention_role_id = $5,
			sender_name = $6, minor_mode = $7, version = version + 1, updated_by = $8, updated_at = NOW()
		WHERE id = 1 AND version = $9
	`, settings.Enabled, targets, settings.FailuresForDown, settings.SlowMs, settings.MentionRoleID, settings.SenderName,
		settings.MinorMode, actorID, input.Version)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "มีคนแก้การตั้งค่านี้ระหว่างนี้ โหลดใหม่แล้วแก้อีกครั้ง", Code: "settings_changed"})
	}
	s.audit(c, auditEvent{Actor: actor, Category: "discord", Action: "uptime.settings_updated", Target: "uptime_settings",
		Metadata: map[string]any{"enabled": settings.Enabled, "targets": len(settings.Targets), "failuresForDown": settings.FailuresForDown, "minorMode": settings.MinorMode}})
	return s.adminUptime(c)
}

func (s *server) adminUptimeTest(c *fiber.Ctx) error {
	if _, err := s.db.Exec(c.Context(), `UPDATE uptime_settings SET test_requested_at = NOW(), test_sent_at = NULL, test_error = '' WHERE id = 1`); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fiber.NewError(fiber.StatusNotFound)
		}
		return err
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "discord", Action: "uptime.test_requested", Target: "uptime_settings"})
	return s.adminUptime(c)
}
