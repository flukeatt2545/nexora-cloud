package main

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

const (
	lockdownCacheKey      = "system:lockdown:state"
	lockdownTicketPrefix  = "system:lockdown:ticket:"
	lockdownSessionPrefix = "system:lockdown:session:"
	lockdownControlCookie = "__Host-nexora_lock_control"
	maxLockdownDuration   = 5 * 365 * 24 * time.Hour
)

type lockdownState struct {
	Enabled       bool       `json:"enabled"`
	StartedAt     *time.Time `json:"startedAt,omitempty"`
	ExpiresAt     *time.Time `json:"expiresAt,omitempty"`
	PrivateReason string     `json:"privateReason,omitempty"`
	Source        string     `json:"source,omitempty"`
	Actor         string     `json:"actor,omitempty"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type lockdownUpdateInput struct {
	Enabled         bool   `json:"enabled"`
	DurationSeconds int64  `json:"durationSeconds"`
	Reason          string `json:"reason"`
}

type lockdownAccessTicket struct {
	Actor string `json:"actor"`
}

type lockdownControlSession struct {
	Actor string `json:"actor"`
	CSRF  string `json:"csrf"`
}

func (s *server) rememberLockdown(state lockdownState) {
	s.lockdownMu.Lock()
	s.lockdownLast = state
	s.lockdownKnown = true
	s.lockdownMu.Unlock()
}

func (s *server) rememberedLockdown() (lockdownState, bool) {
	s.lockdownMu.RLock()
	defer s.lockdownMu.RUnlock()
	return s.lockdownLast, s.lockdownKnown
}

func (s *server) alertLockdownStateReadFailure() {
	now := time.Now()
	s.lockdownMu.Lock()
	if !s.lockdownAlertedAt.IsZero() && now.Sub(s.lockdownAlertedAt) < 5*time.Minute {
		s.lockdownMu.Unlock()
		return
	}
	s.lockdownAlertedAt = now
	s.lockdownMu.Unlock()

	go s.audit(nil, auditEvent{
		Category: "security",
		Action:   "lockdown.state_read_failed",
		Target:   "system",
		Outcome:  "failure",
		Metadata: map[string]any{"fallback": "last_trusted_state"},
	})
}

func (s *server) cacheLockdown(ctx context.Context, state lockdownState) {
	value, err := json.Marshal(state)
	if err == nil {
		if err = s.redis.Set(ctx, lockdownCacheKey, value, 0).Err(); err != nil {
			log.Printf("[WARN] Lockdown Redis cache update failed: %v", err)
		}
	}
	s.rememberLockdown(state)
}

func (s *server) loadLockdownState(ctx context.Context, force bool) (lockdownState, error) {
	if !force {
		if value, err := s.redis.Get(ctx, lockdownCacheKey).Bytes(); err == nil {
			var cached lockdownState
			if json.Unmarshal(value, &cached) == nil {
				if cached.Enabled && cached.ExpiresAt != nil && !cached.ExpiresAt.After(time.Now()) {
					return s.expireLockdown(ctx, cached)
				}
				s.rememberLockdown(cached)
				return cached, nil
			}
		} else if err != redis.Nil {
			log.Printf("[WARN] Lockdown Redis read failed: %v", err)
		}
	}

	state := lockdownState{}
	err := s.db.QueryRow(ctx, `
		SELECT enabled, started_at, expires_at, private_reason, source, actor, updated_at
		FROM system_lockdown_state WHERE singleton=TRUE
	`).Scan(&state.Enabled, &state.StartedAt, &state.ExpiresAt, &state.PrivateReason, &state.Source, &state.Actor, &state.UpdatedAt)
	if err != nil {
		s.alertLockdownStateReadFailure()
		if previous, ok := s.rememberedLockdown(); ok {
			return previous, err
		}
		return lockdownState{Enabled: false, UpdatedAt: time.Now()}, err
	}
	if state.Enabled && state.ExpiresAt != nil && !state.ExpiresAt.After(time.Now()) {
		return s.expireLockdown(ctx, state)
	}
	s.cacheLockdown(ctx, state)
	return state, nil
}

func (s *server) expireLockdown(ctx context.Context, state lockdownState) (lockdownState, error) {
	now := time.Now()
	result, err := s.db.Exec(ctx, `
		UPDATE system_lockdown_state
		SET enabled=FALSE, private_reason='', source='automatic', actor='system', updated_at=$1
		WHERE singleton=TRUE AND enabled=TRUE AND expires_at IS NOT NULL AND expires_at <= $1
	`, now)
	if err != nil {
		if previous, ok := s.rememberedLockdown(); ok {
			return previous, err
		}
		return state, err
	}
	if result.RowsAffected() > 0 {
		_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs (actor_username,actor_role,category,action,target_type,outcome,metadata) VALUES ('system','system','security','lockdown.expired','system','success','{}'::jsonb)`)
	}
	state.Enabled = false
	state.PrivateReason = ""
	state.Source = "automatic"
	state.Actor = "system"
	state.UpdatedAt = now
	s.cacheLockdown(ctx, state)
	return state, nil
}

func validateLockdownInput(input *lockdownUpdateInput) error {
	input.Reason = cleanText(input.Reason, 200)
	if input.DurationSeconds < 0 || input.DurationSeconds > int64(maxLockdownDuration/time.Second) {
		return fiber.NewError(fiber.StatusBadRequest, "ระยะเวลาต้องไม่เกิน 5 ปี")
	}
	return nil
}

func (s *server) setLockdownState(ctx context.Context, input lockdownUpdateInput, source, actor string) (lockdownState, error) {
	if err := validateLockdownInput(&input); err != nil {
		return lockdownState{}, err
	}
	now := time.Now()
	state := lockdownState{Enabled: input.Enabled, PrivateReason: input.Reason, Source: cleanText(source, 40), Actor: cleanText(actor, 100), UpdatedAt: now}
	if input.Enabled {
		state.StartedAt = &now
		if input.DurationSeconds > 0 {
			expires := now.Add(time.Duration(input.DurationSeconds) * time.Second)
			state.ExpiresAt = &expires
		}
	} else {
		state.PrivateReason = ""
	}
	_, err := s.db.Exec(ctx, `
		UPDATE system_lockdown_state SET enabled=$1, started_at=$2, expires_at=$3,
		private_reason=$4, source=$5, actor=$6, updated_at=$7 WHERE singleton=TRUE
	`, state.Enabled, state.StartedAt, state.ExpiresAt, state.PrivateReason, state.Source, state.Actor, state.UpdatedAt)
	if err != nil {
		return lockdownState{}, err
	}
	s.cacheLockdown(ctx, state)
	// Unlocking means "open the website" to whoever asks, so it also lifts /website close.
	if !input.Enabled {
		if offline, err := s.loadSiteOfflineState(ctx, true); err == nil && offline.Enabled {
			if _, err := s.setSiteOfflineState(ctx, lockdownUpdateInput{Enabled: false}, source, actor); err != nil {
				log.Printf("[WARN] Unlock could not reopen the closed sites: %v", err)
			}
		}
	}
	return state, nil
}

func lockdownPublicState(state lockdownState) fiber.Map {
	return fiber.Map{"enabled": state.Enabled, "startedAt": state.StartedAt, "expiresAt": state.ExpiresAt, "updatedAt": state.UpdatedAt}
}

func (s *server) lockdownGate(c *fiber.Ctx) error {
	state, err := s.loadLockdownState(c.Context(), false)
	if err != nil {
		log.Printf("[WARN] Lockdown gate used last trusted state: %v", err)
	}
	if !state.Enabled {
		return c.SendStatus(fiber.StatusNoContent)
	}
	c.Set(fiber.HeaderCacheControl, "no-store, private, max-age=0")
	c.Set("X-Nexora-Lockdown", "1")
	if state.ExpiresAt != nil {
		seconds := int64(time.Until(*state.ExpiresAt).Seconds())
		if seconds < 1 {
			seconds = 1
		}
		c.Set(fiber.HeaderRetryAfter, strconv.FormatInt(seconds, 10))
		c.Set("X-Nexora-Lockdown-Expires-At", state.ExpiresAt.UTC().Format(time.RFC3339))
	}
	uri := c.Get("X-Forwarded-Uri")
	if uri == "" {
		uri = c.Get("X-Lockdown-Original-URI")
	}
	accept := c.Get(fiber.HeaderAccept)
	if strings.HasPrefix(uri, "/api/") || strings.Contains(accept, fiber.MIMEApplicationJSON) {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "ระบบปิดให้บริการชั่วคราว", "code": "system_lockdown", "expiresAt": state.ExpiresAt})
	}
	return c.Status(fiber.StatusServiceUnavailable).SendString("Service unavailable")
}

func (s *server) adminLockdownStatus(c *fiber.Ctx) error {
	state, err := s.loadLockdownState(c.Context(), true)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}
	return c.JSON(state)
}

func (s *server) adminUpdateLockdown(c *fiber.Ctx) error {
	var input lockdownUpdateInput
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	actor := current(c)
	state, err := s.setLockdownState(c.Context(), input, "admin", actor.Username)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Actor: actor, Category: "security", Action: map[bool]string{true: "lockdown.enabled", false: "lockdown.disabled"}[input.Enabled], Target: "system", Outcome: "success", Metadata: map[string]any{"expiresAt": state.ExpiresAt, "reason": input.Reason}})
	return c.JSON(state)
}

func (s *server) botLockdownStatus(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "lockdown.status"); err != nil {
		return err
	}
	state, err := s.loadLockdownState(c.Context(), true)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}
	return c.JSON(state)
}

func (s *server) botUpdateLockdown(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "lockdown.manage"); err != nil {
		return err
	}
	var input lockdownUpdateInput
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	actor := c.Get("X-Bot-Actor-Discord-Id")
	state, err := s.setLockdownState(c.Context(), input, "discord", actor)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Category: "security", Action: map[bool]string{true: "lockdown.enabled", false: "lockdown.disabled"}[input.Enabled], Target: "system", Outcome: "success", Metadata: map[string]any{"discordActor": actor, "expiresAt": state.ExpiresAt, "reason": input.Reason}})
	return c.JSON(state)
}

func (s *server) botLockdownAccess(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "lockdown.access"); err != nil {
		return err
	}
	actor := c.Get("X-Bot-Actor-Discord-Id")
	token := randomURLToken(32)
	value, _ := json.Marshal(lockdownAccessTicket{Actor: actor})
	if err := s.redis.Set(c.Context(), lockdownTicketPrefix+tokenHash(token), value, 5*time.Minute).Err(); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}
	return c.JSON(fiber.Map{"url": "https://lock.nove666.pro/t/" + url.PathEscape(token), "expiresIn": 300})
}

func (s *server) consumeLockdownAccessTicket(c *fiber.Ctx) error {
	setLockdownControlHeaders(c)
	ticket := strings.TrimSpace(c.Params("ticket"))
	if len(ticket) < 32 || len(ticket) > 160 {
		return c.Status(400).SendString(controlAccessPageHTML("400", "ลิงก์ไม่ถูกต้อง", "ลิงก์ยืนยันตัวตนไม่ถูกต้องหรือไม่สมบูรณ์ กรุณาตรวจสอบลิงก์อีกครั้ง"))
	}
	value, err := s.redis.GetDel(c.Context(), lockdownTicketPrefix+tokenHash(ticket)).Bytes()
	if err != nil {
		return c.Status(410).SendString(controlAccessPageHTML("410", "ลิงก์หมดอายุแล้ว", "ลิงก์ยืนยันตัวตนนี้หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่"))
	}
	var access lockdownAccessTicket
	if json.Unmarshal(value, &access) != nil || !validDiscordSnowflake(access.Actor) {
		return c.Status(410).SendString(controlAccessPageHTML("410", "ลิงก์หมดอายุแล้ว", "ลิงก์ยืนยันตัวตนนี้หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่"))
	}
	sessionToken := randomURLToken(32)
	csrf := randomURLToken(24)
	sessionValue, _ := json.Marshal(lockdownControlSession{Actor: access.Actor, CSRF: csrf})
	if err := s.redis.Set(c.Context(), lockdownSessionPrefix+tokenHash(sessionToken), sessionValue, 15*time.Minute).Err(); err != nil {
		return fiber.NewError(503)
	}
	c.Cookie(&fiber.Cookie{Name: lockdownControlCookie, Value: sessionToken, Path: "/", MaxAge: 900, Secure: true, HTTPOnly: true, SameSite: fiber.CookieSameSiteStrictMode})
	return c.Redirect("/", fiber.StatusSeeOther)
}

func (s *server) lockdownControlAuth(c *fiber.Ctx) (lockdownControlSession, bool) {
	token := c.Cookies(lockdownControlCookie)
	if token == "" {
		return lockdownControlSession{}, false
	}
	value, err := s.redis.Get(c.Context(), lockdownSessionPrefix+tokenHash(token)).Bytes()
	if err != nil {
		return lockdownControlSession{}, false
	}
	var session lockdownControlSession
	if json.Unmarshal(value, &session) != nil || !validDiscordSnowflake(session.Actor) || session.CSRF == "" {
		return lockdownControlSession{}, false
	}
	return session, true
}

const lockdownControlCSS = `
:root{color-scheme:dark;font-family:"Nexora Thai","Kanit",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#10151f;color:#f0f3f8}
*,*::before,*::after{box-sizing:border-box;font-family:inherit}
body{margin:0;min-height:100vh;min-height:100svh;background:#10151f;color:#f0f3f8;font-family:"Nexora Thai","Kanit",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(117,155,255,.025),transparent 42%)}
.shell{position:relative;width:min(960px,100%);min-height:100vh;min-height:100svh;margin:auto;padding:max(32px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(32px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));display:flex;flex-direction:column;justify-content:center;font-family:inherit}
.topbar{display:flex;align-items:center;color:#929398;font-size:12px;font-family:inherit}.brand{display:inline-flex;align-items:center;color:#f0f3f8;font-weight:700;letter-spacing:.09em;font-family:inherit}.brand-mark{display:none}.host{display:none}
.stage{padding-block:72px;font-family:inherit}.panel{width:min(640px,100%);font-family:inherit}
.symbol{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;color:#ea8588;flex-shrink:0}.symbol svg{width:38px;height:38px}.error-code-wrap{display:inline-flex;align-items:center;gap:16px;margin:0 0 16px}.error-code{margin:0;color:#f08f87;font-size:clamp(64px,15vw,96px);font-weight:650;line-height:1;letter-spacing:-.055em;font-family:inherit;font-feature-settings:"tnum"}.eyebrow{color:#929398;font-size:13px;font-weight:600;font-family:inherit}
h1{margin:0;font-size:clamp(32px,2.6vw,42px);font-weight:650;line-height:1.45;letter-spacing:-.02em;font-family:inherit}p{margin:16px 0 0;color:#acb8cb;line-height:1.8;font-size:15px;font-family:inherit}.lead{max-width:520px;font-family:inherit}
.access-hint{margin-top:14px;color:#929398;font-size:13px;line-height:1.6;font-family:inherit}
.facts{display:grid;gap:0;margin:12px 0 0;font-family:inherit}.fact{padding:11px 0;border-bottom:1px solid #2a2b30;font-family:inherit}.fact:last-child{border-bottom:0}.fact dt{color:#929398;font-size:12px;margin-bottom:4px;font-family:inherit}.fact dd{margin:0;color:#dce3ee;font-size:14px;line-height:1.55;overflow-wrap:anywhere;font-family:inherit}.notice{margin:0 0 18px;color:#8ed8b2;font-size:13px;font-family:inherit}.meta{margin-top:18px;border-top:1px solid #2a2b30;padding-top:14px;font-family:inherit}.meta summary{color:#aeb9cb;font-size:13px;cursor:pointer;list-style:none;font-family:inherit}.meta summary::-webkit-details-marker{display:none}.meta summary:after{content:"+";float:right;color:#759bff}.meta[open] summary:after{content:"−"}
.action{margin-top:28px;font-family:inherit}.action button{min-width:220px;min-height:48px;border:1px solid #d5646b;border-radius:8px;padding:12px 22px;background:#b9434b;color:#fff;font-family:inherit;font-size:14px;font-weight:650;cursor:pointer}.action button:hover{background:#ca5058}.action button:focus-visible{outline:2px solid #f08f87;outline-offset:3px}
button,input,select,textarea{font-family:inherit}
@media(max-width:899px){.stage{padding-block:40px}.error-code{font-size:72px}h1{font-size:clamp(25px,7vw,32px)}}
@media(max-width:360px){.shell{padding-inline:20px}.stage{padding-block:28px}.error-code{font-size:64px}}
@media(max-height:540px){.shell{justify-content:flex-start;padding-block:20px}.stage{padding-block:24px}}
`

func controlPageDocument(title, _ string, body string) string {
	return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#10151f"><title>` + html.EscapeString(title) + ` | NEXORA</title><style>` + lockdownFontFaceCSS + lockdownControlCSS + `</style></head><body><div class="shell"><header class="topbar"><span class="brand">NEXORA</span></header><div class="stage">` + body + `</div></div></body></html>`
}

func controlAccessPageHTML(code, title, detail string) string {
	body := `<main class="panel"><div class="error-code-wrap"><div class="error-code">` + html.EscapeString(code) + `</div><div class="symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/><path d="M12 14v3"/></svg></div></div><h1>` + html.EscapeString(title) + `</h1><p class="lead">` + html.EscapeString(detail) + `</p><p class="access-hint">หากคุณเป็นผู้ดูแลระบบ กรุณาขอรับลิงก์เข้าใช้งานผ่านช่องทางความปลอดภัยที่กำหนด</p></main>`
	return controlPageDocument(title, code, body)
}

func controlSourceLabel(source string) string {
	switch source {
	case "discord":
		return "Discord"
	case "admin":
		return "หลังบ้าน"
	case "control":
		return "หน้าควบคุมฉุกเฉิน"
	case "automatic":
		return "ระบบอัตโนมัติ"
	default:
		return "ยังไม่มีรายการ"
	}
}

func controlPageHTML(state lockdownState, session lockdownControlSession, notice string) string {
	status := "เว็บไซต์เปิดให้บริการ"
	detail := "ขณะนี้ไม่มีการล็อกเว็บไซต์"
	stateLabel := "สถานะปกติ"
	httpCode := "200"
	button := ""
	if state.Enabled {
		status = "เว็บไซต์กำลังถูกล็อก"
		detail = "ระบบจะคงสถานะนี้ไว้จนกว่าผู้ดูแลจะปลดล็อก"
		stateLabel = "กำลังล็อก"
		httpCode = "503"
		if state.ExpiresAt != nil {
			detail = "ระบบจะปลดล็อกอัตโนมัติประมาณ " + state.ExpiresAt.In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("02/01/2006 เวลา 15:04:05 น.")
		}
		button = `<form class="action" method="post" action="/disable"><input type="hidden" name="csrf" value="` + html.EscapeString(session.CSRF) + `"><button type="submit">ปลดล็อกเว็บไซต์</button></form>`
	}
	reason := strings.TrimSpace(state.PrivateReason)
	if reason == "" {
		reason = "ไม่ได้ระบุ"
	}
	noticeHTML := ""
	if strings.TrimSpace(notice) != "" {
		noticeHTML = `<div class="notice" role="status">` + html.EscapeString(notice) + `</div>`
	}
	facts := `<details class="meta"><summary>รายละเอียดการดำเนินการ</summary><dl class="facts"><div class="fact"><dt>ผู้เข้าถึง</dt><dd>` + html.EscapeString(session.Actor) + `</dd></div><div class="fact"><dt>ช่องทางคำสั่ง</dt><dd>` + html.EscapeString(controlSourceLabel(state.Source)) + `</dd></div><div class="fact"><dt>เหตุผลภายใน</dt><dd>` + html.EscapeString(reason) + `</dd></div></dl></details>`
	body := `<main class="panel">` + noticeHTML + `<div class="error-code-wrap"><div class="error-code">` + httpCode + `</div><div class="symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/><path d="M12 14v3"/></svg></div></div><div class="eyebrow">` + html.EscapeString(stateLabel) + `</div><h1>` + html.EscapeString(status) + `</h1><p class="lead">` + html.EscapeString(detail) + `</p>` + button + facts + `</main>`
	return controlPageDocument("ระบบควบคุมฉุกเฉิน", httpCode, body)
}

func setLockdownControlHeaders(c *fiber.Ctx) {
	c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
	c.Set(fiber.HeaderCacheControl, "no-store, private, max-age=0")
	c.Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline' https://static.cloudflareinsights.com; script-src-attr 'none'; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
	c.Set("Referrer-Policy", "no-referrer")
	c.Set("X-Content-Type-Options", "nosniff")
}

func (s *server) lockdownControlPage(c *fiber.Ctx) error {
	setLockdownControlHeaders(c)
	session, ok := s.lockdownControlAuth(c)
	if !ok {
		return c.Status(401).SendString(controlAccessPageHTML("401", "ยังเข้าใช้งานไม่ได้", "หน้านี้ต้องเปิดผ่านลิงก์ยืนยันตัวตนความปลอดภัยที่ได้รับอนุญาตเท่านั้น"))
	}
	state, _ := s.loadLockdownState(c.Context(), true)
	return c.SendString(controlPageHTML(state, session, c.Query("notice")))
}

func (s *server) lockdownControlDisable(c *fiber.Ctx) error {
	setLockdownControlHeaders(c)
	session, ok := s.lockdownControlAuth(c)
	if !ok {
		return c.Status(401).SendString(controlAccessPageHTML("401", "เซสชันหมดอายุ", "กรุณาขอรับลิงก์ยืนยันตัวตนใหม่เพื่อดำเนินการต่อ"))
	}
	if c.FormValue("csrf") == "" || c.FormValue("csrf") != session.CSRF {
		return c.Status(403).SendString(controlAccessPageHTML("403", "ยืนยันคำขอไม่สำเร็จ", "ลิงก์หรือแบบฟอร์มนี้หมดอายุแล้ว กรุณาขอลิงก์ใหม่"))
	}
	state, err := s.setLockdownState(c.Context(), lockdownUpdateInput{Enabled: false}, "control", session.Actor)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Category: "security", Action: "lockdown.disabled", Target: "system", Outcome: "success", Metadata: map[string]any{"discordActor": session.Actor, "source": "control"}})
	_ = state
	return c.Redirect("/?notice=unlocked", fiber.StatusSeeOther)
}

func lockdownDurationLabel(state lockdownState) string {
	if !state.Enabled {
		return "เปิดให้บริการตามปกติ"
	}
	if state.ExpiresAt == nil {
		return "ล็อกถาวร"
	}
	return fmt.Sprintf("ถึง %s", state.ExpiresAt.In(time.FixedZone("Asia/Bangkok", 7*3600)).Format("02/01/2006 15:04:05"))
}
