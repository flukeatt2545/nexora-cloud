package main

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// The uptime Worker has its own secret: the bot's or phpMyAdmin's secret must not open its
// routes, and its secret must not be one of theirs.
func TestUptimeWorkerSecretIsItsOwn(t *testing.T) {
	s := &server{}
	s.cfg.botInternalSecret = "bot-secret"
	s.cfg.phpMyAdminInternalSecret = "pma-secret"
	s.cfg.uptimeWorkerSecret = "uptime-secret"
	app := fiber.New()
	app.Get("/w", func(c *fiber.Ctx) error {
		if err := s.verifyUptimeWorker(c); err != nil {
			return err
		}
		return c.SendStatus(fiber.StatusOK)
	})
	call := func(headers map[string]string) int {
		req := httptest.NewRequest("GET", "/w", nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	cases := []struct {
		name    string
		headers map[string]string
		want    int
	}{
		{"its secret", map[string]string{"X-Uptime-Worker-Secret": "uptime-secret"}, 200},
		{"bot secret in its header", map[string]string{"X-Uptime-Worker-Secret": "bot-secret"}, 403},
		{"pma secret in its header", map[string]string{"X-Uptime-Worker-Secret": "pma-secret"}, 403},
		{"its secret in the bot header", map[string]string{"X-Bot-Internal-Secret": "uptime-secret"}, 403},
		{"no secret", nil, 403},
	}
	for _, tc := range cases {
		if got := call(tc.headers); got != tc.want {
			t.Fatalf("%s: status %d, want %d", tc.name, got, tc.want)
		}
	}

	// Off when unset, and when someone sets it to the bot's secret.
	s.cfg.uptimeWorkerSecret = ""
	if got := call(map[string]string{"X-Uptime-Worker-Secret": ""}); got != 403 {
		t.Fatalf("unset secret: status %d, want 403", got)
	}
	s.cfg.uptimeWorkerSecret = "bot-secret"
	if got := call(map[string]string{"X-Uptime-Worker-Secret": "bot-secret"}); got != 403 {
		t.Fatalf("shared secret: status %d, want 403", got)
	}
}

func TestValidateUptimeWorkerSecret(t *testing.T) {
	strong := strings.Repeat("a", 40)
	cfg := config{botInternalSecret: strings.Repeat("b", 40), phpMyAdminInternalSecret: strings.Repeat("c", 40)}
	if err := validateUptimeWorkerSecret(cfg); err != nil {
		t.Fatalf("empty secret should leave the checker off, got %v", err)
	}
	cfg.uptimeWorkerSecret = strong
	if err := validateUptimeWorkerSecret(cfg); err != nil {
		t.Fatalf("strong secret refused: %v", err)
	}
	for _, bad := range []string{"short", "local-only-change-this-uptime-worker-secret", cfg.botInternalSecret, cfg.phpMyAdminInternalSecret} {
		cfg.uptimeWorkerSecret = bad
		if validateUptimeWorkerSecret(cfg) == nil {
			t.Fatalf("secret %q should be refused", bad)
		}
	}
}

func TestValidateUptimeSettings(t *testing.T) {
	good := uptimeSettings{
		Enabled: true, FailuresForDown: 2, SlowMs: 3000, SenderName: "NEXORA CLOUD", MinorMode: "quiet",
		Targets: []uptimeTarget{{ID: "web", Name: "เว็บไซต์", URL: "https://nkn02.com", Enabled: true}, {Name: "ใหม่", URL: "https://api.nkn02.com/health"}},
	}
	out, err := validateUptimeSettings(good)
	if err != nil {
		t.Fatalf("good settings refused: %v", err)
	}
	if out.Targets[1].ID == "" || !uptimeTargetID.MatchString(out.Targets[1].ID) {
		t.Fatalf("a new target should get an id, got %q", out.Targets[1].ID)
	}

	bad := map[string]func(*uptimeSettings){
		"no url scheme":       func(s *uptimeSettings) { s.Targets[0].URL = "nkn02.com" },
		"ftp url":             func(s *uptimeSettings) { s.Targets[0].URL = "ftp://nkn02.com" },
		"user in url":         func(s *uptimeSettings) { s.Targets[0].URL = "https://a:b@nkn02.com" },
		"empty name":          func(s *uptimeSettings) { s.Targets[0].Name = " " },
		"same id twice":       func(s *uptimeSettings) { s.Targets[1].ID = "web" },
		"failures too high":   func(s *uptimeSettings) { s.FailuresForDown = 11 },
		"slow too low":        func(s *uptimeSettings) { s.SlowMs = 100 },
		"bad role":            func(s *uptimeSettings) { s.MentionRoleID = "123" },
		"discord in the name": func(s *uptimeSettings) { s.SenderName = "Discord Status" },
		"unknown minor mode":  func(s *uptimeSettings) { s.MinorMode = "loud" },
		"too many targets": func(s *uptimeSettings) {
			for len(s.Targets) <= uptimeMaxTargets {
				s.Targets = append(s.Targets, uptimeTarget{Name: "x", URL: "https://nkn02.com"})
			}
		},
	}
	for name, change := range bad {
		input := good
		input.Targets = append([]uptimeTarget(nil), good.Targets...)
		change(&input)
		if _, err := validateUptimeSettings(input); err == nil {
			t.Fatalf("%s: should be refused", name)
		}
	}
}
