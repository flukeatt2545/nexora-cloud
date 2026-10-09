ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS discord_webhook_ciphertext TEXT NOT NULL DEFAULT '';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS webhook_events JSONB NOT NULL DEFAULT '["auth.login","auth.register","password.changed","user.status_changed","user.role_changed"]'::jsonb;

CREATE TABLE IF NOT EXISTS announcements (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'banner',
    placement TEXT NOT NULL DEFAULT 'homepage',
    severity TEXT NOT NULL DEFAULT 'info',
    button_label TEXT NOT NULL DEFAULT '',
    button_url TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT announcements_kind_check CHECK (kind IN ('banner', 'popup')),
    CONSTRAINT announcements_placement_check CHECK (placement IN ('homepage', 'login', 'both')),
    CONSTRAINT announcements_severity_check CHECK (severity IN ('info', 'success', 'warning', 'error')),
    CONSTRAINT announcements_schedule_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS announcements_public_schedule_idx
    ON announcements (active, starts_at, ends_at, placement);
