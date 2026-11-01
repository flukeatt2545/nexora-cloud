"use client";

import {
  ChevronDown, FolderOpen, Home, LayoutDashboard, LogOut, Menu, ShieldCheck, ShoppingCart, UserRound, X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { POINTS_EVENT } from "./StorePurchase";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChangelogUnseen } from "../changelog/seen";
import "./changelog-link.css";

/** Fired after signing in on the same page so the navbar reloads the session. */
export const SESSION_EVENT = "nexora:session";
import { applyThemeColor } from "../themeColor";
import { API_BASE } from "../runtime";

type UserRole = "user" | "admin" | "superadmin";
type AuthUser = { username: string; role?: UserRole };
type PublicSettings = {
  brandName?: string;
  logoUrl?: string;
  primaryColor?: string;
  themeMode?: "light" | "dark";
  storeSectionEnabled?: boolean;
  storeEnabled?: boolean;
  registrationEnabled?: boolean;
};

export type SiteNavActive = "home" | "store" | "share";

export default function SiteNavbar({
  active,
  onLogin,
  onRegister,
}: {
  active?: SiteNavActive;
  onLogin?: () => void;
  onRegister?: () => void;
}) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [settingsChecked, setSettingsChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  // Opened from the keyboard: focus goes into the menu, as a mouse user's would not.
  const focusFirstItem = useRef(false);
  const updateUnseen = useChangelogUnseen();
  const pathname = usePathname();

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/public`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PublicSettings | null) => {
        if (!data) return;
        setSettings(data);
        if (data.themeMode) document.documentElement.dataset.theme = data.themeMode;
        if (data.primaryColor) applyThemeColor(data.primaryColor);
      })
      .catch(() => undefined)
      .finally(() => setSettingsChecked(true));

    const loadSession = () => fetch(`${API_BASE}/api/auth/me`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setSessionUser(data?.authenticated && data.user ? data.user : null);
      })
      .catch(() => undefined)
      .finally(() => setSessionChecked(true));
    void loadSession();

    // Signing in without leaving the page (e.g. from a product's details) refreshes the navbar.
    const onPoints = (event: Event) => {
      const points = (event as CustomEvent<number>).detail;
      if (typeof points === "number") setSessionUser((user) => (user ? { ...user, points } : user));
    };
    window.addEventListener(SESSION_EVENT, loadSession);
    window.addEventListener(POINTS_EVENT, onPoints);
    return () => {
      window.removeEventListener(SESSION_EVENT, loadSession);
      window.removeEventListener(POINTS_EVENT, onPoints);
    };
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setAccountOpen((open) => {
        if (open) accountRef.current?.querySelector<HTMLButtonElement>(".user-pill")?.focus();
        return false;
      });
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  useEffect(() => {
    if (!accountOpen || !focusFirstItem.current) return;
    focusFirstItem.current = false;
    accountRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [accountOpen]);

  // Up, down, Home and End move through the menu and wrap around.
  function onAccountKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" && !accountOpen && !menuOpen) {
      event.preventDefault();
      focusFirstItem.current = true;
      setAccountOpen(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [...(accountRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (at + 1) % items.length
      : (at <= 0 ? items.length : at) - 1;
    items[next].focus();
  }

  const closeMenus = () => { setMenuOpen(false); setAccountOpen(false); };
  const here = (href: string) => (pathname === href ? "page" as const : undefined);

  async function logout() {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    setSessionUser(null);
    setAccountOpen(false);
    setMenuOpen(false);
    window.location.href = "/";
  }

  const storeVisible = settingsChecked && settings?.storeSectionEnabled !== false && settings?.storeEnabled !== false;
  const brandName = settings?.brandName;
  const showGuestActions = settingsChecked && sessionChecked && !sessionUser && Boolean(onLogin);
  const roleName = sessionUser?.role === "superadmin" ? "ผู้ดูแลระบบ" : sessionUser?.role === "admin" ? "แอดมิน" : "ผู้ใช้";
  const profileHref = sessionUser?.role === "user" ? "/profile" : "/admin/profile";
  const userInitial = (sessionUser?.username || "?").charAt(0).toUpperCase();

  return (
    <>
      {menuOpen && (
        <button
          type="button"
          className="nav-menu-backdrop"
          aria-label="ปิดเมนู"
          onClick={() => { setMenuOpen(false); setAccountOpen(false); }}
        />
      )}
      <nav className="navbar" aria-label="เมนูหลัก">
        <div className="container nav-inner">
          <Link className="brand" href="/" aria-label={`${brandName || "NEXORA CLOUD"} หน้าหลัก`}>
            <img className="brand-logo" src={settings?.logoUrl || "/logo-v2.png"} alt="" />
            <span>{brandName || <>NEXORA <b>CLOUD</b></>}</span>
          </Link>
          <button
            className="hamburger icon-button"
            aria-label={menuOpen ? "ปิดเมนู" : "เปิดเมนู"}
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => {
                if (open) setAccountOpen(false);
                return !open;
              });
            }}
          >
            {menuOpen ? <X size={22} /> : <Menu size={23} />}
          </button>
          <div className={`nav-links ${menuOpen ? "open" : ""}`}>
            {/* Home / share / login / register live in homepage cards — keep navbar light. */}
            {storeVisible && (
              <Link href="/store" className={active === "store" ? "active" : undefined} onClick={() => { setMenuOpen(false); setAccountOpen(false); }}>
                <span className="nav-link-with-icon"><ShoppingCart size={15} aria-hidden="true" />ร้านค้า</span>
              </Link>
            )}

            <Link href="/changelog" className="nav-updates-link" onClick={() => { setMenuOpen(false); setAccountOpen(false); }}>
              <span className="nav-link-with-icon">{updateUnseen ? <>มีอัปเดตใหม่<i className="changelog-dot" aria-hidden="true" /></> : "อัปเดต"}</span>
            </Link>

            {showGuestActions && (
              <div className="guest-nav-actions">
                <button type="button" className="guest-nav-button" onClick={() => { setMenuOpen(false); onLogin?.(); }}>
                  เข้าสู่ระบบ
                </button>
                {settings?.registrationEnabled !== false && onRegister && (
                  <button type="button" className="guest-nav-button primary" onClick={() => { setMenuOpen(false); onRegister(); }}>
                    สมัครสมาชิก
                  </button>
                )}
              </div>
            )}

            {sessionUser ? (
              <div className={`session-actions account-menu ${accountOpen || menuOpen ? "account-open" : ""}`} ref={accountRef} onKeyDown={onAccountKey}>
                <button
                  className="user-pill user-pill-desktop"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  onClick={(event) => {
                    focusFirstItem.current = event.detail === 0;
                    setAccountOpen((open) => !open);
                  }}
                >
                  <span className="user-pill-avatar" aria-hidden="true">{userInitial}</span>
                  <span className="user-pill-name" title={sessionUser.username}>{sessionUser.username}</span>
                  <ChevronDown className={accountOpen ? "rotate" : ""} size={15} aria-hidden="true" />
                </button>
                <div className="mobile-account-head">
                  <span className="user-pill-avatar" aria-hidden="true">{userInitial}</span>
                  <div className="mobile-account-meta">
                    <strong title={sessionUser.username}>{sessionUser.username}</strong>
                    <small>{roleName}</small>
                  </div>
                </div>
                {(accountOpen || menuOpen) && (
                  <div className="account-dropdown" role="menu" aria-label="เมนูบัญชี">
                    <div className="account-summary">
                      <span className="user-pill-avatar" aria-hidden="true">{userInitial}</span>
                      <div>
                        <strong title={sessionUser.username}>{sessionUser.username}</strong>
                        <small>{roleName}</small>
                      </div>
                    </div>
                    <div className="account-divider" />
                    <Link role="menuitem" className="account-link" href="/" aria-current={here("/")} onClick={closeMenus}><Home size={17} aria-hidden="true" />หน้าหลัก</Link>
                    <Link role="menuitem" className="account-link" href="/dashboard" aria-current={here("/dashboard")} onClick={closeMenus}><LayoutDashboard size={17} aria-hidden="true" />แดชบอร์ด</Link>
                    <Link role="menuitem" className="account-link" href="/files" aria-current={here("/files")} onClick={closeMenus}><FolderOpen size={17} aria-hidden="true" />ไฟล์ของฉัน</Link>
                    <a role="menuitem" className="account-link" href={profileHref} aria-current={here(profileHref)} onClick={closeMenus}><UserRound size={17} aria-hidden="true" />โปรไฟล์</a>
                    {(sessionUser.role === "admin" || sessionUser.role === "superadmin") && (
                      <Link role="menuitem" className="account-link" href="/admin" aria-current={here("/admin")} onClick={closeMenus}><ShieldCheck size={17} aria-hidden="true" />ระบบแอดมิน</Link>
                    )}
                    <div className="account-divider" />
                    <button type="button" role="menuitem" className="account-logout" onClick={() => { void logout(); }}><LogOut size={17} aria-hidden="true" />ออกจากระบบ</button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </nav>
    </>
  );
}
