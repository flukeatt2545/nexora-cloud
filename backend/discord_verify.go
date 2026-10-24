package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

// Verifying on the website. A member clicks the verify button in Discord, the bot asks for a
// one-time link, and the member opens it on the website: they sign in with Discord (so the link
// only works for the account that asked), pass the checks the admin turned on, and the bot gives
// them the member role a few seconds later. The link lives in Redis for ten minutes.

const (
	verifyTicketTTL   = 10 * time.Minute
	verifyMaxAttempts = 5
)

// Cloudflare's siteverify address; a variable so the test can point it at a fake.
var turnstileVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

type verifyTicket struct {
	GuildID  string `json:"guildId"`
	UserID   string `json:"userId"`
	Username string `json:"username"`
	// Set once the member has signed in with Discord and it was the account that asked for the link.
	Identified bool `json:"identified"`
	HasAvatar  bool `json:"hasAvatar"`
	Attempts   int  `json:"attempts"`
}

func verifyTicketKey(token string) string { return "dverify:t:" + tokenHash(token) }

func verifyUserKey(guildID, userID string) string { return "dverify:u:" + guildID + ":" + userID }

func validVerifyToken(token string) bool {
	if len(token) < 20 || len(token) > 64 {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func (s *server) turnstileReady() bool {
	return s.cfg.turnstileSiteKey != "" && s.cfg.turnstileSecret != ""
}

// verifyWebOn: members verify on the website (not with a plain button).
func verifyWebOn(settings communitySettings) bool {
	return settings.VerifyEnabled && settings.VerifyLevel != "button" && settings.MemberRoleID != "" && settings.GuildID != ""
}

// discordSnowflakeTime is when a Discord account (or any object) was made, read from its id.
func discordSnowflakeTime(id string) (time.Time, bool) {
	value, err := strconv.ParseUint(strings.TrimSpace(id), 10, 64)
	if err != nil || value == 0 {
		return time.Time{}, false
	}
	return time.UnixMilli(int64(value>>22) + 1420070400000), true
}

// evaluateVerifyRules applies the admin's account checks. An empty code means the member passes.
func evaluateVerifyRules(settings communitySettings, createdAt time.Time, hasAvatar bool, now time.Time) (code, message string) {
	if settings.VerifyMinAgeDays > 0 {
		need := time.Duration(settings.VerifyMinAgeDays) * 24 * time.Hour
		if age := now.Sub(createdAt); age < need {
			left := int((need-age)/(24*time.Hour)) + 1
			return "account_too_new", fmt.Sprintf("บัญชี Discord ของคุณยังใหม่เกินไป ต้องมีอายุอย่างน้อย %d วัน (อีกประมาณ %d วัน) แล้วกลับมายืนยันใหม่", settings.VerifyMinAgeDays, left)
		}
	}
	if settings.VerifyNeedAvatar && !hasAvatar {
		return "no_avatar", "บัญชี Discord ของคุณยังไม่มีรูปโปรไฟล์ ตั้งรูปโปรไฟล์ก่อนแล้วกดลองใหม่"
	}
	return "", ""
}

// verifyReturnURL opens the server in Discord, at the welcome room when there is one.
func verifyReturnURL(settings communitySettings) string {
	base := "https://discord.com/channels/" + settings.GuildID
	for _, id := range []string{settings.WelcomeChannelID, settings.RolesChannelID} {
		if id != "" {
			return base + "/" + id
		}
	}
	return base
}

func (s *server) loadVerifyTicket(ctx context.Context, token string) (verifyTicket, bool) {
	var ticket verifyTicket
	if !validVerifyToken(token) {
		return ticket, false
	}
	value, err := s.redis.Get(ctx, verifyTicketKey(token)).Bytes()
	if err != nil || json.Unmarshal(value, &ticket) != nil {
		return ticket, false
	}
	return ticket, true
}

// saveVerifyTicket changes a link's data without giving it more time.
func (s *server) saveVerifyTicket(ctx context.Context, token string, ticket verifyTicket) error {
	value, err := json.Marshal(ticket)
	if err != nil {
		return err
	}
	return s.redis.Set(ctx, verifyTicketKey(token), value, redis.KeepTTL).Err()
}

func verifyExpired(c *fiber.Ctx) error {
	return c.Status(fiber.StatusNotFound).JSON(apiError{Error: "ลิงก์นี้หมดอายุแล้ว กลับไปกดปุ่มยืนยันตัวตนใน Discord อีกครั้ง", Code: "verify_expired"})
}

// verifyTurnstile asks Cloudflare whether the captcha answer the browser sent is genuine.
func (s *server) verifyTurnstile(ctx context.Context, answer, ip string) (bool, error) {
	answer = strings.TrimSpace(answer)
	if answer == "" || len(answer) > 2048 {
		return false, nil
	}
	form := url.Values{"secret": {s.cfg.turnstileSecret}, "response": {answer}}
	if ip != "" {
		form.Set("remoteip", ip)
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, turnstileVerifyURL, strings.NewReader(form.Encode()))
	if err != nil {
		return false, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	var result struct {
		Success bool `json:"success"`
	}
	if response.StatusCode >= 300 || json.NewDecoder(io.LimitReader(response.Body, 1<<16)).Decode(&result) != nil {
		return false, fmt.Errorf("turnstile answered badly")
	}
	return result.Success, nil
}

func (s *server) recordVerifyAttempt(ctx context.Context, guildID, userID, username string, ok bool, reason string) {
	if _, err := s.db.Exec(ctx, `
		INSERT INTO discord_community_verify_attempts (guild_id, user_id, username, ok, reason) VALUES ($1,$2,$3,$4,$5)
	`, guildID, userID, cleanText(username, 64), ok, reason); err != nil {
		return
	}
	if ok {
		_, _ = s.db.Exec(ctx, `DELETE FROM discord_community_verify_attempts WHERE created_at < NOW() - INTERVAL '30 days'`)
	}
}

// Bot side

// botCommunityVerifyStart makes the one-time link for a member who clicked the verify button.
func (s *server) botCommunityVerifyStart(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		UserID   string `json:"userId"`
		Username string `json:"username"`
	}
	if c.BodyParser(&input) != nil || !validDiscordSnowflake(input.UserID) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	settings, _, _, err := s.loadCommunitySettings(c.Context())
	if err != nil {
		return err
	}
	if !verifyWebOn(settings) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ยังไม่ได้เปิดการยืนยันตัวตนผ่านเว็บ", Code: "verify_off"})
	}
	if (settings.VerifyCaptcha && !s.turnstileReady()) || !s.oauthConfigured(c.Context(), "discord") {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ ลองบอกทีมงานดูนะ", Code: "verify_not_ready"})
	}
	// A new link replaces the member's earlier one.
	if old, err := s.redis.GetDel(c.Context(), verifyUserKey(settings.GuildID, input.UserID)).Result(); err == nil && old != "" {
		s.redis.Del(c.Context(), "dverify:t:"+old)
	}
	token := randomURLToken(24)
	value, _ := json.Marshal(verifyTicket{GuildID: settings.GuildID, UserID: input.UserID, Username: cleanText(input.Username, 64)})
	if err := s.redis.Set(c.Context(), verifyTicketKey(token), value, verifyTicketTTL).Err(); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}
	s.redis.Set(c.Context(), verifyUserKey(settings.GuildID, input.UserID), tokenHash(token), verifyTicketTTL)
	return c.JSON(fiber.Map{"url": strings.TrimRight(s.cfg.oauthBaseURL, "/") + "/verify/" + token, "expiresIn": int(verifyTicketTTL.Seconds())})
}

// botCommunityVerifyResults: members who passed and are waiting for the member role.
func (s *server) botCommunityVerifyResults(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	rows, err := s.db.Query(c.Context(), `
		SELECT id, user_id, username FROM discord_community_verify_attempts WHERE ok AND NOT handled ORDER BY id LIMIT 20
	`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type item struct {
		ID       int64  `json:"id"`
		UserID   string `json:"userId"`
		Username string `json:"username"`
	}
	items := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.ID, &it.UserID, &it.Username); err != nil {
			return err
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"items": items})
}

func (s *server) botCommunityVerifyAck(c *fiber.Ctx) error {
	if err := s.verifyBotSecret(c); err != nil {
		return err
	}
	var input struct {
		IDs []int64 `json:"ids"`
	}
	if c.BodyParser(&input) != nil || len(input.IDs) > 100 {
		return fiber.NewError(fiber.StatusBadRequest, "ข้อมูลไม่ถูกต้อง")
	}
	if _, err := s.db.Exec(c.Context(), `UPDATE discord_community_verify_attempts SET handled=TRUE WHERE id = ANY($1)`, input.IDs); err != nil {
		return err
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// verifyStats: how many tries passed and failed in the last day, for the admin page.
func (s *server) verifyStats(ctx context.Context) (passed, failed int) {
	_ = s.db.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE ok), COUNT(*) FILTER (WHERE NOT ok)
		FROM discord_community_verify_attempts WHERE created_at > NOW() - INTERVAL '24 hours'
	`).Scan(&passed, &failed)
	return passed, failed
}

// Website side

// communityVerifyInfo tells the verify page what to show for a link.
func (s *server) communityVerifyInfo(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	ticket, ok := s.loadVerifyTicket(c.Context(), c.Params("token"))
	if !ok {
		return verifyExpired(c)
	}
	settings, _, _, err := s.loadCommunitySettings(c.Context())
	if err != nil {
		return err
	}
	if !verifyWebOn(settings) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ตอนนี้ไม่ได้ยืนยันตัวตนผ่านเว็บแล้ว กลับไปกดปุ่มใน Discord", Code: "verify_off"})
	}
	var guildName string
	_ = s.db.QueryRow(c.Context(), `SELECT guild_name FROM discord_community_guilds WHERE guild_id=$1`, ticket.GuildID).Scan(&guildName)
	siteKey := ""
	if settings.VerifyCaptcha {
		siteKey = s.cfg.turnstileSiteKey
	}
	return c.JSON(fiber.Map{
		"guildName": guildName, "username": ticket.Username, "identified": ticket.Identified,
		"captcha": settings.VerifyCaptcha, "siteKey": siteKey, "ready": !settings.VerifyCaptcha || s.turnstileReady(),
		"minAgeDays": settings.VerifyMinAgeDays, "needAvatar": settings.VerifyNeedAvatar,
	})
}

// communityVerifyDiscord sends the member to Discord to sign in (identify only: no email, no servers).
func (s *server) communityVerifyDiscord(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	token := c.Params("token")
	if _, ok := s.loadVerifyTicket(c.Context(), token); !ok {
		return verifyExpired(c)
	}
	if !s.oauthConfigured(c.Context(), "discord") {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ ลองบอกทีมงานดูนะ", Code: "verify_not_ready"})
	}
	state := randomURLToken(32)
	verifier := randomURLToken(48)
	value, _ := json.Marshal(oauthState{Provider: "discord", Mode: "verify", Verifier: verifier, VerifyToken: token})
	if err := s.redis.Set(c.Context(), "oauth:state:"+state, value, 10*time.Minute).Err(); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}
	challenge := pkceChallenge(verifier)
	return c.JSON(fiber.Map{"redirectUrl": s.oauthAuthorizeURLScoped(c.Context(), "discord", state, challenge, "identify")})
}

// communityVerifyCallback is where Discord sends the member back. It only checks that the account
// is the one that asked for the link; the checks and the role come when the member finishes.
func (s *server) communityVerifyCallback(c *fiber.Ctx, state oauthState, code string) error {
	page := "/verify/" + state.VerifyToken
	ticket, ok := s.loadVerifyTicket(c.Context(), state.VerifyToken)
	if !ok {
		return c.Redirect(page, fiber.StatusFound)
	}
	identity, err := s.exchangeOAuth(c.Context(), "discord", code, state.Verifier)
	if err != nil {
		return c.Redirect(page+"?e=oauth", fiber.StatusFound)
	}
	if identity.ID != ticket.UserID {
		return c.Redirect(page+"?e=wrong_account", fiber.StatusFound)
	}
	ticket.Identified = true
	ticket.HasAvatar = identity.AvatarURL != ""
	if name := cleanText(firstNonEmpty(identity.DisplayName, identity.Username), 64); name != "" {
		ticket.Username = name
	}
	if err := s.saveVerifyTicket(c.Context(), state.VerifyToken, ticket); err != nil {
		return c.Redirect(page+"?e=oauth", fiber.StatusFound)
	}
	return c.Redirect(page, fiber.StatusFound)
}

// communityVerifyComplete runs the checks and, when they pass, queues the member role for the bot.
func (s *server) communityVerifyComplete(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	token := c.Params("token")
	ticket, ok := s.loadVerifyTicket(c.Context(), token)
	if !ok {
		return verifyExpired(c)
	}
	if !ticket.Identified {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ต้องเข้าสู่ระบบด้วย Discord ก่อน", Code: "verify_login_needed"})
	}
	var body struct {
		Captcha string `json:"captcha"`
	}
	if c.BodyParser(&body) != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	settings, _, _, err := s.loadCommunitySettings(c.Context())
	if err != nil {
		return err
	}
	if !verifyWebOn(settings) {
		return c.Status(fiber.StatusConflict).JSON(apiError{Error: "ตอนนี้ไม่ได้ยืนยันตัวตนผ่านเว็บแล้ว กลับไปกดปุ่มใน Discord", Code: "verify_off"})
	}

	createdAt, _ := discordSnowflakeTime(ticket.UserID)
	if code, message := evaluateVerifyRules(settings, createdAt, ticket.HasAvatar, time.Now()); code != "" {
		s.recordVerifyAttempt(c.Context(), ticket.GuildID, ticket.UserID, ticket.Username, false, code)
		return c.Status(fiber.StatusUnprocessableEntity).JSON(apiError{Error: message, Code: code})
	}

	if settings.VerifyCaptcha {
		if !s.turnstileReady() {
			return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ ลองบอกทีมงานดูนะ", Code: "verify_not_ready"})
		}
		passed, err := s.verifyTurnstile(c.Context(), body.Captcha, extractRealIP(c))
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(apiError{Error: "ติดต่อระบบ captcha ไม่ได้ ลองใหม่อีกครั้ง", Code: "captcha_unavailable"})
		}
		if !passed {
			ticket.Attempts++
			if ticket.Attempts >= verifyMaxAttempts {
				s.redis.Del(c.Context(), verifyTicketKey(token), verifyUserKey(ticket.GuildID, ticket.UserID))
				s.recordVerifyAttempt(c.Context(), ticket.GuildID, ticket.UserID, ticket.Username, false, "captcha_locked")
				return c.Status(fiber.StatusTooManyRequests).JSON(apiError{Error: "ลองผิดหลายครั้งเกินไป กลับไปกดปุ่มยืนยันตัวตนใน Discord เพื่อขอลิงก์ใหม่", Code: "verify_locked"})
			}
			_ = s.saveVerifyTicket(c.Context(), token, ticket)
			s.recordVerifyAttempt(c.Context(), ticket.GuildID, ticket.UserID, ticket.Username, false, "captcha_failed")
			return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ยืนยันว่าเป็นคนไม่สำเร็จ ลองอีกครั้ง", Code: "captcha_failed"})
		}
	}

	// Whoever deletes the link first wins, so a double click cannot pass twice.
	if removed, err := s.redis.Del(c.Context(), verifyTicketKey(token)).Result(); err != nil || removed == 0 {
		return verifyExpired(c)
	}
	s.redis.Del(c.Context(), verifyUserKey(ticket.GuildID, ticket.UserID))
	s.recordVerifyAttempt(c.Context(), ticket.GuildID, ticket.UserID, ticket.Username, true, "")
	return c.JSON(fiber.Map{"ok": true, "returnUrl": verifyReturnURL(settings)})
}
