package mailsanitize

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestSanitizeStripsDangerousContent(t *testing.T) {
	cases := []struct {
		name  string
		input string
		ban   []string
	}{
		{
			name:  "script element",
			input: `<p>hi</p><script>alert(1)</script>`,
			ban:   []string{"<script", "alert(1)"},
		},
		{
			name:  "event handler quoted",
			input: `<p onclick="alert(1)">ok</p>`,
			ban:   []string{"onclick", "alert(1)"},
		},
		{
			name:  "event handler unquoted without space before attribute",
			input: `<img src="x"onerror=alert(1)>`,
			ban:   []string{"onerror", "alert(1)"},
		},
		{
			name:  "javascript href quoted",
			input: `<a href="javascript:alert(3)">x</a>`,
			ban:   []string{"javascript:"},
		},
		{
			name:  "javascript href unquoted",
			input: `<a href=javascript:alert(3)>x</a>`,
			ban:   []string{"javascript:"},
		},
		{
			name:  "entity obfuscated scheme",
			input: `<a href="java&#09;script:alert(3)">x</a>`,
			ban:   []string{"script:"},
		},
		{
			name:  "data text/html url",
			input: `<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>`,
			ban:   []string{"data:text/html"},
		},
		{
			name:  "iframe and object",
			input: `<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x">`,
			ban:   []string{"iframe", "object", "embed", "evil.example"},
		},
		{
			name:  "form elements",
			input: `<form action="https://evil.example"><input type="text"><button>go</button></form>`,
			ban:   []string{"<form", "<input", "<button"},
		},
		{
			name:  "style attribute with expression",
			input: `<p style="background:url(javascript:alert(1))">x</p>`,
			ban:   []string{"javascript:", "style="},
		},
		{
			name:  "srcdoc smuggling",
			input: `<iframe srcdoc="<script>alert(1)</script>"></iframe>`,
			ban:   []string{"script"},
		},
		{
			name:  "case mangled tags",
			input: `<ScRiPt>alert(1)</sCrIpT><IMG SRC=javascript:alert(2)>`,
			ban:   []string{"script", "javascript:"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Sanitize(tc.input)
			lower := strings.ToLower(got)
			for _, forbidden := range tc.ban {
				if strings.Contains(lower, strings.ToLower(forbidden)) {
					t.Fatalf("sanitizer retained %q in %q", forbidden, got)
				}
			}
		})
	}
}

func TestProxyRemoteImages(t *testing.T) {
	got := ProxyRemoteImages(Sanitize(`<p>a</p><img src="https://tracker.example/pixel?a=1&amp;b=2" alt="x"><img src="//cdn.example/p.png"><img src="cid:part1@example">`))
	if strings.Contains(got, "tracker.example") || strings.Contains(got, "cdn.example") {
		t.Fatalf("browser would still connect to the remote host: %q", got)
	}
	if want := ImageProxyPath + base64.RawURLEncoding.EncodeToString([]byte("https://tracker.example/pixel?a=1&b=2")); !strings.Contains(got, want) {
		t.Fatalf("missing %q in %q", want, got)
	}
	if want := ImageProxyPath + base64.RawURLEncoding.EncodeToString([]byte("https://cdn.example/p.png")); !strings.Contains(got, want) {
		t.Fatalf("protocol-relative image not proxied over https: %q", got)
	}
	if !strings.Contains(got, `alt="x"`) || !strings.Contains(got, "cid:part1@example") {
		t.Fatalf("other image data was lost: %q", got)
	}
}

func TestSanitizeRestoresProxiedImagesForSending(t *testing.T) {
	viewed := ProxyRemoteImages(Sanitize(`<img src="https://cdn.example/p.png?a=1&amp;b=2">`))
	got := Sanitize(`<p>reply</p><blockquote>` + viewed + `</blockquote>`)
	if strings.Contains(got, ImageProxyPath) || !strings.Contains(got, `src="https://cdn.example/p.png?a=1&amp;b=2"`) {
		t.Fatalf("reply should carry the real image URL: %q", got)
	}
}

func TestSanitizeRestoredImageCannotInjectMarkup(t *testing.T) {
	encoded := base64.RawURLEncoding.EncodeToString([]byte(`https://x.example/"><script>alert(1)</script>`))
	got := Sanitize(`<img src="` + ImageProxyPath + encoded + `">`)
	if strings.Contains(strings.ToLower(got), "<script") {
		t.Fatalf("decoded URL broke out of its attribute: %q", got)
	}
}

func TestSanitizeKeepsBenignFormatting(t *testing.T) {
	input := `<table border="0" cellpadding="4"><tr><td colspan="2"><b>bold</b> <a href="https://example.com/page">link</a></td></tr></table><p>ok</p>`
	got := Sanitize(input)
	for _, want := range []string{"<table", "<td", "colspan", "<b>", "bold", `href="https://example.com/page"`, "link", "<p>", "ok"} {
		if !strings.Contains(got, want) {
			t.Fatalf("benign content %q missing from %q", want, got)
		}
	}
}

func TestSanitizeTruncatesOversizedInput(t *testing.T) {
	input := strings.Repeat("<p>aaaa</p>", 300000)
	got := Sanitize(input)
	if len(got) > MaxHTMLBytes {
		t.Fatalf("output too large: %d", len(got))
	}
}

func TestSanitizeEmptyInput(t *testing.T) {
	if got := Sanitize("   "); got != "" {
		t.Fatalf("expected empty output, got %q", got)
	}
}
