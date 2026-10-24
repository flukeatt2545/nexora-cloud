"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { KeyRound, LockKeyhole, LockKeyholeOpen, RefreshCw, Trash2, Volume2 } from "lucide-react";
import { Card, Fields, LoadError, type Notice, SaveBar, ago } from "./DiscordBotParts";
import { api } from "./DiscordMailBotSettings";

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
  { key: "max", label: "ห้องต่อคน", min: 0, max: 20, hint: "ใส่ 0 = สร้างห้องไม่ได้" },
  { key: "empty", label: "ลบห้องว่างหลัง (นาที)", min: 1, max: 1440, hint: "นับจากคนสุดท้ายออกจากห้อง" },
  { key: "failures", label: "ใส่รหัสผิดได้ (ครั้ง)", min: 1, max: 20, hint: "ผิดครบแล้วลองห้องนั้นอีกไม่ได้" },
  { key: "lockout", label: "ห้ามลองนาน (นาที)", min: 1, max: 1440, hint: "นับแยกต่อคน ต่อห้อง" },
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

  if (loadError) return <LoadError title="โหลดห้องไม่ได้" message={loadError} onRetry={() => load()} />;

  return (
    <>
      <form className="bp-pane" onSubmit={(event) => void save(event)} aria-busy={loading}>
        <Card icon={KeyRound} title="กติกาของห้อง" text="ใช้กับทุกห้องของบอทนี้" flush busy={loading}
          toggle={{ label: "เปิดให้สร้างห้อง", on: form.enabled, onChange: (enabled) => setForm({ ...form, enabled }), disabled: loading }}>
          <Fields>
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
          </Fields>
        </Card>
        <SaveBar dirty={dirty} busy={busy} onCancel={() => saved && setForm(saved)}
          text={form.enabled ? "ยังไม่ได้บันทึก" : "ยังไม่ได้บันทึก ถ้าบันทึกจะสร้างห้องใหม่ไม่ได้ ห้องเดิมยังใช้ได้"} />
      </form>

      <Card icon={Volume2} title="ห้องที่เปิดอยู่" text="ลบที่นี่แล้วห้องใน Discord หายด้วย" flush busy={loading}
        aside={(
          <>
            <span className="bp-count">{rooms.length}</span>
            <button type="button" className="hv-btn hv-icon-btn bp-refresh" onClick={() => load(true)} disabled={loading} aria-label="โหลดใหม่" title="โหลดใหม่">
              <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
            </button>
          </>
        )}>
        {rooms.length === 0 ? (
          <p className="bp-empty">{loading ? "กำลังโหลด..." : "ยังไม่มีห้อง"}</p>
        ) : (
          <ul className="bp-list">
            {rooms.map((room) => (
              <li key={room.id} className={room.deleteRequested ? "is-leaving" : undefined}>
                <span className={`bp-lock${room.locked ? " is-locked" : ""}`} title={room.locked ? (room.hasPassword ? "ล็อกอยู่" : "เข้าได้เฉพาะเจ้าของ") : "ใครก็เข้าได้"}>
                  {room.locked ? <LockKeyhole size={16} aria-hidden="true" /> : <LockKeyholeOpen size={16} aria-hidden="true" />}
                </span>
                <div className="bp-item">
                  <a href={`https://discord.com/channels/${room.guildId}/${room.channelId}`} target="_blank" rel="noreferrer">{room.name}</a>
                  <small>
                    {manyServers && room.guildName && <>{room.guildName}, </>}
                    @{room.ownerUsername || room.ownerDiscordId}
                    {room.siteUsername && <>, บัญชีเว็บ {room.siteUsername}</>}
                    {", "}{room.kind === "join" ? "Join to Create" : "คำสั่ง /room"}
                    {room.hasPassword ? <>, ใส่รหัสแล้ว {room.accessCount} คน</> : ", ยังไม่ได้ตั้งรหัส"}
                    {", "}{ago(room.createdAt)}
                  </small>
                </div>
                {room.deleteRequested ? (
                  <span className="bp-state">กำลังลบ...</span>
                ) : confirmId === room.id ? (
                  <span className="bp-actions">
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
      </Card>
    </>
  );
}
