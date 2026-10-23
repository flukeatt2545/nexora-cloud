"use client";

import {
  Cloud, Eye, EyeOff, FolderOpen, Info, LayoutDashboard, LogOut, Menu, ShieldCheck, User, X, Globe, Smartphone, Monitor, KeyRound, Check, Clock3, Zap, ChevronDown, Coins, Lock, Store, ReceiptText, RefreshCw, ChevronLeft, ChevronRight, Plus, ArrowUpRight, ExternalLink, Database, Mail, ShoppingCart, Undo2,
  FileImage, FileVideo, FileAudio, FileText, FileArchive, File as FileIcon, CircleCheck, CircleAlert, Circle, Upload, Bot,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { applyThemeColor } from "../themeColor";
import HostingView from "./HostingView";
import SocialOAuthButton, { useSocialAvailability } from "../SocialOAuthButton";
import { TopupModal } from "../components/TopupModal";
import { PageLoadingScreen } from "../components/PageLoadingScreen";
import FileLibraryView from "./FileLibraryView";
import GamingStore, { MarqueeAnnouncementQueue, type Announcement } from "../GamingStore";
import { asciiInputProps, hasNonAscii } from "../lib/asciiInput";
import { API_BASE } from "../runtime";
import MailView from "./MailView";
import BotsView from "./BotsView";
import SessionGuard, { EXPIRED_EVENT } from "../components/SessionGuard";
import "./user-overview.css";
import SmartImage from "../components/SmartImage";
import { POINTS_EVENT, broadcastPoints } from "../components/StorePurchase";
import Link from "next/link";

// Keep types same for now
type Role = "user" | "admin" | "superadmin";
export type AuthUser = { id: number; username: string; displayName: string; email: string; avatarUrl: string; role: Role; status: string; passwordEnabled: boolean; permissions: string[]; points?: number };
type Session = { id: number; ipAddress: string; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean };
type ConfirmRequest = { title: string; message: string; confirmLabel?: string; danger?: boolean; action: () => void | Promise<void> };
type SocialAccount = { provider: string; email: string; connectedAt: string; disconnectRequestedAt?: string | null; disconnectScheduledFor?: string | null };
type SocialPolicy = { canConnect: boolean; remainingToday: number; availableAt?: string | null; code?: string };
type TopupHistoryItem = { id: number; amount: number; status: string; transRef: string; createdAt: string; verifiedAt?: string | null };
type TopupHistoryResponse = { items: TopupHistoryItem[]; summary: { totalAmount: number; monthAmount: number; total: number }; page: number; perPage: number; total: number };
type OverviewSite = { id: string; name: string; subdomain: string; customDomain?: string; status: "provisioning" | "running" | "stopped" | "error" | "expired"; updatedAt?: string };
type OverviewFile = { id: string; name: string; contentType: string; size: number; createdAt: string };
type OverviewMailbox = { id: string; address: string; quotaBytes: number; usedBytes: number; unread: number };
type FeedbackNotice = { kind: "success" | "error"; title?: string; text: string; persistent?: boolean };

const roleLabel: Record<Role, string> = { user: "ผู้ใช้", admin: "แอดมิน", superadmin: "ผู้ดูแลระบบ" };
const siteStatusLabel: Record<OverviewSite["status"], string> = {
  provisioning: "กำลังเตรียมระบบ", running: "ออนไลน์", stopped: "หยุดอยู่", error: "มีข้อผิดพลาด", expired: "หมดอายุ",
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...options,
      headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options?.headers },
    });
    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "ระบบไม่สามารถดำเนินการได้");
    return payload as T;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Backend ได้ กรุณาตรวจสอบว่าระบบกำลังทำงานอยู่");
    }
    throw error;
  }
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatRemaining(value?: string | null, now = Date.now()) {
  if (!value) return "";
  const milliseconds = new Date(value).getTime() - now;
  if (milliseconds <= 0) return "กำลังดำเนินการ";
  const totalMinutes = Math.ceil(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} วัน ${hours} ชม.`;
  if (hours > 0) return `${hours} ชม. ${minutes} นาที`;
  return `${minutes} นาที`;
}

const socialNames: Record<string, string> = { discord: "Discord", google: "Google", github: "GitHub" };

/** What the Social sign-in page reported in the query string, as a notice (or null when it reported nothing). */
function socialNotice(search: string): { kind: "success" | "error"; text: string } | null {
  const params = new URLSearchParams(search);
  const socialResult = params.get("social");
  const socialError = params.get("social_error");
  const provider = socialNames[params.get("provider") || ""] || "บัญชี Social";
  if (socialResult === "connected") return { kind: "success", text: `เชื่อมต่อ ${provider} เรียบร้อยแล้ว` };
  if (!socialError) return null;
  const retryAt = params.get("retry_at");
  const messages: Record<string, string> = {
    social_cooldown: `เพื่อความปลอดภัย กรุณารอ ${formatRemaining(retryAt)} ก่อนเปลี่ยนหรือเชื่อมบัญชีอื่น`,
    social_daily_limit: `วันนี้คุณเปลี่ยนหรือเชื่อมบัญชีครบ 3 ครั้งแล้ว กรุณารอ ${formatRemaining(retryAt)}`,
    social_already_connected: `${provider} บัญชีนี้เชื่อมกับบัญชี NEXORA อื่นอยู่แล้ว`,
  };
  return { kind: "error", text: messages[socialError] || "ยังเชื่อมต่อบัญชีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
}

function parseUserAgent(ua: string) {
  if (!ua) return { browser: "Unknown Browser", os: "Unknown OS", icon: Globe };
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  let Icon = Globe;
  if (ua.includes("Win")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("iPhone") || ua.includes("iPad")) { os = "iOS"; Icon = Smartphone; }
  else if (ua.includes("Android")) { os = "Android"; Icon = Smartphone; }
  else if (ua.includes("Linux")) os = "Linux";
  if (ua.includes("Edg/")) browser = "Microsoft Edge";
  else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";
  else if (ua.includes("Firefox/")) browser = "Firefox";
  if (os === "Windows" || os === "macOS" || os === "Linux") Icon = Monitor;
  return { browser, os, icon: Icon };
}

function UserFeedbackToast({ notice, onClose }: { notice: FeedbackNotice; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      <div className={`toast ${notice.kind}`}>
        {notice.kind === "success" ? <CircleCheck size={20} aria-hidden="true" /> : <CircleAlert size={20} aria-hidden="true" />}
        <span>
          {notice.title ? <strong>{notice.title}</strong> : null}
          {notice.text}
        </span>
        <button type="button" className="toast-close" onClick={onClose} aria-label="ปิด"><X size={16} /></button>
      </div>
    </div>
  );
}

function UserConfirmDialog({ request, busy, onClose, onConfirm }: { request: ConfirmRequest; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose(); window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [busy, onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="system-dialog-backdrop" role="presentation" onMouseDown={(event) => !busy && event.target === event.currentTarget && onClose()}>
      <section className={`system-dialog confirm ${request.danger ? "danger" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <span className="system-dialog-icon"><Info size={27} /></span><h2 id="confirm-title">{request.title}</h2><p>{request.message}</p>
        <div className="system-dialog-actions"><button onClick={onClose} disabled={busy} autoFocus>ยกเลิก</button><button className={request.danger ? "danger" : "dash-primary"} onClick={onConfirm} disabled={busy}>{busy ? "กำลังดำเนินการ..." : request.confirmLabel || "ยืนยัน"}</button></div>
      </section>
    </div>,
    document.body
  );
}

type UserView = "profile" | "hosting" | "overview" | "topups" | "files" | "store" | "mail" | "bots";

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "สวัสดีตอนเช้า";
  if (hour >= 12 && hour < 17) return "สวัสดีตอนบ่าย";
  if (hour >= 17 && hour < 21) return "สวัสดีตอนเย็น";
  return "สวัสดีตอนค่ำ";
}

function formatBytesCompact(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileTypeIcon(contentType: string, name: string) {
  const type = (contentType || "").toLowerCase();
  if (type.startsWith("image/")) return FileImage;
  if (type.startsWith("video/")) return FileVideo;
  if (type.startsWith("audio/")) return FileAudio;
  if (/zip|rar|7z|tar|gzip/.test(type) || /\.(zip|rar|7z|tar|gz)$/i.test(name)) return FileArchive;
  if (type.startsWith("text/") || type.includes("pdf") || type.includes("document")) return FileText;
  return FileIcon;
}

function formatShortDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(value));
}

const userViewLoadingLabel: Record<UserView, string> = {
  overview: "กำลังเข้าสู่แดชบอร์ด...",
  profile: "กำลังเข้าสู่โปรไฟล์...",
  hosting: "กำลังเข้าสู่โฮสติ้ง...",
  topups: "กำลังเข้าสู่ระบบเติมเงิน...",
  files: "กำลังเข้าสู่ไฟล์ของฉัน...",
  store: "กำลังเข้าสู่ร้านค้า...",
  mail: "กำลังเข้าสู่ Webmail...",
  bots: "กำลังเข้าสู่บอท Discord...",
};

export default function UserApp({ view }: { view: UserView }) {
  const [me, setMe] = useState<AuthUser | null>(null);
  useEffect(() => {
    // The embedded store announces the new balance after a purchase.
    const onPoints = (event: Event) => {
      const points = (event as CustomEvent<number>).detail;
      if (typeof points === "number") setMe((prev) => prev ? { ...prev, points } : prev);
    };
    window.addEventListener(POINTS_EVENT, onPoints);
    return () => window.removeEventListener(POINTS_EVENT, onPoints);
  }, []);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<FeedbackNotice | null>(() => (typeof window === "undefined" ? null : socialNotice(window.location.search)));
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [topupRevision, setTopupRevision] = useState(0);
  // Store switch from system settings: closed hides buying, top-ups and their cards.
  const [store, setStore] = useState<{ open: boolean; message: string }>({ open: true, message: "" });
  const [mailUnread, setMailUnread] = useState(0);
  const [mailboxes, setMailboxes] = useState<OverviewMailbox[]>([]);
  const accountRef = useRef<HTMLDivElement>(null);
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (!me) return;
    let active = true;
    const load = () => api<{ unread: number; mailboxes?: OverviewMailbox[] }>("/api/mail/bootstrap").then((data) => {
      if (!active) return;
      setMailUnread(data.unread || 0);
      setMailboxes(data.mailboxes || []);
    }).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 30_000);
    const visible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [me]);

  // Dashboard Overview state
  const [dashStats, setDashStats] = useState<{
    sitesCount: number;
    runningSitesCount: number;
    sites: OverviewSite[];
    recentFiles: OverviewFile[];
    filesCount: number;
    usedBytes: number;
    recentTopups: TopupHistoryItem[];
    loaded: boolean;
  }>({
    sitesCount: 0,
    runningSitesCount: 0,
    sites: [],
    recentFiles: [],
    filesCount: 0,
    usedBytes: 0,
    recentTopups: [],
    loaded: false,
  });

  useEffect(() => {
    if (view !== "overview" || !me) return;
    let isCancelled = false;

    async function loadOverviewData() {
      try {
        const [sitesRes, filesRes, topupsRes] = await Promise.allSettled([
          api<{ items: OverviewSite[] }>("/api/hosting/sites"),
          api<{ items: OverviewFile[]; usedBytes: number }>("/api/files"),
          api<TopupHistoryResponse>("/api/topup/history?page=1&perPage=4"),
        ]);

        if (isCancelled) return;

        let sitesCount = 0;
        let runningSitesCount = 0;
        let sites: OverviewSite[] = [];
        if (sitesRes.status === "fulfilled" && sitesRes.value?.items) {
          sitesCount = sitesRes.value.items.length;
          runningSitesCount = sitesRes.value.items.filter((s) => s.status === "running").length;
          sites = [...sitesRes.value.items]
            .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
            .slice(0, 5);
        }

        let filesCount = 0;
        let usedBytes = 0;
        let recentFiles: OverviewFile[] = [];
        if (filesRes.status === "fulfilled" && filesRes.value) {
          filesCount = filesRes.value.items?.length || 0;
          recentFiles = [...(filesRes.value.items || [])]
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
            .slice(0, 5);
          usedBytes = filesRes.value.usedBytes || 0;
        }

        let recentTopups: TopupHistoryItem[] = [];
        if (topupsRes.status === "fulfilled" && topupsRes.value?.items) {
          recentTopups = topupsRes.value.items.slice(0, 4);
        }

        setDashStats({
          sitesCount,
          runningSitesCount,
          sites,
          recentFiles,
          filesCount,
          usedBytes,
          recentTopups,
          loaded: true,
        });
      } catch {
        if (!isCancelled) {
          setDashStats((prev) => ({ ...prev, loaded: true }));
        }
      }
    }

    void loadOverviewData();

    return () => {
      isCancelled = true;
    };
  }, [view, me, topupRevision]);

  // The homepage ticker also runs on the overview and top-ups, from the same announcements.
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  useEffect(() => {
    if (view !== "overview" && view !== "topups") return;
    let active = true;
    api<{ items: Announcement[] }>("/api/announcements?placement=homepage")
      .then((data) => { if (active) setAnnouncements(data.items || []); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [view]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen && !accountOpen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        setAccountOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mobileNavOpen, accountOpen]);

  const scrollLockYRef = useRef(0);

  useEffect(() => {
    if (!mobileNavOpen) return;

    scrollLockYRef.current = window.scrollY;
    const { style: bodyStyle } = document.body;
    const { style: htmlStyle } = document.documentElement;
    document.documentElement.classList.add("user-nav-locked");
    document.body.classList.add("user-nav-locked");
    const prevBodyOverflow = bodyStyle.overflow;
    const prevHtmlOverflow = htmlStyle.overflow;
    bodyStyle.position = "fixed";
    bodyStyle.top = `-${scrollLockYRef.current}px`;
    bodyStyle.left = "0";
    bodyStyle.right = "0";
    bodyStyle.width = "100%";
    bodyStyle.overflow = "hidden";
    htmlStyle.overflow = "hidden";

    function preventBackgroundScroll(event: TouchEvent) {
      const sidebar = document.querySelector(".user-sidebar");
      if (sidebar?.contains(event.target as Node)) return;
      if (event.cancelable) event.preventDefault();
    }
    document.addEventListener("touchmove", preventBackgroundScroll, { passive: false });

    return () => {
      const scrollY = scrollLockYRef.current;
      document.documentElement.classList.remove("user-nav-locked");
      document.body.classList.remove("user-nav-locked");
      bodyStyle.removeProperty("position");
      bodyStyle.removeProperty("top");
      bodyStyle.removeProperty("left");
      bodyStyle.removeProperty("right");
      bodyStyle.removeProperty("width");
      bodyStyle.overflow = prevBodyOverflow;
      htmlStyle.overflow = prevHtmlOverflow;
      document.removeEventListener("touchmove", preventBackgroundScroll);
      window.scrollTo(0, scrollY);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    api<{ themeMode?: "light" | "dark"; primaryColor?: string; storeEnabled?: boolean; storeClosedMessage?: string }>("/api/settings/public").then((settings) => {
      document.documentElement.dataset.theme = settings.themeMode || "dark";
      applyThemeColor(settings.primaryColor);
      setStore({ open: settings.storeEnabled !== false, message: settings.storeClosedMessage || "" });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    api<{ authenticated: boolean; user: AuthUser | null }>("/api/auth/me")
      .then((result) => {
        if (!result.authenticated || !result.user) {
          // A session that ran out while the page was open is the session guard's to announce; it
          // keeps its notice up until the person signs in again.
          if (wasSignedIn.current) window.dispatchEvent(new Event(EXPIRED_EVENT));
          else window.location.href = "/";
          return;
        }
        wasSignedIn.current = true;
        if (!result.user.passwordEnabled && view !== "profile" && view !== "store") {
          window.location.href = "/profile?password_setup=required";
          return;
        }
        if (window.sessionStorage.getItem("nexora_vps_uptime_return") === "1") {
          window.sessionStorage.removeItem("nexora_vps_uptime_return");
          window.location.href = "/api/vps-uptime/start";
          return;
        }

        setMe(result.user);
        setLoading(false);
      })
      .catch(() => { if (!wasSignedIn.current) window.location.href = "/"; })
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => {
    if (!notice || notice.persistent) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // The notice was read from the URL already (socialNotice); clear it from the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("social") && !params.get("social_error") && params.get("password_setup") !== "required") return;
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }

  if (loading || !me) return <PageLoadingScreen label={userViewLoadingLabel[view] || "กำลังตรวจสอบบัญชี..."} />;

  return (
    <div className={`user-app-container ${mobileNavOpen ? "nav-open" : ""}`}>
      <div className="user-sidebar-overlay" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />

      <aside className="user-sidebar" aria-label="เมนูผู้ใช้">
        <div className="usb-head">
          <Link href="/dashboard" className="usb-brand">
            <img src="/logo-v2.png" alt="" />
            <span>NEXORA <b>CLOUD</b></span>
          </Link>
          <button type="button" className="usb-close" onClick={() => setMobileNavOpen(false)} aria-label="ปิดเมนู"><X size={20} /></button>
        </div>

        <div className="usb-scroll">
          <nav className="usb-nav">
            <p className="usb-nav-label">เมนูหลัก</p>
            <Link href="/dashboard" className={view === "overview" ? "active" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><LayoutDashboard size={18} /><span>ภาพรวม</span></Link>
            {(store.open || view === "store") && <Link href="/store" className={view === "store" ? "active" : ""} aria-current={view === "store" ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><Store size={18} /><span>ร้านค้า</span></Link>}
            <Link href="/hosting" className={view === "hosting" ? "active" : ""} aria-current={view === "hosting" ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><Cloud size={18} /><span>เว็บไซต์ของฉัน</span></Link>
            <Link href="/bots" className={view === "bots" ? "active" : ""} aria-current={view === "bots" ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><Bot size={18} /><span>บอท Discord</span></Link>
            <Link href="/files" className={view === "files" ? "active" : ""} aria-current={view === "files" ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><FolderOpen size={18} /><span>ไฟล์ของฉัน</span></Link>
            <Link href="/mail" className={view === "mail" ? "active" : ""} aria-current={view === "mail" ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><Mail size={18} /><span>อีเมล</span>{mailUnread > 0 && <b className="usb-mail-badge">{mailUnread > 99 ? "99+" : mailUnread}</b>}</Link>

            <p className="usb-nav-label">บัญชีและการเงิน</p>
            <Link href="/topups" className={view === "topups" ? "active" : ""} aria-current={view === "topups" ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><ReceiptText size={18} /><span>ประวัติเติมเงิน</span></Link>
            <Link href="/profile" className={view === "profile" ? "active" : ""} aria-current={view === "profile" ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><User size={18} /><span>บัญชีของฉัน</span></Link>
            {me.role !== "user" && <Link href="/admin" className="usb-admin" onClick={() => setMobileNavOpen(false)}><ShieldCheck size={18} /><span>ระบบแอดมิน</span></Link>}
          </nav>
        </div>

      </aside>

      <header className="user-topbar">
        <button type="button" className="utb-toggle" onClick={() => setMobileNavOpen(true)} aria-label="เปิดเมนู" aria-expanded={mobileNavOpen}><Menu size={20} /></button>

        {/* Breadcrumb / Page Title */}
        <div className="utb-breadcrumb">
          <span className="utb-bc-brand">NEXORA CLOUD</span>
          <span className="utb-bc-divider">/</span>
          <span className="utb-bc-current">
            {view === "overview" && "ภาพรวม"}
            {view === "store" && "ร้านค้าและแพ็กเกจ"}
            {view === "hosting" && "เว็บไซต์ของฉัน"}
            {view === "bots" && "บอท Discord"}
            {view === "files" && "ไฟล์ของฉัน"}
            {view === "topups" && "ประวัติพอยท์"}
            {view === "profile" && "บัญชีของฉัน"}
            {view === "mail" && "อีเมล"}
          </span>
        </div>

        <div className="utb-right">
          {/* Quick Balance Pill */}
          {store.open && <div className="utb-balance-pill">
            <div className="utb-balance-display" title="ยอดพอยท์คงเหลือ">
              <Coins size={15} className="utb-balance-icon" />
              <span className="utb-balance-val">{(me.points ?? 0).toLocaleString("th-TH")}</span>
              <span className="utb-balance-unit">พอยท์</span>
            </div>
            <button
              type="button"
              className="utb-balance-topup-btn"
              onClick={() => setShowTopupModal(true)}
              title="เติมเงินเข้าบัญชี"
            >
              <Plus size={13} />
              <span>เติมเงิน</span>
            </button>
          </div>}

          <div className="utb-account-menu" ref={accountRef}>
            <button
              type="button"
              className={`utb-user utb-trigger ${accountOpen ? "open" : ""}`}
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              onClick={() => setAccountOpen((open) => !open)}
            >
              <span className="utb-avatar">
                {me.avatarUrl
                  ? <SmartImage src={me.avatarUrl} alt="" compact fallback={<>{(me.displayName || me.username).slice(0, 1).toUpperCase()}</>} />
                  : (me.displayName || me.username).slice(0, 1).toUpperCase()}
              </span>
              <span className="utb-info">
                <strong>{me.displayName || me.username}</strong>
                <small>@{me.username}</small>
              </span>
              <ChevronDown size={15} className={`utb-chevron ${accountOpen ? "open" : ""}`} />
            </button>

            {accountOpen && (
              <div className="utb-dropdown" role="menu">
                <div className="utb-dropdown-user">
                  <span className="utb-avatar utb-avatar-lg">
                    {me.avatarUrl
                      ? <SmartImage src={me.avatarUrl} alt="" compact fallback={<>{(me.displayName || me.username).slice(0, 1).toUpperCase()}</>} />
                      : (me.displayName || me.username).slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <strong>{me.displayName || me.username}</strong>
                    <small>@{me.username}</small>
                    <span className="utb-role"><ShieldCheck size={12} /> {roleLabel[me.role]}</span>
                  </div>
                </div>

                <div className="utb-dropdown-divider" />

                <button type="button" className="utb-dropdown-logout" role="menuitem" onClick={() => { setAccountOpen(false); void logout(); }}>
                  <LogOut size={17} /> ออกจากระบบ
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="user-app-main">
        {view === "overview" && (() => {
          const setupSteps = [
            { done: me.passwordEnabled, label: "ตั้งรหัสผ่าน", hint: "สำรองไว้เข้าสู่ระบบ", href: "/profile?password_setup=required" },
            { done: Boolean(me.avatarUrl), label: "ใส่รูปโปรไฟล์", hint: "ให้คนในทีมจำได้", href: "/profile" },
            { done: dashStats.sitesCount > 0, label: "สร้างเว็บไซต์แรก", hint: "ได้ .nkn02.com พร้อม SSL", href: "/hosting" },
            { done: dashStats.filesCount > 0, label: "อัปโหลดไฟล์แรก", hint: "เก็บและแชร์ไฟล์", href: "/files" },
            { done: mailboxes.length > 0, label: "สร้างกล่องอีเมล", hint: "อีเมลชื่อของคุณเอง", href: "/mail" },
          ];
          const setupDone = setupSteps.filter((step) => step.done).length;
          const showSetup = dashStats.loaded && setupDone < setupSteps.length;
          return (
          <div className="ud">
            <header className="ud-hero">
              <div className="ud-hero-top">
                <div className="ud-who">
                  <span className="ud-avatar" aria-hidden="true">
                    {me.avatarUrl
                      ? <SmartImage src={me.avatarUrl} alt="" compact fallback={<>{(me.displayName || me.username).slice(0, 1).toUpperCase()}</>} />
                      : (me.displayName || me.username).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="ud-who-text">
                    <p className="ud-greet">{getTimeGreeting()}</p>
                    <h1>{me.displayName || me.username}</h1>
                    <p className="ud-handle">@{me.username} · {roleLabel[me.role]}</p>
                  </div>
                </div>
                <div className="ud-head-actions">
                  <Link href="/hosting" className="ud-btn"><Cloud size={16} aria-hidden="true" /> จัดการเว็บไซต์</Link>
                  {store.open && (
                    <button type="button" className="ud-btn ud-btn-primary" onClick={() => setShowTopupModal(true)}>
                      <Plus size={16} aria-hidden="true" /> เติมพอยท์
                    </button>
                  )}
                </div>
              </div>
              <div className="ud-stats">
                {store.open && (
                  <Link href="/topups" className="ud-stat">
                    <span className="ud-stat-label">พอยท์คงเหลือ</span>
                    <strong className="ud-stat-value">{(me.points ?? 0).toLocaleString("th-TH")}</strong>
                  </Link>
                )}
                <Link href="/hosting" className="ud-stat">
                  <span className="ud-stat-label">เว็บไซต์ออนไลน์</span>
                  <strong className="ud-stat-value">{dashStats.loaded ? <>{dashStats.runningSitesCount.toLocaleString("th-TH")}{dashStats.sitesCount > 0 && <small> / {dashStats.sitesCount.toLocaleString("th-TH")}</small>}</> : <i className="ud-skel" />}</strong>
                </Link>
                <Link href="/files" className="ud-stat">
                  <span className="ud-stat-label">พื้นที่ที่ใช้</span>
                  <strong className="ud-stat-value">{dashStats.loaded ? formatBytesCompact(dashStats.usedBytes) : <i className="ud-skel" />}</strong>
                </Link>
                <Link href="/files" className="ud-stat">
                  <span className="ud-stat-label">ไฟล์</span>
                  <strong className="ud-stat-value">{dashStats.loaded ? dashStats.filesCount.toLocaleString("th-TH") : <i className="ud-skel" />}</strong>
                </Link>
                <Link href="/mail" className="ud-stat">
                  <span className="ud-stat-label">อีเมลยังไม่อ่าน</span>
                  <strong className={`ud-stat-value${mailUnread > 0 ? " is-accent" : ""}`}>{mailUnread.toLocaleString("th-TH")}</strong>
                </Link>
              </div>
            </header>

            <div className="ov-marquee"><MarqueeAnnouncementQueue items={announcements} storeClosed={store.open ? null : store.message} storeClosedNote="สินค้าที่ซื้อแล้วยังดาวน์โหลดได้" /></div>

            {!me.passwordEnabled && (
              <div className="ud-alert" role="alert">
                <Lock size={17} aria-hidden="true" />
                <p><strong>ยังไม่ได้ตั้งรหัสผ่าน</strong> <span>ตั้งไว้สำรอง เผื่อเข้าสู่ระบบด้วย Social Login ไม่ได้</span></p>
                <Link href="/profile?password_setup=required">ตั้งรหัสผ่าน <ChevronRight size={15} aria-hidden="true" /></Link>
              </div>
            )}

            <nav className="ud-launch" aria-label="ทางลัด">
              <Link href="/hosting" className="ud-chip"><Cloud size={16} aria-hidden="true" />เว็บไซต์</Link>
              <a href="https://nove666.pro" target="_blank" rel="noopener noreferrer" className="ud-chip" title="phpMyAdmin"><Database size={16} aria-hidden="true" />ฐานข้อมูล<ArrowUpRight size={13} aria-hidden="true" /></a>
              <Link href="/files" className="ud-chip"><FolderOpen size={16} aria-hidden="true" />คลังไฟล์</Link>
              <Link href="/mail" className="ud-chip">
                <Mail size={16} aria-hidden="true" />อีเมล
                {mailUnread > 0 && <b className="ud-chip-badge">{mailUnread > 99 ? "99+" : mailUnread}</b>}
              </Link>
              {store.open && <Link href="/store" className="ud-chip"><Store size={16} aria-hidden="true" />ร้านค้า</Link>}
              <Link href="/profile" className="ud-chip"><User size={16} aria-hidden="true" />บัญชีของฉัน</Link>
            </nav>

            <div className="ud-main">
              <div className="ud-col">
                <section className="ud-panel" aria-labelledby="ud-sites-title">
                  <header className="ud-panel-head">
                    <h2 id="ud-sites-title"><Cloud size={17} aria-hidden="true" /> เว็บไซต์ของฉัน {dashStats.loaded && dashStats.sitesCount > 0 && <span className="ud-count">{dashStats.sitesCount.toLocaleString("th-TH")}</span>}</h2>
                    {dashStats.sitesCount > 0 && <Link href="/hosting" className="ud-more">ดูทั้งหมด <ChevronRight size={15} aria-hidden="true" /></Link>}
                  </header>
                  {!dashStats.loaded ? (
                    <ul className="ud-rows" aria-busy="true" aria-label="กำลังโหลด">
                      {[0, 1, 2].map((key) => <li key={key} className="ud-row is-skeleton"><i /><span><b /><b /></span></li>)}
                    </ul>
                  ) : dashStats.sites.length > 0 ? (
                    <ul className="ud-rows">
                      {dashStats.sites.map((site) => {
                        const domain = site.customDomain?.trim() || `${site.subdomain}.nkn02.com`;
                        return (
                          <li key={site.id} className="ud-row">
                            <i className={`ud-dot is-${site.status}`} aria-hidden="true" />
                            <Link href="/hosting" className="ud-row-main">
                              <strong>{site.name || site.subdomain}</strong>
                              <small>{domain}</small>
                            </Link>
                            <span className={`ud-status is-${site.status}`}>{siteStatusLabel[site.status] || site.status}</span>
                            {site.status === "running" && (
                              <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="ud-row-open" aria-label={`เปิด ${domain} ในแท็บใหม่`}>
                                <ExternalLink size={15} aria-hidden="true" />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="ud-empty">
                      <span className="ud-empty-icon" aria-hidden="true"><Cloud size={22} /></span>
                      <div>
                        <strong>ยังไม่มีเว็บไซต์</strong>
                        <p>สร้างเว็บไซต์แรกได้ในไม่กี่นาที ได้ที่อยู่ .nkn02.com พร้อม SSL</p>
                      </div>
                      <Link href="/hosting" className="ud-btn ud-btn-primary"><Plus size={16} aria-hidden="true" /> สร้างเว็บไซต์</Link>
                    </div>
                  )}
                </section>

                <section className="ud-panel" aria-labelledby="ud-files-title">
                  <header className="ud-panel-head">
                    <h2 id="ud-files-title"><FolderOpen size={17} aria-hidden="true" /> ไฟล์ล่าสุด</h2>
                    {dashStats.filesCount > 0 && <Link href="/files" className="ud-more">คลังไฟล์ <ChevronRight size={15} aria-hidden="true" /></Link>}
                  </header>
                  {!dashStats.loaded ? (
                    <ul className="ud-rows" aria-busy="true" aria-label="กำลังโหลด">
                      {[0, 1].map((key) => <li key={key} className="ud-row is-skeleton"><i /><span><b /><b /></span></li>)}
                    </ul>
                  ) : dashStats.recentFiles.length > 0 ? (
                    <ul className="ud-rows">
                      {dashStats.recentFiles.map((file) => {
                        const FileTypeIcon = fileTypeIcon(file.contentType, file.name);
                        return (
                          <li key={file.id} className="ud-row">
                            <span className="ud-file-icon" aria-hidden="true"><FileTypeIcon size={17} /></span>
                            <Link href="/files" className="ud-row-main">
                              <strong>{file.name}</strong>
                              <small>{formatBytesCompact(file.size)}</small>
                            </Link>
                            <time className="ud-row-time" dateTime={file.createdAt}>{formatShortDate(file.createdAt)}</time>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="ud-empty">
                      <span className="ud-empty-icon" aria-hidden="true"><Upload size={22} /></span>
                      <div>
                        <strong>ยังไม่มีไฟล์</strong>
                        <p>อัปโหลดไฟล์เก็บไว้ แล้วแชร์เป็นลิงก์ให้คนอื่นได้</p>
                      </div>
                      <Link href="/files" className="ud-btn"><Upload size={16} aria-hidden="true" /> อัปโหลดไฟล์</Link>
                    </div>
                  )}
                </section>
                <section className="ud-panel" aria-labelledby="ud-mail-title">
                  <header className="ud-panel-head">
                    <h2 id="ud-mail-title"><Mail size={17} aria-hidden="true" /> อีเมลของฉัน</h2>
                    <Link href="/mail" className="ud-more">เปิดกล่องจดหมาย <ChevronRight size={15} aria-hidden="true" /></Link>
                  </header>
                  {mailboxes.length > 0 ? (
                    <ul className="ud-boxes">
                      {mailboxes.slice(0, 4).map((box) => {
                        const percent = box.quotaBytes > 0 ? Math.min(100, (box.usedBytes / box.quotaBytes) * 100) : 0;
                        return (
                          <li key={box.id}>
                            <Link href="/mail">
                              <span className="ud-box-line">
                                <strong>{box.address}</strong>
                                {box.unread > 0 && <b className="ud-box-unread">{box.unread > 99 ? "99+" : box.unread}</b>}
                              </span>
                              {box.quotaBytes > 0 && (
                                <span className="ud-box-quota">
                                  <span className="ud-meter"><span style={{ width: `${percent}%` }} /></span>
                                  <small>{formatBytesCompact(box.usedBytes)} / {formatBytesCompact(box.quotaBytes)}</small>
                                </span>
                              )}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="ud-panel-note">ยังไม่มีกล่องอีเมล · <Link href="/mail">สร้างกล่องแรก</Link></p>
                  )}
                </section>

              </div>

              <aside className="ud-col">
                {showSetup && (
                  <section className="ud-panel ud-setup" aria-labelledby="ud-setup-title">
                    <header className="ud-panel-head">
                      <h2 id="ud-setup-title">เริ่มต้นใช้งาน</h2>
                      <span className="ud-setup-count">{setupDone}/{setupSteps.length}</span>
                    </header>
                    <div className="ud-progress" role="progressbar" aria-valuemin={0} aria-valuemax={setupSteps.length} aria-valuenow={setupDone} aria-label="ความคืบหน้า">
                      <span style={{ width: `${(setupDone / setupSteps.length) * 100}%` }} />
                    </div>
                    <ul className="ud-steps">
                      {setupSteps.filter((step) => !step.done).map((step) => (
                        <li key={step.label}>
                          <a href={step.href} className="ud-step">
                            <Circle size={18} aria-hidden="true" />
                            <span><strong>{step.label}</strong><small>{step.hint}</small></span>
                            <ChevronRight size={15} className="ud-step-arrow" aria-hidden="true" />
                          </a>
                        </li>
                      ))}
                    </ul>
                    {setupDone > 0 && (
                      <details className="ud-done">
                        <summary><CircleCheck size={16} aria-hidden="true" />เสร็จแล้ว {setupDone} ขั้นตอน<ChevronDown size={15} className="ud-done-chevron" aria-hidden="true" /></summary>
                        <ul>
                          {setupSteps.filter((step) => step.done).map((step) => <li key={step.label}>{step.label}</li>)}
                        </ul>
                      </details>
                    )}
                  </section>
                )}

                {store.open && (
                  <section className="ud-panel ud-wallet" aria-labelledby="ud-wallet-title">
                    <header className="ud-panel-head">
                      <h2 id="ud-wallet-title"><Coins size={17} aria-hidden="true" /> เติมเงินล่าสุด</h2>
                      <Link href="/topups" className="ud-more">ประวัติ <ChevronRight size={15} aria-hidden="true" /></Link>
                    </header>
                    {dashStats.recentTopups.length > 0 ? (
                      <ul className="ud-tx">
                        {dashStats.recentTopups.slice(0, 3).map((item) => {
                          const isSuccess = item.status === "completed" || item.status === "approved";
                          const isPending = item.status === "pending";
                          return (
                            <li key={item.id}>
                              <span>
                                <strong>+{(item.amount ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</strong>
                                <small>{formatDate(item.createdAt)}</small>
                              </span>
                              <em className={isSuccess ? "is-ok" : isPending ? "is-pending" : "is-failed"}>{isSuccess ? "สำเร็จ" : isPending ? "รอตรวจสอบ" : "ไม่สำเร็จ"}</em>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="ud-panel-note">ยังไม่มีรายการเติมเงิน</p>
                    )}
                  </section>
                )}

                {dashStats.loaded && !showSetup && <section className="ud-panel" aria-labelledby="ud-account-title">
                  <header className="ud-panel-head">
                    <h2 id="ud-account-title"><ShieldCheck size={17} aria-hidden="true" /> ความปลอดภัย</h2>
                    <Link href="/profile" className="ud-more">จัดการ <ChevronRight size={15} aria-hidden="true" /></Link>
                  </header>
                  <dl className="ud-facts">
                    <div>
                      <dt><KeyRound size={16} aria-hidden="true" /> รหัสผ่าน</dt>
                      <dd className={me.passwordEnabled ? "is-ok" : "is-warn"}>{me.passwordEnabled ? "ตั้งแล้ว" : "ยังไม่ตั้ง"}</dd>
                    </div>
                    <div>
                      <dt><User size={16} aria-hidden="true" /> สถานะบัญชี</dt>
                      <dd className={!me.status || me.status === "active" ? "is-ok" : "is-warn"}>{!me.status || me.status === "active" ? "ใช้งานปกติ" : me.status}</dd>
                    </div>
                  </dl>
                </section>}
              </aside>
            </div>
          </div>
          );
        })()}
        {view === "hosting" && <HostingView me={me} notify={setNotice} ask={setConfirmRequest} />}
        {view === "bots" && <BotsView notify={setNotice} ask={setConfirmRequest} />}
        {view === "files" && <FileLibraryView />}
        {view === "mail" && <MailView notify={setNotice} />}
        {view === "topups" && (
          <>
            <div className="ov-marquee user-page-ticker"><MarqueeAnnouncementQueue items={announcements} storeClosed={store.open ? null : store.message} storeClosedNote="ดูประวัติย้อนหลังได้ตามปกติ" /></div>
            <UserTopupHistoryView onTopup={store.open ? () => setShowTopupModal(true) : undefined} refreshKey={topupRevision} />
          </>
        )}
        {view === "profile" && <UserProfileView me={me} setMe={setMe} notify={setNotice} ask={setConfirmRequest} />}
        {view === "store" && <GamingStore mode="store" embedded />}
      </main>

      {/* Topup Modal */}
      {showTopupModal && store.open && (
        <TopupModal
          onClose={() => setShowTopupModal(false)}
          onSuccess={(newPoints, amount) => {
            setShowTopupModal(false);
            broadcastPoints(newPoints);
            setTopupRevision((value) => value + 1);
            setNotice({ kind: "success", title: "เติมเงินสำเร็จ", text: `ได้รับ ${amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} Points ยอดคงเหลือ ${newPoints.toLocaleString("th-TH")} Points`, persistent: true });
          }}
          onError={({ title, text }) => {
            setShowTopupModal(false);
            setNotice({ kind: "error", title, text, persistent: true });
          }}
          apiBase={API_BASE}
        />
      )}

      {notice && <UserFeedbackToast notice={notice} onClose={() => setNotice(null)} />}
      <SessionGuard />
      {confirmRequest && <UserConfirmDialog request={confirmRequest} busy={confirmBusy} onClose={() => setConfirmRequest(null)} onConfirm={async () => {
        setConfirmBusy(true);
        try { await confirmRequest.action(); setConfirmRequest(null); }
        catch (error) { setConfirmRequest(null); setNotice({ kind: "error", text: (error as Error).message || "ทำรายการไม่สำเร็จ" }); }
        finally { setConfirmBusy(false); }
      }} />}
    </div>
  );
}

type PointsHistoryItem = { kind: "topup" | "purchase" | "refund"; id: number; amount: number; status: string; title: string; ref: string; at: string };
type PointsHistoryResponse = {
  items: PointsHistoryItem[];
  page: number;
  perPage: number;
  total: number;
  summary: { balance: number; topupTotal: number; topupMonth: number; spentTotal: number; refundTotal: number };
};
type PointsFilter = "all" | "topup" | "spend";

const pointsFilters: { key: PointsFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "topup", label: "เติมเงิน" },
  { key: "spend", label: "ใช้พอยท์" },
];

function UserTopupHistoryView({ onTopup, refreshKey }: { onTopup?: () => void; refreshKey: number }) {
  const [result, setResult] = useState<PointsHistoryResponse | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<PointsFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [historyError, setHistoryError] = useState("");
  // "ลองอีกครั้ง" bumps this to load the same page again.
  const [attempt, setAttempt] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const historyKey = `${filter}:${page}:${refreshKey}:${attempt}`;
  const loadingHistory = loadedKey !== historyKey;
  const historyUrl = `/api/store/points-history?type=${filter}&page=${page}&perPage=10`;

  useEffect(() => {
    let current = true;
    api<PointsHistoryResponse>(historyUrl)
      .then((next) => { if (current) { setResult(next); setHistoryError(""); } })
      .catch((error) => { if (current) setHistoryError((error as Error).message || "โหลดประวัติพอยท์ไม่สำเร็จ"); })
      .finally(() => { if (current) setLoadedKey(historyKey); });
    return () => { current = false; };
  }, [historyUrl, historyKey]);

  // The refresh button keeps the list on screen while it reloads.
  async function refreshHistory() {
    setRefreshing(true);
    try {
      setResult(await api<PointsHistoryResponse>(historyUrl));
      setHistoryError("");
    } catch (error) {
      setHistoryError((error as Error).message || "โหลดประวัติพอยท์ไม่สำเร็จ");
    } finally {
      setRefreshing(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / (result?.perPage || 10)));
  const money = (value: number) => Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const topupLabel = (status: string) => status === "completed" ? "เติมเงินสำเร็จ" : status === "pending" ? "เติมเงินกำลังตรวจสอบ" : "เติมเงินไม่สำเร็จ";
  const tone = (item: PointsHistoryItem) => item.kind === "purchase" ? "spend" : item.kind === "refund" ? "ok" : item.status === "completed" ? "ok" : item.status === "pending" ? "wait" : "fail";
  const emptyText = filter === "spend"
    ? { title: "ยังไม่เคยใช้พอยท์", body: "เมื่อซื้อสินค้าในร้านค้า รายการจะแสดงที่นี่" }
    : { title: "ยังไม่มีประวัติพอยท์", body: "เมื่อคุณเติมเงินหรือซื้อสินค้า รายการจะแสดงที่นี่" };

  return <div className="user-topup-history">
    <header className="uth-heading">
      <div className="uth-heading-copy">
        <h1>ประวัติพอยท์</h1>
      </div>
      <div className="uth-heading-actions">
        <button type="button" className="uth-icon-btn" onClick={() => void refreshHistory()} disabled={refreshing} aria-label="รีเฟรชประวัติ" title="รีเฟรช"><RefreshCw size={19} className={refreshing ? "topup-spinner" : ""} /></button>
        {onTopup && <button type="button" className="uth-cta" onClick={onTopup}><Zap size={18} /> เติมเงิน</button>}
      </div>
    </header>

    <section className="uth-wallet" aria-label="สรุปพอยท์">
      <div className="uth-wallet-primary">
        <span className="uth-wallet-label"><Coins size={15} aria-hidden="true" /> พอยท์คงเหลือ</span>
        <p className="uth-wallet-figure"><strong>{money(result?.summary.balance || 0)}</strong><small>Points</small></p>
      </div>
      <dl className="uth-wallet-secondary">
        <div>
          <dt>เติมทั้งหมด</dt>
          <dd>{money(result?.summary.topupTotal || 0)} <small>Points</small></dd>
        </div>
        <div>
          <dt>ใช้ซื้อสินค้า</dt>
          <dd>{money(result?.summary.spentTotal || 0)} <small>Points</small></dd>
        </div>
      </dl>
    </section>

    <section className="uth-feed" aria-busy={loadingHistory}>
      <div className="uth-feed-head">
        <h2>รายการล่าสุด</h2>
        <div className="uth-filter" role="tablist" aria-label="ประเภทรายการ">
          {pointsFilters.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} className={filter === item.key ? "selected" : ""} onClick={() => { setFilter(item.key); setPage(1); }}>{item.label}</button>
          ))}
        </div>
      </div>

      {historyError && !loadingHistory ? <div className="uth-message error"><Info size={26} /><strong>โหลดข้อมูลไม่สำเร็จ</strong><span>{historyError}</span><button type="button" className="uth-ghost-btn" onClick={() => setAttempt((value) => value + 1)}>ลองอีกครั้ง</button></div>
        : loadingHistory ? <div className="uth-message"><RefreshCw className="topup-spinner" size={26} /><span>กำลังโหลดรายการ</span></div>
        : !result?.items.length ? <div className="uth-message empty"><ReceiptText size={34} /><strong>{emptyText.title}</strong><span>{emptyText.body}</span>{!onTopup ? null : filter === "spend" ? <Link className="uth-cta" href="/store"><Store size={18} /> ไปที่ร้านค้า</Link> : <button type="button" className="uth-cta" onClick={onTopup}><Zap size={18} /> เติมเงินครั้งแรก</button>}</div>
        : <ul className="uth-items">{result.items.map((item) => <li className="uth-item" key={`${item.kind}-${item.id}`}>
          <span className={`uth-item-mark ${tone(item)}`} aria-hidden="true">
            {item.kind === "purchase" ? <ShoppingCart size={17} /> : item.kind === "refund" ? <Undo2 size={17} /> : item.status === "completed" ? <Check size={17} /> : item.status === "pending" ? <Clock3 size={17} /> : <X size={17} />}
          </span>
          <div className="uth-item-body">
            <div className="uth-item-line">
              <strong>{item.kind === "purchase" ? `ซื้อ ${item.title}` : item.kind === "refund" ? `คืนพอยท์ ${item.title}` : topupLabel(item.status)}</strong>
              <span className={`uth-item-amount ${tone(item)}`}>{item.amount < 0 ? "−" : "+"}{money(Math.abs(item.amount))}</span>
            </div>
            <div className="uth-item-line meta">
              <span>{formatDate(item.at)} · {item.kind === "topup" ? "เติมเงิน" : "คำสั่งซื้อ"} #{item.id}</span>
              <span>Points</span>
            </div>
            {item.kind === "refund" && item.ref && <p className="uth-item-note">เหตุผล: {item.ref}</p>}
            {item.kind === "topup" && item.ref && <code className="uth-item-ref" title={item.ref}>{item.ref}</code>}
          </div>
        </li>)}</ul>}

      {(result?.total || 0) > (result?.perPage || 10) && <footer className="uth-pagination">
        <span>หน้า {page.toLocaleString("th-TH")} จาก {totalPages.toLocaleString("th-TH")}</span>
        <div>
          <button type="button" className="uth-ghost-btn" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}><ChevronLeft size={17} /> ก่อนหน้า</button>
          <button type="button" className="uth-ghost-btn" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>ถัดไป <ChevronRight size={17} /></button>
        </div>
      </footer>}
    </section>
  </div>;
}

function UserProfileView({ me, setMe, notify, ask }: { me: AuthUser; setMe: (user: AuthUser) => void; notify: (notice: { kind: "success" | "error"; text: string }) => void; ask: (request: ConfirmRequest) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [social, setSocial] = useState<SocialAccount[]>([]);
  const [socialPolicy, setSocialPolicy] = useState<SocialPolicy>({ canConnect: false, remainingToday: 0 });
  const socialAvailable = useSocialAvailability();
  const [now, setNow] = useState(() => Date.now());
  const [form, setForm] = useState({ displayName: me.displayName || "", email: me.email || "" });
  
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(!me.passwordEnabled);
  const [passwordWasEnabled, setPasswordWasEnabled] = useState(me.passwordEnabled);
  if (passwordWasEnabled !== me.passwordEnabled) {
    setPasswordWasEnabled(me.passwordEnabled);
    if (!me.passwordEnabled) setShowPasswordModal(true);
  }
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  const load = useCallback(() => Promise.all([
    api<{ items: Session[] }>("/api/profile/sessions").then((x) => setSessions(x?.items || [])),
    api<{ items: SocialAccount[]; policy: SocialPolicy }>("/api/profile/social").then((x) => { setSocial(x?.items || []); setSocialPolicy(x?.policy || { canConnect: false, remainingToday: 0 }); }),
  ]), []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const [pwErrors, setPwErrors] = useState<{ currentPassword?: string; newPassword?: string; confirmPassword?: string }>({});

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!form.displayName.trim()) return notify({ kind: "error", text: "โปรดกรอกชื่อที่แสดง" });
    try {
      const result = await api<{ user: AuthUser }>("/api/profile/", { method: "PATCH", body: JSON.stringify(form) });
      setMe(result.user); notify({ kind: "success", text: "บันทึกโปรไฟล์แล้ว" });
      setShowProfileModal(false);
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = data.get("currentPassword") as string || "";
    const newPassword = data.get("newPassword") as string || "";
    const confirmPassword = data.get("confirmPassword") as string || "";
    const wasPasswordEnabled = me.passwordEnabled;

    const errors: { currentPassword?: string; newPassword?: string; confirmPassword?: string } = {};
    if (wasPasswordEnabled && !currentPassword) {
      errors.currentPassword = "โปรดกรอกรหัสผ่านปัจจุบัน";
    }
    if (!newPassword) {
      errors.newPassword = "โปรดกรอกรหัสผ่านใหม่";
    } else if (hasNonAscii(newPassword)) {
      errors.newPassword = "รหัสผ่านใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และสัญลักษณ์";
    } else if (Array.from(newPassword).length < 8) {
      errors.newPassword = "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร";
    }
    if (!confirmPassword) {
      errors.confirmPassword = "โปรดกรอกยืนยันรหัสผ่านใหม่";
    } else if (confirmPassword !== newPassword) {
      errors.confirmPassword = "รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน";
    }

    setPwErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      await api("/api/profile/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      setPwErrors({});
      setShowPasswordModal(false);
      setMe({ ...me, passwordEnabled: true });
      await load();
      notify({
        kind: "success",
        text: wasPasswordEnabled
          ? "เปลี่ยนรหัสผ่านแล้ว"
          : "ตั้งรหัสผ่านเรียบร้อยแล้ว คุณสามารถใช้งานระบบต่อได้",
      });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message || "ไม่สามารถตั้งรหัสผ่านได้" });
    }
  }

  async function revokeSession(id: number) {
    try { await api(`/api/profile/sessions/${id}`, { method: "DELETE" }); await load(); notify({ kind: "success", text: "ยกเลิก Session แล้ว" }); }
    catch (error) { notify({ kind: "error", text: (error as Error).message }); }
  }

  return (
    <div className="user-profile-layout">
      <div className="user-profile-header">
        <h1>โปรไฟล์ของฉัน</h1>
        <p>จัดการข้อมูลส่วนตัวและความปลอดภัยของบัญชีคุณ</p>
      </div>

      <div className="user-profile-grid">
        {/* Personal Info Card */}
        <div className="user-premium-card upc-profile-card">
          <div className="upc-body">
            <div className="upc-profile-hero">
              <div className="upc-profile-avatar" aria-hidden="true">
                {me.avatarUrl ? (
                  <SmartImage src={me.avatarUrl} alt="" compact fallback={<span className="upc-profile-initial">{(me.username[0] || "").toUpperCase()}</span>} />
                ) : (
                  <span className="upc-profile-initial">{(me.username[0] || "").toUpperCase()}</span>
                )}
              </div>
              <div className="upc-profile-identity">
                <h3>{me.displayName || me.username}</h3>
                <p>@{me.username}</p>
                <span className="upc-profile-role">{roleLabel[me.role]}</span>
              </div>
            </div>

            <div className="upc-profile-stat" aria-label={`ยอดคงเหลือ ${(me.points ?? 0).toLocaleString("th-TH")} พอย`}>
              <span className="upc-profile-stat-label">ยอดคงเหลือ</span>
              <span className="upc-profile-stat-value">
                <strong>{(me.points ?? 0).toLocaleString("th-TH")}</strong>
                <small>พอย</small>
              </span>
            </div>

            <div className="upc-profile-menu">
              <button type="button" className="upc-profile-menu-item" onClick={() => setShowProfileModal(true)}>
                <User size={18} />
                <span>แก้ไขข้อมูล</span>
                <ChevronRight size={16} />
              </button>
              <button type="button" className="upc-profile-menu-item" onClick={() => setShowPasswordModal(true)}>
                <KeyRound size={18} />
                <span>เปลี่ยนรหัสผ่าน</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Social Accounts */}
        <div className="user-premium-card">
          <div className="upc-header">
            <Globe size={22} className="upc-icon" />
            <h2>บัญชีเชื่อมต่อ</h2>
          </div>
          <div className="upc-body">
            <div className={`social-policy-note ${socialPolicy?.canConnect ? "ready" : "waiting"}`}>
              <Clock3 size={17} />
              <span>{!me.passwordEnabled
                ? "กรุณาตั้งรหัสผ่านก่อนเชื่อมบัญชีเพิ่มเติม"
                : socialPolicy?.canConnect
                  ? `วันนี้เปลี่ยนหรือเชื่อมบัญชีได้อีก ${socialPolicy?.remainingToday ?? 0} ครั้ง`
                  : socialPolicy?.code === "social_daily_limit"
                    ? `ใช้ครบ 3 ครั้งแล้ว เชื่อมได้อีกครั้งใน ${formatRemaining(socialPolicy?.availableAt, now)}`
                    : `เชื่อมบัญชีอื่นได้อีกครั้งใน ${formatRemaining(socialPolicy?.availableAt, now)}`}</span>
            </div>
            <div className="social-connections-list">
              {(["discord", "google", "github"] as const).map((provider) => {
                const connected = social.find((item) => item.provider === provider);
                const pendingDisconnect = connected?.disconnectScheduledFor;
                const connectDisabled = !me.passwordEnabled || !socialPolicy?.canConnect;
                // Switched off by an admin: say so instead of letting the connect flow fail.
                const providerOff = socialAvailable[provider] === false;
                return (
                  <div key={provider} className="scl-item">
                    <div className="scl-info">
                      <span className={`scl-provider-icon ${provider}`}>
                        {provider === "google" ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                          </svg>
                        ) : provider === "github" ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                          </svg>
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                          </svg>
                        )}
                      </span>
                      <div>
                        <strong>{socialNames[provider]}</strong>
                        <span>{pendingDisconnect
                          ? `รอยกเลิก เหลือ ${formatRemaining(pendingDisconnect, now)}`
                          : connected ? connected.email || "เชื่อมต่อแล้ว" : providerOff ? "ระบบยังไม่เปิดให้เชื่อม" : "ยังไม่ได้เชื่อมต่อ"}</span>
                      </div>
                    </div>
                    {pendingDisconnect ? (
                      <button className="btn-glass scl-action" onClick={async () => {
                        try {
                          await api(`/api/profile/social/${provider}/disconnect/cancel`, { method: "POST" });
                          await load();
                          notify({ kind: "success", text: `ยกเลิกคำขอตัดการเชื่อม ${socialNames[provider]} แล้ว` });
                        } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
                      }}>ยกเลิกคำขอ</button>
                    ) : connected ? (
                      <button className="btn-outline scl-action" onClick={() => ask({
                        title: `ขอยกเลิกการเชื่อม ${socialNames[provider]}?`,
                        message: "ระบบจะรอ 48 ชั่วโมงก่อนยกเลิกจริง ระหว่างนี้คุณยังใช้บัญชีนี้เข้าสู่ระบบได้ และสามารถยกเลิกคำขอได้ตลอดเวลา",
                        confirmLabel: "ยืนยันคำขอ",
                        danger: true,
                        action: async () => {
                          await api(`/api/profile/social/${provider}`, { method: "DELETE" });
                          await load();
                          notify({ kind: "success", text: "รับคำขอแล้ว ระบบจะยกเลิกการเชื่อมภายใน 48 ชั่วโมง" });
                        },
                      })}>ขอยกเลิก</button>
                    ) : (
                      providerOff ? (
                        <button type="button" className="btn-outline scl-action" disabled title={`ผู้ดูแลยังไม่เปิดการเชื่อมด้วย ${socialNames[provider]}`}>ยังไม่เปิดใช้</button>
                      ) : (
                        <SocialOAuthButton
                          provider={provider}
                          mode="connect"
                          className="btn-outline scl-action"
                          disabled={connectDisabled}
                          title={connectDisabled ? "ยังไม่สามารถเชื่อมบัญชีเพิ่มได้" : `เชื่อมต่อ ${socialNames[provider]}`}
                        >เชื่อมต่อ</SocialOAuthButton>
                      )
                    )
                    }
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Active Sessions */}
        <div className="user-premium-card sessions-card">
          <div className="upc-header">
            <Monitor size={22} className="upc-icon" />
            <h2>อุปกรณ์ที่เข้าสู่ระบบ</h2>
          </div>
          <div className="upc-body">
             <div className="user-session-list">
              {sessions.map((session) => {
                const ua = parseUserAgent(session.userAgent);
                const Icon = ua.icon;
                return (
                  <div key={session.id} className="usl-item">
                    <div className="usl-main">
                      <div className="usl-icon"><Icon size={20} /></div>
                      <div className="usl-details">
                        <div className="usl-title-row">
                          <strong>{ua.browser} · {ua.os}</strong>
                          {session.current && <span className="usl-current">เครื่องนี้</span>}
                        </div>
                        <span className="usl-meta">{session.ipAddress}</span>
                        <span className="usl-meta">ใช้งานล่าสุด {formatDate(session.lastSeenAt)}</span>
                      </div>
                    </div>
                    {!session.current && (
                      <button type="button" className="btn-danger-outline usl-logout" onClick={() => ask({ title: "ออกจากระบบบนอุปกรณ์นี้?", message: "อุปกรณ์นี้จะต้องเข้าสู่ระบบใหม่", confirmLabel: "ออกจากระบบ", danger: true, action: () => revokeSession(session.id) })}>
                        <LogOut size={16} /> ออกจากระบบ
                      </button>
                    )}
                  </div>
                );
              })}
             </div>
          </div>
        </div>
      </div>

      {showProfileModal && typeof document !== "undefined" && createPortal(
        <div className="system-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowProfileModal(false)}>
          <section className="system-dialog glass-card profile-edit-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="system-dialog-close" onClick={() => setShowProfileModal(false)} aria-label="ปิด"><X size={17} /></button>
            <form className="form-card profile-dialog-form" onSubmit={saveProfile} noValidate>
              <div className="card-title profile-modal-title">
                <User size={19} />
                <div>
                  <h2>แก้ไขข้อมูลส่วนตัว</h2>
                  <p>อัปเดตชื่อที่แสดงและอีเมลของคุณ</p>
                </div>
              </div>
              <label>
                ชื่อที่แสดง (Display Name)
                <input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required />
              </label>
              <label>
                <span>อีเมล <small>(ไม่บังคับ)</small></span>
                <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@example.com" />
              </label>
              <div className="system-dialog-actions profile-modal-actions">
                <button type="button" onClick={() => setShowProfileModal(false)}>ยกเลิก</button>
                <button type="submit" className="dash-primary">บันทึก</button>
              </div>
            </form>
          </section>
        </div>,
        document.body
      )}

      {showPasswordModal && typeof document !== "undefined" && createPortal(
        <div className="system-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (me.passwordEnabled && event.target === event.currentTarget) setShowPasswordModal(false);
        }}>
          <section className={`system-dialog glass-card profile-edit-dialog password-dialog ${!me.passwordEnabled ? "required" : ""}`} role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onClick={(event) => event.stopPropagation()}>
            {me.passwordEnabled && (
              <button type="button" className="system-dialog-close" onClick={() => setShowPasswordModal(false)} aria-label="ปิด"><X size={17} /></button>
            )}
            <form className="form-card profile-dialog-form" onSubmit={submitPassword} noValidate>
              <div className="card-title profile-modal-title">
                <KeyRound size={19} />
                <div>
                  <h2 id="password-dialog-title">{me.passwordEnabled ? "เปลี่ยนรหัสผ่าน" : "กรุณาตั้งรหัสผ่านก่อนใช้งาน"}</h2>
                  <p>{me.passwordEnabled ? "แนะนำให้ตั้งรหัสผ่านที่คาดเดายาก" : "ตั้งรหัสผ่านเพื่อเริ่มใช้งานระบบ"}</p>
                </div>
              </div>
              {me.passwordEnabled && (
                <label>
                  รหัสผ่านปัจจุบัน
                  <div className={`pw-input-wrap ${pwErrors.currentPassword ? "has-error" : ""}`}>
                    <input type={showCurrentPass ? "text" : "password"} name="currentPassword" autoComplete="current-password" {...asciiInputProps({ onValueChange: () => setPwErrors((prev) => ({ ...prev, currentPassword: undefined })) })} />
                    <button type="button" className="pw-eye-btn" onClick={() => setShowCurrentPass(!showCurrentPass)} tabIndex={-1} aria-label={showCurrentPass ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
                      {showCurrentPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {pwErrors.currentPassword && <span className="pw-field-error">{pwErrors.currentPassword}</span>}
                </label>
              )}
              <label>
                รหัสผ่านใหม่
                <div className={`pw-input-wrap ${pwErrors.newPassword ? "has-error" : ""}`}>
                  <input type={showNewPass ? "text" : "password"} name="newPassword" minLength={8} maxLength={128} autoComplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร (ภาษาอังกฤษ)" autoFocus={!me.passwordEnabled} {...asciiInputProps({ onValueChange: () => setPwErrors((prev) => ({ ...prev, newPassword: undefined })) })} />
                  <button type="button" className="pw-eye-btn" onClick={() => setShowNewPass(!showNewPass)} tabIndex={-1} aria-label={showNewPass ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
                    {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {pwErrors.newPassword && <span className="pw-field-error">{pwErrors.newPassword}</span>}
              </label>
              <label>
                ยืนยันรหัสผ่านใหม่
                <div className={`pw-input-wrap ${pwErrors.confirmPassword ? "has-error" : ""}`}>
                  <input type={showConfirmPass ? "text" : "password"} name="confirmPassword" minLength={8} maxLength={128} autoComplete="new-password" placeholder="กรอกรหัสผ่านใหม่อีกครั้ง" {...asciiInputProps({ onValueChange: () => setPwErrors((prev) => ({ ...prev, confirmPassword: undefined })) })} />
                  <button type="button" className="pw-eye-btn" onClick={() => setShowConfirmPass(!showConfirmPass)} tabIndex={-1} aria-label={showConfirmPass ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
                    {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {pwErrors.confirmPassword && <span className="pw-field-error">{pwErrors.confirmPassword}</span>}
              </label>
              <div className="system-dialog-actions profile-modal-actions">
                {me.passwordEnabled && <button type="button" onClick={() => setShowPasswordModal(false)}>ยกเลิก</button>}
                <button type="submit" className="dash-primary">{me.passwordEnabled ? "เปลี่ยนรหัสผ่าน" : "ตั้งรหัสผ่านและใช้งานต่อ"}</button>
              </div>
            </form>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
