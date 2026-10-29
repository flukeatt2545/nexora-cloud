// The decisions of the outside uptime checker, kept apart from Cloudflare and the network so the
// tests can drive them: what one round of checks means, when to post that something is down or
// back, and which settings to use when the API cannot be reached.
//
// One run (every minute):
//   1. settings: from the API (and keep a copy in KV); else the copy in KV; else DEFAULTS
//   2. a test message, if the admin asked for one since the last run
//   3. check every target; a failure is tried once more 15 seconds later, and if that passes
//      the round counts as good (a "blip", noted but not counted)
//   4. FAILURES_FOR_DOWN failed rounds in a row post "down"; the next good round posts "back"
//      (and turns the old alert orange). Failed rounds that end before that are "minor".
//   5. send the results to the API; if it does not answer, keep them in KV and send them later
//
// KV holds two keys: "config" (the last settings from the API) and "state" (per target: failing
// or down since when, and the alert's message id; plus the queue and the daily summary). Both
// are written only when they change, so a quiet day costs no KV writes.

import { backEmbed, blipEmbed, digestEmbed, downEmbed, minorEmbed, testEmbed, type WebhookMessage } from "./discord.ts";

export type Target = { id: string; name: string; url: string; enabled?: boolean };
export type MinorMode = "off" | "quiet" | "daily";

export type Settings = {
  enabled: boolean;
  targets: Target[];
  failuresForDown: number;
  slowMs: number;
  mentionRoleId: string;
  senderName: string;
  minorMode: MinorMode;
};

/** Used when the API has never answered and KV has no copy: check the two main addresses. */
export const DEFAULTS: Settings = {
  enabled: true,
  targets: [
    { id: "web", name: "เว็บไซต์", url: "https://nkn02.com", enabled: true },
    { id: "api", name: "API", url: "https://api.nkn02.com/health", enabled: true },
  ],
  failuresForDown: 2,
  slowMs: 3000,
  mentionRoleId: "",
  senderName: "NEXORA CLOUD",
  minorMode: "quiet",
};

export const TIMEOUT_MS = 10_000;
export const RETRY_AFTER_MS = 15_000;
const QUEUE_MAX_CHECKS = 3000;
const QUEUE_MAX_INCIDENTS = 300;
const DIGEST_MAX = 50;

/** What one request to a target came back with. */
export type Probe = { ok: boolean; status: number; ms: number; colo: string; error: string };

export type TargetState = {
  /** Failed rounds in a row (stops counting once it is down, so the state does not change every minute). */
  failures: number;
  down: boolean;
  /** When the first failed round of this run of failures happened. */
  since?: string;
  /** Why the first round failed, for the alert. */
  detail?: string;
  /** The Discord message that said it was down, to turn orange when it is back. */
  alertId?: string;
};

export type CheckReport = { targetId: string; checkedAt: string; ok: boolean; status: number; latencyMs: number; colo: string; error: string; retried: boolean; slow: boolean };
export type IncidentReport = { targetId: string; targetName: string; kind: "down" | "minor"; startedAt: string; endedAt: string | null; detail: string };
export type Report = { checks: CheckReport[]; incidents: IncidentReport[]; test?: { sentAt: string; error: string } };
export type DigestItem = { name: string; at: string; detail: string };

export type State = {
  targets: Record<string, TargetState>;
  /** Results the API has not taken yet. */
  queue: Report;
  /** Minor failures saved for the daily summary, and the (Bangkok) day they belong to. */
  digest: { day: string; items: DigestItem[] };
  /** The test request already handled, so it is sent once. */
  testHandled?: string;
};

export function emptyState(): State {
  return { targets: {}, queue: { checks: [], incidents: [] }, digest: { day: "", items: [] } };
}

export type Step =
  | { kind: "none" }
  | { kind: "down"; since: string; detail: string }
  | { kind: "back"; since: string; alertId?: string; detail: string }
  | { kind: "minor"; since: string; rounds: number; detail: string };

/** What a round means for one target, given how it stood before. */
export function decide(prev: TargetState | undefined, ok: boolean, at: string, detail: string, failuresForDown: number): { next: TargetState; step: Step } {
  const before: TargetState = prev ?? { failures: 0, down: false };
  if (ok) {
    if (before.down) return { next: { failures: 0, down: false }, step: { kind: "back", since: before.since ?? at, alertId: before.alertId, detail: before.detail ?? "" } };
    if (before.failures > 0) return { next: { failures: 0, down: false }, step: { kind: "minor", since: before.since ?? at, rounds: before.failures, detail: before.detail ?? "" } };
    return { next: before, step: { kind: "none" } };
  }
  if (before.down) return { next: before, step: { kind: "none" } };
  const next: TargetState = { failures: before.failures + 1, down: false, since: before.since ?? at, detail: before.detail ?? detail };
  if (next.failures >= failuresForDown) {
    next.down = true;
    return { next, step: { kind: "down", since: next.since!, detail: next.detail! } };
  }
  return { next, step: { kind: "none" } };
}

/** "HTTP 502 · 1234 ms · เช็กจาก SIN" */
export function describe(probe: Probe): string {
  return [probe.error || `HTTP ${probe.status}`, `${probe.ms} ms`, probe.colo ? `เช็กจาก ${probe.colo}` : ""].filter(Boolean).join(" · ");
}

/** Settings from the API as the Worker trusts them: anything odd falls back to the default. */
export function cleanSettings(raw: unknown): Settings | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Settings>;
  if (!Array.isArray(value.targets)) return null;
  const targets = value.targets.filter((target): target is Target =>
    Boolean(target) && typeof target.id === "string" && typeof target.name === "string" && /^https?:\/\//.test(String(target.url)) && target.enabled !== false);
  const failures = Number(value.failuresForDown);
  const slow = Number(value.slowMs);
  return {
    enabled: value.enabled === true,
    targets,
    failuresForDown: Number.isInteger(failures) && failures >= 1 && failures <= 10 ? failures : DEFAULTS.failuresForDown,
    slowMs: Number.isFinite(slow) && slow >= 500 ? slow : DEFAULTS.slowMs,
    mentionRoleId: /^[0-9]{17,20}$/.test(String(value.mentionRoleId)) ? String(value.mentionRoleId) : "",
    senderName: typeof value.senderName === "string" && value.senderName.trim() ? value.senderName.trim().slice(0, 80) : DEFAULTS.senderName,
    minorMode: value.minorMode === "off" || value.minorMode === "daily" ? value.minorMode : "quiet",
  };
}

export type ApiConfig = { settings: unknown; testRequestedAt: string | null };

export interface KV {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

export interface Webhook {
  /** Posts a message; resolves to its id, or null when Discord did not take it. */
  send(message: WebhookMessage): Promise<string | null>;
  edit(id: string, message: WebhookMessage): Promise<boolean>;
}

export interface Deps {
  now(): Date;
  sleep(ms: number): Promise<void>;
  probe(url: string, timeoutMs: number): Promise<Probe>;
  kv: KV;
  /** null when the API did not answer. */
  getConfig(): Promise<ApiConfig | null>;
  /** true when the API took the report. */
  report(report: Report): Promise<boolean>;
  /** null when no webhook URL is set; the checks still run and reach the admin page. */
  webhook: Webhook | null;
  log(line: string): void;
}

/** Settings for this run, and where they came from. */
export async function loadSettings(deps: Deps): Promise<{ settings: Settings; source: "api" | "copy" | "default"; testRequestedAt: string | null }> {
  const fromApi = await deps.getConfig().catch(() => null);
  const settings = fromApi ? cleanSettings(fromApi.settings) : null;
  if (fromApi && settings) {
    const copy = await deps.kv.get("config", "json").catch(() => null);
    if (JSON.stringify(copy) !== JSON.stringify(settings)) await deps.kv.put("config", JSON.stringify(settings));
    return { settings, source: "api", testRequestedAt: fromApi.testRequestedAt };
  }
  const copy = cleanSettings(await deps.kv.get("config", "json").catch(() => null));
  if (copy) return { settings: copy, source: "copy", testRequestedAt: null };
  return { settings: DEFAULTS, source: "default", testRequestedAt: null };
}

/** Today in Bangkok, for the daily summary: "2026-10-29". */
export function bangkokDay(at: Date) {
  return new Date(at.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** One check with the retry: the result that counts, and whether the first try failed. */
async function checkTarget(deps: Deps, target: Target) {
  const first = await deps.probe(target.url, TIMEOUT_MS);
  if (first.ok) return { result: first, firstFailure: null as Probe | null, startedAt: deps.now() };
  const firstAt = deps.now();
  await deps.sleep(RETRY_AFTER_MS);
  const second = await deps.probe(target.url, TIMEOUT_MS);
  return { result: second, firstFailure: first, startedAt: firstAt };
}

export async function run(deps: Deps): Promise<State> {
  const { settings, source, testRequestedAt } = await loadSettings(deps);
  const saved = await deps.kv.get("state", "json").catch(() => null);
  const state: State = saved && typeof saved === "object" ? { ...emptyState(), ...(saved as State) } : emptyState();
  const before = JSON.stringify(state);
  const fresh: Report = { checks: [], incidents: [] };
  const sender = settings.senderName;

  if (source !== "api") deps.log(`[uptime] API did not answer; using ${source === "copy" ? "the saved copy of the settings" : "the default settings"}`);

  // A test message, once per request from the admin page.
  if (testRequestedAt && testRequestedAt !== state.testHandled) {
    const id = deps.webhook ? await deps.webhook.send(testEmbed(sender, settings.mentionRoleId)) : null;
    fresh.test = { sentAt: deps.now().toISOString(), error: deps.webhook ? (id ? "" : "Discord ไม่รับข้อความ ตรวจ webhook URL") : "ยังไม่ได้ตั้ง webhook URL ใน Worker" };
    state.testHandled = testRequestedAt;
  }

  // The daily summary of the day before, at the first run of a new day.
  const today = bangkokDay(deps.now());
  if (state.digest.day !== today) {
    if (state.digest.items.length && settings.minorMode === "daily" && deps.webhook) await deps.webhook.send(digestEmbed(sender, state.digest.day, state.digest.items));
    state.digest = { day: today, items: [] };
  }

  const targets = settings.enabled ? settings.targets : [];
  const results = await Promise.all(targets.map((target) => checkTarget(deps, target)));
  for (const [index, target] of targets.entries()) {
    const { result, firstFailure, startedAt } = results[index];
    const at = deps.now().toISOString();
    const detail = describe(result);
    fresh.checks.push({
      targetId: target.id, checkedAt: at, ok: result.ok, status: result.status, latencyMs: result.ms, colo: result.colo,
      error: result.ok ? "" : detail, retried: Boolean(firstFailure), slow: result.ok && result.ms >= settings.slowMs,
    });

    // Failed, then passed 15 seconds later: a blip. Noted, never counted towards "down".
    if (firstFailure && result.ok) {
      const blipDetail = `ลองใหม่ 15 วินาทีแล้วผ่าน · ครั้งแรก: ${describe(firstFailure)}`;
      fresh.incidents.push({ targetId: target.id, targetName: target.name, kind: "minor", startedAt: startedAt.toISOString(), endedAt: at, detail: blipDetail });
      await minor(deps, state, settings, blipEmbed(sender, target.name, startedAt, blipDetail), { name: target.name, at: startedAt.toISOString(), detail: blipDetail });
    }

    const { next, step } = decide(state.targets[target.id], result.ok, at, firstFailure ? `${detail} (ลองซ้ำแล้วก็ไม่ผ่าน)` : detail, settings.failuresForDown);
    state.targets[target.id] = next;
    if (step.kind === "down") {
      deps.log(`[uptime] ${target.id} is down: ${step.detail}`);
      fresh.incidents.push({ targetId: target.id, targetName: target.name, kind: "down", startedAt: step.since, endedAt: null, detail: step.detail });
      const id = deps.webhook ? await deps.webhook.send(downEmbed(sender, target.name, new Date(step.since), step.detail, settings.mentionRoleId)) : null;
      if (id) next.alertId = id;
    } else if (step.kind === "back") {
      deps.log(`[uptime] ${target.id} is back`);
      fresh.incidents.push({ targetId: target.id, targetName: target.name, kind: "down", startedAt: step.since, endedAt: at, detail: step.detail });
      if (deps.webhook) {
        const since = new Date(step.since);
        const end = new Date(at);
        if (step.alertId) await deps.webhook.edit(step.alertId, downEmbed(sender, target.name, since, step.detail, settings.mentionRoleId, end));
        await deps.webhook.send(backEmbed(sender, target.name, since, end));
      }
    } else if (step.kind === "minor") {
      const minorDetail = `พลาด ${step.rounds} รอบ (ยังไม่ถึง ${settings.failuresForDown} รอบที่ต้องแจ้ง) · ${step.detail}`;
      fresh.incidents.push({ targetId: target.id, targetName: target.name, kind: "minor", startedAt: step.since, endedAt: at, detail: minorDetail });
      await minor(deps, state, settings, minorEmbed(sender, target.name, new Date(step.since), new Date(at), minorDetail), { name: target.name, at: step.since, detail: minorDetail });
    }
  }
  // Targets taken off the list are forgotten.
  for (const id of Object.keys(state.targets)) if (!targets.some((target) => target.id === id) && settings.enabled) delete state.targets[id];

  // Send what is queued plus this run; keep it all if the API does not take it.
  const outgoing: Report = {
    checks: [...state.queue.checks, ...fresh.checks],
    incidents: [...state.queue.incidents, ...fresh.incidents],
    ...(fresh.test ?? state.queue.test ? { test: fresh.test ?? state.queue.test } : {}),
  };
  const hasSomething = outgoing.checks.length || outgoing.incidents.length || outgoing.test;
  const delivered = hasSomething ? await deps.report(outgoing).catch(() => false) : true;
  state.queue = delivered ? { checks: [], incidents: [] } : {
    checks: outgoing.checks.slice(-QUEUE_MAX_CHECKS),
    incidents: outgoing.incidents.slice(-QUEUE_MAX_INCIDENTS),
    ...(outgoing.test ? { test: outgoing.test } : {}),
  };

  if (JSON.stringify(state) !== before) await deps.kv.put("state", JSON.stringify(state));
  return state;
}

/** A failure that stayed under the alert: posted quietly, saved for the day's summary, or neither. */
async function minor(deps: Deps, state: State, settings: Settings, message: WebhookMessage, item: DigestItem) {
  if (settings.minorMode === "quiet" && deps.webhook) await deps.webhook.send(message);
  if (settings.minorMode === "daily" && state.digest.items.length < DIGEST_MAX) state.digest.items.push(item);
}
