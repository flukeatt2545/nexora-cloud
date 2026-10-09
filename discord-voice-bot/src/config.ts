import dotenv from "dotenv";

dotenv.config();

// A token set on the admin web page wins; otherwise the bot uses the one in .env.
export const ENV_TOKEN = process.env.VOICE_DISCORD_BOT_TOKEN || "";
export const CATEGORY_ID = process.env.VOICE_DISCORD_CATEGORY_ID || "";
export const CATEGORY_NAME = process.env.VOICE_DISCORD_CATEGORY_NAME || "ห้องมีรหัส";
export const API_URL = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
export const BOT_SECRET = process.env.BOT_INTERNAL_SECRET || "";
