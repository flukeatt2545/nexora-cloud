package mailsanitize

import (
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

func TestSanitizeRemoteImagePlaceholder(t *testing.T) {
	got := Sanitize(`<p>a</p><img src="https://tracker.example/pixel"><img src="cid:part1@example">`)
	if !strings.Contains(got, "รูปภาพภายนอกถูกบล็อก") {
		t.Fatalf("remote image was not replaced: %q", got)
	}
	if strings.Contains(got, "tracker.example") {
		t.Fatalf("remote image URL survived: %q", got)
	}
	if !strings.Contains(got, "cid:part1@example") {
		t.Fatalf("inline cid image was stripped: %q", got)
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
