package main

import "testing"

func TestNewAdminKeyMatchesWhatLoginAccepts(t *testing.T) {
	for i := 0; i < 50; i++ {
		if key := newAdminKey(); !adminKeyPattern.MatchString(key) {
			t.Fatalf("login would refuse a freshly made key: %q", key)
		}
	}
}

func TestAdminKeyPatternRefusesOtherText(t *testing.T) {
	for _, key := range []string{"", "nxk_", "password", "nxk_short", "nxk_" + "a b" + "cccccccccccccccccccccccccccccccccccccccc"} {
		if adminKeyPattern.MatchString(key) {
			t.Errorf("accepted %q", key)
		}
	}
}

func TestAdminKeyExpiryChoices(t *testing.T) {
	for days, want := range map[int]bool{0: true, 30: true, 90: true, 365: true, 1: false, -30: false, 9999: false} {
		if got := validAdminKeyExpiry(days); got != want {
			t.Errorf("%d days: got %v, want %v", days, got, want)
		}
	}
}
