ALTER TABLE hosting_sites
    ADD COLUMN IF NOT EXISTS max_databases INTEGER NOT NULL DEFAULT 1
    CHECK (max_databases BETWEEN 1 AND 10);

ALTER TABLE hosting_databases
    DROP CONSTRAINT IF EXISTS hosting_databases_site_id_key;

ALTER TABLE hosting_databases
    ADD COLUMN IF NOT EXISTS public_id VARCHAR(32),
    ADD COLUMN IF NOT EXISTS engine VARCHAR(16) NOT NULL DEFAULT 'mysql',
    ADD COLUMN IF NOT EXISTS host VARCHAR(128) NOT NULL DEFAULT 'tenant-db',
    ADD COLUMN IF NOT EXISTS port INTEGER NOT NULL DEFAULT 3306,
    ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE hosting_databases
SET public_id = substring(encode(sha256((id::text || ':' || db_name)::bytea), 'hex') FROM 1 FOR 32)
WHERE public_id IS NULL OR public_id = '';

ALTER TABLE hosting_databases
    ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hosting_databases_public_id_unique
    ON hosting_databases(public_id);

CREATE UNIQUE INDEX IF NOT EXISTS hosting_databases_primary_per_site
    ON hosting_databases(site_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS hosting_databases_site_created_idx
    ON hosting_databases(site_id, created_at);
