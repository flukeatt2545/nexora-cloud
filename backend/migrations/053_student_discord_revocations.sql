CREATE TABLE IF NOT EXISTS student_discord_revocations (
    id BIGSERIAL PRIMARY KEY,
    student_code VARCHAR(32) NOT NULL,
    discord_user_id VARCHAR(64) NOT NULL,
    discord_username VARCHAR(120) NOT NULL DEFAULT '',
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_code, discord_user_id)
);

CREATE INDEX IF NOT EXISTS student_discord_revocations_user_idx
    ON student_discord_revocations(discord_user_id);

CREATE INDEX IF NOT EXISTS student_discord_revocations_code_idx
    ON student_discord_revocations(student_code);

-- Kill unused bot SSO tickets so an unbind cannot be bypassed with an old link.
UPDATE hosting_database_access_tickets
SET expires_at = NOW(), used_at = COALESCE(used_at, NOW())
WHERE used_at IS NULL
  AND expires_at > NOW()
  AND session_id IS NULL
  AND database_id IN (
    SELECT database_id FROM student_db_mappings WHERE database_id IS NOT NULL
  );

UPDATE hosting_workspace_access_tokens
SET revoked_at = NOW()
WHERE revoked_at IS NULL
  AND student_code <> '';
