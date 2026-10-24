"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, ExternalLink, Eye, EyeOff, KeyRound, UserPlus, X } from "lucide-react";
import { ago, type Notice } from "./DiscordBotParts";
import { api, type BotKey } from "./DiscordMailBotSettings";
import { useEscape, useScrollLock } from "./useScrollLock";

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

/** What the page says about the bot right now, from its last report. */
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
 * One bot's connection, polled so the page shows it coming online after a new token.
 * Only superadmins can read it; for everyone else it stays empty and nothing is fetched.
 */
export function useBotConnection(botKey: BotKey, canManage: boolean) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => {
    if (!canManage) return;
    api<Connection>(`/api/admin/discord-bots/${botKey}/connection`)
      .then((data) => { setConnection(data); setLoadError(""); })
      .catch((error) => setLoadError((error as Error).message || "โหลดไม่สำเร็จ"));
  }, [botKey, canManage]);

  useEffect(() => {
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  const status = connection ? statusOf(connection) : null;
  const fromEnv = connection?.status.source === "env";
  const connected = Boolean(connection && (connection.configured || fromEnv));
  const botTag = connection?.botUsername || connection?.status.botTag || "";
  return { connection, setConnection, loadError, status, fromEnv, connected, botTag };
}

export type BotConnectionState = ReturnType<typeof useBotConnection>;

/** The short facts under the bot's name: its tag, how many servers, where the token is from. */
export function connectionFacts(conn: BotConnectionState) {
  const { connection, connected, botTag, fromEnv } = conn;
  const facts: string[] = [];
  if (!connection) return facts;
  if (!connected) return ["ยังไม่ได้ใส่ token"];
  if (botTag) facts.push(botTag);
  facts.push(connection.status.guildCount > 0 ? `อยู่ใน ${connection.status.guildCount} เซิร์ฟ` : "ยังไม่ได้เข้าเซิร์ฟไหน");
  facts.push(fromEnv ? "token จากไฟล์ .env" : `token ลงท้าย ${connection.hint}, เปลี่ยนล่าสุด ${ago(connection.updatedAt)}`);
  return facts;
}

/** Invite, change and remove the token (superadmins), with the dialog to enter a token. */
export function ConnectionActions({ notify, botKey, botName, conn }: {
  notify: Notice;
  botKey: BotKey;
  botName: string;
  conn: BotConnectionState;
}) {
  const { connection, setConnection, status, fromEnv, connected } = conn;
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

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

  if (!connection) return null;

  return (
    <>
      <div className="bp-hero-actions">
        {confirmRemove ? (
          <>
            <span className="bp-hero-warn" role="status">ลบแล้วบอทจะออฟไลน์</span>
            <button type="button" className="hv-btn" onClick={() => setConfirmRemove(false)} disabled={removing}>ไม่ลบ</button>
            <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => void remove()} disabled={removing}>ลบเลย</button>
          </>
        ) : connected ? (
          <>
            {connection.inviteUrl && (
              <a className="hv-btn" href={connection.inviteUrl} target="_blank" rel="noreferrer">
                <UserPlus size={16} aria-hidden="true" /> เชิญเข้าเซิร์ฟ
              </a>
            )}
            <button type="button" className="hv-btn" onClick={() => setOpen(true)}>{connection.configured ? "เปลี่ยน token" : "ใส่ token ในเว็บ"}</button>
            {connection.configured && (
              <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => setConfirmRemove(true)}>ลบ token</button>
            )}
          </>
        ) : (
          <button type="button" className="hv-btn hv-btn-primary" onClick={() => setOpen(true)}>
            <KeyRound size={16} aria-hidden="true" /> ใส่ token
          </button>
        )}
      </div>

      {status?.text === "token ใช้ไม่ได้" && (
        <div className="hv-callout is-error">
          <CircleAlert size={18} aria-hidden="true" />
          <p>
            <strong>Discord ไม่รับ token นี้</strong>
            <span>{fromEnv ? "token อาจถูก Reset ไปแล้ว ใส่ตัวใหม่ที่นี่ได้เลย บอทจะใช้ตัวนี้แทนตัวในไฟล์ .env" : "token อาจถูก Reset ไปแล้ว ใส่ตัวใหม่"}</span>
          </p>
        </div>
      )}

      {open && (
        <TokenDialog
          botKey={botKey}
          botName={botName}
          replacing={Boolean(connection.configured)}
          onClose={() => setOpen(false)}
          onSaved={(data) => { setConnection(data); notify({ kind: "success", text: `เชื่อม ${data.botUsername || botName} แล้ว` }); }}
        />
      )}
    </>
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
      <section className="hv-dialog bp-token-dialog" role="dialog" aria-modal="true" aria-labelledby="bp-token-title">
        <header className="hv-dialog-head">
          <div className="hv-dh-main">
            <KeyRound size={20} className="hv-dh-icon" aria-hidden="true" />
            <div className="hv-dh-text">
              <small>{botName}</small>
              <h2 id="bp-token-title">{saved ? "เชื่อมบอทแล้ว" : replacing ? "เปลี่ยน token" : "ใส่ token"}</h2>
            </div>
          </div>
          <button type="button" className="hv-btn hv-icon-btn" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
        </header>

        {saved ? (
          <>
            <div className="hv-dialog-body">
              <div className="bp-identity">
                <span className="bp-hero-avatar" aria-hidden="true">
                  {saved.botAvatarUrl ? <img src={saved.botAvatarUrl} alt="" /> : (saved.botUsername || "B").slice(0, 1).toUpperCase()}
                </span>
                <div className="bp-identity-copy">
                  <strong>{saved.botUsername}</strong>
                  <small>บอทจะออนไลน์ภายในครึ่งนาที</small>
                </div>
                <CircleCheck size={22} className="bp-ok" aria-hidden="true" />
              </div>
              <p className="bp-note">ถ้ายังไม่ได้เชิญบอทเข้าเซิร์ฟ กดปุ่มข้างล่างได้เลย ตั้งสิทธิ์ที่ต้องใช้ไว้ให้แล้ว</p>
            </div>
            <footer className="hv-dialog-foot">
              <button type="button" className="hv-btn" onClick={onClose}>ปิด</button>
              {saved.inviteUrl && (
                <a className="hv-btn hv-btn-primary" href={saved.inviteUrl} target="_blank" rel="noreferrer">
                  <UserPlus size={16} aria-hidden="true" /> เชิญเข้าเซิร์ฟ
                </a>
              )}
            </footer>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <div className="hv-dialog-body">
              <ol className="bp-steps">
                <li>
                  เปิด <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord Developer Portal <ExternalLink size={13} aria-hidden="true" /></a> แล้วเลือกแอปของบอท
                </li>
                <li>ไปที่เมนู <b>Bot</b> แล้วกด <b>Reset Token</b></li>
                <li>คัดลอก token มาวางข้างล่าง</li>
              </ol>
              <div className="hv-field">
                <label htmlFor="bp-token">Token</label>
                <div className="bp-secret">
                  <input
                    ref={input}
                    id="bp-token"
                    type={show ? "text" : "password"}
                    value={token}
                    onChange={(event) => { setToken(event.target.value); setError(""); }}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="วาง token ที่นี่"
                    disabled={busy}
                    aria-invalid={Boolean(error) || undefined}
                    aria-describedby="bp-token-help"
                  />
                  <button type="button" className="hv-btn hv-icon-btn" onClick={() => setShow(!show)} aria-label={show ? "ซ่อน token" : "แสดง token"} title={show ? "ซ่อน" : "แสดง"}>
                    {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
                <small id="bp-token-help">เช็กกับ Discord ก่อนบันทึก และบันทึกแล้วจะเปิดดู token อีกไม่ได้</small>
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
