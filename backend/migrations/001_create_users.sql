CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    identifier TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_identifier_lower_unique
    ON users (LOWER(identifier));
