"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Activity, Check, CircleAlert, Copy, RefreshCw, Save, ScrollText, Send, Server } from "lucide-react";
import { API_BASE } from "../runtime";
import "./mail-settings-panel.css";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;
type ResendSettings = {
  apiKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  providerConfigured: boolean;
  source: string;
  webhookUrl: string;
};
type StalwartHealth = { configured: boolean; healthy: boolean; error?: string; publicUrl?: string };

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ทำรายการไม่สำเร็จ");
  return payload as T;
}

const emptyForm = { apiKey: "", webhookSecret: "", clearApiKey: false, clearWebhookSecret: false };

// System settings → Mail: the Resend connection (sending) and the Stalwart server (receiving).
export default function MailSettingsPanel({ notify }: { notify: Notice }) {
  const [resend, setResend] = useState<ResendSettings | null>(null);
  const [stalwart, setStalwart] = useState<StalwartHealth | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState<"" | "save" | "test" | "sync">("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => Promise.all([
    api<ResendSettings>("/api/admin/mail/settings/"),
    api<StalwartHealth>("/api/admin/mail/stalwart/health").catch(() => ({ configured: false, healthy: false } as StalwartHealth)),
  ]).then(([settings, health]) => {
    setResend(settings);
    setStalwart(health);
  }), []);
  useEffect(() => {
    load().catch((error) => notify({ kind: "error", text: (error as Error).message }));
  }, [load, notify]);

  const webhookUrl = resend?.webhookUrl || "https://nkn02.com/api/webhooks/resend";
  const dirty = Boolean(form.apiKey || form.webhookSecret || form.clearApiKey || form.clearWebhookSecret);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    try {
      await api("/api/admin/mail/settings/", { method: "PUT", body: JSON.stringify(form) });
      setForm(emptyForm);
      await load();
      notify({ kind: "success", text: "บันทึกการเชื่อมต่อ Resend แล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function test() {
    setBusy("test");
    try {
      const result = await api<{ domainCount: number }>("/api/admin/mail/settings/test", { method: "POST", body: JSON.stringify({ apiKey: form.apiKey }) });
      notify({ kind: "success", text: `เชื่อมต่อ Resend ได้ พบ ${result.domainCount} โดเมน` });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function sync() {
    setBusy("sync");
    try {
      const result = await api<{ domains: number; mailboxes: number; failures: string[] }>("/api/admin/mail/stalwart/sync", { method: "POST" });
      await load();
      notify({
        kind: result.failures.length ? "error" : "success",
        text: result.failures.length
          ? `ซิงก์ได้บางส่วน: ${result.failures.length} รายการไม่สำเร็จ`
          : `ซิงก์แล้ว ${result.domains} โดเมน ${result.mailboxes} กล่อง`,
      });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      notify({ kind: "error", text: "คัดลอกไม่ได้ ลองอีกครั้ง" });
    }
  }

  if (!resend) return <div className="dashboard-loading inline"><span /></div>;

  return (
    <div className="msp">
      <form className="msp-card" onSubmit={save}>
        <header className="msp-head">
          <span className="msp-mark" aria-hidden="true"><Send size={18} /></span>
          <div>
            <h3>Resend <small>ส่งอีเมล</small></h3>
            <p>ใช้ส่งอีเมลออก ตรวจสอบโดเมน และรับสถานะการส่งผ่าน Webhook</p>
          </div>
          <span className={`msp-state ${resend.providerConfigured ? "is-ok" : "is-wait"}`}>
            {resend.providerConfigured ? <Check size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
            {resend.providerConfigured ? "เชื่อมต่อแล้ว" : "ยังตั้งค่าไม่ครบ"}
          </span>
        </header>

        <div className="msp-rows">
          <div className="msp-row">
            <label htmlFor="msp-api-key">
              <strong>API Key</strong>
              <span>{resend.apiKeyConfigured ? "บันทึกไว้แล้ว ใส่ใหม่เมื่อต้องการเปลี่ยน" : "สร้างได้ที่ resend.com → API Keys"}</span>
            </label>
            <input
              id="msp-api-key"
              className="msp-input"
              type="password"
              autoComplete="new-password"
              value={form.apiKey}
              disabled={form.clearApiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder={resend.apiKeyConfigured ? "•••••••• ใช้ค่าเดิม" : "re_..."}
            />
          </div>
          <div className="msp-row">
            <label htmlFor="msp-secret">
              <strong>Webhook Secret</strong>
              <span>{resend.webhookSecretConfigured ? "บันทึกไว้แล้ว ใส่ใหม่เมื่อต้องการเปลี่ยน" : "คัดลอกจากหน้า Webhook ใน Resend"}</span>
            </label>
            <input
              id="msp-secret"
              className="msp-input"
              type="password"
              autoComplete="new-password"
              value={form.webhookSecret}
              disabled={form.clearWebhookSecret}
              onChange={(event) => setForm({ ...form, webhookSecret: event.target.value })}
              placeholder={resend.webhookSecretConfigured ? "•••••••• ใช้ค่าเดิม" : "whsec_..."}
            />
          </div>
          <div className="msp-row">
            <div className="msp-label">
              <strong>Webhook URL</strong>
              <span>ใส่ลิงก์นี้ใน Resend → Webhooks</span>
            </div>
            <div className="msp-copy">
              <span title={webhookUrl}>{webhookUrl}</span>
              <button type="button" className={copied ? "is-done" : ""} onClick={() => void copyWebhook()} aria-label="คัดลอก Webhook URL" title="คัดลอก">
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>
          {(resend.apiKeyConfigured || resend.webhookSecretConfigured) && (
            <div className="msp-row">
              <div className="msp-label">
                <strong>ลบคีย์ที่บันทึกไว้</strong>
                <span>เลือกแล้วกดบันทึก ระบบจะส่งอีเมลไม่ได้จนกว่าจะใส่ใหม่</span>
              </div>
              <div className="msp-checks">
                {resend.apiKeyConfigured && (
                  <label><input type="checkbox" checked={form.clearApiKey} onChange={(event) => setForm({ ...form, clearApiKey: event.target.checked, apiKey: "" })} /> API Key</label>
                )}
                {resend.webhookSecretConfigured && (
                  <label><input type="checkbox" checked={form.clearWebhookSecret} onChange={(event) => setForm({ ...form, clearWebhookSecret: event.target.checked, webhookSecret: "" })} /> Webhook Secret</label>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="msp-foot">
          <span>คีย์ถูกเข้ารหัสก่อนเก็บ และไม่แสดงกลับบนหน้าเว็บ</span>
          <button type="button" className="premium-btn secondary" onClick={() => void test()} disabled={!!busy || (!resend.apiKeyConfigured && !form.apiKey)}>
            <Activity size={15} aria-hidden="true" /> {busy === "test" ? "กำลังทดสอบ..." : "ทดสอบ"}
          </button>
          <button className="premium-btn primary-filled" disabled={!!busy || !dirty}>
            <Save size={15} aria-hidden="true" /> {busy === "save" ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </footer>
      </form>

      <section className="msp-card">
        <header className="msp-head">
          <span className="msp-mark" aria-hidden="true"><Server size={18} /></span>
          <div>
            <h3>Stalwart <small>รับอีเมล</small></h3>
            <p>เซิร์ฟเวอร์กล่องอีเมล IMAP / JMAP ที่ Webmail และแอปอีเมลเชื่อมต่อ</p>
          </div>
          <span className={`msp-state ${stalwart?.healthy ? "is-ok" : "is-bad"}`}>
            <i aria-hidden="true" />
            {!stalwart?.configured ? "ยังไม่ได้ตั้งค่า" : stalwart.healthy ? "ออนไลน์" : "ออฟไลน์"}
          </span>
        </header>
        <div className="msp-rows">
          {stalwart?.publicUrl && (
            <div className="msp-row">
              <div className="msp-label"><strong>ที่อยู่เซิร์ฟเวอร์</strong><span>ใช้ตั้งค่าในแอปอีเมล</span></div>
              <div className="msp-value">{stalwart.publicUrl}</div>
            </div>
          )}
          {stalwart?.error && (
            <div className="msp-row">
              <div className="msp-label"><strong>ข้อผิดพลาดล่าสุด</strong><span>จากการตรวจสถานะครั้งนี้</span></div>
              <div className="msp-value is-error">{stalwart.error}</div>
            </div>
          )}
          <div className="msp-row">
            <div className="msp-label">
              <strong>ซิงก์ข้อมูล</strong>
              <span>ส่งโดเมนและกล่องอีเมลทั้งหมดไปที่ Stalwart อีกครั้ง ใช้เมื่อกล่องรับเมลไม่ได้หรือเพิ่งย้ายเซิร์ฟเวอร์</span>
            </div>
            <div>
              <button type="button" className="premium-btn secondary" onClick={() => void sync()} disabled={!!busy}>
                <RefreshCw size={15} aria-hidden="true" className={busy === "sync" ? "spin" : ""} /> {busy === "sync" ? "กำลังซิงก์..." : "ซิงก์ตอนนี้"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <MailLogCard notify={notify} />
    </div>
  );
}

type MailLogSettings = { enabled: boolean; groups: string[]; configured: boolean };

const mailLogGroups = [
  { key: "access", label: "การเข้าใช้งาน", hint: "เปิดกล่องเมลบนเว็บหรือผ่านบอท (คนละครั้งต่อกล่องทุก 30 นาที)" },
  { key: "traffic", label: "ส่งและรับเมล", hint: "ผู้ส่ง ผู้รับ และหัวเรื่อง ไม่มีเนื้อหาเมล" },
  { key: "manage", label: "จัดการกล่องและบัญชี", hint: "สร้าง ระงับ ลบกล่อง รหัสผ่านแอป สมาชิก โดเมน และการตั้งค่า" },
  { key: "messages", label: "ย้ายและลบเมล", hint: "ย้ายลงถังขยะหรือกู้คืน อาจมีจำนวนมาก" },
];

// Mail activity log: mail events posted to a Discord channel through its own webhook.
function MailLogCard({ notify }: { notify: Notice }) {
  const [saved, setSaved] = useState<MailLogSettings | null>(null);
  const [form, setForm] = useState({ enabled: false, groups: [] as string[], webhookUrl: "", clearWebhook: false });
  const [busy, setBusy] = useState<"" | "save" | "test">("");

  const load = useCallback(() => api<MailLogSettings>("/api/admin/mail/log-settings").then((data) => {
    setSaved(data);
    setForm({ enabled: data.enabled, groups: data.groups, webhookUrl: "", clearWebhook: false });
  }), []);
  useEffect(() => {
    load().catch((error) => notify({ kind: "error", text: (error as Error).message }));
  }, [load, notify]);

  if (!saved) return null;
  const dirty =
    form.enabled !== saved.enabled ||
    form.groups.join() !== saved.groups.join() ||
    Boolean(form.webhookUrl.trim()) ||
    form.clearWebhook;
  const hasWebhook = (saved.configured && !form.clearWebhook) || Boolean(form.webhookUrl.trim());

  function toggleGroup(key: string) {
    const next = form.groups.includes(key) ? form.groups.filter((item) => item !== key) : [...form.groups, key];
    setForm({ ...form, groups: mailLogGroups.map((group) => group.key).filter((item) => next.includes(item)) });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    try {
      await api("/api/admin/mail/log-settings", { method: "PUT", body: JSON.stringify(form) });
      await load();
      notify({ kind: "success", text: "บันทึกการตั้งค่า log อีเมลแล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function test() {
    setBusy("test");
    try {
      await api("/api/admin/mail/log-settings/test", { method: "POST", body: JSON.stringify({ webhookUrl: form.webhookUrl.trim() }) });
      notify({ kind: "success", text: "ส่งข้อความทดสอบไป Discord แล้ว ลองดูในห้อง" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="msp-card" onSubmit={save}>
      <header className="msp-head">
        <span className="msp-mark" aria-hidden="true"><ScrollText size={18} /></span>
        <div>
          <h3>Log อีเมล <small>Discord</small></h3>
          <p>ส่งบันทึกการใช้งานระบบอีเมลเข้าห้อง Discord ผ่าน Webhook แยกจากการแจ้งเตือนความปลอดภัย</p>
        </div>
        <span className={`msp-state ${saved.enabled ? "is-ok" : "is-wait"}`}>
          {saved.enabled ? <Check size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
          {saved.enabled ? "เปิดอยู่" : "ปิดอยู่"}
        </span>
      </header>

      <div className="msp-rows">
        <div className="msp-row is-switch">
          <div className="msp-label">
            <strong>ส่ง log</strong>
            <span>{form.enabled ? "ส่งเหตุการณ์ในหมวดที่เลือกเข้าห้อง" : "ปิดไว้ ยังบันทึกในประวัติการใช้งานของเว็บตามปกติ"}</span>
          </div>
          <div>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              aria-label="ส่ง log อีเมลเข้า Discord"
              className={`sc-switch${form.enabled ? " is-on" : ""}`}
              onClick={() => setForm({ ...form, enabled: !form.enabled })}
            >
              <span />
            </button>
          </div>
        </div>
        <div className="msp-row">
          <label htmlFor="msp-log-webhook">
            <strong>Discord Webhook URL</strong>
            <span>{saved.configured ? "บันทึกไว้แล้ว ใส่ใหม่เมื่อต้องการเปลี่ยนห้อง" : "ตั้งค่าห้อง → การเชื่อมต่อ → Webhooks → คัดลอก URL"}</span>
          </label>
          <input
            id="msp-log-webhook"
            className="msp-input"
            type="password"
            autoComplete="off"
            value={form.webhookUrl}
            disabled={form.clearWebhook}
            onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
            placeholder={saved.configured ? "•••••••• ใช้ค่าเดิม" : "https://discord.com/api/webhooks/..."}
          />
        </div>
        <div className="msp-row">
          <div className="msp-label">
            <strong>หมวดที่ส่ง</strong>
            <span>เลือกได้หลายหมวด</span>
          </div>
          <div className="msp-log-groups">
            {mailLogGroups.map((group) => (
              <label key={group.key}>
                <input type="checkbox" checked={form.groups.includes(group.key)} onChange={() => toggleGroup(group.key)} />
                <span><strong>{group.label}</strong><small>{group.hint}</small></span>
              </label>
            ))}
          </div>
        </div>
        {saved.configured && (
          <div className="msp-row">
            <div className="msp-label">
              <strong>ลบ Webhook ที่บันทึกไว้</strong>
              <span>เลือกแล้วกดบันทึก ระบบจะหยุดส่ง log</span>
            </div>
            <div className="msp-checks">
              <label><input type="checkbox" checked={form.clearWebhook} onChange={(event) => setForm({ ...form, clearWebhook: event.target.checked, webhookUrl: "", enabled: event.target.checked ? false : form.enabled })} /> Webhook URL</label>
            </div>
          </div>
        )}
      </div>

      <footer className="msp-foot">
        <span>URL ถูกเข้ารหัสก่อนเก็บ และไม่แสดงกลับบนหน้าเว็บ</span>
        <button type="button" className="premium-btn secondary" onClick={() => void test()} disabled={!!busy || !hasWebhook}>
          <Activity size={15} aria-hidden="true" /> {busy === "test" ? "กำลังส่ง..." : "ส่งทดสอบ"}
        </button>
        <button className="premium-btn primary-filled" disabled={!!busy || !dirty}>
          <Save size={15} aria-hidden="true" /> {busy === "save" ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </footer>
    </form>
  );
}
