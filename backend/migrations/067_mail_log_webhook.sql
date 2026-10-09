-- Mail activity log: mail events also go to a Discord webhook of their own, separate from the
-- security notification webhook. groups picks which kinds of event are sent (see mail_log.go).
CREATE TABLE IF NOT EXISTS mail_log_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    webhook_ciphertext TEXT NOT NULL DEFAULT '',
    groups JSONB NOT NULL DEFAULT '["access","traffic","manage"]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO mail_log_settings (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;
