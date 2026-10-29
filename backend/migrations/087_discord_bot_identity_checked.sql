-- When the bot's name and picture were last read from Discord. The picture's id changes when the
-- avatar is changed in the Developer Portal, so the admin page asks again after an hour
-- (refreshDiscordBotIdentity in discord_bot_tokens.go).
ALTER TABLE discord_bot_tokens ADD COLUMN IF NOT EXISTS identity_checked_at TIMESTAMPTZ;
