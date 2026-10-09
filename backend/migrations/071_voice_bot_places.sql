-- Channels the voice bot uses in Discord, for the web page to list and stop:
--   hub       a Join to Create channel ("+ คลิกเพื่อสร้างห้อง")
--   panel     a text channel with the button panel (message_id is the panel message)
--   log       the text channel room events are posted to (one per server)
--   category  the category new rooms go in (one per server)
-- name / parent_name / missing are what the bot last saw in Discord. stop_requested_at is set
-- from the web; the bot then stops using the channel and removes the row.
CREATE TABLE IF NOT EXISTS voice_bot_places (
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('hub', 'panel', 'log', 'category')),
    channel_id VARCHAR(32) NOT NULL,
    guild_id VARCHAR(32) NOT NULL,
    message_id VARCHAR(32) NOT NULL DEFAULT '',
    name VARCHAR(100) NOT NULL DEFAULT '',
    parent_name VARCHAR(100) NOT NULL DEFAULT '',
    missing BOOLEAN NOT NULL DEFAULT FALSE,
    stop_requested_at TIMESTAMPTZ,
    checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, channel_id)
);

-- Join to Create channels used to have their own table.
DO $$
BEGIN
    IF to_regclass('voice_room_hubs') IS NOT NULL THEN
        INSERT INTO voice_bot_places (kind, channel_id, guild_id, created_at)
        SELECT 'hub', channel_id, guild_id, created_at FROM voice_room_hubs
        ON CONFLICT DO NOTHING;
        DROP TABLE voice_room_hubs;
    END IF;
END $$;

-- What happened in each room, for the log channel and for /room history. Rows stay after the
-- room is deleted (30 days) so the owner can still look back. posted_at is set once the bot has
-- posted the event to the log channel.
CREATE TABLE IF NOT EXISTS voice_room_events (
    id BIGSERIAL PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    room_id BIGINT NOT NULL,
    room_name VARCHAR(100) NOT NULL,
    owner_discord_id VARCHAR(32) NOT NULL,
    action VARCHAR(24) NOT NULL,
    actor_discord_id VARCHAR(32) NOT NULL DEFAULT '',
    member_discord_id VARCHAR(32) NOT NULL DEFAULT '',
    detail VARCHAR(24) NOT NULL DEFAULT '',
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS voice_room_events_owner_idx ON voice_room_events (owner_discord_id, id DESC);
CREATE INDEX IF NOT EXISTS voice_room_events_unposted_idx ON voice_room_events (guild_id, id) WHERE posted_at IS NULL;
