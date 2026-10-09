ALTER TABLE hosting_sites
  ADD COLUMN IF NOT EXISTS runtime_container_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS runtime_port INTEGER,
  ADD COLUMN IF NOT EXISTS cpu_millicores INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS memory_mb INTEGER NOT NULL DEFAULT 256,
  ADD COLUMN IF NOT EXISTS process_limit INTEGER NOT NULL DEFAULT 128,
  ADD COLUMN IF NOT EXISTS disk_limit_mb INTEGER NOT NULL DEFAULT 1024,
  ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ;

ALTER TABLE hosting_sites
  DROP CONSTRAINT IF EXISTS hosting_sites_cpu_millicores_check,
  ADD CONSTRAINT hosting_sites_cpu_millicores_check CHECK (cpu_millicores BETWEEN 100 AND 4000),
  DROP CONSTRAINT IF EXISTS hosting_sites_memory_mb_check,
  ADD CONSTRAINT hosting_sites_memory_mb_check CHECK (memory_mb BETWEEN 64 AND 8192),
  DROP CONSTRAINT IF EXISTS hosting_sites_process_limit_check,
  ADD CONSTRAINT hosting_sites_process_limit_check CHECK (process_limit BETWEEN 16 AND 1024),
  DROP CONSTRAINT IF EXISTS hosting_sites_disk_limit_mb_check,
  ADD CONSTRAINT hosting_sites_disk_limit_mb_check CHECK (disk_limit_mb BETWEEN 128 AND 51200),
  DROP CONSTRAINT IF EXISTS hosting_sites_runtime_port_check,
  ADD CONSTRAINT hosting_sites_runtime_port_check CHECK (runtime_port IS NULL OR runtime_port BETWEEN 1024 AND 65535),
  DROP CONSTRAINT IF EXISTS hosting_sites_health_status_check,
  ADD CONSTRAINT hosting_sites_health_status_check CHECK (health_status IN ('unknown','starting','healthy','unhealthy','stopped'));

CREATE TABLE IF NOT EXISTS hosting_port_leases (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES hosting_sites(id) ON DELETE CASCADE,
  port INTEGER NOT NULL CHECK (port BETWEEN 1024 AND 65535),
  lease_token_hash CHAR(64) NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved','active','released')),
  leased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  UNIQUE (site_id)
);

-- Older local installs created a global UNIQUE constraint on port. That made a
-- released port impossible to lease again, so remove it before creating the
-- state-aware uniqueness rule.
ALTER TABLE hosting_port_leases
  DROP CONSTRAINT IF EXISTS hosting_port_leases_port_key;

DROP INDEX IF EXISTS hosting_port_leases_active_idx;

CREATE UNIQUE INDEX IF NOT EXISTS hosting_port_leases_active_port_unique
  ON hosting_port_leases (port)
  WHERE state IN ('reserved','active');

CREATE INDEX IF NOT EXISTS hosting_operations_worker_queue_idx
  ON hosting_operations (id)
  WHERE state = 'queued';

CREATE TABLE IF NOT EXISTS hosting_runtime_logs (
  id BIGSERIAL PRIMARY KEY,
  site_id BIGINT NOT NULL REFERENCES hosting_sites(id) ON DELETE CASCADE,
  operation_id CHAR(32),
  stream TEXT NOT NULL CHECK (stream IN ('system','stdout','stderr','health')),
  message TEXT NOT NULL CHECK (char_length(message) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hosting_runtime_logs_site_idx
  ON hosting_runtime_logs (site_id, id DESC);
