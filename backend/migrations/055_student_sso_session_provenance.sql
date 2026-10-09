ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS student_code TEXT NOT NULL DEFAULT '';

ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS discord_user_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS user_sessions_student_active_idx
    ON user_sessions (LOWER(student_code), expires_at DESC)
    WHERE student_code <> '' AND revoked_at IS NULL;

-- Recover provenance for SSO sessions created before these columns existed.
-- Matching uses the same user, IP, user agent and a narrow creation window.
WITH matches AS (
    SELECT DISTINCT ON (session.id)
        session.id AS session_id,
        audit.metadata->>'studentCode' AS student_code,
        audit.metadata->>'discordUserId' AS discord_user_id
    FROM user_sessions session
    JOIN audit_logs audit
      ON audit.actor_user_id = session.user_id
     AND audit.action = 'workspace.sso_login'
     AND audit.outcome = 'success'
     AND audit.created_at BETWEEN session.created_at - INTERVAL '10 seconds'
                              AND session.created_at + INTERVAL '10 seconds'
     AND COALESCE(audit.ip_address, '') = COALESCE(session.ip_address, '')
     AND COALESCE(audit.user_agent, '') = COALESCE(session.user_agent, '')
    WHERE session.student_code = ''
      AND COALESCE(audit.metadata->>'studentCode', '') <> ''
    ORDER BY session.id, ABS(EXTRACT(EPOCH FROM (audit.created_at - session.created_at)))
)
UPDATE user_sessions session
SET student_code = matches.student_code,
    discord_user_id = COALESCE(matches.discord_user_id, '')
FROM matches
WHERE session.id = matches.session_id;
