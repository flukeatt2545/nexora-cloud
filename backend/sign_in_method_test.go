package main

import "testing"

func TestHasSignInMethod(t *testing.T) {
	cases := []struct {
		name     string
		settings publicSettings
		want     bool
	}{
		{"everything off", publicSettings{}, false},
		{"password only", publicSettings{LocalLoginEnabled: true}, true},
		{"discord only", publicSettings{DiscordEnabled: true}, true},
		{"google only", publicSettings{GoogleEnabled: true}, true},
		{"github only", publicSettings{GitHubEnabled: true}, true},
	}
	for _, tc := range cases {
		if got := hasSignInMethod(tc.settings); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}
