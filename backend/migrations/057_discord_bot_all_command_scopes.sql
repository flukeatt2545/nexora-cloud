-- Expand supported scopes without granting any new permissions.
ALTER TABLE discord_bot_command_access_rules DROP CONSTRAINT IF EXISTS discord_bot_command_access_rules_command_scope_check;
ALTER TABLE discord_bot_command_access_rules ADD CONSTRAINT discord_bot_command_access_rules_command_scope_check CHECK (command_scope IN (
 'db','code','setup-panel','bot-panel',
 'admin-map.list','admin-map.set','admin-map.unbind','admin-map.auto-detect','admin-map.scan-discord',
 'bot.status','bot.mode','bot.users','bot.roles','bot.permissions','bot.visibility',
 'crowdsec.bans','crowdsec.ban','crowdsec.unban'
));
