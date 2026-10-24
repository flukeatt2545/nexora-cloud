-- Which of the bot's security rooms an event goes to: 'site' for the website's events (web-activity),
-- 'discord' for what happens in Discord itself, such as voice room entries the bot turns away.
ALTER TABLE discord_community_security_feed ADD COLUMN IF NOT EXISTS room TEXT NOT NULL DEFAULT 'site';
