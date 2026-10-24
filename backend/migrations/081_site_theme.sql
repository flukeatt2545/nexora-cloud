-- The site's look (a theme such as Halloween). site_theme is the theme used all year round;
-- theme_schedule is a list of date ranges in which another theme takes over by itself
-- (see backend/site_theme.go). "default" means the plain look set by the colour and mode.
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS site_theme VARCHAR(20) NOT NULL DEFAULT 'default';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS theme_schedule JSONB NOT NULL DEFAULT '[]'::jsonb;
