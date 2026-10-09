CREATE TABLE IF NOT EXISTS user_files (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256_hex VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_files_owner_created
    ON user_files(owner_user_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_files_created
    ON user_files(created_at DESC)
    WHERE deleted_at IS NULL;
