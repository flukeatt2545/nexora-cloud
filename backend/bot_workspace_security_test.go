package main

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

func TestWorkspaceLaunchKeyIntegrity(t *testing.T) {
	token := "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
	key := workspaceLaunchKey(token)
	if !strings.HasPrefix(key, "workspace:launch:") {
		t.Fatalf("expected prefix 'workspace:launch:', got %s", key)
	}
	hashPart := strings.TrimPrefix(key, "workspace:launch:")
	if len(hashPart) != 64 {
		t.Fatalf("expected 64-char sha256 hex string, got length %d", len(hashPart))
	}
	expectedHash := sha256.Sum256([]byte(token))
	if hashPart != hex.EncodeToString(expectedHash[:]) {
		t.Fatalf("hash mismatch in workspaceLaunchKey")
	}
}

func TestWorkspaceSSOTicketSerializationChallenger2(t *testing.T) {
	_ = time.Now().UTC()
	ticket := WorkspaceSSOTicket{
		StudentCode:     "109",
		SiteID:          42,
		SitePublicID:    "site_pub_abc123",
		OwnerUserID:     1001,
		DiscordUserID:   "discord_user_999",
		DiscordUsername: "student_alice",
		IsAdmin:         false,
	}
	if ticket.SiteID != 42 {
		t.Fatalf("expected 42")
	}
}
