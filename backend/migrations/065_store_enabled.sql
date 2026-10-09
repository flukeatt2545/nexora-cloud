-- Master switch for the storefront: when off, buying and top-ups stop and the
-- store/top-up parts of the site are hidden. Purchases already made stay downloadable.
ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS store_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS store_closed_message TEXT NOT NULL DEFAULT '';
