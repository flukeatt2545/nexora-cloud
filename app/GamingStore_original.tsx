"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, Check, ChevronDown, CircleAlert, CircleCheck, Eye, EyeOff, Info, LockKeyhole, LogOut, Menu, Search, ShieldCheck, UserRound, X, Zap, TriangleAlert, Star, Heart, Gift, ShieldCheck as ShieldCheckIcon, CheckCircle, Megaphone, Ban } from "lucide-react";
import { applyThemeColor } from "./themeColor";
import SocialOAuthButton from "./SocialOAuthButton";
import { API_BASE } from "./runtime";

const MARQUEE_ICONS: Record<string, React.ElementType> = {
  Megaphone, Bell, TriangleAlert, Info, Zap, Star, Heart, ShieldCheck, CheckCircle, Gift
};

type AuthMode = "login" | "register";
type NoticeKind = "success" | "error" | "info";
type Notice = { id: number; kind: NoticeKind; message: string };
type UserRole = "user" | "admin" | "superadmin";
type AuthUser = {
  id?: number;
  username: string;
  role?: UserRole;
  permissions?: string[];
};
type PublicSettings = {
  brandName: string;
  siteTitle: string;
  primaryColor: string;
  themeMode: "light" | "dark";
  logoUrl: string;
  faviconUrl: string;
  authBackgroundUrl: string;
  loginTitle: string;
  loginSubtitle: string;
  registerTitle: string;
  registerSubtitle: string;
  localLoginEnabled: boolean;
  registrationEnabled: boolean;
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
type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  oldPrice?: number;
  stock: number;
  tag?: string;
  spec: string;
  image: string;
};
type Announcement = {
  id: number; title: string; message: string; imageUrl?: string; customColor?: string; kind: "banner" | "popup";
  placement: "homepage" | "login" | "both"; severity: "info" | "success" | "warning" | "error";
  buttonLabel: string; buttonUrl: string; active: boolean; startsAt?: string; endsAt?: string;
};

const products: Product[] = [
  { id: 1, name: "PostgreSQL Starter", category: "Database", price: 299, stock: 48, tag: "แนะนำ", spec: "1 vCPU · RAM 1 GB · SSD 10 GB", image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=85" },
  { id: 2, name: "PostgreSQL Production", category: "Database", price: 1290, oldPrice: 1490, stock: 24, tag: "ยอดนิยม", spec: "2 vCPU · RAM 4 GB · SSD 80 GB", image: "https://images.unsplash.com/photo-1560732488-6b0df240254a?auto=format&fit=crop&w=800&q=85" },
  { id: 3, name: "MySQL Business", category: "Database", price: 890, stock: 19, spec: "2 vCPU · RAM 2 GB · SSD 50 GB", image: "https://images.unsplash.com/photo-1484557052118-f32bd25b45b5?auto=format&fit=crop&w=800&q=85" },
  { id: 4, name: "Redis Turbo Cache", category: "Cache", price: 390, stock: 31, tag: "Latency ต่ำ", spec: "RAM 2 GB · 2M requests/เดือน", image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=800&q=85" },
  { id: 5, name: "Redis Enterprise HA", category: "Cache", price: 2490, stock: 0, spec: "RAM 8 GB · Multi-zone · Auto failover", image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=85" },
  { id: 6, name: "Object Storage 100 GB", category: "File Storage", price: 149, stock: 99, tag: "คุ้มค่า", spec: "S3 API · CDN · Egress 100 GB", image: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=85" },
  { id: 7, name: "Object Storage 1 TB", category: "File Storage", price: 890, stock: 42, spec: "S3 API · CDN · Egress 1 TB", image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=800&q=85" },
  { id: 8, name: "Cloud VPS Developer", category: "Compute", price: 450, stock: 36, spec: "2 vCPU · RAM 2 GB · NVMe 40 GB", image: "https://images.unsplash.com/photo-1629654297299-c8506221ca97?auto=format&fit=crop&w=800&q=85" },
  { id: 9, name: "Cloud VPS Performance", category: "Compute", price: 1590, stock: 15, tag: "แรงพิเศษ", spec: "4 vCPU · RAM 8 GB · NVMe 160 GB", image: "https://images.unsplash.com/photo-1593642532400-2682810df593?auto=format&fit=crop&w=800&q=85" },
  { id: 10, name: "Automated Backup Vault", category: "Backup", price: 199, stock: 64, spec: "พื้นที่ 250 GB · เก็บย้อนหลัง 30 วัน", image: "https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=800&q=85" },
];

const categories = ["ทั้งหมด", "Database", "File Storage", "Cache", "Compute", "Backup"];

function SocialProviderIcon({ provider }: { provider: string }) {
  const iconSources: Record<string, string> = {
    discord: "/brands/discord-symbol.svg",
    google: "/brands/google-g.png",
    github: "/brands/github-mark.png",
  };
  return <img className={`social-brand-icon ${provider}-icon`} src={iconSources[provider]} alt="" aria-hidden="true" />;
}
function Brand({ settings }: { settings?: PublicSettings | null }) {
  return <a className="brand" href="/#top" aria-label={`${settings?.brandName || "NEXORA CLOUD"} หน้าหลัก`}><img className="brand-logo" src={settings?.logoUrl || "/logo-v2.png"} alt="" /><span>{settings?.brandName || <>NEXORA <b>CLOUD</b></>}</span></a>;
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
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announcementOpen, setAnnouncementOpen] = useState(true);
  const socialProviders = [
    { provider: "discord", label: "Discord", available: settings?.discordEnabled && settings?.discordConfigured },
    { provider: "google", label: "Google", available: settings?.googleEnabled && settings?.googleConfigured },
    { provider: "github", label: "GitHub", available: settings?.githubEnabled && settings?.githubConfigured },
  ].filter((item) => item.available);

  useEffect(() => setMode(initialMode === "register" && settings && !settings.registrationEnabled ? "login" : initialMode), [initialMode, settings]);
  useEffect(() => { if (open) setAnnouncementOpen(true); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

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
        : "กรุณากรอกชื่อผู้ใช้ให้ถูกต้อง";
    }
    if (!password) nextErrors.password = "กรุณากรอกรหัสผ่าน";
    else if (mode === "register" && Array.from(password).length < 8) nextErrors.password = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
    if (mode === "register" && data.get("confirm") !== password) nextErrors.confirm = "รหัสผ่านไม่ตรงกัน";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok || !payload.user) {
        const message = payload.error || "ระบบไม่สามารถดำเนินการได้ในขณะนี้";
        if (payload.code === "account_exists") setErrors({ username: message });
        else setErrors({ form: message });
        return;
      }

      onNotify("success", mode === "register" ? "สร้างบัญชีสำเร็จ ยินดีต้อนรับสู่ NEXORA CLOUD" : `เข้าสู่ระบบสำเร็จ ยินดีต้อนรับ ${payload.user.username}`);
      onAuthenticated(payload.user);
    } catch {
      onNotify("error", "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button close" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={19} strokeWidth={2} /></button>
        <div className="auth-brand"><img className="auth-logo" src={settings?.logoUrl || "/logo-v2.png"} alt={settings?.brandName || "NEXORA CLOUD"} /></div>
        <p className="eyebrow">{mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชีใหม่"}</p>
        <h2 id="auth-title">{mode === "login" ? settings?.loginTitle || "ยินดีต้อนรับกลับมา" : settings?.registerTitle || "เริ่มต้นกับ NEXORA"}</h2>
        <p className="modal-subtitle">{mode === "login" ? settings?.loginSubtitle || "ลงชื่อเข้าใช้ NEXORA CLOUD" : settings?.registerSubtitle || "สร้างบัญชีเพื่อเริ่มใช้งาน Cloud"}</p>
        {mode === "login" && announcementOpen && announcements[0] && <div className={`auth-announcement ${announcements[0].severity}`} role="status">
          <Bell size={18} /><div><strong>{announcements[0].title}</strong><p>{announcements[0].message}</p>{announcements[0].buttonUrl && <a href={announcements[0].buttonUrl}>{announcements[0].buttonLabel || "ดูรายละเอียด"}</a>}</div>
          <button type="button" onClick={() => setAnnouncementOpen(false)} aria-label="ปิดประกาศ"><X size={15} /></button>
        </div>}
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={mode === "login"} onClick={() => { setMode("login"); setErrors({}); }}>เข้าสู่ระบบ</button>
          {settings?.registrationEnabled !== false && <button role="tab" aria-selected={mode === "register"} onClick={() => { setMode("register"); setErrors({}); }}>สมัครสมาชิก</button>}
        </div>
        {mode === "login" && settings?.localLoginEnabled === false && (
          <div className="auth-notice-card warning">
            <LockKeyhole size={20} className="anc-icon" />
            <div>
              <strong>ปิดการเข้าระบบด้วยชื่อผู้ใช้และรหัสผ่าน</strong>
              <p>โปรดเข้าสู่ระบบด้วย Social ด้านล่าง</p>
            </div>
          </div>
        )}
        {((mode === "login" && settings?.localLoginEnabled !== false) || (mode === "register" && settings?.registrationEnabled !== false)) && <form onSubmit={submit} noValidate>
          <label className="field">
            <span>ชื่อผู้ใช้</span>
            <span className="input-wrap"><UserRound className="field-icon" size={18} aria-hidden="true" /><input autoFocus name="username" autoComplete="username" placeholder={mode === "register" ? "ตัวอักษรอังกฤษหรือตัวเลข 4–30 ตัว" : "กรอกชื่อผู้ใช้"} maxLength={30} aria-invalid={!!errors.username} /></span>
            {errors.username && <small className="error">{errors.username}</small>}
          </label>
          <label className="field">
            <span>รหัสผ่าน</span>
            <span className="input-wrap"><LockKeyhole className="field-icon" size={18} aria-hidden="true" /><input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "register" ? "อย่างน้อย 8 ตัวอักษร" : "กรอกรหัสผ่าน"} minLength={mode === "register" ? 8 : undefined} maxLength={128} aria-invalid={!!errors.password} /><button type="button" className="show-pass" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
            {errors.password && <small className="error">{errors.password}</small>}
          </label>
          {mode === "register" && <label className="field">
            <span>ยืนยันรหัสผ่าน</span>
            <span className="input-wrap"><LockKeyhole className="field-icon" size={18} aria-hidden="true" /><input name="confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="กรอกรหัสผ่านอีกครั้ง" aria-invalid={!!errors.confirm} /></span>
            {errors.confirm && <small className="error">{errors.confirm}</small>}
          </label>}
          {errors.form && <div className="form-error" role="alert"><CircleAlert size={16} />{errors.form}</div>}
          <button className="button primary full" type="submit" disabled={loading}>{loading ? <><span className="spinner" />กำลังดำเนินการ...</> : <>{mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}<ArrowRight size={17} aria-hidden="true" /></>}</button>
        </form>}
        {socialProviders.length > 0 && <div className="social-auth">
          <div className="divider">{mode === "register" ? "หรือสมัครสมาชิกด้วย" : "หรือเข้าสู่ระบบด้วย"}</div>
          <div className="social-auth-grid">{socialProviders.map(({ provider, label }) =>
            <SocialOAuthButton key={provider} provider={provider as "discord" | "google" | "github"} mode={mode} className={`social-login ${provider}`} ariaLabel={`${mode === "register" ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}ด้วย ${label}`}><SocialProviderIcon provider={provider} /><span>{label}</span></SocialOAuthButton>
          )}</div>
        </div>}
        <p className="auth-terms">การดำเนินการต่อถือว่าคุณยอมรับ <a href="/terms" target="_blank" rel="noreferrer">ข้อกำหนดการใช้งาน</a></p>
      </section>
    </div>
  );
}

function ProductCard({ product, onBuy }: { product: Product; onBuy: (product: Product) => void }) {
  const soldOut = product.stock === 0;
  return (
    <article className={`product-card ${soldOut ? "sold-out" : ""}`} tabIndex={0}>
      <div className="product-image">
        <img src={product.image} alt="" />
        {product.tag && <span className="badge hot">{product.tag}</span>}
        {soldOut && <span className="sold-label">Capacity เต็ม</span>}
      </div>
      <div className="product-body">
        <p className="product-category">{product.category}</p>
        <h3>{product.name}</h3>
        <p className="product-spec">{product.spec}</p>
        <div className="price-row"><strong>฿{product.price.toLocaleString()}</strong><small>/เดือน</small>{product.oldPrice && <del>฿{product.oldPrice.toLocaleString()}</del>}</div>
        <p className={`stock ${soldOut ? "out" : ""}`}><span />{soldOut ? "โซนนี้เต็มชั่วคราว" : `พร้อมสร้าง Instance · ${product.stock} slots`}</p>
        <button className="button buy" disabled={soldOut} onClick={() => onBuy(product)}>{soldOut ? "แจ้งเตือนเมื่อพร้อม" : <>เริ่มใช้งาน<ArrowRight size={16} aria-hidden="true" /></>}</button>
      </div>
    </article>
  );
}

function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const Icon = notice.kind === "success" ? CircleCheck : notice.kind === "error" ? CircleAlert : Info;
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === "Escape" && onClose(); window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return (
    <div className="feedback-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`feedback-modal ${notice.kind}`} role={notice.kind === "error" ? "alertdialog" : "dialog"} aria-modal="true" aria-live="polite">
        <button className="feedback-modal-close" onClick={onClose} aria-label="ปิด"><X size={17} /></button>
        <span className="feedback-modal-icon"><Icon size={28} aria-hidden="true" /></span>
        <h2>{notice.kind === "success" ? "เรียบร้อย" : notice.kind === "error" ? "ทำรายการไม่สำเร็จ" : "แจ้งให้ทราบ"}</h2>
        <p>{notice.message}</p>
        <button className="button primary" onClick={onClose} autoFocus>ตกลง</button>
      </section>
    </div>
  );
}

export default function GamingStore() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [sort, setSort] = useState("popular");
  const [visible, setVisible] = useState(5);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [homeAnnouncements, setHomeAnnouncements] = useState<Announcement[]>([]);
  const [loginAnnouncements, setLoginAnnouncements] = useState<Announcement[]>([]);
  const [homePopupOpen, setHomePopupOpen] = useState(true);
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

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/public`)
      .then((response) => response.ok ? response.json() as Promise<PublicSettings> : null)
      .then((value) => {
        if (!value) return;
        setSettings(value);
        document.title = value.siteTitle;
        document.documentElement.dataset.theme = value.themeMode || "dark";
        applyThemeColor(value.primaryColor);
        document.documentElement.style.setProperty("--auth-background-image", value.authBackgroundUrl ? `url("${value.authBackgroundUrl}")` : "none");
        const icon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
        if (icon) icon.href = value.faviconUrl;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/announcements?placement=homepage`).then((response) => response.ok ? response.json() : { items: [] }),
      fetch(`${API_BASE}/api/announcements?placement=login`).then((response) => response.ok ? response.json() : { items: [] }),
    ]).then(([home, login]) => {
      setHomeAnnouncements(home.items || []);
      setLoginAnnouncements(login.items || []);
    }).catch(() => undefined);
  }, []);

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
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filtered = useMemo(() => {
    const result = products.filter((p) => (category === "ทั้งหมด" || p.category === category) && p.name.toLowerCase().includes(query.toLowerCase()));
    return [...result].sort((a, b) => sort === "low" ? a.price - b.price : sort === "high" ? b.price - a.price : a.id - b.id);
  }, [query, category, sort]);

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
    if (user.role === "admin" || user.role === "superadmin") {
      window.location.href = "/admin";
    } else {
      window.location.href = "/dashboard";
    }
  }

  async function logout() {
    try {
      const response = await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error();
      setAccountOpen(false);
      setSessionUser(null);
      notify("success", "ออกจากระบบเรียบร้อยแล้ว");
    } catch {
      notify("error", "ออกจากระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    }
  }

  function startService(product: Product) {
    if (!sessionUser) {
      openAuth("login");
      return;
    }
    notify("success", `เลือกแพ็กเกจ ${product.name} แล้ว`);
  }

  if (sessionUser && sessionUser.role !== "user") {
    return (
      <main className="admin-gateway-page">
        <div className="admin-gateway-card">
          <ShieldCheck size={54} className="ag-icon" />
          <h2>ยินดีต้อนรับสู่ศูนย์ควบคุม</h2>
          <p>สวัสดี <strong>{sessionUser.username}</strong>, คุณเข้าสู่ระบบในฐานะ{sessionUser.role === "superadmin" ? "ผู้ดูแลระบบสูงสุด" : "แอดมิน"}</p>
          <div className="ag-actions">
            <a href="/admin" className="button primary full">เข้าสู่ระบบหลังบ้าน (Admin)<ArrowRight size={17} aria-hidden="true" /></a>
            <button onClick={logout} className="button ghost full">ออกจากระบบ</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main id="top">
      <nav className="navbar" aria-label="เมนูหลัก">
        <div className="container nav-inner">
          <Brand settings={settings} />
          <button className="hamburger icon-button" aria-label="เปิดเมนู" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={23} /></button>
          <div className={`nav-links ${menuOpen ? "open" : ""}`}>
            <a href="#top" className="active">หน้าหลัก</a><a href="#products">แพ็กเกจ</a><a href="#services">บริการ</a><a href="#about">เกี่ยวกับเรา</a>
            {sessionUser ? (
              <div className="nav-actions session-actions account-menu" ref={accountRef}>
                <button
                  className="user-pill"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  onClick={() => setAccountOpen((open) => !open)}
                >
                  <UserRound size={16} />
                  <span>{sessionUser.username}</span>
                  <ChevronDown className={accountOpen ? "rotate" : ""} size={15} aria-hidden="true" />
                </button>
                {accountOpen && (
                  <div className="account-dropdown" role="menu">
                    <div className="account-summary">
                      <span className="account-avatar"><UserRound size={18} /></span>
                      <div><strong>{sessionUser.username}</strong><small><ShieldCheck size={13} />{sessionUser.role === "superadmin" ? "ผู้ดูแลระบบ" : sessionUser.role === "admin" ? "แอดมิน" : "ผู้ใช้"}</small></div>
                    </div>
                    <div className="account-divider" />
                    <a role="menuitem" className="account-link" href={sessionUser.role === "user" ? "/profile" : "/admin/profile"}><UserRound size={17} />โปรไฟล์ของฉัน</a>
                    {(sessionUser.role === "admin" || sessionUser.role === "superadmin") && <a role="menuitem" className="account-link" href="/admin"><ShieldCheck size={17} />แดชบอร์ดผู้ดูแล</a>}
                    <div className="account-divider" />
                    <button type="button" role="menuitem" className="account-logout" onClick={logout}><LogOut size={17} />ออกจากระบบ</button>
                  </div>
                )}
              </div>
            ) : <div className="nav-actions"><button className="button ghost" onClick={() => openAuth("login")}>เข้าสู่ระบบ</button>{settings?.registrationEnabled !== false && <button className="button primary" onClick={() => openAuth("register")}>สมัครสมาชิก</button>}</div>}
          </div>
        </div>
      </nav>
      <div className="homepage-announcements" aria-live="polite">
        {homeAnnouncements.filter((item) => item.kind === "banner" && !(item.customColor && item.customColor.startsWith("MARQUEE::")) && !(item.message && item.message.includes("<!--MARQUEE::"))).map((item) => <section className={`announcement-banner ${item.severity}`} key={item.id}>
          <div className="container"><Bell size={17} /><div><strong>{item.title}</strong><span>{item.message}</span></div>{item.buttonUrl && <a href={item.buttonUrl}>{item.buttonLabel || "ดูรายละเอียด"}<ArrowRight size={15} aria-hidden="true" /></a>}</div>
        </section>)}
        {homeAnnouncements.filter((item) => item.kind === "banner" && (item.message?.includes("<!--MARQUEE::") || item.customColor?.startsWith("MARQUEE::"))).map((item) => {
          let meta: any = {};
          let msg = item.message || "";
          if (msg.includes("<!--MARQUEE::")) {
            const parts = msg.split("<!--MARQUEE::");
            msg = parts[0];
            try { meta = JSON.parse(parts[1].replace("-->", "")); } catch (e) {}
          } else if (item.customColor && item.customColor.startsWith("MARQUEE::")) {
            try { meta = JSON.parse(item.customColor.replace("MARQUEE::", "")); } catch (e) {}
          }
          const Icon = meta.icon ? MARQUEE_ICONS[meta.icon] : null;
          return (
            <div className="marquee-announcement-wrapper" key={item.id} style={{
              backgroundColor: meta.backgroundColor || ((meta.borderColor || "#ff1018") + "1a"),
              borderBottom: `1px solid ${meta.borderColor || "#ff1018"}`,
              color: meta.textColor || "#ffffff"
            }}>
              <div className="marquee-announcement-content" suppressHydrationWarning style={{ animationDuration: `${meta.speed || 15}s`, animationDirection: meta.direction === "right" ? "reverse" : "normal", animationDelay: `-${(Date.now() / 1000) % (meta.speed || 15)}s` }}>
                {Array.from({ length: meta.repeatCount || 1 }).map((_, i) => (
                  <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: "12px", marginRight: i < (meta.repeatCount || 1) - 1 ? "40px" : "0" }}>
                    {Icon && <Icon size={16} className="marquee-icon" color={meta.iconColor || meta.textColor || "#ffffff"} />}
                    <span className="marquee-text">{item.title && <strong>{item.title} </strong>}{msg}</span>
                    {item.buttonUrl && <a href={item.buttonUrl} className="marquee-link" style={{ color: meta.textColor || "#ffffff" }}>{item.buttonLabel || "รายละเอียด"}</a>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <header className="hero container">
        <div className="hero-copy">
          <p className="eyebrow pill"><Zap size={13} aria-hidden="true" /> NEXORA CLOUD</p>
          <h1>โฮสติ้งฐานข้อมูล<br />ที่ใช้งาน<span>ง่าย</span></h1>
          <p>สร้าง PostgreSQL, MySQL, Redis และพื้นที่เก็บไฟล์ได้ในไม่กี่ขั้นตอน มีระบบสำรองข้อมูลและดูแลตลอด 24 ชั่วโมง</p>
          {sessionUser ? (
            <div className="hero-actions"><a className="button primary" href="/dashboard">หน้าแดชบอร์ดของคุณ<ArrowRight size={17} aria-hidden="true" /></a><a className="button ghost" href="/profile">บัญชีของฉัน</a></div>
          ) : (
            <div className="hero-actions"><a className="button primary" href="#products">ดูแพ็กเกจ <ArrowRight size={16} style={{ display: 'inline', verticalAlign: '-2px', marginLeft: '4px' }} /></a><a className="button ghost" href="#services">ดูบริการทั้งหมด</a></div>
          )}
          <div className="stats"><div><strong>99.99%</strong><span>Uptime SLA</span></div><div><strong>3.2 PB</strong><span>ข้อมูลที่ดูแล</span></div><div><strong>18 ms</strong><span>Latency เฉลี่ย</span></div></div>
        </div>
        <div className="hero-visual" aria-label="ระบบ Cloud Database">
          <div className="hero-grid" />
          <div className="orb" />
          <div className="game-card back"><span>OBJECT STORAGE</span></div>
          <div className="game-card front"><small>MANAGED CLOUD</small><strong>POSTGRES<br />CLUSTER</strong><span>ONLINE · HEALTHY</span></div>
          <div className="floating-chip chip-one"><Zap size={15} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px' }} />Deploy ภายใน 30 วินาที</div>
          <div className="floating-chip chip-two"><Check size={14} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '4px', color: '#10b981' }} />Backup ล่าสุด 2 นาทีที่แล้ว</div>
        </div>
      </header>

      <section className="trust-strip" id="services">
        <div className="container trust-grid">
          <article><span className="feature-icon"><ShieldCheck size={22} /></span><div><h3>ข้อมูลปลอดภัย</h3><p>เข้ารหัสทั้งตอนรับส่งและตอนจัดเก็บ</p></div></article>
          <article><span className="feature-icon"><Zap size={22} /></span><div><h3>เพิ่มขนาดได้ทันที</h3><p>เพิ่มทรัพยากรได้โดยไม่ต้องย้ายข้อมูล</p></div></article>
          <article><span className="feature-icon"><UserRound size={22} /></span><div><h3>มีทีมดูแลตลอดวัน</h3><p>ตรวจสอบระบบและพร้อมช่วยเมื่อมีปัญหา</p></div></article>
        </div>
      </section>

      <section className="container section quick-section">
        <div className="section-heading"><div><p className="eyebrow">บริการของเรา</p><h2>เลือกบริการที่ต้องการ</h2></div></div>
        <div className="quick-grid">
          <a href="#products" onClick={() => setCategory("Database")}><span>01</span><div><p>PostgreSQL และ MySQL แบบ Managed</p><h3>CLOUD DATABASE</h3></div><b><ArrowRight size={18} /></b></a>
          <a href="#products" onClick={() => setCategory("File Storage")}><span>02</span><div><p>S3 API พร้อม CDN ทั่วโลก</p><h3>OBJECT STORAGE</h3></div><b><ArrowRight size={18} /></b></a>
          <a href="#products" onClick={() => setCategory("Cache")}><span>03</span><div><p>ลด Latency ด้วย Redis Cluster</p><h3>EDGE CACHE</h3></div><b><ArrowRight size={18} /></b></a>
        </div>
      </section>

      <section className="container section" id="products">
        <div className="section-heading"><div><p className="eyebrow">แพ็กเกจ</p><h2>เลือกแพ็กเกจที่เหมาะกับคุณ</h2><p>เริ่มจากแพ็กเกจเล็ก และเพิ่มขนาดภายหลังได้</p></div><span className="results">{filtered.length} แพ็กเกจ</span></div>
        <div className="filters">
          <label className="search"><Search size={16} className="search-icon" style={{ display: 'inline', marginRight: '6px' }} /><input value={query} onChange={(e) => { setQuery(e.target.value); setVisible(5); }} placeholder="ค้นหา Database, Storage หรือ Compute..." aria-label="ค้นหาแพ็กเกจ" /></label>
          <div className="category-tabs" aria-label="หมวดหมู่บริการ">{categories.map((item) => <button key={item} className={category === item ? "selected" : ""} onClick={() => { setCategory(item); setVisible(5); }}>{item}</button>)}</div>
          <select aria-label="เรียงแพ็กเกจ" value={sort} onChange={(e) => setSort(e.target.value)}><option value="popular">แนะนำ</option><option value="low">ราคาต่ำ - สูง</option><option value="high">ราคาสูง - ต่ำ</option></select>
        </div>
        {filtered.length ? <>
          <div className="product-grid">{filtered.slice(0, visible).map((product) => <ProductCard key={product.id} product={product} onBuy={startService} />)}</div>
        </> : <div className="empty-state"><span className="empty-icon"><Search size={32} /></span><h3>ไม่พบแพ็กเกจที่ค้นหา</h3><p>ลองเปลี่ยนคำค้นหรือเลือกบริการอื่น</p><button className="button ghost" onClick={() => { setQuery(""); setCategory("ทั้งหมด"); }}>ล้างตัวกรอง</button></div>}
      </section>

      <section className="cta-section container" id="about">
        <div><p className="eyebrow">เริ่มต้นใช้งาน</p><h2>พร้อมสร้างบริการแรกของคุณหรือยัง?</h2><p>สมัครบัญชีแล้วเลือกฐานข้อมูลหรือพื้นที่เก็บไฟล์ที่ต้องการได้ทันที</p></div>
        <button className="button primary" onClick={() => openAuth("register")}>สร้างบัญชีฟรี <ArrowRight size={16} style={{ display: 'inline', verticalAlign: '-2px', marginLeft: '4px' }} /></button>
      </section>

      <footer><div className="container footer-inner"><Brand settings={settings} /><p>&copy; 2026 {settings?.brandName || "NEXORA CLOUD"} · Infrastructure made simple</p><div><a href="#">Status</a><a href="#">Docs</a><a href="#">ช่วยเหลือ</a></div></div></footer>
      {homePopupOpen && homeAnnouncements.find((item) => item.kind === "popup") && (() => {
        const popup = homeAnnouncements.find((item) => item.kind === "popup")!;
        const customStyle = popup.customColor ? { borderColor: popup.customColor } : undefined;
        const iconStyle = popup.customColor ? { color: popup.customColor, background: `${popup.customColor}1a` } : undefined;
        return <div className="announcement-popup-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setHomePopupOpen(false)}>
          <section className={`announcement-popup ${popup.severity}`} style={customStyle} role="dialog" aria-modal="true" aria-labelledby={popup.title ? "announcement-popup-title" : undefined}>
            <button className="icon-button close" onClick={() => setHomePopupOpen(false)} aria-label="ปิดประกาศ"><X size={18} /></button>
            {popup.imageUrl ? (
              <div className="announcement-popup-image"><img src={popup.imageUrl} alt="" /></div>
            ) : (
              <span className="announcement-popup-icon" style={iconStyle}><Bell size={25} /></span>
            )}
            {(popup.title || popup.message) && <p>ประกาศจาก {settings?.brandName || "NEXORA CLOUD"}</p>}
            {popup.title && <h2 id="announcement-popup-title">{popup.title}</h2>}
            {popup.message && <div className="popup-body-text">{popup.message}</div>}
            {popup.buttonUrl && <a className="button primary full" href={popup.buttonUrl} style={popup.customColor ? { background: popup.customColor, borderColor: popup.customColor } : undefined}>{popup.buttonLabel || "ดูรายละเอียด"}<ArrowRight size={17} aria-hidden="true" /></a>}
          </section>
        </div>;
      })()}
      <AuthModal open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} onAuthenticated={authenticated} onNotify={notify} settings={settings} announcements={loginAnnouncements.filter((item) => item.kind === "popup")} />
      {notice && <Toast key={notice.id} notice={notice} onClose={() => setNotice(null)} />}
    </main>
  );
}
