"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, ExternalLink, Eye, EyeOff, KeyRound, Plug, UserPlus, X } from "lucide-react";
import { api } from "./DiscordMailBotSettings";
import { useEscape, useScrollLock } from "./useScrollLock";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

type Connection = {
  botKey: string;
  configured: boolean;
  hint: string;
  applicationId: string;
  botUsername: string;
  botAvatarUrl: string;
  updatedAt: string | null;
  inviteUrl: string;
  status: { state: string; source: string; botTag: string; guildCount: number; reportedAt: string | null; online: boolean };
};

function ago(value: string | null) {
  if (!value) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "เมื่อสักครู่";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} นาทีก่อน`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงก่อน`;
  return `${Math.round(hours / 24)} วันก่อน`;
}

/** What the card says about the bot right now, from its last report. */
function statusOf(connection: Connection) {
  const { status } = connection;
  const savedRecently = connection.updatedAt && Date.now() - new Date(connection.updatedAt).getTime() < 90000;
  // A report counts once it is about the token in use: from .env, or sent after the last save.
  const fresh = status.source === "env" || !connection.updatedAt
    || Boolean(status.reportedAt && new Date(status.reportedAt) >= new Date(connection.updatedAt));
  if (status.online && fresh) return { tone: "is-running", text: "ออนไลน์" };
  if (!fresh && savedRecently) return { tone: "is-provisioning", text: "กำลังเชื่อมต่อ" };
  if (status.state === "invalid_token" && fresh) return { tone: "is-error", text: "token ใช้ไม่ได้" };
  if (!connection.configured && status.source !== "env") return { tone: "", text: "ยังไม่ได้เชื่อม" };
  return { tone: "is-error", text: "ออฟไลน์" };
}

/**
 * The heading strip of one bot's group: its name, whether it is online, and (for superadmins)
 * its token and invite link, with a dialog to enter the token.
 */
export function DiscordBotConnection({ notify, botKey, botName, description, canManage }: {
  notify: Notice;
  botKey: "nexora" | "mail" | "voice";
  botName: string;
  description: string;
  canManage: boolean;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    if (!canManage) return;
    api<Connection>(`/api/admin/discord-bots/${botKey}/connection`)
      .then((data) => { setConnection(data); setLoadError(""); })
      .catch((error) => setLoadError((error as Error).message || "โหลดไม่สำเร็จ"));
  }, [botKey, canManage]);

  useEffect(() => {
    const first = window.setTimeout(load, 0);
    // Keep the status fresh so the strip shows the bot coming online after a new token.
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  async function remove() {
    setRemoving(true);
    try {
      const data = await api<Connection>(`/api/admin/discord-bots/${botKey}/token`, { method: "DELETE" });
      setConnection(data);
      notify({ kind: "success", text: "ลบ token แล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  }

  const status = connection ? statusOf(connection) : null;
  const fromEnv = connection?.status.source === "env";
  const connected = Boolean(connection && (connection.configured || fromEnv));
  const botTag = connection?.botUsername || connection?.status.botTag || "";

  // One short line under the description: who the bot is and where its token comes from.
  const facts: string[] = [];
  if (connection && connected) {
    if (botTag) facts.push(botTag);
    facts.push(connection.status.guildCount > 0 ? `อยู่ใน ${connection.status.guildCount} เซิร์ฟเวอร์` : "ยังไม่อยู่ในเซิร์ฟเวอร์ไหน");
    facts.push(fromEnv ? "ใช้ token จากไฟล์ .env" : `token ••••${connection.hint} · เปลี่ยน${ago(connection.updatedAt)}`);
  } else if (connection) {
    facts.push("ยังไม่ได้ใส่ token");
  }

  return (
    <header className="aov-panel dbot-conn">
      <div className="dbot-conn-main">
        <span className={`dbot-avatar dbot-conn-avatar${connected ? "" : " is-empty"}`} aria-hidden="true">
          {connection?.botAvatarUrl ? <img src={connection.botAvatarUrl} alt="" /> : connected ? (botTag || botName).slice(0, 1).toUpperCase() : <Plug size={18} />}
        </span>
        <div className="dbot-conn-copy">
          <div className="dbot-conn-title">
            <h2>{botName}</h2>
            {status && <span className={`hv-status ${status.tone}`}>{status.text}</span>}
          </div>
          <p>{description}</p>
          {facts.length > 0 && <small>{facts.join(" · ")}</small>}
          {loadError && <small className="dbot-conn-error">โหลดสถานะไม่สำเร็จ: {loadError}</small>}
        </div>
        {canManage && connection && (
          <div className="dbot-conn-actions">
            {confirmRemove ? (
              <>
                <span className="dbot-state">บอทจะออฟไลน์</span>
                <button type="button" className="hv-btn" onClick={() => setConfirmRemove(false)} disabled={removing}>ไม่ลบ</button>
                <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => void remove()} disabled={removing}>ลบเลย</button>
              </>
            ) : connected ? (
              <>
                {connection.inviteUrl && (
                  <a className="hv-btn" href={connection.inviteUrl} target="_blank" rel="noreferrer">
                    <UserPlus size={16} aria-hidden="true" /> เชิญเข้าเซิร์ฟเวอร์
                  </a>
                )}
                {connection.configured && (
                  <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => setConfirmRemove(true)}>ลบ token</button>
                )}
                <button type="button" className="hv-btn" onClick={() => setOpen(true)}>{connection.configured ? "เปลี่ยน token" : "ใส่ token ในเว็บ"}</button>
              </>
            ) : (
              <button type="button" className="hv-btn hv-btn-primary" onClick={() => setOpen(true)}>
                <KeyRound size={16} aria-hidden="true" /> ใส่ token
              </button>
            )}
          </div>
        )}
      </div>

      {status?.text === "token ใช้ไม่ได้" && (
        <div className="hv-callout is-error dbot-conn-alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p><strong>Discord ไม่รับ token นี้</strong><span>{fromEnv ? "อาจถูก Reset ไปแล้ว ใส่ token ใหม่ที่นี่ได้เลย บอทจะใช้แทนตัวในไฟล์ .env" : "อาจถูก Reset ไปแล้ว ใส่ตัวใหม่"}</span></p>
        </div>
      )}

      {open && (
        <TokenDialog
          botKey={botKey}
          botName={botName}
          replacing={Boolean(connection?.configured)}
          onClose={() => setOpen(false)}
          onSaved={(data) => { setConnection(data); notify({ kind: "success", text: `เชื่อม ${data.botUsername || botName} แล้ว` }); }}
        />
      )}
    </header>
  );
}

function TokenDialog({ botKey, botName, replacing, onClose, onSaved }: {
  botKey: string;
  botName: string;
  replacing: boolean;
  onClose: () => void;
  onSaved: (connection: Connection) => void;
}) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Connection | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useScrollLock(true);
  useEscape(!busy, onClose);
  useEffect(() => { input.current?.focus(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setError("วาง token ก่อน");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<Connection>(`/api/admin/discord-bots/${botKey}/token`, { method: "PUT", body: JSON.stringify({ token }) });
      setToken("");
      setSaved(data);
      onSaved(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="hv-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="hv-dialog dbot-token-dialog" role="dialog" aria-modal="true" aria-labelledby="dbot-token-title">
        <header className="hv-dialog-head">
          <div className="hv-dh-main">
            <KeyRound size={20} className="hv-dh-icon" aria-hidden="true" />
            <div className="hv-dh-text">
              <small>{botName}</small>
              <h2 id="dbot-token-title">{saved ? "เชื่อมบอทแล้ว" : replacing ? "เปลี่ยน token" : "ใส่ token"}</h2>
            </div>
          </div>
          <button type="button" className="hv-btn hv-icon-btn" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
        </header>

        {saved ? (
          <>
            <div className="hv-dialog-body">
              <div className="dbot-identity">
                <span className="dbot-avatar dbot-identity-avatar">
                  {saved.botAvatarUrl ? <img src={saved.botAvatarUrl} alt="" /> : (saved.botUsername || "B").slice(0, 1).toUpperCase()}
                </span>
                <div className="dbot-identity-copy">
                  <strong>{saved.botUsername}</strong>
                  <small>บอทจะออนไลน์ภายในครึ่งนาที</small>
                </div>
                <CircleCheck size={22} className="dbot-ok" aria-hidden="true" />
              </div>
              <p className="dbot-dialog-note">ยังไม่ได้เชิญบอทเข้าเซิร์ฟเวอร์ก็กดปุ่มด้านล่าง เลือกสิทธิ์ไว้ให้แล้ว</p>
            </div>
            <footer className="hv-dialog-foot">
              <button type="button" className="hv-btn" onClick={onClose}>ปิด</button>
              {saved.inviteUrl && (
                <a className="hv-btn hv-btn-primary" href={saved.inviteUrl} target="_blank" rel="noreferrer">
                  <UserPlus size={16} aria-hidden="true" /> เชิญเข้าเซิร์ฟเวอร์
                </a>
              )}
            </footer>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <div className="hv-dialog-body">
              <ol className="dbot-steps">
                <li>
                  เปิด <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord Developer Portal <ExternalLink size={13} aria-hidden="true" /></a> แล้วเลือกแอปของบอท
                </li>
                <li>ไปที่เมนู <b>Bot</b> แล้วกด <b>Reset Token</b></li>
                <li>คัดลอก token มาวางด้านล่าง</li>
              </ol>
              <div className="hv-field">
                <label htmlFor="dbot-token">Token</label>
                <div className="dbot-secret">
                  <input
                    ref={input}
                    id="dbot-token"
                    type={show ? "text" : "password"}
                    value={token}
                    onChange={(event) => { setToken(event.target.value); setError(""); }}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="วาง token ที่นี่"
                    disabled={busy}
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby="dbot-token-help"
                  />
                  <button type="button" className="hv-btn hv-icon-btn" onClick={() => setShow(!show)} aria-label={show ? "ซ่อน token" : "แสดง token"} title={show ? "ซ่อน" : "แสดง"}>
                    {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
                <small id="dbot-token-help">เช็กกับ Discord ก่อนบันทึก บันทึกแล้วเปิดดูอีกไม่ได้</small>
              </div>
              {error && (
                <div className="hv-callout is-error" role="alert">
                  <CircleAlert size={18} aria-hidden="true" />
                  <p><strong>ใช้ token นี้ไม่ได้</strong><span>{error}</span></p>
                </div>
              )}
            </div>
            <footer className="hv-dialog-foot">
              <button type="button" className="hv-btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
              <button className="hv-btn hv-btn-primary" disabled={busy || !token.trim()}>
                {busy && <span className="hv-spinner" aria-hidden="true" />}
                {busy ? "กำลังเช็ก..." : "บันทึก"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>,
    document.body,
  );
}
