-- User file categories + visibility / password controls on user_files

CREATE TABLE IF NOT EXISTS user_file_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_files
    ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES user_file_categories(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS password_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_user_files_owner_visible_created
    ON user_files(owner_user_id, is_visible, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_files_category
    ON user_files(category_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_file_categories_sort
    ON user_file_categories(sort_order ASC, id ASC);
