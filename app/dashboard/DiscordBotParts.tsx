"use client";

import { type ReactNode, useState } from "react";
import { CircleAlert, type LucideIcon } from "lucide-react";

// Pieces every part of the Discord bot page is built from, so the cards, rows and save bar look
// the same everywhere. Styles: discord-bot-page.css (classes start with bp-).

export type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

/** On/off switch. Wrap it in a SwitchRow, or give it to a Card's toggle. */
export function Switch({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`sc-switch${on ? " is-on" : ""}`} onClick={() => onChange(!on)} disabled={disabled}>
      <span />
    </button>
  );
}

/** A box with a header (icon, title, one line of text) and a body. */
export function Card({ icon: Icon, title, text, aside, toggle, flush, children, className = "", id, busy }: {
  icon?: LucideIcon;
  title: ReactNode;
  text?: ReactNode;
  /** Buttons or counts on the right of the header. */
  aside?: ReactNode;
  /** A switch in the header: when it is off the body fades and its fields are the caller's to disable. */
  toggle?: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean };
  /** No padding in the body, for lists and rows that go edge to edge. */
  flush?: boolean;
  children?: ReactNode;
  className?: string;
  id?: string;
  busy?: boolean;
}) {
  return (
    <section className={`bp-card${toggle && !toggle.on ? " is-off" : ""} ${className}`.trim()} id={id} aria-busy={busy || undefined}>
      <header className="bp-card-head">
        {Icon && <span className="bp-icon" aria-hidden="true"><Icon size={18} /></span>}
        <div className="bp-card-title">
          <h3>{title}</h3>
          {text && <p>{text}</p>}
        </div>
        {(aside || toggle) && (
          <div className="bp-card-aside">
            {aside}
            {toggle && <Switch label={toggle.label} on={toggle.on} onChange={toggle.onChange} disabled={toggle.disabled} />}
          </div>
        )}
      </header>
      {children !== undefined && children !== null && <div className={`bp-card-body${flush ? " is-flush" : ""}`}>{children}</div>}
    </section>
  );
}

/** Rows of settings: a name and hint on the left, the control on the right. */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="bp-rows">{children}</div>;
}

export function Row({ title, hint, htmlFor, children, field }: { title: string; hint?: string; htmlFor?: string; children: ReactNode; field?: boolean }) {
  return (
    <div className="bp-row">
      <div className="bp-row-copy">
        {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : <strong>{title}</strong>}
        {hint && <small>{hint}</small>}
      </div>
      <div className={`bp-row-control${field ? " is-field" : ""}`}>{children}</div>
    </div>
  );
}

export function SwitchRow({ title, hint, on, onChange, disabled }: { title: string; hint?: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <Row title={title} hint={hint}>
      <Switch label={title} on={on} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

/** Fields laid out in as many columns as fit. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="bp-fields">{children}</div>;
}

/** The bar that slides up when something is changed and not saved yet. */
export function SaveBar({ dirty, busy, onCancel, text = "ยังไม่ได้บันทึก", extra }: {
  dirty: boolean;
  busy: boolean;
  onCancel: () => void;
  text?: string;
  extra?: ReactNode;
}) {
  if (!dirty && !busy) return null;
  return (
    <div className="bp-save" role="status">
      <span className="bp-save-text"><i aria-hidden="true" />{text}</span>
      {extra}
      <button type="button" className="hv-btn" onClick={onCancel} disabled={busy}>ยกเลิก</button>
      <button className="hv-btn hv-btn-primary" disabled={busy || !dirty}>
        {busy && <span className="hv-spinner" aria-hidden="true" />}
        {busy ? "กำลังบันทึก..." : "บันทึก"}
      </button>
    </div>
  );
}

/** What a part shows when its data would not load. */
export function LoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="hv-callout is-error" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <p><strong>{title}</strong><span>{message}</span></p>
      <button type="button" onClick={onRetry}>ลองอีกครั้ง</button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="bp-empty">{children}</p>;
}

/** "5 นาทีก่อน", "3 ชั่วโมงก่อน". */
export function ago(value: string | null | undefined) {
  if (!value) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีก่อน`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงก่อน`;
  return `${Math.round(hours / 24)} วันก่อน`;
}

/**
 * The bot's picture from Discord, or `fallback` when there is none or it will not load
 * (an old picture link stops working once the bot's avatar is changed in Discord).
 */
export function BotAvatar({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState("");
  if (!src || failed === src) return <>{fallback}</>;
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(src)} />;
}
