"use client";

// Watches the sign-in session on signed-in pages. It warns in the middle of the screen shortly
// before the idle time runs out (with a button to stay), and says so when it has run out, instead
// of requests starting to fail one by one.
//
// It also tells the API which requests come from a person: a request sent while nobody has
// touched the page for a minute carries X-Nexora-Idle, so pages that refresh themselves do not
// keep an unattended session alive (backend platform.go authenticate).
import { Clock3, LockKeyhole, LogIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../runtime";
import "./session-guard.css";

const EXPIRED_EVENT = "nexora:session-expired";
const RETURN_KEY = "nexora_return_to";
const ACTIVE_WINDOW = 60_000;

let lastActivity = Date.now();
let fetchPatched = false;

function isApiRequest(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    const api = new URL(API_BASE || window.location.origin, window.location.href);
    return parsed.origin === api.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

// 401 from these is part of signing in, not a session that ran out.
const AUTH_PATHS = ["/api/auth/login", "/api/auth/register", "/api/auth/oauth", "/api/auth/logout"];

function patchFetch() {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isApiRequest(url)) return original(input, init);
    let nextInit = init;
    if (Date.now() - lastActivity > ACTIVE_WINDOW) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("X-Nexora-Idle", "1");
      nextInit = { ...init, headers };
    }
    const response = await original(input, nextInit);
    if (response.status === 401) {
      const path = new URL(url, window.location.href).pathname;
      if (!AUTH_PATHS.some((prefix) => path.startsWith(prefix))) window.dispatchEvent(new Event(EXPIRED_EVENT));
    }
    return response;
  };
}

type Status = { expiresAt: number; ttlMinutes: number };

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function idleText(minutes: number) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} วัน`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ชั่วโมง`;
  return `${minutes} นาที`;
}

export default function SessionGuard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [expired, setExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  // Last time activity was reported; 0 until the first status, which counts as one.
  const lastExtend = useRef(0);

  const apply = useCallback((data: { expiresAt: string; now: string; ttlMinutes: number }) => {
    // Kept in this device's clock, whatever the server's clock says.
    const skew = new Date(data.now).getTime() - Date.now();
    if (!lastExtend.current) lastExtend.current = Date.now();
    setStatus({ expiresAt: new Date(data.expiresAt).getTime() - skew, ttlMinutes: data.ttlMinutes });
  }, []);

  const check = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/session`, { credentials: "include", cache: "no-store" });
      if (response.status === 401) { setExpired(true); return; }
      if (response.ok) apply(await response.json());
    } catch {
      // Offline for a moment: keep the last known end time.
    }
  }, [apply]);

  const extend = useCallback(async () => {
    lastExtend.current = Date.now();
    try {
      const response = await fetch(`${API_BASE}/api/auth/session/extend`, { method: "POST", credentials: "include", cache: "no-store" });
      if (response.status === 401) { setExpired(true); return false; }
      if (response.ok) { apply(await response.json()); return true; }
    } catch {
      // Try again on the next activity.
    }
    return false;
  }, [apply]);

  useEffect(() => {
    patchFetch();
    const onExpired = () => setExpired(true);
    window.addEventListener(EXPIRED_EVENT, onExpired);
    const first = window.setTimeout(() => void check(), 0);
    const poll = window.setInterval(() => void check(), 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(EXPIRED_EVENT, onExpired);
      window.clearTimeout(first);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // Someone using the page counts as activity even when it sends no request (reading, typing a
  // long message): report it now and then so the session keeps going.
  useEffect(() => {
    const onActivity = () => {
      lastActivity = Date.now();
      if (!status || expired) return;
      const every = Math.min(5 * 60_000, status.ttlMinutes * 6_000);
      if (Date.now() - lastExtend.current > every) void extend();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, onActivity));
  }, [expired, extend, status]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = status ? status.expiresAt - now : Infinity;
  const warnAt = status ? Math.min(2 * 60_000, status.ttlMinutes * 12_000) : 0;
  const warning = !expired && status !== null && remaining <= warnAt;

  // Another tab may have kept the session going, so ask the server when the warning starts and
  // again at zero; only its answer (401) shows the expired notice.
  const phase = !status || expired ? "" : remaining <= 0 ? "zero" : warning ? "warn" : "";
  useEffect(() => {
    if (!phase) return;
    const timer = window.setTimeout(() => void check(), phase === "zero" ? 500 : 0);
    return () => window.clearTimeout(timer);
  }, [check, phase]);

  async function stay() {
    setBusy(true);
    await extend();
    setBusy(false);
  }

  function signInAgain() {
    try {
      window.sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path: window.location.pathname + window.location.search, at: Date.now() }));
    } catch {
      // Without storage the person lands on the dashboard after signing in.
    }
    window.location.href = "/?next=relogin";
  }

  async function signOut() {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    window.location.href = "/";
  }

  if (!expired && !warning) return null;

  return createPortal(
    <div className="sg-backdrop" role="presentation">
      <section className={`sg-dialog${expired ? " is-expired" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby="sg-title" aria-describedby="sg-text">
        <span className="sg-icon" aria-hidden="true">{expired ? <LockKeyhole size={26} /> : <Clock3 size={26} />}</span>
        {expired ? (
          <>
            <h2 id="sg-title">หมดเวลาใช้งานแล้ว</h2>
            <p id="sg-text">
              {status ? `ไม่ได้ใช้งานนานเกิน ${idleText(status.ttlMinutes)} ` : ""}ระบบจึงออกจากระบบให้เพื่อความปลอดภัย เข้าสู่ระบบอีกครั้งแล้วจะกลับมาที่หน้านี้
            </p>
            <div className="sg-actions">
              <button type="button" className="sg-btn sg-btn-primary" onClick={signInAgain} autoFocus><LogIn size={17} aria-hidden="true" />เข้าสู่ระบบอีกครั้ง</button>
            </div>
          </>
        ) : (
          <>
            <h2 id="sg-title">ยังใช้งานอยู่ไหม</h2>
            <p id="sg-text">ไม่ได้ใช้งานมาสักพัก ระบบจะออกจากระบบให้ใน</p>
            <strong className="sg-count" aria-live="polite">{clock(remaining)}</strong>
            <div className="sg-actions">
              <button type="button" className="sg-btn" onClick={() => void signOut()} disabled={busy}>ออกจากระบบ</button>
              <button type="button" className="sg-btn sg-btn-primary" onClick={() => void stay()} disabled={busy} autoFocus>
                {busy && <span className="sg-spinner" aria-hidden="true" />}ใช้งานต่อ
              </button>
            </div>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** After signing in again, the page the session ran out on (if recent), else null. */
export function takeReturnPath(): string | null {
  try {
    const raw = window.sessionStorage.getItem(RETURN_KEY);
    window.sessionStorage.removeItem(RETURN_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { path?: string; at?: number };
    if (!saved.path || !saved.at || Date.now() - saved.at > 60 * 60_000) return null;
    if (!saved.path.startsWith("/") || saved.path.startsWith("//") || saved.path.startsWith("/\\")) return null;
    return saved.path;
  } catch {
    return null;
  }
}
