import dotenv from "dotenv";

dotenv.config();

// A token set on the admin web page wins; otherwise the bot uses the one in .env.
export const ENV_TOKEN = process.env.VOICE_DISCORD_BOT_TOKEN || "";
export const CATEGORY_ID = process.env.VOICE_DISCORD_CATEGORY_ID || "";
export const CATEGORY_NAME = process.env.VOICE_DISCORD_CATEGORY_NAME || "ห้องมีรหัส";
// A room sits in one of these two categories depending on whether it is open to everyone.
export const PUBLIC_CATEGORY_NAME = process.env.VOICE_PUBLIC_CATEGORY_NAME || "『🌐』𝐏𝐔𝐁𝐋𝐈𝐂 𝐕𝐎𝐈𝐂𝐄";
export const PRIVATE_CATEGORY_NAME = process.env.VOICE_PRIVATE_CATEGORY_NAME || "『🔐』𝐏𝐑𝐈𝐕𝐀𝐓𝐄 𝐕𝐎𝐈𝐂𝐄";
export const API_URL = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export const BOT_SECRET = process.env.BOT_INTERNAL_SECRET || "";
