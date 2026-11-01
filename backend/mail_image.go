package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	mailImageMaxBytes int64 = 10 * 1024 * 1024
	mailImageMaxURL         = 4096
)

// Raster types only: an SVG can carry scripts.
var mailImageTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true, "image/bmp": true, "image/x-icon": true,
}

// mailImageClient refuses private addresses at dial time, which also covers redirects
// and DNS names that resolve inward. Unlike the avatar import it allows http, which plenty of
// newsletters still use: the browser only ever talks to our API.
var mailImageClient = newMailImageClient()

func newMailImageClient() *http.Client {
	client := publicHTTPSClient()
	client.Timeout = 15 * time.Second
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return fmt.Errorf("too many mail image redirects")
		}
		return checkMailImageURL(req.URL)
	}
	return client
}

func checkMailImageURL(target *url.URL) error {
	if (target.Scheme != "https" && target.Scheme != "http") || target.Hostname() == "" || target.User != nil {
		return fmt.Errorf("unsafe mail image URL")
	}
	if port := target.Port(); port != "" && port != "80" && port != "443" {
		return fmt.Errorf("unsafe mail image port")
	}
	return nil
}

// mailImageTarget decodes the u parameter made by mailsanitize.ProxyRemoteImages.
func mailImageTarget(encoded string) (*url.URL, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || len(decoded) == 0 || len(decoded) > mailImageMaxURL {
		return nil, fmt.Errorf("invalid mail image URL")
	}
	target, err := url.Parse(string(decoded))
	if err != nil {
		return nil, err
	}
	return target, checkMailImageURL(target)
}

// mailImageType goes by the bytes, not the remote server's Content-Type header.
func mailImageType(data []byte) string {
	if detected := http.DetectContentType(data); mailImageTypes[detected] {
		return detected
	}
	return ""
}

// proxyMailImage fetches an image a mail refers to, so that the sender's server sees us and
// not the reader's IP address, browser or cookies.
func (s *server) proxyMailImage(c *fiber.Ctx) error {
	target, err := mailImageTarget(c.Query("u"))
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	req, err := http.NewRequestWithContext(c.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; NexoraMailImageProxy/1.0)")
	req.Header.Set("Accept", "image/*")
	resp, err := mailImageClient.Do(req)
	if err != nil {
		return c.SendStatus(fiber.StatusNotFound)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return c.SendStatus(fiber.StatusNotFound)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, mailImageMaxBytes+1))
	if err != nil || int64(len(data)) > mailImageMaxBytes {
		return c.SendStatus(fiber.StatusNotFound)
	}
	contentType := mailImageType(data)
	if contentType == "" {
		return c.SendStatus(fiber.StatusNotFound)
	}
	c.Set(fiber.HeaderCacheControl, "private, max-age=86400")
	c.Response().Header.Del("Pragma")
	c.Response().Header.Del("Expires")
	c.Set(fiber.HeaderContentType, contentType)
	c.Set(fiber.HeaderXContentTypeOptions, "nosniff")
	c.Set(fiber.HeaderContentSecurityPolicy, "default-src 'none'; sandbox")
	c.Set("Cross-Origin-Resource-Policy", "cross-origin")
	return c.Send(data)
}
