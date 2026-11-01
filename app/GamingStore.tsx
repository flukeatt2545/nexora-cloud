"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import SmartImage from "./components/SmartImage";
import NoCoverArt from "./components/NoCoverArt";
import { coverCropStyle, type CoverCrop } from "./lib/coverCrop";
import { ArrowRight, ArrowUpDown, Bell, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Cloud, Eye, EyeOff, FolderOpen, Info, LayoutDashboard, LockKeyhole, Search, ShieldCheck, UserRound, X, Zap, TriangleAlert, Star, Heart, Gift, CheckCircle, Megaphone, Ban, ShoppingCart, Store } from "lucide-react";
import { applyThemeColor } from "./themeColor";
import StoreClosedNotice, { STORE_CLOSED_DETAIL, STORE_CLOSED_TITLE, storeIsOpen } from "./components/StoreClosedNotice";
import SystemNotice, { type SystemNoticeData } from "./components/SystemNotice";
import { PageLoadingScreen } from "./components/PageLoadingScreen";
import SocialOAuthButton from "./SocialOAuthButton";
import { asciiInputProps, hasNonAscii, latinAlphanumericInputProps } from "./lib/asciiInput";
import SiteNavbar, { SESSION_EVENT } from "./components/SiteNavbar";
import { getDocumentTitle, type SiteTitleMode } from "./pageTitle";
import { API_BASE } from "./runtime";
import { takeReturnPath } from "./components/SessionGuard";
import { OwnedPurchaseList, POINTS_EVENT, PurchaseDialog, broadcastPoints, formatPointAmount, type OwnedPurchase } from "./components/StorePurchase";
import { richTextToPlain } from "./lib/safeHtml";
import Link from "next/link";

const MARQUEE_ICONS: Record<string, React.ElementType> = {
  Megaphone, Bell, TriangleAlert, Info, Zap, Star, Heart, ShieldCheck, CheckCircle, Gift, Store
};

type AuthMode = "login" | "register";
type NoticeKind = "success" | "error" | "info";
type Notice = { id: number; kind: NoticeKind; message: string; title?: string };

const OAUTH_PROVIDER_NAMES: Record<string, string> = { discord: "Discord", google: "Google", github: "GitHub" };

/** What the sign-in callback put in the address bar after a failed social sign-in, as a notice. */
function oauthErrorNotice(params: URLSearchParams): Omit<Notice, "id"> | null {
  const code = params.get("auth_error");
  if (!code) return null;
  const provider = OAUTH_PROVIDER_NAMES[params.get("provider") || ""] || "บัญชี Social";
  const title = "เข้าสู่ระบบไม่สำเร็จ";
  switch (code) {
    case "registration_disabled":
      return { kind: "error", title, message: `บัญชี ${provider} นี้ยังไม่ได้สมัครสมาชิก\nตอนนี้ปิดรับสมัครอยู่` };
    case "account_link_required":
      return { kind: "error", title, message: `อีเมลนี้มีบัญชีอยู่แล้ว\nเข้าสู่ระบบด้วยรหัสผ่าน แล้วเชื่อม ${provider} ที่หน้าโปรไฟล์` };
    case "account_suspended":
      return { kind: "error", title, message: "บัญชีนี้ถูกระงับการใช้งาน\nติดต่อผู้ดูแลหากคิดว่าผิดพลาด" };
    case "oauth_cancelled":
      return { kind: "info", message: `ยกเลิกการเข้าสู่ระบบด้วย ${provider} แล้ว` };
    case "oauth_state":
      return { kind: "error", title, message: "ลิงก์หมดอายุหรือถูกใช้ไปแล้ว\nกดเข้าสู่ระบบใหม่อีกครั้ง" };
    case "oauth_exchange":
      return { kind: "error", title, message: `เชื่อมต่อ ${provider} ไม่สำเร็จ\nลองใหม่อีกครั้ง` };
    default:
      return { kind: "error", title, message: "ระบบขัดข้องชั่วคราว\nลองใหม่อีกสักครู่" };
  }
}
type UserRole = "user" | "admin" | "superadmin";
type AuthUser = {
  id?: number;
  username: string;
  role?: UserRole;
  permissions?: string[];
  points?: number;
};
type PublicSettings = {
  brandName: string;
  siteTitle: string;
  siteTitleMode: SiteTitleMode;
  primaryColor: string;
  themeMode: "light" | "dark";
  logoUrl: string;
  faviconUrl: string;
  authBackgroundUrl: string;
  authBackgroundTintEnabled: boolean;
  loginTitle: string;
  loginSubtitle: string;
  registerTitle: string;
  registerSubtitle: string;
  localLoginEnabled: boolean;
  registrationEnabled: boolean;
  storeSectionEnabled: boolean;
  storeEnabled?: boolean;
  storeClosedMessage?: string;
  quickActionsEnabled: boolean;
  footerEnabled: boolean;
  discordEnabled: boolean;
  googleEnabled: boolean;
  githubEnabled: boolean;
  discordConfigured: boolean;
  googleConfigured: boolean;
  githubConfigured: boolean;
};
type AuthResponse = {
  authenticated?: boolean;
  user?: AuthUser | null;
  error?: string;
  code?: string;
};
type StoreCategory = {
  id: number;
  name: string;
  isVisible: boolean;
  sortOrder: number;
  createdAt: string;
};
type StoreProduct = {
  id: number;
  categoryId: number;
  title: string;
  description: string;
  price: number;
  stock: number;
  isRecommended: boolean;
  isPopular: boolean;
  isSoldOut: boolean;
  imageUrl?: string;
  coverImageUrl?: string;
  coverCrop?: CoverCrop | null;
  deliveryType?: "file" | "link";
  soldCount?: number;
};
export type Announcement = {
  id: number; title: string; message: string; imageUrl?: string; customColor?: string; kind: "banner" | "popup" | "marquee";
  meta?: MarqueeMeta;
  placement: "homepage" | "login" | "both"; severity: "info" | "success" | "warning" | "error";
  buttonLabel: string; buttonUrl: string; active: boolean; startsAt?: string; endsAt?: string; createdAt?: string;
};

type MarqueeMeta = {
  backgroundColor?: string;
  backgroundColorEnabled?: boolean;
  borderColor?: string;
  borderColorEnabled?: boolean;
  textColor?: string;
  iconColor?: string;
  icon?: string;
  direction?: "left" | "right";
  repeatCount?: number;
  speed?: number;
};

function isMarqueeAnnouncement(item: Announcement) {
  return item.kind === "marquee" || (
    item.kind === "banner" && (
      item.message?.includes("<!--MARQUEE::") ||
      item.customColor?.startsWith("MARQUEE::")
    )
  );
}

function parseMarqueeAnnouncement(item: Announcement) {
  let legacyMeta: MarqueeMeta = {};
  let message = item.message || "";

  if (message.includes("<!--MARQUEE::")) {
    const parts = message.split("<!--MARQUEE::");
    message = parts[0];
    try { legacyMeta = JSON.parse(parts[1].replace("-->", "")) as MarqueeMeta; } catch {}
  } else if (item.customColor?.startsWith("MARQUEE::")) {
    try { legacyMeta = JSON.parse(item.customColor.replace("MARQUEE::", "")) as MarqueeMeta; } catch {}
  }

  // DB meta column wins over legacy embedded palette (e.g. backgroundColorEnabled).
  const meta: MarqueeMeta = { ...legacyMeta, ...(item.meta || {}) };
  return { message, meta };
}

function parseCssColor(value?: string): [number, number, number] | null {
  if (!value) return null;
  const raw = value.trim();
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 8) h = h.slice(0, 6);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function relativeLuminance(rgb: [number, number, number]) {
  const channel = (value: number) => {
    const c = Math.min(255, Math.max(0, value)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function isLightColor(value?: string, threshold = 0.62) {
  const rgb = parseCssColor(value);
  return rgb ? relativeLuminance(rgb) >= threshold : false;
}

function colorContrast(a?: string, b?: string) {
  const left = parseCssColor(a);
  const right = parseCssColor(b);
  if (!left || !right) return 0;
  const l1 = relativeLuminance(left);
  const l2 = relativeLuminance(right);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
}

function useDocumentTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function colorAlpha(value?: string) {
  if (!value) return 1;
  const raw = value.trim();
  const hex = raw.match(/^#([0-9a-f]{8})$/i);
  if (hex) return parseInt(hex[1].slice(6, 8), 16) / 255;
  const rgba = raw.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/i);
  if (rgba) return Math.min(1, Math.max(0, Number(rgba[1])));
  if (raw === "transparent") return 0;
  return 1;
}

function resolveMarqueeSurface(meta: MarqueeMeta, theme: "light" | "dark") {
  const themeText = theme === "light" ? "#1b1d21" : "#f4f5f7";
  const bgEnabled = meta.backgroundColorEnabled !== false;

  const borderEnabled = meta.borderColorEnabled !== false;

  if (!bgEnabled) {
    // No custom background: keep the page surface, but still honour the icon and border colours.
    const pageTone = theme === "light" ? "#f5f6f8" : "#08090d";
    let iconColor = meta.iconColor || themeText;
    if (colorContrast(iconColor, pageTone) < 2.6) iconColor = themeText;
    return {
      themeOnly: true as const,
      color: themeText,
      iconColor,
      borderColor: borderEnabled && meta.borderColor ? meta.borderColor : undefined,
    };
  }

  const borderColor = borderEnabled ? (meta.borderColor || "#ff1018") : "transparent";
  const fallbackBg = theme === "light" ? "rgba(20, 20, 25, 0.05)" : "rgba(255, 16, 24, 0.12)";
  const backgroundColor = meta.backgroundColor || fallbackBg;

  const pageTone = theme === "light" ? "#f5f6f8" : "#08090d";
  const translucent = colorAlpha(backgroundColor) < 0.35;
  const surfaceTone = backgroundColor === "transparent" || translucent || isLightColor(backgroundColor, 0.78)
    ? pageTone
    : backgroundColor;

  let textColor = meta.textColor || themeText;
  if (colorContrast(textColor, surfaceTone) < 3.2) {
    textColor = isLightColor(surfaceTone) ? "#1b1d21" : "#ffffff";
  }

  let iconColor = meta.iconColor || textColor;
  if (colorContrast(iconColor, surfaceTone) < 2.6) {
    iconColor = textColor;
  }

  return {
    themeOnly: false as const,
    backgroundColor,
    borderColor,
    color: textColor,
    iconColor,
  };
}

function SocialProviderIcon({ provider }: { provider: string }) {
  const iconSources: Record<string, string> = {
    discord: "/brands/discord-symbol.svg",
    google: "/brands/google-g.png",
    github: "/brands/github-mark.png",
  };
  return <img className={`social-brand-icon ${provider}-icon`} src={iconSources[provider]} alt="" aria-hidden="true" />;
}
const POPUP_SNOOZE_KEY = "hiddenPopups";
const POPUP_SNOOZE_MS = 60 * 60 * 1000;

function readPopupSnoozes(): Record<string, number> {
  if (typeof window === "undefined") return {};
  const now = Date.now();

  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(POPUP_SNOOZE_KEY) || "{}");
    const snoozes: Record<string, number> = {};

    if (Array.isArray(parsed)) {
      parsed.forEach((id) => { snoozes[String(id)] = now + POPUP_SNOOZE_MS; });
    } else if (parsed && typeof parsed === "object") {
      Object.entries(parsed as Record<string, unknown>).forEach(([id, value]) => {
        const expiresAt = Number(value);
        if (Number.isFinite(expiresAt) && expiresAt > now) snoozes[id] = expiresAt;
      });
    }

    localStorage.setItem(POPUP_SNOOZE_KEY, JSON.stringify(snoozes));
    return snoozes;
  } catch {
    localStorage.removeItem(POPUP_SNOOZE_KEY);
    return {};
  }
}

function writePopupSnooze(id: number, expiresAt: number | null) {
  const snoozes = readPopupSnoozes();
  if (expiresAt) snoozes[String(id)] = expiresAt;
  else delete snoozes[String(id)];
  localStorage.setItem(POPUP_SNOOZE_KEY, JSON.stringify(snoozes));
}

function Brand({ settings }: { settings?: PublicSettings | null }) {
  return <Link className="brand" href="/#top" aria-label={`${settings?.brandName || "NEXORA CLOUD"} หน้าหลัก`}><img className="brand-logo" src={settings?.logoUrl || "/logo-v2.png"} alt="" /><span>{settings?.brandName || <>NEXORA <b>CLOUD</b></>}</span></Link>;
}

let cachedLanIp: string = "";
async function detectLocalLanIP(): Promise<string> {
  if (cachedLanIp) return cachedLanIp;
  if (typeof window === "undefined" || !("RTCPeerConnection" in window)) return "";
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return await new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        try { pc.close(); } catch {}
        resolve(cachedLanIp);
      }, 500);

      pc.onicecandidate = (event) => {
        if (!event || !event.candidate) {
          clearTimeout(timeout);
          try { pc.close(); } catch {}
          resolve(cachedLanIp);
          return;
        }
        const match = event.candidate.candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
        if (match) {
          const ip = match[1];
          if (ip.startsWith("192.168.") || ip.startsWith("10.") || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) {
            cachedLanIp = ip;
            clearTimeout(timeout);
            try { pc.close(); } catch {}
            resolve(ip);
          }
        }
      };
    });
  } catch {
    return "";
  }
}

function AuthModal({
  open,
  initialMode,
  onClose,
  onAuthenticated,
  onNotify,
  settings,
  announcements,
}: {
  open: boolean;
  initialMode: AuthMode;
  onClose: () => void;
  onAuthenticated: (user: AuthUser) => void;
  onNotify: (kind: NoticeKind, message: string) => void;
  settings: PublicSettings | null;
  announcements: Announcement[];
}) {
  const wantedMode: AuthMode = initialMode === "register" && settings && !settings.registrationEnabled ? "login" : initialMode;
  const [mode, setMode] = useState<AuthMode>(wantedMode);
  const [modeFor, setModeFor] = useState(wantedMode);
  if (modeFor !== wantedMode) {
    setModeFor(wantedMode);
    setMode(wantedMode);
  }
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLElement>(null);
  const [announcementOpen, setAnnouncementOpen] = useState(true);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setAnnouncementOpen(true);
  }
  const socialProviders = [
    { provider: "discord", label: "Discord", available: settings?.discordEnabled && settings?.discordConfigured },
    { provider: "google", label: "Google", available: settings?.googleEnabled && settings?.googleConfigured },
    { provider: "github", label: "GitHub", available: settings?.githubEnabled && settings?.githubConfigured },
  ].filter((item) => item.available);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const opener = document.activeElement as HTMLElement | null;
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", onKey);
    // With no form to autofocus, keyboard users still start inside the dialog.
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  // Sign-in goes through fetch() and the page navigates away right after, so Chrome never
  // sees a finished sign-in and never offers to save it; the username field then has
  // nothing to autofill. Hand the credential to the password manager ourselves (Chromium
  // browsers; others fall back to their own form detection). Capped so a slow prompt
  // never holds up the redirect.
  async function rememberSignIn(id: string, secret: string) {
    const PasswordCredentialCtor = (window as unknown as { PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential }).PasswordCredential;
    if (!PasswordCredentialCtor || !navigator.credentials?.store) return;
    try {
      await Promise.race([
        navigator.credentials.store(new PasswordCredentialCtor({ id, password: secret, name: id })),
        new Promise((resolve) => window.setTimeout(resolve, 1500)),
      ]);
    } catch {
      // Saving is a convenience; a refusal or an unsupported browser must not block sign-in.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nextErrors: Record<string, string> = {};
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    const usernamePattern = mode === "register" ? /^[A-Za-z0-9]{4,30}$/ : /^[A-Za-z0-9]{1,30}$/;
    if (!usernamePattern.test(username)) {
      nextErrors.username = mode === "register"
        ? "ใช้ได้เฉพาะ A–Z และ 0–9 จำนวน 4–30 ตัว"
        : username ? "ชื่อผู้ใช้ใช้ได้เฉพาะ A–Z และ 0–9" : "กรอกชื่อผู้ใช้";
    }
    if (!password) nextErrors.password = "กรอกรหัสผ่าน";
    else if (hasNonAscii(password)) nextErrors.password = "รหัสผ่านใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และสัญลักษณ์";
    else if (mode === "register" && Array.from(password).length < 8) nextErrors.password = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
    if (mode === "register" && data.get("confirm") !== password) nextErrors.confirm = "รหัสผ่านไม่ตรงกัน";
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      (event.currentTarget.elements.namedItem(firstInvalid) as HTMLElement | null)?.focus();
      return;
    }

    setLoading(true);
    try {
      const localLan = await detectLocalLanIP().catch(() => "");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (localLan) {
        headers["X-Client-LAN-IP"] = localLan;
      }

      const response = await fetch(`${API_BASE}/api/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok || !payload.user) {
        const message = payload.error || "ตอนนี้ทำรายการไม่ได้ ลองใหม่อีกครั้ง";
        if (payload.code === "account_exists") setErrors({ username: message });
        else setErrors({ form: message });
        setLoading(false);
        return;
      }

      const user = payload.user;
      await rememberSignIn(username, password);
      onNotify("success", mode === "register" ? "สร้างบัญชีแล้ว" : "เข้าสู่ระบบแล้ว");
      onAuthenticated(user);
    } catch {
      setErrors({ form: "เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง" });
      setLoading(false);
    }
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setErrors({});
    setCapsLock(false);
    window.setTimeout(() => document.getElementById("auth-username")?.focus(), 0);
  }

  // Tab stays inside the dialog while it is open.
  function keepFocusInside(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled)"));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }

  const canRegister = settings?.registrationEnabled !== false;
  const hasForm = mode === "login" ? settings?.localLoginEnabled !== false : canRegister;
  const verb = mode === "register" ? "สมัครสมาชิก" : "เข้าสู่ระบบ";

  return (
    <div className={`modal-backdrop auth-backdrop${settings?.authBackgroundTintEnabled ? " tint-enabled" : ""}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={dialogRef} className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" tabIndex={-1} onKeyDown={keepFocusInside}>
        <button className="icon-button close" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={19} strokeWidth={2} /></button>
        <div className="auth-brand"><img className="auth-logo" src={settings?.logoUrl || "/logo-v2.png"} alt={settings?.brandName || "NEXORA CLOUD"} /></div>
        <h2 id="auth-title">{mode === "login" ? settings?.loginTitle || "เข้าสู่ระบบ" : settings?.registerTitle || "สมัครสมาชิก"}</h2>
        <p className="modal-subtitle">{mode === "login" ? settings?.loginSubtitle || "NEXORA CLOUD" : settings?.registerSubtitle || "NEXORA CLOUD"}</p>
        {mode === "login" && announcementOpen && announcements[0] && <div className={`auth-announcement ${announcements[0].severity}`} role="status">
          <Bell size={18} /><div><strong>{announcements[0].title}</strong><p>{announcements[0].message}</p>{announcements[0].buttonUrl && <a href={announcements[0].buttonUrl}>{announcements[0].buttonLabel || "ดูรายละเอียด"}</a>}</div>
          <button type="button" onClick={() => setAnnouncementOpen(false)} aria-label="ปิดประกาศ"><X size={15} /></button>
        </div>}
        {!hasForm && <p className="auth-note"><LockKeyhole size={17} aria-hidden="true" />{socialProviders.length > 0 ? "ตอนนี้เข้าด้วยชื่อผู้ใช้และรหัสผ่านไม่ได้ ใช้บัญชีด้านล่างแทน" : "ตอนนี้ปิดการเข้าสู่ระบบอยู่ ติดต่อผู้ดูแลเว็บ"}</p>}
        {hasForm && <form onSubmit={submit} method="post" action={`/api/auth/${mode}`} noValidate
          onChange={(event) => {
            const name = (event.target as unknown as HTMLInputElement).name;
            if (errors[name] || errors.form) setErrors((current) => { const next = { ...current }; delete next[name]; delete next.form; return next; });
          }}
          onKeyUp={(event) => { if ((event.target as HTMLElement).tagName === "INPUT") setCapsLock(event.getModifierState("CapsLock")); }}>
          <label className="field" htmlFor="auth-username">
            <span>ชื่อผู้ใช้</span>
            <span className="input-wrap"><UserRound className="field-icon" size={18} aria-hidden="true" /><input autoFocus id="auth-username" type="text" name="username" autoComplete="username" placeholder={mode === "register" ? "ตัวอักษรอังกฤษหรือตัวเลข 4–30 ตัว" : "กรอกชื่อผู้ใช้"} maxLength={30} aria-invalid={!!errors.username} {...latinAlphanumericInputProps()} /></span>
            {errors.username && <small className="error" role="alert">{errors.username}</small>}
          </label>
          <label className="field" htmlFor="auth-password">
            <span>รหัสผ่าน</span>
            <span className="input-wrap"><LockKeyhole className="field-icon" size={18} aria-hidden="true" /><input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "register" ? "อย่างน้อย 8 ตัวอักษร (ภาษาอังกฤษ)" : "กรอกรหัสผ่าน"} minLength={mode === "register" ? 8 : undefined} maxLength={128} aria-invalid={!!errors.password} {...asciiInputProps()} /><button type="button" className="show-pass" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
            {errors.password ? <small className="error" role="alert">{errors.password}</small> : capsLock && <small className="field-hint">Caps Lock เปิดอยู่</small>}
          </label>
          {mode === "register" && <label className="field" htmlFor="auth-confirm">
            <span>ยืนยันรหัสผ่าน</span>
            <span className="input-wrap"><LockKeyhole className="field-icon" size={18} aria-hidden="true" /><input id="auth-confirm" name="confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="กรอกรหัสผ่านอีกครั้ง" aria-invalid={!!errors.confirm} {...asciiInputProps()} /></span>
            {errors.confirm && <small className="error" role="alert">{errors.confirm}</small>}
          </label>}
          {errors.form && <div className="form-error" role="alert"><CircleAlert size={16} />{errors.form}</div>}
          <button className="button primary full" type="submit" disabled={loading}>{loading ? <><span className="spinner" />{mode === "login" ? "กำลังเข้าสู่ระบบ" : "กำลังสร้างบัญชี"}</> : <>{mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}<ArrowRight size={17} aria-hidden="true" /></>}</button>
        </form>}
        {socialProviders.length > 0 && <div className={`social-auth${hasForm ? "" : " is-only"}`}>
          {hasForm && <div className="divider">หรือ</div>}
          <div className="social-auth-grid">{socialProviders.map(({ provider, label }) =>
            <SocialOAuthButton key={provider} provider={provider as "discord" | "google" | "github"} mode={mode} className={`social-login ${provider}`} ariaLabel={`${verb}ด้วย ${label}`}><SocialProviderIcon provider={provider} /><span>{hasForm ? label : `${verb}ด้วย ${label}`}</span></SocialOAuthButton>
          )}</div>
        </div>}
        {canRegister && <p className="auth-switch">{mode === "login"
          ? <>ยังไม่มีบัญชี? <button type="button" onClick={() => switchMode("register")}>สมัครสมาชิก</button></>
          : <>มีบัญชีแล้ว? <button type="button" onClick={() => switchMode("login")}>เข้าสู่ระบบ</button></>}</p>}
        <p className="auth-terms">เมื่อ{verb} ถือว่ายอมรับ<a href="/terms" target="_blank" rel="noreferrer">ข้อกำหนดการใช้งาน</a></p>
      </section>
    </div>
  );
}

function getProductImage(product: StoreProduct): string {
  const url = product.imageUrl || product.coverImageUrl || "";
  return typeof url === "string" ? url.trim() : "";
}

function ProductCard({ product, owned, onBuy }: { product: StoreProduct; owned: boolean; onBuy: (product: StoreProduct) => void }) {
  const unlimitedStock = product.stock === -1;
  const soldOut = product.isSoldOut || product.stock === 0;
  const tag = product.isRecommended ? "แนะนำ" : product.isPopular ? "ยอดนิยม" : undefined;

  const imageSrc = getProductImage(product);
  // A broken cover stays in SmartImage's own error state instead of swapping to the no-image placeholder.
  const hasImage = !!imageSrc;

  return (
    <article
      className={`product-card ${soldOut && !owned ? "sold-out" : ""}${owned ? " is-owned" : ""}`}
      tabIndex={0}
      aria-label={`ดูรายละเอียด ${product.title}`}
      onClick={() => onBuy(product)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onBuy(product); }
      }}
    >
      <div className="product-image">
        {hasImage ? (
          <SmartImage
            src={imageSrc}
            alt={product.title}
            style={coverCropStyle(product.coverCrop)}
            // The sold-out overlay already sits in the centre; keep the broken cover as a plain dark box under it.
            fallback={soldOut && !owned ? <span className="smart-img-error" aria-hidden="true" /> : undefined}
          />
        ) : (
          soldOut ? (
            <div className="product-image-placeholder">
              <Ban size={42} className="placeholder-icon" />
              <span className="placeholder-text">สินค้าหมด</span>
            </div>
          ) : (
            <NoCoverArt />
          )
        )}

        {owned ? <span className="badge owned"><Check size={11} /> ซื้อแล้ว</span> : tag && <span className="badge hot">{tag}</span>}
        <span className="badge sold-count" aria-label={`ขายแล้ว ${product.soldCount || 0}`}><ShoppingCart size={11} aria-hidden="true" /><span className="sold-count-label" aria-hidden="true">ขายแล้ว</span><span aria-hidden="true">{product.soldCount || 0}</span></span>

        {soldOut && !owned && hasImage && (
          <div className="sold-out-overlay">
            <Ban size={40} className="sold-icon" />
            <span>สินค้าหมด</span>
          </div>
        )}
      </div>
      <div className="product-body">
        <h3>{product.title}</h3>
        <div className="price-row">
          <strong className={`price-highlight${product.price > 0 ? "" : " is-free"}`}>{product.price > 0 ? <>{formatPointAmount(product.price)} <small>พอยท์</small></> : "ฟรี"}</strong>
        </div>
        <p className={`stock ${soldOut ? "out" : ""}`}>
          <span className="stock-dot" />
          {soldOut ? "สินค้าหมด · คลัง 0" : unlimitedStock ? "พร้อมขาย · คลังไม่จำกัด" : `พร้อมขาย · คลัง ${product.stock}`}
        </p>
        {owned ? (
          <button className="button buy is-owned-buy" type="button" onClick={(event) => { event.stopPropagation(); onBuy(product); }}>
            <Check size={15} /> {product.deliveryType === "link" ? "เปิดลิงก์" : "ดาวน์โหลด"}
          </button>
        ) : soldOut ? (
          <button className="button buy disabled-buy" disabled type="button">
            <Ban size={15} /> สินค้าหมด
          </button>
        ) : (
          <button className="button buy" type="button" onClick={(event) => { event.stopPropagation(); onBuy(product); }}>
            <ShoppingCart size={15} /> {product.price > 0 ? "ซื้อเลย" : "รับฟรี"} <ChevronRight size={14} />
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * The ticker. `storeClosed` (the admin's closed message, "" for the default) adds the
 * store-closed notice to the queue, so pages say it in the ticker instead of a separate strip.
 */
export function MarqueeAnnouncementQueue({ items, storeClosed, storeClosedNote }: { items: Announcement[]; storeClosed?: string | null; storeClosedNote?: string }) {
  const [mountedAt] = useState(() => Date.now());
  const [queueAdvances, setQueueAdvances] = useState(0);
  const queue = useMemo(() => {
    const list = items
      .filter(isMarqueeAnnouncement)
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : a.id;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : b.id;
        return aTime - bTime;
      });
    if (storeClosed == null) return list;
    const detail = storeClosed.trim() || STORE_CLOSED_DETAIL;
    // Newest in the queue, so the admin's own items keep their timing.
    const notice: Announcement = {
      id: -1, kind: "marquee", placement: "homepage", severity: "warning", active: true,
      title: STORE_CLOSED_TITLE, message: storeClosedNote ? `${detail} · ${storeClosedNote}` : detail,
      buttonLabel: "", buttonUrl: "", createdAt: new Date(mountedAt).toISOString(),
      meta: { icon: "Store", iconColor: "#f59e0b", borderColor: "#f59e0b", backgroundColorEnabled: false, speed: 22, repeatCount: 3 },
    };
    return [...list, notice];
  }, [items, storeClosed, storeClosedNote, mountedAt]);

  const entries = useMemo(() => queue.map((item) => {
    const parsed = parseMarqueeAnnouncement(item);
    const speed = Math.min(300, Math.max(5, Number(parsed.meta.speed) || 15));
    return { item, ...parsed, speed };
  }), [queue]);

  let initialIndex = 0;
  let initialElapsedSeconds = 0;

  if (entries.length) {
    const totalDurationMs = entries.reduce((total, entry) => total + entry.speed * 1000, 0);
    const createdAt = entries[0].item.createdAt ? new Date(entries[0].item.createdAt).getTime() : mountedAt;
    const queueStartedAt = Number.isFinite(createdAt) ? createdAt : mountedAt;
    let elapsedMs = ((mountedAt - queueStartedAt) % totalDurationMs + totalDurationMs) % totalDurationMs;

    for (let index = 0; index < entries.length; index += 1) {
      const durationMs = entries[index].speed * 1000;
      if (elapsedMs < durationMs) {
        initialIndex = index;
        initialElapsedSeconds = elapsedMs / 1000;
        break;
      }
      elapsedMs -= durationMs;
    }
  }

  const currentIndex = entries.length ? (initialIndex + queueAdvances) % entries.length : 0;
  const current = entries[currentIndex] || null;
  const elapsedSeconds = queueAdvances === 0 ? initialElapsedSeconds : 0;
  const remainingMs = current ? Math.max(100, (current.speed - elapsedSeconds) * 1000) : 0;

  useEffect(() => {
    if (!current || entries.length < 2) return;
    const timer = window.setTimeout(() => {
      setQueueAdvances((count) => count + 1);
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [current, entries.length, remainingMs]);

  const theme = useDocumentTheme();

  if (!current) return null;

  const { item, message, meta, speed } = current;
  const repeatCount = Math.min(10, Math.max(1, Math.trunc(Number(meta.repeatCount) || 1)));
  const Icon = meta.icon ? MARQUEE_ICONS[meta.icon] : null;
  const surface = resolveMarqueeSurface(meta, theme);

  return (
    <div
      className={`marquee-announcement-wrapper theme-${theme}${surface.themeOnly ? " marquee-theme-only" : ""}${surface.borderColor && surface.borderColor !== "transparent" ? " has-custom-line" : ""}`}
      style={surface.themeOnly
        ? (surface.borderColor ? ({ "--marquee-line": surface.borderColor } as React.CSSProperties) : undefined)
        : ({
          backgroundColor: surface.backgroundColor,
          "--marquee-line": surface.borderColor,
          color: surface.color,
        } as React.CSSProperties)}
    >
      <div className="marquee-viewport">
        <div
          key={`${item.id}-${theme}`}
          className="marquee-announcement-content"
          style={{
            animationDuration: `${speed}s`,
            animationDirection: meta.direction === "right" ? "reverse" : "normal",
            animationDelay: `-${elapsedSeconds}s`,
          }}
        >
          {Array.from({ length: repeatCount }).map((_, index) => (
            <div key={index}>
              {Icon && <Icon size={16} className="marquee-icon" color={surface.iconColor} aria-hidden="true" />}
              <span className="marquee-text">{item.title && <strong>{item.title} </strong>}{message}</span>
              {item.buttonUrl && <a href={item.buttonUrl} className="marquee-link">{item.buttonLabel || "รายละเอียด"}</a>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HomepageBannerCarousel({ items }: { items: Announcement[] }) {
  const [failedIds, setFailedIds] = useState<number[]>([]);
  const slides = useMemo(() => items
    .filter((item) => item.kind === "banner" && Boolean(item.imageUrl) && !isMarqueeAnnouncement(item) && !failedIds.includes(item.id))
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : a.id;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : b.id;
      return aTime - bTime;
    }), [items, failedIds]);
  const [requestedIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const currentIndex = slides.length ? Math.min(requestedIndex, slides.length - 1) : 0;

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const timer = window.setInterval(() => {
      setCurrentIndex((index) => (Math.min(index, slides.length - 1) + 1) % slides.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [paused, slides.length]);

  if (!slides.length) return null;

  const goTo = (index: number) => {
    setCurrentIndex((index + slides.length) % slides.length);
  };

  return (
    <section className="homepage-banner-section container" aria-label="ประกาศสำคัญ">
      <div
        className="homepage-banner-carousel"
        tabIndex={0}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") goTo(currentIndex - 1);
          if (event.key === "ArrowRight") goTo(currentIndex + 1);
        }}
      >
        <div className="homepage-banner-track" style={{ transform: `translateX(-${currentIndex * 100}%)` }}>
          {slides.map((item, index) => {
            const image = (
              <>
                {/* Same picture, blurred and dimmed, fills the space around a photo whose
                    shape does not match the banner, instead of cropping it or showing bars. */}
                <span className="homepage-banner-backdrop" aria-hidden="true">
                  <img src={item.imageUrl} alt="" loading={index === 0 ? "eager" : "lazy"} decoding="async" />
                </span>
                <SmartImage
                  src={item.imageUrl}
                  alt={item.title || "ประกาศจาก NEXORA CLOUD"}
                  loading={index === 0 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : "auto"}
                  onError={() => setFailedIds((current) => current.includes(item.id) ? current : [...current, item.id])}
                />
                {(item.title?.trim() || item.message?.trim()) && (
                  <span className="homepage-banner-caption">
                    {item.title?.trim() && <strong>{item.title}</strong>}
                    {item.message?.trim() && <span>{item.message}</span>}
                  </span>
                )}
              </>
            );
            return (
              <article className="homepage-banner-slide" aria-hidden={index !== currentIndex} key={item.id}>
                {item.buttonUrl ? (
                  <a href={item.buttonUrl} tabIndex={index === currentIndex ? 0 : -1} aria-label={item.buttonLabel || item.title || "ดูรายละเอียดประกาศ"}>
                    {image}
                  </a>
                ) : <div>{image}</div>}
              </article>
            );
          })}
        </div>

        {slides.length > 1 && (
          <>
            <button type="button" className="homepage-banner-arrow previous" onClick={() => goTo(currentIndex - 1)} aria-label="ประกาศก่อนหน้า">
              <ChevronLeft size={20} />
            </button>
            <button type="button" className="homepage-banner-arrow next" onClick={() => goTo(currentIndex + 1)} aria-label="ประกาศถัดไป">
              <ChevronRight size={20} />
            </button>
            <div className="homepage-banner-dots" role="group" aria-label="เลือกประกาศ">
              {slides.map((item, index) => (
                <button
                  type="button"
                  className={index === currentIndex ? "active" : ""}
                  aria-label={`ประกาศที่ ${index + 1}`}
                  aria-current={index === currentIndex ? "true" : undefined}
                  onClick={() => goTo(index)}
                  key={item.id}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const HOME_PRODUCT_PREVIEW = 5;

function PopupBannerImage({ src, alt }: { src: string; alt: string }) {
  return <SmartImage src={src} alt={alt} className="popup-banner-img" aspectRatio="16 / 9" loading="eager" />;
}

function storeSectionVisibleFor(isStorePage: boolean, settings: PublicSettings | null, settingsChecked: boolean) {
  // The store switch in system settings closes everything. Otherwise the homepage can
  // hide its store section, and the /store page shows once settings have been checked.
  if (!storeIsOpen(settings)) return false;
  return isStorePage ? settingsChecked : settings?.storeSectionEnabled === true;
}

export default function GamingStore({ mode = "home", embedded = false }: { mode?: "home" | "store"; embedded?: boolean }) {
  const isStorePage = mode === "store";
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const [sort, setSort] = useState("popular");
  const [visible, setVisible] = useState(HOME_PRODUCT_PREVIEW);
  const [storeCategories, setStoreCategories] = useState<StoreCategory[]>([]);
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [purchases, setPurchases] = useState<OwnedPurchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [buyTarget, setBuyTarget] = useState<StoreProduct | null>(null);
  // Product to reopen after signing in from its details dialog.
  const pendingProductRef = useRef<StoreProduct | null>(null);
  const [storeTab, setStoreTab] = useState<"shop" | "owned">("shop");
  const [accountOpen, setAccountOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The same object until the notice changes, so the notice plays its entrance once.
  const shownNotice = useMemo<SystemNoticeData | null>(() => (notice ? { kind: notice.kind, text: notice.message, title: notice.title } : null), [notice]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [settingsChecked, setSettingsChecked] = useState(false);
  const [homeAnnouncements, setHomeAnnouncements] = useState<Announcement[]>([]);
  const [loginAnnouncements, setLoginAnnouncements] = useState<Announcement[]>([]);
  const [homePopupOpen, setHomePopupOpen] = useState(true);
  const [popupSnoozeUntil, setPopupSnoozeUntil] = useState(0);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function refreshSession() {
      try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = response.ok
          ? await response.json() as AuthResponse
          : null;
        if (!active) return;
        const user = payload?.authenticated && payload.user ? payload.user : null;
        setSessionUser(user);
        if (!user) setAccountOpen(false);
        // The session-expired notice sends people here to sign in again.
        if (new URLSearchParams(window.location.search).get("next") === "relogin" && !user) {
          setAuthMode("login");
          setAuthOpen(true);
        }
        if (new URLSearchParams(window.location.search).get("next") === "vps-uptime") {
          window.sessionStorage.setItem("nexora_vps_uptime_return", "1");
          if (user) {
            window.sessionStorage.removeItem("nexora_vps_uptime_return");
            window.location.assign("/api/vps-uptime/start");
          } else {
            setAuthMode("login");
            setAuthOpen(true);
          }
        }

      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    void refreshSession();
    const interval = window.setInterval(refreshSession, 30_000);
    window.addEventListener("focus", refreshSession);
    window.addEventListener("pageshow", refreshSession);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshSession);
      window.removeEventListener("pageshow", refreshSession);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  // Sign-in callbacks and the lockdown page come back here with the outcome in the address bar.
  // Show it once, then drop it from the URL so a reload or a shared link doesn't show it again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = oauthErrorNotice(params);
    // Only known codes: the text itself never comes from the URL, so a link can't put words on the page.
    const message = params.get("notice") === "unlocked" ? "ปลดล็อกเว็บไซต์แล้ว" : "";
    if (!oauthError && !params.has("notice")) return;
    const shown = oauthError || (message ? { kind: "success" as const, message } : null);
    const timer = window.setTimeout(() => {
      ["auth_error", "provider", "notice"].forEach((key) => params.delete(key));
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      if (shown) setNotice({ id: Date.now(), ...shown });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/public`)
      .then((response) => response.ok ? response.json() as Promise<PublicSettings> : null)
      .then((value) => {
        if (!value) return;
        setSettings(value);
        document.title = getDocumentTitle(value, window.location.pathname);
        document.documentElement.dataset.theme = value.themeMode || "dark";
        applyThemeColor(value.primaryColor);
        document.documentElement.style.setProperty("--auth-background-image", value.authBackgroundUrl ? `url("${value.authBackgroundUrl}")` : "none");
        const icon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
        if (icon) icon.href = value.faviconUrl;
      })
      .catch(() => undefined)
      .finally(() => setSettingsChecked(true));
    Promise.all([
      fetch(`${API_BASE}/api/announcements?placement=homepage`).then((response) => response.ok ? response.json() : { items: [] }),
      fetch(`${API_BASE}/api/announcements?placement=login`).then((response) => response.ok ? response.json() : { items: [] }),
    ]).then(([home, login]) => {
      setHomeAnnouncements(home.items || []);
      setLoginAnnouncements(login.items || []);
      const popup = home.items?.find((a: Announcement) => a.kind === "popup");
      if (popup) {
        const snoozeUntil = readPopupSnoozes()[String(popup.id)] || 0;
        setPopupSnoozeUntil(snoozeUntil);
        setHomePopupOpen(snoozeUntil <= Date.now());
      } else setHomePopupOpen(false);
    }).catch(() => undefined);
  }, [isStorePage]);

  // Product lists load only once settings say the store is open; a closed store answers 503.
  const storeListsOpen = settingsChecked && storeIsOpen(settings);
  useEffect(() => {
    if (!storeListsOpen) return;
    let active = true;
    Promise.all([
      fetch(`${API_BASE}/api/store/categories`).then((response) => response.ok ? response.json() : { items: [] }),
      fetch(`${API_BASE}/api/store/products`).then((response) => response.ok ? response.json() : { items: [] }),
    ]).then(([cats, prods]) => {
      if (!active) return;
      setStoreCategories((cats.items || cats.categories || []).filter((c: StoreCategory) => c.isVisible));
      setStoreProducts(prods.items || []);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [storeListsOpen, isStorePage]);

  useEffect(() => {
    if (!popupSnoozeUntil) return;
    const remaining = Math.max(0, popupSnoozeUntil - Date.now());
    const timer = window.setTimeout(() => {
      const popup = homeAnnouncements.find((item) => item.kind === "popup");
      if (popup) writePopupSnooze(popup.id, null);
      setPopupSnoozeUntil(0);
      setHomePopupOpen(true);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [popupSnoozeUntil, homeAnnouncements]);

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const desktopQuery = window.matchMedia("(min-width: 901px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    desktopQuery.addEventListener("change", closeOnDesktop);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      desktopQuery.removeEventListener("change", closeOnDesktop);
    };
  }, [menuOpen]);

  useEffect(() => {
    const hasImagePopup = homePopupOpen && homeAnnouncements.some((item) => item.kind === "popup" && (item.imageUrl || item.title?.trim() || item.message?.trim()));
    const shouldLock = authOpen || hasImagePopup || menuOpen;
    if (!shouldLock) return;

    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyWidth = body.style.width;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.width = previousBodyWidth;
      const previousScrollBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      window.scrollTo(0, scrollY);
      html.style.scrollBehavior = previousScrollBehavior;
    };
  }, [homePopupOpen, authOpen, menuOpen, homeAnnouncements]);

  // /api/auth/me has no numeric id, so the username identifies the signed-in account.
  const sessionUserKey = sessionUser?.username;
  const fetchPurchases = useCallback(() => fetch(`${API_BASE}/api/store/purchases`, { credentials: "include", cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json();
      setPurchases(Array.isArray(payload.items) ? payload.items : []);
    })
    .catch(() => {
      // Keep the previous list; the store still works without it.
    })
    .finally(() => setPurchasesLoading(false)), []);

  const loadPurchases = useCallback(() => {
    if (!sessionUserKey) {
      setPurchases([]);
      return Promise.resolve();
    }
    setPurchasesLoading(true);
    return fetchPurchases();
  }, [sessionUserKey, fetchPurchases]);

  // A closed store still lists what the visitor already bought (downloads keep working).
  const purchasesShown = storeSectionVisibleFor(isStorePage, settings, settingsChecked) || (isStorePage && settingsChecked);
  // Who the list is for: an account, "" when signed out, null while the list is not shown.
  const purchasesKey = purchasesShown ? sessionUserKey || "" : null;
  const [purchasesFor, setPurchasesFor] = useState<string | null | undefined>(undefined);
  if (purchasesFor !== purchasesKey) {
    setPurchasesFor(purchasesKey);
    if (purchasesKey === "") setPurchases([]);
    else if (purchasesKey) setPurchasesLoading(true);
  }
  useEffect(() => {
    if (purchasesShown && sessionUserKey) void fetchPurchases();
  }, [fetchPurchases, purchasesShown, sessionUserKey]);

  useEffect(() => {
    const onPoints = (event: Event) => {
      const points = (event as CustomEvent<number>).detail;
      if (typeof points === "number") setSessionUser((user) => user ? { ...user, points } : user);
    };
    window.addEventListener(POINTS_EVENT, onPoints);
    return () => window.removeEventListener(POINTS_EVENT, onPoints);
  }, []);

  const ownedIds = useMemo(() => new Set(purchases.map((item) => item.productId)), [purchases]);

  // Products matching the search, before the category is applied, so each chip can show its count.
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return storeProducts;
    return storeProducts.filter((p) => p.title.toLowerCase().includes(needle) || richTextToPlain(p.description).toLowerCase().includes(needle));
  }, [storeProducts, query]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of searched) counts.set(p.categoryId, (counts.get(p.categoryId) || 0) + 1);
    return counts;
  }, [searched]);
  const filtered = useMemo(() => {
    const result = searched.filter((p) => categoryId === "all" || p.categoryId === categoryId);
    return [...result].sort((a, b) => sort === "low" ? a.price - b.price : sort === "high" ? b.price - a.price : b.id - a.id);
  }, [searched, categoryId, sort]);
  const hasImageBanner = homeAnnouncements.some((item) => item.kind === "banner" && item.imageUrl && !isMarqueeAnnouncement(item));
  // Homepage can hide the store section; the dedicated /store page always shows.
  const storeOpen = storeIsOpen(settings);
  const storeSectionVisible = storeSectionVisibleFor(isStorePage, settings, settingsChecked);
  const quickActionsVisible = settings?.quickActionsEnabled === true;
  const footerVisible = settings?.footerEnabled === true;

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    setAuthOpen(true);
    setMenuOpen(false);
  }

  function notify(kind: NoticeKind, message: string) {
    setNotice({ id: Date.now(), kind, message });
  }

  function authenticated(user: AuthUser) {
    setSessionUser(user);
    setAuthOpen(false);
    if (window.sessionStorage.getItem("nexora_vps_uptime_return") === "1") {
      window.sessionStorage.removeItem("nexora_vps_uptime_return");
      window.location.href = "/api/vps-uptime/start";
      return;
    }
    const back = takeReturnPath();
    if (back) {
      window.location.href = back;
      return;
    }
    const pending = pendingProductRef.current;
    if (pending) {
      // Signed in from a product's details: stay in the store and reopen it with the balance.
      pendingProductRef.current = null;
      fetch(`${API_BASE}/api/auth/me`, { credentials: "include", cache: "no-store" })
        .then((response) => response.ok ? response.json() as Promise<AuthResponse> : null)
        .then((payload) => { if (payload?.user) setSessionUser(payload.user); })
        .catch(() => undefined)
        .finally(() => {
          window.dispatchEvent(new Event(SESSION_EVENT));
          setBuyTarget(pending);
        });
      return;
    }
    if (user.role === "admin" || user.role === "superadmin") {
      window.location.href = "/admin";
    } else {
      window.location.href = "/dashboard";
    }
  }

  function startService(product: StoreProduct) {
    // Anyone can open the details; signing in is only needed to actually buy.
    setBuyTarget(product);
  }

  function purchased(purchase: OwnedPurchase, newPoints: number) {
    setPurchases((items) => [purchase, ...items.filter((item) => item.productId !== purchase.productId)]);
    setStoreProducts((items) => items.map((item) => item.id === purchase.productId
      ? { ...item, soldCount: (item.soldCount || 0) + 1, stock: item.stock > 0 ? item.stock - 1 : item.stock }
      : item));
    broadcastPoints(newPoints);
  }

  // The homepage waits for the site settings (name, theme, which sections are on) so it doesn't
  // flash the defaults first. The store page gets its loading screen from UserOrPublicShell.
  if (!isStorePage && !embedded && !settingsChecked) return <PageLoadingScreen label="กำลังโหลดหน้าเว็บ..." />;

  return (
    <main id="top" className={`gaming-store ${embedded ? "embedded " : ""}${isStorePage ? "store-page" : "home-page"}`}>
      {!embedded && (
        <SiteNavbar
          active={isStorePage ? "store" : "home"}
          onLogin={() => openAuth("login")}
          onRegister={() => openAuth("register")}
        />
      )}
      {!isStorePage && (
        <div className="homepage-announcements" aria-live="polite">
          {homeAnnouncements.filter((item) => item.kind === "banner" && !item.imageUrl && !isMarqueeAnnouncement(item)).map((item) => <section className={`announcement-banner ${item.severity}`} key={item.id}>
            <div className="container"><Bell size={17} /><div><strong>{item.title}</strong><span>{item.message}</span></div>{item.buttonUrl && <a href={item.buttonUrl}>{item.buttonLabel || "ดูรายละเอียด"}<ArrowRight size={15} aria-hidden="true" /></a>}</div>
          </section>)}
          <MarqueeAnnouncementQueue items={homeAnnouncements} storeClosed={settingsChecked && !storeOpen ? settings?.storeClosedMessage || "" : null} />
        </div>
      )}

      {!isStorePage && hasImageBanner && <HomepageBannerCarousel items={homeAnnouncements} />}

      {!isStorePage && quickActionsVisible && <section className="container section quick-section" id="services">
        <div className="section-heading"><div><h2>{sessionUser ? "คุณต้องการทำอะไร?" : "เริ่มต้นใช้งาน"}</h2><p>{sessionUser ? "ไปยังงานที่ใช้บ่อยได้ทันที" : "เข้าสู่ระบบเพื่อจัดการไฟล์ บริการ และบัญชีของคุณ"}</p></div></div>
        <div className={`quick-grid user-action-grid ${sessionUser ? "" : "guest-action-grid"}`}>
          {storeSectionVisible && <Link href="/store"><span className="quick-action-icon"><ShoppingCart size={23} /></span><div><h3>เลือกซื้อสินค้า</h3><p>ดูสินค้า แพ็กเกจ และบริการที่พร้อมใช้งาน</p></div><span className="quick-action-arrow" aria-hidden="true"><ChevronRight size={18} strokeWidth={2} /></span></Link>}
          {sessionUser ? <>
            {storeOpen && <Link href="/topups"><span className="quick-action-icon"><Zap size={23} /></span><div><h3>เติมเงิน Points</h3><p>อัปโหลดสลิปและตรวจสอบประวัติการเติมเงิน</p></div><span className="quick-action-arrow" aria-hidden="true"><ChevronRight size={18} strokeWidth={2} /></span></Link>}
            <Link href="/hosting"><span className="quick-action-icon"><Cloud size={23} /></span><div><h3>จัดการโฮสติ้ง</h3><p>ดูเว็บไซต์ โดเมน และบริการ Cloud ของคุณ</p></div><span className="quick-action-arrow" aria-hidden="true"><ChevronRight size={18} strokeWidth={2} /></span></Link>
            <Link href="/files"><span className="quick-action-icon"><FolderOpen size={23} /></span><div><h3>ไฟล์ของฉัน</h3><p>อัปโหลดและจัดการไฟล์ส่วนตัวของคุณ</p></div><span className="quick-action-arrow" aria-hidden="true"><ChevronRight size={18} strokeWidth={2} /></span></Link>
            <Link href="/dashboard"><span className="quick-action-icon"><LayoutDashboard size={23} /></span><div><h3>แดชบอร์ด</h3><p>ไปยังภาพรวมบัญชีและการใช้งานของคุณ</p></div><span className="quick-action-arrow" aria-hidden="true"><ChevronRight size={18} strokeWidth={2} /></span></Link>
          </> : <>
            <a href="#login" className={settings?.registrationEnabled === false ? "is-primary" : undefined} onClick={(event) => { event.preventDefault(); openAuth("login"); }}><span className="quick-action-icon"><LockKeyhole size={23} /></span><div><h3>เข้าสู่ระบบ</h3><p>เปิดแดชบอร์ดและจัดการบริการของคุณ</p></div><span className="quick-action-arrow" aria-hidden="true"><ChevronRight size={18} strokeWidth={2} /></span></a>
            {settings?.registrationEnabled !== false && <a href="#register" className="is-primary" onClick={(event) => { event.preventDefault(); openAuth("register"); }}><span className="quick-action-icon"><UserRound size={23} /></span><div><h3>สมัครสมาชิก</h3><p>สร้างบัญชีใหม่เพื่อเริ่มใช้งาน NEXORA</p></div><span className="quick-action-arrow" aria-hidden="true"><ChevronRight size={18} strokeWidth={2} /></span></a>}
          </>}
        </div>
      </section>}

      {isStorePage && settingsChecked && !storeOpen && (
        <section className="container section store-page-section">
          <StoreClosedNotice
            variant="page"
            message={settings?.storeClosedMessage}
            note={sessionUser && purchases.length > 0 ? "สินค้าที่ซื้อแล้วยังดาวน์โหลดได้ตามรายการด้านล่าง" : undefined}
          >
            {!embedded && <Link className="is-primary" href="/">กลับหน้าหลัก</Link>}
            {sessionUser && <Link href="/dashboard">ไปแดชบอร์ด</Link>}
          </StoreClosedNotice>
          {sessionUser && purchases.length > 0 && (
            <div className="store-closed-owned">
              <h2>สินค้าที่ซื้อแล้ว</h2>
              <OwnedPurchaseList items={purchases} loading={false} onNotify={notify} />
            </div>
          )}
        </section>
      )}

      {storeSectionVisible && <section className={`container section store-section ${isStorePage ? "store-page-section" : ""}`} id="products">
        <div className={`section-heading ${isStorePage ? "store-page-heading" : ""}`}>
          <div>
            <h2>
              {isStorePage ? "ร้านค้า" : "รายการสินค้า"}
              <span className="store-count-badge">{filtered.length} รายการ</span>
            </h2>
            <p>{isStorePage ? (sessionUser ? <>ซื้อด้วยพอยท์ · คุณมี <strong className="store-balance">{formatPointAmount(sessionUser.points ?? 0)} พอยท์</strong></> : "เลือกสินค้าและแพ็กเกจที่พร้อมใช้งาน") : "สินค้าแนะนำจากร้านค้า"}</p>
          </div>
          {isStorePage && sessionUser && (
            <div className="store-tabs" role="tablist" aria-label="มุมมองร้านค้า">
              <button type="button" role="tab" aria-selected={storeTab === "shop"} className={storeTab === "shop" ? "selected" : ""} onClick={() => setStoreTab("shop")}>สินค้าทั้งหมด</button>
              <button type="button" role="tab" aria-selected={storeTab === "owned"} className={storeTab === "owned" ? "selected" : ""} onClick={() => setStoreTab("owned")}>
                ที่ซื้อแล้ว{purchases.length > 0 && <span>{purchases.length}</span>}
              </button>
            </div>
          )}
          {!isStorePage && filtered.length > HOME_PRODUCT_PREVIEW && (
            <Link className="store-view-all" href="/store">
              ดูทั้งหมด <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
        {isStorePage && sessionUser && storeTab === "owned" ? (
          <OwnedPurchaseList items={purchases} loading={purchasesLoading && !purchases.length} onNotify={notify} />
        ) : <>
        <div className={`filters ${isStorePage ? "store-page-filters" : ""}`}>
          <label className="search">
            <Search size={16} className="search-icon" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisible(HOME_PRODUCT_PREVIEW); }}
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }}
              placeholder="ค้นหาสินค้า..."
              aria-label="ค้นหาสินค้า"
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => { setQuery(""); setVisible(HOME_PRODUCT_PREVIEW); }} aria-label="ล้างคำค้นหา"><X size={15} /></button>
            )}
          </label>
          <label className="sort-select">
            <ArrowUpDown size={15} aria-hidden="true" />
            <select aria-label="เรียงสินค้า" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="popular">ล่าสุด</option>
              <option value="low">ราคาต่ำ - สูง</option>
              <option value="high">ราคาสูง - ต่ำ</option>
            </select>
            <ChevronDown size={15} className="sort-chevron" aria-hidden="true" />
          </label>
          {storeCategories.length > 0 && (
            <div className="category-tabs" role="group" aria-label="หมวดหมู่สินค้า">
              {[{ id: "all" as const, name: "ทั้งหมด", count: searched.length }, ...storeCategories.map((item) => ({ id: item.id, name: item.name, count: categoryCounts.get(item.id) || 0 }))].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`${categoryId === item.id ? "selected" : ""}${item.count === 0 ? " is-empty" : ""}`}
                  aria-pressed={categoryId === item.id}
                  onClick={(e) => {
                    setCategoryId(item.id);
                    setVisible(HOME_PRODUCT_PREVIEW);
                    e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
                  }}
                >
                  <span>{item.name}</span>
                  <span className="category-count">{item.count.toLocaleString("th-TH")}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {filtered.length ? (
          <>
            <div className="product-grid">
              {(isStorePage ? filtered : filtered.slice(0, visible)).map((product) => (
                <ProductCard key={product.id} product={product} owned={ownedIds.has(product.id)} onBuy={startService} />
              ))}
            </div>
            {!isStorePage && filtered.length > visible && (
              <div className="store-view-all-wrap">
                <Link className="button ghost store-view-all-button" href="/store">
                  ดูทั้งหมด {filtered.length} รายการ <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            )}
          </>
        ) : (
          <div className="store-status store-status-compact" role="status">
            <span className="store-status-icon" aria-hidden="true"><Search size={20} /></span>
            <h3>ไม่พบสินค้า</h3>
            <p>ลองเปลี่ยนคำค้นหรือเลือกหมวดหมู่อื่น</p>
            <div className="store-status-actions">
              <button type="button" className="button ghost" onClick={() => { setQuery(""); setCategoryId("all"); }}>ล้างตัวกรอง</button>
            </div>
          </div>
        )}
        </>}
      </section>}

      {footerVisible && <footer><div className="container footer-inner"><Brand settings={settings} /><p>&copy; 2026 {settings?.brandName || "NEXORA CLOUD"} · Infrastructure made simple</p><div><a href="#">Status</a><a href="#">Docs</a><Link href="/changelog">อัปเดต</Link><a href="#">ช่วยเหลือ</a></div></div></footer>}
      {!isStorePage && homePopupOpen && homeAnnouncements.find((item) => item.kind === "popup") && (() => {
        const popup = homeAnnouncements.find((item) => item.kind === "popup")!;
        const showImage = !!popup.imageUrl;
        const customStyle = popup.customColor ? { borderColor: popup.customColor } : undefined;
        const iconStyle = popup.customColor ? { color: popup.customColor, background: `${popup.customColor}1a` } : undefined;
        const isImageOnly = !popup.title?.trim() && !popup.message?.trim() && showImage;

        return <div className="announcement-popup-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setHomePopupOpen(false)}>
          <section
            className={`announcement-popup ${popup.severity} ${isImageOnly ? "image-only-mode" : "has-text"}`}
            style={customStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby={popup.title ? "announcement-popup-title" : undefined}
          >
            <div className="popup-card">
              {showImage ? (
                <div className="announcement-popup-image-container">
                  <PopupBannerImage key={popup.imageUrl} src={popup.imageUrl!} alt={popup.title || "ประกาศ"} />
                  <div className="popup-image-shade" aria-hidden="true" />
                  <button className="popup-close-btn" type="button" onClick={() => setHomePopupOpen(false)} aria-label="ปิดประกาศ">
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <div className="popup-header-block">
                  <span className="announcement-popup-icon" style={iconStyle}><Bell size={22} /></span>
                  <button className="popup-close-btn popup-close-btn--plain" type="button" onClick={() => setHomePopupOpen(false)} aria-label="ปิดประกาศ">
                    <X size={15} />
                  </button>
                </div>
              )}

              {!isImageOnly && (popup.title || popup.message || popup.buttonUrl) && (
                <div className="popup-body-content">
                  {(popup.title || popup.message) && (
                    <p className="popup-brand-badge">ประกาศจาก {settings?.brandName || "NEXORA CLOUD"}</p>
                  )}
                  {popup.title && <h2 id="announcement-popup-title" className="popup-main-title">{popup.title}</h2>}
                  {popup.message && <div className="popup-body-text">{popup.message}</div>}
                  {popup.buttonUrl && (
                    <a className="popup-cta-btn" href={popup.buttonUrl} style={popup.customColor ? { background: popup.customColor } : undefined}>
                      <span>{popup.buttonLabel || "ดูรายละเอียด"}</span>
                      <ArrowRight size={15} />
                    </a>
                  )}
                </div>
              )}

              <div className="popup-dismiss-footer">
                <label className="premium-checkbox-label">
                  <input type="checkbox" className="premium-checkbox-input" onChange={(e) => {
                    if (e.target.checked) {
                      const expiresAt = Date.now() + POPUP_SNOOZE_MS;
                      writePopupSnooze(popup.id, expiresAt);
                      setPopupSnoozeUntil(expiresAt);
                    } else {
                      writePopupSnooze(popup.id, null);
                      setPopupSnoozeUntil(0);
                    }
                  }} />
                  <span className="premium-checkbox-box" />
                  <span className="premium-checkbox-text">ไม่แสดงอีกในอีก 1 ชั่วโมง</span>
                </label>
                <button type="button" className="popup-dismiss-btn" onClick={() => setHomePopupOpen(false)}>เข้าใจแล้ว</button>
              </div>
            </div>
          </section>
        </div>;
      })()}
      <AuthModal open={authOpen} initialMode={authMode} onClose={() => { pendingProductRef.current = null; setAuthOpen(false); }} onAuthenticated={authenticated} onNotify={notify} settings={settings} announcements={loginAnnouncements.filter((item) => item.kind === "popup")} />
      {buyTarget && (
        <PurchaseDialog
          key={buyTarget.id}
          product={buyTarget}
          balance={typeof sessionUser?.points === "number" ? sessionUser.points : null}
          owned={ownedIds.has(buyTarget.id)}
          guest={!sessionUser}
          onLogin={() => { pendingProductRef.current = buyTarget; setBuyTarget(null); openAuth("login"); }}
          onClose={() => { setBuyTarget(null); if (sessionUser) void loadPurchases(); }}
          onPurchased={purchased}
          onNotify={notify}
        />
      )}
      {shownNotice && <SystemNotice notice={shownNotice} onClose={() => setNotice(null)} />}
    </main>
  );
}
