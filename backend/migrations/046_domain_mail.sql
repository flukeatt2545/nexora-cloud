CREATE TABLE IF NOT EXISTS mail_domains (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    domain TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('platform','custom')),
    provider TEXT NOT NULL DEFAULT 'resend',
    provider_domain_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending_dns' CHECK (status IN ('pending_dns','pending_approval','active','suspended','failed')),
    dns_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    provider_status JSONB NOT NULL DEFAULT '{}'::jsonb,
    verified_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_domains_domain_active_unique
    ON mail_domains (LOWER(domain)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mail_domains_platform_unique
    ON mail_domains (kind) WHERE kind='platform' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mailboxes (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    domain_id BIGINT NOT NULL REFERENCES mail_domains(id) ON DELETE CASCADE,
    local_part TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    quota_bytes BIGINT NOT NULL DEFAULT 1073741824 CHECK (quota_bytes BETWEEN 10485760 AND 107374182400),
    used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
    daily_send_limit INTEGER NOT NULL DEFAULT 100 CHECK (daily_send_limit BETWEEN 1 AND 10000),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_address_unique
    ON mailboxes (domain_id, LOWER(local_part)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mailbox_members (
    mailbox_id BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (mailbox_id,user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS mailbox_single_owner
    ON mailbox_members(mailbox_id) WHERE role='owner';

CREATE TABLE IF NOT EXISTS mail_aliases (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    domain_id BIGINT NOT NULL REFERENCES mail_domains(id) ON DELETE CASCADE,
    mailbox_id BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    local_part TEXT NOT NULL,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_aliases_address_unique
    ON mail_aliases (domain_id, LOWER(local_part)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mail_threads (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    mailbox_id BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    subject_normalized TEXT NOT NULL DEFAULT '',
    latest_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    message_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mail_threads_mailbox_latest_idx
    ON mail_threads(mailbox_id,latest_message_at DESC);

CREATE TABLE IF NOT EXISTS mail_messages (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    mailbox_id BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    thread_id BIGINT REFERENCES mail_threads(id) ON DELETE SET NULL,
    provider_message_id TEXT,
    idempotency_key TEXT,
    internet_message_id TEXT,
    in_reply_to TEXT,
    message_references TEXT[] NOT NULL DEFAULT '{}',
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    folder TEXT NOT NULL CHECK (folder IN ('inbox','sent','draft','trash')),
    delivery_status TEXT NOT NULL DEFAULT 'received' CHECK (delivery_status IN ('draft','queued','sending','sent','delivered','delayed','bounced','failed','received')),
    from_address TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL DEFAULT '',
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    sent_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    trashed_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_provider_unique
    ON mail_messages(mailbox_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_send_idempotency_unique
    ON mail_messages(mailbox_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS mail_messages_box_folder_idx
    ON mail_messages(mailbox_id,folder,COALESCE(received_at,sent_at,created_at) DESC);
CREATE INDEX IF NOT EXISTS mail_messages_thread_idx ON mail_messages(thread_id,created_at);
CREATE INDEX IF NOT EXISTS mail_messages_search_idx ON mail_messages USING GIN (
    to_tsvector('simple',COALESCE(subject,'') || ' ' || COALESCE(body_text,''))
);

CREATE TABLE IF NOT EXISTS mail_recipients (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('to','cc','bcc')),
    address TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS mail_recipients_message_idx ON mail_recipients(message_id);

CREATE TABLE IF NOT EXISTS mail_attachments (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    message_id BIGINT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    provider_attachment_id TEXT,
    object_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    content_id TEXT,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sha256_hex VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mail_attachments_message_idx ON mail_attachments(message_id);

CREATE TABLE IF NOT EXISTS mail_message_user_state (
    message_id BIGINT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ,
    starred_at TIMESTAMPTZ,
    PRIMARY KEY(message_id,user_id)
);

CREATE TABLE IF NOT EXISTS mail_delivery_events (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT REFERENCES mail_messages(id) ON DELETE SET NULL,
    provider_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mail_webhook_events (
    provider_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','processed','ignored','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS mail_jobs (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(32) NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('send','purge_trash','sync_domain')),
    message_id BIGINT REFERENCES mail_messages(id) ON DELETE CASCADE,
    domain_id BIGINT REFERENCES mail_domains(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','succeeded','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mail_jobs_claim_idx ON mail_jobs(state,available_at,id);

CREATE TABLE IF NOT EXISTS mail_daily_usage (
    mailbox_id BIGINT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL,
    sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
    PRIMARY KEY(mailbox_id,usage_date)
);
