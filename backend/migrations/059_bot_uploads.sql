-- 059: upload history for the Discord /upload feature.
-- Records every file uploaded via POST /api/internal/bot/uploads so users
-- can list what they have uploaded (bot command /my-uploads).
-- Idempotent: safe to re-run on every backend startup (like other migrations).

CREATE TABLE IF NOT EXISTS bot_uploads (
    id              BIGSERIAL PRIMARY KEY,
    guild_id        TEXT        NOT NULL DEFAULT '',
    discord_user_id TEXT        NOT NULL,
    discord_username TEXT       NOT NULL DEFAULT '',
    object_key      TEXT        NOT NULL,
    url             TEXT        NOT NULL,
    filename        TEXT        NOT NULL DEFAULT '',
    size_bytes      BIGINT      NOT NULL DEFAULT 0,
    content_type    TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_uploads_user_guild_idx
    ON bot_uploads (discord_user_id, guild_id, created_at DESC);
