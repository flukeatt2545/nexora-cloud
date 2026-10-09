CREATE TABLE IF NOT EXISTS discord_bot_presence_settings (
    bot_key VARCHAR(32) PRIMARY KEY,
    activity_type VARCHAR(20) NOT NULL DEFAULT 'watching',
    activity_text VARCHAR(128) NOT NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO discord_bot_presence_settings (bot_key, activity_type, activity_text)
SELECT 'mail', activity_type, activity_text
FROM mail_discord_bot_settings
WHERE singleton=TRUE
ON CONFLICT (bot_key) DO NOTHING;

INSERT INTO discord_bot_presence_settings (bot_key, activity_type, activity_text)
VALUES ('mail', 'watching', 'เมลของคุณ')
ON CONFLICT (bot_key) DO NOTHING;

INSERT INTO discord_bot_presence_settings (bot_key, activity_type, activity_text)
VALUES ('nexora', 'watching', 'NEXORA')
ON CONFLICT (bot_key) DO NOTHING;
