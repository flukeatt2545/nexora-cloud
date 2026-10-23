"use client";

// Watches the sign-in session on signed-in pages. It warns in the middle of the screen shortly
// before the idle time runs out (with a button to stay), and says so when it has run out, instead
// of requests starting to fail one by one.
//
// It also tells the API which requests come from a person: a request sent while nobody has
// touched the page for a minute carries X-Nexora-Idle, so pages that refresh themselves do not
// keep an unattended session alive (backend platform.go authenticate).
import { Clock3, LockKeyhole, LogIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../runtime";
import "./session-guard.css";

/** Dispatched on window when a page learns the session is gone; the guard then shows its notice. */
export const EXPIRED_EVENT = "nexora:session-expired";
const RETURN_KEY = "nexora_return_to";
/** A request sent this long after the last touch counts as the page's own, not a person's. Shortened
 *  once the idle time is known: with a 30 second idle time, a minute-long window would let the page's
 *  own refreshes keep the session alive for a whole minute after the person left. */
let activeWindow = 60_000;

let lastActivity = Date.now();
let fetchPatched = false;
/** Set while the "ran out" notice is up: the page's own requests are answered 401 here, without
 *  going to the network, so they stop filling the console and the toasts with the same failure. */
let sessionEnded = false;
let lastTtlSeconds = 0;
const endedListeners = new Set<() => void>();

function markEnded() {
  if (sessionEnded) return;
  sessionEnded = true;
  endedListeners.forEach((listener) => listener());
}

/** True once the guard has confirmed with the server that the session is over. The pages use it to
 *  drop everything they were showing, so removing the notice in the inspector reveals nothing. A new
 *  sign-in is a full page load, so this never needs to go back to false. */
export function useSessionEnded() {
  return useSyncExternalStore(
    (listener) => { endedListeners.add(listener); return () => { endedListeners.delete(listener); }; },
    () => sessionEnded,
    () => false,
  );
}

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
// The guard's own questions are answered in the guard; they do not raise the event again.
const QUIET_PATHS = [...AUTH_PATHS, "/api/auth/session"];

function patchFetch() {
  if (fetchPatched || typeof window === "undefined") return;
  fetchPatched = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isApiRequest(url)) return original(input, init);
    if (sessionEnded && !AUTH_PATHS.some((prefix) => new URL(url, window.location.href).pathname.startsWith(prefix))) {
      return new Response(JSON.stringify({ error: "เซสชันหมดอายุแล้ว", code: "unauthenticated" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let nextInit = init;
    if (Date.now() - lastActivity > activeWindow) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("X-Nexora-Idle", "1");
      nextInit = { ...init, headers };
    }
    const response = await original(input, nextInit);
    if (response.status === 401) {
      const path = new URL(url, window.location.href).pathname;
      if (!QUIET_PATHS.some((prefix) => path.startsWith(prefix))) window.dispatchEvent(new Event(EXPIRED_EVENT));
    }
    return response;
  };
}

type Status = { expiresAt: number; ttlSeconds: number };

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function idleText(seconds: number) {
  if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400} วัน`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} ชั่วโมง`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} นาที`;
  return seconds < 60 ? `${seconds} วินาที` : `${Math.floor(seconds / 60)} นาที ${seconds % 60} วินาที`;
}

export default function SessionGuard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [expired, setExpired] = useState(() => sessionEnded);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  // Last time activity was reported; 0 until the first status, which counts as one.
  const lastExtend = useRef(0);

  const apply = useCallback((data: { expiresAt: string; now: string; ttlSeconds?: number; ttlMinutes: number }) => {
    // Kept in this device's clock, whatever the server's clock says.
    const skew = new Date(data.now).getTime() - Date.now();
    if (!lastExtend.current) lastExtend.current = Date.now();
    // An API from before seconds only reports whole minutes.
    const ttlSeconds = data.ttlSeconds ?? data.ttlMinutes * 60;
    lastTtlSeconds = ttlSeconds;
    activeWindow = Math.max(5_000, Math.min(60_000, ttlSeconds * 500));
    setStatus({ expiresAt: new Date(data.expiresAt).getTime() - skew, ttlSeconds });
  }, []);

  const end = useCallback(() => { setExpired(true); markEnded(); }, []);

  const check = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/session`, { credentials: "include", cache: "no-store" });
      if (response.status === 401) { end(); return; }
      if (response.ok) apply(await response.json());
    } catch {
      // Offline for a moment: keep the last known end time.
    }
  }, [apply, end]);

  const extend = useCallback(async () => {
    lastExtend.current = Date.now();
    try {
      const response = await fetch(`${API_BASE}/api/auth/session/extend`, { method: "POST", credentials: "include", cache: "no-store" });
      if (response.status === 401) { end(); return false; }
      if (response.ok) { apply(await response.json()); return true; }
    } catch {
      // Try again on the next activity.
    }
    return false;
  }, [apply, end]);

  useEffect(() => {
    patchFetch();
    // A 401 somewhere only means "ask the server": a wrong current password also answers 401, and
    // that must not take the page away.
    const onExpired = () => void check();
    window.addEventListener(EXPIRED_EVENT, onExpired);
    const first = window.setTimeout(() => void check(), 0);
    const poll = window.setInterval(() => void check(), 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    // A tab that was asleep or offline asks again as soon as it is back, not on the next minute tick.
    const onBack = () => void check();
    window.addEventListener("focus", onBack);
    window.addEventListener("pageshow", onBack);
    window.addEventListener("online", onBack);
    return () => {
      window.removeEventListener(EXPIRED_EVENT, onExpired);
      window.clearTimeout(first);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onBack);
      window.removeEventListener("pageshow", onBack);
      window.removeEventListener("online", onBack);
    };
  }, [check]);

  // Someone using the page counts as activity even when it sends no request (reading, typing a
  // long message): report it now and then so the session keeps going.
  useEffect(() => {
    const onActivity = () => {
      lastActivity = Date.now();
      if (!status || expired) return;
      const every = Math.min(5 * 60_000, status.ttlSeconds * 100);
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
  const warnAt = status ? Math.min(2 * 60_000, status.ttlSeconds * 200) : 0;
  const warning = !expired && status !== null && remaining <= warnAt;

  // Another tab may have kept the session going, so ask the server when the warning starts and
  // again at zero; only its answer (401) shows the expired notice.
  const phase = !status || expired ? "" : remaining <= 0 ? "zero" : warning ? "warn" : "";
  useEffect(() => {
    if (!phase) return;
    const timer = window.setTimeout(() => void check(), phase === "zero" ? 500 : 0);
    return () => window.clearTimeout(timer);
  }, [check, phase]);

  // While the notice is up the page behind it is frozen: no scrolling (wheel, touch, keys) and no
  // tabbing into it.
  const open = expired || warning;
  // The notice lives in a host element of its own so it can be put back if someone takes it out.
  const host = useMemo(() => {
    if (typeof document === "undefined") return null;
    const element = document.createElement("div");
    element.className = "sg-host";
    return element;
  }, []);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open || !host) return;
    document.body.appendChild(host);
    return () => host.remove();
  }, [open, host]);
  // Once the session is over the notice stays: removed from the page, hidden with a style or a
  // hidden attribute, it comes back at once. (The page behind it is already gone; see useSessionEnded.)
  useEffect(() => {
    if (!expired || !host) return;
    const force = (element: HTMLElement | null, rules: Record<string, string>) => {
      if (!element) return;
      for (const [name, value] of Object.entries(rules)) {
        if (element.style.getPropertyValue(name) !== value || element.style.getPropertyPriority(name) !== "important") element.style.setProperty(name, value, "important");
      }
      if (element.hidden) element.hidden = false;
    };
    let queued = false;
    const enforce = () => {
      queued = false;
      if (!host.isConnected) document.body.appendChild(host);
      const backdrop = backdropRef.current;
      const dialog = dialogRef.current;
      if (backdrop && backdrop.parentNode !== host) host.appendChild(backdrop);
      if (backdrop && dialog && dialog.parentNode !== backdrop) backdrop.appendChild(dialog);
      force(host, { display: "block", visibility: "visible", opacity: "1" });
      force(backdrop, { display: "grid", visibility: "visible", opacity: "1", "pointer-events": "auto" });
      force(dialog, { display: "grid", visibility: "visible", opacity: "1" });
    };
    const schedule = () => { if (!queued) { queued = true; queueMicrotask(enforce); } };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true });
    observer.observe(host, { childList: true, subtree: true, attributes: true });
    const timer = window.setInterval(enforce, 1000);
    enforce();
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, [expired, host]);
  useEffect(() => {
    document.documentElement.classList.toggle("sg-expired", expired);
    return () => document.documentElement.classList.remove("sg-expired");
  }, [expired]);
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("sg-locked");
    const frozen: Element[] = [];
    Array.from(document.body.children).forEach((element) => {
      if (element.classList.contains("sg-host") || element.hasAttribute("inert") || ["SCRIPT", "STYLE", "LINK"].includes(element.tagName)) return;
      element.setAttribute("inert", "");
      frozen.push(element);
    });
    return () => {
      root.classList.remove("sg-locked");
      frozen.forEach((element) => element.removeAttribute("inert"));
    };
  }, [open]);

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

  if ((!expired && !warning) || !host) return null;

  return createPortal(
    <div className={`sg-backdrop${expired ? " is-ended" : ""}`} role="presentation" ref={backdropRef}>
      {expired && (
        // The page itself is gone, so the notice sits on an empty outline of one: nothing real, just
        // blocks where the menu, the heading and the cards were.
        <div className="sg-ghost" aria-hidden="true">
          <span className="sg-ghost-side" />
          <span className="sg-ghost-top" />
          <span className="sg-ghost-hero" />
          <span className="sg-ghost-card" /><span className="sg-ghost-card" /><span className="sg-ghost-card" />
          <span className="sg-ghost-panel" /><span className="sg-ghost-panel" />
        </div>
      )}
      <section ref={dialogRef} className={`sg-dialog${expired ? " is-expired" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby="sg-title" aria-describedby="sg-text">
        <span className="sg-icon" aria-hidden="true">{expired ? <LockKeyhole size={26} /> : <Clock3 size={26} />}</span>
        {expired ? (
          <>
            <h2 id="sg-title">หมดเวลาใช้งานแล้ว</h2>
            <p id="sg-text">
              {status || lastTtlSeconds ? `ไม่ได้ใช้งานนานเกิน ${idleText(status?.ttlSeconds ?? lastTtlSeconds)} ` : ""}ระบบจึงออกจากระบบให้เพื่อความปลอดภัย เข้าสู่ระบบอีกครั้งแล้วจะกลับมาที่หน้านี้
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
    host,
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
