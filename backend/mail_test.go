package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"nexora-cloud-api/internal/mailsanitize"
)

func TestNormalizeMailDomainAndRecipient(t *testing.T) {
	if got := normalizeMailDomain(" Mail.Example.COM. "); got != "mail.example.com" {
		t.Fatalf("unexpected domain: %q", got)
	}
	for _, invalid := range []string{"localhost", "-bad.example", "bad_.example.com"} {
		if normalizeMailDomain(invalid) != "" {
			t.Fatalf("accepted invalid domain %q", invalid)
		}
	}
	if got := normalizeRecipient("Nexora <HELLO@Example.com>"); got != "hello@example.com" {
		t.Fatalf("unexpected recipient: %q", got)
	}
}

func TestSanitizeMailHTML(t *testing.T) {
	unsafe := `<p onclick="alert(1)">ok</p><script>alert(2)</script><img src="https://tracker.test/pixel"><a href="javascript:alert(3)">x</a>`
	got := safeMailBodyHTML(unsafe, "")
	for _, forbidden := range []string{"onclick", "<script", "tracker.test", "javascript:"} {
		if strings.Contains(strings.ToLower(got), forbidden) {
			t.Fatalf("sanitizer retained %q in %q", forbidden, got)
		}
	}
	if !strings.Contains(got, mailsanitize.ImageProxyPath) {
		t.Fatalf("remote image was not proxied: %q", got)
	}
}

func TestMailImageTarget(t *testing.T) {
	encode := func(value string) string { return base64.RawURLEncoding.EncodeToString([]byte(value)) }
	for _, good := range []string{"https://cdn.example/p.png?a=1", "http://cdn.example/p.png", "https://cdn.example:443/p.png"} {
		if _, err := mailImageTarget(encode(good)); err != nil {
			t.Fatalf("%s rejected: %v", good, err)
		}
	}
	for _, bad := range []string{"file:///etc/passwd", "ftp://cdn.example/p.png", "https://user:pw@cdn.example/p.png", "http://cdn.example:6379/", "https://", "not a url"} {
		if _, err := mailImageTarget(encode(bad)); err == nil {
			t.Fatalf("%s accepted", bad)
		}
	}
	if _, err := mailImageTarget("!!!"); err == nil {
		t.Fatal("invalid encoding accepted")
	}
}

func TestMailImageClientRefusesPrivateAddresses(t *testing.T) {
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("request reached a loopback server")
	}))
	defer remote.Close()
	if resp, err := mailImageClient.Get(remote.URL); err == nil {
		resp.Body.Close()
		t.Fatal("loopback address was fetched")
	}
}

func TestMailImageType(t *testing.T) {
	png := "\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR"
	if got := mailImageType([]byte(png)); got != "image/png" {
		t.Fatalf("png detected as %q", got)
	}
	for _, bad := range []string{`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`, "<html><script>alert(1)</script></html>", ""} {
		if got := mailImageType([]byte(bad)); got != "" {
			t.Fatalf("%q served as %q", bad, got)
		}
	}
}

func TestSafeMailBodyHTMLEscapesPlainText(t *testing.T) {
	got := safeMailBodyHTML("", "<img src=x onerror=alert(1)>\nข้อความ")
	if strings.Contains(strings.ToLower(got), "<img") {
		t.Fatalf("plain text fallback created executable markup: %q", got)
	}
	if !strings.Contains(got, "&lt;img") || !strings.Contains(got, "<br>") {
		t.Fatalf("plain text fallback was not escaped correctly: %q", got)
	}
}

func TestVerifyResendWebhook(t *testing.T) {
	key := []byte("test-webhook-secret")
	secret := "whsec_" + base64.StdEncoding.EncodeToString(key)
	body := []byte(`{"type":"email.received"}`)
	id := "msg_test"
	timestamp := time.Now().Unix()
	ts := time.Unix(timestamp, 0).Unix()
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + formatInt64(ts) + "."))
	mac.Write(body)
	signature := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if !verifyResendWebhook(secret, body, id, formatInt64(ts), signature) {
		t.Fatal("valid signature rejected")
	}
	if verifyResendWebhook(secret, append(body, '!'), id, formatInt64(ts), signature) {
		t.Fatal("tampered body accepted")
	}
}

func TestResendSettingValidation(t *testing.T) {
	if !validResendAPIKey("re_123456789abcdef") || validResendAPIKey("secret") {
		t.Fatal("unexpected API key validation result")
	}
	secret := "whsec_" + base64.StdEncoding.EncodeToString([]byte("0123456789abcdef"))
	if !validResendWebhookSecret(secret) || validResendWebhookSecret("whsec_invalid") {
		t.Fatal("unexpected webhook secret validation result")
	}
}

func formatInt64(value int64) string {
	return strconv.FormatInt(value, 10)
}
