package main

import "testing"

func TestCanCreateWorkspaceToken(t *testing.T) {
	tests := map[string]bool{
		"owner":          true,
		"platform_admin": true,
		"developer":      true,
		"editor":         true,
		"viewer":         false,
		"":               false,
		"unknown":        false,
	}
	for role, expected := range tests {
		if actual := canCreateWorkspaceToken(role); actual != expected {
			t.Fatalf("role %q: expected %v, got %v", role, expected, actual)
		}
	}
}
