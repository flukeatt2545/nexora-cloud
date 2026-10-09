ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS theme_mode TEXT NOT NULL DEFAULT 'dark';
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_theme_mode_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_theme_mode_check CHECK (theme_mode IN ('light', 'dark'));
