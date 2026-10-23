"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CircleAlert, MailPlus } from "lucide-react";
import { API_BASE } from "../runtime";
import "./discord-mail-bot-settings.css";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

export type BotKey = "nexora" | "mail" | "voice" | "community";
export type ActivityType = "playing" | "watching" | "listening" | "competing" | "custom";
type DiscordBotPresence = {
  activityType: ActivityType;
  activityText: string;
  preview: string;
};

export const ACTIVITY_TEXT_MAX = 128;

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ทำรายการไม่สำเร็จ");
  return payload as T;
}

/**
 * The status under one bot's name: what the server has saved, what the admin is typing,
 * and saving or putting it back. GET/PUT /api/admin/discord-bots/{botKey}.
 */
export function useBotPresence(botKey: BotKey, defaultText: string, notify: Notice) {
  const [form, setForm] = useState<{ activityType: ActivityType; activityText: string }>({ activityType: "watching", activityText: defaultText });
  const [saved, setSaved] = useState<DiscordBotPresence | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError("");
    api<DiscordBotPresence>(`/api/admin/discord-bots/${botKey}`)
      .then((data) => {
        setForm({ activityType: data.activityType, activityText: data.activityText });
        setSaved(data);
      })
      .catch((error) => setLoadError((error as Error).message || "โหลดการตั้งค่าไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [botKey]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const dirty = Boolean(saved && (saved.activityType !== form.activityType || saved.activityText !== form.activityText));
  const valid = form.activityText.trim().length > 0 && form.activityText.length <= ACTIVITY_TEXT_MAX;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || !valid) return;
    setBusy(true);
    try {
      const data = await api<DiscordBotPresence>(`/api/admin/discord-bots/${botKey}`, {
        method: "PUT",
        body: JSON.stringify({ activityType: form.activityType, activityText: form.activityText }),
      });
      setForm({ activityType: data.activityType, activityText: data.activityText });
      setSaved(data);
      notify({ kind: "success", text: "บันทึกแล้ว Discord จะเปลี่ยนในไม่กี่วินาที" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    if (saved) setForm({ activityType: saved.activityType, activityText: saved.activityText });
  }

  return { form, setForm, saved, loading, loadError, busy, dirty, valid, load, save, reset };
}

type SelfServiceSettings = {
  selfServiceEnabled: boolean;
  maxMailboxesPerUser: number;
  quotaBytes: number;
};

const GB = 1024 ** 3;

function gbText(bytes: number) {
  return String(Number((bytes / GB).toFixed(2)));
}

/** Whether members may create their own mailbox on the platform domain from the mail bot. */
export function MailBotSelfServiceSettings({ notify }: { notify: Notice }) {
  const [form, setForm] = useState({ enabled: true, max: "3", quotaGb: "1" });
  const [saved, setSaved] = useState<typeof form | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((data: SelfServiceSettings) => {
    const next = { enabled: data.selfServiceEnabled, max: String(data.maxMailboxesPerUser), quotaGb: gbText(data.quotaBytes) };
    setForm(next);
    setSaved(next);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api<SelfServiceSettings>("/api/admin/mail/discord-bot/self-service")
      .then((data) => {
        apply(data);
        setLoadError("");
      })
      .catch((error) => setLoadError((error as Error).message || "โหลดการตั้งค่าไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [apply]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const dirty = Boolean(saved && (saved.enabled !== form.enabled || saved.max !== form.max || saved.quotaGb !== form.quotaGb));

  async function save(event: FormEvent) {
    event.preventDefault();
    const max = Number.parseInt(form.max, 10);
    const quotaGb = Number(form.quotaGb);
    if (!Number.isFinite(max) || max < 0 || max > 50) {
      notify({ kind: "error", text: "จำนวนกล่องต่อคนต้องอยู่ระหว่าง 0 ถึง 50" });
      return;
    }
    if (!Number.isFinite(quotaGb) || quotaGb < 0.01 || quotaGb > 100) {
      notify({ kind: "error", text: "พื้นที่ต่อกล่องต้องอยู่ระหว่าง 0.01 ถึง 100 GB" });
      return;
    }
    setBusy(true);
    try {
      const data = await api<SelfServiceSettings>("/api/admin/mail/discord-bot/self-service", {
        method: "PUT",
        body: JSON.stringify({ selfServiceEnabled: form.enabled, maxMailboxesPerUser: max, quotaBytes: Math.round(quotaGb * GB) }),
      });
      apply(data);
      notify({ kind: "success", text: "บันทึกแล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="aov-panel dbot-card" onSubmit={(event) => void save(event)} aria-busy={loading}>
      <header className="dbot-card-head">
        <span className="dbot-mark" aria-hidden="true"><MailPlus size={18} /></span>
        <div>
          <h2>สร้างเมลผ่านบอท</h2>
          <p>สมาชิกที่ผูก Discord กับเว็บสร้างกล่องเมลเองได้</p>
        </div>
      </header>

      {loadError ? (
        <div className="dbot-body">
          <div className="hv-callout is-error">
            <CircleAlert size={18} aria-hidden="true" />
            <p><strong>โหลดไม่ได้</strong><span>{loadError}</span></p>
            <button type="button" onClick={load}>ลองอีกครั้ง</button>
          </div>
        </div>
      ) : (
        <div className="dbot-body">
          <div className="dbot-switch-row">
            <div>
              <strong>ให้สมาชิกสร้างเอง</strong>
              <small>{form.enabled ? "สร้างได้จากปุ่มในบอท" : "ปิดอยู่ แอดมินยังสร้างให้ได้"}</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              aria-label="เปิดให้สมาชิกสร้างเมลเอง"
              className={`sc-switch${form.enabled ? " is-on" : ""}`}
              onClick={() => setForm({ ...form, enabled: !form.enabled })}
              disabled={loading}
            >
              <span />
            </button>
          </div>
          <div className="dbot-fields">
            <div className="hv-field">
              <label htmlFor="mailbot-max">กล่องต่อคน</label>
              <input id="mailbot-max" type="number" inputMode="numeric" min={0} max={50} step={1} value={form.max}
                onChange={(event) => setForm({ ...form, max: event.target.value })} disabled={loading} required />
              <small>นับเฉพาะกล่องบนโดเมนกลาง</small>
            </div>
            <div className="hv-field">
              <label htmlFor="mailbot-quota">พื้นที่ต่อกล่อง (GB)</label>
              <input id="mailbot-quota" type="number" inputMode="decimal" min={0.01} max={100} step={0.01} value={form.quotaGb}
                onChange={(event) => setForm({ ...form, quotaGb: event.target.value })} disabled={loading} required />
              <small>ใช้กับกล่องที่สร้างใหม่</small>
            </div>
          </div>
        </div>
      )}

      {!loadError && (
        <footer className="dbot-foot">
          <span className="dbot-state">{loading ? "กำลังโหลด..." : dirty ? "ยังไม่ได้บันทึก" : "ไม่มีอะไรเปลี่ยน"}</span>
          {dirty && (
            <button type="button" className="hv-btn" onClick={() => saved && setForm(saved)} disabled={busy}>ยกเลิก</button>
          )}
          <button className="hv-btn hv-btn-primary" disabled={busy || loading || !dirty}>
            {busy && <span className="hv-spinner" aria-hidden="true" />}
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </footer>
      )}
    </form>
  );
}
