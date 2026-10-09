ALTER TABLE oauth_accounts
    ADD COLUMN IF NOT EXISTS disconnect_requested_at TIMESTAMPTZ;

ALTER TABLE oauth_accounts
    ADD COLUMN IF NOT EXISTS disconnect_scheduled_for TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS oauth_account_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_account_events_provider_check CHECK (provider IN ('discord', 'google', 'github')),
    CONSTRAINT oauth_account_events_action_check CHECK (action IN ('connected', 'disconnect_requested', 'disconnect_cancelled', 'disconnected'))
);

CREATE INDEX IF NOT EXISTS oauth_account_events_user_created_idx
    ON oauth_account_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS oauth_accounts_pending_disconnect_idx
    ON oauth_accounts (disconnect_scheduled_for)
    WHERE disconnect_scheduled_for IS NOT NULL;

INSERT INTO oauth_account_events (user_id, provider, action, created_at)
SELECT account.user_id, account.provider, 'connected', account.created_at
FROM oauth_accounts account
WHERE NOT EXISTS (
    SELECT 1
    FROM oauth_account_events event
    WHERE event.user_id = account.user_id
      AND event.provider = account.provider
      AND event.action = 'connected'
      AND event.created_at = account.created_at
);
