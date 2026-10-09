"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, ImagePlus, MessageSquareText, Trash2 } from "lucide-react";
import { API_BASE } from "../runtime";
import { api } from "./DiscordMailBotSettings";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

type Key = "panel" | "log" | "voicelog";

type Message = {
  key: Key;
  title: string;
  body: string;
  hasImage: boolean;
  version: number;
  posted: number;
  pending: number;
};

type Form = { title: string; body: string; file: File | null; removeImage: boolean };

const IMAGE_LIMIT = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const tabs: { key: Key; label: string; command: string }[] = [
  { key: "panel", label: "แผงห้องเสียง", command: "/setup-room-panel" },
  { key: "log", label: "ข้อความห้อง log", command: "/setup-room-log" },
  { key: "voicelog", label: "ข้อความห้องประวัติเข้าออก", command: "/setup-voice-log" },
];

const emptyForm: Form = { title: "", body: "", file: null, removeImage: false };

/**
 * The messages the voice bot posts and keeps: the button panel and the log channel welcome.
 * Saving here makes the bot edit every posted copy in Discord within a few seconds.
 */
export function DiscordVoiceMessages({ notify }: { notify: Notice }) {
  const [tab, setTab] = useState<Key>("panel");
  const [messages, setMessages] = useState<Record<Key, Message> | null>(null);
  const [defaults, setDefaults] = useState<Record<Key, Message> | null>(null);
  const [forms, setForms] = useState<Record<Key, Form>>({ panel: emptyForm, log: emptyForm, voicelog: emptyForm });
  // Saved pictures by version, so a stale one is never shown for a newer save.
  const [savedImages, setSavedImages] = useState<Record<Key, { version: number; url: string }>>({
    panel: { version: 0, url: "" }, log: { version: 0, url: "" }, voicelog: { version: 0, url: "" },
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const apply = useCallback((data: { messages: Record<Key, Message>; defaults: Record<Key, Message> }, resetForms: boolean) => {
    setMessages(data.messages);
    setDefaults(data.defaults);
    if (resetForms) {
      const fresh = (key: Key): Form => ({ title: data.messages[key].title, body: data.messages[key].body, file: null, removeImage: false });
      setForms({ panel: fresh("panel"), log: fresh("log"), voicelog: fresh("voicelog") });
    }
  }, []);

  const load = useCallback((resetForms: boolean) => {
    api<{ messages: Record<Key, Message>; defaults: Record<Key, Message> }>("/api/admin/discord-voice-messages")
      .then((data) => { apply(data, resetForms); setLoadError(""); })
      .catch((error) => setLoadError((error as Error).message || "โหลดไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [apply]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(true), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // While the bot is still editing posted copies, check again every few seconds.
  const pending = Boolean(messages && tabs.some((item) => messages[item.key].pending));
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => load(false), 3000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  // The saved pictures, fetched with the admin session (an <img> URL alone would not send it).
  const panelVersion = messages?.panel.hasImage ? messages.panel.version : 0;
  const logVersion = messages?.log.hasImage ? messages.log.version : 0;
  const voicelogVersion = messages?.voicelog.hasImage ? messages.voicelog.version : 0;
  useEffect(() => {
    const urls: string[] = [];
    let cancelled = false;
    for (const [key, version] of [["panel", panelVersion], ["log", logVersion], ["voicelog", voicelogVersion]] as [Key, number][]) {
      if (!version) continue;
      fetch(`${API_BASE}/api/admin/discord-voice-messages/${key}/image?v=${version}`, { credentials: "include" })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (!blob || cancelled) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setSavedImages((current) => ({ ...current, [key]: { version, url } }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [panelVersion, logVersion, voicelogVersion]);

  // A picture chosen but not saved yet: preview it straight from the file.
  const form = forms[tab];
  const fileUrl = useMemo(() => (form.file ? URL.createObjectURL(form.file) : ""), [form.file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const message = messages?.[tab];
  const info = tabs.find((item) => item.key === tab)!;
  const saved = savedImages[tab];
  const savedUrl = message?.hasImage && saved.version === message.version ? saved.url : "";
  const imageUrl = form.file ? fileUrl : form.removeImage ? "" : savedUrl;
  const hasImage = Boolean(form.file || (!form.removeImage && message?.hasImage));
  const dirty = Boolean(message && (form.title !== message.title || form.body !== message.body || form.file || form.removeImage));
  const isDefault = Boolean(defaults && message && !message.hasImage && message.title === defaults[tab].title && message.body === defaults[tab].body);

  function update(next: Partial<Form>) {
    setForms((current) => ({ ...current, [tab]: { ...current[tab], ...next } }));
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      notify({ kind: "error", text: "ใช้รูป PNG, JPG, GIF หรือ WebP" });
      return;
    }
    if (file.size > IMAGE_LIMIT) {
      notify({ kind: "error", text: "รูปต้องไม่เกิน 4MB" });
      return;
    }
    update({ file, removeImage: false });
  }

  function resetToDefault() {
    if (!defaults) return;
    update({ title: defaults[tab].title, body: defaults[tab].body, file: null, removeImage: true });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim() && !form.body.trim() && !hasImage) {
      notify({ kind: "error", text: "ใส่หัวข้อ ข้อความ หรือรูปอย่างน้อยหนึ่งอย่าง" });
      return;
    }
    const data = new FormData();
    data.append("title", form.title);
    data.append("body", form.body);
    if (form.file) data.append("image", form.file);
    if (form.removeImage) data.append("removeImage", "1");
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/discord-voice-messages/${tab}`, { method: "PUT", credentials: "include", body: data });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "บันทึกไม่สำเร็จ");
      apply(payload, false);
      setForms((current) => ({
        ...current,
        [tab]: { title: payload.messages[tab].title, body: payload.messages[tab].body, file: null, removeImage: false },
      }));
      notify({
        kind: "success",
        text: payload.messages[tab].posted ? "บันทึกแล้ว บอทจะแก้ข้อความใน Discord ภายใน 10 วินาที" : `บันทึกแล้ว ใช้ตอนพิมพ์ ${info.command}`,
      });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  let state = "กำลังโหลด...";
  if (message) {
    if (dirty) state = "ยังไม่ได้บันทึก";
    else if (message.pending) state = `บอทกำลังแก้ข้อความใน Discord (${message.pending} ที่)`;
    else if (message.posted) state = `ลงไว้ ${message.posted} ที่ ตรงกับที่ตั้งไว้`;
    else state = `ยังไม่ได้ลง พิมพ์ ${info.command} ในห้องที่จะลง`;
  }

  if (loadError) {
    return (
      <section className="aov-panel dbot-card dbot-wide">
        <div className="dbot-body">
          <div className="hv-callout is-error">
            <CircleAlert size={18} aria-hidden="true" />
            <p><strong>โหลดข้อความไม่ได้</strong><span>{loadError}</span></p>
            <button type="button" onClick={() => load(true)}>ลองอีกครั้ง</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form className="aov-panel dbot-card dbot-wide" onSubmit={(event) => void save(event)} aria-busy={loading}>
      <header className="dbot-card-head">
        <span className="dbot-mark" aria-hidden="true"><MessageSquareText size={18} /></span>
        <div>
          <h2>ข้อความที่บอทลงไว้</h2>
          <p>แก้ที่นี่แล้วข้อความใน Discord เปลี่ยนตาม</p>
        </div>
      </header>
      <div className="dbot-body dvm-body">
        <div className="dvm-edit">
          <div className="th-chips dbot-types" role="tablist" aria-label="ข้อความ">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={tab === item.key ? "is-active" : ""}
                onClick={() => setTab(item.key)}
                disabled={busy}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="hv-field">
            <div className="hv-field-row">
              <label htmlFor="dvm-title">หัวข้อ</label>
              <small>{form.title.length}/256</small>
            </div>
            <input id="dvm-title" value={form.title} maxLength={256} onChange={(event) => update({ title: event.target.value })} disabled={loading || busy} placeholder="เว้นว่างได้" />
          </div>
          <div className="hv-field">
            <div className="hv-field-row">
              <label htmlFor="dvm-body">ข้อความ</label>
              <small>{form.body.length}/2000</small>
            </div>
            <textarea id="dvm-body" className="hv-textarea dvm-text" rows={4} value={form.body} maxLength={2000}
              onChange={(event) => update({ body: event.target.value })} disabled={loading || busy} placeholder="เว้นว่างได้" />
          </div>
          <div className="hv-field">
            <span>รูป</span>
            <div className="dvm-image-row">
              <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={pickFile} />
              <button type="button" className="hv-btn" onClick={() => fileInput.current?.click()} disabled={loading || busy}>
                <ImagePlus size={16} aria-hidden="true" /> {hasImage ? "เปลี่ยนรูป" : "เลือกรูป"}
              </button>
              {hasImage && (
                <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => update({ file: null, removeImage: true })} disabled={loading || busy}>
                  <Trash2 size={16} aria-hidden="true" /> เอารูปออก
                </button>
              )}
            </div>
            <small>PNG, JPG, GIF หรือ WebP ไม่เกิน 4MB รูปมีข้อความในตัวแล้ว ลบหัวข้อและข้อความออกได้</small>
          </div>
        </div>

        <div className="dbot-preview">
          <small>ตัวอย่างใน Discord</small>
          <div className="dvm-message">
            <span className="dbot-avatar" aria-hidden="true">ห</span>
            <div className="dvm-message-copy">
              <b>บอทห้องเสียง <em>BOT</em></b>
              <div className={`dvm-embed${tab === "panel" ? "" : " is-log"}`}>
                {form.title.trim() && <strong>{form.title}</strong>}
                {form.body.trim() && <p>{form.body}</p>}
                {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
                {imageUrl && <img src={imageUrl} alt="" />}
                {hasImage && !imageUrl && <span className="dvm-image-wait">กำลังโหลดรูป...</span>}
                {!form.title.trim() && !form.body.trim() && !hasImage && <p className="dvm-empty">ยังไม่มีอะไรให้แสดง</p>}
              </div>
              {tab === "panel" && (
                <div className="dvm-buttons" aria-hidden="true">
                  <span className="is-primary">สร้างห้อง</span>
                  <span>เข้าห้องที่ล็อก</span>
                  <span>ห้องของฉัน</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <footer className="dbot-foot">
        <span className="dbot-state">{state}</span>
        {!isDefault && <button type="button" className="hv-btn" onClick={resetToDefault} disabled={loading || busy}>ใช้ค่าเดิม</button>}
        {dirty && message && (
          <button type="button" className="hv-btn" onClick={() => update({ title: message.title, body: message.body, file: null, removeImage: false })} disabled={busy}>ยกเลิก</button>
        )}
        <button className="hv-btn hv-btn-primary" disabled={busy || loading || !dirty}>
          {busy && <span className="hv-spinner" aria-hidden="true" />}
          {busy ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </footer>
    </form>
  );
}
