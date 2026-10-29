/**
 * The outside uptime checker: a Cloudflare Worker run by a Cron Trigger every minute. It has no
 * public address (workers_dev is off); see checker.ts for what one run does.
 *
 * Bindings (wrangler.toml): UPTIME_KV, API_BASE. Secrets (wrangler secret put):
 * UPTIME_WORKER_SECRET (the same value as the API's), DISCORD_WEBHOOK_URL.
 */
import { type ApiConfig, type Deps, type KV, type Probe, type Report, run, type Webhook } from "./checker.ts";
import type { WebhookMessage } from "./discord.ts";

interface Env {
  UPTIME_KV: KV;
  API_BASE: string;
  UPTIME_WORKER_SECRET?: string;
  DISCORD_WEBHOOK_URL?: string;
}

// Cloudflare's runtime types are not installed; this is the part of the context used here.
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const USER_AGENT = "NexoraUptimeWorker/1.0";
const API_TIMEOUT_MS = 8000;

/** The colo that answered: the end of the cf-ray header ("8f1c2a3b4c5d6e7f-SIN"). */
function coloOf(response: Response) {
  return response.headers.get("cf-ray")?.split("-").pop()?.slice(0, 8) ?? "";
}

/** For a request that got no answer: the colo this Worker runs in, asked once per run. */
function traceColo() {
  let asked: Promise<string> | null = null;
  return () => {
    asked ??= fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(3000) })
      .then((response) => response.text())
      .then((text) => /^colo=(\w+)$/m.exec(text)?.[1] ?? "")
      .catch(() => "");
    return asked;
  };
}

function prober(colo: () => Promise<string>) {
  return async (url: string, timeoutMs: number): Promise<Probe> => {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Cache-Control": "no-cache" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ms = Date.now() - started;
      await response.body?.cancel();
      // The lockdown page (503 with X-Nexora-Lockdown) means the site is closed on purpose, not down.
      const lockdown = response.status === 503 && response.headers.get("x-nexora-lockdown") === "1";
      return { ok: response.status < 500 || lockdown, status: response.status, ms, colo: coloOf(response) || await colo(), error: "" };
    } catch (error) {
      const ms = Date.now() - started;
      const name = (error as Error)?.name;
      const text = name === "TimeoutError" || name === "AbortError"
        ? `ไม่ตอบภายใน ${Math.ceil(timeoutMs / 1000)} วินาที`
        : `เชื่อมต่อไม่ได้ (${String((error as Error)?.message ?? error).slice(0, 80)})`;
      return { ok: false, status: 0, ms, colo: await colo(), error: text };
    }
  };
}

function api(env: Env) {
  const base = env.API_BASE.replace(/\/+$/, "");
  const headers = { "X-Uptime-Worker-Secret": env.UPTIME_WORKER_SECRET ?? "", "User-Agent": USER_AGENT };
  return {
    async getConfig(): Promise<ApiConfig | null> {
      if (!env.UPTIME_WORKER_SECRET) return null;
      const response = await fetch(`${base}/api/uptime-worker/config`, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      return (await response.json()) as ApiConfig;
    },
    async report(report: Report): Promise<boolean> {
      if (!env.UPTIME_WORKER_SECRET) return false;
      const response = await fetch(`${base}/api/uptime-worker/report`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      await response.body?.cancel();
      return response.ok;
    },
  };
}

/** The webhook URL with a path added and its own query (thread_id) kept. */
function webhookUrl(base: string, path: string, wait: boolean) {
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/+$/, "") + path;
  if (wait) url.searchParams.set("wait", "true");
  return url.toString();
}

function webhook(env: Env, log: (line: string) => void): Webhook | null {
  const base = env.DISCORD_WEBHOOK_URL;
  if (!base) return null;
  // One retry when Discord asks to slow down.
  async function call(method: "POST" | "PATCH", url: string, body: WebhookMessage) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      if (response.status === 429 && attempt === 0) {
        const wait = Number((await response.json().catch(() => ({})) as { retry_after?: number }).retry_after ?? 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 5) * 1000));
        continue;
      }
      return response;
    }
    return null;
  }
  return {
    async send(message) {
      const response = await call("POST", webhookUrl(base, "", true), message).catch(() => null);
      if (!response?.ok) {
        log(`[uptime] Discord did not take the message (HTTP ${response?.status ?? "-"})`);
        await response?.body?.cancel();
        return null;
      }
      return ((await response.json()) as { id?: string }).id ?? null;
    },
    async edit(id, message) {
      const response = await call("PATCH", webhookUrl(base, `/messages/${id}`, false), message).catch(() => null);
      await response?.body?.cancel();
      return Boolean(response?.ok);
    },
  };
}

export function deps(env: Env): Deps {
  const log = (line: string) => console.log(line);
  return {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    probe: prober(traceColo()),
    kv: env.UPTIME_KV,
    ...api(env),
    webhook: webhook(env, log),
    log,
  };
}

export default {
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(run(deps(env)).catch((error) => console.error("[uptime] run failed", error)));
  },
  async fetch() {
    return new Response("Not Found", { status: 404 });
  },
};
