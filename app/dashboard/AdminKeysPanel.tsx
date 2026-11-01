"use client";

import { Copy, Download, KeySquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../runtime";

type AdminKey = {
  id: number; label: string; hint: string; createdVia: string;
  expiresAt: string | null; lastUsedAt: string | null; lastUsedIp: string; revokedAt: string | null; createdAt: string;
};
type Notify = (notice: { kind: "success" | "error"; text: string }) => void;
type Ask = (request: { title: string; message: string; confirmLabel?: string; danger?: boolean; action: () => void | Promise<void> }) => void;

const when = (value: string) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function statusOf(item: AdminKey) {
  if (item.revokedAt) return { tone: "off", text: "ยกเลิกแล้ว" };
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()) return { tone: "off", text: "หมดอายุ" };
  return { tone: "on", text: item.expiresAt ? `ใช้ได้ถึง ${when(item.expiresAt)}` : "ใช้ได้ ไม่มีวันหมดอายุ" };
}

/** Emergency sign-in keys: made here or with /adminkey in Discord, used with Ctrl+Z twice on any page. */
export default function AdminKeysPanel({ notify, ask }: { notify: Notify; ask: Ask }) {
  const [items, setItems] = useState<AdminKey[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("90");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/emergency-keys`, { credentials: "include" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { items: AdminKey[] };
      setItems(payload.items);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function create() {
    if (busy || !label.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/emergency-keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, expiresInDays: Number(days) }),
      });
      const payload = await response.json().catch(() => ({})) as { key?: string; error?: string };
      if (!response.ok || !payload.key) {
        notify({ kind: "error", text: payload.error || "ตอนนี้สร้างคีย์ไม่ได้ ลองใหม่อีกครั้ง" });
        return;
      }
      setCreated(payload.key);
      setLabel("");
      void load();
    } catch {
      notify({ kind: "error", text: "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง" });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(created);
      notify({ kind: "success", text: "คัดลอกคีย์แล้ว" });
    } catch {
      notify({ kind: "error", text: "คัดลอกไม่ได้ ใช้ปุ่มดาวน์โหลดแทน" });
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`${created}\n`], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "nexora-admin.key";
    link.click();
    URL.revokeObjectURL(url);
  }

  function revoke(item: AdminKey) {
    ask({
      title: `ยกเลิกคีย์ ${item.label}?`,
      message: "ยกเลิกแล้วใช้คีย์นี้เข้าระบบไม่ได้อีก และเปิดกลับไม่ได้",
      confirmLabel: "ยกเลิกคีย์",
      danger: true,
      action: async () => {
        const response = await fetch(`${API_BASE}/api/admin/emergency-keys/${item.id}`, { method: "DELETE", credentials: "include" });
        if (!response.ok) {
          notify({ kind: "error", text: "ยกเลิกคีย์ไม่ได้ ลองใหม่อีกครั้ง" });
          return;
        }
        notify({ kind: "success", text: "ยกเลิกคีย์แล้ว" });
        await load();
      },
    });
  }

  return (
    <div className="premium-settings-card">
      <div className="settings-card-header">
        <div className="sch-icon login"><KeySquare size={20} /></div>
        <div>
          <h3>คีย์เข้าระบบสำรอง</h3>
          <p>ใช้ตอนเข้าทางปกติไม่ได้ กด Ctrl+Z สองครั้งในหน้าเว็บแล้วใส่คีย์ คีย์นี้เข้าบัญชีคุณได้ทันที เก็บให้เหมือนรหัสผ่าน</p>
        </div>
      </div>

      {created ? (
        <div className="akp-created" role="status">
          <strong>คีย์นี้แสดงครั้งเดียว เก็บไว้ตอนนี้เลย</strong>
          <code>{created}</code>
          <div className="akp-actions">
            <button type="button" className="akp-btn" onClick={download}><Download size={15} aria-hidden="true" />ดาวน์โหลดไฟล์คีย์</button>
            <button type="button" className="akp-btn" onClick={() => void copy()}><Copy size={15} aria-hidden="true" />คัดลอก</button>
            <button type="button" className="akp-btn" onClick={() => setCreated("")}>เก็บแล้ว</button>
          </div>
        </div>
      ) : (
        // This panel sits inside the settings page's form, and forms cannot nest: a <form> here would reload the page.
        <div className="akp-form">
          <label>
            <span>ชื่อคีย์</span>
            <input className="premium-input" value={label} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }} maxLength={60} placeholder="โน้ตบุ๊กที่บ้าน" />
          </label>
          <label>
            <span>อายุ</span>
            <select className="premium-input" value={days} onChange={(event) => setDays(event.target.value)}>
              <option value="30">30 วัน</option>
              <option value="90">90 วัน</option>
              <option value="365">1 ปี</option>
              <option value="0">ไม่หมดอายุ</option>
            </select>
          </label>
          <button type="button" className="akp-btn akp-primary" onClick={() => void create()} disabled={busy || !label.trim()}>{busy ? "กำลังสร้าง" : "สร้างคีย์"}</button>
        </div>
      )}

      {failed ? <p className="akp-note">โหลดรายการไม่ได้ <button type="button" className="akp-link" onClick={() => void load()}>ลองอีกครั้ง</button></p>
        : !items ? <p className="akp-note">กำลังโหลด</p>
        : items.length === 0 ? <p className="akp-note">ยังไม่มีคีย์ สร้างเก็บไว้สักอันเผื่อเข้าทางปกติไม่ได้</p>
        : <ul className="akp-list">
          {items.map((item) => {
            const status = statusOf(item);
            return (
              <li key={item.id} className={status.tone === "off" ? "is-off" : ""}>
                <div className="akp-main">
                  <strong>{item.label} <small>…{item.hint}</small></strong>
                  <small>{status.text} · สร้างจาก{item.createdVia === "discord" ? " Discord" : "เว็บ"} {when(item.createdAt)}</small>
                  <small>{item.lastUsedAt ? `ใช้ล่าสุด ${when(item.lastUsedAt)} จาก ${item.lastUsedIp}` : "ยังไม่เคยใช้"}</small>
                </div>
                {status.tone === "on" && <button type="button" className="akp-btn akp-danger" onClick={() => revoke(item)}>ยกเลิก</button>}
              </li>
            );
          })}
        </ul>}
    </div>
  );
}
