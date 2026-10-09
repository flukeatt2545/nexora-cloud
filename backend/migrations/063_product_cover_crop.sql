-- 063: which part of the cover image a product card shows.
-- {"x": 0-100, "y": 0-100, "zoom": 1-4}; x/y is the focus point in percent of the image.
-- NULL means centred, no zoom. The cover file itself is never modified.
-- Idempotent: safe to re-run on every backend startup (like other migrations).

ALTER TABLE products ADD COLUMN IF NOT EXISTS cover_crop JSONB;
