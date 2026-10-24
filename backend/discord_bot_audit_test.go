package main

import (
	"github.com/gofiber/fiber/v2"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBotActivityRejectsUnauthorizedAndInvalid(t *testing.T) {
	s := &server{}
	s.cfg.botInternalSecret = "test-secret"
	app := fiber.New()
	app.Post("/activity", s.botActivity)
	for _, secret := range []string{"", "wrong", "test-secret"} {
		req := httptest.NewRequest("POST", "/activity", strings.NewReader(`{"actorId":"invalid","outcome":"success"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Bot-Internal-Secret", secret)
		response, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		expected := 403
		if secret == "test-secret" {
			expected = 400
		}
		if response.StatusCode != expected {
			t.Fatalf("status=%d expected=%d", response.StatusCode, expected)
		}
		response.Body.Close()
	}
}

func TestBotActivityEmbedDoesNotInventActorIP(t *testing.T) {
	embed := buildDiscordEmbed(auditEvent{Action: "discord.bot.activity", Outcome: "failure", Metadata: map[string]any{"discordActor": "123456789012345678", "command": "/crowdsec ban", "target": "1.2.3.4", "result": "ตรวจสอบ IP อีกครั้ง"}})
	fields := embed["fields"].([]fiber.Map)
	for _, field := range fields {
		if strings.Contains(field["name"].(string), "WAN") {
			t.Fatal("Discord actor IP must not be invented")
		}
	}
	if fields[1]["value"] != "ไม่สำเร็จ" {
		t.Fatal("incorrect outcome")
	}
}

func TestBotActivityUsesReadableThaiCopy(t *testing.T) {
	embed := buildBotActivityEmbed(auditEvent{Metadata: map[string]any{"command": "/bot-control status", "result": "การควบคุมบอต", "discordActor": "123456789012345678"}, Outcome: "success"})
	if embed["title"] != "ตรวจสอบสถานะบอต" {
		t.Fatal("expected readable Thai action")
	}
	if len(embed["fields"].([]fiber.Map)) != 2 {
		t.Fatal("redundant command / response must not be displayed")
	}
	if botCopy("unexpected-command").title != "ใช้งานบอต NEXORA" {
		t.Fatal("unknown commands need safe fallback")
	}
}

func TestBotAccessStopsAfterUnauthorizedResponse(t *testing.T) {
	s := &server{}
	s.cfg.botInternalSecret = "test-secret"
	app := fiber.New()
	app.Get("/access/:botKey", s.botDiscordAccess)
	app.Post("/access/:botKey", s.updateBotDiscordAccess)
	for _, method := range []string{"GET", "POST"} {
		request := httptest.NewRequest(method, "/access/nexora", strings.NewReader(`{}`))
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 403 {
			t.Fatalf("unauthorized %s got %d", method, response.StatusCode)
		}
		response.Body.Close()
	}
	request := httptest.NewRequest("POST", "/access/nexora", strings.NewReader(`{"action":"set_mode","value":"everyone"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Bot-Internal-Secret", "test-secret")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatalf("missing actor must be rejected, got %d", response.StatusCode)
	}
}

func TestBotCommandScopesRequireExplicitPermissionAdministration(t *testing.T) {
	if !botCommandScopes["bot.permissions"] || !botCommandScopes["admin-map.set"] || botCommandScopes["admin-map"] {
		t.Fatal("only explicit supported scopes may be delegated")
	}
	s := &server{}
	s.cfg.botInternalSecret = "test-secret"
	app := fiber.New()
	app.Post("/access/:botKey", s.updateBotDiscordAccess)
	request := httptest.NewRequest("POST", "/access/nexora", strings.NewReader(`{"action":"allow","scope":"bot.permissions","subjectType":"user","discordId":"1546900952940937237"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Bot-Internal-Secret", "test-secret")
	request.Header.Set("X-Bot-Actor-Discord-Id", "1546900952940937237")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatalf("unprivileged actor granted permissions: %d", response.StatusCode)
	}
}
