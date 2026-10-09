package main

import "testing"

func TestCanonicalDomain(t *testing.T) {
	valid := map[string]string{
		"NKN02.COM.":         "nkn02.com",
		"demo122.nkn02.com":  "demo122.nkn02.com",
		"db.nkn02.com:443":   "db.nkn02.com",
		"custom-example.com": "custom-example.com",
	}
	for input, expected := range valid {
		if actual := canonicalDomain(input); actual != expected {
			t.Fatalf("canonicalDomain(%q)=%q, want %q", input, actual, expected)
		}
	}
	for _, input := range []string{"", "localhost", "https://nkn02.com", "bad..nkn02.com", "-bad.nkn02.com", "bad_domain.com"} {
		if actual := canonicalDomain(input); actual != "" {
			t.Fatalf("unsafe domain accepted: %q", input)
		}
	}
}
