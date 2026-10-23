"use client";

// What the Discord bot pages share: the API shapes, calls, status wording and the bot avatar.
import { API_BASE } from "../runtime";

export type BotRuntime = "node" | "python";
export type BotStatus = "stopped" | "queued" | "building" | "starting" | "running" | "crashed" | "error";
export type BotPending = { kind: string; state: string; phase: string } | null;

export type Bot = {
  id: string;
  name: string;
  runtime: BotRuntime;
  entryFile: string;
  startMode: "entry" | "npm_start";
  status: BotStatus;
  statusMessage: string;
  lastExitCode: number | null;
  restartCount: number;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  pending: BotPending;
  source: { kind: "zip" | "github" | "template"; githubRepo: string; githubRef: string; hasCode: boolean; updatedAt: string | null; pendingChanges: boolean };
  resources: { cpuMillicores: number; memoryMb: number; diskLimitMb: number; diskUsedMb: number | null };
  discord: { id: string; username: string; avatarUrl: string; inviteUrl: string; tokenVariable: string; tokenState: "unknown" | "valid" | "invalid"; checkedAt: string | null; hasToken: boolean };
  owner?: { id: number; username: string };
};

export type BotLogLine = { id: number; stream: "system" | "stdout" | "stderr"; message: string; at: string };
export type SourceReport = { files: number; skipped: number; envDropped: boolean; envNames: string[] | null; entryFile?: string; entryMissing: boolean };
export type BotFileItem = { path: string; isDir: boolean; size: number; editable: boolean };
export type BotEnvItem = { name: string; value: string; isSecret: boolean; isToken: boolean; updatedAt: string };

export async function botApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...options,
      headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error("ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง");
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ทำรายการไม่สำเร็จ");
  return payload as T;
}

/** A random request id. randomUUID only exists on HTTPS pages, so plain HTTP builds one itself. */
export function requestKey() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A request that changes something; the key lets the server ignore an accidental double send. */
export function botSend(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Idempotency-Key": requestKey() },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  };
}

/**
 * Uploads a ZIP with progress. fetch cannot report upload progress, so this one uses XHR.
 */
export function uploadBotZip(botId: string, file: File, restart: boolean, onProgress: (percent: number) => void) {
  return new Promise<{ queued: boolean; source: SourceReport }>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("restart", restart ? "true" : "false");
    const request = new XMLHttpRequest();
    request.open("POST", `${API_BASE}/api/bots/${encodeURIComponent(botId)}/deploy`);
    request.withCredentials = true;
    request.setRequestHeader("Idempotency-Key", requestKey());
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      let payload: { error?: string } & Record<string, unknown> = {};
      try { payload = JSON.parse(request.responseText || "{}"); } catch { /* not JSON */ }
      if (request.status >= 200 && request.status < 300) resolve(payload as unknown as { queued: boolean; source: SourceReport });
      else reject(new Error(payload.error || "อัปโหลดไม่สำเร็จ"));
    };
    request.onerror = () => reject(new Error("อัปโหลดไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง"));
    request.send(form);
  });
}

export const runtimeLabel: Record<BotRuntime, string> = { node: "Node.js", python: "Python" };
export const runtimeLibrary: Record<BotRuntime, string> = { node: "discord.js", python: "discord.py" };

export type StatusTone = "online" | "busy" | "off" | "bad";

/** What the status pill says, looking at a job in progress first. */
export function botStatusView(bot: Bot): { label: string; tone: StatusTone } {
  if (bot.pending) {
    const kind = bot.pending.kind;
    if (kind === "bot.stop") return { label: "กำลังปิด", tone: "busy" };
    if (kind === "bot.delete") return { label: "กำลังลบ", tone: "busy" };
    if (bot.status === "building") return { label: "กำลังติดตั้ง", tone: "busy" };
    if (bot.pending.state === "queued") return { label: "รอคิว", tone: "busy" };
    return { label: kind === "bot.restart" ? "กำลังรีสตาร์ต" : "กำลังเปิด", tone: "busy" };
  }
  switch (bot.status) {
    case "running": return { label: "ออนไลน์", tone: "online" };
    case "starting": return { label: "กำลังเปิด", tone: "busy" };
    case "building": return { label: "กำลังติดตั้ง", tone: "busy" };
    case "queued": return { label: "รอคิว", tone: "busy" };
    case "crashed": return { label: "หยุดเพราะโค้ดมีปัญหา", tone: "bad" };
    case "error": return { label: "เปิดไม่สำเร็จ", tone: "bad" };
    default: return { label: "ปิดอยู่", tone: "off" };
  }
}

export function botIsBusy(bot: Bot) {
  return Boolean(bot.pending) || bot.status === "starting" || bot.status === "building" || bot.status === "queued";
}

export function botIsUp(bot: Bot) {
  return bot.status === "running" || bot.status === "starting" || bot.status === "building";
}

/** "3 ชม. 12 นาที" from a start time, short enough for a card. */
export function uptimeText(since: string | null, now: number) {
  if (!since) return "";
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  if (seconds < 60) return "ไม่ถึงนาที";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} ชม. ${minutes % 60} นาที` : `${hours} ชม.`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} วัน ${hours % 24} ชม.` : `${days} วัน`;
}

export function shortDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** The bot's Discord picture, or its first letter on a tile when no token is saved yet. */
export function BotAvatar({ bot, size = 44 }: { bot: Pick<Bot, "name" | "discord" | "runtime">; size?: number }) {
  const letter = (bot.discord.username || bot.name).replace(/^[\s"'<]+/, "").replace(/^[เแโใไ]/, "").charAt(0).toUpperCase() || "B";
  return (
    <span className={`bt-avatar is-${bot.runtime}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {bot.discord.avatarUrl ? <img src={bot.discord.avatarUrl} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" /> : letter}
    </span>
  );
}

export function StatusPill({ bot }: { bot: Bot }) {
  const view = botStatusView(bot);
  return (
    <span className={`bt-status is-${view.tone}`}>
      <span className="bt-dot" aria-hidden="true" />
      {view.label}
    </span>
  );
}
