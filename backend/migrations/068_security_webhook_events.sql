-- Security webhook: Discord bot activity used to be sent whenever settings.updated was ticked;
-- it is now its own choice, so keep it on for anyone who was receiving it. The new security
-- events (bans, lockdown, hosting firewall, admin account actions) start switched on, and the
-- test event is dropped because the test button posts its own message.
--
-- Migrations run on every start, so this change is applied once only: the marker row in
-- data_migrations keeps it from switching events back on after an admin turns them off.
CREATE TABLE IF NOT EXISTS data_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

WITH marker AS (
    INSERT INTO data_migrations (name) VALUES ('068_security_webhook_events')
    ON CONFLICT (name) DO NOTHING
    RETURNING name
)
UPDATE system_settings
SET webhook_events = (
    SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
    FROM jsonb_array_elements_text(
        (webhook_events - 'webhook.tested')
        || CASE WHEN webhook_events ? 'settings.updated' THEN '["discord.bot.activity"]'::jsonb ELSE '[]'::jsonb END
        || '["ip.banned","ip.unbanned","ip.banned_access","lockdown.enabled","lockdown.disabled","workspace.security_alert","user.created","user.password_reset","sessions.revoked_for_user","social.connected"]'::jsonb
    ) AS value
)
WHERE id = 1 AND EXISTS (SELECT 1 FROM marker);
