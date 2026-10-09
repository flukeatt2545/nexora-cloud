-- Share one folder (and its visible subfolders) instead of a whole category.
-- Opens on the same public page as category shares (/files/c/<token>).
CREATE TABLE IF NOT EXISTS user_file_folder_shares (
    id BIGSERIAL PRIMARY KEY,
    folder_id INTEGER NOT NULL REFERENCES user_file_folders(id) ON DELETE CASCADE,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    is_admin_share BOOLEAN NOT NULL DEFAULT FALSE,
    share_token VARCHAR(32) NOT NULL UNIQUE,
    share_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    share_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (folder_id, owner_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_file_folder_shares_admin
    ON user_file_folder_shares (folder_id)
    WHERE is_admin_share = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_file_folder_shares_active
    ON user_file_folder_shares (share_token)
    WHERE share_enabled = TRUE;
