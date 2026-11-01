"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, CheckCircle2, ChevronRight, Cloud, Database, ExternalLink, KeyRound, Megaphone,
  Package, RefreshCw, Store, Users, WalletCards,
} from "lucide-react";
import Link from "next/link";
import { API_BASE } from "../runtime";

type Role = "user" | "admin" | "superadmin" | string;

type Summary = {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  activeSessions: number;
  logins24h: number;
  failedLogins24h: number;
};
type Topup = {
  id: number;
  username: string;
  displayName: string;
  amount: number;
  status: string;
  createdAt: string;
};
type TopupSummary = {
  todayAmount: number;
  todayTransactions: number;
  monthAmount: number;
  monthTransactions: number;
  configured: boolean;
  enabled: boolean;
  recentTransactions: Topup[];
};
type SalesReport = {
  summary: { revenue: number; orders: number; buyers: number };
  series: { date: string; revenue: number; orders: number }[];
};
type LogItem = {
  id: number;
  actorUsername: string;
  action: string;
  outcome: string;
  targetId: string;
  metadata?: unknown;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
};
type Health = { database: string; redis: string; databaseSize: string };

type Slot<T> = { data: T | null; failed: boolean };
const empty = { data: null, failed: false };

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "โหลดข้อมูลไม่ได้");
  return payload as T;
}

const number = (value: number) => new Intl.NumberFormat("th-TH").format(value || 0);
const amount = (value: number) => new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(value || 0);
const baht = (value: number) => new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

function ago(value: string, now: number) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((time - now) / 1000);
  const format = new Intl.RelativeTimeFormat("th", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return "เมื่อสักครู่";
  if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return format.format(Math.round(seconds / 3600), "hour");
  if (Math.abs(seconds) < 86400 * 7) return format.format(Math.round(seconds / 86400), "day");
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" }).format(new Date(time));
}

type LogRow = { key: number; action: string; actor: string; outcome: string; count: number; latest: string };
type LogDay = { key: string; label: string; rows: LogRow[] };

/**
 * Who did it. Things done in Discord through a bot have no site account, so the name comes from
 * the log details: the member's Discord name, or the bot itself when nobody pressed anything
 * (an empty room it cleared away, someone it moved out of a locked room).
 */
function logActor(item: LogItem) {
  if (item.actorUsername) return item.actorUsername;
  // A failed sign-in has no actor; the name that was typed is in targetId.
  if (item.action.startsWith("auth.") && item.targetId) return item.targetId;
  let meta = item.metadata;
  if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch { meta = null; } }
  const m = meta && typeof meta === "object" ? meta as Record<string, unknown> : {};
  const text = (key: string) => (typeof m[key] === "string" ? (m[key] as string).trim() : "");
  const name = text("actorName") || text("discordName") || text("userName") || text("deleterName");
  if (name) return `@${name} (Discord)`;
  const id = text("discordActor") || text("actorDiscordId");
  if (id) return `Discord ${id}`;
  if (item.action === "mail.message.received" && text("from")) return `จาก ${text("from").replace(/^<|>$/g, "")}`;
  if (item.action.startsWith("discord.") || item.action.startsWith("mail.discord.")) return "บอท Discord";
  // Someone on the site who was not signed in (the request came with an address or a browser).
  return item.ipAddress || item.userAgent ? "ไม่ได้เข้าสู่ระบบ" : "ระบบ";
}

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Newest first: back-to-back entries with the same action, person and result become one row ("×12"), split by day. */
function groupLogs(items: LogItem[], maxRows: number, now: number): LogDay[] {
  const today = new Date(now);
  const yesterday = new Date(now - 86400000);
  const days: LogDay[] = [];
  let rows = 0;
  for (const item of items) {
    const created = new Date(item.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const key = dayKey(created);
    let day = days[days.length - 1];
    const last = day?.key === key ? day.rows[day.rows.length - 1] : undefined;
    const actor = logActor(item);
    if (last && last.action === item.action && last.actor === actor && last.outcome === item.outcome) {
      last.count++;
      continue;
    }
    if (rows === maxRows) break;
    if (!day || day.key !== key) {
      const label = key === dayKey(today) ? "วันนี้" : key === dayKey(yesterday) ? "เมื่อวาน"
        : new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short" }).format(created);
      day = { key, label, rows: [] };
      days.push(day);
    }
    day.rows.push({ key: item.id, action: item.action, actor, outcome: item.outcome, count: 1, latest: item.createdAt });
    rows++;
  }
  return days;
}

function topupState(status: string) {
  if (status === "completed" || status === "verified") return { tone: "ok", label: "สำเร็จ" };
  if (status === "pending") return { tone: "wait", label: "รอตรวจ" };
  return { tone: "bad", label: "ไม่สำเร็จ" };
}

function PanelError({ onRetry }: { onRetry: () => void }) {
  return <div className="aov-empty">โหลดข้อมูลไม่ได้ <button type="button" onClick={onRetry}>ลองอีกครั้ง</button></div>;
}

export default function AdminOverview({ role, actionText, storeOpen = true }: { role: Role; actionText: (action: string) => string; storeOpen?: boolean }) {
  const isSuper = role === "superadmin";
  const [summary, setSummary] = useState<Slot<Summary>>(empty);
  const [topups, setTopups] = useState<Slot<TopupSummary>>(empty);
  const [sales, setSales] = useState<Slot<SalesReport>>(empty);
  const [logs, setLogs] = useState<Slot<LogItem[]>>(empty);
  const [health, setHealth] = useState<Slot<Health>>(empty);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // Until the first load finishes, "x minutes ago" counts from when the page opened.
  const [openedAt] = useState(() => Date.now());
  const [activeDay, setActiveDay] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const settle = <T,>(promise: Promise<T>, set: (slot: Slot<T>) => void) =>
      promise.then((data) => set({ data, failed: false })).catch(() => set({ data: null, failed: true }));
    await Promise.all([
      settle(get<Summary>("/api/admin/summary"), setSummary),
      settle(get<TopupSummary>("/api/admin/topups/summary"), setTopups),
      settle(get<SalesReport>("/api/admin/store/sales?days=7"), setSales),
      settle(get<Health>("/api/admin/health"), setHealth),
      isSuper ? settle(get<{ items: LogItem[] }>("/api/admin/logs?limit=50").then((r) => r.items || []), setLogs) : Promise.resolve(),
    ]);
    setUpdatedAt(Date.now());
    setLoading(false);
  }, [isSuper]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const s = summary.data;
  const t = topups.data;
  const series = sales.data?.series || [];
  const peak = Math.max(0, ...series.map((point) => point.revenue));
  const shownDay = activeDay !== null ? series[activeDay] : null;
  const now = updatedAt || openedAt;
  const logDays = useMemo(() => groupLogs(logs.data || [], 6, now), [logs.data, now]);
  const failRate = s && s.logins24h + s.failedLogins24h > 0 ? Math.round((s.failedLogins24h / (s.logins24h + s.failedLogins24h)) * 100) : 0;

  const alerts = useMemo(() => {
    const items: { key: string; tone: "bad" | "wait"; icon: typeof Store; text: string; href?: string; cta?: string }[] = [];
    if (s && s.failedLogins24h > 0) items.push({ key: "failed", tone: s.failedLogins24h >= 10 ? "bad" : "wait", icon: KeyRound, text: `เข้าสู่ระบบไม่สำเร็จ ${number(s.failedLogins24h)} ครั้งใน 24 ชม.`, href: isSuper ? "/admin/logs" : undefined, cta: "ดูบันทึก" });
    if (!storeOpen) items.push({ key: "store-closed", tone: "wait", icon: Store, text: "ร้านค้าปิดอยู่ ลูกค้าซื้อสินค้าและเติมเงินไม่ได้", href: isSuper ? "/admin/settings?tab=general#store-switch" : undefined, cta: "เปิดร้านค้า" });
    else if (t && !t.configured) items.push({ key: "topup-config", tone: "bad", icon: WalletCards, text: "ระบบเติมเงินยังตั้งค่าไม่ครบ ลูกค้าเติมเงินไม่ได้", href: isSuper ? "/admin/topups/settings" : undefined, cta: "ตั้งค่า" });
    else if (t && !t.enabled) items.push({ key: "topup-off", tone: "wait", icon: WalletCards, text: "ระบบเติมเงินปิดอยู่", href: isSuper ? "/admin/topups/settings" : undefined, cta: "ไปเปิด" });
    if (health.failed) items.push({ key: "health", tone: "bad", icon: Database, text: "ตรวจสถานะฐานข้อมูลไม่ได้" });
    return items;
  }, [s, t, health.failed, isSuper, storeOpen]);

  const today = new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const shortcuts = [
    { href: "/admin/users", label: "ผู้ใช้", icon: Users },
    { href: "/admin/store/products", label: "สินค้า", icon: Package },
    { href: "/admin/announcements", label: "ประกาศ", icon: Megaphone },
    { href: "/admin/hosting", label: "เว็บไซต์", icon: Cloud },
  ];

  return (
    <div className="aov" aria-busy={loading}>
      <header className="aov-head">
        <div>
          <h1>ภาพรวม</h1>
          <p className="aov-sub">{today}{updatedAt && <> · อัปเดต {new Intl.DateTimeFormat("th-TH", { timeStyle: "short" }).format(updatedAt)}</>}</p>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn" onClick={load} disabled={loading} aria-label="โหลดใหม่" title="โหลดใหม่">
            <RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" />
          </button>
          <a href="/" className="aov-btn aov-btn-label" target="_blank" rel="noopener">
            <ExternalLink size={16} aria-hidden="true" /> ดูหน้าเว็บ
          </a>
        </div>
      </header>

      <section className={`aov-status${alerts.length ? "" : " is-calm"}`} aria-label="เรื่องที่ต้องจัดการ">
        {alerts.length === 0 ? (
          <p className="aov-status-calm">
            <CheckCircle2 size={17} aria-hidden="true" />
            {loading && !updatedAt ? "กำลังโหลด" : "ตอนนี้ไม่มีเรื่องค้าง"}
          </p>
        ) : alerts.map((alert) => (
          <div className={`aov-alert is-${alert.tone}`} key={alert.key}>
            <alert.icon size={16} aria-hidden="true" />
            <span>{alert.text}</span>
            {alert.href && <a href={alert.href}>{alert.cta}<ChevronRight size={14} aria-hidden="true" /></a>}
          </div>
        ))}
      </section>

      <section className="aov-kpis" aria-label="สรุปตัวเลข">
        <div className="aov-kpi">
          <span className="aov-kpi-label">ผู้ใช้ทั้งหมด</span>
          <strong>{s ? number(s.totalUsers) : <i className="aov-skel" />}</strong>
          <span className="aov-kpi-note">{s ? <>ใช้งาน {number(s.activeUsers)}{s.suspendedUsers > 0 && <> · <b className="is-wait">ระงับ {number(s.suspendedUsers)}</b></>}</> : summary.failed ? "โหลดไม่ได้" : " "}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label">ล็อกอินค้างอยู่</span>
          <strong>{s ? number(s.activeSessions) : <i className="aov-skel" />}</strong>
          <span className="aov-kpi-note">{s ? "นับแยกทุกอุปกรณ์" : " "}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label">เข้าสู่ระบบ 24 ชม.</span>
          <strong>{s ? number(s.logins24h) : <i className="aov-skel" />}</strong>
          <span className="aov-kpi-note">{s ? (s.failedLogins24h > 0 ? <b className={failRate >= 30 ? "is-bad" : "is-wait"}>ไม่สำเร็จ {number(s.failedLogins24h)} ({failRate}%)</b> : s.logins24h > 0 ? "สำเร็จทุกครั้ง" : "ยังไม่มีใครเข้า") : " "}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label">เติมเงินวันนี้</span>
          <strong>{t ? <>{baht(t.todayAmount)}<small> บาท</small></> : topups.failed ? "—" : <i className="aov-skel" />}</strong>
          <span className="aov-kpi-note">{t ? `${number(t.todayTransactions)} รายการ · เดือนนี้ ${baht(t.monthAmount)} บาท` : " "}</span>
        </div>
      </section>

      <div className="aov-grid">
        <section className="aov-panel aov-sales">
          <header>
            <h2>ยอดขายร้านค้า <span>7 วันล่าสุด</span></h2>
            <Link href="/admin/store/sales">ดูรายงาน<ChevronRight size={14} aria-hidden="true" /></Link>
          </header>
          {sales.failed ? <PanelError onRetry={load} /> : <>
            <div className="aov-sales-figure" aria-live="polite">
              {shownDay ? <>
                <strong>{amount(shownDay.revenue)}<small> พอยท์</small></strong>
                <span>{new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${shownDay.date}T00:00:00`))} · {number(shownDay.orders)} คำสั่งซื้อ</span>
              </> : <>
                <strong>{sales.data ? amount(sales.data.summary.revenue) : <i className="aov-skel" />}<small> พอยท์</small></strong>
                <span>{sales.data ? `${number(sales.data.summary.orders)} คำสั่งซื้อ · ผู้ซื้อ ${number(sales.data.summary.buyers)} คน` : " "}</span>
              </>}
            </div>
            <div className="aov-bars-wrap">
              {sales.data && peak === 0 && <p className="aov-bars-note">ยังไม่มียอดขาย</p>}
              <div className="aov-bars" onMouseLeave={() => setActiveDay(null)}>
              {(series.length ? series : Array.from({ length: 7 }, (_, i) => ({ date: String(i), revenue: 0, orders: 0 }))).map((point, index) => {
                const date = new Date(`${point.date}T00:00:00`);
                const label = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("th-TH", { weekday: "narrow" }).format(date);
                const height = peak > 0 && point.revenue > 0 ? Math.max(6, (point.revenue / peak) * 100) : 2;
                return (
                  <button key={point.date} type="button" className={`aov-bar${activeDay === index ? " is-active" : ""}${point.revenue === 0 ? " is-zero" : ""}`}
                    disabled={!series.length} onMouseEnter={() => setActiveDay(index)} onFocus={() => setActiveDay(index)} onBlur={() => setActiveDay(null)}
                    onClick={() => setActiveDay(activeDay === index ? null : index)}
                    aria-label={series.length ? `${label} ${amount(point.revenue)} พอยท์` : undefined}>
                    <span className="aov-bar-track"><span className="aov-bar-fill" style={{ height: `${height}%` }} /></span>
                    <span className="aov-bar-day">{label}</span>
                  </button>
                );
              })}
              </div>
            </div>
          </>}
        </section>

        <section className="aov-panel aov-topups">
          <header>
            <h2>เติมเงินล่าสุด</h2>
            <Link href="/admin/topups/transactions">ดูทั้งหมด<ChevronRight size={14} aria-hidden="true" /></Link>
          </header>
          {topups.failed ? <PanelError onRetry={load} /> : !t ? <ul className="aov-list">{[0, 1, 2].map((i) => <li key={i}><i className="aov-skel wide" /></li>)}</ul>
            : t.recentTransactions.length === 0 ? <div className="aov-empty">ยังไม่มีรายการเติมเงิน</div>
            : <ul className="aov-list">
              {t.recentTransactions.slice(0, 5).map((item) => {
                const state = topupState(item.status);
                return (
                  <li key={item.id}>
                    <span className={`aov-dot is-${state.tone}`} title={state.label} aria-hidden="true" />
                    <span className="aov-list-main">
                      <strong>{item.displayName || item.username}</strong>
                      <small>{ago(item.createdAt, now)}{state.tone !== "ok" && <> · <b className={`is-${state.tone}`}>{state.label}</b></>}</small>
                    </span>
                    <span className="aov-list-value">{baht(item.amount)}<small> บาท</small></span>
                  </li>
                );
              })}
            </ul>}
        </section>

        {isSuper && (
          <section className="aov-panel aov-logs">
            <header>
              <h2>กิจกรรมล่าสุด</h2>
              <Link href="/admin/logs">ดูทั้งหมด<ChevronRight size={14} aria-hidden="true" /></Link>
            </header>
            {logs.failed ? <PanelError onRetry={load} /> : !logs.data ? <ul className="aov-list">{[0, 1, 2].map((i) => <li key={i}><i className="aov-skel wide" /></li>)}</ul>
              : logDays.length === 0 ? <div className="aov-empty">ยังไม่มีกิจกรรม</div>
              : <div className="aov-days">
                {logDays.map((day) => (
                  <div key={day.key}>
                    <h3 className="aov-day">{day.label}</h3>
                    <ul className="aov-list">
                      {day.rows.map((row) => (
                        <li key={row.key}>
                          <span className={`aov-dot is-${row.outcome === "success" ? "ok" : "bad"}`} title={row.outcome === "success" ? "สำเร็จ" : "ไม่สำเร็จ"} aria-hidden="true" />
                          <span className="aov-list-main">
                            <strong>
                              {actionText(row.action)}
                              {row.count > 1 && <span className="aov-count" aria-label={`${row.count} ครั้ง`}>×{number(row.count)}</span>}
                              {row.outcome !== "success" && <b className="is-bad"> · ไม่สำเร็จ</b>}
                            </strong>
                            <small>{row.actor || "ไม่ระบุผู้ใช้"}</small>
                          </span>
                          <time className="aov-list-time" dateTime={row.latest}>
                            {day.label === "วันนี้" ? ago(row.latest, now) : new Intl.DateTimeFormat("th-TH", { timeStyle: "short" }).format(new Date(row.latest))}
                          </time>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>}
          </section>
        )}

        <section className={`aov-panel aov-side${isSuper ? "" : " is-wide"}`}>
          <header><h2>ทางลัด</h2></header>
          <nav className="aov-shortcuts" aria-label="ทางลัด">
            {shortcuts.map((item) => (
              <a key={item.href} href={item.href}>
                <item.icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
                <ArrowRight size={15} aria-hidden="true" className="aov-shortcut-arrow" />
              </a>
            ))}
          </nav>
          <div className="aov-system">
            <h3>สถานะระบบ</h3>
            <dl>
              <div><dt>ฐานข้อมูล</dt><dd>{health.data ? <><span className="aov-dot is-ok" aria-hidden="true" />ปกติ{health.data.databaseSize && <small> · {health.data.databaseSize}</small>}</> : health.failed ? <><span className="aov-dot is-bad" aria-hidden="true" />ตรวจไม่ได้</> : "…"}</dd></div>
              <div><dt>แคช (Redis)</dt><dd>{health.data ? <><span className="aov-dot is-ok" aria-hidden="true" />ปกติ</> : health.failed ? <><span className="aov-dot is-bad" aria-hidden="true" />ตรวจไม่ได้</> : "…"}</dd></div>
              <div><dt>ระบบเติมเงิน</dt><dd>{t ? (t.configured && t.enabled ? <><span className="aov-dot is-ok" aria-hidden="true" />เปิดอยู่</> : <><span className={`aov-dot is-${t.configured ? "wait" : "bad"}`} aria-hidden="true" />{t.configured ? "ปิดอยู่" : "ตั้งค่าไม่ครบ"}</>) : "…"}</dd></div>
              {s && <div><dt>บัญชีที่ระงับ</dt><dd>{number(s.suspendedUsers)}</dd></div>}
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
