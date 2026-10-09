-- Suspending a tenant database now locks its MySQL account, so it is worth an alert.
-- The two new events start switched on for the security webhook, once only (see 068).
CREATE TABLE IF NOT EXISTS data_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

WITH marker AS (
    INSERT INTO data_migrations (name) VALUES ('069_database_suspend_events')
    ON CONFLICT (name) DO NOTHING
    RETURNING name
)
UPDATE system_settings
SET webhook_events = (
    SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
    FROM jsonb_array_elements_text(webhook_events || '["hosting.database.suspended","hosting.database.unsuspended"]'::jsonb) AS value
)
WHERE id = 1 AND EXISTS (SELECT 1 FROM marker);
