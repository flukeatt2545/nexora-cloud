// Package mailsanitize sanitizes untrusted email HTML for safe rendering in
// the webmail viewer. It is shared by the main API and the mail-worker.
package mailsanitize

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/microcosm-cc/bluemonday"
)

const MaxHTMLBytes = 1024 * 1024

const remoteImagePlaceholder = `<span data-remote-image-blocked="true">[รูปภาพภายนอกถูกบล็อก]</span>`

// remoteImagePattern matches normalized (bluemonday-quoted) img tags pointing
// at remote http(s) resources so they can be replaced with a placeholder.
var remoteImagePattern = regexp.MustCompile(`(?is)<img\b[^>]*\bsrc\s*=\s*"(?:https?:)?//[^"]*"[^>]*>`)

var policy = buildPolicy()

func buildPolicy() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()

	// HTML email relies on table-based layout; UGCPolicy alone is too thin.
	p.AllowElements("table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "center", "font", "span", "address", "abbr", "bdi", "bdo", "big", "small", "tt", "u", "hr")
	p.AllowAttrs("width", "height", "align", "valign", "border", "cellpadding", "cellspacing", "bgcolor", "colspan", "rowspan").OnElements("table", "thead", "tbody", "tfoot", "tr", "td", "th")
	p.AllowAttrs("color", "face", "size").OnElements("font")
	p.AllowAttrs("align").OnElements("p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "center")

	// img src: standard http(s)/relative URLs, strict data:image/* URIs and
	// cid: (inline attachments). Remote http(s) images survive this pass but
	// are replaced with a placeholder below.
	p.AllowImages()
	p.AllowDataURIImages()
	p.AllowURLSchemes("cid")

	return p
}

// Sanitize returns a version of the email HTML that is safe to inject into the
// webmail viewer's DOM.
func Sanitize(value string) string {
	value = strings.TrimSpace(value)
	value = truncateUTF8(value, MaxHTMLBytes)
	if value == "" {
		return ""
	}
	safe := policy.Sanitize(value)
	safe = remoteImagePattern.ReplaceAllString(safe, remoteImagePlaceholder)
	return truncateUTF8(safe, MaxHTMLBytes)
}

func truncateUTF8(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	value = value[:limit]
	for !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}
