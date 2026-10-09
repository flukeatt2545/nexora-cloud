"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode, TouchEvent } from "react";
import { API_BASE } from "../runtime";
import "./gallery.css";
import SmartImage from "../components/SmartImage";
import Link from "next/link";

interface GalleryItem {
  id: number;
  url: string;
  filename: string;
  size: number;
  content_type: string;
  created_at: string;
}

type Status =
  | { kind: "loading" }
  | { kind: "need-ticket" }
  | { kind: "ticket-error"; message: string }
  | { kind: "server-error" }
  | { kind: "ready" };

type SortMode = "new" | "old" | "large";
type Density = "s" | "m" | "l";

const DENSITY_KEY = "gallery-density";
const TOOLS_MIN_ITEMS = 6;
const SORT_LABELS: Record<SortMode, string> = {
  new: "ใหม่สุดก่อน",
  old: "เก่าสุดก่อน",
  large: "ไฟล์ใหญ่สุดก่อน",
};
const DENSITY_LABELS: Record<Density, string> = { s: "เล็ก", m: "กลาง", l: "ใหญ่" };

/* ---------- inline icons ---------- */

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };
const IconTrash = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </Icon>
);
const IconX = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
const IconChevronLeft = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);
const IconChevronRight = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);
const IconExternal = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
  </Icon>
);
const IconArrowLeft = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </Icon>
);
const IconCopy = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Icon>
);
const IconDownload = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 21h16" />
  </Icon>
);
const IconSearch = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
const IconAlert = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </Icon>
);

const IconCheck = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

function DensityGlyph({ density }: { density: Density }) {
  // 3 / 2 / 1 columns to hint at tile size
  const cols = density === "s" ? 3 : density === "m" ? 2 : 1;
  const size = 18;
  const gap = 2;
  const cell = (size - gap * (cols - 1)) / cols;
  const cells = [];
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(<rect key={`${r}-${c}`} x={c * (cell + gap)} y={r * (cell + gap)} width={cell} height={cell} rx={1} />);
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="currentColor" aria-hidden="true">
      {cells}
    </svg>
  );
}

/* ---------- helpers ---------- */

const TZ = "Asia/Bangkok";

function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("th-TH", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function dayLabel(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === "unknown") return "ไม่ทราบวันที่";
  if (key === todayKey) return "วันนี้";
  if (key === yesterdayKey) return "เมื่อวาน";
  const d = new Date(`${key}T12:00:00+07:00`);
  return d.toLocaleDateString("th-TH", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

class ServerError extends Error {}

/** What the gallery API answers with; each call uses only its own fields. */
type ApiData = { items?: GalleryItem[]; discord_username?: string; error?: string; Error?: string } | null;

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  let data: ApiData = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { res, data };
}

/* ---------- toast + modal ---------- */

type ToastKind = "success" | "error";
interface ToastData {
  id: number;
  kind: ToastKind;
  text: string;
}

const TOAST_MS: Record<ToastKind, number> = { success: 3000, error: 6000 };
const MAX_TOASTS = 3;

function ToastItem({ toast, onClose }: { toast: ToastData; onClose: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onClose(toast.id), TOAST_MS[toast.kind]);
    return () => window.clearTimeout(timer);
  }, [paused, toast.id, toast.kind, onClose]);

  return (
    <div
      className={`gal-toast ${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="gal-toast-icon" aria-hidden="true">
        {toast.kind === "error" ? <IconAlert size={16} /> : <IconCheck size={16} />}
      </span>
      <span className="gal-toast-text">{toast.text}</span>
      <button type="button" className="gal-toast-close" onClick={() => onClose(toast.id)} aria-label="ปิดการแจ้งเตือน">
        <IconX size={14} />
      </button>
    </div>
  );
}

function ConfirmDeleteModal({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: GalleryItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onEscape = useEffectEvent(() => {
    if (!busy) onCancel();
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    // Capture phase so the viewer underneath never sees these keys while the dialog is open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onEscape();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.stopImmediatePropagation();
      } else if (e.key === "Tab" && panelRef.current) {
        const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div
      className="gal-modal-backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="gal-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gal-del-title"
        aria-describedby="gal-del-desc"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gal-modal-body">
          <div className="gal-modal-thumb">
            <SmartImage src={item.url} alt="" compact />
          </div>
          <div className="gal-modal-text">
            <h2 id="gal-del-title" className="gal-modal-title">
              ลบรูปนี้ถาวรหรือไม่?
            </h2>
            <p className="gal-modal-file" title={item.filename}>
              {item.filename} · {fmtSize(item.size)}
            </p>
          </div>
        </div>
        <p id="gal-del-desc" className="gal-modal-desc">
          รูปจะถูกลบออกจากแกลเลอรีและที่เก็บไฟล์ ลิงก์ที่คัดลอกไปแล้วจะเปิดไม่ได้อีก และย้อนกลับไม่ได้
        </p>
        <div className="gal-modal-actions">
          <button type="button" className="gal-btn ghost" onClick={onCancel} disabled={busy} data-autofocus>
            ยกเลิก
          </button>
          <button type="button" className="gal-btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? "กำลังลบ..." : "ลบรูป"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function storedDensity(): Density {
  try {
    const saved = window.localStorage.getItem(DENSITY_KEY);
    return saved === "s" || saved === "m" || saved === "l" ? saved : "m";
  } catch {
    return "m"; // storage can be unavailable
  }
}

export default function GalleryPage() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [username, setUsername] = useState("");
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("new");
  const savedDensity = useSyncExternalStore(subscribeStorage, storedDensity, () => "m" as const);
  const [pickedDensity, setDensity] = useState<Density | null>(null);
  const density = pickedDensity ?? savedDensity;
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const lightboxRef = useRef<HTMLDivElement>(null);
  // The thumbnail that opened the viewer; focus goes back to it when the viewer closes.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const toastSeq = useRef(0);
  const showToast = useCallback((text: string, kind: ToastKind = "success") => {
    const id = ++toastSeq.current;
    setToasts((current) => [...current.filter((t) => t.text !== text), { id, kind, text }].slice(-MAX_TOASTS));
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const changeDensity = (next: Density) => {
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const loadUploads = useCallback(async () => {
    const { res, data } = await api("/api/gallery/uploads");
    if (res.status === 401) return false;
    if (!res.ok) throw new ServerError();
    const list = data?.items;
    setItems(Array.isArray(list) ? list : []);
    return true;
  }, []);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const ticket = (params.get("ticket") || "").trim();
        if (ticket) {
          const { res, data } = await api("/api/gallery/session", {
            method: "POST",
            body: JSON.stringify({ ticket }),
          });
          // Remove the ticket from the URL so it can't be reused or leaked via history.
          // Keep it after a server failure so "try again" can still redeem it.
          if (res.status < 500) window.history.replaceState(null, "", window.location.pathname);
          if (cancelled) return;
          if (res.status === 410) {
            setStatus({ kind: "ticket-error", message: "ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว" });
            return;
          }
          if (res.status >= 500) throw new ServerError();
          if (!res.ok) {
            setStatus({ kind: "ticket-error", message: "ลิงก์ไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากบอท" });
            return;
          }
          setUsername(String(data?.discord_username || ""));
        }
        const ok = await loadUploads();
        if (cancelled) return;
        setStatus(ok ? { kind: "ready" } : { kind: "need-ticket" });
      } catch {
        // Network failures and 4xx/5xx other than "not signed in" are server problems, not bad links.
        if (!cancelled) setStatus({ kind: "server-error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadUploads, attempt]);

  /* ----- derived list: filter -> sort -> group ----- */

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? items.filter((it) => it.filename.toLowerCase().includes(q)) : items;
    const time = (it: GalleryItem) => {
      const t = new Date(it.created_at).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    const sorted = [...filtered];
    if (sort === "new") sorted.sort((a, b) => time(b) - time(a) || b.id - a.id);
    else if (sort === "old") sorted.sort((a, b) => time(a) - time(b) || a.id - b.id);
    else sorted.sort((a, b) => b.size - a.size || b.id - a.id);
    return sorted;
  }, [items, query, sort]);

  const [openedAt] = useState(() => Date.now());
  const groups = useMemo(() => {
    if (sort === "large") return [{ key: "all", label: "", entries: visible }];
    const now = openedAt;
    const todayKey = dayKey(new Date(now).toISOString());
    const yesterdayKey = dayKey(new Date(now - 24 * 3600 * 1000).toISOString());
    const out: { key: string; label: string; entries: GalleryItem[] }[] = [];
    for (const it of visible) {
      const key = dayKey(it.created_at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.entries.push(it);
      else out.push({ key, label: dayLabel(key, todayKey, yesterdayKey), entries: [it] });
    }
    return out;
  }, [visible, sort, openedAt]);

  const totalBytes = useMemo(() => items.reduce((sum, it) => sum + (it.size || 0), 0), [items]);

  const activeIndex = activeId === null ? -1 : visible.findIndex((it) => it.id === activeId);
  const active = activeIndex >= 0 ? visible[activeIndex] : null;

  /* ----- lightbox actions ----- */

  const openItem = useCallback((id: number, from?: HTMLElement | null) => {
    setOpener(from ?? (document.activeElement as HTMLElement | null));
    setActiveId(id);
  }, []);

  const closeLightbox = useCallback(() => {
    setActiveId(null);
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (visible.length < 2 || activeIndex < 0) return;
      setActiveId(visible[(activeIndex + dir + visible.length) % visible.length].id);
    },
    [visible, activeIndex],
  );

  // If the active item disappears (filter change, delete), close the viewer.
  if (activeId !== null && activeIndex < 0) setActiveId(null);

  // Keyboard, scroll lock, focus management. Runs only when the viewer opens or closes.
  const isOpen = activeId !== null;
  const onStep = useEffectEvent((dir: 1 | -1) => step(dir));
  // The confirm dialog owns the keyboard while it is open.
  const confirmOpen = useEffectEvent(() => pendingDelete !== null);
  const restoreFocus = useEffectEvent(() => opener?.focus?.());
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const root = lightboxRef.current;
    root?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (confirmOpen()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      } else if (e.key === "ArrowRight") onStep(1);
      else if (e.key === "ArrowLeft") onStep(-1);
      else if (e.key === "Tab" && root) {
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      restoreFocus();
    };
  }, [isOpen, closeLightbox]);

  // Warm the cache for the neighbours of the open image.
  useEffect(() => {
    if (activeIndex < 0 || visible.length < 2) return;
    for (const offset of [1, -1]) {
      const neighbour = visible[(activeIndex + offset + visible.length) % visible.length];
      const img = new Image();
      img.src = neighbour.url;
    }
  }, [activeIndex, visible]);

  const handleDelete = async (item: GalleryItem) => {
    setDeleting(true);
    try {
      const { res, data } = await api(`/api/gallery/uploads/${item.id}`, { method: "DELETE" });
      if (res.status === 401) {
        setPendingDelete(null);
        closeLightbox();
        setStatus({ kind: "need-ticket" });
        showToast("เซสชันหมดอายุ กรุณาขอลิงก์ใหม่จากบอท", "error");
        return;
      }
      if (!res.ok) {
        showToast(String(data?.Error || data?.error || "ลบไม่สำเร็จ ลองใหม่อีกครั้ง"), "error");
        return;
      }
      // Move the viewer to a neighbour before removing, so it never flashes closed.
      if (activeId === item.id) {
        const idx = visible.findIndex((it) => it.id === item.id);
        const next = visible[idx + 1] ?? visible[idx - 1];
        setActiveId(next ? next.id : null);
      }
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setPendingDelete(null);
      showToast("ลบรูปแล้ว");
    } catch {
      showToast("ลบไม่สำเร็จ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้", "error");
    } finally {
      setDeleting(false);
    }
  };

  const copyLink = async (item: GalleryItem) => {
    const url = absoluteUrl(item.url);
    try {
      await navigator.clipboard.writeText(url);
      showToast("คัดลอกลิงก์แล้ว");
    } catch {
      const area = document.createElement("textarea");
      area.value = url;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(area);
      showToast(ok ? "คัดลอกลิงก์แล้ว" : "คัดลอกไม่สำเร็จ", ok ? "success" : "error");
    }
  };

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
  };

  const initial = username ? username.trim().charAt(0).toUpperCase() : "";
  // Search/sort/size controls only earn their space once there is something to organise.
  const showTools = status.kind === "ready" && items.length >= TOOLS_MIN_ITEMS;
  const countClass = items.length <= 2 ? "few" : items.length < TOOLS_MIN_ITEMS ? "some" : "many";

  return (
    <div className="gal">
      <header className="gal-header">
        <div className="gal-wrap gal-header-in">
          <Link className="gal-back" href="/" aria-label="กลับหน้าหลัก">
            <IconArrowLeft size={16} />
            <span>หน้าหลัก</span>
          </Link>
          <span className="gal-brand-name">แกลเลอรี</span>
          {username && (
            <div className="gal-user" title={username}>
              <span className="gal-avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="gal-username">{username}</span>
            </div>
          )}
        </div>
      </header>

      <main className="gal-wrap gal-main">
        {status.kind === "ready" && (
          <div className="gal-title-row">
            <h1 className="gal-h1">รูปของฉัน</h1>
            <p className="gal-sub">
              {items.length === 0
                ? "รูปที่อัปโหลดผ่านบอท Discord จะมารวมอยู่ที่นี่"
                : `${items.length.toLocaleString("th-TH")} รูป · ${fmtSize(totalBytes)}`}
            </p>
            {items.length > 0 && (
              <p className="gal-hint">
                เพิ่มรูปด้วย <code>/upload</code> ใน Discord
              </p>
            )}
          </div>
        )}

        {showTools && (
          <div className="gal-tools" role="search">
            <label className="gal-search">
              <IconSearch size={16} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อไฟล์"
                aria-label="ค้นหาชื่อไฟล์"
                autoComplete="off"
                enterKeyHint="search"
              />
              {query && (
                <button type="button" className="gal-search-clear" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา">
                  <IconX size={14} />
                </button>
              )}
            </label>
            <label className="gal-select">
              <span className="gal-visually-hidden">เรียงลำดับ</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                {(Object.keys(SORT_LABELS) as SortMode[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <div className="gal-seg" role="group" aria-label="ขนาดภาพย่อ">
              {(["s", "m", "l"] as Density[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={density === key ? "is-on" : ""}
                  aria-pressed={density === key}
                  aria-label={`ภาพย่อขนาด${DENSITY_LABELS[key]}`}
                  title={`ภาพย่อขนาด${DENSITY_LABELS[key]}`}
                  onClick={() => changeDensity(key)}
                >
                  <DensityGlyph density={key} />
                </button>
              ))}
            </div>
          </div>
        )}

        {status.kind === "loading" && (
          <div className="gal-grid" data-density="m" aria-busy="true" aria-label="กำลังโหลด">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="gal-skel">
                <div className="gal-skel-thumb" />
                <div className="gal-skel-line" />
                <div className="gal-skel-line short" />
              </div>
            ))}
          </div>
        )}

        {status.kind === "need-ticket" && (
          <section className="gal-state" aria-labelledby="gal-need-title">
            <h2 id="gal-need-title" className="gal-state-title">
              เข้าแกลเลอรีผ่าน Discord
            </h2>
            <p className="gal-state-desc dim">ลิงก์ที่บอทส่งให้ใช้ได้ครั้งเดียวและหมดอายุใน 10 นาที หากหมดอายุให้ขอลิงก์ใหม่ได้ทุกเมื่อ</p>
            <ol className="gal-steps">
              <li>
                <span className="gal-step-n">1</span>
                <p>
                  <strong>
                    พิมพ์ <code>/gallery</code> ในช่องแชตของเซิร์ฟเวอร์ Discord
                  </strong>
                  <span>แล้วกด Enter เพื่อส่งคำสั่งให้บอท</span>
                </p>
              </li>
              <li>
                <span className="gal-step-n">2</span>
                <p>
                  <strong>กดลิงก์ในข้อความที่บอทตอบกลับ</strong>
                  <span>บอทจะส่งให้เห็นเฉพาะคุณเท่านั้น</span>
                </p>
              </li>
              <li>
                <span className="gal-step-n">3</span>
                <p>
                  <strong>เข้าสู่แกลเลอรีของคุณ</strong>
                  <span>ดู ค้นหา ดาวน์โหลด และลบรูปได้จากหน้านี้</span>
                </p>
              </li>
            </ol>
          </section>
        )}

        {status.kind === "server-error" && (
          <section className="gal-state" aria-labelledby="gal-srv-title" role="alert">
            <span className="gal-state-flag warn">
              <IconAlert size={16} /> เชื่อมต่อไม่สำเร็จ
            </span>
            <h2 id="gal-srv-title" className="gal-state-title">
              โหลดแกลเลอรีไม่ได้ในตอนนี้
            </h2>
            <p className="gal-state-desc">เซิร์ฟเวอร์ไม่ตอบสนองหรืออินเทอร์เน็ตมีปัญหา ลองใหม่อีกครั้งได้เลย</p>
            <button type="button" className="gal-btn ghost" onClick={() => { setStatus({ kind: "loading" }); setAttempt((n) => n + 1); }}>
              ลองใหม่
            </button>
          </section>
        )}

        {status.kind === "ticket-error" && (
          <section className="gal-state" aria-labelledby="gal-err-title">
            <span className="gal-state-flag warn">
              <IconAlert size={16} /> เข้าสู่ระบบไม่สำเร็จ
            </span>
            <h2 id="gal-err-title" className="gal-state-title">
              ลิงก์นี้ใช้ไม่ได้แล้ว
            </h2>
            <p className="gal-state-desc">{status.message}</p>
            <p className="gal-state-desc dim">
              พิมพ์ <code>/gallery</code> ใน Discord อีกครั้งเพื่อขอลิงก์ใหม่
            </p>
          </section>
        )}

        {status.kind === "ready" && items.length === 0 && (
          <section className="gal-state" aria-labelledby="gal-empty-title">
            <h2 id="gal-empty-title" className="gal-state-title">
              ยังไม่มีรูปในแกลเลอรี
            </h2>
            <p className="gal-state-desc">
              ใช้คำสั่ง <code>/upload</code> ใน Discord เพื่ออัปโหลดรูปแรก แล้วรูปจะแสดงที่นี่ให้ดู ดาวน์โหลด และลบได้
            </p>
          </section>
        )}

        {status.kind === "ready" && items.length > 0 && visible.length === 0 && (
          <section className="gal-state" aria-live="polite">
            <h2 className="gal-state-title">ไม่พบรูปที่ตรงกับ “{query.trim()}”</h2>
            <p className="gal-state-desc">ลองตรวจตัวสะกด หรือค้นหาด้วยคำที่สั้นลง</p>
            <button type="button" className="gal-btn ghost" onClick={() => setQuery("")}>
              ล้างการค้นหา
            </button>
          </section>
        )}

        {status.kind === "ready" &&
          groups.map((group) => (
            <section key={group.key} className="gal-group" aria-label={group.label || undefined}>
              {group.label && (
                <h2 className="gal-group-h">
                  {group.label}
                  <span>{group.entries.length}</span>
                </h2>
              )}
              <ul className="gal-grid" data-density={showTools ? density : "m"} data-count={countClass}>
                {group.entries.map((item) => (
                  <li key={item.id} className="gal-card">
                    <button
                      type="button"
                      className="gal-thumb"
                      onClick={(e) => openItem(item.id, e.currentTarget)}
                      aria-label={`เปิดดู ${item.filename}`}
                    >
                      <SmartImage src={item.url} alt="" />
                    </button>
                    <div className="gal-quick">
                      <button
                        type="button"
                        className="gal-chip"
                        onClick={() => copyLink(item)}
                        aria-label={`คัดลอกลิงก์ ${item.filename}`}
                        title="คัดลอกลิงก์"
                      >
                        <IconCopy size={15} />
                      </button>
                      <button
                        type="button"
                        className="gal-chip danger"
                        onClick={() => setPendingDelete(item)}
                        aria-label={`ลบ ${item.filename}`}
                        title="ลบรูปนี้"
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
                    <div className="gal-cap">
                      <span className="gal-fname" title={item.filename}>
                        {item.filename}
                      </span>
                      <span className="gal-meta">
                        {fmtSize(item.size)}
                        {item.created_at && sort !== "large" ? ` · ${fmtTime(item.created_at)}` : ""}
                        {item.created_at && sort === "large" ? ` · ${fmtDateTime(item.created_at)}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

      </main>

      <footer className="gal-footer">
        <div className="gal-wrap gal-footer-in">
          <span>รูปของคุณมองเห็นได้เฉพาะคุณเท่านั้น</span>
          <span>ลิงก์เข้าสู่ระบบใช้ได้ครั้งเดียว หมดอายุใน 10 นาที</span>
        </div>
      </footer>

      <div className="gal-toasts" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={dismissToast} />
        ))}
      </div>

      {pendingDelete && (
        <ConfirmDeleteModal
          item={pendingDelete}
          busy={deleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => handleDelete(pendingDelete)}
        />
      )}

      {active && (
        <div className="gal-lb" role="dialog" aria-modal="true" aria-label={active.filename} ref={lightboxRef} onClick={closeLightbox}>
          <div className="gal-lb-top" onClick={(e) => e.stopPropagation()}>
            <span className="gal-lb-count">
              {activeIndex + 1} / {visible.length}
            </span>
            <button type="button" className="gal-iconbtn ghost" onClick={closeLightbox} aria-label="ปิด" data-autofocus>
              <IconX size={18} />
            </button>
          </div>

          {visible.length > 1 && (
            <>
              <button
                type="button"
                className="gal-lb-nav prev"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="รูปก่อนหน้า"
              >
                <IconChevronLeft size={22} />
              </button>
              <button
                type="button"
                className="gal-lb-nav next"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="รูปถัดไป"
              >
                <IconChevronRight size={22} />
              </button>
            </>
          )}

          <figure
            className="gal-lb-fig"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <SmartImage key={active.id} src={active.url} alt={active.filename} loading="eager" />
          </figure>

          <div className="gal-lb-bar" onClick={(e) => e.stopPropagation()}>
            <>
                <div className="gal-lb-info">
                  <div className="gal-fname" title={active.filename}>
                    {active.filename}
                  </div>
                  <div className="gal-meta">
                    {fmtSize(active.size)}
                    {active.created_at && ` · ${fmtDateTime(active.created_at)}`}
                  </div>
                </div>
                <div className="gal-lb-actions">
                  <button type="button" className="gal-iconbtn" onClick={() => copyLink(active)} aria-label="คัดลอกลิงก์" title="คัดลอกลิงก์">
                    <IconCopy size={17} />
                  </button>
                  <a
                    className="gal-iconbtn"
                    href={active.url}
                    download={active.filename}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="ดาวน์โหลด"
                    title="ดาวน์โหลด"
                  >
                    <IconDownload size={17} />
                  </a>
                  <a
                    className="gal-iconbtn"
                    href={active.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="เปิดรูปต้นฉบับในแท็บใหม่"
                    title="เปิดรูปต้นฉบับ"
                  >
                    <IconExternal size={17} />
                  </a>
                  <button
                    type="button"
                    className="gal-iconbtn danger"
                    onClick={() => setPendingDelete(active)}
                    aria-label="ลบรูปนี้"
                    title="ลบรูปนี้"
                  >
                    <IconTrash size={17} />
                  </button>
                </div>
            </>
          </div>
        </div>
      )}
    </div>
  );
}
