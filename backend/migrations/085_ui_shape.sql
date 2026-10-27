-- The site's shape, picked by the admin: the usual rounded UI, or the square one with cut corners (app/ui-square.css).
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS ui_shape TEXT NOT NULL DEFAULT 'round';
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_ui_shape_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_ui_shape_check CHECK (ui_shape IN ('round', 'square'));
