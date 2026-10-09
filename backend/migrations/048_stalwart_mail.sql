ALTER TABLE mail_domains
    ADD COLUMN IF NOT EXISTS stalwart_domain_id TEXT,
    ADD COLUMN IF NOT EXISTS stalwart_provision_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (stalwart_provision_state IN ('pending','provisioned','failed','disabled')),
    ADD COLUMN IF NOT EXISTS stalwart_last_error TEXT NOT NULL DEFAULT '';

ALTER TABLE mailboxes
    ADD COLUMN IF NOT EXISTS stalwart_account_id TEXT,
    ADD COLUMN IF NOT EXISTS stalwart_provision_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (stalwart_provision_state IN ('pending','provisioned','failed','disabled')),
    ADD COLUMN IF NOT EXISTS stalwart_last_error TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS mail_domains_stalwart_id_unique
    ON mail_domains(stalwart_domain_id) WHERE stalwart_domain_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_stalwart_id_unique
    ON mailboxes(stalwart_account_id) WHERE stalwart_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS mail_device_credentials (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    mailbox_id BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    provider_credential_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT 'iPhone',
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_device_credentials_provider_unique
    ON mail_device_credentials(mailbox_id, provider_credential_id)
    WHERE revoked_at IS NULL;
