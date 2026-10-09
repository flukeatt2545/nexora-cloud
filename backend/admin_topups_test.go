package main

import (
	"reflect"
	"testing"
)

func TestTopupSettingsConfigured(t *testing.T) {
	valid := effectiveTopupSettings{
		Enabled:  true,
		APIToken: "token",
		TenantID: "tenant",
		Receiver: checkSlipsReceiver{BankCode: "KBANK", AccountNumber: "1234", AccountName: "Nexora"},
	}
	if !topupSettingsConfigured(valid) {
		t.Fatal("complete settings should be configured")
	}

	invalidCases := []effectiveTopupSettings{
		{Enabled: false, APIToken: "token", TenantID: "tenant", Receiver: valid.Receiver},
		{Enabled: true, APIToken: "", TenantID: "tenant", Receiver: valid.Receiver},
		{Enabled: true, APIToken: "token", TenantID: "", Receiver: valid.Receiver},
		{Enabled: true, APIToken: "token", TenantID: "tenant", Receiver: checkSlipsReceiver{}},
	}
	for index, settings := range invalidCases {
		if topupSettingsConfigured(settings) {
			t.Fatalf("case %d should not be configured", index)
		}
	}
}

func TestBuildTopupTransactionFilter(t *testing.T) {
	query, args := buildTopupTransactionFilter("tx-123", "completed", "7d")
	wantArgs := []any{"%tx-123%", "completed"}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args=%#v want=%#v", args, wantArgs)
	}
	for _, expected := range []string{"u.identifier ILIKE $1", "t.status=$2", "INTERVAL '7 days'"} {
		if !contains(query, expected) {
			t.Fatalf("filter %q does not contain %q", query, expected)
		}
	}

	query, args = buildTopupTransactionFilter("", "", "all")
	if query != "" || len(args) != 0 {
		t.Fatalf("all filter should be empty: %q %#v", query, args)
	}
}

func contains(value, fragment string) bool {
	for index := 0; index+len(fragment) <= len(value); index++ {
		if value[index:index+len(fragment)] == fragment {
			return true
		}
	}
	return false
}

func TestDecryptTopupSecretFallback(t *testing.T) {
	primaryKey := "new-primary-key"
	webhookKey := "old-webhook-key"
	secret := "sv_live_test_token"

	ciphertext, err := encryptSecret(secret, webhookKey)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}

	_, err = decryptSecret(ciphertext, primaryKey)
	if err == nil {
		t.Fatal("expected primary key decryption to fail")
	}

	token, err := decryptSecret(ciphertext, webhookKey)
	if err != nil || token != secret {
		t.Fatalf("expected fallback decryption to succeed, got %q, err: %v", token, err)
	}
}
