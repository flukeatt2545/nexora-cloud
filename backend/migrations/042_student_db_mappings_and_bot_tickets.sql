-- 042_student_db_mappings_and_bot_tickets.sql

CREATE TABLE IF NOT EXISTS student_db_mappings (
    id BIGSERIAL PRIMARY KEY,
    student_code VARCHAR(32) NOT NULL UNIQUE,
    student_name VARCHAR(120) NOT NULL DEFAULT '',
    database_id BIGINT NOT NULL REFERENCES hosting_databases(id) ON DELETE CASCADE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_db_mappings_code_idx
    ON student_db_mappings(student_code);

-- Allow bot and admin single sign-on tickets to not require an active browser session
ALTER TABLE hosting_database_access_tickets
    ALTER COLUMN session_id DROP NOT NULL;

-- Allow bot and admin tickets to have optional IP and User-Agent binding
ALTER TABLE hosting_database_access_tickets
    ALTER COLUMN ip_hash DROP NOT NULL;

ALTER TABLE hosting_database_access_tickets
    ALTER COLUMN user_agent_hash DROP NOT NULL;
