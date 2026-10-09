CREATE TABLE IF NOT EXISTS system_lockdown_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    private_reason TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_lockdown_state (singleton) VALUES (TRUE)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE discord_bot_command_access_rules
    DROP CONSTRAINT IF EXISTS discord_bot_command_access_rules_command_scope_check;
DELETE FROM discord_bot_command_access_rules
WHERE command_scope IN ('admin-map.auto-detect', 'admin-map.scan-discord');
ALTER TABLE discord_bot_command_access_rules
    ADD CONSTRAINT discord_bot_command_access_rules_command_scope_check CHECK (command_scope IN (
        'db','code','setup-panel','bot-panel',
        'admin-map.list','admin-map.set','admin-map.unbind',
        'bot.status','bot.mode','bot.users','bot.roles','bot.permissions','bot.visibility',
        'crowdsec.bans','crowdsec.ban','crowdsec.unban',
        'lockdown.status','lockdown.manage','lockdown.access'
    ));
