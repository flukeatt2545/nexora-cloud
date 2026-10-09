package main

import (
	"context"
	"fmt"
	"strings"
)

func (s *server) loadOAuthAdminSettings(ctx context.Context, settings *publicSettings) error {
	// Credentials are write-only in the admin UI. Never send a saved Client ID
	// or Client Secret back to the browser; only expose whether each provider is ready.
	settings.DiscordClientID = ""
	settings.DiscordClientSecret = ""
	settings.GoogleClientID = ""
	settings.GoogleClientSecret = ""
	settings.GitHubClientID = ""
	settings.GitHubClientSecret = ""
	settings.DiscordConfigured = s.oauthConfigured(ctx, "discord")
	settings.GoogleConfigured = s.oauthConfigured(ctx, "google")
	settings.GitHubConfigured = s.oauthConfigured(ctx, "github")
	return nil
}

func (s *server) saveOAuthProvider(ctx context.Context, actorID int64, provider, clientID, secret string, clear bool) error {
	clientID = strings.TrimSpace(clientID)
	secret = strings.TrimSpace(secret)
	if len(clientID) > 255 || len(secret) > 2000 {
		return fmt.Errorf("oauth credentials too long")
	}
	var currentID, ciphertext string
	if err := s.db.QueryRow(ctx, `
		SELECT client_id, client_secret_ciphertext FROM oauth_provider_settings WHERE provider=$1
	`, provider).Scan(&currentID, &ciphertext); err != nil {
		return err
	}
	if clear {
		clientID, ciphertext = "", ""
	} else {
		if clientID == "" {
			clientID = currentID
		}
		if secret != "" {
			var err error
			ciphertext, err = encryptSecret(secret, s.cfg.webhookKey)
			if err != nil {
				return err
			}
		}
	}
	if (clientID == "") != (ciphertext == "") {
		return fmt.Errorf("client id and secret must be configured together")
	}
	_, err := s.db.Exec(ctx, `
		UPDATE oauth_provider_settings
		SET client_id=$1, client_secret_ciphertext=$2, updated_by=$3, updated_at=NOW()
		WHERE provider=$4
	`, clientID, ciphertext, actorID, provider)
	return err
}

func (s *server) saveOAuthSettings(ctx context.Context, actorID int64, body publicSettings) error {
	if err := s.saveOAuthProvider(ctx, actorID, "discord", body.DiscordClientID, body.DiscordClientSecret, body.ClearDiscordOAuth); err != nil {
		return err
	}
	if err := s.saveOAuthProvider(ctx, actorID, "google", body.GoogleClientID, body.GoogleClientSecret, body.ClearGoogleOAuth); err != nil {
		return err
	}
	return s.saveOAuthProvider(ctx, actorID, "github", body.GitHubClientID, body.GitHubClientSecret, body.ClearGitHubOAuth)
}
