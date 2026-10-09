CREATE TABLE IF NOT EXISTS banned_ips (
    ip_address VARCHAR(45) PRIMARY KEY,
    reason TEXT NOT NULL,
    banned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    banned_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
);
