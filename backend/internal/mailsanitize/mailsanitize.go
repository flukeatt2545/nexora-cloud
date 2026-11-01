// Package mailsanitize sanitizes untrusted email HTML for safe rendering in
// the webmail viewer. It is shared by the main API and the mail-worker.
package mailsanitize

import (
	"encoding/base64"
	"html"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/microcosm-cc/bluemonday"
)

const MaxHTMLBytes = 1024 * 1024

// ImageProxyPath is the API route that fetches a remote mail image on the reader's behalf.
const ImageProxyPath = "/api/mail/image?u="

var (
	// remoteImagePattern matches the src of normalized (bluemonday-quoted) img tags
	// pointing at remote http(s) resources.
	remoteImagePattern = regexp.MustCompile(`(?is)(<img\b[^>]*\bsrc\s*=\s*")((?:https?:)?//[^"]*)(")`)
	// proxiedImagePattern matches a src made by ProxyRemoteImages, which comes back
	// in the HTML of a reply, a forward or a draft.
	proxiedImagePattern = regexp.MustCompile(`\bsrc="` + regexp.QuoteMeta(ImageProxyPath) + `([A-Za-z0-9_-]+)"`)
)

var policy = buildPolicy()

func buildPolicy() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()

	// HTML email relies on table-based layout; UGCPolicy alone is too thin.
	p.AllowElements("table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "center", "font", "span", "address", "abbr", "bdi", "bdo", "big", "small", "tt", "u", "hr")
	p.AllowAttrs("width", "height", "align", "valign", "border", "cellpadding", "cellspacing", "bgcolor", "colspan", "rowspan").OnElements("table", "thead", "tbody", "tfoot", "tr", "td", "th")
	p.AllowAttrs("color", "face", "size").OnElements("font")
	p.AllowAttrs("align").OnElements("p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "center")

	// img src: standard http(s)/relative URLs, strict data:image/* URIs and
	// cid: (inline attachments). Remote http(s) images survive this pass; what
	// goes to a browser must also pass through ProxyRemoteImages.
	p.AllowImages()
	p.AllowDataURIImages()
	p.AllowURLSchemes("cid")

	return p
}

// Sanitize returns a version of the email HTML free of active content, for storing
// and sending. Remote images keep their real URLs, so the webmail viewer must also
// call ProxyRemoteImages before showing it.
func Sanitize(value string) string {
	value = strings.TrimSpace(value)
	value = truncateUTF8(value, MaxHTMLBytes)
	if value == "" {
		return ""
	}
	return truncateUTF8(policy.Sanitize(restoreRemoteImages(value)), MaxHTMLBytes)
}

// ProxyRemoteImages points the remote images of sanitized HTML at the image proxy,
// so that opening a mail never connects the reader's browser to the sender's servers.
func ProxyRemoteImages(safe string) string {
	return remoteImagePattern.ReplaceAllStringFunc(safe, func(tag string) string {
		parts := remoteImagePattern.FindStringSubmatch(tag)
		target := html.UnescapeString(parts[2])
		if strings.HasPrefix(target, "//") {
			target = "https:" + target
		}
		return parts[1] + ImageProxyPath + base64.RawURLEncoding.EncodeToString([]byte(target)) + parts[3]
	})
}

// restoreRemoteImages undoes ProxyRemoteImages: quoted in a reply, a proxy path would
// point at nothing on the recipient's side.
func restoreRemoteImages(value string) string {
	return proxiedImagePattern.ReplaceAllStringFunc(value, func(attribute string) string {
		target, err := base64.RawURLEncoding.DecodeString(proxiedImagePattern.FindStringSubmatch(attribute)[1])
		if err != nil {
			return attribute
		}
		return `src="` + html.EscapeString(string(target)) + `"`
	})
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
