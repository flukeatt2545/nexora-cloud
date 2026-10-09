package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type siteRoute struct {
	publicID    string
	name        string
	port        int
	status      string
	health      string
	maintenance bool
}

type gateway struct {
	db          *pgxpool.Pool
	baseDomains []string
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databaseURL := env("DATABASE_URL", "postgres://nexora:nexora@localhost:5432/nexora?sslmode=disable")
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("database configuration failed: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("database is unavailable: %v", err)
	}

	g := &gateway{
		db:          pool,
		baseDomains: domains(env("HOSTING_BASE_DOMAINS", env("HOSTING_BASE_DOMAIN", "nkn02.com")+",localhost")),
	}
	server := &http.Server{
		Addr:              env("GATEWAY_ADDR", ":8090"),
		Handler:           g,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Printf("NEXORA runtime gateway listening on %s", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("gateway stopped unexpectedly: %v", err)
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutdownCtx)
}

func (g *gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/_nexora/health" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
		return
	}
	if r.Method == http.MethodTrace {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	host := canonicalHost(r.Host)
	if host == "" {
		g.errorPage(w, http.StatusBadRequest, "Domain ไม่ถูกต้อง")
		return
	}
	subdomain := g.subdomain(host)
	isCodeWorkspace := false
	lookupSub := subdomain
	if strings.HasPrefix(subdomain, "code-") {
		isCodeWorkspace = true
		lookupSub = strings.TrimPrefix(subdomain, "code-")
	}
	route, err := g.lookup(r.Context(), host, lookupSub)
	if errors.Is(err, pgx.ErrNoRows) {
		g.errorPage(w, http.StatusNotFound, "ไม่พบเว็บไซต์นี้")
		return
	}
	if err != nil {
		log.Printf("route lookup failed for %q: %v", host, err)
		g.errorPage(w, http.StatusServiceUnavailable, "ระบบกำลังไม่พร้อมใช้งาน")
		return
	}
	if route.maintenance {
		g.errorPage(w, http.StatusServiceUnavailable, "เว็บไซต์กำลังปิดปรับปรุง")
		return
	}
	if !isCodeWorkspace && (route.status != "running" || route.port < 1024) {
		g.errorPage(w, http.StatusServiceUnavailable, statusMessage(route.status))
		return
	}
	if isCodeWorkspace && route.status != "running" {
		g.errorPage(w, http.StatusServiceUnavailable, "โปรเจกต์นี้ยังไม่ได้เปิดใช้งาน")
		return
	}

	if isCodeWorkspace {
		authorized, sessionToken := g.authenticateWorkspace(r.Context(), r, route.publicID)
		if !authorized {
			w.Header().Set("Cache-Control", "no-store")
			g.errorPage(w, http.StatusUnauthorized, "กรุณาเข้าใช้งานผ่าน Discord หรือหน้าเว็บ NEXORA")
			return
		}
		if queryToken := strings.TrimSpace(r.URL.Query().Get("token")); queryToken != "" && queryToken == sessionToken && shouldStripWorkspaceToken(r) {
			http.SetCookie(w, workspaceSessionCookie(sessionToken, forwardedProto(r) == "https"))
			http.Redirect(w, r, safeWorkspaceTarget(r.URL), http.StatusSeeOther)
			return
		}
		if shouldStripWorkspaceToken(r) && hasUnsafeWorkspaceTarget(r.URL) {
			http.Redirect(w, r, safeWorkspaceTarget(r.URL), http.StatusSeeOther)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		target, _ := url.Parse("http://nexora-code-" + route.publicID + ":8080")
		proxy := httputil.NewSingleHostReverseProxy(target)
		proxy.Transport = &http.Transport{
			Proxy:                 nil,
			DialContext:           (&net.Dialer{Timeout: 4 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			ForceAttemptHTTP2:     false,
			MaxIdleConns:          128,
			MaxIdleConnsPerHost:   16,
			IdleConnTimeout:       60 * time.Second,
			ResponseHeaderTimeout: 30 * time.Second,
		}
		proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, proxyErr error) {
			log.Printf("workspace proxy failed for site %s: %v", route.publicID, proxyErr)
			g.errorPage(w, http.StatusBadGateway, "พื้นที่เขียนโค้ดยังไม่พร้อมตอบสนอง")
		}
		proxy.ModifyResponse = func(resp *http.Response) error {
			resp.Header.Del("Server")
			resp.Header.Del("X-Powered-By")
			resp.Header.Del("X-Frame-Options")
			resp.Header.Set("Content-Security-Policy", "frame-ancestors 'self' https://nkn02.com https://*.nkn02.com http://localhost:*")
			return nil
		}
		r.Header.Set("X-Forwarded-Host", host)
		r.Header.Set("X-Forwarded-Proto", forwardedProto(r))
		r.Host = host
		proxy.ServeHTTP(w, r)
		return
	}

	target, _ := url.Parse("http://" + containerName(route.publicID) + ":" + strconv.Itoa(route.port))
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 4 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2:     false,
		MaxIdleConns:          128,
		MaxIdleConnsPerHost:   16,
		IdleConnTimeout:       60 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, proxyErr error) {
		log.Printf("runtime proxy failed for site %s: %v", route.publicID, proxyErr)
		g.errorPage(w, http.StatusBadGateway, "เว็บไซต์ยังไม่พร้อมตอบสนอง")
	}
	proxy.ModifyResponse = func(response *http.Response) error {
		response.Header.Del("Server")
		response.Header.Del("X-Powered-By")
		response.Header.Set("X-Content-Type-Options", "nosniff")
		response.Header.Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Add browser caching for static assets if not explicitly set
		if response.StatusCode == http.StatusOK && response.Header.Get("Cache-Control") == "" && response.Request != nil {
			reqPath := response.Request.URL.Path
			ext := strings.ToLower(path.Ext(reqPath))
			switch ext {
			case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".css", ".js", ".mp4", ".mp3", ".webm":
				response.Header.Set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
			}
		}
		return nil
	}
	r.Header.Set("X-Forwarded-Host", host)
	r.Header.Set("X-Forwarded-Proto", forwardedProto(r))
	r.Host = host
	proxy.ServeHTTP(w, r)
}

func (g *gateway) lookup(ctx context.Context, host, subdomain string) (siteRoute, error) {
	var route siteRoute
	err := g.db.QueryRow(ctx, `
		SELECT public_id, name, COALESCE(runtime_port,0), status, health_status, maintenance_mode
		FROM hosting_sites
		WHERE deleted_at IS NULL
		  AND (
		    ($1 <> '' AND LOWER(subdomain)=LOWER($1))
		    OR (custom_domain IS NOT NULL AND LOWER(custom_domain)=LOWER($2))
		  )
		LIMIT 1
	`, subdomain, host).Scan(
		&route.publicID, &route.name, &route.port, &route.status, &route.health, &route.maintenance,
	)
	return route, err
}

func (g *gateway) subdomain(host string) string {
	for _, base := range g.baseDomains {
		suffix := "." + base
		if strings.HasSuffix(host, suffix) {
			value := strings.TrimSuffix(host, suffix)
			if value != "" && !strings.Contains(value, ".") {
				return value
			}
		}
	}
	return ""
}

func (g *gateway) authenticateWorkspace(ctx context.Context, r *http.Request, sitePublicID string) (bool, string) {
	// 1. Check query parameter ?token=...
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token != "" && len(token) <= 128 {
		var foundSite string
		err := g.db.QueryRow(ctx, `
			SELECT site_public_id
			FROM hosting_workspace_access_tokens
			WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
		`, workspaceTokenHash(token)).Scan(&foundSite)
		if err == nil && strings.EqualFold(foundSite, sitePublicID) {
			return true, token
		}
	}

	// 2. Check cookie nexora_code_session
	if cookie, err := r.Cookie("nexora_code_session"); err == nil && cookie.Value != "" {
		cookieToken := strings.TrimSpace(cookie.Value)
		if len(cookieToken) <= 128 {
			var foundSite string
			err := g.db.QueryRow(ctx, `
				SELECT site_public_id
				FROM hosting_workspace_access_tokens
				WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
			`, workspaceTokenHash(cookieToken)).Scan(&foundSite)
			if err == nil && strings.EqualFold(foundSite, sitePublicID) {
				return true, cookieToken
			}
		}
	}

	return false, ""
}

func workspaceTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// shouldStripWorkspaceToken reports whether the request is a normal browser
// document navigation where the launch token should be exchanged for the
// session cookie and removed from the visible URL. WebSocket upgrades and
// non-GET requests keep flowing straight to the proxy.
func shouldStripWorkspaceToken(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("Upgrade")), "websocket") {
		return false
	}
	accept := strings.ToLower(r.Header.Get("Accept"))
	if !strings.Contains(accept, "text/html") {
		return false
	}
	return true
}

func workspaceSessionCookie(token string, secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     "nexora_code_session",
		Value:    token,
		Path:     "/",
		MaxAge:   int((4 * time.Hour).Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	}
}

func hasUnsafeWorkspaceTarget(u *url.URL) bool {
	query := u.Query()
	if query.Has("workspace") {
		return true
	}
	folders, found := query["folder"]
	return found && (len(folders) != 1 || folders[0] != "/home/coder/project")
}

func safeWorkspaceTarget(u *url.URL) string {
	target := *u
	query := target.Query()
	query.Del("token")
	query.Del("workspace")
	query.Set("folder", "/home/coder/project")
	target.RawQuery = query.Encode()
	return target.RequestURI()
}

type errorDetails struct {
	status      int
	codeLabel   string
	badgeClass  string
	title       string
	description string
	iconType    string
	autoReload  bool
}

func getErrorDetails(status int, message string) errorDetails {
	switch {
	case message == "กรุณาเข้าใช้งานผ่าน Discord หรือหน้าเว็บ NEXORA":
		return errorDetails{
			status:      status,
			codeLabel:   "401 · UNAUTHORIZED",
			badgeClass:  "amber",
			title:       "จำเป็นต้องยืนยันตัวตนก่อนเข้าใช้งาน VS Code",
			description: "กรุณากดปุ่มเปิดพื้นที่เขียนโค้ดจากห้องแชท Discord หรือหน้าแดชบอร์ด NEXORA เพื่อรับสิทธิ์เข้าถึง",
			iconType:    "maintenance",
			autoReload:  false,
		}
	case message == "พื้นที่เขียนโค้ดยังไม่พร้อมตอบสนอง":
		return errorDetails{
			status:      status,
			codeLabel:   "502 · WORKSPACE STARTING",
			badgeClass:  "blue",
			title:       "VS Code กำลังเริ่มทำงาน",
			description: "กำลังเตรียมความพร้อมสภาพแวดล้อม VS Code กรุณารอสักครู่ ระบบจะรีเฟรชหน้าเว็บอัตโนมัติ",
			iconType:    "provisioning",
			autoReload:  true,
		}
	case message == "เว็บไซต์กำลังเตรียมระบบ":
		return errorDetails{
			status:      status,
			codeLabel:   "503 · PROVISIONING",
			badgeClass:  "blue",
			title:       "เว็บไซต์กำลังเตรียมระบบ",
			description: "ระบบกำลังติดตั้งและเตรียมความพร้อมสำหรับการใช้งาน กรุณารอสักครู่",
			iconType:    "provisioning",
			autoReload:  true,
		}
	case message == "เว็บไซต์กำลังปิดปรับปรุง":
		return errorDetails{
			status:      status,
			codeLabel:   "503 · MAINTENANCE",
			badgeClass:  "amber",
			title:       "เว็บไซต์อยู่ระหว่างปิดปรับปรุง",
			description: "เว็บไซต์นี้อยู่ระหว่างการปรับปรุงระบบชั่วคราว กรุณากลับมาใหม่อีกครั้งในภายหลัง",
			iconType:    "maintenance",
			autoReload:  false,
		}
	case message == "เว็บไซต์หมดอายุแล้ว":
		return errorDetails{
			status:      status,
			codeLabel:   "503 · UNAVAILABLE",
			badgeClass:  "rose",
			title:       "เว็บไซต์ไม่พร้อมให้บริการ",
			description: "เว็บไซต์นี้สิ้นสุดระยะเวลาการให้บริการแล้ว",
			iconType:    "expired",
			autoReload:  false,
		}
	case message == "เว็บไซต์หยุดทำงานเนื่องจากพบข้อผิดพลาด":
		return errorDetails{
			status:      status,
			codeLabel:   "503 · SERVICE ERROR",
			badgeClass:  "rose",
			title:       "เว็บไซต์หยุดทำงานชั่วคราว",
			description: "เกิดข้อผิดพลาดในการประมวลผล กรุณาลองใหม่อีกครั้งในภายหลัง",
			iconType:    "error",
			autoReload:  false,
		}
	case message == "เว็บไซต์ยังไม่ได้เริ่มทำงาน":
		return errorDetails{
			status:      status,
			codeLabel:   "503 · OFFLINE",
			badgeClass:  "warning",
			title:       "เว็บไซต์ยังไม่เปิดให้บริการ",
			description: "เว็บไซต์นี้อยู่ในสถานะออฟไลน์ชั่วคราว กรุณากลับมาใหม่อีกครั้ง",
			iconType:    "stopped",
			autoReload:  false,
		}
	case message == "เว็บไซต์ยังไม่พร้อมตอบสนอง":
		return errorDetails{
			status:      status,
			codeLabel:   "502 · BAD GATEWAY",
			badgeClass:  "blue",
			title:       "เว็บไซต์ยังไม่พร้อมตอบสนอง",
			description: "ระบบปลายทางยังไม่เปิดรับการเชื่อมต่อ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง",
			iconType:    "provisioning",
			autoReload:  true,
		}
	case status == http.StatusNotFound || message == "ไม่พบเว็บไซต์นี้":
		return errorDetails{
			status:      http.StatusNotFound,
			codeLabel:   "404 · NOT FOUND",
			badgeClass:  "blue",
			title:       "ไม่พบเว็บไซต์นี้",
			description: "ไม่พบชื่อโดเมนที่คุณเรียก กรุณาตรวจสอบความถูกต้องของ URL",
			iconType:    "not_found",
			autoReload:  false,
		}
	case status == http.StatusBadRequest || message == "Domain ไม่ถูกต้อง":
		return errorDetails{
			status:      http.StatusBadRequest,
			codeLabel:   "400 · BAD REQUEST",
			badgeClass:  "rose",
			title:       "คำขอไม่ถูกต้อง",
			description: "รูปแบบชื่อโดเมนไม่ถูกต้อง กรุณาตรวจสอบ URL อีกครั้ง",
			iconType:    "error",
			autoReload:  false,
		}
	default:
		return errorDetails{
			status:      status,
			codeLabel:   fmt.Sprintf("%d · ERROR", status),
			badgeClass:  "rose",
			title:       "ระบบไม่พร้อมใช้งานชั่วคราว",
			description: "พบปัญหาในการเชื่อมต่อ กรุณากดรีเฟรชหรือลองใหม่อีกครั้งในภายหลัง",
			iconType:    "error",
			autoReload:  false,
		}
	}
}

func renderIcon(iconType string) string {
	switch iconType {
	case "provisioning":
		return `<div class="icon-container pulse" style="background:rgba(94,94,230,0.12);color:#7c7cf5;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg></div>`
	case "maintenance":
		return `<div class="icon-container" style="background:rgba(255,170,0,0.12);color:#ffaa00;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg></div>`
	case "not_found":
		return `<div class="icon-container" style="background:rgba(94,94,230,0.12);color:#7c7cf5;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg></div>`
	case "expired":
		return `<div class="icon-container" style="background:rgba(255,68,68,0.12);color:#ff5555;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>`
	case "stopped":
		return `<div class="icon-container" style="background:rgba(148,163,184,0.12);color:#94a3b8;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg></div>`
	default:
		return `<div class="icon-container" style="background:rgba(255,68,68,0.12);color:#ff5555;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>`
	}
}

func (g *gateway) errorPage(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)

	d := getErrorDetails(status, message)
	iconHTML := renderIcon(d.iconType)

	autoReloadHTML := ""
	autoReloadScript := ""
	if d.autoReload {
		autoReloadHTML = `<div class="auto-retry-box"><span class="live-dot"></span><span>กำลังตรวจเช็กสถานะอัตโนมัติใน <strong id="cd" style="color:#ffffff;font-size:14px;margin:0 2px;">5</strong> วินาที...</span></div>`
		autoReloadScript = `<script>
let s = 5;
const el = document.getElementById('cd');
const iv = setInterval(() => {
  s--;
  if (el) el.textContent = s;
  if (s <= 0) {
    clearInterval(iv);
    window.location.reload();
  }
}, 1000);
</script>`
	}

	htmlTemplate := `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>{{TITLE}} — NEXORA CLOUD</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg: #07080c;
      --surface: rgba(18, 20, 30, 0.94);
      --border: rgba(255, 255, 255, 0.09);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #5e5ee6;
      --primary-hover: #4f4fe0;
      --primary-glow: rgba(94, 94, 230, 0.28);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: clamp(16px, 4vw, 32px);
      background-color: var(--bg);
      background-image: 
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(94, 94, 230, 0.15), transparent 70%),
        radial-gradient(ellipse 60% 40% at 50% 110%, rgba(255, 16, 24, 0.08), transparent 70%);
      color: var(--text);
      font-family: 'Kanit', 'Inter', system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }
    .status-card {
      width: 100%;
      max-width: 480px;
      padding: 32px 28px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 22px;
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: card-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes card-in {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .header-bar {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 16px;
      margin-bottom: 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .brand-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #ffffff;
      font-size: 13.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
    }
    .brand-pill svg { color: var(--primary); width: 18px; height: 18px; }
    .status-badge {
      padding: 4px 10px;
      border-radius: 99px;
      font-family: 'Inter', monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-muted);
    }
    .status-badge.blue {
      border-color: rgba(94, 94, 230, 0.3);
      background: rgba(94, 94, 230, 0.12);
      color: #a5a5fa;
    }
    .status-badge.amber {
      border-color: rgba(255, 170, 0, 0.3);
      background: rgba(255, 170, 0, 0.12);
      color: #ffbb33;
    }
    .status-badge.rose {
      border-color: rgba(255, 68, 68, 0.3);
      background: rgba(255, 68, 68, 0.12);
      color: #ff8888;
    }
    .status-badge.warning {
      border-color: rgba(255, 190, 50, 0.3);
      background: rgba(255, 190, 50, 0.12);
      color: #ffcc55;
    }
    .icon-container {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 20px;
      box-shadow: 0 0 25px rgba(94, 94, 230, 0.25);
    }
    .icon-container.pulse {
      animation: pulse-glow 2.4s infinite ease-in-out;
    }
    @keyframes pulse-glow {
      0%, 100% { transform: scale(1); box-shadow: 0 0 20px rgba(94, 94, 230, 0.25); }
      50% { transform: scale(1.04); box-shadow: 0 0 35px rgba(94, 94, 230, 0.45); }
    }
    .icon-container svg {
      width: 32px;
      height: 32px;
    }
    h1.status-title {
      font-size: 20px;
      font-weight: 600;
      color: #ffffff;
      margin: 0 0 10px;
      line-height: 1.35;
    }
    p.status-desc {
      font-size: 13.5px;
      font-weight: 300;
      color: var(--text-muted);
      line-height: 1.65;
      max-width: 410px;
      margin: 0 auto 22px;
    }
    .auto-retry-box {
      width: 100%;
      margin-bottom: 22px;
      padding: 10px 14px;
      border-radius: 12px;
      background: rgba(94, 94, 230, 0.08);
      border: 1px solid rgba(94, 94, 230, 0.22);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      font-size: 13px;
      color: #cbd5e1;
    }
    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00d084;
      box-shadow: 0 0 10px #00d084;
      animation: blink 1.4s infinite ease-in-out;
      flex-shrink: 0;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.3; transform: scale(0.8); }
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
    }
    .btn {
      flex: 1;
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0 16px;
      border-radius: 12px;
      font-family: inherit;
      font-size: 13.5px;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    .btn-primary {
      border: none;
      background: var(--primary);
      color: #ffffff;
      box-shadow: 0 4px 16px var(--primary-glow);
    }
    .btn-primary:hover {
      background: var(--primary-hover);
      transform: translateY(-1px);
    }
    .btn-secondary {
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.09);
      border-color: rgba(255, 255, 255, 0.15);
      transform: translateY(-1px);
    }
    .footer-note {
      margin-top: 22px;
      font-size: 11.5px;
      color: #64748b;
      letter-spacing: 0.02em;
    }
    @media (max-width: 480px) {
      .actions {
        flex-direction: column;
      }
      .btn {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main class="status-card">
    <div class="header-bar">
      <div class="brand-pill">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path></svg>
        <span>NEXORA CLOUD</span>
      </div>
      <span class="status-badge {{BADGE_CLASS}}">{{CODE_LABEL}}</span>
    </div>

    {{ICON_HTML}}

    <h1 class="status-title">{{TITLE}}</h1>
    <p class="status-desc">{{DESCRIPTION}}</p>

    {{AUTO_RELOAD_HTML}}

    <div class="actions">
      <button type="button" class="btn btn-primary" onclick="window.location.reload()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>
        <span>รีเฟรชหน้านี้</span>
      </button>
      <a href="https://nkn02.com" class="btn btn-secondary">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
        <span>แดชบอร์ดหลัก</span>
      </a>
    </div>

    <div class="footer-note">NEXORA Cloud Hosting · Protected Runtime Gateway</div>
  </main>
  {{AUTO_RELOAD_SCRIPT}}
</body>
</html>`

	res := strings.ReplaceAll(htmlTemplate, "{{TITLE}}", d.title)
	res = strings.ReplaceAll(res, "{{BADGE_CLASS}}", d.badgeClass)
	res = strings.ReplaceAll(res, "{{CODE_LABEL}}", d.codeLabel)
	res = strings.ReplaceAll(res, "{{ICON_HTML}}", iconHTML)
	res = strings.ReplaceAll(res, "{{DESCRIPTION}}", d.description)
	res = strings.ReplaceAll(res, "{{AUTO_RELOAD_HTML}}", autoReloadHTML)
	res = strings.ReplaceAll(res, "{{AUTO_RELOAD_SCRIPT}}", autoReloadScript)

	_, _ = w.Write([]byte(res))
}

func canonicalHost(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if strings.Contains(value, "://") {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	} else if strings.Count(value, ":") == 1 {
		value = strings.SplitN(value, ":", 2)[0]
	}
	value = strings.TrimSuffix(value, ".")
	if value == "" || len(value) > 253 || strings.ContainsAny(value, `/\@ `) {
		return ""
	}
	return value
}

func containerName(publicID string) string {
	return "nexora-site-" + strings.TrimSpace(publicID)
}

func statusMessage(status string) string {
	switch status {
	case "provisioning":
		return "เว็บไซต์กำลังเตรียมระบบ"
	case "expired":
		return "เว็บไซต์หมดอายุแล้ว"
	case "error":
		return "เว็บไซต์หยุดทำงานเนื่องจากพบข้อผิดพลาด"
	default:
		return "เว็บไซต์ยังไม่ได้เริ่มทำงาน"
	}
}

func forwardedProto(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	if value := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); value == "https" {
		return "https"
	}
	return "http"
}

func domains(value string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, 2)
	for _, item := range strings.Split(value, ",") {
		item = canonicalHost(item)
		if item != "" && !seen[item] {
			seen[item] = true
			result = append(result, item)
		}
	}
	return result
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
