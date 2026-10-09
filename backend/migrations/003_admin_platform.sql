ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
-- Migrations re-run on every start, so this must already allow 'banned' (added in 006);
-- otherwise one banned account stops the API from starting.
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'banned'));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
    ON users (LOWER(email)) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS user_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx
    ON user_sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    provider_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_user_id),
    UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS system_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    brand_name TEXT NOT NULL DEFAULT 'NEXORA CLOUD',
    site_title TEXT NOT NULL DEFAULT 'NEXORA CLOUD',
    site_description TEXT NOT NULL DEFAULT 'Database, Storage และ Cloud Infrastructure',
    primary_color TEXT NOT NULL DEFAULT '#ff1018',
    logo_url TEXT NOT NULL DEFAULT '/logo-v2.png',
    favicon_url TEXT NOT NULL DEFAULT '/logo-v2.png',
    auth_background_url TEXT NOT NULL DEFAULT '',
    login_title TEXT NOT NULL DEFAULT 'ยินดีต้อนรับกลับมา',
    login_subtitle TEXT NOT NULL DEFAULT 'ลงชื่อเข้าใช้ NEXORA CLOUD',
    register_title TEXT NOT NULL DEFAULT 'เริ่มต้นกับ NEXORA',
    register_subtitle TEXT NOT NULL DEFAULT 'สร้างบัญชีเพื่อเริ่มใช้งาน Cloud',
    local_login_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    registration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    discord_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    google_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    github_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    session_ttl_minutes INTEGER NOT NULL DEFAULT 10080 CHECK (session_ttl_minutes BETWEEN 5 AND 43200),
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    actor_username TEXT NOT NULL DEFAULT '',
    actor_role TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL,
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action, created_at DESC);
