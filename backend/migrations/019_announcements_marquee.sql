ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_kind_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_kind_check CHECK (kind IN ('banner', 'popup', 'marquee'));
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;