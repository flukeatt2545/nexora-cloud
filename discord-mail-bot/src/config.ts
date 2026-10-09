import dotenv from "dotenv";

dotenv.config();

export const TOKEN = process.env.MAIL_DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || "";
export const CLIENT_ID = process.env.MAIL_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || "";
export const GUILD_ID = process.env.MAIL_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || "";
export const API_URL = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export const BOT_SECRET = process.env.BOT_INTERNAL_SECRET || "";
export const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "https://nkn02.com").replace(/\/+$/, "");
export const WEBMAIL = `${PUBLIC_APP_URL}/mail`;
export const LOGIN_URL = PUBLIC_APP_URL;

export function mailAdminIds(): string[] {
  const raw = process.env.MAIL_DISCORD_ADMIN_IDS || process.env.DISCORD_ADMIN_IDS || "";
  return raw.split(",").map((item) => item.trim()).filter((id) => /^[0-9]{17,20}$/.test(id));
}

export function isMailSystemAdmin(userId: string): boolean {
  return mailAdminIds().includes(userId);
}
