CREATE TABLE IF NOT EXISTS file_aliases (
    short_code VARCHAR(12) PRIMARY KEY,
    object_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_file_aliases_object_key ON file_aliases(object_key);
