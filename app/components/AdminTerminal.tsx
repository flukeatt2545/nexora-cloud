"use client";

import { type ChangeEvent, type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { API_BASE } from "../runtime";
import "./admin-terminal.css";

type Status = { kind: "plain" | "ok" | "bad"; text: string };

const KEY_PATTERN = /nxk_[A-Za-z0-9_-]{43}/;
const MAX_KEY_FILE_BYTES = 4096;
const READY: Status = { kind: "plain", text: "วางคีย์ หรือเลือกไฟล์คีย์" };

export default function AdminTerminal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>(READY);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // On a phone the keyboard would cover the buttons, so it waits until the field is tapped.
    if (!window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus();
    // Caught first and stopped, so Esc closes this and not the dialog underneath as well.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [onClose]);

  async function signIn(key: string) {
    setBusy(true);
    setStatus({ kind: "plain", text: "กำลังตรวจ" });
    try {
      const response = await fetch(`${API_BASE}/api/auth/emergency`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (response.ok) {
        setStatus({ kind: "ok", text: "เข้าได้แล้ว กำลังไปหน้าแอดมิน" });
        window.location.assign("/admin");
        return;
      }
      setStatus({ kind: "bad", text: response.status === 429 ? "ลองผิดหลายครั้ง รอ 15 นาทีแล้วลองใหม่" : "คีย์ไม่ถูกต้อง" });
    } catch {
      setStatus({ kind: "bad", text: "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง" });
    }
    setBusy(false);
    setValue("");
    inputRef.current?.focus();
  }

  async function readKeyFile(file: File | undefined) {
    if (!file) return;
    const match = file.size <= MAX_KEY_FILE_BYTES ? (await file.text()).match(KEY_PATTERN) : null;
    if (!match) {
      setStatus({ kind: "bad", text: "ไฟล์นี้ไม่มีคีย์" });
      return;
    }
    await signIn(match[0]);
  }

  async function pasteKey() {
    try {
      const match = (await navigator.clipboard.readText()).match(KEY_PATTERN);
      if (!match) {
        setStatus({ kind: "bad", text: "สิ่งที่คัดลอกไว้ไม่ใช่คีย์" });
        return;
      }
      await signIn(match[0]);
    } catch {
      setStatus({ kind: "bad", text: "วางให้ไม่ได้ แตะค้างที่ช่องคีย์แล้วเลือกวาง" });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const key = value.trim();
    if (key && !busy) void signIn(key);
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    void readKeyFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy) void readKeyFile(event.dataTransfer.files[0]);
  }

  return (
    <div className="admin-term-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className={`admin-term${dragging ? " is-dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="เข้าระบบด้วยคีย์"
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <header className="admin-term-bar">
          <span>nexora@admin</span>
          <button type="button" onClick={onClose}>ปิด</button>
        </header>
        <form onSubmit={submit}>
          <div className="admin-term-prompt">
            <label htmlFor="admin-term-key">key &gt;</label>
            <input
              ref={inputRef}
              id="admin-term-key"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              readOnly={busy}
            />
          </div>
          <p className={`admin-term-status is-${status.kind}`} role="status">{status.text}</p>
          <div className="admin-term-foot">
            <span className="admin-term-hint">ลากไฟล์มาวางได้</span>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>เลือกไฟล์</button>
            <button type="button" onClick={() => void pasteKey()} disabled={busy}>วาง</button>
            <button type="submit" className="admin-term-go" disabled={busy || !value.trim()}>เข้าระบบ</button>
            {/* No accept filter: phones grey out .key files. The contents are checked instead. */}
            <input ref={fileRef} type="file" hidden onChange={onFile} />
          </div>
        </form>
      </section>
    </div>
  );
}
