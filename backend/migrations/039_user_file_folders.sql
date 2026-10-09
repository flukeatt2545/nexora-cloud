-- User file folders within categories
CREATE TABLE IF NOT EXISTS user_file_folders (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES user_file_categories(id) ON DELETE CASCADE,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    password_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_files
    ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES user_file_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_file_folders_category
    ON user_file_folders(category_id, sort_order ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_user_files_folder
    ON user_files(folder_id)
    WHERE deleted_at IS NULL;
