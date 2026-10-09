ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS site_title_mode TEXT NOT NULL DEFAULT 'page';

UPDATE system_settings
SET site_title_mode = 'page'
WHERE site_title_mode NOT IN ('page', 'custom');

ALTER TABLE system_settings
    DROP CONSTRAINT IF EXISTS system_settings_site_title_mode_check;

ALTER TABLE system_settings
    ADD CONSTRAINT system_settings_site_title_mode_check
    CHECK (site_title_mode IN ('page', 'custom'));
