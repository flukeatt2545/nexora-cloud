package main

import (
	"context"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Site offline cuts the connection to the main site and every hosted site, while the API, the
// bots, the database portal and mail keep working. Caddy asks siteOfflineGate on each request
// and aborts the connection when it answers 423. Unlike lockdown, nothing is shown to visitors.

const siteOfflineCacheFor = 2 * time.Second

type siteOfflineState struct {
	Enabled       bool       `json:"enabled"`
	StartedAt     *time.Time `json:"startedAt,omitempty"`
	ExpiresAt     *time.Time `json:"expiresAt,omitempty"`
	PrivateReason string     `json:"privateReason,omitempty"`
	Source        string     `json:"source,omitempty"`
	Actor         string     `json:"actor,omitempty"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

func (s *server) rememberSiteOffline(state siteOfflineState) {
	s.siteOfflineMu.Lock()
	s.siteOfflineLast = state
	s.siteOfflineKnown = true
	s.siteOfflineCheckedAt = time.Now()
	s.siteOfflineMu.Unlock()
}

func (s *server) cachedSiteOffline() (siteOfflineState, bool) {
	s.siteOfflineMu.RLock()
	defer s.siteOfflineMu.RUnlock()
	fresh := s.siteOfflineKnown && time.Since(s.siteOfflineCheckedAt) < siteOfflineCacheFor
	return s.siteOfflineLast, fresh
}

func (s *server) loadSiteOfflineState(ctx context.Context, force bool) (siteOfflineState, error) {
	if !force {
		if state, fresh := s.cachedSiteOffline(); fresh {
			if !siteOfflineExpired(state, time.Now()) {
				return state, nil
			}
		}
	}
	state := siteOfflineState{}
	err := s.db.QueryRow(ctx, `
		SELECT enabled, started_at, expires_at, private_reason, source, actor, updated_at
		FROM system_site_offline_state WHERE singleton=TRUE
	`).Scan(&state.Enabled, &state.StartedAt, &state.ExpiresAt, &state.PrivateReason, &state.Source, &state.Actor, &state.UpdatedAt)
	if err != nil {
		// Keep the last known state, so a database hiccup neither opens nor closes the sites.
		s.siteOfflineMu.RLock()
		previous, known := s.siteOfflineLast, s.siteOfflineKnown
		s.siteOfflineMu.RUnlock()
		if known {
			return previous, err
		}
		return siteOfflineState{UpdatedAt: time.Now()}, err
	}
	if siteOfflineExpired(state, time.Now()) {
		return s.expireSiteOffline(ctx, state)
	}
	s.rememberSiteOffline(state)
	return state, nil
}

func siteOfflineExpired(state siteOfflineState, now time.Time) bool {
	return state.Enabled && state.ExpiresAt != nil && !state.ExpiresAt.After(now)
}

func (s *server) expireSiteOffline(ctx context.Context, state siteOfflineState) (siteOfflineState, error) {
	now := time.Now()
	result, err := s.db.Exec(ctx, `
		UPDATE system_site_offline_state
		SET enabled=FALSE, private_reason='', source='automatic', actor='system', updated_at=$1
		WHERE singleton=TRUE AND enabled=TRUE AND expires_at IS NOT NULL AND expires_at <= $1
	`, now)
	if err != nil {
		return state, err
	}
	if result.RowsAffected() > 0 {
		_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs (actor_username,actor_role,category,action,target_type,outcome,metadata) VALUES ('system','system','security','site_offline.expired','system','success','{}'::jsonb)`)
	}
	state.Enabled = false
	state.PrivateReason = ""
	state.Source = "automatic"
	state.Actor = "system"
	state.UpdatedAt = now
	s.rememberSiteOffline(state)
	return state, nil
}

func (s *server) setSiteOfflineState(ctx context.Context, input lockdownUpdateInput, source, actor string) (siteOfflineState, error) {
	if err := validateLockdownInput(&input); err != nil {
		return siteOfflineState{}, err
	}
	now := time.Now()
	state := siteOfflineState{Enabled: input.Enabled, PrivateReason: input.Reason, Source: cleanText(source, 40), Actor: cleanText(actor, 100), UpdatedAt: now}
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
		UPDATE system_site_offline_state SET enabled=$1, started_at=$2, expires_at=$3,
		private_reason=$4, source=$5, actor=$6, updated_at=$7 WHERE singleton=TRUE
	`, state.Enabled, state.StartedAt, state.ExpiresAt, state.PrivateReason, state.Source, state.Actor, state.UpdatedAt)
	if err != nil {
		return siteOfflineState{}, err
	}
	s.rememberSiteOffline(state)
	return state, nil
}

func (s *server) siteOfflineGate(c *fiber.Ctx) error {
	state, err := s.loadSiteOfflineState(c.Context(), false)
	if err != nil {
		log.Printf("[WARN] Site offline gate used last known state: %v", err)
	}
	c.Set(fiber.HeaderCacheControl, "no-store")
	if state.Enabled {
		return c.SendStatus(fiber.StatusLocked)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (s *server) botSiteOfflineStatus(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "lockdown.status"); err != nil {
		return err
	}
	state, err := s.loadSiteOfflineState(c.Context(), true)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable)
	}
	return c.JSON(state)
}

func (s *server) botUpdateSiteOffline(c *fiber.Ctx) error {
	if err := s.requireBotScope(c, "lockdown.manage"); err != nil {
		return err
	}
	var input lockdownUpdateInput
	if c.BodyParser(&input) != nil {
		return c.Status(400).JSON(apiError{Error: "ข้อมูลไม่ถูกต้อง", Code: "invalid_body"})
	}
	actor := c.Get("X-Bot-Actor-Discord-Id")
	state, err := s.setSiteOfflineState(c.Context(), input, "discord", actor)
	if err != nil {
		return err
	}
	s.audit(c, auditEvent{Category: "security", Action: map[bool]string{true: "site_offline.enabled", false: "site_offline.disabled"}[input.Enabled], Target: "system", Outcome: "success", Metadata: map[string]any{"discordActor": actor, "expiresAt": state.ExpiresAt, "reason": input.Reason}})
	return c.JSON(state)
}

// Caddy calls these gates through forward_auth, which always adds X-Forwarded-For.
func isEdgeGatePath(path string) bool {
	return path == "/api/internal/lockdown/gate" || path == "/api/internal/site-offline/gate"
}
