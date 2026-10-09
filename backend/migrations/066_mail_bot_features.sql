-- Self-service mailboxes from the Discord mail bot: whether members may create their own
-- mailbox on the platform domain, how many each member may own, and the space each one gets.
CREATE TABLE IF NOT EXISTS mail_bot_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    self_service_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_mailboxes_per_user INTEGER NOT NULL DEFAULT 3 CHECK (max_mailboxes_per_user BETWEEN 0 AND 50),
    self_service_quota_bytes BIGINT NOT NULL DEFAULT 1073741824
        CHECK (self_service_quota_bytes BETWEEN 10485760 AND 107374182400),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO mail_bot_settings (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

-- New-mail DMs. jmap_state is the Stalwart Email state already reported, so only mail that
-- arrives after the member turns notifications on is sent.
CREATE TABLE IF NOT EXISTS mail_bot_notify_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id VARCHAR(64) NOT NULL,
    mailbox_id BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    jmap_state TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_notified_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_bot_notify_subscriptions_unique
    ON mail_bot_notify_subscriptions (discord_user_id, mailbox_id);

CREATE INDEX IF NOT EXISTS mail_bot_notify_subscriptions_mailbox_idx
    ON mail_bot_notify_subscriptions (mailbox_id);
