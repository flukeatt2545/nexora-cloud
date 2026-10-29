-- The outside uptime checker: a Cloudflare Worker (uptime-worker/) that checks the site every
-- minute from Cloudflare's network and posts to Discord through a webhook only it knows.
-- It reads these settings and sends its results back through /api/uptime-worker/*.

-- One row (id = 1): what the admin set on /admin/discord-bot.
CREATE TABLE IF NOT EXISTS uptime_settings (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- [{"id": "web", "name": "เว็บไซต์", "url": "https://nkn02.com", "enabled": true}]
    targets JSONB NOT NULL DEFAULT '[]'::jsonb,
    failures_for_down SMALLINT NOT NULL DEFAULT 2 CHECK (failures_for_down BETWEEN 1 AND 10),
    slow_ms INTEGER NOT NULL DEFAULT 3000 CHECK (slow_ms BETWEEN 500 AND 10000),
    mention_role_id VARCHAR(32) NOT NULL DEFAULT '',
    sender_name VARCHAR(80) NOT NULL DEFAULT 'NEXORA CLOUD',
    -- A failed round that never reached failures_for_down: not posted, a quiet grey message, or one summary a day.
    minor_mode VARCHAR(10) NOT NULL DEFAULT 'quiet' CHECK (minor_mode IN ('off', 'quiet', 'daily')),
    -- The admin asks for a test message; the Worker sends it on its next run and reports back.
    test_requested_at TIMESTAMPTZ,
    test_sent_at TIMESTAMPTZ,
    test_error VARCHAR(200) NOT NULL DEFAULT '',
    -- The last time the Worker sent anything; the page warns when this goes quiet.
    last_report_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 1,
    updated_by BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO uptime_settings (id, targets)
VALUES (1, '[{"id": "web", "name": "เว็บไซต์", "url": "https://nkn02.com", "enabled": true}, {"id": "api", "name": "API", "url": "https://api.nkn02.com/health", "enabled": true}]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- One row per target per round. Kept 8 days (enough for the 7-day uptime).
CREATE TABLE IF NOT EXISTS uptime_checks (
    target_id VARCHAR(40) NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL,
    ok BOOLEAN NOT NULL,
    status_code SMALLINT NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    colo VARCHAR(8) NOT NULL DEFAULT '',
    error VARCHAR(200) NOT NULL DEFAULT '',
    -- The first try failed and the second one, 15 seconds later, decided the round.
    retried BOOLEAN NOT NULL DEFAULT FALSE,
    slow BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (target_id, checked_at)
);
CREATE INDEX IF NOT EXISTS uptime_checks_checked_at_idx ON uptime_checks (checked_at);

-- Outages (kind 'down') and failures that did not reach the alert (kind 'minor').
-- (target_id, kind, started_at) is unique so a queued report sent twice changes nothing.
CREATE TABLE IF NOT EXISTS uptime_incidents (
    id BIGSERIAL PRIMARY KEY,
    target_id VARCHAR(40) NOT NULL,
    target_name VARCHAR(60) NOT NULL DEFAULT '',
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('down', 'minor')),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    detail VARCHAR(300) NOT NULL DEFAULT '',
    UNIQUE (target_id, kind, started_at)
);
CREATE INDEX IF NOT EXISTS uptime_incidents_started_at_idx ON uptime_incidents (started_at DESC);
