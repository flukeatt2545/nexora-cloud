"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Activity, Bell, Bot, CircleAlert, CircleCheck, CircleHelp, Cloud, History, ListChecks, Plus, Send, Trash2 } from "lucide-react";
import { ago, Card, Fields, LoadError, type Notice, Rows, SaveBar, Switch, SwitchRow } from "./DiscordBotParts";
import { api } from "./DiscordMailBotSettings";

// The outside uptime checker (uptime-worker/, a Cloudflare Worker): its settings and its results,
// next to what the Discord bot on the server saw. GET/PUT /api/admin/uptime, POST /api/admin/uptime/test.

export type UptimeSection = "results" | "settings";

type MinorMode = "off" | "quiet" | "daily";
type Target = { id: string; name: string; url: string; enabled: boolean };
type Settings = {
  enabled: boolean; targets: Target[]; failuresForDown: number; slowMs: number;
  mentionRoleId: string; senderName: string; minorMode: MinorMode; version: number;
};
type LastCheck = { checkedAt: string; ok: boolean; statusCode: number; latencyMs: number; colo: string; error: string; retried: boolean; slow: boolean };
type TargetResult = Target & { last: LastCheck | null; uptime24h: number | null; uptime7d: number | null; checks24h: number };
type Incident = { id: number; targetId: string; targetName: string; kind: "down" | "minor"; startedAt: string; endedAt: string | null; detail: string };
type BotIncident = { id: number; target: string; startedAt: string; endedAt: string; detail: string };
type Data = {
  settings: Settings;
  worker: { testRequestedAt: string | null; testSentAt: string | null; testError: string; lastReportAt: string | null };
  secretReady: boolean;
  targets: TargetResult[];
  incidents: Incident[];
  botIncidents: BotIncident[];
  now: string;
};

type Form = Omit<Settings, "version" | "failuresForDown" | "slowMs"> & { failures: string; slowSeconds: string };

const MINOR_MODES: { value: MinorMode; label: string; text: string }[] = [
  { value: "off", label: "ไม่ต้องแจ้ง", text: "ดูในหน้าสถานะอย่างเดียว" },
  { value: "quiet", label: "แจ้งเงียบๆ", text: "ข้อความสีเทา ไม่แท็กใคร" },
  { value: "daily", label: "สรุปวันละครั้ง", text: "รวมส่งตอนขึ้นวันใหม่" },
];

/** The Worker sends results every minute; longer than this means it has gone quiet. */
const QUIET_AFTER_MS = 5 * 60_000;
const MAX_TARGETS = 10;
const ROLE_ID = /^[0-9]{17,20}$/;

function toForm(s: Settings): Form {
  return {
    enabled: s.enabled, targets: s.targets.map((target) => ({ ...target })), mentionRoleId: s.mentionRoleId, senderName: s.senderName,
    minorMode: s.minorMode, failures: String(s.failuresForDown), slowSeconds: String(s.slowMs / 1000),
  };
}

const when = (value: string) => new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

function lasted(from: string, to: string | null, now: number) {
  const minutes = Math.max(1, Math.round(((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 60000));
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} ชม. ${minutes % 60} นาที` : `${hours} ชม.`;
}

const percent = (value: number | null) => (value === null ? "-" : `${value >= 99.995 ? "100" : value.toFixed(2)}%`);

export function DiscordUptime({ notify, section }: { notify: Notice; section: UptimeSection }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const apply = useCallback((next: Data, resetForm: boolean) => {
    setData(next);
    if (resetForm) {
      setForm(toForm(next.settings));
      setSaved(toForm(next.settings));
    }
  }, []);

  const load = useCallback((resetForm: boolean) => {
    api<Data>("/api/admin/uptime")
      .then((next) => { apply(next, resetForm); setLoadError(""); })
      .catch((error) => setLoadError((error as Error).message || "โหลดไม่สำเร็จ"));
  }, [apply]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Fresh results every 30 seconds, and every 5 while a test message is on its way.
  const testPending = Boolean(data?.worker.testRequestedAt && !data.worker.testSentAt);
  useEffect(() => {
    const timer = window.setInterval(() => load(false), testPending ? 5000 : 30000);
    return () => window.clearInterval(timer);
  }, [load, testPending]);

  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !data) return;
    const failuresForDown = Number(form.failures);
    const slowMs = Math.round(Number(form.slowSeconds) * 1000);
    if (!Number.isInteger(failuresForDown) || !Number.isFinite(slowMs)) {
      notify({ kind: "error", text: "ใส่ตัวเลขให้ครบ" });
      return;
    }
    setBusy(true);
    try {
      const next = await api<Data>("/api/admin/uptime", {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled, targets: form.targets, failuresForDown, slowMs, mentionRoleId: form.mentionRoleId.trim(),
          senderName: form.senderName, minorMode: form.minorMode, version: data.settings.version,
        }),
      });
      apply(next, true);
      notify({ kind: "success", text: "บันทึกแล้ว มีผลในรอบถัดไป" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      apply(await api<Data>("/api/admin/uptime/test", { method: "POST" }), false);
      notify({ kind: "success", text: "รอสักครู่ ข้อความจะเข้า Discord ภายใน 1 นาที" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setTesting(false);
    }
  }

  if (loadError) return <LoadError title="โหลดหน้านี้ไม่ได้" message={loadError} onRetry={() => load(true)} />;
  if (!data || !form) return <Card icon={Activity} title="กำลังโหลด..." busy />;

  return (
    <>
      <div className="bp-pane" hidden={section !== "results"}>
        <Results data={data} />
      </div>
      <form className="bp-pane" hidden={section !== "settings"} onSubmit={(event) => void save(event)}>
        <SettingsForm form={form} setForm={setForm} data={data} off={busy} testing={testing} onTest={() => void sendTest()} />
        <SaveBar dirty={dirty} busy={busy} onCancel={() => saved && setForm(saved)} />
      </form>
    </>
  );
}

/** Where a list's results come from: Cloudflare, or the bot on our own server. */
function Source({ outside }: { outside: boolean }) {
  return outside
    ? <span className="up-source is-outside"><Cloud size={13} aria-hidden="true" />Cloudflare</span>
    : <span className="up-source"><Bot size={13} aria-hidden="true" />บอทในเครื่อง</span>;
}

/** Why the results may be missing or old, above everything else. */
function Warnings({ data }: { data: Data }) {
  const now = new Date(data.now).getTime();
  const last = data.worker.lastReportAt ? new Date(data.worker.lastReportAt).getTime() : null;
  const notes: string[] = [];
  if (!data.secretReady) notes.push("ยังไม่ได้ใส่ UPTIME_WORKER_SECRET ใน .env ของเซิร์ฟเวอร์ ผลเช็กเลยส่งเข้ามาไม่ได้");
  if (data.settings.enabled && last === null) notes.push("ยังไม่มีผลเช็กเข้ามาเลย ดูว่า deploy Worker และใส่ secret แล้ว");
  else if (data.settings.enabled && last !== null && now - last > QUIET_AFTER_MS) {
    notes.push(`ไม่มีผลเช็กเข้ามา ${lasted(new Date(last).toISOString(), data.now, now)} แล้ว (ล่าสุด ${when(new Date(last).toISOString())}) ถ้าเซิร์ฟเวอร์ล่มอยู่ ผลจะตามมาทีหลัง`);
  }
  if (!notes.length) return null;
  return (
    <div className="bp-notes up-warnings" role="alert">
      {notes.map((note) => <p className="bp-note" key={note}><CircleAlert size={16} aria-hidden="true" />{note}</p>)}
    </div>
  );
}

function Results({ data }: { data: Data }) {
  const now = new Date(data.now).getTime();
  return (
    <>
      <Warnings data={data} />

      <Card className="up-card" icon={Activity} title="ตอนนี้" text={data.settings.enabled ? "เช็กทุกนาที" : "ปิดการเช็กอยู่ เปิดได้ในหน้าตั้งค่า"}
        aside={<Source outside />} flush>
        {!data.targets.length ? <p className="bp-empty">ยังไม่ได้เพิ่มเว็บที่จะเช็ก</p> : (
          <ul className="bp-list">
            {data.targets.map((target) => <TargetRow key={target.id} target={target} slowMs={data.settings.slowMs} />)}
          </ul>
        )}
      </Card>

      <Card className="up-card" icon={History} title="ประวัติ" text="สะดุด คือเช็กไม่ผ่านแป๊บเดียว ยังไม่ถึงขั้นแจ้งว่าล่ม" aside={<Source outside />} flush>
        {!data.incidents.length ? <p className="bp-empty">ยังไม่เคยล่ม</p> : (
          <ul className="bp-list">
            {data.incidents.map((incident) => (
              <li key={incident.id}>
                <span className={`bp-badge${incident.kind === "down" ? " is-down" : ""}`}>{incident.kind === "down" ? "ล่ม" : "สะดุด"}</span>
                <div className="bp-item">
                  <strong>
                    {incident.targetName || incident.targetId}{" "}
                    <small>{incident.endedAt ? `นาน ${lasted(incident.startedAt, incident.endedAt, now)}` : `ยังล่มอยู่ ${lasted(incident.startedAt, null, now)}`}</small>
                  </strong>
                  <small>{when(incident.startedAt)} ถึง {incident.endedAt ? when(incident.endedAt) : "ตอนนี้"}</small>
                  {incident.detail && <small className="up-detail">{incident.detail}</small>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="up-card" icon={Bot} title="ที่บอทในเครื่องจับได้" text="บอทอยู่เครื่องเดียวกับเว็บ ถ้าเครื่องดับ บอทก็แจ้งไม่ได้" aside={<Source outside={false} />} flush>
        {!data.botIncidents.length ? <p className="bp-empty">ยังไม่เคยล่ม</p> : (
          <ul className="bp-list">
            {data.botIncidents.map((incident) => (
              <li key={incident.id}>
                <span className="bp-badge is-down">{incident.target === "web" ? "เว็บ" : "API"}</span>
                <div className="bp-item">
                  <strong>ล่ม {lasted(incident.startedAt, incident.endedAt, now)}</strong>
                  <small>{when(incident.startedAt)} ถึง {when(incident.endedAt)}</small>
                  {incident.detail && <small className="up-detail">{incident.detail}</small>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function TargetRow({ target, slowMs }: { target: TargetResult; slowMs: number }) {
  const last = target.last;
  const tone = !target.enabled || !last ? "is-idle" : last.ok ? (last.latencyMs >= slowMs ? "is-slow" : "is-up") : "is-down";
  const Icon = !target.enabled || !last ? CircleHelp : last.ok ? CircleCheck : CircleAlert;
  const label = !target.enabled ? "ปิดไว้" : !last ? "รอผล" : !last.ok ? "ล่ม" : tone === "is-slow" ? "ช้า" : "ปกติ";
  return (
    <li className="up-target">
      <span className={`up-state ${tone}`}><Icon size={16} aria-hidden="true" />{label}</span>
      <div className="bp-item">
        <strong>{target.name} <small>{target.url}</small></strong>
        {last ? (
          <small>
            เช็กเมื่อ {ago(last.checkedAt)}
            {last.ok ? "" : ` · ${last.error || `HTTP ${last.statusCode}`}`}
            {last.retried && " · ลองซ้ำแล้ว"}
          </small>
        ) : <small>{target.enabled ? "รอเช็กรอบแรก" : "ไม่ได้เช็ก"}</small>}
      </div>
      <dl className="up-metrics">
        <div><dt>ตอบใน</dt><dd>{last ? `${last.latencyMs} ms` : "-"}</dd></div>
        <div><dt>เช็กจาก</dt><dd>{last?.colo || "-"}</dd></div>
        <div><dt>24 ชม.</dt><dd>{percent(target.uptime24h)}</dd></div>
        <div><dt>7 วัน</dt><dd>{percent(target.uptime7d)}</dd></div>
      </dl>
    </li>
  );
}

function SettingsForm({ form, setForm, data, off, testing, onTest }: {
  form: Form; setForm: (form: Form) => void; data: Data; off: boolean; testing: boolean; onTest: () => void;
}) {
  const set = (next: Partial<Form>) => setForm({ ...form, ...next });
  const setTarget = (index: number, next: Partial<Target>) => set({ targets: form.targets.map((target, i) => (i === index ? { ...target, ...next } : target)) });
  const roleBad = form.mentionRoleId.trim() !== "" && !ROLE_ID.test(form.mentionRoleId.trim());
  const worker = data.worker;
  const fieldsOff = off || !form.enabled;

  return (
    <>
      <Card icon={Activity} title="การเช็ก" text="เช็กจาก Cloudflare ทุกนาที เลยแจ้งได้แม้เซิร์ฟเวอร์ดับทั้งเครื่อง" flush>
        <Rows>
          <SwitchRow title="เปิดการเช็ก" hint="ปิดแล้วจะไม่เช็กและไม่แจ้งอะไรเลย" on={form.enabled} onChange={(enabled) => set({ enabled })} disabled={off} />
        </Rows>
      </Card>

      <Card className="up-card" icon={ListChecks} title="เว็บที่เช็ก" text="รอคำตอบ 10 วินาที ถ้าไม่ผ่านจะลองอีกครั้งหลัง 15 วินาที" flush
        aside={<span className="bp-count">{form.targets.length}/{MAX_TARGETS}</span>}>
        {!form.targets.length && <p className="bp-empty">ยังไม่ได้เพิ่มเว็บที่จะเช็ก</p>}
        {form.targets.length > 0 && (
          <div className="up-targets-head" aria-hidden="true">
            <span>ชื่อ</span><span>URL</span><span>เช็ก</span>
          </div>
        )}
        <ul className="up-targets">
          {form.targets.map((target, index) => (
            <li key={target.id || `new-${index}`} className={target.enabled ? "" : "is-off"}>
              <div className="hv-field up-name">
                <label htmlFor={`up-name-${index}`} className="sr-only">ชื่อ</label>
                <input id={`up-name-${index}`} value={target.name} maxLength={60} required placeholder="ชื่อ เช่น เว็บไซต์"
                  onChange={(event) => setTarget(index, { name: event.target.value })} disabled={fieldsOff} />
              </div>
              <div className="hv-field up-url">
                <label htmlFor={`up-url-${index}`} className="sr-only">URL ของ {target.name || "เว็บนี้"}</label>
                <input id={`up-url-${index}`} type="url" inputMode="url" value={target.url} maxLength={300} required placeholder="https://nkn02.com"
                  onChange={(event) => setTarget(index, { url: event.target.value })} disabled={fieldsOff} />
              </div>
              <div className="up-target-actions">
                <Switch label={`เช็ก ${target.name || "รายการนี้"}`} on={target.enabled} onChange={(enabled) => setTarget(index, { enabled })} disabled={fieldsOff} />
                <button type="button" className="hv-btn up-remove" onClick={() => set({ targets: form.targets.filter((_, i) => i !== index) })}
                  disabled={fieldsOff} aria-label={`ลบ ${target.name || "รายการนี้"}`} title="ลบ">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="up-add">
          <button type="button" className="hv-btn" disabled={fieldsOff || form.targets.length >= MAX_TARGETS}
            onClick={() => set({ targets: [...form.targets, { id: "", name: "", url: "https://", enabled: true }] })}>
            <Plus size={16} aria-hidden="true" /> เพิ่มเว็บ
          </button>
        </div>
      </Card>

      <Card className="up-card" icon={Bell} title="การแจ้งเตือน" text="ล่มแจ้งเป็นสีแดง พอกลับมาแจ้งสีเขียว" flush>
        <Fields>
          <div className="bp-three">
            <div className="hv-field">
              <label htmlFor="up-failures">แจ้งเมื่อพลาดติดกัน (รอบ)</label>
              <input id="up-failures" type="number" inputMode="numeric" min={1} max={10} value={form.failures}
                onChange={(event) => set({ failures: event.target.value })} disabled={fieldsOff} />
              <small>รอบละ 1 นาที</small>
            </div>
            <div className="hv-field">
              <label htmlFor="up-slow">นับว่าช้าเมื่อเกิน (วินาที)</label>
              <input id="up-slow" type="number" inputMode="decimal" min={0.5} max={10} step={0.5} value={form.slowSeconds}
                onChange={(event) => set({ slowSeconds: event.target.value })} disabled={fieldsOff} />
              <small>แค่ขึ้นว่าช้า ไม่นับว่าล่ม</small>
            </div>
            <div className="hv-field">
              <label htmlFor="up-sender">ชื่อผู้ส่ง</label>
              <input id="up-sender" value={form.senderName} maxLength={80} required onChange={(event) => set({ senderName: event.target.value })} disabled={fieldsOff} />
              <small>ใช้คำว่า discord หรือ clyde ไม่ได้</small>
            </div>
          </div>
          <div className="hv-field">
            <label htmlFor="up-role">Role ที่จะแท็กตอนล่ม</label>
            <input id="up-role" inputMode="numeric" value={form.mentionRoleId} placeholder="เว้นว่างถ้าไม่แท็ก" spellCheck={false}
              onChange={(event) => set({ mentionRoleId: event.target.value })} disabled={fieldsOff} aria-invalid={roleBad || undefined} />
            {roleBad ? <small className="bp-warn">ID ของ role เป็นตัวเลข 17 ถึง 20 หลัก</small>
              : <small>ใส่ ID ของ role ได้จากคลิกขวาที่ role แล้วกด Copy Role ID</small>}
          </div>
        </Fields>
        <Fields>
          <div className="hv-field">
            <span id="up-minor">ตอนสะดุดแต่ยังไม่ถึงขั้นล่ม</span>
            <div className="bp-levels up-modes" role="radiogroup" aria-labelledby="up-minor">
              {MINOR_MODES.map((mode) => (
                <button key={mode.value} type="button" role="radio" aria-checked={form.minorMode === mode.value}
                  className={`bp-level${form.minorMode === mode.value ? " is-on" : ""}`} onClick={() => set({ minorMode: mode.value })} disabled={fieldsOff}>
                  <b>{mode.label}</b>
                  <small>{mode.text}</small>
                </button>
              ))}
            </div>
            <small>ไม่ว่าเลือกแบบไหน ก็ยังดูย้อนหลังได้ในหน้าสถานะ</small>
          </div>
        </Fields>
      </Card>

      <Card icon={Send} title="ลองส่งข้อความ" text="ดูว่าข้อความแจ้งล่มใน Discord หน้าตาเป็นยังไง ไม่แท็กใครจริง" flush>
        <Rows>
          <div className="bp-row">
            <div className="bp-row-copy">
              <strong>ส่งข้อความทดสอบ</strong>
              <small>
                {worker.testSentAt
                  ? worker.testError ? `ส่งไม่ได้: ${worker.testError}` : `ส่งไปแล้ว ${ago(worker.testSentAt)}`
                  : worker.testRequestedAt ? "กำลังรอส่ง ไม่เกิน 1 นาที" : "กดแล้วข้อความจะเข้าภายใน 1 นาที"}
              </small>
            </div>
            <div className="bp-row-control">
              <button type="button" className="hv-btn" onClick={onTest} disabled={off || testing}>
                {testing ? <span className="hv-spinner" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />} ส่งข้อความทดสอบ
              </button>
            </div>
          </div>
        </Rows>
        <p className="up-foot">URL ของ webhook เก็บไว้ใน Worker ที่เดียว เว็บนี้ไม่เห็น</p>
      </Card>
    </>
  );
}
