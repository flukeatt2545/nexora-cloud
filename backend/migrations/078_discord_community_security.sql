-- Website security events (the ones ticked for the security webhook) waiting for the community
-- bot to post them in its security room. The bot deletes each one once posted.
CREATE TABLE IF NOT EXISTS discord_community_security_feed (
    id BIGSERIAL PRIMARY KEY,
    embed JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
