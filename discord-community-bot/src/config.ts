import dotenv from "dotenv";

dotenv.config();

// A token set on the admin web page wins; otherwise the bot uses the one in .env.
export const ENV_TOKEN = process.env.COMMUNITY_DISCORD_BOT_TOKEN || "";
// The server set on the admin web page wins over this one.
export const ENV_GUILD_ID = (process.env.COMMUNITY_DISCORD_GUILD_ID || "").trim();
export const API_URL = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export const BOT_SECRET = process.env.BOT_INTERNAL_SECRET || "";
export const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "https://nkn02.com").replace(/\/+$/, "");
export const SETTINGS_URL = `${PUBLIC_APP_URL}/admin/discord-bot`;
export const STATUS_WEB_URL = process.env.COMMUNITY_STATUS_WEB_URL || PUBLIC_APP_URL;
export const STATUS_API_URL = process.env.COMMUNITY_STATUS_API_URL || `${API_URL}/health`;

const adminIds = (process.env.COMMUNITY_DISCORD_ADMIN_IDS || process.env.DISCORD_ADMIN_IDS || "")
  .split(",").map((id) => id.trim()).filter((id) => /^[0-9]{17,20}$/.test(id));

export function isBotAdmin(userId: string) {
  return adminIds.includes(userId);
}
