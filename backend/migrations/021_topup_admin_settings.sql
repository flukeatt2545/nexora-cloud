CREATE TABLE IF NOT EXISTS topup_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    use_database_config BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    api_token_ciphertext TEXT NOT NULL DEFAULT '',
    tenant_id TEXT NOT NULL DEFAULT '',
    receiver_bank_code TEXT NOT NULL DEFAULT '',
    receiver_bank_name TEXT NOT NULL DEFAULT '',
    receiver_account_number TEXT NOT NULL DEFAULT '',
    receiver_account_name TEXT NOT NULL DEFAULT '',
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO topup_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
