CREATE TABLE IF NOT EXISTS hosting_sites (
    id BIGSERIAL PRIMARY KEY,
    public_id CHAR(32) NOT NULL UNIQUE,
    owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 2 AND 80),
    subdomain TEXT NOT NULL CHECK (CHAR_LENGTH(subdomain) BETWEEN 3 AND 63),
    custom_domain TEXT,
    project_type TEXT NOT NULL DEFAULT 'auto'
        CHECK (project_type IN ('auto', 'static', 'php', 'node')),
    detected_project_type TEXT
        CHECK (detected_project_type IS NULL OR detected_project_type IN ('static', 'php', 'node')),
    package_manager TEXT NOT NULL DEFAULT 'npm'
        CHECK (package_manager IN ('npm', 'pnpm', 'yarn')),
    install_command TEXT NOT NULL DEFAULT '',
    build_command TEXT NOT NULL DEFAULT '',
    start_command TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'stopped'
        CHECK (status IN ('provisioning', 'running', 'stopped', 'error', 'expired')),
    maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    expiry_action TEXT NOT NULL DEFAULT 'stop'
        CHECK (expiry_action IN ('stop', 'archive', 'delete')),
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS hosting_sites_subdomain_active_unique
    ON hosting_sites (LOWER(subdomain)) WHERE deleted_at IS NULL;

-- The unique index on custom_domain is created in 083, where it only covers verified domains.

CREATE INDEX IF NOT EXISTS hosting_sites_owner_idx
    ON hosting_sites (owner_user_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS hosting_sites_status_idx
    ON hosting_sites (status, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS hosting_site_members (
    site_id BIGINT NOT NULL REFERENCES hosting_sites(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('developer', 'viewer')),
    added_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (site_id, user_id)
);

CREATE INDEX IF NOT EXISTS hosting_site_members_user_idx
    ON hosting_site_members (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hosting_operations (
    id BIGSERIAL PRIMARY KEY,
    operation_id CHAR(32) NOT NULL UNIQUE,
    site_id BIGINT REFERENCES hosting_sites(id) ON DELETE SET NULL,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    idempotency_key TEXT NOT NULL CHECK (CHAR_LENGTH(idempotency_key) BETWEEN 16 AND 128),
    request_hash CHAR(64) NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    phase TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 86400),
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    retryable BOOLEAN NOT NULL DEFAULT FALSE,
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 20),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (actor_user_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS hosting_operations_one_active_per_site
    ON hosting_operations (site_id)
    WHERE site_id IS NOT NULL AND state IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS hosting_operations_site_history_idx
    ON hosting_operations (site_id, id DESC);

CREATE INDEX IF NOT EXISTS hosting_operations_actor_idx
    ON hosting_operations (actor_user_id, id DESC);
