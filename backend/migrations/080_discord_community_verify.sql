-- Verification on the website (community bot). Each try a member makes on the verify page: the
-- ones that passed wait here (handled = false) until the bot has given the member role, and all
-- of them stay for a month so the admin page can show why people were turned away.
CREATE TABLE IF NOT EXISTS discord_community_verify_attempts (
    id BIGSERIAL PRIMARY KEY,
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    username VARCHAR(64) NOT NULL DEFAULT '',
    ok BOOLEAN NOT NULL,
    reason VARCHAR(40) NOT NULL DEFAULT '',
    handled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discord_community_verify_pending_idx ON discord_community_verify_attempts (id) WHERE ok AND NOT handled;
CREATE INDEX IF NOT EXISTS discord_community_verify_created_idx ON discord_community_verify_attempts (created_at);
