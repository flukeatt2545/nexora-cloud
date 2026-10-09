-- Support multi-level nested folders (subfolders) in user_file_folders
ALTER TABLE user_file_folders
    ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES user_file_folders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_file_folders_parent
    ON user_file_folders(parent_id);

CREATE INDEX IF NOT EXISTS idx_user_file_folders_cat_parent
    ON user_file_folders(category_id, parent_id);
