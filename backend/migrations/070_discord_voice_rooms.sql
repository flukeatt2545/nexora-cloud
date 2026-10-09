-- Password-locked voice rooms made by the Discord voice bot. Everyone can see a room but only
-- members who gave the right password (or its owner) get the Connect permission.
CREATE TABLE IF NOT EXISTS voice_room_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_rooms_per_user INTEGER NOT NULL DEFAULT 3 CHECK (max_rooms_per_user BETWEEN 0 AND 20),
    empty_delete_minutes INTEGER NOT NULL DEFAULT 5 CHECK (empty_delete_minutes BETWEEN 1 AND 1440),
    max_failures INTEGER NOT NULL DEFAULT 5 CHECK (max_failures BETWEEN 1 AND 20),
    lockout_minutes INTEGER NOT NULL DEFAULT 10 CHECK (lockout_minutes BETWEEN 1 AND 1440),
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO voice_room_settings (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING;

-- channel_id stays empty for the moment between saving the room and the bot making the channel.
CREATE TABLE IF NOT EXISTS voice_rooms (
    id BIGSERIAL PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    channel_id VARCHAR(32) UNIQUE,
    owner_discord_id VARCHAR(32) NOT NULL,
    owner_username VARCHAR(64) NOT NULL DEFAULT '',
    name VARCHAR(100) NOT NULL,
    password_hash TEXT NOT NULL,
    locked BOOLEAN NOT NULL DEFAULT TRUE,
    user_limit INTEGER NOT NULL DEFAULT 0 CHECK (user_limit BETWEEN 0 AND 99),
    delete_requested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS voice_rooms_owner_idx ON voice_rooms (owner_discord_id);

-- 'command' rooms are made with /room create and start locked; 'join' rooms come from a
-- Join to Create channel, start open (no password) and can be locked later.
ALTER TABLE voice_rooms ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'command';

-- Join to Create channels: joining one makes a new room for that member and moves them in.
CREATE TABLE IF NOT EXISTS voice_room_hubs (
    channel_id VARCHAR(32) PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Members who gave the right password. Cleared when the owner changes the password.
CREATE TABLE IF NOT EXISTS voice_room_access (
    room_id BIGINT NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
    discord_id VARCHAR(32) NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, discord_id)
);

-- Wrong passwords per member and room, for the lockout after too many tries.
CREATE TABLE IF NOT EXISTS voice_room_attempts (
    room_id BIGINT NOT NULL REFERENCES voice_rooms(id) ON DELETE CASCADE,
    discord_id VARCHAR(32) NOT NULL,
    failures INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, discord_id)
);

INSERT INTO discord_bot_presence_settings (bot_key, activity_type, activity_text)
VALUES ('voice', 'watching', 'ห้องเสียง')
ON CONFLICT (bot_key) DO NOTHING;

-- Bot tokens set from the web (encrypted with the webhook key). version changes on every save
-- so a running bot can tell it has to log in again. A token in .env still wins.
CREATE TABLE IF NOT EXISTS discord_bot_tokens (
    bot_key VARCHAR(32) PRIMARY KEY,
    token_ciphertext TEXT NOT NULL,
    token_hint VARCHAR(8) NOT NULL DEFAULT '',
    application_id VARCHAR(32) NOT NULL DEFAULT '',
    bot_username VARCHAR(64) NOT NULL DEFAULT '',
    bot_avatar VARCHAR(64) NOT NULL DEFAULT '',
    version BIGINT NOT NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- What each bot last said about itself, so the web page can show whether it is online.
CREATE TABLE IF NOT EXISTS discord_bot_status (
    bot_key VARCHAR(32) PRIMARY KEY,
    state VARCHAR(20) NOT NULL,
    source VARCHAR(10) NOT NULL DEFAULT '',
    bot_tag VARCHAR(64) NOT NULL DEFAULT '',
    guild_count INTEGER NOT NULL DEFAULT 0,
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
