-- 060: ticket + session tables for the bot gallery web page (/gallery).
-- Tickets are single-use, short-lived login tokens issued via the Discord bot.
-- Sessions are cookie-based, scoped to one Discord user (+ guild).
-- Idempotent: safe to re-run on every backend startup (like other migrations).

CREATE TABLE IF NOT EXISTS bot_gallery_tickets (
    id              BIGSERIAL PRIMARY KEY,
    token_hash      CHAR(64) UNIQUE NOT NULL,
    discord_user_id TEXT NOT NULL,
    discord_username TEXT NOT NULL DEFAULT '',
    guild_id        TEXT NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_gallery_tickets_expiry_idx
    ON bot_gallery_tickets (expires_at);

CREATE TABLE IF NOT EXISTS bot_gallery_sessions (
    id              BIGSERIAL PRIMARY KEY,
    token_hash      CHAR(64) UNIQUE NOT NULL,
    discord_user_id TEXT NOT NULL,
    discord_username TEXT NOT NULL DEFAULT '',
    guild_id        TEXT NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_gallery_sessions_expiry_idx
    ON bot_gallery_sessions (expires_at);

CREATE INDEX IF NOT EXISTS bot_gallery_sessions_token_idx
    ON bot_gallery_sessions (token_hash);
