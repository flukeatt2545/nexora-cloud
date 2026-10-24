package main

import "testing"

func TestCommunitySecurityRoom(t *testing.T) {
	for action, want := range map[string]string{
		"discord.voice.entry_denied": "discord",
		"discord.voice.locked_out":   "discord",
		"discord.bot_token.updated":  "site",
		"auth.login":                 "site",
	} {
		if got := communitySecurityRoom(action); got != want {
			t.Errorf("%s: got %s, want %s", action, got, want)
		}
	}
}
