ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS auth_background_tint_enabled BOOLEAN NOT NULL DEFAULT FALSE;
