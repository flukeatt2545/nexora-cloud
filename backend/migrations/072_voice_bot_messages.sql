-- The messages the voice bot posts and keeps: the button panel (/setup-room-panel) and the
-- welcome in the log channel (/setup-room-log). Set from the web page; version changes on
-- every save, and the bot edits each posted message whose message_version is older.
CREATE TABLE IF NOT EXISTS voice_bot_messages (
    key VARCHAR(10) PRIMARY KEY CHECK (key IN ('panel', 'log')),
    title VARCHAR(256) NOT NULL DEFAULT '',
    body VARCHAR(2000) NOT NULL DEFAULT '',
    image BYTEA,
    image_type VARCHAR(32) NOT NULL DEFAULT '',
    version BIGINT NOT NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which version of its message each posted panel / log welcome shows.
ALTER TABLE voice_bot_places ADD COLUMN IF NOT EXISTS message_version BIGINT NOT NULL DEFAULT 0;
