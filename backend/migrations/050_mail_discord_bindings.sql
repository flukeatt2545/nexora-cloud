CREATE TABLE IF NOT EXISTS mail_discord_bindings (
    id BIGSERIAL PRIMARY KEY,
    discord_user_id VARCHAR(64) NOT NULL,
    discord_username VARCHAR(120) NOT NULL DEFAULT '',
    mailbox_id BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_discord_bindings_unique
    ON mail_discord_bindings (discord_user_id, mailbox_id);

CREATE INDEX IF NOT EXISTS mail_discord_bindings_mailbox_idx
    ON mail_discord_bindings (mailbox_id);
