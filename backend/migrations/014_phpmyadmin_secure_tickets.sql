CREATE TABLE IF NOT EXISTS hosting_database_access_tickets (
    id BIGSERIAL PRIMARY KEY,
    token_hash CHAR(64) UNIQUE NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id BIGINT NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    site_id BIGINT NOT NULL REFERENCES hosting_sites(id) ON DELETE CASCADE,
    database_id BIGINT NOT NULL REFERENCES hosting_databases(id) ON DELETE CASCADE,
    ip_hash CHAR(64) NOT NULL,
    user_agent_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hosting_database_access_tickets_expiry_idx
    ON hosting_database_access_tickets(expires_at);

CREATE INDEX IF NOT EXISTS hosting_database_access_tickets_session_idx
    ON hosting_database_access_tickets(session_id);
