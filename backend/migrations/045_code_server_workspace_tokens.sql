-- 045_code_server_workspace_tokens.sql

CREATE TABLE IF NOT EXISTS hosting_workspace_access_tokens (
    id BIGSERIAL PRIMARY KEY,
    token VARCHAR(128) NOT NULL UNIQUE,
    site_id BIGINT NOT NULL REFERENCES hosting_sites(id) ON DELETE CASCADE,
    site_public_id VARCHAR(64) NOT NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    student_code VARCHAR(32) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS hosting_workspace_access_tokens_token_idx
    ON hosting_workspace_access_tokens(token) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS hosting_workspace_access_tokens_site_idx
    ON hosting_workspace_access_tokens(site_id);
