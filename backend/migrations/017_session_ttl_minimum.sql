ALTER TABLE system_settings
    DROP CONSTRAINT IF EXISTS system_settings_session_ttl_minutes_check;

ALTER TABLE system_settings
    ADD CONSTRAINT system_settings_session_ttl_minutes_check
    CHECK (session_ttl_minutes BETWEEN 5 AND 43200);
