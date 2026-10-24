package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDiscordSnowflakeTime(t *testing.T) {
	// 175928847299117063 is the example id in Discord's docs: 2016-04-30 11:18:25 UTC.
	got, ok := discordSnowflakeTime("175928847299117063")
	if !ok || got.UTC().Format("2006-01-02 15:04") != "2016-04-30 11:18" {
		t.Fatalf("got %v %v", got, ok)
	}
	for _, bad := range []string{"", "abc", "0"} {
		if _, ok := discordSnowflakeTime(bad); ok {
			t.Errorf("%q should not parse", bad)
		}
	}
}

func TestEvaluateVerifyRules(t *testing.T) {
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	settings := communitySettings{VerifyMinAgeDays: 7, VerifyNeedAvatar: true}

	if code, _ := evaluateVerifyRules(settings, now.Add(-30*24*time.Hour), true, now); code != "" {
		t.Errorf("an old account with a picture should pass, got %s", code)
	}
	code, message := evaluateVerifyRules(settings, now.Add(-2*24*time.Hour), true, now)
	if code != "account_too_new" || message == "" {
		t.Errorf("a two-day-old account should be turned away, got %q", code)
	}
	if code, _ := evaluateVerifyRules(settings, now.Add(-30*24*time.Hour), false, now); code != "no_avatar" {
		t.Errorf("no picture should be turned away, got %q", code)
	}
	// Exactly the minimum age passes; a minute short does not.
	if code, _ := evaluateVerifyRules(settings, now.Add(-7*24*time.Hour), true, now); code != "" {
		t.Errorf("exactly 7 days should pass, got %q", code)
	}
	if code, _ := evaluateVerifyRules(settings, now.Add(-7*24*time.Hour+time.Minute), true, now); code != "account_too_new" {
		t.Errorf("a minute short of 7 days should not pass, got %q", code)
	}
	// Checks that are off let everyone through.
	if code, _ := evaluateVerifyRules(communitySettings{}, now, false, now); code != "" {
		t.Errorf("no checks should pass everyone, got %q", code)
	}
}

func TestVerifyReturnURL(t *testing.T) {
	cases := []struct {
		settings communitySettings
		want     string
	}{
		{communitySettings{GuildID: "1"}, "https://discord.com/channels/1"},
		{communitySettings{GuildID: "1", RolesChannelID: "3"}, "https://discord.com/channels/1/3"},
		{communitySettings{GuildID: "1", WelcomeChannelID: "2", RolesChannelID: "3"}, "https://discord.com/channels/1/2"},
	}
	for _, item := range cases {
		if got := verifyReturnURL(item.settings); got != item.want {
			t.Errorf("got %s, want %s", got, item.want)
		}
	}
}

func TestVerifyTokenShape(t *testing.T) {
	if !validVerifyToken(randomURLToken(24)) {
		t.Error("a token made by the bot should be accepted")
	}
	for _, bad := range []string{"", "short", "has spaces in it which is not valid at all!", string(make([]byte, 80))} {
		if validVerifyToken(bad) {
			t.Errorf("%q should be refused", bad)
		}
	}
}

func TestVerifyWebOn(t *testing.T) {
	on := communitySettings{VerifyEnabled: true, VerifyLevel: "standard", MemberRoleID: "2", GuildID: "1"}
	if !verifyWebOn(on) {
		t.Fatal("standard with a role should verify on the web")
	}
	for name, change := range map[string]func(*communitySettings){
		"button level":   func(s *communitySettings) { s.VerifyLevel = "button" },
		"turned off":     func(s *communitySettings) { s.VerifyEnabled = false },
		"no member role": func(s *communitySettings) { s.MemberRoleID = "" },
		"no server":      func(s *communitySettings) { s.GuildID = "" },
	} {
		settings := on
		change(&settings)
		if verifyWebOn(settings) {
			t.Errorf("%s should not verify on the web", name)
		}
	}
}

func TestVerifySettingsAreChecked(t *testing.T) {
	settings := defaultCommunitySettings()
	settings.VerifyLevel = "paranoid"
	if _, err := validateCommunitySettings(settings); err == nil {
		t.Error("an unknown level should be refused")
	}
	settings = defaultCommunitySettings()
	settings.VerifyMinAgeDays = 400
	if _, err := validateCommunitySettings(settings); err == nil {
		t.Error("an age over a year should be refused")
	}
	settings = defaultCommunitySettings()
	settings.VerifyLevel = ""
	checked, err := validateCommunitySettings(settings)
	if err != nil || checked.VerifyLevel != "button" {
		t.Errorf("a missing level should become the plain button, got %q %v", checked.VerifyLevel, err)
	}
	if defaultCommunitySettings().VerifyLevel != "button" {
		t.Error("existing servers must keep the plain button until an admin changes it")
	}
}

func TestVerifyTurnstile(t *testing.T) {
	var gotSecret, gotAnswer, gotIP string
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		gotSecret, gotAnswer, gotIP = r.PostForm.Get("secret"), r.PostForm.Get("response"), r.PostForm.Get("remoteip")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(map[bool]string{true: `{"success":true}`, false: `{"success":false}`}[gotAnswer == "good"]))
	}))
	defer fake.Close()
	previous := turnstileVerifyURL
	turnstileVerifyURL = fake.URL
	defer func() { turnstileVerifyURL = previous }()

	s := &server{cfg: config{turnstileSecret: "secret-key"}}
	ok, err := s.verifyTurnstile(context.Background(), "good", "1.2.3.4")
	if err != nil || !ok {
		t.Fatalf("a good answer should pass: %v %v", ok, err)
	}
	if gotSecret != "secret-key" || gotAnswer != "good" || gotIP != "1.2.3.4" {
		t.Errorf("Cloudflare was sent %q %q %q", gotSecret, gotAnswer, gotIP)
	}
	if ok, _ := s.verifyTurnstile(context.Background(), "bad", ""); ok {
		t.Error("a bad answer should not pass")
	}
	// An empty answer never reaches Cloudflare.
	gotAnswer = "untouched"
	if ok, err := s.verifyTurnstile(context.Background(), "  ", ""); ok || err != nil || gotAnswer != "untouched" {
		t.Errorf("an empty answer should fail without a call: %v %v %q", ok, err, gotAnswer)
	}
	// If Cloudflare cannot be reached the member is not let through.
	fake.Close()
	if ok, err := s.verifyTurnstile(context.Background(), "good", ""); ok || err == nil {
		t.Errorf("an unreachable Cloudflare must be an error, not a pass: %v %v", ok, err)
	}
}
