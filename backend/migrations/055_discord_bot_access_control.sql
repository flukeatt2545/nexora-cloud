CREATE TABLE IF NOT EXISTS discord_bot_access_settings (
    bot_key VARCHAR(32) PRIMARY KEY,
    access_mode VARCHAR(16) NOT NULL DEFAULT 'everyone' CHECK (access_mode IN ('everyone', 'allowlist')),
    visibility VARCHAR(16) NOT NULL DEFAULT 'online' CHECK (visibility IN ('online', 'hidden')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discord_bot_access_rules (
    bot_key VARCHAR(32) NOT NULL REFERENCES discord_bot_access_settings(bot_key) ON DELETE CASCADE,
    subject_type VARCHAR(16) NOT NULL CHECK (subject_type IN ('user', 'role')),
    discord_id VARCHAR(20) NOT NULL CHECK (discord_id ~ '^[0-9]{17,20}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bot_key, subject_type, discord_id)
);

INSERT INTO discord_bot_access_settings (bot_key, access_mode, visibility)
VALUES ('nexora', 'everyone', 'online')
ON CONFLICT (bot_key) DO NOTHING;
