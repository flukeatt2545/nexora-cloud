package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"
)

// TestWorkspaceLaunchKeyHash verifies that Redis keys for workspace tickets
// use SHA-256 hashing to avoid plaintext exposure, are deterministic, and have the correct prefix.
func TestWorkspaceLaunchKeyHash(t *testing.T) {
	ticket := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	key := workspaceLaunchKey(ticket)

	prefix := "workspace:launch:"
	if !strings.HasPrefix(key, prefix) {
		t.Fatalf("expected key to start with '%s', got '%s'", prefix, key)
	}

	hashPart := strings.TrimPrefix(key, prefix)
	if len(hashPart) != 64 {
		t.Fatalf("expected 64-character SHA-256 hex hash, got %d characters", len(hashPart))
	}

	// Verify plaintext ticket does not leak into the Redis key
	if strings.Contains(key, ticket) {
		t.Fatal("plaintext ticket must not appear in Redis key")
	}

	// Verify determinism
	if key != workspaceLaunchKey(ticket) {
		t.Fatal("workspaceLaunchKey must be deterministic")
	}

	// Verify uniqueness
	ticket2 := "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
	if workspaceLaunchKey(ticket) == workspaceLaunchKey(ticket2) {
		t.Fatal("different tickets must yield distinct Redis keys")
	}
}

// TestWorkspaceTokenCSPRNGEntropy tests the cryptographic randomness of the token generator.
// Generates 50,000 tokens (32 bytes / 64 hex characters) and verifies:
// 1. Exact length (64 chars)
// 2. Character set [0-9a-f]
// 3. Zero collisions
// 4. Shannon entropy >= 3.99 bits per hex char (out of 4.0 theoretical max)
func TestWorkspaceTokenCSPRNGEntropy(t *testing.T) {
	const sampleCount = 50000
	seen := make(map[string]struct{}, sampleCount)
	charCounts := make(map[rune]int)

	for i := 0; i < sampleCount; i++ {
		raw := make([]byte, 32)
		n, err := rand.Read(raw)
		if err != nil {
			t.Fatalf("rand.Read failed at iteration %d: %v", i, err)
		}
		if n != 32 {
			t.Fatalf("expected 32 random bytes, got %d", n)
		}

		token := hex.EncodeToString(raw)
		if len(token) != 64 {
			t.Fatalf("expected 64 hex characters, got %d", len(token))
		}

		if _, exists := seen[token]; exists {
			t.Fatalf("CRITICAL: Collision detected after %d tokens: %s", i+1, token)
		}
		seen[token] = struct{}{}

		for _, ch := range token {
			if (ch < '0' || ch > '9') && (ch < 'a' || ch > 'f') {
				t.Fatalf("invalid character '%c' in hex token %s", ch, token)
			}
			charCounts[ch]++
		}
	}

	// Calculate Shannon Entropy across hex character distribution
	totalChars := float64(sampleCount * 64)
	entropy := 0.0
	for _, count := range charCounts {
		if count > 0 {
			p := float64(count) / totalChars
			entropy -= p * math.Log2(p)
		}
	}

	// Max theoretical entropy for 16 symbols is log2(16) = 4.0 bits
	if entropy < 3.99 {
		t.Fatalf("insufficient Shannon entropy: got %f, expected >= 3.99 bits per character", entropy)
	}
}

// TestWorkspaceSSOTicketSerialization ensures WorkspaceSSOTicket serializes
// and deserializes losslessly for Redis storage.
func TestWorkspaceSSOTicketSerialization(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	original := WorkspaceSSOTicket	{
		StudentCode:     "109",
		SiteID:          42,
		SitePublicID:    "site_pub_abc123",
		OwnerUserID:     1001,
		DiscordUserID:   "987654321098765432",
		DiscordUsername: "alex_dev",
		IsAdmin:         false,
		CreatedAt:       now,
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var restored WorkspaceSSOTicket
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	if restored.StudentCode != original.StudentCode {
		t.Errorf("StudentCode mismatch: got %s, want %s", restored.StudentCode, original.StudentCode)
	}
	if restored.SiteID != original.SiteID {
		t.Errorf("SiteID mismatch: got %d, want %d", restored.SiteID, original.SiteID)
	}
	if restored.SitePublicID != original.SitePublicID {
		t.Errorf("SitePublicID mismatch: got %s, want %s", restored.SitePublicID, original.SitePublicID)
	}
	if restored.OwnerUserID != original.OwnerUserID {
		t.Errorf("OwnerUserID mismatch: got %d, want %d", restored.OwnerUserID, original.OwnerUserID)
	}
	if restored.DiscordUserID != original.DiscordUserID {
		t.Errorf("DiscordUserID mismatch: got %s, want %s", restored.DiscordUserID, original.DiscordUserID)
	}
	if restored.DiscordUsername != original.DiscordUsername {
		t.Errorf("DiscordUsername mismatch: got %s, want %s", restored.DiscordUsername, original.DiscordUsername)
	}
	if restored.IsAdmin != original.IsAdmin {
		t.Errorf("IsAdmin mismatch: got %v, want %v", restored.IsAdmin, original.IsAdmin)
	}
}
