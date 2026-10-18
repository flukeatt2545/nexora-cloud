-- Discord bots that users bring and the platform runs: one long-running container per bot, no
-- port, outbound network only. Kept apart from hosting_sites because every part of a site
-- (port lease, HTTP health check, gateway route) assumes a web server.
CREATE TABLE IF NOT EXISTS bot_apps (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE CHECK (public_id ~ '^[a-f0-9]{32}$'),
    owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    runtime VARCHAR(10) NOT NULL CHECK (runtime IN ('node', 'python')),
    -- The file started with `node <entry>` / `python -u <entry>`; npm_start runs `npm start`.
    entry_file VARCHAR(200) NOT NULL,
    start_mode VARCHAR(12) NOT NULL DEFAULT 'entry' CHECK (start_mode IN ('entry', 'npm_start')),
    source_kind VARCHAR(10) NOT NULL DEFAULT 'zip' CHECK (source_kind IN ('zip', 'github', 'template')),
    github_repo VARCHAR(160) NOT NULL DEFAULT '',
    github_ref VARCHAR(120) NOT NULL DEFAULT '',
    -- The current code as a zip in object storage (bots/<id>/<random>.zip).
    source_key TEXT NOT NULL DEFAULT '',
    source_updated_at TIMESTAMPTZ,
    -- The zip the running container was built from; differs from source_key after an edit
    -- that has not been restarted yet, and tells the worker to reinstall.
    deployed_source_key TEXT NOT NULL DEFAULT '',
    status VARCHAR(12) NOT NULL DEFAULT 'stopped'
        CHECK (status IN ('stopped', 'queued', 'building', 'starting', 'running', 'crashed', 'error')),
    status_message TEXT NOT NULL DEFAULT '',
    container_id VARCHAR(80) NOT NULL DEFAULT '',
    last_exit_code INTEGER,
    restart_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    -- Docker log cursor: the timestamp of the last line copied into bot_runtime_logs.
    log_cursor TEXT NOT NULL DEFAULT '',
    cpu_millicores INTEGER NOT NULL DEFAULT 250 CHECK (cpu_millicores BETWEEN 50 AND 2000),
    memory_mb INTEGER NOT NULL DEFAULT 256 CHECK (memory_mb BETWEEN 64 AND 2048),
    process_limit INTEGER NOT NULL DEFAULT 128 CHECK (process_limit BETWEEN 16 AND 512),
    disk_limit_mb INTEGER NOT NULL DEFAULT 512 CHECK (disk_limit_mb BETWEEN 64 AND 4096),
    disk_used_mb INTEGER,
    -- Filled from Discord's /users/@me when the owner saves a token.
    discord_bot_id VARCHAR(32) NOT NULL DEFAULT '',
    discord_username VARCHAR(100) NOT NULL DEFAULT '',
    discord_avatar VARCHAR(100) NOT NULL DEFAULT '',
    token_variable VARCHAR(64) NOT NULL DEFAULT '',
    token_state VARCHAR(10) NOT NULL DEFAULT 'unknown' CHECK (token_state IN ('unknown', 'valid', 'invalid')),
    token_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bot_apps_owner_idx ON bot_apps(owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bot_apps_active_status_idx ON bot_apps(status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS bot_operations (
    id BIGSERIAL PRIMARY KEY,
    operation_id VARCHAR(32) NOT NULL UNIQUE,
    bot_id BIGINT NOT NULL REFERENCES bot_apps(id) ON DELETE CASCADE,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('bot.start', 'bot.stop', 'bot.restart', 'bot.deploy', 'bot.delete')),
    idempotency_key VARCHAR(128) NOT NULL,
    state VARCHAR(12) NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
    phase VARCHAR(40) NOT NULL DEFAULT 'pending',
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 20),
    timeout_seconds INTEGER NOT NULL DEFAULT 900,
    error_code VARCHAR(60) NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bot_operations_actor_key_unique
    ON bot_operations(actor_user_id, idempotency_key);
-- One job at a time per bot: a second click while one is waiting is turned away.
CREATE UNIQUE INDEX IF NOT EXISTS bot_operations_one_active
    ON bot_operations(bot_id) WHERE state IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS bot_operations_queue_idx ON bot_operations(id) WHERE state = 'queued';

CREATE TABLE IF NOT EXISTS bot_environment_variables (
    id BIGSERIAL PRIMARY KEY,
    bot_id BIGINT NOT NULL REFERENCES bot_apps(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    value_ciphertext TEXT NOT NULL,
    is_secret BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bot_environment_name_format CHECK (name ~ '^[A-Z_][A-Z0-9_]{0,63}$'),
    CONSTRAINT bot_environment_bot_name_unique UNIQUE (bot_id, name)
);

COMMENT ON COLUMN bot_environment_variables.value_ciphertext IS
    'AES-256-GCM ciphertext (HOSTING_ENCRYPTION_KEY). Plaintext values must never be stored in PostgreSQL.';

CREATE TABLE IF NOT EXISTS bot_runtime_logs (
    id BIGSERIAL PRIMARY KEY,
    bot_id BIGINT NOT NULL REFERENCES bot_apps(id) ON DELETE CASCADE,
    stream VARCHAR(10) NOT NULL CHECK (stream IN ('system', 'stdout', 'stderr')),
    message TEXT NOT NULL CHECK (char_length(message) <= 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bot_runtime_logs_bot_idx ON bot_runtime_logs(bot_id, id);

-- NULL means the default from BOT_DEFAULT_LIMIT.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_limit INTEGER CHECK (bot_limit BETWEEN 0 AND 50);
