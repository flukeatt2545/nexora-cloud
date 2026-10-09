ALTER TABLE system_settings
    DROP COLUMN IF EXISTS app_short_name,
    DROP COLUMN IF EXISTS pwa_theme_color,
    DROP COLUMN IF EXISTS pwa_background_color;
