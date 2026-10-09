ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS store_section_enabled BOOLEAN NOT NULL DEFAULT TRUE;
