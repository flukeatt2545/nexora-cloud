ALTER TABLE users
    ADD COLUMN IF NOT EXISTS quick_pin_hash TEXT,
    ADD COLUMN IF NOT EXISTS quick_pin_lookup VARCHAR(64),
    ADD COLUMN IF NOT EXISTS quick_pin_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_quick_pin_lookup
    ON users (quick_pin_lookup)
    WHERE quick_pin_lookup IS NOT NULL;

CREATE TABLE IF NOT EXISTS share_rooms (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    code VARCHAR(8) NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    max_file_bytes BIGINT NOT NULL DEFAULT 52428800,
    max_room_bytes BIGINT NOT NULL DEFAULT 524288000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_rooms_expires
    ON share_rooms (expires_at);

CREATE TABLE IF NOT EXISTS share_room_sessions (
    id BIGSERIAL PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES share_rooms(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_room_sessions_room
    ON share_room_sessions (room_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS share_room_files (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    room_id BIGINT NOT NULL REFERENCES share_rooms(id) ON DELETE CASCADE,
    uploader_session_id BIGINT REFERENCES share_room_sessions(id) ON DELETE SET NULL,
    uploader_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    uploader_name TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256_hex VARCHAR(64) NOT NULL,
    transfer_mode VARCHAR(16) NOT NULL DEFAULT 'server',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_share_room_files_room_created
    ON share_room_files (room_id, created_at DESC)
    WHERE deleted_at IS NULL;
