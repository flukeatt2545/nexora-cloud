"use client";

import {
  ChevronDown, FolderOpen, Home, LayoutDashboard, LogOut, Menu, ShieldCheck, ShoppingCart, UserRound, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { POINTS_EVENT } from "./StorePurchase";
import Link from "next/link";
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
  const updateUnseen = useChangelogUnseen();

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
    function onDocClick(event: MouseEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

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
              <div className={`session-actions account-menu ${accountOpen || menuOpen ? "account-open" : ""}`} ref={accountRef}>
                <button
                  className="user-pill user-pill-desktop"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  onClick={() => setAccountOpen((open) => !open)}
                >
                  <span className="user-pill-avatar" aria-hidden="true"><UserRound size={16} /></span>
                  <span className="user-pill-name" title={sessionUser.username}>{sessionUser.username}</span>
                  <ChevronDown className={accountOpen ? "rotate" : ""} size={15} aria-hidden="true" />
                </button>
                <div className="mobile-account-head">
                  <span className="user-pill-avatar" aria-hidden="true"><UserRound size={18} /></span>
                  <div className="mobile-account-meta">
                    <strong title={sessionUser.username}>{sessionUser.username}</strong>
                    <small>{sessionUser.role === "superadmin" ? "ผู้ดูแลระบบ" : sessionUser.role === "admin" ? "แอดมิน" : "ผู้ใช้"}</small>
                  </div>
                </div>
                {(accountOpen || menuOpen) && (
                  <div className="account-dropdown" role="menu">
                    <div className="account-summary">
                      <span className="account-avatar"><UserRound size={18} /></span>
                      <div>
                        <strong title={sessionUser.username}>{sessionUser.username}</strong>
                        <small><ShieldCheck size={13} />{sessionUser.role === "superadmin" ? "ผู้ดูแลระบบ" : sessionUser.role === "admin" ? "แอดมิน" : "ผู้ใช้"}</small>
                      </div>
                    </div>
                    <div className="account-divider" />
                    <Link role="menuitem" className="account-link" href="/" onClick={() => { setMenuOpen(false); setAccountOpen(false); }}><Home size={17} />หน้าหลัก</Link>
                    <a role="menuitem" className="account-link" href={sessionUser.role === "user" ? "/profile" : "/admin/profile"} onClick={() => { setMenuOpen(false); setAccountOpen(false); }}><UserRound size={17} />โปรไฟล์ของฉัน</a>
                    <Link role="menuitem" className="account-link" href="/dashboard" onClick={() => { setMenuOpen(false); setAccountOpen(false); }}><LayoutDashboard size={17} />แดชบอร์ด</Link>
                    <Link role="menuitem" className="account-link" href="/files" onClick={() => { setMenuOpen(false); setAccountOpen(false); }}><FolderOpen size={17} />ไฟล์ของฉัน</Link>
                    {(sessionUser.role === "admin" || sessionUser.role === "superadmin") && (
                      <Link role="menuitem" className="account-link" href="/admin" onClick={() => { setMenuOpen(false); setAccountOpen(false); }}><ShieldCheck size={17} />แดชบอร์ดผู้ดูแล</Link>
                    )}
                    <div className="account-divider" />
                    <button type="button" role="menuitem" className="account-logout" onClick={() => { void logout(); }}><LogOut size={17} />ออกจากระบบ</button>
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
