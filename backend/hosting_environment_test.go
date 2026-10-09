package main

import "testing"

func TestHostingEnvironmentValidationAndEncryption(t *testing.T) {
	for _, name := range []string{"API_KEY", "_PRIVATE", "DATABASE_URL", "A1"} {
		if !validHostingEnvironmentName(name) {
			t.Fatalf("expected %q to be valid", name)
		}
	}
	for _, name := range []string{"", "lowercase", "1START", "HAS-DASH", "PORT", "HOME", "NODE_ENV"} {
		if validHostingEnvironmentName(name) {
			t.Fatalf("expected %q to be rejected", name)
		}
	}
	const value = "a-secret-value"
	ciphertext, err := encryptSecret(value, "test-hosting-key")
	if err != nil {
		t.Fatal(err)
	}
	if ciphertext == value || ciphertext == "" {
		t.Fatal("secret was not encrypted")
	}
	plain, err := decryptSecret(ciphertext, "test-hosting-key")
	if err != nil || plain != value {
		t.Fatal("encrypted value did not round-trip")
	}
}
