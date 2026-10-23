-- The idle time before sign-out is kept in seconds so short values (down to 10 seconds) are
-- possible. session_ttl_minutes stays, rounded up to whole minutes within its own 5..43200
-- range, so an older API build that reads it keeps working. Runs on every start, so each step is
-- safe to repeat.
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS session_ttl_seconds INTEGER;

UPDATE system_settings SET session_ttl_seconds = session_ttl_minutes * 60 WHERE session_ttl_seconds IS NULL;

ALTER TABLE system_settings ALTER COLUMN session_ttl_seconds SET DEFAULT 1800;
ALTER TABLE system_settings ALTER COLUMN session_ttl_seconds SET NOT NULL;

ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_session_ttl_seconds_check;
ALTER TABLE system_settings
    ADD CONSTRAINT system_settings_session_ttl_seconds_check
    CHECK (session_ttl_seconds BETWEEN 10 AND 2592000);
