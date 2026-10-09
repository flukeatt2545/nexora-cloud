-- Who was in which voice channel, and for how long. The voice bot opens a row when a member
-- joins a voice channel and closes it (left_at, seconds) when they leave or move. Kept 90 days.
-- channel_name is the name when they joined, so rooms deleted since still read well.
CREATE TABLE IF NOT EXISTS voice_sessions (
    id BIGSERIAL PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    guild_name VARCHAR(100) NOT NULL DEFAULT '',
    channel_id VARCHAR(32) NOT NULL,
    channel_name VARCHAR(100) NOT NULL DEFAULT '',
    discord_id VARCHAR(32) NOT NULL,
    username VARCHAR(64) NOT NULL DEFAULT '',
    display_name VARCHAR(100) NOT NULL DEFAULT '',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    seconds BIGINT,
    posted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS voice_sessions_member_idx ON voice_sessions (guild_id, discord_id, id DESC);
CREATE INDEX IF NOT EXISTS voice_sessions_recent_idx ON voice_sessions (id DESC);
CREATE INDEX IF NOT EXISTS voice_sessions_open_idx ON voice_sessions (guild_id, discord_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS voice_sessions_unposted_idx ON voice_sessions (guild_id, id) WHERE posted_at IS NULL AND left_at IS NOT NULL;

-- The voice bot works in every server it is in: rooms say which one, for the web page.
ALTER TABLE voice_rooms ADD COLUMN IF NOT EXISTS guild_name VARCHAR(100) NOT NULL DEFAULT '';

-- voicelog: the channel the voice bot posts these to (one per server).
ALTER TABLE voice_bot_places DROP CONSTRAINT IF EXISTS voice_bot_places_kind_check;
ALTER TABLE voice_bot_places ADD CONSTRAINT voice_bot_places_kind_check CHECK (kind IN ('hub', 'panel', 'log', 'category', 'voicelog'));

-- The welcome posted in that channel can be set on the web page like the others.
ALTER TABLE voice_bot_messages DROP CONSTRAINT IF EXISTS voice_bot_messages_key_check;
ALTER TABLE voice_bot_messages ADD CONSTRAINT voice_bot_messages_key_check CHECK (key IN ('panel', 'log', 'voicelog'));
