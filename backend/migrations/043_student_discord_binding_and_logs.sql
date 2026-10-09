-- 043_student_discord_binding_and_logs.sql

ALTER TABLE student_db_mappings 
    ADD COLUMN IF NOT EXISTS discord_user_id VARCHAR(64) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS discord_username VARCHAR(120) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS student_db_mappings_discord_user_idx 
    ON student_db_mappings(discord_user_id);

CREATE TABLE IF NOT EXISTS student_db_access_logs (
    id BIGSERIAL PRIMARY KEY,
    student_code VARCHAR(32) NOT NULL,
    database_id BIGINT REFERENCES hosting_databases(id) ON DELETE SET NULL,
    discord_user_id VARCHAR(64) NOT NULL DEFAULT '',
    discord_username VARCHAR(120) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'success',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_db_access_logs_code_idx 
    ON student_db_access_logs(student_code);

CREATE INDEX IF NOT EXISTS student_db_access_logs_user_idx 
    ON student_db_access_logs(discord_user_id);
