CREATE TABLE IF NOT EXISTS hosting_environment_variables (
    id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES hosting_sites(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    value_ciphertext TEXT NOT NULL,
    is_secret BOOLEAN NOT NULL DEFAULT TRUE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT hosting_environment_name_format CHECK (name ~ '^[A-Z_][A-Z0-9_]{0,63}$'),
    CONSTRAINT hosting_environment_site_name_unique UNIQUE (site_id, name)
);

CREATE INDEX IF NOT EXISTS hosting_environment_variables_site_id_idx
    ON hosting_environment_variables(site_id);

COMMENT ON COLUMN hosting_environment_variables.value_ciphertext IS
    'AES-256-GCM ciphertext. Plaintext values must never be stored in PostgreSQL.';
