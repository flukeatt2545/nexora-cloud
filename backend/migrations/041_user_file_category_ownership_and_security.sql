-- Support user ownership and password security on user_file_categories
ALTER TABLE user_file_categories
    ADD COLUMN IF NOT EXISTS owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS password_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_user_file_categories_owner
    ON user_file_categories(owner_user_id, sort_order ASC, id ASC);
