CREATE TABLE IF NOT EXISTS discord_bot_command_access_rules (
    bot_key VARCHAR(32) NOT NULL REFERENCES discord_bot_access_settings(bot_key) ON DELETE CASCADE,
    command_scope VARCHAR(32) NOT NULL CHECK (command_scope IN ('bot.status','crowdsec.bans','crowdsec.ban','crowdsec.unban','setup-panel')),
    subject_type VARCHAR(16) NOT NULL CHECK (subject_type IN ('user','role')),
    discord_id VARCHAR(20) NOT NULL CHECK (discord_id ~ '^[0-9]{17,20}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bot_key, command_scope, subject_type, discord_id)
);
