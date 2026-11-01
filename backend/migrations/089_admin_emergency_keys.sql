-- Keys a superadmin makes for themselves, for getting in when every normal sign-in is off or broken.
-- Only the hash is kept; the key itself is shown once when it is made.
CREATE TABLE IF NOT EXISTS admin_emergency_keys (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_hint TEXT NOT NULL,
    created_via TEXT NOT NULL DEFAULT 'web',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    last_used_ip TEXT NOT NULL DEFAULT '',
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_emergency_keys_user_idx ON admin_emergency_keys (user_id, created_at DESC);
