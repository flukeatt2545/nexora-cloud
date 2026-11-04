package main

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestSiteOfflineGateAnswersFromKnownState(t *testing.T) {
	s := &server{}
	app := fiber.New()
	app.Get("/api/internal/site-offline/gate", s.siteOfflineGate)

	for _, tc := range []struct {
		enabled bool
		want    int
	}{{true, fiber.StatusLocked}, {false, fiber.StatusNoContent}} {
		s.rememberSiteOffline(siteOfflineState{Enabled: tc.enabled, UpdatedAt: time.Now()})
		resp, err := app.Test(httptest.NewRequest("GET", "/api/internal/site-offline/gate", nil))
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != tc.want {
			t.Fatalf("enabled=%v: got %d, want %d", tc.enabled, resp.StatusCode, tc.want)
		}
	}
}

func TestSiteOfflineExpired(t *testing.T) {
	now := time.Now()
	past, future := now.Add(-time.Second), now.Add(time.Hour)
	if !siteOfflineExpired(siteOfflineState{Enabled: true, ExpiresAt: &past}, now) {
		t.Fatal("past expiry should count as expired")
	}
	if siteOfflineExpired(siteOfflineState{Enabled: true, ExpiresAt: &future}, now) {
		t.Fatal("future expiry should not count as expired")
	}
	if siteOfflineExpired(siteOfflineState{Enabled: true}, now) {
		t.Fatal("no expiry means closed until opened by hand")
	}
}

func TestEdgeGatePaths(t *testing.T) {
	for _, path := range []string{"/api/internal/lockdown/gate", "/api/internal/site-offline/gate"} {
		if !isEdgeGatePath(path) {
			t.Fatalf("%s should be reachable by Caddy", path)
		}
	}
	if isEdgeGatePath("/api/internal/bot/site-offline") {
		t.Fatal("bot routes must stay closed to the edge")
	}
}
