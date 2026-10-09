-- 044_student_workspace_mappings.sql

ALTER TABLE student_db_mappings
    ADD COLUMN IF NOT EXISTS site_id BIGINT REFERENCES hosting_sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS student_db_mappings_site_idx
    ON student_db_mappings(site_id);

ALTER TABLE student_db_mappings
    ALTER COLUMN database_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS student_workspace_access_logs (
    id BIGSERIAL PRIMARY KEY,
    student_code VARCHAR(32) NOT NULL,
    site_id BIGINT REFERENCES hosting_sites(id) ON DELETE SET NULL,
    discord_user_id VARCHAR(64) NOT NULL DEFAULT '',
    discord_username VARCHAR(120) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'success',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_workspace_access_logs_code_idx 
    ON student_workspace_access_logs(student_code);

CREATE INDEX IF NOT EXISTS student_workspace_access_logs_user_idx 
    ON student_workspace_access_logs(discord_user_id);

CREATE INDEX IF NOT EXISTS student_workspace_access_logs_site_idx
    ON student_workspace_access_logs(site_id);

CREATE INDEX IF NOT EXISTS student_workspace_access_logs_status_idx
    ON student_workspace_access_logs(status, created_at DESC);
