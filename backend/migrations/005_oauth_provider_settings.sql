CREATE TABLE IF NOT EXISTS oauth_provider_settings (
    provider TEXT PRIMARY KEY,
    client_id TEXT NOT NULL DEFAULT '',
    client_secret_ciphertext TEXT NOT NULL DEFAULT '',
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_provider_settings_provider_check CHECK (provider IN ('discord', 'google', 'github'))
);

INSERT INTO oauth_provider_settings (provider)
VALUES ('discord'), ('google'), ('github')
ON CONFLICT (provider) DO NOTHING;
