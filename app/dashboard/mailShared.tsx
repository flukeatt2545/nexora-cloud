"use client";

// What the webmail pieces (MailView, MailCompose, MailManage) share: the API call, the shapes
// the API returns, dates, and the copy button.
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { API_BASE } from "../runtime";

export type Notice = (notice: { kind: "success" | "error"; text: string }) => void;

export type Mailbox = {
  id: string;
  address: string;
  displayName: string;
  quotaBytes: number;
  usedBytes: number;
  dailySendLimit: number;
  role: string;
  unread: number;
};
export type Recipient = { kind: string; address: string; name: string };
export type MailItem = {
  id: string;
  threadId: string;
  direction: string;
  folder: string;
  status: string;
  from: string;
  fromName: string;
  subject: string;
  preview: string;
  date: string;
  read: boolean;
  hasAttachments: boolean;
  recipients: Recipient[];
};
export type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl?: string;
  inBody?: boolean;
};
export type Message = MailItem & {
  html: string;
  text: string;
  inReplyTo: string;
  internetMessageId?: string;
  references: string[];
  sentAt?: string;
  receivedAt?: string;
  attachments: Attachment[];
};
export type ThreadMessage = Pick<
  Message,
  "id" | "direction" | "folder" | "status" | "from" | "fromName" | "subject" | "html" | "text" | "inReplyTo" | "references" | "internetMessageId" | "recipients"
> & { date: string };
export type Domain = {
  id: string;
  domain: string;
  kind: string;
  status: string;
  dnsRecords: Record<string, unknown>[];
  verifiedAt?: string;
  approvedAt?: string;
  ownerUsername?: string;
  mailboxCount: number;
};
export type ComposeState = {
  draftId?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  inReplyTo: string;
  references: string[];
  attachments: { filename: string; contentType: string; content: string }[];
};

export const emptyCompose: ComposeState = { to: "", cc: "", bcc: "", subject: "", html: "", inReplyTo: "", references: [], attachments: [] };

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

export function escapeHTML(value: string): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function bytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function validDate(value?: string) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Full date and time, for the open message and tooltips. */
export function fullDate(value?: string) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date) : "";
}

/** List dates the way a mail app shows them: the time today, then the day, then the year. */
export function shortDate(value: string, now: number) {
  const date = validDate(value);
  if (!date) return "";
  const today = new Date(now);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(date);
  const yesterday = new Date(now - 86_400_000);
  if (sameDay(date, yesterday)) return "เมื่อวาน";
  if (date.getFullYear() === today.getFullYear()) return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(date);
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(date);
}

/** The letter for an avatar: the first character people read, skipping Thai leading vowels. */
export function initial(name: string) {
  const letter = name.replace(/^[\s"'<]+/, "").replace(/^[เแโใไ]/, "").charAt(0);
  return (letter || "?").toUpperCase();
}

/** "contact" from "contact@example.com", for the shorter label. */
export function localPart(address: string) {
  return address.split("@")[0] || address;
}

/**
 * The Clipboard API is missing on plain-HTTP pages and refused in some embedded browsers; the
 * old select-and-copy still works there.
 */
export async function writeClipboard(value: string) {
  try {
    // Some embedded browsers leave the promise pending forever instead of refusing.
    await Promise.race([
      navigator.clipboard.writeText(value),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("clipboard timeout")), 800)),
    ]);
    return;
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("copy failed");
  }
}

/**
 * Copies a value and says so on the button for a moment. `label` is what is copied ("อีเมล",
 * "ชื่อเซิร์ฟเวอร์"...) and is read out by screen readers; `withText` shows a word next to the icon.
 */
export function CopyButton({ value, label = "อีเมล", withText = false, className = "", onError }: {
  value: string;
  label?: string;
  withText?: boolean;
  className?: string;
  onError?: () => void;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy(event: MouseEvent) {
    event.stopPropagation();
    try {
      await writeClipboard(value);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1600);
    } catch {
      onError?.();
    }
  }
  return (
    <button
      type="button"
      className={`wm-copy${done ? " is-done" : ""}${withText ? " has-text" : ""}${className ? ` ${className}` : ""}`}
      onClick={(event) => void copy(event)}
      aria-label={done ? `คัดลอก${label}แล้ว` : `คัดลอก${label} ${value}`}
      title={done ? "คัดลอกแล้ว" : `คัดลอก${label}`}
    >
      {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      {withText && <span>{done ? "คัดลอกแล้ว" : "คัดลอก"}</span>}
      <span className="wm-sr" aria-live="polite">{done ? "คัดลอกแล้ว" : ""}</span>
    </button>
  );
}
