"use client";

import { type ChangeEvent, type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { API_BASE } from "../runtime";
import "./admin-terminal.css";

type Line = { kind: "plain" | "ok" | "bad"; text: string };

const KEY_PATTERN = /nxk_[A-Za-z0-9_-]{43}/;
const MAX_KEY_FILE_BYTES = 4096;

export default function AdminTerminal({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<Line[]>([{ kind: "plain", text: "ใส่คีย์ หรือเลือกไฟล์คีย์ แล้วกด Enter" }]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // On a phone the keyboard would cover the buttons, so it waits until the field is tapped.
    if (!window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const say = (kind: Line["kind"], text: string) => setLines((current) => [...current.slice(-6), { kind, text }]);

  async function signIn(key: string) {
    setBusy(true);
    say("plain", "กำลังตรวจคีย์");
    try {
      const response = await fetch(`${API_BASE}/api/auth/emergency`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (response.ok) {
        say("ok", "คีย์ถูกต้อง กำลังเข้าหน้าแอดมิน");
        window.location.assign("/admin");
        return;
      }
      say("bad", response.status === 429 ? "ลองหลายครั้งเกินไป รอ 15 นาทีแล้วลองใหม่" : "คีย์ใช้ไม่ได้");
    } catch {
      say("bad", "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง");
    }
    setBusy(false);
    setValue("");
    inputRef.current?.focus();
  }

  async function readKeyFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_KEY_FILE_BYTES) {
      say("bad", "ไฟล์นี้ไม่ใช่ไฟล์คีย์");
      return;
    }
    const match = (await file.text()).match(KEY_PATTERN);
    if (!match) {
      say("bad", "ไฟล์นี้ไม่ใช่ไฟล์คีย์");
      return;
    }
    say("plain", `อ่านไฟล์ ${file.name}`);
    await signIn(match[0]);
  }

  async function pasteKey() {
    try {
      const match = (await navigator.clipboard.readText()).match(KEY_PATTERN);
      if (!match) {
        say("bad", "สิ่งที่คัดลอกไว้ไม่ใช่คีย์");
        return;
      }
      await signIn(match[0]);
    } catch {
      say("bad", "วางอัตโนมัติไม่ได้ แตะค้างที่ช่องคีย์แล้วเลือกวาง");
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
        <div className="admin-term-body" aria-live="polite">
          {lines.map((line, index) => <p key={index} className={`is-${line.kind}`}>{line.text}</p>)}
        </div>
        <form className="admin-term-prompt" onSubmit={submit}>
          <label htmlFor="admin-term-key">key &gt;</label>
          <input
            ref={inputRef}
            id="admin-term-key"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </form>
        <footer className="admin-term-foot">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>เลือกไฟล์คีย์</button>
          <button type="button" onClick={() => void pasteKey()} disabled={busy}>วางคีย์</button>
          <span className="admin-term-hint">หรือลากไฟล์มาวางตรงนี้</span>
          {/* No accept filter: phones grey out .key files. The contents are checked instead. */}
          <input ref={fileRef} type="file" hidden onChange={onFile} />
        </footer>
      </section>
    </div>
  );
}
