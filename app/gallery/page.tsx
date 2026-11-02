"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MouseEvent, PointerEvent, ReactNode, TouchEvent } from "react";
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

/** Storage used across every server, and the most a member may keep (same total the upload limit counts). */
interface Usage {
  bytes: number;
  limit_bytes: number;
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
const LONG_PRESS_MS = 450;
// The viewer's strip shows this many photos on each side of the open one.
const STRIP_SPAN = 40;
const SORT_LABELS: Record<SortMode, string> = {
  new: "ใหม่สุดก่อน",
  old: "เก่าสุดก่อน",
  large: "ไฟล์ใหญ่สุดก่อน",
};
const DENSITY_LABELS: Record<Density, string> = { s: "เล็ก", m: "กลาง", l: "ใหญ่" };
const NEXT_DENSITY: Record<Density, Density> = { s: "m", m: "l", l: "s" };

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
const IconSelect = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="m8 12.2 2.8 2.8L16.2 9.5" />
  </Icon>
);
const IconEye = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </Icon>
);
const IconImage = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m21 16-5.5-5.5L5 20" />
  </Icon>
);
const IconSort = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M7 4v16" />
    <path d="m3 16 4 4 4-4" />
    <path d="M17 20V4" />
    <path d="m13 8 4-4 4 4" />
  </Icon>
);

function DensityGlyph({ density }: { density: Density }) {
  // 3 / 2 / 1 columns to hint at tile size
  const cols = density === "s" ? 3 : density === "m" ? 2 : 1;
  const size = 16;
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
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 100 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
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

/** "วันนี้" / "เมื่อวาน" / the weekday, and the full date beside it. */
function dayLabels(key: string, todayKey: string, yesterdayKey: string): { main: string; sub: string } {
  if (key === "unknown") return { main: "ไม่ทราบวันที่", sub: "" };
  const d = new Date(`${key}T12:00:00+07:00`);
  const full = d.toLocaleDateString("th-TH", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
  if (key === todayKey) return { main: "วันนี้", sub: full };
  if (key === yesterdayKey) return { main: "เมื่อวาน", sub: full };
  return { main: d.toLocaleDateString("th-TH", { timeZone: TZ, weekday: "long" }), sub: full };
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

function sumBytes(list: GalleryItem[]): number {
  return list.reduce((sum, it) => sum + (it.size || 0), 0);
}

function fileKind(item: GalleryItem): string {
  const fromType = item.content_type.split("/")[1];
  const fromName = item.filename.includes(".") ? item.filename.split(".").pop() : "";
  return String(fromType || fromName || "").replace("jpeg", "jpg").toUpperCase();
}

function readUsage(value: unknown): Usage | null {
  if (!value || typeof value !== "object") return null;
  const { bytes, limit_bytes } = value as Record<string, unknown>;
  return typeof bytes === "number" && typeof limit_bytes === "number" && limit_bytes > 0 ? { bytes, limit_bytes } : null;
}

class ServerError extends Error {}

/** What the gallery API answers with; each call uses only its own fields. */
type ApiData = { items?: GalleryItem[]; usage?: unknown; discord_username?: string; error?: string; Error?: string } | null;

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
      className={`gl-toast ${toast.kind}`}
      role={toast.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="gl-toast-icon" aria-hidden="true">
        {toast.kind === "error" ? <IconAlert size={16} /> : <IconCheck size={16} />}
      </span>
      <span className="gl-toast-text">{toast.text}</span>
      <button type="button" className="gl-toast-close" onClick={() => onClose(toast.id)} aria-label="ปิดการแจ้งเตือน">
        <IconX size={14} />
      </button>
    </div>
  );
}

function ConfirmDeleteModal({
  items,
  busy,
  done,
  onCancel,
  onConfirm,
}: {
  items: GalleryItem[];
  busy: boolean;
  done: number;
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

  const many = items.length > 1;
  return (
    <div
      className="gl-dialog-backdrop"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="gl-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gl-del-title"
        aria-describedby="gl-del-desc"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gl-dialog-strip" data-count={Math.min(items.length, 4)}>
          {items.slice(0, 4).map((it) => (
            <div key={it.id} className="gl-dialog-thumb">
              <SmartImage src={it.url} alt="" compact />
            </div>
          ))}
          {items.length > 4 && <span className="gl-dialog-more">+{(items.length - 4).toLocaleString("th-TH")}</span>}
        </div>
        <h2 id="gl-del-title" className="gl-dialog-title">
          {many ? `ลบ ${items.length.toLocaleString("th-TH")} รูปถาวร?` : "ลบรูปนี้ถาวร?"}
        </h2>
        <p className="gl-dialog-file" title={many ? undefined : items[0].filename}>
          {many ? `รวม ${fmtSize(sumBytes(items))}` : `${items[0].filename} · ${fmtSize(items[0].size)}`}
        </p>
        <p id="gl-del-desc" className="gl-dialog-desc">
          ลบออกจากแกลเลอรีและที่เก็บไฟล์ ลิงก์ที่แชร์ไปแล้วจะเปิดไม่ได้อีก และกู้คืนไม่ได้
        </p>
        {busy && many && (
          <div className="gl-dialog-progress" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
            <span style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        )}
        <div className="gl-dialog-actions">
          <button type="button" className="gl-btn" onClick={onCancel} disabled={busy} data-autofocus>
            ยกเลิก
          </button>
          <button type="button" className="gl-btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? (many ? `กำลังลบ ${done}/${items.length}` : "กำลังลบ...") : many ? `ลบ ${items.length} รูป` : "ลบรูป"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */

function UsageMeter({ usage }: { usage: Usage }) {
  const pct = Math.min(100, (usage.bytes / usage.limit_bytes) * 100);
  const level = pct >= 90 ? "full" : pct >= 75 ? "high" : "ok";
  return (
    <div className="gl-usage" data-level={level}>
      <div className="gl-usage-row">
        <span>พื้นที่เก็บรูป</span>
        <span className="gl-usage-num">{Math.round(pct)}%</span>
      </div>
      <div
        className="gl-usage-track"
        role="meter"
        aria-label="พื้นที่เก็บรูปที่ใช้ไป"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${fmtSize(usage.bytes)} จาก ${fmtSize(usage.limit_bytes)}`}
      >
        <span style={{ width: `${usage.bytes > 0 ? Math.max(pct, 1.5) : 0}%` }} />
      </div>
      <p className="gl-usage-note">
        {level === "full"
          ? "ใกล้เต็มแล้ว ลบรูปที่ไม่ใช้เพื่อให้อัปโหลดต่อได้"
          : `ใช้ไป ${fmtSize(usage.bytes)} จาก ${fmtSize(usage.limit_bytes)}`}
      </p>
    </div>
  );
}

/** A drawing of the bot's private reply in Discord, so people know what to look for. */
function DiscordReply({ command, text, button, withImage = false }: { command: string; text: string; button: string; withImage?: boolean }) {
  return (
    <figure className="gl-dc" aria-hidden="true">
      <div className="gl-dc-ref">
        <span className="gl-dc-ref-line" />
        คุณใช้ <b>{command}</b>
      </div>
      <div className="gl-dc-msg">
        <span className="gl-dc-avatar">
          <IconImage size={17} />
        </span>
        <div className="gl-dc-body">
          <div className="gl-dc-name">
            บอท <span className="gl-dc-tag">แอป</span>
          </div>
          <p className="gl-dc-text">{text}</p>
          {withImage && (
            <div className="gl-dc-img">
              <IconImage size={22} />
            </div>
          )}
          <span className="gl-dc-btn">
            {button}
            <IconExternal size={13} />
          </span>
          <span className="gl-dc-eph">
            <IconEye size={13} /> เฉพาะคุณเท่านั้นที่เห็นข้อความนี้
          </span>
        </div>
      </div>
    </figure>
  );
}

function BrandBar({ username }: { username: string }) {
  return (
    <div className="gl-brandbar">
      <Link className="gl-home" href="/" aria-label="กลับหน้าหลัก" title="กลับหน้าหลัก">
        <IconArrowLeft size={17} />
      </Link>
      <span className="gl-wordmark">แกลเลอรี</span>
      {username && (
        <span className="gl-avatar sm" aria-hidden="true">
          {username.trim().charAt(0).toUpperCase()}
        </span>
      )}
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
  const [usage, setUsage] = useState<Usage | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GalleryItem[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteDone, setDeleteDone] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("new");
  const savedDensity = useSyncExternalStore(subscribeStorage, storedDensity, () => "m" as const);
  const [pickedDensity, setDensity] = useState<Density | null>(null);
  const density = pickedDensity ?? savedDensity;
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const viewerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // The photo that opened the viewer; focus goes back to it when the viewer closes.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // Long press on a photo (touch) starts selecting with that photo picked.
  const pressRef = useRef<{ x: number; y: number; timer: number } | null>(null);
  const suppressClickRef = useRef(false);
  // The last photo picked, for Shift+click ranges.
  const anchorRef = useRef<number | null>(null);

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
    // Older API versions answer without these; the meter and the name are then left out.
    setUsage(readUsage(data?.usage));
    if (data?.discord_username) setUsername(String(data.discord_username));
    return true;
  }, []);

  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setStatus({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

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
    if (sort === "large") return [{ key: "all", main: "เรียงจากไฟล์ใหญ่สุด", sub: "", entries: visible }];
    const now = openedAt;
    const todayKey = dayKey(new Date(now).toISOString());
    const yesterdayKey = dayKey(new Date(now - 24 * 3600 * 1000).toISOString());
    const out: { key: string; main: string; sub: string; entries: GalleryItem[] }[] = [];
    for (const it of visible) {
      const key = dayKey(it.created_at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.entries.push(it);
      else out.push({ key, ...dayLabels(key, todayKey, yesterdayKey), entries: [it] });
    }
    return out;
  }, [visible, sort, openedAt]);

  const totalBytes = useMemo(() => sumBytes(items), [items]);
  const selectedItems = useMemo(() => visible.filter((it) => selected.has(it.id)), [visible, selected]);
  const allSelected = visible.length > 0 && selectedItems.length === visible.length;

  const activeIndex = activeId === null ? -1 : visible.findIndex((it) => it.id === activeId);
  const active = activeIndex >= 0 ? visible[activeIndex] : null;

  /* ----- selecting ----- */

  const startSelecting = (firstId?: number) => {
    setSelecting(true);
    setSelected(new Set(firstId === undefined ? [] : [firstId]));
    anchorRef.current = firstId ?? null;
  };

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const pick = (id: number, range: boolean) => {
    const next = new Set(selected);
    const anchor = anchorRef.current;
    const from = range && anchor !== null ? visible.findIndex((it) => it.id === anchor) : -1;
    const to = visible.findIndex((it) => it.id === id);
    if (from >= 0 && to >= 0 && from !== to) {
      const [a, b] = from < to ? [from, to] : [to, from];
      for (let i = a; i <= b; i++) next.add(visible[i].id);
    } else if (next.has(id)) next.delete(id);
    else next.add(id);
    anchorRef.current = id;
    setSelected(next);
  };

  const pickGroup = (entries: GalleryItem[]) => {
    const next = new Set(selected);
    const all = entries.every((it) => next.has(it.id));
    for (const it of entries) {
      if (all) next.delete(it.id);
      else next.add(it.id);
    }
    setSelected(next);
  };

  const pickAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((it) => it.id)));

  const cancelPress = () => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };

  const onTilePointerDown = (id: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== "touch" || selecting) return;
    cancelPress();
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      suppressClickRef.current = true;
      startSelecting(id);
      navigator.vibrate?.(10);
    }, LONG_PRESS_MS);
    pressRef.current = { x: e.clientX, y: e.clientY, timer };
  };

  const onTilePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = pressRef.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress();
  };

  /* ----- viewer ----- */

  const openItem = useCallback((id: number, from?: HTMLElement | null) => {
    setOpener(from ?? (document.activeElement as HTMLElement | null));
    setActiveId(id);
  }, []);

  const onTileClick = (id: number) => (e: MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (selecting) pick(id, e.shiftKey);
    else openItem(id, e.currentTarget);
  };

  const closeViewer = useCallback(() => {
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
    const root = viewerRef.current;
    root?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (confirmOpen()) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeViewer();
      } else if (e.key === "ArrowRight") onStep(1);
      else if (e.key === "ArrowLeft") onStep(-1);
      else if (e.key === "Tab" && root) {
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"),
        ).filter((el) => el.offsetParent !== null);
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
  }, [isOpen, closeViewer]);

  // Keep the open photo in the middle of the strip.
  useEffect(() => {
    if (activeId === null) return;
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeId]);

  // Escape leaves selecting (the viewer and the dialog handle their own Escape).
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmOpen()) stopSelecting();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, stopSelecting]);

  // Warm the cache for the neighbours of the open image.
  useEffect(() => {
    if (activeIndex < 0 || visible.length < 2) return;
    for (const offset of [1, -1]) {
      const neighbour = visible[(activeIndex + offset + visible.length) % visible.length];
      const img = new Image();
      img.src = neighbour.url;
    }
  }, [activeIndex, visible]);

  const handleDelete = async (targets: GalleryItem[]) => {
    setDeleting(true);
    setDeleteDone(0);
    const removed = new Set<number>();
    let failed = 0;
    let lastError = "";
    let expired = false;
    // One at a time: the API deletes one photo per call, and this keeps the progress honest.
    for (const item of targets) {
      try {
        const { res, data } = await api(`/api/gallery/uploads/${item.id}`, { method: "DELETE" });
        if (res.status === 401) {
          expired = true;
          break;
        }
        // 404: already gone (deleted in another tab), which is what was asked for.
        if (res.ok || res.status === 404) removed.add(item.id);
        else {
          failed++;
          lastError = String(data?.Error || data?.error || "");
        }
      } catch {
        failed++;
        lastError = "ลบไม่สำเร็จ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้";
      }
      setDeleteDone((n) => n + 1);
    }
    setDeleting(false);

    if (removed.size > 0) {
      // Move the viewer to a photo that stays before removing, so it never flashes closed.
      if (activeId !== null && removed.has(activeId)) {
        const idx = visible.findIndex((it) => it.id === activeId);
        const next =
          visible.slice(idx + 1).find((it) => !removed.has(it.id)) ??
          visible
            .slice(0, idx)
            .reverse()
            .find((it) => !removed.has(it.id));
        setActiveId(next ? next.id : null);
      }
      const freed = sumBytes(targets.filter((it) => removed.has(it.id)));
      setItems((prev) => prev.filter((it) => !removed.has(it.id)));
      setSelected((prev) => new Set([...prev].filter((id) => !removed.has(id))));
      setUsage((u) => (u ? { ...u, bytes: Math.max(0, u.bytes - freed) } : u));
    }

    if (expired) {
      setPendingDelete(null);
      closeViewer();
      stopSelecting();
      setStatus({ kind: "need-ticket" });
      showToast("เซสชันหมดอายุ กรุณาขอลิงก์ใหม่จากบอท", "error");
      return;
    }
    if (failed > 0) {
      if (targets.length === 1) {
        // The dialog stays open so "ลบรูป" can be pressed again.
        showToast(lastError || "ลบไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
        return;
      }
      setPendingDelete(null);
      showToast(`ลบได้ ${removed.size} จาก ${targets.length} รูป รูปที่เหลือยังเลือกไว้ ลองลบอีกครั้ง`, "error");
      return;
    }
    setPendingDelete(null);
    if (selecting) stopSelecting();
    showToast(removed.size === 1 ? "ลบรูปแล้ว" : `ลบแล้ว ${removed.size.toLocaleString("th-TH")} รูป`);
  };

  const copyText = async (text: string, okText: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(okText);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
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
      showToast(ok ? okText : "คัดลอกไม่สำเร็จ", ok ? "success" : "error");
    }
  };

  const copyLink = (item: GalleryItem) => copyText(absoluteUrl(item.url), "คัดลอกลิงก์แล้ว");
  // One zip of the chosen pictures. A single picture just downloads as itself.
  const downloadPictures = async (list: GalleryItem[]) => {
    if (downloading || list.length === 0) return;
    const save = (href: string, name: string) => {
      const link = document.createElement("a");
      link.href = href;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };
    if (list.length === 1) {
      save(list[0].url, list[0].filename);
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/api/gallery/download`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: list.map((it) => it.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        showToast(data?.error || "โหลดไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      save(url, "nexora-gallery.zip");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast(`โหลด ${list.length.toLocaleString("th-TH")} รูปแล้ว`);
    } catch {
      showToast("โหลดไม่สำเร็จ ลองใหม่อีกครั้ง", "error");
    } finally {
      setDownloading(false);
    }
  };

  const copySelected = () =>
    copyText(
      selectedItems.map((it) => absoluteUrl(it.url)).join("\n"),
      selectedItems.length === 1 ? "คัดลอกลิงก์แล้ว" : `คัดลอก ${selectedItems.length} ลิงก์แล้ว (บรรทัดละลิงก์)`,
    );

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

  const ready = status.kind === "ready";
  const library = ready && items.length > 0;
  // Search/sort/size controls only earn their space once there is something to organise.
  const showTools = library && items.length >= TOOLS_MIN_ITEMS;
  const canSelect = library && items.length >= 2;
  const strip = active ? visible.slice(Math.max(0, activeIndex - STRIP_SPAN), activeIndex + STRIP_SPAN + 1) : [];

  /* ----- states without photos: one centred column ----- */

  const plain = !library && (
    <div className="gl-plain">
      <header className="gl-plain-top">
        <BrandBar username={username} />
      </header>
      <main className="gl-plain-main">
        {status.kind === "loading" && (
          <div className="gl-loading" aria-busy="true" aria-label="กำลังโหลด">
            <div className="gl-skel-line wide" />
            <div className="gl-skel-line" />
            <div className="gl-grid" data-density="m">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="gl-skel-tile" />
              ))}
            </div>
          </div>
        )}

        {(status.kind === "need-ticket" || status.kind === "ticket-error") && (
          <section className="gl-intro" aria-labelledby="gl-intro-title">
            <div className="gl-intro-copy">
              {status.kind === "ticket-error" ? (
                <p className="gl-flag warn">
                  <IconAlert size={15} /> {status.message}
                </p>
              ) : (
                <p className="gl-kicker">แกลเลอรีรูปจากบอท Discord</p>
              )}
              <h1 id="gl-intro-title" className="gl-display">
                {status.kind === "ticket-error" ? "ขอลิงก์ใหม่จากบอทได้เลย" : "รูปที่คุณอัปโหลด อยู่ที่นี่ทั้งหมด"}
              </h1>
              <p className="gl-lede">
                ไม่ต้องสมัครหรือใช้รหัสผ่าน บอทจะส่งลิงก์เข้าแกลเลอรีของคุณให้ ลิงก์ใช้ได้ครั้งเดียวและหมดอายุใน 10 นาที
              </p>
            </div>
            <DiscordReply command="/gallery" text="กดปุ่มด้านล่างเพื่อเปิดแกลเลอรีรูปของคุณ ลิงก์นี้ใช้ได้ครั้งเดียว หมดอายุใน 10 นาที" button="เปิดแกลเลอรีของฉัน" />
            <ol className="gl-steps">
              <li>
                <span className="gl-step-n">01</span>
                <strong>
                  พิมพ์ <code>/gallery</code>
                </strong>
                <span>ในเซิร์ฟเวอร์ Discord ห้องไหนก็ได้ที่ใช้คำสั่งบอทได้</span>
              </li>
              <li>
                <span className="gl-step-n">02</span>
                <strong>กด “เปิดแกลเลอรีของฉัน”</strong>
                <span>ข้อความจากบอทเห็นได้เฉพาะคุณ</span>
              </li>
              <li>
                <span className="gl-step-n">03</span>
                <strong>จัดการรูปได้ที่หน้านี้</strong>
                <span>ดู คัดลอกลิงก์ ดาวน์โหลด หรือลบ อยู่ในระบบได้ 24 ชั่วโมง</span>
              </li>
            </ol>
          </section>
        )}

        {status.kind === "server-error" && (
          <section className="gl-notice" aria-labelledby="gl-srv-title" role="alert">
            <p className="gl-flag warn">
              <IconAlert size={15} /> เชื่อมต่อไม่สำเร็จ
            </p>
            <h1 id="gl-srv-title" className="gl-display sm">
              โหลดแกลเลอรีไม่ได้ในตอนนี้
            </h1>
            <p className="gl-lede">เซิร์ฟเวอร์ไม่ตอบสนองหรืออินเทอร์เน็ตมีปัญหา รูปของคุณยังอยู่ครบ</p>
            <button type="button" className="gl-btn accent" onClick={retry}>
              ลองใหม่
            </button>
          </section>
        )}

        {ready && items.length === 0 && (
          <section className="gl-intro" aria-labelledby="gl-empty-title">
            <div className="gl-intro-copy">
              <p className="gl-kicker">{username ? `สวัสดี ${username}` : "แกลเลอรีของคุณ"}</p>
              <h1 id="gl-empty-title" className="gl-display">
                ยังไม่มีรูป เริ่มจาก <span className="gl-mark">/upload</span>
              </h1>
              <p className="gl-lede">
                พิมพ์ <code>/upload</code> ใน Discord แล้วแนบรูปได้ครั้งละ 10 รูป (JPG, PNG, GIF, WebP ไม่เกิน 25MB) บอทจะส่งลิงก์กลับมา และรูปจะมารวมอยู่ที่หน้านี้
              </p>
              <div className="gl-intro-actions">
                <button type="button" className="gl-btn" onClick={() => copyText("/upload", "คัดลอกคำสั่งแล้ว ไปวางใน Discord ได้เลย")}>
                  <IconCopy size={15} /> คัดลอกคำสั่ง
                </button>
                <button type="button" className="gl-btn accent" onClick={retry}>
                  อัปโหลดแล้ว โหลดใหม่
                </button>
              </div>
            </div>
            <DiscordReply command="/upload" text="อัปโหลดสำเร็จ 1 รูป" button="เปิดรูปเต็ม" withImage />
          </section>
        )}
      </main>
    </div>
  );

  /* ----- the library: side panel + photos ----- */

  const libraryView = library && (
    <div className="gl-shell">
      <aside className="gl-side" aria-label="ข้อมูลแกลเลอรี">
        <h1 className="gl-visually-hidden">แกลเลอรีรูปของฉัน</h1>
        <BrandBar username="" />
        <div className="gl-profile">
          <span className="gl-avatar" aria-hidden="true">
            {(username || "?").trim().charAt(0).toUpperCase()}
          </span>
          <div className="gl-profile-text">
            <strong title={username}>{username || "แกลเลอรีของฉัน"}</strong>
            <span>
              {items.length.toLocaleString("th-TH")} รูป · {fmtSize(totalBytes)}
            </span>
          </div>
        </div>
        {usage && <UsageMeter usage={usage} />}
        <div className="gl-howto">
          <p className="gl-howto-title">เพิ่มรูป</p>
          <p className="gl-howto-text">
            พิมพ์ <code>/upload</code> ใน Discord แนบได้ครั้งละ 10 รูป
          </p>
          <button type="button" className="gl-btn sm" onClick={() => copyText("/upload", "คัดลอกคำสั่งแล้ว ไปวางใน Discord ได้เลย")}>
            <IconCopy size={14} /> คัดลอกคำสั่ง
          </button>
        </div>
        <p className="gl-side-foot">คนอื่นเปิดหน้านี้ไม่ได้ แต่ทุกคนที่มีลิงก์รูปจะเปิดรูปนั้นได้</p>
      </aside>

      <div className="gl-content">
        <div className="gl-bar" data-mode={selecting ? "select" : "browse"}>
          {selecting ? (
            <>
              <button type="button" className="gl-icon" onClick={stopSelecting} aria-label="เลิกเลือก" title="เลิกเลือก (Esc)">
                <IconX size={18} />
              </button>
              <p className="gl-bar-count" aria-live="polite">
                {selectedItems.length > 0 ? (
                  <>
                    <b>{selectedItems.length.toLocaleString("th-TH")}</b> รูป
                    <span> · {fmtSize(sumBytes(selectedItems))}</span>
                  </>
                ) : (
                  "เลือกรูปที่ต้องการ"
                )}
              </p>
              <button type="button" className="gl-btn ghost gl-bar-all" onClick={pickAll}>
                {allSelected ? "ไม่เลือกทั้งหมด" : "เลือกทั้งหมด"}
              </button>
              <div className="gl-bar-actions">
                <button type="button" className="gl-btn" onClick={() => void downloadPictures(selectedItems)} disabled={selectedItems.length === 0 || downloading}>
                  <IconDownload size={16} />
                  <span>{downloading ? "กำลังโหลด" : "โหลด"}</span>
                </button>
                <button type="button" className="gl-btn" onClick={copySelected} disabled={selectedItems.length === 0}>
                  <IconCopy size={16} />
                  <span>คัดลอกลิงก์</span>
                </button>
                <button type="button" className="gl-btn danger" onClick={() => setPendingDelete(selectedItems)} disabled={selectedItems.length === 0}>
                  <IconTrash size={16} />
                  <span>ลบ</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {showTools ? (
                <label className="gl-search" role="search">
                  <IconSearch size={16} />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ค้นหาจากชื่อไฟล์"
                    aria-label="ค้นหาจากชื่อไฟล์"
                    autoComplete="off"
                    enterKeyHint="search"
                  />
                  {query && (
                    <button type="button" className="gl-search-clear" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา">
                      <IconX size={14} />
                    </button>
                  )}
                </label>
              ) : (
                <p className="gl-bar-title">รูปทั้งหมด</p>
              )}
              {showTools && (
                <>
                  <label className="gl-sort" title="เรียงลำดับ">
                    <IconSort size={15} />
                    <span className="gl-visually-hidden">เรียงลำดับ</span>
                    <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
                      {(Object.keys(SORT_LABELS) as SortMode[]).map((key) => (
                        <option key={key} value={key}>
                          {SORT_LABELS[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="gl-seg" role="group" aria-label="ขนาดรูปย่อ">
                    {(["s", "m", "l"] as Density[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={density === key ? "is-on" : ""}
                        aria-pressed={density === key}
                        aria-label={`รูปย่อขนาด${DENSITY_LABELS[key]}`}
                        title={`รูปย่อขนาด${DENSITY_LABELS[key]}`}
                        onClick={() => changeDensity(key)}
                      >
                        <DensityGlyph density={key} />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="gl-icon gl-density-cycle"
                    onClick={() => changeDensity(NEXT_DENSITY[density])}
                    aria-label={`รูปย่อขนาด${DENSITY_LABELS[density]} กดเพื่อเปลี่ยน`}
                  >
                    <DensityGlyph density={density} />
                  </button>
                </>
              )}
              {canSelect && visible.length > 0 && (
                <button type="button" className="gl-btn gl-get-all" onClick={() => void downloadPictures(visible)} disabled={downloading} title={query ? "โหลดรูปที่ค้นเจอทั้งหมด" : "โหลดทั้งหมด"} aria-label={query ? "โหลดรูปที่ค้นเจอทั้งหมด" : "โหลดทั้งหมด"}>
                  <IconDownload size={16} />
                  <span>{downloading ? "กำลังโหลด" : query ? "โหลดที่ค้นเจอ" : "โหลดทั้งหมด"}</span>
                </button>
              )}
              {canSelect && visible.length > 0 && (
                <button type="button" className="gl-btn gl-pick" onClick={() => startSelecting()} title="เลือกหลายรูปเพื่อลบหรือคัดลอกลิงก์">
                  <IconSelect size={16} />
                  <span>เลือก</span>
                </button>
              )}
            </>
          )}
        </div>

        <main className="gl-photos">
          {visible.length === 0 && (
            <section className="gl-notice" aria-live="polite">
              <h2 className="gl-display sm">ไม่พบรูปที่ชื่อมีคำว่า “{query.trim()}”</h2>
              <p className="gl-lede">ค้นหาจากชื่อไฟล์ ลองตรวจตัวสะกดหรือใช้คำที่สั้นลง</p>
              <button type="button" className="gl-btn" onClick={() => setQuery("")}>
                ล้างการค้นหา
              </button>
            </section>
          )}

          {groups.map((group) => {
            const groupPicked = selecting && group.entries.every((it) => selected.has(it.id));
            return (
              <section key={group.key} className="gl-day" aria-label={group.sub ? `${group.main} ${group.sub}` : group.main}>
                <div className="gl-day-h">
                  <h2>
                    {group.main}
                    {group.sub && <span className="gl-day-date">{group.sub}</span>}
                  </h2>
                  {selecting && group.key !== "all" ? (
                    <button type="button" className="gl-day-pick" onClick={() => pickGroup(group.entries)} aria-pressed={groupPicked}>
                      <span className="gl-day-check" aria-hidden="true">
                        <IconCheck size={12} />
                      </span>
                      {groupPicked ? "เลือกทั้งวันแล้ว" : "เลือกทั้งวัน"}
                    </button>
                  ) : (
                    <span className="gl-day-count">{group.entries.length.toLocaleString("th-TH")} รูป</span>
                  )}
                </div>
                <ul className="gl-grid" data-density={density}>
                  {group.entries.map((item) => {
                    const isPicked = selected.has(item.id);
                    return (
                      <li key={item.id} className="gl-tile" data-picked={isPicked || undefined}>
                        <button
                          type="button"
                          className="gl-tile-btn"
                          onClick={onTileClick(item.id)}
                          onPointerDown={onTilePointerDown(item.id)}
                          onPointerMove={onTilePointerMove}
                          onPointerUp={cancelPress}
                          onPointerCancel={cancelPress}
                          onPointerLeave={cancelPress}
                          onContextMenu={(e) => {
                            if (pressRef.current || suppressClickRef.current) e.preventDefault();
                          }}
                          aria-pressed={selecting ? isPicked : undefined}
                          aria-label={selecting ? `เลือก ${item.filename}` : `เปิดดู ${item.filename}`}
                        >
                          <SmartImage src={item.url} alt="" />
                          <span className="gl-tile-info" aria-hidden="true">
                            <span className="gl-tile-name">{item.filename}</span>
                            <span className="gl-tile-meta">
                              {fileKind(item)} · {fmtSize(item.size)}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="gl-tile-check"
                          onClick={() => (selecting ? pick(item.id, false) : startSelecting(item.id))}
                          aria-label={`เลือก ${item.filename}`}
                          aria-hidden={selecting || undefined}
                          tabIndex={selecting ? -1 : undefined}
                        >
                          <IconCheck size={13} />
                        </button>
                        {!selecting && (
                          <div className="gl-tile-acts">
                            <button type="button" onClick={() => copyLink(item)} aria-label={`คัดลอกลิงก์ ${item.filename}`} title="คัดลอกลิงก์">
                              <IconCopy size={15} />
                            </button>
                            <button type="button" className="danger" onClick={() => setPendingDelete([item])} aria-label={`ลบ ${item.filename}`} title="ลบรูปนี้">
                              <IconTrash size={15} />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {canSelect && !selecting && <p className="gl-tip">กดค้างที่รูปเพื่อเลือกหลายรูป</p>}
          <p className="gl-foot-note">คนอื่นเปิดหน้านี้ไม่ได้ แต่ทุกคนที่มีลิงก์รูปจะเปิดรูปนั้นได้</p>
        </main>
      </div>
    </div>
  );

  return (
    <div className="gl" data-selecting={selecting || undefined}>
      {plain}
      {libraryView}

      <div className="gl-toasts" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={dismissToast} />
        ))}
      </div>

      {pendingDelete && (
        <ConfirmDeleteModal
          items={pendingDelete}
          busy={deleting}
          done={deleteDone}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => handleDelete(pendingDelete)}
        />
      )}

      {active && (
        <div className="gl-view" role="dialog" aria-modal="true" aria-label={active.filename} ref={viewerRef}>
          <button type="button" className="gl-icon gl-view-close" onClick={closeViewer} aria-label="ปิด (Esc)" title="ปิด (Esc)" data-autofocus>
            <IconX size={20} />
          </button>
          <div className="gl-view-title">
            <strong title={active.filename}>{active.filename}</strong>
            <span>
              {[fmtDateTime(active.created_at), fmtSize(active.size), `${activeIndex + 1} / ${visible.length}`].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="gl-view-acts">
            <button type="button" className="gl-icon" onClick={() => copyLink(active)} aria-label="คัดลอกลิงก์" title="คัดลอกลิงก์">
              <IconCopy size={18} />
              <span>คัดลอก</span>
            </button>
            <a className="gl-icon" href={active.url} download={active.filename} aria-label="ดาวน์โหลด" title="ดาวน์โหลด">
              <IconDownload size={18} />
              <span>ดาวน์โหลด</span>
            </a>
            <a className="gl-icon" href={active.url} target="_blank" rel="noopener noreferrer" aria-label="เปิดรูปต้นฉบับในแท็บใหม่" title="เปิดรูปต้นฉบับ">
              <IconExternal size={18} />
              <span>ต้นฉบับ</span>
            </a>
            <button type="button" className="gl-icon danger" onClick={() => setPendingDelete([active])} aria-label="ลบรูปนี้" title="ลบรูปนี้">
              <IconTrash size={18} />
              <span>ลบ</span>
            </button>
          </div>

          <div className="gl-view-stage" onClick={closeViewer}>
            {visible.length > 1 && (
              <button
                type="button"
                className="gl-view-nav prev"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="รูปก่อนหน้า"
              >
                <IconChevronLeft size={22} />
              </button>
            )}
            <figure className="gl-view-fig" onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <SmartImage key={active.id} src={active.url} alt={active.filename} loading="eager" />
            </figure>
            {visible.length > 1 && (
              <button
                type="button"
                className="gl-view-nav next"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="รูปถัดไป"
              >
                <IconChevronRight size={22} />
              </button>
            )}
          </div>

          {visible.length > 1 && (
            <div className="gl-view-strip" ref={stripRef} aria-label="รูปอื่นในแกลเลอรี">
              {strip.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  data-id={it.id}
                  className={it.id === active.id ? "is-on" : ""}
                  aria-current={it.id === active.id || undefined}
                  aria-label={`เปิดดู ${it.filename}`}
                  onClick={() => setActiveId(it.id)}
                >
                  <SmartImage src={it.url} alt="" compact />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
