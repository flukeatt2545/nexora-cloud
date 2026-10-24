"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ImagePlus, MessageSquareText, Trash2 } from "lucide-react";
import { API_BASE } from "../runtime";
import { Card, LoadError, type Notice, SaveBar } from "./DiscordBotParts";
import { api } from "./DiscordMailBotSettings";

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
  { key: "log", label: "ห้อง log", command: "/setup-room-log" },
  { key: "voicelog", label: "ห้องประวัติเข้าออก", command: "/setup-voice-log" },
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
    if (message.pending) state = `บอทกำลังแก้ข้อความใน Discord (${message.pending} ที่)`;
    else if (message.posted) state = `ลงไว้ ${message.posted} ที่ ตรงกับที่ตั้งไว้`;
    else state = `ยังไม่ได้ลง พิมพ์ ${info.command} ในห้องที่จะลง`;
  }

  if (loadError) return <LoadError title="โหลดข้อความไม่ได้" message={loadError} onRetry={() => load(true)} />;

  return (
    <form className="bp-pane" onSubmit={(event) => void save(event)} aria-busy={loading}>
      <Card icon={MessageSquareText} title="ข้อความที่บอทลงไว้" text="แก้ตรงนี้แล้วข้อความใน Discord เปลี่ยนตาม" busy={loading}
        aside={message && !dirty ? <span className="bp-state"><Check size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> {state}</span> : undefined}>
        <div className="bp-pills" role="tablist" aria-label="ข้อความ">
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

        <div className="bp-split">
          <div className="bp-edit">
            <div className="hv-field">
              <div className="hv-field-row">
                <label htmlFor="vm-title">หัวข้อ</label>
                <small>{form.title.length}/256</small>
              </div>
              <input id="vm-title" value={form.title} maxLength={256} onChange={(event) => update({ title: event.target.value })} disabled={loading || busy} placeholder="เว้นว่างได้" />
            </div>
            <div className="hv-field">
              <div className="hv-field-row">
                <label htmlFor="vm-body">ข้อความ</label>
                <small>{form.body.length}/2000</small>
              </div>
              <textarea id="vm-body" className="hv-textarea bp-text" rows={4} value={form.body} maxLength={2000}
                onChange={(event) => update({ body: event.target.value })} disabled={loading || busy} placeholder="เว้นว่างได้" />
            </div>
            <div className="hv-field">
              <span>รูป</span>
              <div className="bp-image-row">
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
              <small>PNG, JPG, GIF หรือ WebP ไม่เกิน 4MB ถ้าในรูปมีข้อความอยู่แล้ว ลบหัวข้อกับข้อความออกได้</small>
            </div>
            {!isDefault && (
              <div>
                <button type="button" className="hv-btn" onClick={resetToDefault} disabled={loading || busy}>ใช้ข้อความเดิมของบอท</button>
              </div>
            )}
          </div>

          <figure className="bp-dc">
            <figcaption>ที่เห็นใน Discord</figcaption>
            <div className="bp-message">
              <span className="bp-dc-avatar" aria-hidden="true">ห</span>
              <div className="bp-message-copy">
                <b>บอทห้องเสียง <em>BOT</em></b>
                <div className={`bp-embed${tab === "panel" ? "" : " is-log"}`}>
                  {form.title.trim() && <strong>{form.title}</strong>}
                  {form.body.trim() && <p>{form.body}</p>}
                  {imageUrl && <img src={imageUrl} alt="" />}
                  {hasImage && !imageUrl && <span className="bp-muted">กำลังโหลดรูป...</span>}
                  {!form.title.trim() && !form.body.trim() && !hasImage && <p className="bp-muted">ยังไม่มีอะไรให้แสดง</p>}
                </div>
                {tab === "panel" && (
                  <div className="bp-buttons" aria-hidden="true">
                    <span className="is-primary">สร้างห้อง</span>
                    <span>เข้าห้องที่ล็อก</span>
                    <span>ห้องของฉัน</span>
                  </div>
                )}
              </div>
            </div>
          </figure>
        </div>
      </Card>
      <SaveBar dirty={dirty} busy={busy} text="ยังไม่ได้บันทึกข้อความนี้"
        onCancel={() => { if (message) update({ title: message.title, body: message.body, file: null, removeImage: false }); }} />
    </form>
  );
}
