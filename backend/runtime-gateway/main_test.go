package main

import (
	"net/http"
	"net/url"
	"testing"
	"time"
)

func TestCanonicalHost(t *testing.T) {
	tests := map[string]string{
		"Site.NKN02.com:8088": "site.nkn02.com",
		"portal.example.com.": "portal.example.com",
		" bad host ":          "",
		"http://example.com":  "",
	}
	for input, expected := range tests {
		if actual := canonicalHost(input); actual != expected {
			t.Fatalf("canonicalHost(%q)=%q, want %q", input, actual, expected)
		}
	}
}

func TestSubdomainRouting(t *testing.T) {
	g := gateway{baseDomains: []string{"nkn02.com", "localhost"}}
	if value := g.subdomain("demo.nkn02.com"); value != "demo" {
		t.Fatalf("unexpected subdomain: %q", value)
	}
	if value := g.subdomain("demo.localhost"); value != "demo" {
		t.Fatalf("unexpected local subdomain: %q", value)
	}
	if value := g.subdomain("nested.demo.nkn02.com"); value != "" {
		t.Fatalf("nested subdomain must be rejected: %q", value)
	}
}

func TestSafeWorkspaceTarget(t *testing.T) {
	cases := map[string]string{
		"https://code-demo.nkn02.com/?token=abc":                  "/?folder=%2Fhome%2Fcoder%2Fproject",
		"https://code-demo.nkn02.com/?token=abc&x=1":              "/?folder=%2Fhome%2Fcoder%2Fproject&x=1",
		"https://code-demo.nkn02.com/?workspace=/tmp/project":     "/?folder=%2Fhome%2Fcoder%2Fproject",
		"https://code-demo.nkn02.com/folder/file?folder=/":        "/folder/file?folder=%2Fhome%2Fcoder%2Fproject",
		"https://code-demo.nkn02.com/?folder=/home/coder/project": "/?folder=%2Fhome%2Fcoder%2Fproject",
	}
	for raw, expected := range cases {
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("parse %q: %v", raw, err)
		}
		if got := safeWorkspaceTarget(parsed); got != expected {
			t.Fatalf("safeWorkspaceTarget(%q)=%q, want %q", raw, got, expected)
		}
	}
}

func TestHasUnsafeWorkspaceTarget(t *testing.T) {
	for raw, expected := range map[string]bool{
		"https://code-demo.nkn02.com/":                            false,
		"https://code-demo.nkn02.com/?folder=/home/coder/project": false,
		"https://code-demo.nkn02.com/?folder=/":                   true,
		"https://code-demo.nkn02.com/?workspace=/tmp/project":     true,
	} {
		parsed, err := url.Parse(raw)
		if err != nil {
			t.Fatalf("parse %q: %v", raw, err)
		}
		if got := hasUnsafeWorkspaceTarget(parsed); got != expected {
			t.Fatalf("hasUnsafeWorkspaceTarget(%q)=%v, want %v", raw, got, expected)
		}
	}
}

func TestWorkspaceSessionCookie(t *testing.T) {
	cookie := workspaceSessionCookie("tok", true)
	if cookie.Name != "nexora_code_session" || cookie.Value != "tok" {
		t.Fatalf("unexpected cookie name/value: %+v", cookie)
	}
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie must be HttpOnly, Secure and SameSite=Strict: %+v", cookie)
	}
	if cookie.Path != "/" {
		t.Fatalf("cookie path must be /: %+v", cookie)
	}
	if want := int((4 * time.Hour).Seconds()); cookie.MaxAge != want {
		t.Fatalf("cookie max-age = %d, want %d", cookie.MaxAge, want)
	}
}

func TestShouldStripWorkspaceToken(t *testing.T) {
	document := func() *http.Request {
		req, _ := http.NewRequest(http.MethodGet, "https://code-demo.nkn02.com/", nil)
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
		return req
	}
	if !shouldStripWorkspaceToken(document()) {
		t.Fatal("browser document navigation should strip the token")
	}

	websocket := document()
	websocket.Header.Set("Upgrade", "websocket")
	if shouldStripWorkspaceToken(websocket) {
		t.Fatal("websocket upgrade must not be redirected")
	}

	api, _ := http.NewRequest(http.MethodGet, "https://code-demo.nkn02.com/", nil)
	api.Header.Set("Accept", "application/json")
	if shouldStripWorkspaceToken(api) {
		t.Fatal("non-HTML requests must not be redirected")
	}

	post, _ := http.NewRequest(http.MethodPost, "https://code-demo.nkn02.com/", nil)
	post.Header.Set("Accept", "text/html")
	if shouldStripWorkspaceToken(post) {
		t.Fatal("non-GET requests must not be redirected")
	}
}
