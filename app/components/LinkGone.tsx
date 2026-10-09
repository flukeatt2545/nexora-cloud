"use client";

import { Check, Clock, Copy, Link2Off, RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import "./link-gone.css";

// Why a share link didn't open. "broken" is decided in the browser before any request.
export type LinkGoneKind = "broken" | "gone" | "busy" | "offline";

export const SHARE_TOKEN = /^[0-9a-f]{32}$/i;

/** Maps a failed share lookup to a kind; a network failure (no response) is "offline". */
export function linkGoneKind(status?: number): LinkGoneKind {
  if (status === undefined) return "offline";
  if (status === 429) return "busy";
  return status >= 500 ? "offline" : "gone";
}

type Props = {
  kind: LinkGoneKind;
  /** What was shared: "โฟลเดอร์" or "ไฟล์". */
  noun: string;
  onRetry: () => void;
  /** Show a home button; off where the page header already has one. */
  homeLink?: boolean;
};

export default function LinkGone({ kind, noun, onRetry, homeLink = false }: Props) {
  const [copied, setCopied] = useState(false);
  const retry = kind === "busy" || kind === "offline";
  const copy = {
    broken: { title: "ลิงก์ไม่ถูกต้อง", lead: "อาจคัดลอกมาไม่ครบหรือเกิน ลองเปิดจากข้อความต้นทางอีกครั้ง" },
    gone: { title: "ลิงก์นี้ใช้ไม่ได้แล้ว", lead: `หมดอายุ หรือเจ้าของยกเลิกการแชร์${noun} ขอลิงก์ใหม่จากคนที่ส่งมา` },
    busy: { title: "เปิดถี่เกินไป", lead: "รอสักครู่ แล้วลองใหม่" },
    offline: { title: "เชื่อมต่อไม่สำเร็จ", lead: "ตรวจอินเทอร์เน็ต แล้วลองอีกครั้ง" },
  }[kind];

  function copyLink() {
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  return (
    <div className={`lg is-${kind}`} aria-live="polite">
      <div className="lg-main">
        <span className={`lg-icon is-${kind}`} aria-hidden="true">
          {kind === "busy" ? <Clock size={22} /> : kind === "offline" ? <WifiOff size={22} /> : <Link2Off size={22} />}
        </span>
        <div className="lg-copy">
          <h1>{copy.title}</h1>
          <p>{copy.lead}</p>
        </div>
      </div>

      {(retry || kind === "gone" || homeLink) && (
        <div className="lg-actions">
          {retry && (
            <button type="button" className="lg-btn lg-btn-primary" onClick={onRetry}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>ลองอีกครั้ง</span>
            </button>
          )}
          {kind === "gone" && (
            <button type="button" className="lg-btn" onClick={copyLink}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              <span>{copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}</span>
            </button>
          )}
          {homeLink && (
            <Link href="/" className="lg-btn">
              <span>ไปหน้าหลัก</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
