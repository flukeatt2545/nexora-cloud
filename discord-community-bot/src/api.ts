import axios from "axios";
import { API_URL, BOT_SECRET } from "./config";

export type Actor = string | { id: string; username: string };

/**
 * Calls the main site's internal API, acting for a Discord member when one is given. Passing the
 * user (not just the id) also sends their username, so the logs page can show who it was.
 */
export function api(actor?: Actor) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Bot-Internal-Secret": BOT_SECRET,
  };
  const actorId = typeof actor === "string" ? actor : actor?.id;
  if (actorId) headers["X-Bot-Actor-Discord-Id"] = actorId;
  // Header values must be plain ASCII; older Discord names may not be, so those are left out.
  if (typeof actor === "object" && /^[\x20-\x7e]{1,64}$/.test(actor.username)) {
    headers["X-Bot-Actor-Username"] = actor.username;
  }
  return axios.create({ baseURL: API_URL, timeout: 15000, headers });
}

export function apiStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

function apiData(error: unknown): Record<string, unknown> {
  return axios.isAxiosError(error) && error.response?.data && typeof error.response.data === "object"
    ? (error.response.data as Record<string, unknown>)
    : {};
}

// The API's 4xx messages are written for members, so show them; hide anything from a 5xx.
export function apiMessage(error: unknown, fallback: string): string {
  const status = apiStatus(error);
  const message = apiData(error).error;
  if (status && status < 500 && typeof message === "string" && message.trim()) return message;
  return fallback;
}

export function logBotError(scope: string, error: unknown) {
  const status = apiStatus(error);
  const code = apiData(error).code;
  // discord.js errors carry a numeric code (50013 = missing permissions) worth keeping.
  const discordCode = !status && error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  const detail = !status && error instanceof Error ? error.message : "";
  console.error(`[ERROR] ${scope}`, status || "", code || "", discordCode, detail);
}
