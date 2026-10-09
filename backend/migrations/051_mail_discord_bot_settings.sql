CREATE TABLE IF NOT EXISTS mail_discord_bot_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    activity_type VARCHAR(20) NOT NULL DEFAULT 'watching',
    activity_text VARCHAR(128) NOT NULL DEFAULT 'เมลของคุณ',
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO mail_discord_bot_settings (singleton, activity_type, activity_text)
VALUES (TRUE, 'watching', 'เมลของคุณ')
ON CONFLICT (singleton) DO NOTHING;
