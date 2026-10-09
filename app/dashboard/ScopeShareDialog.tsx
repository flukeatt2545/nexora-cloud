"use client";

import { Check, Copy, ExternalLink, FolderOpen, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { API_BASE } from "../runtime";

export type ShareScope = {
  kind: "category" | "folder";
  id: number;
  name: string;
  /** Current link, if one is active (from the category/folder list). */
  shareUrl?: string;
  shareExpiresAt?: string | null;
};

type Props = {
  scope: ShareScope;
  admin: boolean;
  onClose: () => void;
  /** Reload the lists so the bar shows the new state. */
  onChanged: () => void;
  notify: (next: { kind: "success" | "error"; text: string }) => void;
};

function endpoint(scope: ShareScope, admin: boolean) {
  if (scope.kind === "folder") return admin ? `/api/admin/user-file-folders/${scope.id}/share` : `/api/files/folders/${scope.id}/share`;
  return admin ? `/api/admin/user-file-categories/${scope.id}/share` : `/api/files/categories/${scope.id}/share`;
}

function expiryText(value?: string | null) {
  if (!value) return "ไม่มีวันหมดอายุ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `หมดอายุ ${date.toLocaleString("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
}

/** Create, copy or revoke the public link of a whole category or one folder. */
export default function ScopeShareDialog({ scope, admin, onClose, onChanged, notify }: Props) {
  const [link, setLink] = useState<{ url: string; expiresAt?: string | null } | null>(
    scope.shareUrl ? { url: scope.shareUrl, expiresAt: scope.shareExpiresAt } : null,
  );
  const [expiresIn, setExpiresIn] = useState("7d");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const fullUrl = link && typeof window !== "undefined" ? `${window.location.origin}${link.url}` : link?.url || "";
  const noun = scope.kind === "folder" ? "แฟ้ม" : "หมวดหมู่";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      return false;
    }
  }

  async function create() {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}${endpoint(scope, admin)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.shareUrl) throw new Error(data.error || "สร้างลิงก์ไม่สำเร็จ");
      setLink({ url: data.shareUrl, expiresAt: data.expiresAt ?? null });
      const copiedNow = await copy(`${window.location.origin}${data.shareUrl}`);
      notify({ kind: "success", text: copiedNow ? "สร้างลิงก์และคัดลอกแล้ว" : "สร้างลิงก์แล้ว" });
      onChanged();
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : "สร้างลิงก์ไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirmRevoke) { setConfirmRevoke(true); return; }
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}${endpoint(scope, admin)}`, { method: "DELETE", credentials: "include" });
      if (!response.ok && response.status !== 404) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "ยกเลิกลิงก์ไม่สำเร็จ");
      }
      setLink(null);
      setConfirmRevoke(false);
      notify({ kind: "success", text: "ยกเลิกลิงก์แล้ว คนที่มีลิงก์เดิมจะเปิดไม่ได้" });
      onChanged();
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : "ยกเลิกลิงก์ไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="file-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="file-modal scope-share" role="dialog" aria-modal="true" aria-labelledby="scope-share-title">
        <header>
          <span>{scope.kind === "folder" ? <FolderOpen size={20} /> : <Share2 size={20} />}</span>
          <div>
            <h2 id="scope-share-title">แชร์{noun}</h2>
            <p title={scope.name}>{scope.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
        </header>

        <div className="scope-share-body">
          <p className="scope-share-note">
            {scope.kind === "folder"
              ? "คนที่มีลิงก์เห็นไฟล์ในแฟ้มนี้และแฟ้มย่อย ไม่เห็นแฟ้มอื่นในหมวด"
              : admin
                ? "คนที่มีลิงก์เห็นทุกแฟ้มและไฟล์ในหมวดนี้ รวมของผู้ใช้ทุกคน"
                : "คนที่มีลิงก์เห็นทุกแฟ้มและไฟล์ของคุณในหมวดนี้"}
            {" "}ไฟล์ที่ซ่อนไว้จะไม่แสดง
          </p>

          {link ? (
            <>
              <div className="scope-share-link">
                <input type="text" readOnly value={fullUrl} aria-label="ลิงก์แชร์" onFocus={(event) => event.currentTarget.select()} />
                <button type="button" className="scope-share-btn is-primary" onClick={() => void copy(fullUrl)}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  <span>{copied ? "คัดลอกแล้ว" : "คัดลอก"}</span>
                </button>
              </div>
              <p className="scope-share-expiry">{expiryText(link.expiresAt)}</p>
            </>
          ) : (
            <label className="scope-share-field">
              <span>อายุลิงก์</span>
              <select value={expiresIn} onChange={(event) => setExpiresIn(event.target.value)} disabled={busy}>
                <option value="1d">1 วัน</option>
                <option value="7d">7 วัน</option>
                <option value="30d">30 วัน</option>
                <option value="never">ไม่มีวันหมดอายุ</option>
              </select>
            </label>
          )}
        </div>

        <footer>
          {link ? (
            <>
              <button type="button" className={confirmRevoke ? "danger" : "secondary"} onClick={() => void revoke()} disabled={busy}>
                {confirmRevoke ? "ยืนยันยกเลิกลิงก์" : "ยกเลิกลิงก์"}
              </button>
              <a className="scope-share-open" href={link.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} aria-hidden="true" /> เปิดลิงก์
              </a>
            </>
          ) : (
            <>
              <button type="button" className="secondary" onClick={onClose} disabled={busy}>ปิด</button>
              <button type="button" className="primary" onClick={() => void create()} disabled={busy}>
                <Share2 size={15} aria-hidden="true" /> {busy ? "กำลังสร้าง..." : "สร้างลิงก์"}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
