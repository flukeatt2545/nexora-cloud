// The checker's decisions, with fake KV, API, Discord and network: nothing here touches the internet.
import assert from "node:assert/strict";
import test from "node:test";
import { type ApiConfig, decide, DEFAULTS, type Deps, type Probe, type Report, run, type Settings, type State } from "../src/checker.ts";
import type { WebhookMessage } from "../src/discord.ts";

const OK: Probe = { ok: true, status: 200, ms: 120, colo: "SIN", error: "" };
const FAIL: Probe = { ok: false, status: 0, ms: 10000, colo: "SIN", error: "ไม่ตอบภายใน 10 วินาที" };
const BAD: Probe = { ok: false, status: 502, ms: 300, colo: "KIX", error: "" };

const ROLE = "123456789012345678";
const SETTINGS: Settings = { ...DEFAULTS, targets: [{ id: "web", name: "เว็บไซต์", url: "https://nkn02.com" }], mentionRoleId: ROLE };

/** A world the checker runs in: settings from the API (or not), answers per request, and what it sent. */
function world(options: { api?: ApiConfig | null; reportOk?: boolean } = {}) {
  const store = new Map<string, string>();
  const w = {
    clock: new Date("2026-10-29T08:35:00Z"),
    answers: [] as Probe[],
    api: options.api === undefined ? { settings: SETTINGS, testRequestedAt: null } as ApiConfig | null : options.api,
    reportOk: options.reportOk ?? true,
    reports: [] as Report[],
    sent: [] as WebhookMessage[],
    edited: [] as { id: string; message: WebhookMessage }[],
    kvWrites: 0,
    slept: 0,
    store,
  };
  const deps: Deps = {
    now: () => new Date(w.clock),
    sleep: async (ms) => { w.slept += ms; w.clock = new Date(w.clock.getTime() + ms); },
    probe: async () => {
      const answer = w.answers.shift();
      if (!answer) throw new Error("the checker asked for more requests than the test planned");
      return answer;
    },
    kv: {
      get: async (key) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
      put: async (key, value) => { w.kvWrites++; store.set(key, value); },
    },
    getConfig: async () => w.api,
    report: async (report) => { w.reports.push(report); return w.reportOk; },
    webhook: {
      send: async (message) => { w.sent.push(message); return `m${w.sent.length}`; },
      edit: async (id, message) => { w.edited.push({ id, message }); return true; },
    },
    log: () => undefined,
  };
  /** One minute later, one run with these answers. */
  async function round(...answers: Probe[]) {
    w.answers.push(...answers);
    const state = await run(deps);
    assert.equal(w.answers.length, 0, "the checker did not use every planned answer");
    w.clock = new Date(w.clock.getTime() + 60_000);
    return state;
  }
  return { w, round };
}

const kvState = (store: Map<string, string>) => JSON.parse(store.get("state") ?? "null") as State;

test("decide: counts failed rounds and goes down at the threshold", () => {
  let { next, step } = decide(undefined, false, "t1", "HTTP 502", 2);
  assert.deepEqual(step, { kind: "none" });
  assert.equal(next.failures, 1);
  ({ next, step } = decide(next, false, "t2", "later reason", 2));
  assert.deepEqual(step, { kind: "down", since: "t1", detail: "HTTP 502" });
  const down = next;
  ({ next, step } = decide(down, false, "t3", "x", 2));
  assert.equal(next, down, "a target that is already down keeps the same state, so KV is not written");
  ({ step } = decide(down, true, "t4", "", 2));
  assert.equal(step.kind, "back");
});

test("decide: failed rounds that stop before the threshold are minor", () => {
  const { next } = decide(undefined, false, "t1", "HTTP 502", 3);
  const { step } = decide(next, true, "t2", "", 3);
  assert.deepEqual(step, { kind: "minor", since: "t1", rounds: 1, detail: "HTTP 502" });
});

test("a failure that passes on the retry 15 seconds later is a blip, not a failed round", async () => {
  const { w, round } = world();
  const state = await round(FAIL, OK);
  assert.equal(w.slept, 15_000);
  assert.equal(state.targets.web.failures, 0);
  const report = w.reports[0];
  assert.equal(report.checks[0].ok, true);
  assert.equal(report.checks[0].retried, true);
  assert.equal(report.incidents[0].kind, "minor");
  assert.match(report.incidents[0].detail, /ลองใหม่ 15 วินาทีแล้วผ่าน/);
  assert.equal(w.sent.length, 1, "quiet mode posts one grey message");
  assert.equal(w.sent[0].embeds[0].title, "เว็บไซต์สะดุด");
  assert.equal(w.sent[0].content, undefined, "nobody is tagged for a blip");
  assert.deepEqual(w.sent[0].allowed_mentions, { parse: [] });
});

test("two failed rounds post one red alert with the role; the third posts nothing and writes nothing", async () => {
  const { w, round } = world();
  await round(BAD, BAD);
  assert.equal(w.sent.length, 0, "one failed round is not an alert");
  await round(BAD, FAIL);
  assert.equal(w.sent.length, 1);
  const alert = w.sent[0];
  assert.equal(alert.embeds[0].title, "เว็บไซต์ล่ม");
  assert.equal(alert.embeds[0].color, 0xff3b4a);
  assert.equal(alert.embeds[0].author.name, "NEXORA CLOUD · STATUS");
  assert.match(alert.embeds[0].description, /<t:\d+:t> \(<t:\d+:R>\)/);
  assert.match(alert.embeds[0].description, /สาเหตุ: HTTP 502 · 300 ms · เช็กจาก KIX/);
  assert.equal(alert.content, `<@&${ROLE}>`);
  assert.deepEqual(alert.allowed_mentions.roles, [ROLE]);
  assert.equal(kvState(w.store).targets.web.alertId, "m1");
  const incident = w.reports[1].incidents.find((item) => item.kind === "down");
  assert.equal(incident?.endedAt, null);

  const writes = w.kvWrites;
  await round(BAD, BAD);
  assert.equal(w.sent.length, 1, "no second alert while it stays down");
  assert.equal(w.kvWrites, writes, "nothing changed, so KV is not written");
});

test("back: the old alert turns orange, a green message follows, and the outage is closed", async () => {
  const { w, round } = world();
  await round(BAD, BAD);
  await round(BAD, BAD);
  await round(OK);
  assert.equal(w.edited.length, 1);
  assert.equal(w.edited[0].id, "m1");
  assert.equal(w.edited[0].message.embeds[0].color, 0xf59e0b);
  assert.match(w.edited[0].message.embeds[0].footer!.text, /กลับมาแล้ว · ล่มไป 2 นาที/);
  assert.deepEqual(w.edited[0].message.allowed_mentions, { parse: [] }, "the edit pings nobody again");
  const back = w.sent.at(-1)!;
  assert.equal(back.embeds[0].title, "เว็บไซต์กลับมาใช้ได้แล้ว");
  assert.equal(back.embeds[0].color, 0x3ddc97);
  assert.match(back.embeds[0].description, /^ล่มไป 2 นาที \(<t:\d+:t> – <t:\d+:t>\)$/);
  const closed = w.reports.at(-1)!.incidents.find((item) => item.kind === "down");
  assert.ok(closed?.endedAt);
  assert.equal(kvState(w.store).targets.web.down, false);
});

test("a failed round under the threshold, then a good one, is recorded as minor without tagging", async () => {
  const { w, round } = world();
  await round(BAD, BAD);
  await round(OK);
  const minor = w.reports.at(-1)!.incidents[0];
  assert.equal(minor.kind, "minor");
  assert.match(minor.detail, /พลาด 1 รอบ/);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].content, undefined);
});

test("minor mode off posts nothing; daily keeps them for one summary the next day", async () => {
  const off = world({ api: { settings: { ...SETTINGS, minorMode: "off" }, testRequestedAt: null } });
  await off.round(FAIL, OK);
  assert.equal(off.w.sent.length, 0);
  assert.equal(off.w.reports[0].incidents.length, 1, "still recorded for the admin page");

  const daily = world({ api: { settings: { ...SETTINGS, minorMode: "daily" }, testRequestedAt: null } });
  await daily.round(FAIL, OK);
  assert.equal(daily.w.sent.length, 0);
  assert.equal(kvState(daily.w.store).digest.items.length, 1);
  daily.w.clock = new Date("2026-10-30T00:30:00Z"); // 07:30 in Bangkok, the next day
  await daily.round(OK);
  assert.equal(daily.w.sent.length, 1);
  assert.match(daily.w.sent[0].embeds[0].title, /สรุปการสะดุดของวันที่ 2026-10-29/);
  assert.equal(kvState(daily.w.store).digest.items.length, 0);
});

test("settings: the API's copy is kept in KV, used when the API is down, and defaults are the last resort", async () => {
  const { w, round } = world();
  await round(OK);
  assert.ok(w.store.has("config"));
  const writes = w.kvWrites;
  await round(OK);
  assert.equal(w.kvWrites, writes, "the same settings are not written again");

  // The server goes down: the saved copy (one target, the role) still applies.
  w.api = null;
  await round(BAD, BAD);
  await round(BAD, BAD);
  assert.equal(w.sent.at(-1)!.content, `<@&${ROLE}>`, "the role from the saved copy is used");

  // Nothing ever saved: the default two targets are checked.
  const empty = world({ api: null });
  await empty.round(OK, OK);
  assert.deepEqual(empty.w.reports[0].checks.map((check) => check.targetId), ["web", "api"]);
});

test("results wait in KV while the API is down and go out with the next report", async () => {
  const { w, round } = world({ reportOk: false });
  await round(OK);
  await round(OK);
  assert.equal(kvState(w.store).queue.checks.length, 2);
  w.reportOk = true;
  await round(OK);
  assert.equal(w.reports.at(-1)!.checks.length, 3, "two queued and this run's");
  assert.equal(kvState(w.store).queue.checks.length, 0);
});

test("a test message is sent once per request, without pinging the role", async () => {
  const { w, round } = world({ api: { settings: SETTINGS, testRequestedAt: "2026-10-29T08:34:00Z" } });
  await round(OK);
  await round(OK);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].embeds[0].title, /^ทดสอบ/);
  assert.deepEqual(w.sent[0].allowed_mentions, { parse: [] });
  assert.equal(w.reports[0].test?.error, "");
});

test("a turned-off checker checks nothing", async () => {
  const { w, round } = world({ api: { settings: { ...SETTINGS, enabled: false }, testRequestedAt: null } });
  await round();
  assert.equal(w.reports.length, 0);
});
