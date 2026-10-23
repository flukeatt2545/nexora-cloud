"use client";

import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  CircleDollarSign,
  Clock3,
  Eye,
  KeyRound,
  Landmark,
  Package,
  ReceiptText,
  RefreshCw,
  Undo2,
  Save,
  Search,
  Settings2,
  ShoppingBag,
  TrendingUp,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { API_BASE } from "../runtime";
import { coverCropStyle, type CoverCrop } from "../lib/coverCrop";
import SmartImage from "../components/SmartImage";

type Notify = (notice: { kind: "success" | "error"; text: string }) => void;

type TopupTransaction = {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  amount: number;
  status: string;
  provider: string;
  verificationId: string;
  transRef: string;
  confidenceScore?: number;
  providerStatus: string;
  receiverMatch?: boolean;
  transactionDate?: string;
  createdAt: string;
  verifiedAt?: string;
};

type Summary = {
  totalAmount: number;
  totalTransactions: number;
  todayAmount: number;
  todayTransactions: number;
  monthAmount: number;
  monthTransactions: number;
  uniqueUsers: number;
  configured: boolean;
  enabled: boolean;
  configSource: string;
  recentTransactions: TopupTransaction[];
};

type TopupSettings = {
  enabled: boolean;
  configured: boolean;
  source: string;
  apiTokenConfigured: boolean;
  tenantId: string;
  receiverBankCode: string;
  receiverBankName: string;
  receiverAccountNumber: string;
  receiverAccountName: string;
  updatedAt?: string;
};

function topupSettingsSignature(settings: TopupSettings) {
  return JSON.stringify({
    enabled: settings.enabled,
    tenantId: settings.tenantId,
    receiverBankCode: settings.receiverBankCode,
    receiverBankName: settings.receiverBankName,
    receiverAccountNumber: settings.receiverAccountNumber,
    receiverAccountName: settings.receiverAccountName,
  });
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ไม่สามารถดำเนินการได้");
  return payload as T;
}

function money(value: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function dateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(status: string) {
  if (status === "completed" || status === "verified") return "สำเร็จ";
  if (status === "pending") return "กำลังตรวจสอบ";
  return "ไม่สำเร็จ";
}

function Heading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="topup-page-heading">
    <div className="dash-heading"><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>
    {actions && <div className="topup-heading-actions">{actions}</div>}
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  const state = status === "completed" || status === "verified" ? "success" : status === "pending" ? "pending" : "failed";
  return <span className={`topup-status ${state}`}>{state === "success" ? <CheckCircle2 size={13} /> : state === "pending" ? <Clock3 size={13} /> : <X size={13} />}{statusLabel(status)}</span>;
}

function EmptyRows({ columns, text }: { columns: number; text: string }) {
  return <tr><td className="topup-empty" colSpan={columns}><ReceiptText size={28} /><span>{text}</span></td></tr>;
}

function TransactionsTable({ items, onView, loading = false, emptyText = "ยังไม่มีรายการเติมเงิน" }: { items: TopupTransaction[]; onView: (id: number) => void; loading?: boolean; emptyText?: string }) {
  return <div className="topup-table-wrap">
    <table className="topup-table topup-tx-table">
      <thead><tr><th>รายการ</th><th>ผู้ใช้</th><th>ยอดเงิน</th><th>สถานะ</th><th>วันที่</th><th><span className="sr-only">ดูรายละเอียด</span></th></tr></thead>
      <tbody>{items.length === 0 ? <EmptyRows columns={6} text={loading ? "กำลังโหลด..." : emptyText} /> : items.map((item) => <tr key={item.id}>
        <td data-label="รายการ"><strong>#{item.id}</strong><small>{item.transRef || item.verificationId || "ไม่มีเลขอ้างอิง"}</small></td>
        <td data-label="ผู้ใช้"><strong>{item.displayName || item.username}</strong><small>@{item.username}</small></td>
        <td data-label="ยอดเงิน"><b className="topup-amount">{money(item.amount)}</b><small>บาท</small></td>
        <td data-label="สถานะ"><StatusBadge status={item.status} /></td>
        <td data-label="วันที่"><span>{dateTime(item.createdAt)}</span></td>
        <td className="topup-row-action"><button type="button" onClick={() => onView(item.id)} aria-label={`ดูรายละเอียดรายการ ${item.id}`} title="ดูรายละเอียด"><Eye size={17} /></button></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function TopupOverviewView({ notify, canConfigure = false }: { notify: Notify; canConfigure?: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSummary(await api<Summary>("/api/admin/topups/summary")); setFailed(false); }
    catch (error) { setFailed(true); notify({ kind: "error", text: (error as Error).message }); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const s = summary;
  const count = (value: number) => new Intl.NumberFormat("th-TH").format(value || 0);
  const average = s && s.monthTransactions > 0 ? s.monthAmount / s.monthTransactions : 0;
  const state = !s ? null : !s.configured ? "bad" : !s.enabled ? "wait" : "ok";
  const value = (amount: number | undefined) => s ? <>{money(amount || 0)}<small> บาท</small></> : failed ? "—" : <i className="aov-skel" />;

  return <div className="aov topup-overview" aria-busy={loading}>
    <header className="aov-head">
      <div>
        <h1>ระบบเติมเงิน</h1>
        <p className="aov-sub">ยอดเติมเงินจากสลิปที่ตรวจผ่าน CheckSlips</p>
      </div>
      <div className="aov-head-actions">
        <button type="button" className="aov-btn" onClick={load} disabled={loading} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล">
          <RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" />
        </button>
        {canConfigure && <Link href="/admin/topups/settings" className="aov-btn aov-btn-label"><Settings2 size={16} aria-hidden="true" /> ตั้งค่า</Link>}
      </div>
    </header>

    {state && <section className={`aov-status${state === "ok" ? " is-calm" : ""}`} aria-label="สถานะระบบเติมเงิน">
      {state === "ok" ? <p className="aov-status-calm"><CheckCircle2 size={17} aria-hidden="true" />เปิดรับเติมเงินอยู่ ลูกค้าเติมได้ตามปกติ</p>
        : <div className={`aov-alert is-${state}`}>
          <WalletCards size={16} aria-hidden="true" />
          <span>{state === "bad" ? "ตั้งค่ายังไม่ครบ ลูกค้าเติมเงินไม่ได้" : "ปิดรับเติมเงินอยู่ ลูกค้าจะไม่เห็นช่องทางเติมเงิน"}</span>
          {canConfigure && <Link href="/admin/topups/settings">{state === "bad" ? "ตั้งค่าให้ครบ" : "เปิดใช้งาน"}<ChevronRight size={14} aria-hidden="true" /></Link>}
        </div>}
    </section>}

    <section className="aov-kpis" aria-label="ยอดเติมเงิน">
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CalendarDays size={16} /></span>วันนี้</span>
        <strong>{value(s?.todayAmount)}</strong>
        <span className="aov-kpi-note">{s ? `${count(s.todayTransactions)} รายการ` : " "}</span>
      </div>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CalendarRange size={16} /></span>เดือนนี้</span>
        <strong>{value(s?.monthAmount)}</strong>
        <span className="aov-kpi-note">{s ? (s.monthTransactions > 0 ? `${count(s.monthTransactions)} รายการ · เฉลี่ย ${money(average)} บาท` : "ยังไม่มีรายการ") : " "}</span>
      </div>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><WalletCards size={16} /></span>ยอดสะสมทั้งหมด</span>
        <strong>{value(s?.totalAmount)}</strong>
        <span className="aov-kpi-note">{s ? `${count(s.totalTransactions)} รายการ` : " "}</span>
      </div>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Users size={16} /></span>ผู้ใช้ที่เคยเติม</span>
        <strong>{s ? <>{count(s.uniqueUsers)}<small> บัญชี</small></> : failed ? "—" : <i className="aov-skel" />}</strong>
        <span className="aov-kpi-note">{s && s.uniqueUsers > 0 ? `เฉลี่ย ${money(s.totalAmount / s.uniqueUsers)} บาทต่อคน` : " "}</span>
      </div>
    </section>

    <section className="aov-panel topup-recent">
      <header>
        <h2><ReceiptText size={17} aria-hidden="true" className="aov-h-icon" />รายการล่าสุด</h2>
        <Link href="/admin/topups/transactions">ประวัติทั้งหมด<ChevronRight size={14} aria-hidden="true" /></Link>
      </header>
      {failed && !s ? <div className="aov-empty">โหลดข้อมูลไม่ได้ <button type="button" onClick={load}>ลองอีกครั้ง</button></div>
        : <TransactionsTable items={s?.recentTransactions || []} onView={setDetailId} loading={!s} />}
    </section>
    {detailId !== null && <TransactionDetail id={detailId} onClose={() => setDetailId(null)} notify={notify} />}
  </div>;
}

const topupStatusFilters = [
  { value: "", label: "ทั้งหมด" },
  { value: "completed", label: "สำเร็จ" },
  { value: "pending", label: "รอตรวจ" },
  { value: "failed", label: "ไม่สำเร็จ" },
];
const topupPeriodFilters = [
  { value: "today", label: "วันนี้" },
  { value: "7d", label: "7 วัน" },
  { value: "30d", label: "30 วัน" },
  { value: "all", label: "ทั้งหมด" },
];

function initialTopupFilters() {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const status = params.get("status") || "";
  const period = params.get("period") || "30d";
  return {
    q: (params.get("q") || "").slice(0, 80),
    status: topupStatusFilters.some((item) => item.value === status) ? status : "",
    period: topupPeriodFilters.some((item) => item.value === period) ? period : "30d",
    page: Math.max(1, Math.floor(Number(params.get("page"))) || 1),
  };
}

export function TopupTransactionsView({ notify }: { notify: Notify }) {
  const [initial] = useState(initialTopupFilters);
  const [items, setItems] = useState<TopupTransaction[]>([]);
  const [query, setQuery] = useState(initial.q);
  const [search, setSearch] = useState(initial.q);
  const [status, setStatus] = useState(initial.status);
  const [period, setPeriod] = useState(initial.period);
  const [page, setPage] = useState(initial.page);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const perPage = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage), period });
    if (search) params.set("q", search);
    if (status) params.set("status", status);
    try {
      const result = await api<{ items: TopupTransaction[]; total: number }>(`/api/admin/topups/transactions?${params}`);
      setItems(result.items || []); setTotal(result.total || 0); setFailed(false);
    } catch (error) { setFailed(true); notify({ kind: "error", text: (error as Error).message }); }
    finally { setLoading(false); }
  }, [notify, page, period, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Search as you type, a moment after the last key.
  useEffect(() => {
    const next = query.trim();
    if (next === search) return;
    const timer = window.setTimeout(() => { setSearch(next); setPage(1); }, 350);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  // Keep the filters in the address bar so a refresh or a shared link shows the same list.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (status) params.set("status", status);
    if (period !== "30d") params.set("period", period);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [search, status, period, page]);

  const pages = Math.max(1, Math.ceil(total / perPage));
  const filtered = Boolean(search || status || period !== "30d");
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);

  function submitSearch(event: FormEvent) { event.preventDefault(); setPage(1); setSearch(query.trim()); }
  function clearFilters() { setQuery(""); setSearch(""); setStatus(""); setPeriod("30d"); setPage(1); }
  function goTo(next: number) { setPage(next); document.querySelector(".topup-history")?.scrollIntoView({ block: "start", behavior: "smooth" }); }

  return <div className="aov topup-history" aria-busy={loading}>
    <header className="aov-head">
      <div>
        <h1>ประวัติการเติมเงิน</h1>
        <p className="aov-sub">ค้นหาและตรวจผลการยืนยันสลิปย้อนหลัง</p>
      </div>
      <div className="aov-head-actions">
        <button type="button" className="aov-btn" onClick={load} disabled={loading} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล">
          <RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" />
        </button>
      </div>
    </header>

    <section className="aov-panel">
      <div className="th-filters">
        <form className="th-search" onSubmit={submitSearch} role="search">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
            placeholder="ค้นหาชื่อผู้ใช้หรือเลขอ้างอิง" aria-label="ค้นหารายการเติมเงิน" maxLength={80} enterKeyHint="search" />
          {query && <button type="button" onClick={() => { setQuery(""); setSearch(""); setPage(1); }} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
        </form>
        <div className="th-chips" role="group" aria-label="สถานะ">
          {topupStatusFilters.map((item) => <button key={item.value || "all"} type="button" className={status === item.value ? "is-active" : ""} aria-pressed={status === item.value} onClick={() => { setStatus(item.value); setPage(1); }}>{item.label}</button>)}
        </div>
        <div className="th-chips" role="group" aria-label="ช่วงเวลา">
          {topupPeriodFilters.map((item) => <button key={item.value} type="button" className={period === item.value ? "is-active" : ""} aria-pressed={period === item.value} onClick={() => { setPeriod(item.value); setPage(1); }}>{item.label}</button>)}
        </div>
      </div>
      <div className="th-meta" aria-live="polite">
        <span>{loading && !items.length ? "กำลังโหลด..." : total === 0 ? "ไม่พบรายการ" : `${from.toLocaleString("th-TH")}–${to.toLocaleString("th-TH")} จาก ${total.toLocaleString("th-TH")} รายการ`}</span>
        {filtered && <button type="button" onClick={clearFilters}>ล้างตัวกรอง</button>}
      </div>
      {failed && !items.length ? <div className="aov-empty">โหลดข้อมูลไม่ได้ <button type="button" onClick={load}>ลองอีกครั้ง</button></div>
        : <TransactionsTable items={items} onView={setDetailId} loading={loading} emptyText={filtered ? "ไม่พบรายการที่ตรงกับตัวกรอง" : undefined} />}
      {pages > 1 && <footer className="th-pages">
        <button type="button" onClick={() => goTo(page - 1)} disabled={page <= 1 || loading}><ChevronLeft size={16} aria-hidden="true" />ก่อนหน้า</button>
        <span>หน้า {page} / {pages}</span>
        <button type="button" onClick={() => goTo(page + 1)} disabled={page >= pages || loading}>ถัดไป<ChevronRight size={16} aria-hidden="true" /></button>
      </footer>}
    </section>
    {detailId !== null && <TransactionDetail id={detailId} onClose={() => setDetailId(null)} notify={notify} />}
  </div>;
}

function CopyValue({ value, label, notify }: { value?: string; label: string; notify: Notify }) {
  if (!value) return <span className="is-none">ไม่มีข้อมูล</span>;
  async function copy() {
    try { await navigator.clipboard.writeText(value || ""); notify({ kind: "success", text: `คัดลอก${label}แล้ว` }); }
    catch { notify({ kind: "error", text: "คัดลอกไม่ได้" }); }
  }
  return <span className="topup-copy"><span>{value}</span><button type="button" onClick={copy} aria-label={`คัดลอก${label}`} title="คัดลอก"><Copy size={14} /></button></span>;
}

function TransactionDetail({ id, onClose, notify }: { id: number; onClose: () => void; notify: Notify }) {
  const [item, setItem] = useState<TopupTransaction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    api<{ item: TopupTransaction }>(`/api/admin/topups/transactions/${id}`).then((data) => setItem(data.item)).catch((error) => { notify({ kind: "error", text: error.message }); onClose(); }).finally(() => setLoading(false));
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [id, notify, onClose]);

  return <div className="system-dialog-backdrop topup-detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="topup-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="topup-detail-title">
      <header><div><ReceiptText size={20} /><span><small>รายละเอียดรายการ</small><h2 id="topup-detail-title">#{id}</h2></span></div><button type="button" onClick={onClose} aria-label="ปิด"><X size={18} /></button></header>
      {loading || !item ? <div className="topup-detail-loading"><RefreshCw className="spin" size={22} /> กำลังโหลดข้อมูล</div> : <>
        <div className="topup-detail-total"><span>ยอดเติมเงิน</span><strong>{money(item.amount)} <small>บาท</small></strong><StatusBadge status={item.status} /></div>
        <dl className="topup-detail-grid">
          <div><dt>ผู้ใช้</dt><dd>{item.displayName || item.username}<small>@{item.username} · ID {item.userId}</small></dd></div>
          <div><dt>ผู้ให้บริการ</dt><dd>{item.provider || <span className="is-none">ไม่มีข้อมูล</span>}<small>{item.providerStatus || "ไม่ระบุสถานะ"}</small></dd></div>
          <div><dt>เลขอ้างอิงธุรกรรม</dt><dd><CopyValue value={item.transRef} notify={notify} label="เลขอ้างอิง" /></dd></div>
          <div><dt>Verification ID</dt><dd><CopyValue value={item.verificationId} notify={notify} label="Verification ID" /></dd></div>
          <div><dt>บัญชีผู้รับ</dt><dd>{item.receiverMatch === true ? <span className="is-ok"><CheckCircle2 size={15} aria-hidden="true" />ตรงกับที่ตั้งค่า</span> : item.receiverMatch === false ? <span className="is-bad"><X size={15} aria-hidden="true" />ไม่ตรงกับที่ตั้งค่า</span> : <span className="is-none">ไม่มีข้อมูล</span>}</dd></div>
          <div><dt>ความมั่นใจ</dt><dd>{typeof item.confidenceScore === "number" ? `${(item.confidenceScore * (item.confidenceScore <= 1 ? 100 : 1)).toFixed(1)}%` : <span className="is-none">ไม่มีข้อมูล</span>}</dd></div>
          <div><dt>เวลาบนสลิป</dt><dd>{item.transactionDate ? dateTime(item.transactionDate) : <span className="is-none">ไม่มีข้อมูล</span>}</dd></div>
          <div><dt>เวลาที่ตรวจสอบ</dt><dd>{dateTime(item.verifiedAt || item.createdAt)}</dd></div>
        </dl>
      </>}
    </section>
  </div>;
}

export function TopupSettingsView({ notify }: { notify: Notify }) {
  const [data, setData] = useState<TopupSettings | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [clearApiToken, setClearApiToken] = useState(false);
  const [savedSignature, setSavedSignature] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api<TopupSettings>("/api/admin/topups/settings");
      setData(next);
      setSavedSignature(topupSettingsSignature(next));
    }
    catch (error) { notify({ kind: "error", text: (error as Error).message }); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const hasChanges = useMemo(() => Boolean(data && (topupSettingsSignature(data) !== savedSignature || apiToken || clearApiToken)), [apiToken, clearApiToken, data, savedSignature]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data) return;
    setSaving(true);
    try {
      const next = await api<TopupSettings>("/api/admin/topups/settings", { method: "PATCH", body: JSON.stringify({ ...data, apiToken, clearApiToken }) });
      setData(next); setApiToken(""); setClearApiToken(false);
      setSavedSignature(topupSettingsSignature(next));
      notify({ kind: "success", text: "บันทึกการตั้งค่าระบบเติมเงินแล้ว" });
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
    finally { setSaving(false); }
  }

  return <>
    <Heading eyebrow="การเงิน" title="ตั้งค่าระบบเติมเงิน" description="เชื่อมต่อ CheckSlips และกำหนดบัญชีที่ใช้รับเงิน" />
    {loading || !data ? <div className="topup-settings-loading"><RefreshCw className="spin" size={20} /> กำลังโหลดการตั้งค่า</div> : <form className="topup-settings-form" onSubmit={save}>
      <section className="topup-settings-section">
        <header><span><Settings2 size={19} /></span><div><h2>สถานะบริการ</h2><p>ปิดชั่วคราวได้โดยไม่ลบค่าการเชื่อมต่อ</p></div><label className="topup-switch"><input type="checkbox" checked={data.enabled} onChange={(event) => setData({ ...data, enabled: event.target.checked })} /><span /><b>{data.enabled ? "เปิดใช้งาน" : "ปิดใช้งาน"}</b></label></header>
      </section>

      <section className="topup-settings-section">
        <header><span><KeyRound size={19} /></span><div><h2>CheckSlips API</h2><p>ข้อมูลลับจะถูกเข้ารหัสก่อนเก็บในฐานข้อมูล</p></div></header>
        <div className="topup-form-grid">
          <label className="wide"><span>API Token</span><input type="password" value={apiToken} disabled={clearApiToken} onChange={(event) => setApiToken(event.target.value)} placeholder={data.apiTokenConfigured ? "ตั้งค่าแล้ว · เว้นว่างเพื่อใช้ค่าเดิม" : "กรอก API Token"} autoComplete="new-password" /><small>ระบบจะไม่แสดง Token ที่บันทึกไว้</small></label>
          <label><span>Tenant ID</span><input value={data.tenantId} onChange={(event) => setData({ ...data, tenantId: event.target.value })} placeholder="Tenant ID จาก CheckSlips" /></label>
          <label className="topup-clear-secret"><input type="checkbox" checked={clearApiToken} onChange={(event) => { setClearApiToken(event.target.checked); if (event.target.checked) setApiToken(""); }} /><span>ลบ API Token ที่บันทึกไว้</span></label>
        </div>
      </section>

      <section className="topup-settings-section">
        <header><span><Landmark size={19} /></span><div><h2>บัญชีรับเงิน</h2><p>ใช้ตรวจว่าผู้รับในสลิปตรงกับบัญชีของระบบ</p></div></header>
        <div className="topup-form-grid">
          <label><span>รหัสธนาคาร</span><input value={data.receiverBankCode} onChange={(event) => setData({ ...data, receiverBankCode: event.target.value.toUpperCase() })} placeholder="เช่น KBANK" /></label>
          <label><span>ชื่อธนาคาร</span><input value={data.receiverBankName} onChange={(event) => setData({ ...data, receiverBankName: event.target.value })} placeholder="ชื่อธนาคาร" /></label>
          <label><span>เลขบัญชี / พร้อมเพย์</span><input value={data.receiverAccountNumber} onChange={(event) => setData({ ...data, receiverAccountNumber: event.target.value })} placeholder="เลขบัญชีที่รับเงินจริง" inputMode="numeric" /></label>
          <label><span>ชื่อบัญชี</span><input value={data.receiverAccountName} onChange={(event) => setData({ ...data, receiverAccountName: event.target.value })} placeholder="ชื่อผู้รับเงิน" /></label>
        </div>
      </section>

      <footer className={`topup-settings-actions ${hasChanges ? "changed" : "current"}`}>
        <div><i aria-hidden="true" /><span>{saving ? "กำลังบันทึกข้อมูล" : hasChanges ? "มีการเปลี่ยนแปลง" : "ข้อมูลเป็นปัจจุบัน"}</span></div>
        <button className="dash-primary" type="submit" disabled={saving || !hasChanges}>{saving ? <RefreshCw size={17} className="spin" /> : <Save size={17} />}{saving ? "กำลังบันทึก" : "บันทึกการเปลี่ยนแปลง"}</button>
      </footer>
    </form>}
  </>;
}

type StoreOrder = {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  productId: number;
  productTitle: string;
  pricePaid: number;
  purchasedAt: string;
  refundedAt?: string | null;
  refundReason: string;
  refundedBy: string;
};

const orderStatusFilters = [
  { value: "all", label: "ทั้งหมด" },
  { value: "active", label: "ใช้งานอยู่" },
  { value: "refunded", label: "คืนพอยท์แล้ว" },
];

export function StoreOrdersView({ notify }: { notify: Notify }) {
  const [initial] = useState(() => {
    const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
    const status = params.get("status") || "all";
    return {
      q: (params.get("q") || "").slice(0, 80),
      status: orderStatusFilters.some((item) => item.value === status) ? status : "all",
      page: Math.max(1, Math.floor(Number(params.get("page"))) || 1),
    };
  });
  const [items, setItems] = useState<StoreOrder[]>([]);
  const [query, setQuery] = useState(initial.q);
  const [search, setSearch] = useState(initial.q);
  const [status, setStatus] = useState(initial.status);
  const [page, setPage] = useState(initial.page);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ revenue: 0, refunded: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refundTarget, setRefundTarget] = useState<StoreOrder | null>(null);
  const perPage = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage), status });
    if (search) params.set("q", search);
    try {
      const result = await api<{ items: StoreOrder[]; total: number; summary: { revenue: number; refunded: number } }>(`/api/admin/store/orders?${params}`);
      setItems(result.items || []);
      setTotal(result.total || 0);
      setSummary(result.summary || { revenue: 0, refunded: 0 });
      setFailed(false);
    } catch (error) { setFailed(true); notify({ kind: "error", text: (error as Error).message }); }
    finally { setLoading(false); }
  }, [notify, page, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const next = query.trim();
    if (next === search) return;
    const timer = window.setTimeout(() => { setSearch(next); setPage(1); }, 350);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (status !== "all") params.set("status", status);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [search, status, page]);

  const pages = Math.max(1, Math.ceil(total / perPage));
  const filtered = Boolean(search || status !== "all");
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);

  function submitSearch(event: FormEvent) { event.preventDefault(); setPage(1); setSearch(query.trim()); }
  function goTo(next: number) { setPage(next); document.querySelector(".store-orders")?.scrollIntoView({ block: "start", behavior: "smooth" }); }

  return <div className="aov store-orders" aria-busy={loading}>
    <header className="aov-head">
      <div>
        <h1>คำสั่งซื้อ</h1>
        <p className="aov-sub">ดูว่าใครซื้ออะไร และคืนพอยท์เมื่อมีปัญหา</p>
      </div>
      <div className="aov-head-actions">
        <button type="button" className="aov-btn" onClick={load} disabled={loading} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล">
          <RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" />
        </button>
      </div>
    </header>

    <section className="aov-kpis so-kpis" aria-label="สรุปคำสั่งซื้อ">
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><ReceiptText size={16} /></span>{filtered ? "คำสั่งซื้อที่พบ" : "คำสั่งซื้อทั้งหมด"}</span>
        <strong>{loading && !items.length && !total ? <i className="aov-skel" /> : total.toLocaleString("th-TH")}</strong>
      </div>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CircleDollarSign size={16} /></span>ยอดขาย</span>
        <strong>{money(summary.revenue)}<small> พอยท์</small></strong>
      </div>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Undo2 size={16} /></span>คืนพอยท์แล้ว</span>
        <strong>{money(summary.refunded)}<small> พอยท์</small></strong>
      </div>
    </section>

    <section className="aov-panel">
      <div className="th-filters">
        <form className="th-search" onSubmit={submitSearch} role="search">
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
            placeholder="ค้นหาผู้ซื้อ สินค้า หรือเลขคำสั่งซื้อ" aria-label="ค้นหาคำสั่งซื้อ" maxLength={80} enterKeyHint="search" />
          {query && <button type="button" onClick={() => { setQuery(""); setSearch(""); setPage(1); }} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
        </form>
        <div className="th-chips" role="group" aria-label="สถานะ">
          {orderStatusFilters.map((item) => <button key={item.value} type="button" className={status === item.value ? "is-active" : ""} aria-pressed={status === item.value} onClick={() => { setStatus(item.value); setPage(1); }}>{item.label}</button>)}
        </div>
      </div>
      <div className="th-meta" aria-live="polite">
        <span>{loading && !items.length ? "กำลังโหลด..." : total === 0 ? "ไม่พบรายการ" : `${from.toLocaleString("th-TH")}–${to.toLocaleString("th-TH")} จาก ${total.toLocaleString("th-TH")} รายการ`}</span>
        {filtered && <button type="button" onClick={() => { setQuery(""); setSearch(""); setStatus("all"); setPage(1); }}>ล้างตัวกรอง</button>}
      </div>
      {failed && !items.length ? <div className="aov-empty">โหลดข้อมูลไม่ได้ <button type="button" onClick={load}>ลองอีกครั้ง</button></div> : <div className="topup-table-wrap">
        <table className="topup-table store-orders-table">
          <thead><tr><th>คำสั่งซื้อ</th><th>ผู้ซื้อ</th><th>สินค้า</th><th>ราคา</th><th>สถานะ</th><th><span className="sr-only">จัดการ</span></th></tr></thead>
          <tbody>{items.length === 0 ? <EmptyRows columns={6} text={loading ? "กำลังโหลด..." : filtered ? "ไม่พบคำสั่งซื้อที่ตรงกับตัวกรอง" : "ยังไม่มีคำสั่งซื้อ"} /> : items.map((item) => <tr key={item.id} className={item.refundedAt ? "is-refunded" : ""}>
            <td data-label="คำสั่งซื้อ"><strong>#{item.id}</strong><small>{dateTime(item.purchasedAt)}</small></td>
            <td data-label="ผู้ซื้อ"><strong>{item.displayName || item.username}</strong><small>@{item.username} · ID {item.userId}</small></td>
            <td data-label="สินค้า"><strong>{item.productTitle}</strong><small>สินค้า #{item.productId}</small></td>
            <td data-label="ราคา">{item.pricePaid > 0 ? <><b className="topup-amount">{money(item.pricePaid)}</b><small>พอยท์</small></> : <b className="topup-amount">ฟรี</b>}</td>
            <td data-label="สถานะ">{item.refundedAt
              ? <><span className="topup-status failed"><Undo2 size={13} />คืนพอยท์แล้ว</span><small className="so-refund-note" title={item.refundReason}>{dateTime(item.refundedAt)}{item.refundedBy ? ` · @${item.refundedBy}` : ""}{item.refundReason ? ` · ${item.refundReason}` : ""}</small></>
              : <span className="topup-status success"><CheckCircle2 size={13} />ใช้งานอยู่</span>}</td>
            <td className="topup-row-action">{!item.refundedAt && <button type="button" className="store-order-refund-btn" onClick={() => setRefundTarget(item)} title="คืนพอยท์"><Undo2 size={15} /> คืนพอยท์</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {pages > 1 && <footer className="th-pages">
        <button type="button" onClick={() => goTo(page - 1)} disabled={page <= 1 || loading}><ChevronLeft size={16} aria-hidden="true" />ก่อนหน้า</button>
        <span>หน้า {page} / {pages}</span>
        <button type="button" onClick={() => goTo(page + 1)} disabled={page >= pages || loading}>ถัดไป<ChevronRight size={16} aria-hidden="true" /></button>
      </footer>}
    </section>
    {refundTarget && <RefundDialog order={refundTarget} notify={notify} onClose={() => setRefundTarget(null)} onDone={() => { setRefundTarget(null); void load(); }} />}
  </div>;
}

function RefundDialog({ order, notify, onClose, onDone }: { order: StoreOrder; notify: Notify; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [busy, onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) { setError("กรุณาระบุเหตุผล ผู้ซื้อจะเห็นเหตุผลนี้ในประวัติพอยท์"); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ message: string }>(`/api/admin/store/orders/${order.id}/refund`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      notify({ kind: "success", text: result.message || "คืนพอยท์แล้ว" });
      onDone();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  return <div className="system-dialog-backdrop topup-detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <form className="topup-detail-dialog store-refund-dialog" role="dialog" aria-modal="true" aria-labelledby="store-refund-title" onSubmit={submit}>
      <header><div><Undo2 size={20} /><span><small>คำสั่งซื้อ #{order.id}</small><h2 id="store-refund-title">คืนพอยท์</h2></span></div><button type="button" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button></header>
      <div className="topup-detail-total"><span>คืนให้ {order.displayName || order.username}</span><strong>{money(order.pricePaid)} <small>พอยท์</small></strong></div>
      <ul className="store-refund-effects">
        <li>พอยท์ {money(order.pricePaid)} จะกลับเข้าบัญชี @{order.username} ทันที</li>
        <li>ผู้ซื้อจะดาวน์โหลด “{order.productTitle}” ไม่ได้อีก จนกว่าจะซื้อใหม่</li>
        <li>ถ้าสินค้ามีสต็อกจำกัด ระบบจะคืนสต็อก 1 ชิ้น</li>
      </ul>
      <label className="store-refund-reason">
        <span>เหตุผล <small>(ผู้ซื้อจะเห็นในประวัติพอยท์)</small></span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={3} placeholder="เช่น ไฟล์เสีย ดาวน์โหลดไม่ได้" autoFocus />
      </label>
      {error && <p className="store-refund-error" role="alert">{error}</p>}
      <footer className="store-refund-actions">
        <button type="button" onClick={onClose} disabled={busy}>ยกเลิก</button>
        <button type="submit" className="danger" disabled={busy}>{busy ? "กำลังคืนพอยท์..." : `คืน ${money(order.pricePaid)} พอยท์`}</button>
      </footer>
    </form>
  </div>;
}

type SalesPoint = { date: string; revenue: number; orders: number };
type SalesProduct = {
  id: number;
  title: string;
  coverImageUrl: string;
  coverCrop?: CoverCrop | null;
  price: number;
  isVisible: boolean;
  soldCount: number;
  revenue: number;
  refundCount: number;
  refunded: number;
  lastSoldAt?: string | null;
};
type SalesReport = {
  days: number;
  unit: "day" | "month";
  summary: { revenue: number; orders: number; buyers: number; refunded: number; refundCount: number };
  series: SalesPoint[];
  products: SalesProduct[];
};

const salesPeriods = [
  { days: 7, label: "7 วัน" },
  { days: 30, label: "30 วัน" },
  { days: 90, label: "90 วัน" },
  { days: 365, label: "1 ปี" },
  { days: 0, label: "ทั้งหมด" },
];

function points(value: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(value || 0);
}

function bucketLabel(date: string, unit: "day" | "month", long = false) {
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) return date;
  const options: Intl.DateTimeFormatOptions = unit === "month"
    ? { month: "short", year: "2-digit" }
    : long ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat("th-TH", options).format(value);
}

export function StoreSalesView({ notify }: { notify: Notify }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await api<SalesReport>(`/api/admin/store/sales?days=${days}`)); }
    catch (error) { notify({ kind: "error", text: (error as Error).message }); }
    finally { setLoading(false); }
  }, [days, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = report?.summary;
  const series = report?.series || [];
  const unit = report?.unit || "day";
  const peak = Math.max(0, ...series.map((point) => point.revenue));
  const shown = active !== null && series[active] ? series[active] : null;
  const products = report?.products || [];
  const sold = products.filter((product) => product.soldCount > 0 || product.refundCount > 0);
  const unsold = products.length - sold.length;
  const periodLabel = salesPeriods.find((period) => period.days === days)?.label || "";
  const axis = series.length > 1 ? [series[0], series[Math.floor((series.length - 1) / 2)], series[series.length - 1]] : series;

  return <div className="aov store-sales" aria-busy={loading}>
    <header className="aov-head">
      <div>
        <h1>ยอดขาย</h1>
        <p className="aov-sub">รายได้และสินค้าขายดี ไม่รวมคำสั่งซื้อที่คืนพอยท์แล้ว</p>
      </div>
      <div className="aov-head-actions">
        <div className="th-chips" role="group" aria-label="ช่วงเวลา">
          {salesPeriods.map((period) => <button key={period.days} type="button" className={period.days === days ? "is-active" : ""} aria-pressed={period.days === days} onClick={() => { setDays(period.days); setActive(null); }}>{period.label}</button>)}
        </div>
        <button type="button" className="aov-btn" onClick={load} disabled={loading} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล">
          <RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" />
        </button>
      </div>
    </header>

    <section className="aov-kpis" aria-label={`สรุปยอดขาย ${periodLabel}`}>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CircleDollarSign size={16} /></span>รายได้</span>
        <strong>{summary ? <>{points(summary.revenue)}<small> พอยท์</small></> : <i className="aov-skel" />}</strong>
        <span className="aov-kpi-note">{periodLabel === "ทั้งหมด" ? "ตั้งแต่เปิดร้าน" : `${periodLabel}ล่าสุด`}</span>
      </div>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><ShoppingBag size={16} /></span>ขายแล้ว</span>
        <strong>{summary ? <>{summary.orders.toLocaleString("th-TH")}<small> คำสั่งซื้อ</small></> : <i className="aov-skel" />}</strong>
        <span className="aov-kpi-note">{summary && summary.orders > 0 ? `เฉลี่ย ${points(summary.revenue / summary.orders)} พอยท์ต่อคำสั่งซื้อ` : " "}</span>
      </div>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Users size={16} /></span>ผู้ซื้อ</span>
        <strong>{summary ? <>{summary.buyers.toLocaleString("th-TH")}<small> บัญชี</small></> : <i className="aov-skel" />}</strong>
        <span className="aov-kpi-note">{summary && summary.buyers > 0 ? `ซื้อเฉลี่ย ${(summary.orders / summary.buyers).toLocaleString("th-TH", { maximumFractionDigits: 1 })} ชิ้นต่อคน` : " "}</span>
      </div>
      <div className="aov-kpi">
        <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Undo2 size={16} /></span>คืนพอยท์</span>
        <strong>{summary ? <>{points(summary.refunded)}<small> พอยท์</small></> : <i className="aov-skel" />}</strong>
        <span className="aov-kpi-note">{summary ? `${summary.refundCount.toLocaleString("th-TH")} คำสั่งซื้อ` : " "}</span>
      </div>
    </section>

    <section className="aov-panel store-sales-chart-panel">
      <header>
        <h2><TrendingUp size={17} aria-hidden="true" className="aov-h-icon" />รายได้{unit === "month" ? "รายเดือน" : "รายวัน"}</h2>
        <div className="ss-readout" aria-live="polite">
          <b>{points(shown ? shown.revenue : summary?.revenue || 0)}<small> พอยท์</small></b>
          <span>{shown ? `${bucketLabel(shown.date, unit, true)} · ${shown.orders.toLocaleString("th-TH")} คำสั่งซื้อ` : "ชี้หรือแตะที่แท่งเพื่อดูแต่ละช่วง"}</span>
        </div>
      </header>
      {series.length === 0 ? <div className="store-sales-chart-empty">{loading ? "กำลังโหลด..." : "ยังไม่มีข้อมูล"}</div> : <div className="store-sales-chart">
        <div className="store-sales-bars" onMouseLeave={() => setActive(null)} role="group" aria-label={`รายได้${unit === "month" ? "รายเดือน" : "รายวัน"} สูงสุด ${points(peak)} พอยท์`}>
          {series.map((point, index) => <button key={point.date} type="button" className={`store-sales-bar${index === active ? " active" : ""}${point.revenue === 0 ? " empty" : ""}`}
            onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(active === index ? null : index)}
            aria-label={`${bucketLabel(point.date, unit, true)} รายได้ ${points(point.revenue)} พอยท์ ${point.orders} คำสั่งซื้อ`}>
            <i style={{ height: peak > 0 ? `${Math.max(point.revenue > 0 ? 3 : 0, (point.revenue / peak) * 100)}%` : "0%" }} />
          </button>)}
        </div>
        <div className="store-sales-axis" aria-hidden="true">{axis.map((point, index) => <span key={`${point.date}-${index}`}>{bucketLabel(point.date, unit)}</span>)}</div>
      </div>}
    </section>

    <section className="aov-panel store-sales-products">
      <header>
        <h2><Package size={17} aria-hidden="true" className="aov-h-icon" />ยอดขายตามสินค้า <span>{loading && !report ? "" : `${sold.length.toLocaleString("th-TH")} สินค้ามียอดขาย${unsold > 0 ? ` · ยังไม่มียอด ${unsold.toLocaleString("th-TH")}` : ""}`}</span></h2>
        <Link href="/admin/store/orders">คำสั่งซื้อ<ChevronRight size={14} aria-hidden="true" /></Link>
      </header>
      <div className="topup-table-wrap">
        <table className="topup-table store-sales-table">
          <thead><tr><th>สินค้า</th><th>ขายแล้ว</th><th>รายได้</th><th>คืนพอยท์</th><th>ขายล่าสุด</th></tr></thead>
          <tbody>{products.length === 0 ? <EmptyRows columns={5} text={loading ? "กำลังโหลด..." : "ยังไม่มีสินค้า"} /> : products.map((product) => {
            const share = summary && summary.revenue > 0 ? (product.revenue / summary.revenue) * 100 : 0;
            return <tr key={product.id} className={product.soldCount === 0 && product.refundCount === 0 ? "is-unsold" : ""}>
              <td data-label="สินค้า"><div className="store-sales-product">
                <span className="store-sales-thumb">{product.coverImageUrl
                  ? <SmartImage src={product.coverImageUrl} alt="" compact style={coverCropStyle(product.coverCrop)} />
                  : <Package size={16} aria-hidden="true" />}</span>
                <span><strong>{product.title}</strong><small>{product.price > 0 ? `${points(product.price)} พอยท์` : "ฟรี"}{product.isVisible ? "" : " · ซ่อนอยู่"}</small></span>
              </div></td>
              <td data-label="ขายแล้ว"><strong>{product.soldCount.toLocaleString("th-TH")}</strong><small>ชิ้น</small></td>
              <td data-label="รายได้"><b className="topup-amount">{points(product.revenue)}</b><small>{share > 0 ? `${share >= 10 ? share.toFixed(0) : share.toFixed(1)}% ของรายได้` : "พอยท์"}</small>
                {share > 0 && <span className="store-sales-share" aria-hidden="true"><i style={{ width: `${Math.min(100, share)}%` }} /></span>}</td>
              <td data-label="คืนพอยท์">{product.refundCount > 0 ? <><strong>{product.refundCount.toLocaleString("th-TH")}</strong><small>{points(product.refunded)} พอยท์</small></> : <small>ไม่มี</small>}</td>
              <td data-label="ขายล่าสุด"><small>{product.lastSoldAt ? dateTime(product.lastSoldAt) : "ยังไม่มียอดขาย"}</small></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
