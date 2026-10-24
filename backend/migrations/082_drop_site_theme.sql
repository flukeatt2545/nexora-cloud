-- The site themes (Halloween and the date ranges that switched them on) were removed; their settings go too.
ALTER TABLE system_settings DROP COLUMN IF EXISTS site_theme;
ALTER TABLE system_settings DROP COLUMN IF EXISTS theme_schedule;
