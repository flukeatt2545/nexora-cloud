CREATE TABLE IF NOT EXISTS system_site_offline_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    private_reason TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_site_offline_state (singleton) VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;
