-- Server protection run by the voice bot in every server it is in. Set on the admin Discord bot
-- page; version changes on every save and the bot applies the new rules to each server.
CREATE TABLE IF NOT EXISTS discord_protect_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    -- Put back channels someone deletes (the server owner may delete ordinary channels).
    protect_channels BOOLEAN NOT NULL DEFAULT TRUE,
    -- Block links except to allowed_domains (one per line).
    block_links BOOLEAN NOT NULL DEFAULT TRUE,
    allowed_domains TEXT NOT NULL DEFAULT 'youtube.com
youtu.be
tenor.com
giphy.com
cdn.discordapp.com
media.discordapp.net',
    block_invites BOOLEAN NOT NULL DEFAULT TRUE,
    -- Discord's own detection of spam-like messages.
    block_spam BOOLEAN NOT NULL DEFAULT TRUE,
    -- More mentions than this in one message is blocked (0 = off).
    mention_limit INTEGER NOT NULL DEFAULT 5 CHECK (mention_limit BETWEEN 0 AND 50),
    -- Words blocked in messages (one per line).
    blocked_words TEXT NOT NULL DEFAULT '',
    -- Sending flood_messages messages within flood_seconds gets a timeout.
    flood_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    flood_messages INTEGER NOT NULL DEFAULT 6 CHECK (flood_messages BETWEEN 3 AND 30),
    flood_seconds INTEGER NOT NULL DEFAULT 5 CHECK (flood_seconds BETWEEN 2 AND 60),
    flood_timeout_minutes INTEGER NOT NULL DEFAULT 5 CHECK (flood_timeout_minutes BETWEEN 1 AND 1440),
    version BIGINT NOT NULL DEFAULT 1,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO discord_protect_settings (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

-- What the bot last managed to apply in each server, and what stopped it (missing permissions).
CREATE TABLE IF NOT EXISTS discord_protect_guilds (
    guild_id VARCHAR(32) PRIMARY KEY,
    guild_name VARCHAR(100) NOT NULL DEFAULT '',
    applied_version BIGINT NOT NULL DEFAULT 0,
    problems TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
