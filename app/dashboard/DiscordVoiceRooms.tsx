"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CircleAlert, KeyRound, LockKeyhole, LockKeyholeOpen, RefreshCw, Trash2, Volume2 } from "lucide-react";
import { api } from "./DiscordMailBotSettings";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

type VoiceSettings = {
  enabled: boolean;
  maxRoomsPerUser: number;
  emptyDeleteMinutes: number;
  maxFailures: number;
  lockoutMinutes: number;
};

type VoiceRoom = {
  id: number;
  guildId: string;
  channelId: string;
  ownerDiscordId: string;
  ownerUsername: string;
  name: string;
  locked: boolean;
  userLimit: number;
  deleteRequested: boolean;
  accessCount: number;
  createdAt: string;
  guildName: string;
  siteUsername?: string;
  kind: "command" | "join";
  hasPassword: boolean;
};

type Form = { enabled: boolean; max: string; empty: string; failures: string; lockout: string };

const fields = [
  { key: "max", label: "ห้องต่อคน", min: 0, max: 20, hint: "0 คือสร้างไม่ได้" },
  { key: "empty", label: "ลบห้องว่างหลัง (นาที)", min: 1, max: 1440, hint: "นับจากคนสุดท้ายออก" },
  { key: "failures", label: "ใส่รหัสผิดได้ (ครั้ง)", min: 1, max: 20, hint: "ครบแล้วห้ามลองห้องนั้น" },
  { key: "lockout", label: "ห้ามลองนาน (นาที)", min: 1, max: 1440, hint: "ต่อคน ต่อห้อง" },
] as const;

function toForm(settings: VoiceSettings): Form {
  return {
    enabled: settings.enabled,
    max: String(settings.maxRoomsPerUser),
    empty: String(settings.emptyDeleteMinutes),
    failures: String(settings.maxFailures),
    lockout: String(settings.lockoutMinutes),
  };
}

function since(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีก่อน`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงก่อน`;
  return `${Math.round(hours / 24)} วันก่อน`;
}

/** Limits for the voice room bot, and the rooms that exist right now (superadmin). */
export function DiscordVoiceRooms({ notify }: { notify: Notice }) {
  const [form, setForm] = useState<Form>({ enabled: true, max: "3", empty: "5", failures: "5", lockout: "10" });
  const [saved, setSaved] = useState<Form | null>(null);
  const [rooms, setRooms] = useState<VoiceRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(0);
  const [deletingId, setDeletingId] = useState(0);

  const load = useCallback((keepForm = false) => {
    setLoading(true);
    api<{ settings: VoiceSettings; rooms: VoiceRoom[] }>("/api/admin/discord-voice-rooms")
      .then((data) => {
        if (!keepForm) {
          setForm(toForm(data.settings));
          setSaved(toForm(data.settings));
        }
        setRooms(data.rooms || []);
        setLoadError("");
      })
      .catch((error) => setLoadError((error as Error).message || "โหลดไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const dirty = Boolean(saved && JSON.stringify(saved) !== JSON.stringify(form));

  async function save(event: FormEvent) {
    event.preventDefault();
    const values = { max: Number(form.max), empty: Number(form.empty), failures: Number(form.failures), lockout: Number(form.lockout) };
    for (const field of fields) {
      const value = values[field.key];
      if (!Number.isInteger(value) || value < field.min || value > field.max) {
        notify({ kind: "error", text: `${field.label} ต้องอยู่ระหว่าง ${field.min}–${field.max}` });
        return;
      }
    }
    setBusy(true);
    try {
      const data = await api<VoiceSettings>("/api/admin/discord-voice-rooms/settings", {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled,
          maxRoomsPerUser: values.max,
          emptyDeleteMinutes: values.empty,
          maxFailures: values.failures,
          lockoutMinutes: values.lockout,
        }),
      });
      setForm(toForm(data));
      setSaved(toForm(data));
      notify({ kind: "success", text: "บันทึกแล้ว บอทใช้ค่าใหม่ภายใน 30 วินาที" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(room: VoiceRoom) {
    setDeletingId(room.id);
    try {
      await api(`/api/admin/discord-voice-rooms/${room.id}`, { method: "DELETE" });
      setRooms((current) => current.map((item) => item.id === room.id ? { ...item, deleteRequested: true } : item));
      notify({ kind: "success", text: `ห้อง ${room.name} จะหายจาก Discord ภายใน 30 วินาที` });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setDeletingId(0);
      setConfirmId(0);
    }
  }

  // The bot can be in several servers: name the server when the list mixes them.
  const manyServers = new Set(rooms.map((room) => room.guildId)).size > 1;

  if (loadError) {
    return (
      <section className="aov-panel dbot-card dbot-wide">
        <div className="dbot-body">
          <div className="hv-callout is-error">
            <CircleAlert size={18} aria-hidden="true" />
            <p><strong>โหลดห้องไม่ได้</strong><span>{loadError}</span></p>
            <button type="button" onClick={() => load()}>ลองอีกครั้ง</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <form className="aov-panel dbot-card" onSubmit={(event) => void save(event)} aria-busy={loading}>
        <header className="dbot-card-head">
          <span className="dbot-mark" aria-hidden="true"><KeyRound size={18} /></span>
          <div>
            <h2>กติกาห้อง</h2>
            <p>ใช้กับทุกห้องของบอทนี้</p>
          </div>
        </header>
        <div className="dbot-body">
          <div className="dbot-switch-row">
            <div>
              <strong>เปิดให้สร้างห้อง</strong>
              <small>{form.enabled ? "สร้างห้องใหม่ได้" : "ปิดอยู่ ห้องเดิมยังใช้ได้"}</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              aria-label="เปิดให้สร้างห้อง"
              className={`sc-switch${form.enabled ? " is-on" : ""}`}
              onClick={() => setForm({ ...form, enabled: !form.enabled })}
              disabled={loading}
            >
              <span />
            </button>
          </div>
          <div className="dbot-fields">
            {fields.map((field) => (
              <div className="hv-field" key={field.key}>
                <label htmlFor={`voice-${field.key}`}>{field.label}</label>
                <input
                  id={`voice-${field.key}`}
                  type="number"
                  inputMode="numeric"
                  min={field.min}
                  max={field.max}
                  step={1}
                  value={form[field.key]}
                  onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                  disabled={loading}
                  required
                />
                <small>{field.hint}</small>
              </div>
            ))}
          </div>
        </div>
        <footer className="dbot-foot">
          <span className="dbot-state">{loading ? "กำลังโหลด..." : dirty ? "ยังไม่ได้บันทึก" : "ไม่มีอะไรเปลี่ยน"}</span>
          {dirty && <button type="button" className="hv-btn" onClick={() => saved && setForm(saved)} disabled={busy}>ยกเลิก</button>}
          <button className="hv-btn hv-btn-primary" disabled={busy || loading || !dirty}>
            {busy && <span className="hv-spinner" aria-hidden="true" />}
            {busy ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </footer>
      </form>

      <section className="aov-panel dbot-card dbot-wide" aria-busy={loading}>
        <header className="dbot-card-head">
          <span className="dbot-mark" aria-hidden="true"><Volume2 size={18} /></span>
          <div>
            <h2>ห้องที่เปิดอยู่ <span className="dbot-count">{rooms.length}</span></h2>
            <p>ลบที่นี่แล้วห้องใน Discord หายด้วย</p>
          </div>
          <button type="button" className="hv-btn hv-icon-btn dbot-refresh" onClick={() => load(true)} disabled={loading} aria-label="โหลดใหม่" title="โหลดใหม่">
            <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
          </button>
        </header>
        {rooms.length === 0 ? (
          <p className="dbot-empty">{loading ? "กำลังโหลด..." : "ยังไม่มีห้อง"}</p>
        ) : (
          <ul className="dbot-rooms">
            {rooms.map((room) => (
              <li key={room.id} className={room.deleteRequested ? "is-leaving" : undefined}>
                <span className={`dbot-room-lock${room.locked ? " is-locked" : ""}`} title={room.locked ? (room.hasPassword ? "ล็อกอยู่" : "เข้าได้เฉพาะเจ้าของ") : "ใครก็เข้าได้"}>
                  {room.locked ? <LockKeyhole size={16} aria-hidden="true" /> : <LockKeyholeOpen size={16} aria-hidden="true" />}
                </span>
                <div className="dbot-room-copy">
                  <a href={`https://discord.com/channels/${room.guildId}/${room.channelId}`} target="_blank" rel="noreferrer">{room.name}</a>
                  <small>
                    {manyServers && room.guildName && <>{room.guildName} · </>}
                    @{room.ownerUsername || room.ownerDiscordId}
                    {room.siteUsername && <> · บัญชีเว็บ {room.siteUsername}</>}
                    {" · "}{room.kind === "join" ? "Join to Create" : "คำสั่ง /room"}
                    {room.hasPassword ? <> · ใส่รหัสแล้ว {room.accessCount} คน</> : " · ยังไม่ได้ตั้งรหัส"}
                    {" · "}{since(room.createdAt)}
                  </small>
                </div>
                {room.deleteRequested ? (
                  <span className="dbot-state">กำลังลบ...</span>
                ) : confirmId === room.id ? (
                  <span className="dbot-room-actions">
                    <button type="button" className="hv-btn" onClick={() => setConfirmId(0)} disabled={deletingId === room.id}>ไม่ลบ</button>
                    <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => void remove(room)} disabled={deletingId === room.id}>ลบเลย</button>
                  </span>
                ) : (
                  <button type="button" className="hv-btn hv-icon-btn hv-btn-danger-ghost" onClick={() => setConfirmId(room.id)} aria-label={`ลบห้อง ${room.name}`} title="ลบห้อง">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
