ALTER TABLE user_file_category_shares ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE user_file_category_shares ADD COLUMN IF NOT EXISTS is_admin_share BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_category_share ON user_file_category_shares(category_id) WHERE is_admin_share = TRUE;
