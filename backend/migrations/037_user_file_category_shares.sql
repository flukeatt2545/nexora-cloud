CREATE TABLE IF NOT EXISTS user_file_category_shares (
    id BIGSERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES user_file_categories(id) ON DELETE CASCADE,
    owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_token VARCHAR(32) NOT NULL UNIQUE,
    share_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    share_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(owner_user_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_user_file_category_shares_active
    ON user_file_category_shares (share_token)
    WHERE share_enabled = TRUE;
