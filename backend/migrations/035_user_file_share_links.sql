ALTER TABLE user_files
    ADD COLUMN IF NOT EXISTS share_token VARCHAR(32),
    ADD COLUMN IF NOT EXISTS share_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_files_share_token
    ON user_files (share_token)
    WHERE share_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_files_share_active
    ON user_files (share_token)
    WHERE share_enabled = TRUE AND deleted_at IS NULL AND share_token IS NOT NULL;
