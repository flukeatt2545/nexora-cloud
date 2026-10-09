CREATE TABLE IF NOT EXISTS mail_provider_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    resend_api_key_ciphertext TEXT NOT NULL DEFAULT '',
    resend_webhook_secret_ciphertext TEXT NOT NULL DEFAULT '',
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
