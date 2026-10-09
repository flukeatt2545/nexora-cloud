package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/gofiber/fiber/v2"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type objectStorage interface {
	PutObject(context.Context, string, string, io.Reader, int64, minio.PutObjectOptions) (minio.UploadInfo, error)
	GetObject(context.Context, string, string, minio.GetObjectOptions) (*minio.Object, error)
	RemoveObject(context.Context, string, string, minio.RemoveObjectOptions) error
	StatObject(context.Context, string, string, minio.StatObjectOptions) (minio.ObjectInfo, error)
}

func (s *server) initStorage(ctx context.Context) error {
	client, err := minio.New(s.cfg.s3Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(s.cfg.s3AccessKey, s.cfg.s3SecretKey, ""),
		Secure: s.cfg.s3UseSSL,
	})
	if err != nil {
		return err
	}
	exists, err := client.BucketExists(ctx, s.cfg.s3Bucket)
	if err != nil {
		return err
	}
	if !exists {
		if err := client.MakeBucket(ctx, s.cfg.s3Bucket, minio.MakeBucketOptions{}); err != nil {
			return err
		}
	}
	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/avatars/*","arn:aws:s3:::%s/brand/*","arn:aws:s3:::%s/uploads/*"]}]}`, s.cfg.s3Bucket, s.cfg.s3Bucket, s.cfg.s3Bucket)
	if err := client.SetBucketPolicy(ctx, s.cfg.s3Bucket, policy); err != nil {
		return err
	}
	s.storage = client
	return nil
}

func (s *server) upload(c *fiber.Ctx, prefix string, maxBytes int64) (string, error) {
	if s.storage == nil {
		return "", fiber.NewError(fiber.StatusServiceUnavailable, "object storage unavailable")
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, "กรุณาเลือกไฟล์")
	}
	if fileHeader.Size <= 0 || fileHeader.Size > maxBytes {
		return "", fiber.NewError(fiber.StatusBadRequest, "ขนาดไฟล์ไม่ถูกต้อง")
	}
	file, err := fileHeader.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || int64(len(data)) > maxBytes {
		return "", fiber.NewError(fiber.StatusBadRequest, "ไฟล์มีขนาดใหญ่เกินไป")
	}
	contentType := http.DetectContentType(data)
	extensions := map[string]string{
		"image/png":    ".png",
		"image/jpeg":   ".jpg",
		"image/webp":   ".webp",
		"image/x-icon": ".ico",
	}
	extension, ok := extensions[contentType]
	if !ok {
		extension = strings.ToLower(filepath.Ext(fileHeader.Filename))
		if contentType != "image/vnd.microsoft.icon" || extension != ".ico" {
			return "", fiber.NewError(fiber.StatusBadRequest, "รองรับเฉพาะ PNG, JPG, WEBP และ ICO")
		}
	}
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	key := strings.Trim(prefix, "/") + "/" + hex.EncodeToString(random) + extension
	if _, err := s.storage.PutObject(c.Context(), s.cfg.s3Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: contentType}); err != nil {
		return "", err
	}
	return s.publicAssetURL(c, key), nil
}

func (s *server) publicAssetURL(c *fiber.Ctx, key string) string {
	base := strings.TrimRight(s.cfg.s3PublicURL, "/")
	if c != nil {
		reqHost := strings.Split(strings.TrimSpace(c.Get("X-Forwarded-Host", c.Hostname())), ":")[0]
		if reqHost != "" && !strings.Contains(reqHost, "localhost") && !strings.Contains(reqHost, "127.0.0.1") {
			base = "https://" + reqHost + "/assets"
		}
	} else if base != "" && !strings.Contains(base, "localhost") && !strings.Contains(base, "127.0.0.1") {
		if strings.HasPrefix(base, "http://") {
			base = "https://" + strings.TrimPrefix(base, "http://")
		}
	}
	return base + "/" + strings.TrimLeft(key, "/")
}

func (s *server) uploadProfileAvatar(c *fiber.Ctx) error {
	user := current(c)
	url, err := s.upload(c, "avatars", 2*1024*1024)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2`, url, user.ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	user.AvatarURL = url
	s.audit(c, auditEvent{Actor: user, Category: "profile", Action: "profile.avatar_updated", Target: "user", TargetID: strconv.FormatInt(user.ID, 10)})
	return c.JSON(fiber.Map{"url": url})
}

// fetchAndStoreAvatar downloads a remote image (up to maxBytes) and stores it
// into object storage. Returns the public URL on success or empty string on
// non-fatal failure (caller may fallback to original URL).
func (s *server) fetchAndStoreAvatar(ctx context.Context, imageURL string, maxBytes int64) (string, error) {
	if s.storage == nil || strings.TrimSpace(imageURL) == "" {
		return "", nil
	}
	safeURL, err := validatePublicHTTPSURL(imageURL)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, safeURL.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "NEXORA-CLOUD")
	resp, err := publicHTTPSClient().Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("image download returned status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return "", err
	}
	if int64(len(data)) > maxBytes {
		return "", fmt.Errorf("image too large")
	}
	contentType := http.DetectContentType(data)
	extensions := map[string]string{
		"image/png":    ".png",
		"image/jpeg":   ".jpg",
		"image/webp":   ".webp",
		"image/x-icon": ".ico",
	}
	ext, ok := extensions[contentType]
	if !ok {
		return "", fmt.Errorf("unsupported image type: %s", contentType)
	}
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	key := strings.Trim("avatars/", "/") + "/" + hex.EncodeToString(random) + ext
	if _, err := s.storage.PutObject(ctx, s.cfg.s3Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: contentType}); err != nil {
		return "", err
	}
	return s.cfg.s3PublicURL + "/" + key, nil
}

func validatePublicHTTPSURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return nil, fmt.Errorf("unsafe remote image URL")
	}
	return parsed, nil
}

func publicIPAllowed(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		// Carrier-grade NAT is not publicly routable and may expose internal services.
		return !(ipv4[0] == 100 && ipv4[1] >= 64 && ipv4[1] <= 127)
	}
	return true
}

func publicHTTPSClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(addresses) == 0 {
			return nil, fmt.Errorf("remote image host could not be resolved")
		}
		for _, candidate := range addresses {
			if !publicIPAllowed(candidate.IP) {
				return nil, fmt.Errorf("remote image host resolves to a private address")
			}
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].IP.String(), port))
	}
	return &http.Client{
		Timeout:   10 * time.Second,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many remote image redirects")
			}
			_, err := validatePublicHTTPSURL(req.URL.String())
			return err
		},
	}
}

func (s *server) uploadDeployment(c *fiber.Ctx, siteID int64) (string, error) {
	if s.storage == nil {
		return "", fiber.NewError(fiber.StatusServiceUnavailable, "object storage unavailable")
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, "กรุณาเลือกไฟล์ .zip")
	}
	maxBytes := hostingSourceCompressedLimit
	if fileHeader.Size <= 0 || fileHeader.Size > maxBytes {
		return "", fiber.NewError(fiber.StatusBadRequest, "ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 256MB)")
	}
	file, err := fileHeader.Open()
	if err != nil {
		return "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || int64(len(data)) > maxBytes {
		return "", fiber.NewError(fiber.StatusBadRequest, "ไฟล์มีขนาดใหญ่เกินไป")
	}
	contentType := http.DetectContentType(data)
	if contentType != "application/zip" {
		return "", fiber.NewError(fiber.StatusBadRequest, "รองรับเฉพาะไฟล์ .zip เท่านั้น")
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	key := fmt.Sprintf("deployments/%d/%s.zip", siteID, hex.EncodeToString(random))
	if _, err := s.storage.PutObject(c.Context(), s.cfg.s3Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{ContentType: contentType}); err != nil {
		return "", err
	}
	return key, nil
}

func (s *server) uploadBrandAsset(c *fiber.Ctx) error {
	return s.uploadAdminAsset(c, c.Params("kind"))
}

func (s *server) uploadAnnouncementAsset(c *fiber.Ctx) error {
	return s.uploadAdminAsset(c, "announcement")
}

func brandAssetStorage(kind string) (column, prefix string, ok bool) {
	switch kind {
	case "logo":
		return "logo_url", "brand/logo", true
	case "favicon":
		return "favicon_url", "brand/favicon", true
	case "auth-background":
		return "auth_background_url", "brand/auth-background", true
	case "og-image":
		return "og_image_url", "brand/og-image", true
	default:
		return "", "", false
	}
}

func (s *server) uploadAdminAsset(c *fiber.Ctx, kind string) error {
	limits := map[string]int64{"logo": 2 * 1024 * 1024, "favicon": 512 * 1024, "auth-background": 5 * 1024 * 1024, "og-image": 5 * 1024 * 1024, "announcement": 10 * 1024 * 1024}
	limit, ok := limits[kind]
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ประเภทไฟล์ไม่ถูกต้อง"})
	}
	url, err := s.upload(c, "brand/"+kind, limit)
	if err != nil {
		return err
	}
	if column, prefix, managed := brandAssetStorage(kind); managed {
		var previousURL string
		if err := s.db.QueryRow(c.Context(), fmt.Sprintf("SELECT %s FROM system_settings WHERE id=1", column)).Scan(&previousURL); err != nil {
			s.removeReplacedBrandAsset(c.Context(), url, prefix)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if _, err := s.db.Exec(c.Context(), fmt.Sprintf("UPDATE system_settings SET %s=$1, updated_by=$2, updated_at=NOW() WHERE id=1", column), url, current(c).ID); err != nil {
			s.removeReplacedBrandAsset(c.Context(), url, prefix)
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if previousURL != url {
			s.removeReplacedBrandAsset(c.Context(), previousURL, prefix)
		}
	}
	s.audit(c, auditEvent{Actor: current(c), Category: "settings", Action: "asset.uploaded", Target: "asset", TargetID: kind})
	return c.JSON(fiber.Map{"url": url})
}

func (s *server) deleteBrandAsset(c *fiber.Ctx) error {
	kind := c.Params("kind")
	column, prefix, ok := brandAssetStorage(kind)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ประเภทไฟล์ไม่ถูกต้อง"})
	}
	var previousURL string
	if err := s.db.QueryRow(c.Context(), fmt.Sprintf("SELECT %s FROM system_settings WHERE id=1", column)).Scan(&previousURL); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if _, err := s.db.Exec(c.Context(), fmt.Sprintf("UPDATE system_settings SET %s='', updated_by=$1, updated_at=NOW() WHERE id=1", column), current(c).ID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.removeReplacedBrandAsset(c.Context(), previousURL, prefix)
	s.audit(c, auditEvent{Actor: current(c), Category: "settings", Action: "asset.deleted", Target: "asset", TargetID: kind})
	return c.JSON(fiber.Map{"url": ""})
}

// removeReplacedBrandAsset deletes only files managed by the matching brand
// asset folder. External URLs and built-in public assets are never touched.
func (s *server) removeReplacedBrandAsset(ctx context.Context, assetURL, expectedPrefix string) {
	if s.storage == nil || strings.TrimSpace(assetURL) == "" {
		return
	}
	publicBase := strings.TrimRight(strings.TrimSpace(s.cfg.s3PublicURL), "/")
	assetURL = strings.TrimSpace(assetURL)
	if publicBase == "" || !strings.HasPrefix(assetURL, publicBase+"/") {
		return
	}
	objectKey := strings.TrimPrefix(assetURL, publicBase+"/")
	expectedPrefix = strings.Trim(strings.TrimSpace(expectedPrefix), "/") + "/"
	if !strings.HasPrefix(objectKey, expectedPrefix) || strings.Contains(objectKey, "..") {
		return
	}
	if err := s.storage.RemoveObject(ctx, s.cfg.s3Bucket, objectKey, minio.RemoveObjectOptions{}); err != nil {
		log.Printf("remove replaced brand asset %q: %v", objectKey, err)
	}
}

func (s *server) getOrCreateShortCode(ctx context.Context, objectKey string) string {
	var code string
	err := s.db.QueryRow(ctx, "SELECT short_code FROM file_aliases WHERE object_key = $1", objectKey).Scan(&code)
	if err == nil {
		return code
	}

	// Generate new short code
	for i := 0; i < 5; i++ {
		b := make([]byte, 6)
		rand.Read(b)
		code = base64.RawURLEncoding.EncodeToString(b)
		_, err := s.db.Exec(ctx, "INSERT INTO file_aliases (short_code, object_key) VALUES ($1, $2)", code, objectKey)
		if err == nil {
			return code
		}
	}

	// Fallback to hashing if DB generation fails repeatedly (should never happen)
	hash := sha256.Sum256([]byte(objectKey))
	return hex.EncodeToString(hash[:6])
}

func (s *server) getObjectKeyFromShortCode(ctx context.Context, shortCode string) (string, error) {
	var key string
	err := s.db.QueryRow(ctx, "SELECT object_key FROM file_aliases WHERE short_code = $1", shortCode).Scan(&key)
	return key, err
}

func (s *server) buildSecureFileURL(ctx context.Context, objectKey string) string {
	return "/f/" + s.getOrCreateShortCode(ctx, objectKey)
}

func (s *server) serveSecureFile(c *fiber.Ctx) error {
	token := c.Params("token")
	if token == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "Invalid request"})
	}

	objectKey, err := s.getObjectKeyFromShortCode(c.Context(), token)
	if err != nil || objectKey == "" || strings.Contains(objectKey, "..") {
		log.Printf("serveSecureFile: invalid short code or objectKey, token=%s, err=%v", token, err)
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์ที่ร้องขอหรือลิงก์ไม่ถูกต้อง"})
	}

	if s.storage == nil {
		log.Printf("serveSecureFile: storage is nil")
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบจัดเก็บไฟล์ไม่พร้อมใช้งาน"})
	}

	// Check if this file is linked to a product (entitlement check)
	var productID int
	isProductFile := false
	// file_key holds the library name without its prefix (library/, or uploads/ for old files).
	err = s.db.QueryRow(c.Context(), `SELECT id FROM products WHERE $1 IN (file_key, 'library/' || file_key, 'uploads/' || file_key) LIMIT 1`, objectKey).Scan(&productID)
	if err == nil {
		isProductFile = true
		// It's a product file. Require authentication and purchase (or admin role).
		user, _ := s.authenticate(c) // Doesn't fail the request immediately if not logged in, just returns nil user
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "กรุณาเข้าสู่ระบบเพื่อดาวน์โหลดไฟล์สินค้านี้"})
		}

		if user.Role != "admin" && user.Role != "superadmin" {
			var purchaseID int64
			err = s.db.QueryRow(c.Context(), `
				SELECT pu.id FROM purchases pu JOIN products p ON p.id = pu.product_id
				WHERE pu.user_id = $1 AND pu.refunded_at IS NULL AND $2 IN (p.file_key, 'library/' || p.file_key, 'uploads/' || p.file_key) LIMIT 1`, user.ID, objectKey).Scan(&purchaseID)
			if err != nil {
				return c.Status(fiber.StatusForbidden).JSON(apiError{Error: "คุณต้องซื้อสินค้านี้ก่อนจึงจะสามารถดาวน์โหลดได้"})
			}
		}
	}

	obj, err := s.storage.GetObject(c.Context(), s.cfg.s3Bucket, objectKey, minio.GetObjectOptions{})
	if err != nil {
		log.Printf("serveSecureFile: GetObject failed for key=%s, err=%v", objectKey, err)
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์ในระบบ"})
	}
	defer obj.Close()

	stat, err := obj.Stat()
	if err != nil {
		log.Printf("serveSecureFile: Stat failed for key=%s, err=%v", objectKey, err)
		return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ไม่พบไฟล์ในระบบ"})
	}

	log.Printf("serveSecureFile: serving file key=%s, size=%d, contentType=%s", objectKey, stat.Size, stat.ContentType)

	c.Set("Content-Type", stat.ContentType)
	filename := filepath.Base(objectKey)
	if isProductFile {
		c.Set("Cache-Control", "no-store, private, max-age=0")
		c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	} else {
		c.Set("Cache-Control", "public, max-age=86400")
		if strings.HasPrefix(stat.ContentType, "image/") && stat.ContentType != "image/svg+xml" {
			c.Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", filename))
		} else {
			c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
		}
	}
	c.Set("X-Content-Type-Options", "nosniff")
	// Credentialed file responses are exposed only to configured application origins.
	origin := c.Get("Origin")
	c.Set("Cross-Origin-Resource-Policy", "cross-origin")
	if s.cfg.allowedOrigins[origin] {
		c.Set("Access-Control-Allow-Origin", origin)
		c.Set("Access-Control-Allow-Credentials", "true")
		c.Set("Vary", "Origin")
	}

	// Read the entire object into memory to avoid streaming issues
	data, err := io.ReadAll(obj)
	if err != nil {
		log.Printf("serveSecureFile: ReadAll failed for key=%s, err=%v", objectKey, err)
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ไม่สามารถอ่านไฟล์ได้"})
	}

	log.Printf("serveSecureFile: successfully read %d bytes for key=%s", len(data), objectKey)
	return c.Send(data)
}

func (s *server) listAdminFiles(c *fiber.Ctx) error {
	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "object storage unavailable"})
	}

	ctx := c.Context()
	prefix := adminLibraryPrefixFor(c.Query("kind"))
	opts := minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}

	items := make([]map[string]interface{}, 0)
	for object := range s.storage.(*minio.Client).ListObjects(ctx, s.cfg.s3Bucket, opts) {
		if object.Err != nil {
			continue
		}

		fileName := strings.TrimPrefix(object.Key, prefix)
		if fileName == "" || strings.HasSuffix(fileName, "/") {
			continue
		}

		items = append(items, map[string]interface{}{
			"name":      fileName,
			"url":       s.buildSecureFileURL(ctx, object.Key),
			"size":      object.Size,
			"createdAt": object.LastModified,
		})
	}

	return c.JSON(fiber.Map{"items": items})
}

// allowedMIMETypes is the allowlist of MIME types permitted for admin file uploads.
// Executable, script, and archive types that could pose security risks are excluded.
var allowedMIMETypes = map[string]bool{
	// Images
	"image/png":                true,
	"image/jpeg":               true,
	"image/gif":                true,
	"image/webp":               true,
	"image/svg+xml":            true,
	"image/x-icon":             true,
	"image/vnd.microsoft.icon": true,
	"image/bmp":                true,
	"image/tiff":               true,
	"image/avif":               true,
	// Documents
	"application/pdf":  true,
	"text/plain":       true,
	"text/csv":         true,
	"text/markdown":    true,
	"application/json": true,
	// Video
	"video/mp4":  true,
	"video/webm": true,
	"video/ogg":  true,
	// Audio
	"audio/mpeg": true,
	"audio/ogg":  true,
	"audio/wav":  true,
	"audio/webm": true,
	// Fonts
	"font/woff":             true,
	"font/woff2":            true,
	"font/ttf":              true,
	"font/otf":              true,
	"application/font-woff": true,
	// Archives (safe)
	"application/zip":              true,
	"application/x-zip-compressed": true,
	"application/gzip":             true,
	"application/x-gzip":           true,
	"application/x-tar":            true,
	"application/x-7z-compressed":  true,
	"application/x-rar-compressed": true,
	"application/vnd.rar":          true,
	// MS Office
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"application/msword":            true,
	"application/vnd.ms-excel":      true,
	"application/vnd.ms-powerpoint": true,
	// Octet-stream fallback (validated by extension below)
	"application/octet-stream": true,
}

// blockedExtensions are file extensions that are never allowed, regardless of MIME type.
var blockedExtensions = map[string]bool{
	".exe": true, ".bat": true, ".cmd": true, ".com": true, ".msi": true,
	".scr": true, ".pif": true, ".vbs": true, ".vbe": true, ".js": true,
	".jse": true, ".wsf": true, ".wsh": true, ".ps1": true, ".psm1": true,
	".sh": true, ".bash": true, ".csh": true, ".ksh": true,
	".php": true, ".phtml": true, ".php3": true, ".php4": true, ".php5": true,
	".asp": true, ".aspx": true, ".jsp": true,
	".dll": true, ".sys": true, ".drv": true,
	".reg": true, ".inf": true, ".hta": true, ".cpl": true, ".msc": true,
	".jar": true, ".class": true, ".py": true, ".pyc": true, ".rb": true,
}

func (s *server) uploadAdminFile(c *fiber.Ctx) error {
	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบจัดเก็บไฟล์ไม่พร้อมใช้งาน"})
	}

	const maxBytes int64 = 50 * 1024 * 1024 // 50MB
	isCover := c.Query("kind") == "cover"
	prefix := adminLibraryPrefixFor(c.Query("kind"))

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาเลือกไฟล์"})
	}
	if fileHeader.Size <= 0 || fileHeader.Size > maxBytes {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ขนาดไฟล์ไม่ถูกต้อง (สูงสุด 50MB)"})
	}

	// --- Security: Validate extension ---
	origName := filepath.Base(fileHeader.Filename) // strip path traversal
	ext := strings.ToLower(filepath.Ext(origName))

	if blockedExtensions[ext] {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่อนุญาตให้อัพโหลดไฟล์ประเภทนี้ (" + ext + ")"})
	}

	// --- Security: Read and validate content ---
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ไม่สามารถอ่านไฟล์ได้"})
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil || int64(len(data)) > maxBytes {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไฟล์มีขนาดใหญ่เกินไป"})
	}

	// --- Security: MIME type validation using actual file content ---
	detectedMIME := normalizeDetectedContentType(http.DetectContentType(data))
	if !allowedMIMETypes[detectedMIME] {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ประเภทไฟล์ไม่ได้รับอนุญาต (" + detectedMIME + ")"})
	}
	if isCover && !coverImageTypes[detectedMIME] {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "รูปปกต้องเป็นไฟล์ JPG, PNG, GIF หรือ WebP"})
	}

	// --- Security: Double-check for disguised executable content ---
	if len(data) >= 2 {
		if (data[0] == 'M' && data[1] == 'Z') ||
			(len(data) >= 4 && data[0] == 0x7f && data[1] == 'E' && data[2] == 'L' && data[3] == 'F') ||
			(data[0] == '#' && data[1] == '!') {
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ตรวจพบไฟล์ปฏิบัติการ (executable) ไม่อนุญาตให้อัพโหลด"})
		}
	}

	// --- Security: Safe Original Filename + Duplicate Auto-Increment (1), (2) ---
	baseName, safeExt := sanitizeFilename(fileHeader.Filename)
	if safeExt == "" {
		mimeExtMap := map[string]string{
			"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
			"image/webp": ".webp", "application/pdf": ".pdf", "text/plain": ".txt",
			"video/mp4": ".mp4", "audio/mpeg": ".mp3", "application/zip": ".zip",
		}
		if e, ok := mimeExtMap[detectedMIME]; ok {
			safeExt = e
		}
	}

	targetFilename := baseName + safeExt
	key := prefix + targetFilename

	// Check if file exists in storage; if duplicate, append (1), (2), etc.
	seq := 1
	for {
		_, err := s.storage.StatObject(c.Context(), s.cfg.s3Bucket, key, minio.StatObjectOptions{})
		if err != nil {
			// Object does not exist, key is available!
			break
		}
		// File already exists -> generate candidate name: baseName(1).ext
		targetFilename = fmt.Sprintf("%s(%d)%s", baseName, seq, safeExt)
		key = prefix + targetFilename
		seq++
		if seq > 9999 {
			random := make([]byte, 4)
			rand.Read(random)
			targetFilename = fmt.Sprintf("%s_%s%s", baseName, hex.EncodeToString(random), safeExt)
			key = prefix + targetFilename
			break
		}
	}

	contentType := detectedMIME

	if _, err := s.storage.PutObject(c.Context(), s.cfg.s3Bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType: contentType,
	}); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "ไม่สามารถบันทึกไฟล์ได้"})
	}

	url := s.buildSecureFileURL(c.Context(), key)

	s.audit(c, auditEvent{Actor: current(c), Category: "files", Action: "file.uploaded", Target: "file", TargetID: key})

	return c.JSON(fiber.Map{
		"success":        true,
		"url":            url,
		"filename":       targetFilename,
		"storedFilename": targetFilename,
		"size":           fileHeader.Size,
		"type":           contentType,
		"createdAt":      "",
	})
}

func sanitizeFilename(name string) (string, string) {
	orig := filepath.Base(name)
	ext := strings.ToLower(filepath.Ext(orig))
	rawBase := orig
	if len(ext) > 0 && len(orig) > len(ext) {
		rawBase = orig[:len(orig)-len(ext)]
	}

	var clean strings.Builder
	for _, r := range rawBase {
		if r == '/' || r == '\\' || r == 0 || r == '?' || r == '*' || r == ':' || r == '|' || r == '"' || r == '<' || r == '>' || r == '.' {
			clean.WriteRune('_')
		} else if unicode.IsPrint(r) {
			clean.WriteRune(r)
		} else {
			clean.WriteRune('_')
		}
	}
	runes := []rune(strings.TrimSpace(clean.String()))
	if len(runes) == 0 {
		return "file", ext
	}
	if len(runes) > 120 {
		runes = runes[:120]
	}
	baseName := strings.TrimSpace(string(runes))
	if baseName == "" {
		baseName = "file"
	}
	return baseName, ext
}

func (s *server) deleteAdminFile(c *fiber.Ctx) error {
	filename := c.Query("filename")
	if filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "กรุณาระบุชื่อไฟล์ที่ต้องการลบ"})
	}

	if s.storage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบจัดเก็บไฟล์ไม่พร้อมใช้งาน"})
	}

	prefix := adminLibraryPrefixFor(c.Query("kind"))
	key := prefix + filepath.Base(filename)
	if decryptedKey, err := s.getObjectKeyFromShortCode(c.Context(), filename); err == nil && decryptedKey != "" {
		key = decryptedKey
	}

	// Only library files (or covers, with kind=cover) can be deleted here; never avatars,
	// brand assets or Discord uploads.
	if key == "" || strings.Contains(key, "..") || !strings.HasPrefix(key, prefix) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ชื่อไฟล์ไม่ถูกต้อง"})
	}

	err := s.storage.RemoveObject(c.Context(), s.cfg.s3Bucket, key, minio.RemoveObjectOptions{})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(apiError{Error: "เกิดข้อผิดพลาดในการลบไฟล์"})
	}

	s.audit(c, auditEvent{Actor: current(c), Category: "files", Action: "file.deleted", Target: "file", TargetID: key})
	return c.JSON(fiber.Map{"success": true})
}
