package main

import (
	"context"
	"database/sql"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	socialConnectCooldown   = 30 * time.Minute
	socialConnectDailyLimit = 3
	socialDisconnectDelay   = 48 * time.Hour
)

type socialPolicyQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type socialConnectPolicy struct {
	CanConnect     bool
	RemainingToday int
	AvailableAt    *time.Time
	Code           string
}

func evaluateSocialConnectPolicy(now time.Time, lastConnected, firstToday *time.Time, connectedToday int) socialConnectPolicy {
	remaining := socialConnectDailyLimit - connectedToday
	if remaining < 0 {
		remaining = 0
	}
	policy := socialConnectPolicy{CanConnect: true, RemainingToday: remaining}
	var availableAt time.Time
	if lastConnected != nil {
		cooldownEnds := lastConnected.Add(socialConnectCooldown)
		if cooldownEnds.After(now) {
			availableAt = cooldownEnds
			policy.Code = "social_cooldown"
		}
	}
	if connectedToday >= socialConnectDailyLimit && firstToday != nil {
		dailyReset := firstToday.Add(24 * time.Hour)
		if dailyReset.After(availableAt) {
			availableAt = dailyReset
		}
		policy.Code = "social_daily_limit"
	}
	if availableAt.After(now) {
		policy.CanConnect = false
		policy.AvailableAt = &availableAt
	}
	return policy
}

func loadSocialConnectPolicy(ctx context.Context, query socialPolicyQuerier, userID int64, now time.Time) (socialConnectPolicy, error) {
	var lastConnected sql.NullTime
	var firstToday sql.NullTime
	var connectedToday int
	err := query.QueryRow(ctx, `
		SELECT MAX(created_at),
		       MIN(created_at) FILTER (WHERE created_at > $2::timestamptz - INTERVAL '24 hours'),
		       COUNT(*) FILTER (WHERE created_at > $2::timestamptz - INTERVAL '24 hours')
		FROM oauth_account_events
		WHERE user_id = $1 AND action = 'connected'
	`, userID, now).Scan(&lastConnected, &firstToday, &connectedToday)
	if err != nil {
		return socialConnectPolicy{}, err
	}
	var last, first *time.Time
	if lastConnected.Valid {
		last = &lastConnected.Time
	}
	if firstToday.Valid {
		first = &firstToday.Time
	}
	return evaluateSocialConnectPolicy(now, last, first, connectedToday), nil
}

func (s *server) startOAuthDisconnectCleanup(ctx context.Context) {
	cleanup := func() {
		if err := s.finalizeOAuthDisconnects(ctx); err != nil {
			return
		}
	}
	cleanup()
	ticker := time.NewTicker(time.Minute)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanup()
			}
		}
	}()
}

func (s *server) finalizeOAuthDisconnects(ctx context.Context) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `
		SELECT user_id, provider
		FROM oauth_accounts
		WHERE disconnect_scheduled_for IS NOT NULL AND disconnect_scheduled_for <= NOW()
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		return err
	}
	type dueAccount struct {
		userID   int64
		provider string
	}
	due := []dueAccount{}
	for rows.Next() {
		var item dueAccount
		if err := rows.Scan(&item.userID, &item.provider); err != nil {
			rows.Close()
			return err
		}
		due = append(due, item)
	}
	rows.Close()
	for _, item := range due {
		result, err := tx.Exec(ctx, `
			DELETE FROM oauth_accounts
			WHERE user_id = $1 AND provider = $2
			  AND disconnect_scheduled_for IS NOT NULL AND disconnect_scheduled_for <= NOW()
		`, item.userID, item.provider)
		if err != nil {
			return err
		}
		if result.RowsAffected() == 0 {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO oauth_account_events (user_id, provider, action) VALUES ($1,$2,'disconnected')`, item.userID, item.provider); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO audit_logs (actor_user_id, actor_username, actor_role, category, action, target_type, target_id, outcome, metadata)
			SELECT id, identifier, role, 'security', 'social.disconnected', 'oauth', $2, 'success', '{"scheduled":true}'::jsonb
			FROM users WHERE id = $1
		`, item.userID, item.provider); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
