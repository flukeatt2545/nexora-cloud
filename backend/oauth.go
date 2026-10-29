package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

type oauthProviderConfig struct {
	ClientID     string
	ClientSecret string
}

type oauthState struct {
	Provider  string `json:"provider"`
	Verifier  string `json:"verifier"`
	UserID    int64  `json:"userId,omitempty"`
	SessionID int64  `json:"sessionId,omitempty"`
	Mode      string `json:"mode"`
	// Set when the member came from the Discord server's verify page (mode "verify").
	VerifyToken string `json:"verifyToken,omitempty"`
	// Hash of the nonce held in the browser that started the flow; the callback must present it.
	Binding string `json:"binding,omitempty"`
}

const oauthBindingCookie = "nexora_oauth_bind"

// bindOAuthState ties the state to the browser that is about to be sent to the provider. Without
// this, someone could start a flow, sign in at the provider with their own account and hand the
// callback link to a victim, whose browser would then finish the flow (login/connect CSRF).
func (s *server) bindOAuthState(c *fiber.Ctx, data *oauthState) {
	nonce := randomURLToken(32)
	data.Binding = tokenHash(nonce)
	c.Cookie(&fiber.Cookie{
		Name:     oauthBindingCookie,
		Value:    nonce,
		Path:     "/api/auth/oauth/",
		MaxAge:   600,
		HTTPOnly: true,
		Secure:   s.cfg.cookieSecure,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

func (s *server) clearOAuthBinding(c *fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     oauthBindingCookie,
		Value:    "",
		Path:     "/api/auth/oauth/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HTTPOnly: true,
		Secure:   s.cfg.cookieSecure,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

func oauthBindingMatches(data oauthState, nonce string) bool {
	if data.Binding == "" || nonce == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(tokenHash(nonce)), []byte(data.Binding)) == 1
}

type oauthIdentity struct {
	ID          string
	Username    string
	DisplayName string
	Email       string
	AvatarURL   string
}

type oauthLaunchTicket struct {
	Provider  string `json:"provider"`
	Mode      string `json:"mode"`
	UserID    int64  `json:"userId,omitempty"`
	SessionID int64  `json:"sessionId,omitempty"`
}

type oauthTicketRequest struct {
	Provider string `json:"provider"`
	Mode     string `json:"mode"`
}

type oauthTicketConsumeRequest struct {
	Ticket string `json:"ticket"`
}

func (s *server) oauthProvider(ctx context.Context, provider string) oauthProviderConfig {
	fallback := s.cfg.oauth[provider]
	var clientID, ciphertext string
	err := s.db.QueryRow(ctx, `
		SELECT client_id, client_secret_ciphertext
		FROM oauth_provider_settings WHERE provider=$1
	`, provider).Scan(&clientID, &ciphertext)
	if err != nil || strings.TrimSpace(clientID) == "" || ciphertext == "" {
		return fallback
	}
	secret, err := decryptSecret(ciphertext, s.cfg.webhookKey)
	if err != nil || secret == "" {
		return fallback
	}
	return oauthProviderConfig{ClientID: strings.TrimSpace(clientID), ClientSecret: secret}
}

func (s *server) oauthConfigured(ctx context.Context, provider string) bool {
	cfg := s.oauthProvider(ctx, provider)
	return cfg.ClientID != "" && cfg.ClientSecret != ""
}

func (s *server) oauthEnabled(ctx *fiber.Ctx, provider string) bool {
	settings, err := s.loadSettings(ctx.Context())
	if err != nil || !s.oauthConfigured(ctx.Context(), provider) {
		return false
	}
	switch provider {
	case "discord":
		return settings.DiscordEnabled
	case "google":
		return settings.GoogleEnabled
	case "github":
		return settings.GitHubEnabled
	default:
		return false
	}
}

func validOAuthProvider(provider string) bool {
	switch provider {
	case "discord", "google", "github":
		return true
	default:
		return false
	}
}

func oauthLaunchKey(ticket string) string {
	return "oauth:launch:" + tokenHash(ticket)
}

func (s *server) issueOAuthTicket(c *fiber.Ctx) error {
	var body oauthTicketRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_request"})
	}
	body.Provider = strings.ToLower(strings.TrimSpace(body.Provider))
	body.Mode = normalizeOAuthMode(body.Mode)
	if !validOAuthProvider(body.Provider) {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ไม่รองรับบริการนี้", Code: "invalid_provider"})
	}

	launch := oauthLaunchTicket{Provider: body.Provider, Mode: body.Mode}
	if body.Mode == "connect" {
		user, err := s.authenticate(c)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if user == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "กรุณาเข้าสู่ระบบอีกครั้ง", Code: "unauthenticated"})
		}
		if !user.PasswordEnabled {
			return c.Status(fiber.StatusPreconditionRequired).JSON(apiError{Error: "กรุณาตั้งรหัสผ่านก่อนใช้งาน", Code: "password_setup_required"})
		}
		launch.UserID = user.ID
		launch.SessionID = user.SessionID
	}

	value, err := json.Marshal(launch)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	ticket := randomURLToken(24)
	if err := s.redis.Set(c.Context(), oauthLaunchKey(ticket), value, 5*time.Minute).Err(); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{"path": "/c/" + ticket, "expiresIn": 300})
}

func (s *server) consumeOAuthTicket(c *fiber.Ctx) error {
	var body oauthTicketConsumeRequest
	if err := c.BodyParser(&body); err != nil || len(body.Ticket) < 24 || len(body.Ticket) > 128 {
		return c.Status(fiber.StatusBadRequest).JSON(apiError{Error: "ลิงก์ไม่ถูกต้อง", Code: "invalid_ticket"})
	}
	value, err := s.redis.GetDel(c.Context(), oauthLaunchKey(body.Ticket)).Bytes()
	if err != nil {
		return s.consumeWorkspaceTicketWithTicket(c, body.Ticket)
	}
	var launch oauthLaunchTicket
	if json.Unmarshal(value, &launch) != nil || !validOAuthProvider(launch.Provider) {
		return c.Status(fiber.StatusGone).JSON(apiError{Error: "ลิงก์นี้หมดอายุแล้ว", Code: "ticket_expired"})
	}

	if launch.Mode == "connect" {
		user, authErr := s.authenticate(c)
		if authErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		if user == nil || user.ID != launch.UserID || user.SessionID != launch.SessionID {
			return c.Status(fiber.StatusUnauthorized).JSON(apiError{Error: "กรุณาเข้าสู่ระบบอีกครั้ง", Code: "unauthenticated"})
		}
	}
	if !s.oauthEnabled(c, launch.Provider) {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error":    "บริการเชื่อมต่อบัญชียังไม่พร้อม",
			"code":     "provider_unavailable",
			"provider": launch.Provider,
			"mode":     launch.Mode,
		})
	}

	stateData := oauthState{Provider: launch.Provider, Mode: launch.Mode, UserID: launch.UserID, SessionID: launch.SessionID}
	state := randomURLToken(32)
	stateData.Verifier = randomURLToken(48)
	s.bindOAuthState(c, &stateData)
	stateValue, _ := json.Marshal(stateData)
	if err := s.redis.Set(c.Context(), "oauth:state:"+state, stateValue, 10*time.Minute).Err(); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}
	challengeBytes := sha256.Sum256([]byte(stateData.Verifier))
	challenge := base64.RawURLEncoding.EncodeToString(challengeBytes[:])
	c.Set(fiber.HeaderCacheControl, "no-store")
	return c.JSON(fiber.Map{"redirectUrl": s.oauthAuthorizeURL(c.Context(), launch.Provider, state, challenge)})
}

func normalizeOAuthMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "connect", "register":
		return strings.ToLower(strings.TrimSpace(mode))
	default:
		return "login"
	}
}

func (s *server) oauthAuthorizeURL(ctx context.Context, provider, state, challenge string) string {
	return s.oauthAuthorizeURLScoped(ctx, provider, state, challenge, "")
}

// oauthAuthorizeURLScoped asks for the given scope instead of the provider's usual one.
func (s *server) oauthAuthorizeURLScoped(ctx context.Context, provider, state, challenge, scope string) string {
	cfg := s.oauthProvider(ctx, provider)
	redirectURI := s.cfg.oauthBaseURL + "/api/auth/oauth/" + provider + "/callback"
	values := url.Values{
		"client_id":             {cfg.ClientID},
		"redirect_uri":          {redirectURI},
		"response_type":         {"code"},
		"state":                 {state},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	switch provider {
	case "discord":
		if scope == "" {
			scope = "identify email"
		}
		values.Set("scope", scope)
		return "https://discord.com/oauth2/authorize?" + values.Encode()
	case "google":
		values.Set("scope", "openid email profile")
		values.Set("access_type", "online")
		return "https://accounts.google.com/o/oauth2/v2/auth?" + values.Encode()
	default:
		values.Set("scope", "read:user user:email")
		return "https://github.com/login/oauth/authorize?" + values.Encode()
	}
}

func (s *server) oauthCallback(c *fiber.Ctx) error {
	provider := strings.ToLower(c.Params("provider"))
	state := c.Query("state")
	code := c.Query("code")
	if state == "" || code == "" {
		return c.Redirect(oauthErrorLocation("oauth_cancelled", provider), fiber.StatusFound)
	}
	value, err := s.redis.GetDel(c.Context(), "oauth:state:"+state).Bytes()
	nonce := c.Cookies(oauthBindingCookie)
	s.clearOAuthBinding(c)
	if err != nil {
		return c.Redirect(oauthErrorLocation("oauth_state", provider), fiber.StatusFound)
	}
	var stateData oauthState
	if json.Unmarshal(value, &stateData) != nil || stateData.Provider != provider || !oauthBindingMatches(stateData, nonce) {
		return c.Redirect(oauthErrorLocation("oauth_state", provider), fiber.StatusFound)
	}
	if stateData.Mode == "verify" {
		return s.communityVerifyCallback(c, stateData, code)
	}
	if stateData.Mode == "connect" {
		var sessionActive bool
		if stateData.UserID <= 0 || stateData.SessionID <= 0 || s.db.QueryRow(c.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM user_sessions
				WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at > NOW()
			)
		`, stateData.SessionID, stateData.UserID).Scan(&sessionActive) != nil || !sessionActive {
			return c.Redirect(oauthErrorLocation("oauth_state", provider), fiber.StatusFound)
		}
	}
	identity, err := s.exchangeOAuth(c.Context(), provider, code, stateData.Verifier)
	if err != nil {
		s.audit(c, auditEvent{Category: "auth", Action: "auth.oauth", Outcome: "failure", Metadata: map[string]any{"provider": provider}})
		return c.Redirect(oauthErrorLocation("oauth_exchange", provider), fiber.StatusFound)
	}
	if stateData.Mode == "connect" && stateData.UserID > 0 {
		return s.connectOAuthIdentity(c, stateData.UserID, provider, identity)
	}
	return s.loginOAuthIdentity(c, provider, identity)
}

func (s *server) connectOAuthIdentity(c *fiber.Ctx, userID int64, provider string, identity oauthIdentity) error {
	tx, err := s.db.Begin(c.Context())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	defer tx.Rollback(c.Context())
	if _, err := tx.Exec(c.Context(), `SELECT pg_advisory_xact_lock($1)`, userID); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	var currentProviderUserID string
	var disconnectScheduledFor *time.Time
	accountErr := tx.QueryRow(c.Context(), `
		SELECT provider_user_id, disconnect_scheduled_for
		FROM oauth_accounts WHERE user_id=$1 AND provider=$2 FOR UPDATE
	`, userID, provider).Scan(&currentProviderUserID, &disconnectScheduledFor)
	if accountErr != nil && !errors.Is(accountErr, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if accountErr == nil && currentProviderUserID == identity.ID {
		if disconnectScheduledFor != nil {
			if _, err := tx.Exec(c.Context(), `
				UPDATE oauth_accounts SET disconnect_requested_at=NULL, disconnect_scheduled_for=NULL, updated_at=NOW()
				WHERE user_id=$1 AND provider=$2
			`, userID, provider); err != nil {
				return fiber.NewError(fiber.StatusInternalServerError)
			}
			if _, err := tx.Exec(c.Context(), `INSERT INTO oauth_account_events (user_id, provider, action) VALUES ($1,$2,'disconnect_cancelled')`, userID, provider); err != nil {
				return fiber.NewError(fiber.StatusInternalServerError)
			}
		}
		if err := tx.Commit(c.Context()); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		return c.Redirect(socialProfileLocation("connected", provider, nil), fiber.StatusFound)
	}

	var ownerID int64
	ownerErr := tx.QueryRow(c.Context(), `
		SELECT user_id FROM oauth_accounts
		WHERE provider=$1 AND provider_user_id=$2 FOR UPDATE
	`, provider, identity.ID).Scan(&ownerID)
	if ownerErr == nil && ownerID != userID {
		return c.Redirect(socialProfileErrorLocation("social_already_connected", provider, nil), fiber.StatusFound)
	}
	if ownerErr != nil && !errors.Is(ownerErr, pgx.ErrNoRows) {
		return fiber.NewError(fiber.StatusInternalServerError)
	}

	policy, err := loadSocialConnectPolicy(c.Context(), tx, userID, time.Now())
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if !policy.CanConnect {
		return c.Redirect(socialProfileErrorLocation(policy.Code, provider, policy.AvailableAt), fiber.StatusFound)
	}

	if _, err := tx.Exec(c.Context(), `
		INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email)
		VALUES ($1,$2,$3,NULLIF($4,''))
		ON CONFLICT (user_id, provider) DO UPDATE SET
		  provider_user_id=EXCLUDED.provider_user_id,
		  provider_email=EXCLUDED.provider_email,
		  disconnect_requested_at=NULL,
		  disconnect_scheduled_for=NULL,
		  updated_at=NOW()
	`, userID, provider, identity.ID, identity.Email); err != nil {
		return c.Redirect(socialProfileErrorLocation("social_already_connected", provider, nil), fiber.StatusFound)
	}
	if _, err := tx.Exec(c.Context(), `INSERT INTO oauth_account_events (user_id, provider, action) VALUES ($1,$2,'connected')`, userID, provider); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	if err := tx.Commit(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	var user currentUser
	if s.db.QueryRow(c.Context(), `SELECT id, identifier, display_name, COALESCE(email,''), COALESCE(avatar_url,''), role, status, password_enabled, points FROM users WHERE id=$1`, userID).
		Scan(&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.PasswordEnabled, &user.Points) == nil {
		s.audit(c, auditEvent{Actor: &user, Category: "security", Action: "social.connected", Target: "oauth", TargetID: provider})
	}
	return c.Redirect(socialProfileLocation("connected", provider, nil), fiber.StatusFound)
}

func (s *server) loginOAuthIdentity(c *fiber.Ctx, provider string, identity oauthIdentity) error {
	if err := s.finalizeOAuthDisconnects(c.Context()); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	var user currentUser
	err := s.db.QueryRow(c.Context(), `
		SELECT u.id, u.identifier, u.display_name, COALESCE(u.email,''), COALESCE(u.avatar_url,''), u.role, u.status, u.password_enabled, u.points
		FROM oauth_accounts o JOIN users u ON u.id=o.user_id
		WHERE o.provider=$1 AND o.provider_user_id=$2
		  AND (o.disconnect_scheduled_for IS NULL OR o.disconnect_scheduled_for > NOW())
	`, provider, identity.ID).Scan(&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.PasswordEnabled, &user.Points)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.audit(c, auditEvent{Category: "auth", Action: "auth.oauth", Outcome: "failure", Metadata: map[string]any{"provider": provider, "reason": "account_lookup"}})
		return c.Redirect(oauthErrorLocation("account_create", provider), fiber.StatusFound)
	}
	if err != nil {
		settings, settingsErr := s.loadSettings(c.Context())
		if settingsErr != nil {
			s.audit(c, auditEvent{Category: "auth", Action: "auth.oauth", Outcome: "failure", Metadata: map[string]any{"provider": provider, "reason": "settings_lookup"}})
			return c.Redirect(oauthErrorLocation("account_create", provider), fiber.StatusFound)
		}
		if !settings.RegistrationEnabled {
			s.audit(c, auditEvent{Category: "auth", Action: "auth.oauth", Outcome: "failure", Metadata: map[string]any{"provider": provider, "reason": "registration_disabled"}})
			return c.Redirect(oauthErrorLocation("registration_disabled", provider), fiber.StatusFound)
		}
		if identity.Email != "" {
			var existingUserID int64
			emailErr := s.db.QueryRow(c.Context(), `SELECT id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`, identity.Email).Scan(&existingUserID)
			if emailErr == nil {
				s.audit(c, auditEvent{Category: "auth", Action: "auth.oauth", Target: "user", TargetID: strconv.FormatInt(existingUserID, 10), Outcome: "failure", Metadata: map[string]any{"provider": provider, "reason": "account_link_required"}})
				return c.Redirect(oauthErrorLocation("account_link_required", provider), fiber.StatusFound)
			}
			if !errors.Is(emailErr, pgx.ErrNoRows) {
				s.audit(c, auditEvent{Category: "auth", Action: "auth.oauth", Outcome: "failure", Metadata: map[string]any{"provider": provider, "reason": "email_lookup"}})
				return c.Redirect(oauthErrorLocation("account_create", provider), fiber.StatusFound)
			}
		}
		username, usernameErr := s.uniqueOAuthUsername(c, identity.Username)
		if usernameErr != nil {
			return c.Redirect(oauthErrorLocation("account_create", provider), fiber.StatusFound)
		}
		randomPassword := randomURLToken(48)
		hash, _ := s.hashPassword(randomPassword)
		// try to fetch remote avatar and store in our object storage
		avatarURL := ""
		if identity.AvatarURL != "" {
			if u, err := s.fetchAndStoreAvatar(c.Context(), identity.AvatarURL, 2*1024*1024); err == nil && u != "" {
				avatarURL = u
			} else {
				// fallback to external URL if storing failed
				avatarURL = identity.AvatarURL
			}
		}
		tx, txErr := s.db.Begin(c.Context())
		if txErr != nil {
			return fiber.NewError(fiber.StatusInternalServerError)
		}
		defer tx.Rollback(c.Context())
		err = tx.QueryRow(c.Context(), `
				INSERT INTO users (identifier, password_hash, password_enabled, display_name, email, avatar_url)
				VALUES ($1,$2,FALSE,$3,NULLIF($4,''),NULLIF($5,''))
				RETURNING id, identifier, display_name, COALESCE(email,''), COALESCE(avatar_url,''), role, status, password_enabled, points
			`, username, hash, cleanText(identity.DisplayName, 80), identity.Email, avatarURL).
			Scan(&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.AvatarURL, &user.Role, &user.Status, &user.PasswordEnabled, &user.Points)
		if err == nil {
			_, err = tx.Exec(c.Context(), `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email) VALUES ($1,$2,$3,NULLIF($4,''))`, user.ID, provider, identity.ID, identity.Email)
		}
		if err == nil {
			_, err = tx.Exec(c.Context(), `INSERT INTO oauth_account_events (user_id, provider, action) VALUES ($1,$2,'connected')`, user.ID, provider)
		}
		if err != nil || tx.Commit(c.Context()) != nil {
			s.audit(c, auditEvent{Category: "auth", Action: "auth.oauth", Outcome: "failure", Metadata: map[string]any{"provider": provider, "reason": "account_create"}})
			return c.Redirect(oauthErrorLocation("account_create", provider), fiber.StatusFound)
		}
	}
	if user.Status != "active" {
		s.audit(c, auditEvent{Actor: &user, Category: "auth", Action: "auth.oauth", Outcome: "failure", Metadata: map[string]any{"provider": provider, "reason": "account_suspended"}})
		return c.Redirect(oauthErrorLocation("account_suspended", provider), fiber.StatusFound)
	}
	user.Permissions = permissionsForRole(user.Role)
	if err := s.createSession(c, &user); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError)
	}
	s.db.Exec(c.Context(), `UPDATE users SET last_login_at=NOW() WHERE id=$1`, user.ID)
	s.audit(c, auditEvent{Actor: &user, Category: "auth", Action: "auth.oauth", Target: "oauth", TargetID: provider, Metadata: map[string]any{"provider": provider}})
	if !user.PasswordEnabled {
		return c.Redirect("/profile?password_setup=required", fiber.StatusFound)
	}
	if user.Role == "admin" || user.Role == "superadmin" {
		return c.Redirect("/admin", fiber.StatusFound)
	}
	return c.Redirect("/dashboard", fiber.StatusFound)
}

func oauthErrorLocation(code, provider string) string {
	values := url.Values{"auth_error": {code}}
	if validOAuthProvider(provider) {
		values.Set("provider", provider)
	}
	return "/?" + values.Encode()
}

func socialProfileLocation(result, provider string, availableAt *time.Time) string {
	values := url.Values{"social": {result}}
	if validOAuthProvider(provider) {
		values.Set("provider", provider)
	}
	if availableAt != nil {
		values.Set("retry_at", availableAt.UTC().Format(time.RFC3339))
	}
	return "/profile?" + values.Encode()
}

func socialProfileErrorLocation(code, provider string, availableAt *time.Time) string {
	values := url.Values{"social_error": {code}}
	if validOAuthProvider(provider) {
		values.Set("provider", provider)
	}
	if availableAt != nil {
		values.Set("retry_at", availableAt.UTC().Format(time.RFC3339))
	}
	return "/profile?" + values.Encode()
}

func (s *server) uniqueOAuthUsername(c *fiber.Ctx, source string) (string, error) {
	var builder strings.Builder
	for _, char := range source {
		if char >= 'A' && char <= 'Z' || char >= 'a' && char <= 'z' || char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	base := builder.String()
	if len(base) < 4 {
		base = "user"
	}
	if len(base) > 22 {
		base = base[:22]
	}
	for attempt := 0; attempt < 20; attempt++ {
		candidate := base + hex.EncodeToString([]byte{byte(attempt)}) + randomHex(2)
		var exists bool
		if err := s.db.QueryRow(c.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(identifier)=LOWER($1))`, candidate).Scan(&exists); err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("unable to allocate username")
}

func (s *server) exchangeOAuth(ctx context.Context, provider, code, verifier string) (oauthIdentity, error) {
	cfg := s.oauthProvider(ctx, provider)
	redirectURI := s.cfg.oauthBaseURL + "/api/auth/oauth/" + provider + "/callback"
	values := url.Values{
		"client_id":     {cfg.ClientID},
		"client_secret": {cfg.ClientSecret},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"code_verifier": {verifier},
		"grant_type":    {"authorization_code"},
	}
	tokenURL := map[string]string{
		"discord": "https://discord.com/api/oauth2/token",
		"google":  "https://oauth2.googleapis.com/token",
		"github":  "https://github.com/login/oauth/access_token",
	}[provider]
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(values.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return oauthIdentity{}, err
	}
	defer response.Body.Close()
	var tokenBody struct {
		AccessToken string `json:"access_token"`
	}
	if response.StatusCode >= 300 || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&tokenBody) != nil || tokenBody.AccessToken == "" {
		return oauthIdentity{}, fmt.Errorf("token exchange failed")
	}
	return fetchOAuthIdentity(ctx, provider, tokenBody.AccessToken)
}

func fetchOAuthIdentity(ctx context.Context, provider, token string) (oauthIdentity, error) {
	endpoint := map[string]string{
		"discord": "https://discord.com/api/users/@me",
		"google":  "https://openidconnect.googleapis.com/v1/userinfo",
		"github":  "https://api.github.com/user",
	}[provider]
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "NEXORA-CLOUD")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return oauthIdentity{}, err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		return oauthIdentity{}, fmt.Errorf("profile request failed")
	}
	var raw map[string]any
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&raw) != nil {
		return oauthIdentity{}, fmt.Errorf("invalid profile")
	}
	identity := oauthIdentity{
		ID:          stringValue(raw["id"]),
		Username:    stringValue(raw["username"]),
		DisplayName: stringValue(raw["global_name"]),
		Email:       stringValue(raw["email"]),
		AvatarURL:   stringValue(raw["picture"]),
	}
	if provider == "google" {
		identity.ID = stringValue(raw["sub"])
		identity.Username = strings.Split(identity.Email, "@")[0]
		identity.DisplayName = stringValue(raw["name"])
	}
	if provider == "github" {
		identity.Username = stringValue(raw["login"])
		identity.DisplayName = stringValue(raw["name"])
		identity.AvatarURL = stringValue(raw["avatar_url"])
	}
	if provider == "discord" && identity.AvatarURL == "" {
		avatar := stringValue(raw["avatar"])
		if avatar != "" {
			identity.AvatarURL = "https://cdn.discordapp.com/avatars/" + identity.ID + "/" + avatar + ".png"
		}
	}
	if identity.ID == "" {
		return oauthIdentity{}, fmt.Errorf("missing identity")
	}
	return identity, nil
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	default:
		return ""
	}
}

func randomURLToken(size int) string {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		return randomHex(size)
	}
	return base64.RawURLEncoding.EncodeToString(data)
}

func randomHex(size int) string {
	data := make([]byte, size)
	_, _ = rand.Read(data)
	return hex.EncodeToString(data)
}
