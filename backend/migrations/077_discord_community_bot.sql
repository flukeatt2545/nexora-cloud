-- The community bot (discord-community-bot): welcome and verification, self roles, tickets,
-- temporary voice rooms, stats channels and website status alerts, in one Discord server.
-- Settings are edited on the admin Discord bot page and with /setup in Discord. config is one
-- JSON object (checked by the API on every save) because it has many small fields that change
-- together; version changes on every save so the bot knows to apply them.
CREATE TABLE IF NOT EXISTS discord_community_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Messages the bot posted for its panels (verify, roles, tickets), so it edits them in place.
    panels JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 1,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO discord_community_settings (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

-- What the bot sees in its server (channels and roles, for the pickers on the web page) and what
-- it could not do there (missing permissions, a role above the bot's own).
CREATE TABLE IF NOT EXISTS discord_community_guilds (
    guild_id VARCHAR(32) PRIMARY KEY,
    guild_name VARCHAR(100) NOT NULL DEFAULT '',
    member_count INTEGER NOT NULL DEFAULT 0,
    channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    roles JSONB NOT NULL DEFAULT '[]'::jsonb,
    applied_version BIGINT NOT NULL DEFAULT 0,
    problems TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- channel_id stays empty for the moment between saving the ticket and the bot making its channel.
CREATE TABLE IF NOT EXISTS discord_community_tickets (
    id BIGSERIAL PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    channel_id VARCHAR(32) UNIQUE,
    opener_id VARCHAR(32) NOT NULL,
    opener_name VARCHAR(64) NOT NULL DEFAULT '',
    subject VARCHAR(100) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    claimed_by_id VARCHAR(32) NOT NULL DEFAULT '',
    claimed_by_name VARCHAR(64) NOT NULL DEFAULT '',
    closed_by_id VARCHAR(32) NOT NULL DEFAULT '',
    closed_by_name VARCHAR(64) NOT NULL DEFAULT '',
    close_reason VARCHAR(200) NOT NULL DEFAULT '',
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS discord_community_tickets_open_idx ON discord_community_tickets (opener_id) WHERE status = 'open';

-- Voice rooms made by joining the "create a room" channel. Deleted once empty; kept here so the
-- bot can clean up after a restart.
CREATE TABLE IF NOT EXISTS discord_community_temp_rooms (
    channel_id VARCHAR(32) PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    owner_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Times the website or the API was down, reported by the bot once it is back.
CREATE TABLE IF NOT EXISTS discord_community_incidents (
    id BIGSERIAL PRIMARY KEY,
    target VARCHAR(10) NOT NULL CHECK (target IN ('web', 'api')),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    detail VARCHAR(200) NOT NULL DEFAULT ''
);

INSERT INTO discord_bot_presence_settings (bot_key, activity_type, activity_text)
VALUES ('community', 'watching', 'เซิร์ฟเวอร์')
ON CONFLICT (bot_key) DO NOTHING;
