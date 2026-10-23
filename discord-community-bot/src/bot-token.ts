import axios from "axios";
import { Events, type Client } from "discord.js";

// Shared by the Nexora bots (each keeps its own copy of this file).
// A token set on the admin Discord bot page wins; the one in .env is used when the page has
// none. The bot restarts itself when the page's token changes; Docker brings it back up with
// the new one. Every 30 seconds it tells the site how it is really doing (still connected to
// Discord or not), for the connection card on that page.

type State = "online" | "invalid_token" | "no_token" | "error";

// Discord closes the connection with 4004 when the token stops working (reset in the
// Developer Portal, or by Discord itself).
const AUTH_FAILED = 4004;
// Not connected for this long after having been online: restart and connect again from scratch.
const RECONNECT_LIMIT_MS = 3 * 60 * 1000;

export async function startBot(options: { botKey: string; envToken: string; apiUrl: string; secret: string; client: Client }) {
  const { botKey, envToken, client } = options;
  const http = axios.create({
    baseURL: options.apiUrl,
    timeout: 10000,
    headers: { "Content-Type": "application/json", "X-Bot-Internal-Secret": options.secret },
  });
  let token = "";
  let source: "env" | "web" | "" = "";
  let version = 0;
  let state: State = "no_token";
  let downSince = 0;

  const report = () => http.post(`/api/internal/bot/status/${botKey}`, {
    state,
    source: token ? source : "",
    botTag: client.user?.tag ?? "",
    guildCount: client.guilds.cache.size,
  }).catch(() => undefined);

  const webToken = async () => {
    const res = await http.get(`/api/internal/bot/token/${botKey}`);
    return { token: String(res.data?.token || ""), version: Number(res.data?.version) || 0 };
  };

  try {
    const fromWeb = await webToken();
    version = fromWeb.version;
    if (fromWeb.token) {
      token = fromWeb.token;
      source = "web";
    }
  } catch {
    console.error("[ERROR] Could not load the bot token from the site; will keep checking");
  }
  if (!token && envToken) {
    token = envToken;
    source = "env";
  }

  // A token saved or removed on the web page: restart and use it (or fall back to .env).
  setInterval(async () => {
    try {
      const next = await webToken();
      if (next.version === version) return;
      console.log("[INFO] Bot token changed on the web page; restarting");
      await client.destroy().catch(() => undefined);
      process.exit(0);
    } catch {
      // The site may be restarting; check again next time.
    }
  }, 15000).unref();

  // Not unref'd: this also keeps a bot without a working token running while it waits for one.
  setInterval(() => {
    if (state === "online" || state === "error") {
      if (client.isReady()) {
        state = "online";
        downSince = 0;
      } else {
        state = "error";
        downSince ||= Date.now();
        if (Date.now() - downSince > RECONNECT_LIMIT_MS) {
          console.error("[ERROR] Lost the Discord connection and could not get it back; restarting");
          void report().finally(() => process.exit(1));
          return;
        }
      }
    }
    void report();
  }, 30000);

  client.on(Events.ShardDisconnect, (event) => {
    if (event.code !== AUTH_FAILED) return;
    console.error("[ERROR] Discord stopped accepting the token (it was probably reset)");
    state = "invalid_token";
    void report();
  });

  if (!token) {
    console.warn("[WARN] No bot token yet. Set one on the Discord bot page of the admin site, or in .env.");
    await report();
    return false;
  }
  try {
    await client.login(token);
    state = "online";
  } catch (error) {
    const text = error instanceof Error ? `${error.name} ${error.message}` : "";
    state = /TokenInvalid|invalid token|401|4004|Authentication failed/i.test(text) ? "invalid_token" : "error";
    console.error(`[ERROR] Login failed: ${state === "invalid_token" ? "the token was not accepted" : "could not connect"}`);
    // This bot needs two privileged intents (see index.ts); Discord refuses the login without them.
    if (/disallowed intents/i.test(text)) {
      console.error("[ERROR] Turn on Server Members Intent and Message Content Intent for this bot in the Discord Developer Portal (Bot page)");
    }
    // Could not connect at all: try again from scratch in a while (Docker restarts the bot).
    if (state === "error") setTimeout(() => process.exit(1), RECONNECT_LIMIT_MS).unref();
  }
  await report();
  return state === "online";
}
