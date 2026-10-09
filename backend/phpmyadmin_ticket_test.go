package main

import "testing"

func TestPhpMyAdminBindingHash(t *testing.T) {
	first := hashBinding("127.0.0.1")
	if len(first) != 64 {
		t.Fatalf("expected SHA-256 hex hash, got %d characters", len(first))
	}
	if first == "127.0.0.1" {
		t.Fatal("binding must not be stored as plaintext")
	}
	if first != hashBinding("127.0.0.1") {
		t.Fatal("binding hash must be deterministic")
	}
	if first == hashBinding("127.0.0.2") {
		t.Fatal("different bindings must produce different hashes")
	}
}
