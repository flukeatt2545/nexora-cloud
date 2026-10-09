ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS quick_actions_enabled BOOLEAN NOT NULL DEFAULT TRUE;
