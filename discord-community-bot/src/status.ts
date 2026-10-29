import axios from "axios";
import { AttachmentBuilder, type Client } from "discord.js";
import http from "http";
import https from "https";
import type { Duplex } from "stream";
import { api, logBotError } from "./api";
import { PUBLIC_APP_URL, STATUS_API_URL, STATUS_WEB_INTERNAL_URL, STATUS_WEB_URL } from "./config";
import { homeGuild } from "./guild";
import { statusCard, type StatusRow } from "./image";
import { postPanel, removePanel } from "./panels";
import { settings } from "./settings";

// Checks the website and the API every 30 seconds for the status picture in the status room.
// Two failed checks in a row (about a minute) mark it down on the picture; when it is back, the
// outage is recorded on the site. Down/back messages in Discord are not posted from here: the
// outside checker (uptime-worker/, a Cloudflare Worker) does that, and can even when this
// server is down.
//
// The website is checked through its public address (Cloudflare, then this server). Before
// marking it down, the bot also asks the web container directly: if that answers, the site is
// up and only the way in from the internet is failing, which often clears by itself, so it
// waits longer (FAILURES_FOR_PATH_DOWN).

type Target = "web" | "api";

type State = {
  up: boolean; failures: number; downSince: Date | null; detail: string;
  /** Result of each check (about a day of them), and how long the last one took. */
  history: boolean[]; latencyMs: number | null;
};

const targets: { key: Target; name: string; url: string; internal?: string }[] = [
  { key: "web", name: "เว็บไซต์", url: STATUS_WEB_URL, internal: STATUS_WEB_INTERNAL_URL || undefined },
  { key: "api", name: "API", url: STATUS_API_URL },
];

const state: Record<Target, State> = {
  web: { up: true, failures: 0, downSince: null, detail: "", history: [], latencyMs: null },
  api: { up: true, failures: 0, downSince: null, detail: "", history: [], latencyMs: null },
};
const botHistory: boolean[] = [];
const HISTORY_LIMIT = 2880;
const CHECK_EVERY_MS = 30000;

const FAILURES_FOR_DOWN = 2;
/** Failed public checks (about 3 minutes) before marking it down while the web container still answers. */
const FAILURES_FOR_PATH_DOWN = 6;

let onChange: () => void = () => undefined;

/** Whether the website and the API answered at the last check, for the stats channel. */
export function siteUp() {
  return state.web.up && state.api.up;
}

// How far one check got, for the log line when it fails: the address it connected to and when
// (ms after the start) the name lookup, the connection and the TLS handshake finished.
type Trace = { started: number; address?: string; dnsMs?: number; connectMs?: number; tlsMs?: number };

function watch(socket: Duplex, trace: Trace) {
  const since = () => Date.now() - trace.started;
  socket.once("lookup", () => { trace.dnsMs = since(); });
  // remoteAddress is often empty by the time "connect" fires; each attempt names the address it tries.
  socket.on("connectionAttempt", (ip: string) => { trace.address = ip; });
  socket.once("connect", () => { trace.connectMs = since(); });
  socket.once("secureConnect", () => { trace.tlsMs = since(); });
}

// A fresh agent per check (no kept-alive sockets), so every check makes and times its own connection.
class TracedHttpAgent extends http.Agent {
  constructor(private trace: Trace) { super({ keepAlive: false }); }
  createConnection(options: http.ClientRequestArgs, callback?: (error: Error | null, stream: Duplex) => void) {
    const socket = super.createConnection(options, callback);
    if (socket) watch(socket, this.trace);
    return socket;
  }
}

class TracedHttpsAgent extends https.Agent {
  constructor(private trace: Trace) { super({ keepAlive: false }); }
  createConnection(options: https.RequestOptions, callback?: (error: Error | null, stream: Duplex) => void) {
    const socket = super.createConnection(options, callback);
    if (socket) watch(socket, this.trace);
    return socket;
  }
}

function describe(trace: Trace, end: string, ms: number) {
  const step = (value?: number) => (value === undefined ? "-" : `${value}ms`);
  return `${end} ip=${trace.address ?? "-"} dns=${step(trace.dnsMs)} connect=${step(trace.connectMs)} tls=${step(trace.tlsMs)} total=${ms}ms`;
}

/** One check. `trace` says how far it got, for the log; it is only filled in when it fails. */
export async function check(url: string, timeoutMs = 10000): Promise<{ problem: string; ms: number; trace: string }> {
  const trace: Trace = { started: Date.now() };
  const agents = { httpAgent: new TracedHttpAgent(trace), httpsAgent: new TracedHttpsAgent(trace) };
  try {
    const res = await axios.get(url, { timeout: timeoutMs, maxRedirects: 3, validateStatus: () => true, headers: { "User-Agent": "NexoraStatusBot/1.0" }, ...agents });
    const ms = Date.now() - trace.started;
    // A 4xx still means the site is up and answering (a login page, the lockdown page).
    if (res.status < 500) return { problem: "", ms, trace: "" };
    return { problem: `HTTP ${res.status}`, ms, trace: describe(trace, `status=${res.status} ray=${res.headers["cf-ray"] ?? "-"}`, ms) };
  } catch (error) {
    const ms = Date.now() - trace.started;
    const code = axios.isAxiosError(error) ? error.code : undefined;
    const problem = code === "ECONNABORTED" || code === "ETIMEDOUT"
      ? `ไม่ตอบภายใน ${Math.ceil(timeoutMs / 1000)} วินาที`
      : `เชื่อมต่อไม่ได้ (${code ?? "network"})`;
    return { problem, ms, trace: describe(trace, `code=${code ?? "-"}`, ms) };
  }
}

/**
 * Whether a run of failed checks should now be posted as down, and with what reason (null: not yet).
 * `internal` is the direct check of the container: undefined when there is none, "" when it answered.
 */
export function downReason(problem: string, failures: number, internal?: string): string | null {
  if (failures < FAILURES_FOR_DOWN) return null;
  if (internal !== "") return problem;
  if (failures < FAILURES_FOR_PATH_DOWN) return null;
  return `${problem}\nตัวเว็บยังทำงานอยู่ แต่เข้าผ่านอินเทอร์เน็ตไม่ได้`;
}

// The API is checked over the internal network (api:8080); the picture shows its public name.
const TARGET_HOSTS: Record<Target, string> = {
  web: hostOf(STATUS_WEB_URL),
  api: hostOf(STATUS_API_URL).includes(".") ? hostOf(STATUS_API_URL) : `api.${hostOf(PUBLIC_APP_URL)}`,
};

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function push(history: boolean[], up: boolean) {
  history.push(up);
  if (history.length > HISTORY_LIMIT) history.shift();
}

const uptimeOf = (history: boolean[]) => (history.length ? (history.filter(Boolean).length / history.length) * 100 : 100);

// The status picture: one message in the status room, edited with a fresh picture whenever
// something changes and at least every 5 minutes.

let lastPictureAt = 0;
let lastPictureKey = "";

export async function refreshStatusPicture(client: Client, force = false) {
  const current = settings();
  const guild = homeGuild(client);
  if (!guild) return;
  if (!current?.statusEnabled || !current.statusImage || !current.statusChannelId) {
    await removePanel(guild, "status").catch(() => undefined);
    lastPictureKey = "";
    return;
  }
  const rows: StatusRow[] = [
    ...targets.map((target) => {
      const s = state[target.key];
      return { label: target.name, up: s.up, detail: s.up ? TARGET_HOSTS[target.key] : s.detail, latencyMs: s.up ? s.latencyMs : null, uptime: uptimeOf(s.history), history: s.history };
    }),
    { label: "บอท Discord", up: client.isReady(), detail: "ออนไลน์", latencyMs: client.ws.ping >= 0 ? Math.round(client.ws.ping) : null, uptime: uptimeOf(botHistory), history: botHistory },
  ];
  const key = rows.map((row) => `${row.label}:${row.up}`).join("|");
  // A new picture after every check (30 seconds), so the numbers on it are fresh.
  if (!force && key === lastPictureKey && Date.now() - lastPictureAt < CHECK_EVERY_MS - 5000) return;
  const picture = await statusCard(rows, "NEXORA CLOUD");
  await postPanel(guild, "status", current.statusChannelId, { files: [new AttachmentBuilder(picture, { name: "status.png" })] }, false);
  lastPictureKey = key;
  lastPictureAt = Date.now();
}

/** An outage that just ended, kept on the site (admin page: what the bot on the server saw). */
async function recordIncident(target: (typeof targets)[number], s: State, since: Date) {
  await api().post("/api/internal/bot/community/incidents", { target: target.key, startedAt: since.toISOString(), endedAt: new Date().toISOString(), detail: s.detail })
    .catch((error) => logBotError("record incident", error));
}

async function checkAll(client: Client) {
  // Both checks go out at once, so a slow one does not hold up the other or the picture.
  const results = await Promise.all(targets.map((target) => check(target.url)));
  for (const [index, target] of targets.entries()) {
    const s = state[target.key];
    const { problem, ms, trace } = results[index];
    s.latencyMs = ms;
    push(s.history, !problem);
    if (problem) {
      s.failures += 1;
      s.detail = problem;
      s.downSince ||= new Date();
      console.warn(`[WARN] ${target.key} check ${s.failures} failed: ${problem} (${trace})`);
      if (!s.up || s.failures < FAILURES_FOR_DOWN) continue;
      let internal: string | undefined;
      if (target.internal) {
        const direct = await check(target.internal, 5000);
        internal = direct.problem;
        console.warn(`[WARN] ${target.key} direct check: ${direct.problem || `answered in ${direct.ms}ms`}${direct.trace ? ` (${direct.trace})` : ""}`);
      }
      const reason = downReason(problem, s.failures, internal);
      if (reason) {
        s.detail = reason;
        s.up = false;
        console.warn(`[WARN] ${target.key} is down: ${reason.replace("\n", " / ")}`);
        onChange();
      }
    } else {
      const since = s.downSince;
      const wasDown = !s.up;
      s.failures = 0;
      s.downSince = null;
      s.up = true;
      if (wasDown && since) {
        console.log(`[INFO] ${target.key} is back`);
        await recordIncident(target, s, since);
        onChange();
      }
    }
  }
  push(botHistory, client.isReady());
  await refreshStatusPicture(client).catch((error) => logBotError("status picture", error));
}

export function startStatusChecks(client: Client, changed: () => void) {
  onChange = changed;
  void checkAll(client);
  setInterval(() => void checkAll(client).catch((error) => logBotError("status check", error)), CHECK_EVERY_MS).unref();
}
