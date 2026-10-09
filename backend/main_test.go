package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	s := &server{cfg: config{
		argonMemory:     8 * 1024,
		argonIterations: 1,
		argonParallel:   1,
		argonKeyLength:  32,
	}}
	hash, err := s.hashPassword("StrongPassword123")
	if err != nil {
		t.Fatal(err)
	}
	if !s.verifyPassword("StrongPassword123", hash) {
		t.Fatal("valid password was rejected")
	}
	if s.verifyPassword("WrongPassword123", hash) {
		t.Fatal("invalid password was accepted")
	}
}

func TestSensitiveResponseHeaders(t *testing.T) {
	app := fiber.New()
	app.Get("/", sensitiveResponseHeaders, func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusOK) })
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if got := response.Header.Get("Cache-Control"); got != "no-store, private, max-age=0" {
		t.Fatalf("unexpected cache policy: %q", got)
	}
	if got := response.Header.Get("Referrer-Policy"); got != "no-referrer" {
		t.Fatalf("unexpected referrer policy: %q", got)
	}
}

func TestProductionConfigValidation(t *testing.T) {
	valid := config{
		environment:              "production",
		cookieSecure:             true,
		allowedOrigins:           map[string]bool{"https://nkn02.com": true},
		s3SecretKey:              strings.Repeat("a", 32),
		webhookKey:               strings.Repeat("b", 32),
		hostingEncryptionKey:     strings.Repeat("c", 32),
		phpMyAdminInternalSecret: strings.Repeat("d", 32),
	}
	if err := validateConfig(valid); err != nil {
		t.Fatalf("valid production config rejected: %v", err)
	}
	invalid := valid
	invalid.cookieSecure = false
	if err := validateConfig(invalid); err == nil {
		t.Fatal("insecure production cookie was accepted")
	}
	invalid = valid
	invalid.allowedOrigins = map[string]bool{"http://nkn02.com": true}
	if err := validateConfig(invalid); err == nil {
		t.Fatal("insecure production origin was accepted")
	}
	invalid = valid
	invalid.webhookKey = "local-only-change-this-webhook-key"
	if err := validateConfig(invalid); err == nil {
		t.Fatal("default production secret was accepted")
	}
}

func TestRuntimeEnvironmentDetection(t *testing.T) {
	tests := []struct {
		name     string
		explicit string
		origin   string
		want     string
	}{
		{name: "localhost", origin: "http://localhost:8088", want: runtimeDevelopment},
		{name: "loopback", origin: "https://127.0.0.1:8088", want: runtimeDevelopment},
		{name: "LAN", origin: "https://192.168.1.20:8088", want: runtimeDevelopment},
		{name: "public HTTPS", origin: "https://nkn02.com", want: runtimeProduction},
		{name: "development override", explicit: runtimeDevelopment, origin: "https://nkn02.com", want: runtimeDevelopment},
		{name: "production override", explicit: runtimeProduction, origin: "http://localhost:8088", want: runtimeProduction},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, _ := resolveRuntimeEnvironment(test.explicit, test.origin)
			if got != test.want {
				t.Fatalf("environment=%q, want %q", got, test.want)
			}
		})
	}
}

func TestAutoProductionSecurityDefaults(t *testing.T) {
	t.Setenv("APP_ENV", "auto")
	t.Setenv("PUBLIC_APP_URL", "")
	t.Setenv("OAUTH_BASE_URL", "https://nkn02.com")
	t.Setenv("COOKIE_SECURE", "false")
	t.Setenv("CF_HOSTING_DOMAIN", "nkn02.com")
	t.Setenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://nkn02.com,https://nkn02.com")

	cfg := loadConfig()
	if cfg.environment != runtimeProduction || !cfg.cookieSecure {
		t.Fatalf("auto production was not secured: environment=%q secure=%v", cfg.environment, cfg.cookieSecure)
	}
	if cfg.allowedOrigins["http://localhost:3000"] || cfg.allowedOrigins["http://127.0.0.1:3000"] {
		t.Fatal("local development origin remained enabled in production")
	}
	if trustedRuntimeOrigin(cfg.environment, "http://nkn02.com", "nkn02.com") {
		t.Fatal("insecure public origin was trusted in production")
	}
}

func TestProductionSessionCookieIsSecure(t *testing.T) {
	s := &server{cfg: config{cookieName: "nexora_session", cookieSecure: true}}
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		s.clearSessionCookie(c)
		return c.SendStatus(fiber.StatusNoContent)
	})
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if cookie := response.Header.Get("Set-Cookie"); !strings.Contains(strings.ToLower(cookie), "; secure") || !strings.Contains(strings.ToLower(cookie), "; httponly") {
		t.Fatalf("production session cookie is not secure: %q", cookie)
	}
}

func TestRemoteImageURLSecurity(t *testing.T) {
	for _, value := range []string{"https://cdn.example.com/avatar.png", "https://images.example.com:8443/a.webp"} {
		if _, err := validatePublicHTTPSURL(value); err != nil {
			t.Fatalf("safe HTTPS URL rejected: %s", value)
		}
	}
	for _, value := range []string{"http://example.com/a.png", "file:///etc/passwd", "https://user:pass@example.com/a.png", "https://"} {
		if _, err := validatePublicHTTPSURL(value); err == nil {
			t.Fatalf("unsafe URL accepted: %s", value)
		}
	}
	for _, value := range []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1"} {
		if publicIPAllowed(net.ParseIP(value)) {
			t.Fatalf("private address accepted: %s", value)
		}
	}
	if !publicIPAllowed(net.ParseIP("1.1.1.1")) {
		t.Fatal("public address was rejected")
	}
}

func TestValidateCredentials(t *testing.T) {
	tests := []struct {
		name    string
		request authRequest
		valid   bool
	}{
		{"valid username", authRequest{Username: "nexorauser", Password: "StrongPass123"}, true},
		{"valid alphanumeric", authRequest{Username: "Nexora2026", Password: "StrongPass123"}, true},
		{"email rejected", authRequest{Username: "user@example.com", Password: "StrongPass123"}, false},
		{"thai rejected", authRequest{Username: "ชื่อผู้ใช้", Password: "StrongPass123"}, false},
		{"symbols rejected", authRequest{Username: "user_name", Password: "StrongPass123"}, false},
		{"short password", authRequest{Username: "nexora", Password: "123"}, false},
		{"four symbols rejected", authRequest{Username: "nexora", Password: "!!!!"}, false},
		{"eight symbols", authRequest{Username: "nexora", Password: "!!!!!!!!"}, true},
		{"letters only", authRequest{Username: "nexora", Password: "PasswordOnly"}, true},
		{"thai password rejected", authRequest{Username: "nexora", Password: "รหัสผ่าน123"}, false},
		{"short username", authRequest{Username: "abc", Password: "StrongPass123"}, false},
		{"space in username", authRequest{Username: "bad user", Password: "StrongPass123"}, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, message := validateCredentials(test.request)
			if (message == "") != test.valid {
				t.Fatalf("valid=%v, message=%q", test.valid, message)
			}
		})
	}
}

func TestOriginGuard(t *testing.T) {
	s := &server{cfg: config{
		cookieName:     "nexora_session",
		allowedOrigins: map[string]bool{"https://nkn02.com": true},
	}}
	app := fiber.New()
	app.Use(s.originGuard)
	app.Post("/", func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })

	tests := []struct {
		name    string
		origin  string
		referer string
		cookie  string
		fetch   string
		status  int
	}{
		{name: "allowed origin", origin: "https://nkn02.com", cookie: "token", status: fiber.StatusNoContent},
		{name: "allowed referer", referer: "https://nkn02.com/profile", cookie: "token", status: fiber.StatusNoContent},
		{name: "missing origin with session", cookie: "token", status: fiber.StatusForbidden},
		{name: "untrusted origin", origin: "https://evil.example", cookie: "token", status: fiber.StatusForbidden},
		{name: "cross site fetch", origin: "https://nkn02.com", fetch: "cross-site", status: fiber.StatusForbidden},
		{name: "server request without session", status: fiber.StatusNoContent},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", nil)
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			if test.referer != "" {
				req.Header.Set("Referer", test.referer)
			}
			if test.cookie != "" {
				req.AddCookie(&http.Cookie{Name: "nexora_session", Value: test.cookie})
			}
			if test.fetch != "" {
				req.Header.Set("Sec-Fetch-Site", test.fetch)
			}
			response, err := app.Test(req)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != test.status {
				t.Fatalf("status=%d, want %d", response.StatusCode, test.status)
			}
		})
	}
}

func TestSecurityHelpers(t *testing.T) {
	if tokenHash("secret-token") == "secret-token" {
		t.Fatal("token hash must not expose the token")
	}
	if tokenHash("secret-token") != tokenHash("secret-token") {
		t.Fatal("token hash must be deterministic")
	}
	if !validHexColor("#ff1018") || validHexColor("red") || validHexColor("#zz1018") {
		t.Fatal("hex color validation is incorrect")
	}
	if permissionsForRole("superadmin")[0] != "*" {
		t.Fatal("superadmin must have wildcard permission")
	}
	if permissionsForRole("unknown")[0] == "*" {
		t.Fatal("unknown roles must fall back to user permissions")
	}
}

func TestOAuthLaunchTicketHelpers(t *testing.T) {
	if normalizeOAuthMode("CONNECT") != "connect" || normalizeOAuthMode("register") != "register" || normalizeOAuthMode("unknown") != "login" {
		t.Fatal("OAuth mode normalization is incorrect")
	}
	for _, provider := range []string{"discord", "google", "github"} {
		if !validOAuthProvider(provider) {
			t.Fatalf("valid OAuth provider rejected: %s", provider)
		}
	}
	if validOAuthProvider("example") {
		t.Fatal("unknown OAuth provider was accepted")
	}
	ticket := "private-one-time-ticket"
	key := oauthLaunchKey(ticket)
	if key == ticket || key == "oauth:launch:"+ticket || key != oauthLaunchKey(ticket) {
		t.Fatal("OAuth launch ticket must be stored as a deterministic hash")
	}
	if location := oauthErrorLocation("account_link_required", "discord"); location != "/?auth_error=account_link_required&provider=discord" {
		t.Fatalf("unexpected OAuth error location: %s", location)
	}
	if location := oauthErrorLocation("oauth_state", "unknown"); location != "/?auth_error=oauth_state" {
		t.Fatalf("invalid provider must not be included: %s", location)
	}
}

func TestWebhookSecurityHelpers(t *testing.T) {
	valid := "https://discord.com/api/webhooks/123456/token-value"
	if !validDiscordWebhookURL(valid) {
		t.Fatal("valid Discord webhook URL was rejected")
	}
	for _, value := range []string{
		"http://discord.com/api/webhooks/1/token",
		"https://example.com/api/webhooks/1/token",
		"https://discord.com/channels/1",
	} {
		if validDiscordWebhookURL(value) {
			t.Fatalf("unsafe webhook URL was accepted: %s", value)
		}
	}
	ciphertext, err := encryptSecret(valid, "test-key")
	if err != nil || ciphertext == valid {
		t.Fatal("webhook URL was not encrypted")
	}
	plain, err := decryptSecret(ciphertext, "test-key")
	if err != nil || plain != valid {
		t.Fatal("webhook URL encryption round trip failed")
	}
	events := sanitizeWebhookEvents([]string{"auth.login", "invalid", "auth.login", "password.changed"})
	if len(events) != 2 || events[0] != "auth.login" || events[1] != "password.changed" {
		t.Fatalf("unexpected sanitized events: %#v", events)
	}
}

func TestHostingInputValidation(t *testing.T) {
	for _, value := range []string{"my-site", "site123", "abc"} {
		if normalized, ok := normalizeSubdomain(value); !ok || normalized != value {
			t.Fatalf("valid subdomain rejected: %s", value)
		}
	}
	for _, value := range []string{"ab", "-site", "site-", "www", "ชื่อเว็บ", "site.example"} {
		if _, ok := normalizeSubdomain(value); ok {
			t.Fatalf("unsafe subdomain accepted: %s", value)
		}
	}
	if domain, ok := normalizeCustomDomain("Portal.Example.COM."); !ok || domain != "portal.example.com" {
		t.Fatalf("domain normalization failed: %q %v", domain, ok)
	}
	for _, value := range []string{"http://example.com", "localhost", "bad_domain.com", "example.com/path"} {
		if _, ok := normalizeCustomDomain(value); ok {
			t.Fatalf("unsafe custom domain accepted: %s", value)
		}
	}
}

func TestHostingOperationSecurity(t *testing.T) {
	validKeys := []string{"550e8400-e29b-41d4-a716-446655440000", "client_request_123456"}
	for _, value := range validKeys {
		if !idempotencyPattern.MatchString(value) {
			t.Fatalf("valid idempotency key rejected: %s", value)
		}
	}
	for _, value := range []string{"short", "contains spaces 12345", "../../unsafe-key-12345"} {
		if idempotencyPattern.MatchString(value) {
			t.Fatalf("unsafe idempotency key accepted: %s", value)
		}
	}
	first := requestDigest("site.create", []byte(`{"name":"one"}`))
	second := requestDigest("site.create", []byte(`{"name":"two"}`))
	if first == second || len(first) != 64 {
		t.Fatal("operation request hash is not safe")
	}
	if !validProjectType("auto") || !validProjectType("node") || validProjectType("docker") {
		t.Fatal("project type allowlist is incorrect")
	}
	if !validPackageManager("pnpm") || validPackageManager("bun") {
		t.Fatal("package manager allowlist is incorrect")
	}
}

func TestHostingFilePathSecurity(t *testing.T) {
	for _, value := range []string{"index.html", "src/app.ts", "public/images/logo.png"} {
		if normalized, ok := canonicalWorkspacePath(value, false); !ok || normalized != value {
			t.Fatalf("safe workspace path rejected: %s", value)
		}
	}
	for _, value := range []string{"../secret", "/etc/passwd", `..\escape`, "folder/../../escape"} {
		if _, ok := canonicalWorkspacePath(value, false); ok {
			t.Fatalf("unsafe workspace path accepted: %s", value)
		}
	}
	for _, value := range []string{".env", ".env.production", ".git/config", "Dockerfile", "compose.yml"} {
		if !blockedWorkspacePath(value) {
			t.Fatalf("sensitive workspace path was not blocked: %s", value)
		}
	}
}

func TestHostingSourceArchiveSafety(t *testing.T) {
	files := map[string]sourceFile{
		"index.html":    {Data: []byte("<h1>NEXORA</h1>")},
		"assets":        {IsDir: true},
		"assets/app.js": {Data: []byte("console.log('ok')")},
	}
	archive, err := buildHostingSourceZip(files)
	if err != nil || len(archive) == 0 {
		t.Fatalf("safe source archive failed: %v", err)
	}
	files[".env"] = sourceFile{Data: []byte("SECRET=value")}
	if _, err := buildHostingSourceZip(files); err == nil {
		t.Fatal("secret file was included in source archive")
	}
}

func TestSimpleDiff(t *testing.T) {
	diff := simpleDiff("one\ntwo\nthree", "one\nchanged\nthree")
	if diff["changed"] != true {
		t.Fatal("changed content was not detected")
	}
	hunks := diff["hunks"].([]fiber.Map)
	if len(hunks) != 1 || len(hunks[0]["removed"].([]string)) != 1 || len(hunks[0]["added"].([]string)) != 1 {
		t.Fatalf("unexpected diff: %#v", diff)
	}
}

func TestSocialConnectPolicy(t *testing.T) {
	now := time.Date(2026, time.August, 1, 12, 0, 0, 0, time.UTC)

	policy := evaluateSocialConnectPolicy(now, nil, nil, 0)
	if !policy.CanConnect || policy.RemainingToday != 3 || policy.Code != "" {
		t.Fatalf("unexpected initial policy: %#v", policy)
	}

	last := now.Add(-10 * time.Minute)
	policy = evaluateSocialConnectPolicy(now, &last, &last, 1)
	if policy.CanConnect || policy.Code != "social_cooldown" || policy.AvailableAt == nil || !policy.AvailableAt.Equal(last.Add(30*time.Minute)) {
		t.Fatalf("cooldown was not enforced: %#v", policy)
	}

	first := now.Add(-2 * time.Hour)
	last = now.Add(-45 * time.Minute)
	policy = evaluateSocialConnectPolicy(now, &last, &first, 3)
	if policy.CanConnect || policy.Code != "social_daily_limit" || policy.RemainingToday != 0 || policy.AvailableAt == nil || !policy.AvailableAt.Equal(first.Add(24*time.Hour)) {
		t.Fatalf("daily limit was not enforced: %#v", policy)
	}
}
