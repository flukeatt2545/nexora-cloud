"use client";
import {
  Check, ChevronDown, ChevronLeft, CircleAlert, CloudCog, Copy, Globe2, Inbox, Mail, MailPlus, Plus,
  RefreshCw, Search, Send, Settings2, X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../runtime";
import { useEscape, useScrollLock } from "./useScrollLock";
import "./hosting-view.css";
import "./db-admin-view.css";
import "./admin-mail-view.css";
import Link from "next/link";
import type { Ask } from "./types";
import { writeClipboard } from "./mailShared";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;
type DnsRecord = Record<string, unknown>;
type Domain = {
  id: string;
  domain: string;
  kind: string;
  status: string;
  dnsRecords: DnsRecord[];
  verifiedAt?: string;
  approvedAt?: string;
  ownerUsername?: string;
  mailboxCount: number;
  usedBytes?: number;
  stalwartProvisionState?: string;
  stalwartLastError?: string;
};
type DomainMailbox = {
  id: string;
  address: string;
  displayName: string;
  quotaBytes: number;
  usedBytes: number;
  dailySendLimit: number;
  status: string;
  createdAt: string;
  provisionState: string;
  provisionError: string;
  owner: string;
  members: string[];
  aliases: string[];
};
type MailHistory = { id: string; from: string; to: string; subject: string; status: string; date: string };
type StalwartHealth = { configured: boolean; healthy: boolean; error?: string };

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ทำรายการไม่สำเร็จ");
  return payload as T;
}

const domainStatus: Record<string, { label: string; tone: string }> = {
  active: { label: "ใช้งานได้", tone: "is-ok" },
  pending_dns: { label: "รอตั้ง DNS", tone: "is-wait" },
  pending_approval: { label: "รออนุมัติ", tone: "is-wait" },
  failed: { label: "DNS ไม่ผ่าน", tone: "is-bad" },
  suspended: { label: "ระงับอยู่", tone: "is-off" },
};
const statusOf = (status: string) => domainStatus[status] || { label: status.replaceAll("_", " "), tone: "is-off" };

const recordStatus: Record<string, { label: string; tone: string }> = {
  verified: { label: "ผ่าน", tone: "is-ok" },
  pending: { label: "กำลังตรวจ", tone: "is-wait" },
  not_started: { label: "ยังไม่ตั้ง", tone: "is-off" },
  failed: { label: "ไม่ผ่าน", tone: "is-bad" },
  temporary_failure: { label: "ไม่ผ่าน", tone: "is-bad" },
};

const deliveryStatus: Record<string, { label: string; tone: string }> = {
  queued: { label: "รอส่ง", tone: "is-wait" },
  sent: { label: "ส่งแล้ว", tone: "is-ok" },
  delivered: { label: "ถึงผู้รับ", tone: "is-ok" },
  failed: { label: "ส่งไม่ได้", tone: "is-bad" },
  bounced: { label: "ตีกลับ", tone: "is-bad" },
};

function when(value: string, dateOnly = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${parseFloat((bytes / 1024 ** i).toFixed(1))} ${units[i]}`;
}
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const NARROW = "(max-width: 900px)";

/**
 * Brings an element to the top of the page, under the sticky header. scrollIntoView does not
 * move the page here: body is a scroll container of its own (overflow-x: hidden).
 */
function scrollPageTo(element: Element | null) {
  if (!element) return;
  const top = element.getBoundingClientRect().top + window.scrollY - 76;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

/** A centred dialog in the page's dialog style; Esc and a click outside close it. */
function Modal({ title, eyebrow, icon, wide = false, onClose, children, footer }: {
  title: string;
  eyebrow?: string;
  icon: ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useScrollLock(true);
  useEscape(true, onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="hv-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`hv-dialog mx-modal${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="mx-modal-title">
        <header className="hv-dialog-head">
          <div className="hv-dh-main">
            <span className="hv-dh-icon" aria-hidden="true">{icon}</span>
            <div className="hv-dh-text">
              {eyebrow && <small>{eyebrow}</small>}
              <h2 id="mx-modal-title">{title}</h2>
            </div>
          </div>
          <button type="button" className="hv-btn hv-icon-btn" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
        </header>
        <div className="hv-dialog-body mx-modal-body">{children}</div>
        {footer && <footer className="hv-dialog-foot">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

export default function AdminMailView({ notify, ask, isSuperadmin = false }: { notify: Notice; ask?: Ask; isSuperadmin?: boolean }) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [history, setHistory] = useState<MailHistory[]>([]);
  const [configured, setConfigured] = useState(true);
  const [stalwart, setStalwart] = useState<StalwartHealth | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Mailboxes per domain id; a missing key means "not loaded yet".
  const [boxes, setBoxes] = useState<Record<string, DomainMailbox[] | "error">>({});

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"" | "setup" | "active">("");
  const [selectedId, setSelectedId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusBox, setFocusBox] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  const [working, setWorking] = useState("");
  const [copied, setCopied] = useState("");
  const copiedTimer = useRef<number | undefined>(undefined);
  const detailRef = useRef<HTMLElement>(null);
  // What to scroll to once the next render is on screen: "detail" or a mailbox id.
  const pendingScroll = useRef("");

  const [dialog, setDialog] = useState<"" | "domain" | "mailbox" | "dns" | "sent">("");
  const [newDomain, setNewDomain] = useState("");
  const [newKind, setNewKind] = useState("custom");
  const [domainBusy, setDomainBusy] = useState(false);
  const [mailbox, setMailbox] = useState({ domainId: "", localPart: "", displayName: "", ownerUsername: "" });
  const [mailboxBusy, setMailboxBusy] = useState(false);

  const load = useCallback(() => Promise.all([
    api<{ items: Domain[]; providerConfigured: boolean }>("/api/admin/mail/domains"),
    api<{ items: MailHistory[] }>("/api/admin/mail/messages"),
    api<StalwartHealth>("/api/admin/mail/stalwart/health").catch(() => ({ configured: false, healthy: false })),
  ]).then(([domainData, historyData, health]) => {
    setDomains(domainData.items || []);
    setConfigured(domainData.providerConfigured);
    setHistory(historyData.items || []);
    setStalwart(health);
  }), []);
  useEffect(() => {
    load().catch((error) => notify({ kind: "error", text: (error as Error).message })).finally(() => setLoaded(true));
  }, [load, notify]);

  const fetchBoxes = useCallback((domainId: string) =>
    api<{ items: DomainMailbox[] }>(`/api/admin/mail/domains/${domainId}/mailboxes`)
      .then((data) => setBoxes((current) => ({ ...current, [domainId]: data.items || [] })))
      .catch(() => setBoxes((current) => ({ ...current, [domainId]: "error" }))), []);

  const formOpen = dialog === "domain" || dialog === "mailbox";
  useScrollLock(formOpen);
  useEscape(formOpen, () => { if (!domainBusy && !mailboxBusy) setDialog(""); });

  const isSetup = (status: string) => status !== "active" && status !== "suspended";
  const counts = useMemo(() => ({
    setup: domains.filter((item) => isSetup(item.status)).length,
    active: domains.filter((item) => item.status === "active").length,
    mailboxes: domains.reduce((sum, item) => sum + (item.mailboxCount || 0), 0),
  }), [domains]);
  const activeDomains = domains.filter((item) => item.status === "active");
  const visible = domains.filter((item) => {
    if (filter === "setup" && !isSetup(item.status)) return false;
    if (filter === "active" && item.status !== "active") return false;
    const q = query.trim().toLowerCase();
    return !q || item.domain.toLowerCase().includes(q) || (item.ownerUsername || "").toLowerCase().includes(q);
  });
  const selected = domains.find((item) => item.id === selectedId) || visible[0] || null;
  // On wide screens the chosen domain is open in the list; on narrow ones only what was tapped.
  const expandedId = openId ?? selected?.id ?? "";
  const records = selected?.dnsRecords || [];
  const verifiedRecords = records.filter((record) => text(record.status) === "verified").length;
  const domainSent = selected ? history.filter((item) => item.from.toLowerCase().endsWith(`@${selected.domain.toLowerCase()}`)) : [];
  const selectedBoxes = selected ? boxes[selected.id] : undefined;

  // Load the mailboxes of whatever domain is shown or open, once.
  useEffect(() => {
    for (const id of new Set([selected?.id, expandedId])) {
      if (id && boxes[id] === undefined) void fetchBoxes(id);
    }
  }, [boxes, expandedId, fetchBoxes, selected?.id]);

  function refresh() {
    setRefreshing(true);
    const reloadBoxes = selected ? fetchBoxes(selected.id) : Promise.resolve();
    Promise.all([load(), reloadBoxes])
      .catch((error) => notify({ kind: "error", text: (error as Error).message }))
      .finally(() => setRefreshing(false));
  }
  // Scrolling waits for the render: until then the pane (or the card) is still hidden.
  useEffect(() => {
    const target = pendingScroll.current;
    if (!target) return;
    pendingScroll.current = "";
    const narrow = window.matchMedia(NARROW).matches;
    if (target === "detail") {
      if (narrow) scrollPageTo(detailRef.current);
      return;
    }
    const card = document.getElementById(`mx-box-${target}`);
    // On phones the pane has just replaced the list, so the page moves; on wide screens only
    // the card list needs to show the card.
    if (narrow) scrollPageTo(card);
    else card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  function showPane() {
    setShowDetail(true);
    pendingScroll.current = "detail";
  }
  function pickDomain(id: string) {
    const narrow = window.matchMedia(NARROW).matches;
    if (narrow) {
      // On phones the list is a menu: a tap opens the domain's mailboxes in place.
      setSelectedId(id);
      setOpenId(expandedId === id ? "" : id);
      return;
    }
    if (selected?.id === id) {
      setOpenId(expandedId === id ? "" : id);
      return;
    }
    setSelectedId(id);
    setOpenId(null);
    setFocusBox("");
  }
  function openDomain(id: string) {
    setSelectedId(id);
    setFocusBox("");
    showPane();
  }
  function pickMailbox(domainId: string, boxId: string) {
    setSelectedId(domainId);
    setFocusBox(boxId);
    setShowDetail(true);
    pendingScroll.current = boxId;
  }
  async function run(key: string, task: () => Promise<unknown>, done: string) {
    setWorking(key);
    try {
      await task();
      await load();
      notify({ kind: "success", text: done });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setWorking("");
    }
  }
  const verify = (item: Domain) => run(`verify:${item.id}`, () => api(`/api/mail/domains/${item.id}/verify`, { method: "POST" }), "ตรวจ DNS แล้ว");
  const autoDns = (item: Domain) => run(`dns:${item.id}`, () => api(`/api/mail/domains/${item.id}/dns/auto-configure`, { method: "POST" }), "สร้างระเบียน DNS ให้แล้ว รอสักครู่แล้วกดตรวจ DNS");
  const setStatus = (item: Domain, status: string, done: string) =>
    run(`status:${item.id}`, () => api(`/api/admin/mail/domains/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }), done);
  function suspend(item: Domain) {
    const go = () => setStatus(item, "suspended", "ระงับโดเมนแล้ว");
    if (!ask) return void go();
    ask({
      title: `ระงับ ${item.domain}?`,
      message: item.mailboxCount
        ? `กล่องอีเมล ${item.mailboxCount} กล่องในโดเมนนี้จะส่งและรับเมลไม่ได้จนกว่าจะเปิดใช้อีกครั้ง`
        : "โดเมนนี้จะสร้างกล่องอีเมล ส่ง และรับเมลไม่ได้จนกว่าจะเปิดใช้อีกครั้ง",
      confirmLabel: "ระงับโดเมน",
      danger: true,
      action: go,
    });
  }

  async function copy(value: string, key: string) {
    try {
      await writeClipboard(value);
      setCopied(key);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(""), 1600);
    } catch {
      notify({ kind: "error", text: "คัดลอกไม่ได้ ลองคลิกที่หน้าเว็บแล้วกดอีกครั้ง" });
    }
  }
  const copyButton = (value: string, key: string, label: string) => (
    <button type="button" className={`dbv-copy${copied === key ? " is-done" : ""}`} onClick={(event) => { event.stopPropagation(); void copy(value, key); }} aria-label={`คัดลอก${label} ${value}`} title={copied === key ? "คัดลอกแล้ว" : `คัดลอก${label}`}>
      {copied === key ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );

  async function addDomain(event: FormEvent) {
    event.preventDefault();
    setDomainBusy(true);
    try {
      const created = await api<{ id: string }>("/api/mail/domains", { method: "POST", body: JSON.stringify({ domain: newDomain.trim(), kind: newKind }) });
      setNewDomain("");
      await load();
      if (created?.id) {
        setSelectedId(created.id);
        setOpenId(null);
        setDialog("dns");
      } else {
        setDialog("");
      }
      notify({ kind: "success", text: "เพิ่มโดเมนแล้ว ขั้นต่อไปคือเพิ่มระเบียน DNS ตามตาราง" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setDomainBusy(false);
    }
  }
  async function addMailbox(event: FormEvent) {
    event.preventDefault();
    setMailboxBusy(true);
    try {
      await api("/api/mail/mailboxes", { method: "POST", body: JSON.stringify(mailbox) });
      const domainId = mailbox.domainId;
      setMailbox({ domainId: "", localPart: "", displayName: "", ownerUsername: "" });
      setDialog("");
      await Promise.all([load(), fetchBoxes(domainId)]);
      notify({ kind: "success", text: "สร้างกล่องอีเมลแล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setMailboxBusy(false);
    }
  }
  function openMailbox(domainId = "") {
    setMailbox({ domainId, localPart: "", displayName: "", ownerUsername: "" });
    setDialog("mailbox");
  }

  const setupHint = (item: Domain) => {
    if (item.status === "pending_dns") return { title: "เพิ่มระเบียน DNS ที่ผู้ให้บริการโดเมน", body: "เปิดดูค่าที่ต้องเพิ่ม คัดลอกไปใส่ แล้วกดตรวจ DNS ระบบอาจใช้เวลาสักครู่ก่อนเห็นค่าใหม่" };
    if (item.status === "failed") return { title: "ตรวจ DNS ไม่ผ่าน", body: "เปิดระเบียน DNS ดูแถวที่ขึ้นว่าไม่ผ่าน แก้ค่าให้ตรงแล้วกดตรวจอีกครั้ง" };
    if (item.status === "pending_approval") return { title: "DNS ผ่านแล้ว รออนุมัติ", body: "อนุมัติแล้วเจ้าของโดเมนจะสร้างกล่องอีเมลได้" };
    if (item.status === "suspended") return { title: "โดเมนนี้ถูกระงับ", body: "กล่องอีเมลในโดเมนนี้ส่งและรับเมลไม่ได้จนกว่าจะเปิดใช้" };
    return null;
  };

  const dnsRecords = (
    records.length ? (
      <ul className="mx-records">
        <li className="mx-record mx-record-head" aria-hidden="true"><span>ชนิด</span><span>ชื่อ</span><span>ค่า</span><span>สถานะ</span></li>
        {records.map((record, index) => {
          const type = text(record.type);
          const name = text(record.name);
          const value = text(record.value ?? record.content);
          const priority = text(record.priority);
          const state = recordStatus[text(record.status)] || { label: text(record.status) || "-", tone: "is-off" };
          return (
            <li className={`mx-record ${state.tone}`} key={index}>
              <span className="mx-type">{type}{priority ? <small>ลำดับ {priority}</small> : null}</span>
              <span className="mx-cell" data-label="ชื่อ">
                <code className="mx-val">{name || "@"}</code>
                {copyButton(name, `n${index}`, "ชื่อ")}
              </span>
              <span className="mx-cell" data-label="ค่า">
                <code className="mx-val is-long">{value}</code>
                {copyButton(value, `v${index}`, "ค่า")}
              </span>
              <span className={`mx-pill ${state.tone}`}>{state.label}</span>
            </li>
          );
        })}
      </ul>
    ) : (
      <p className="mx-empty">ยังไม่มีระเบียน DNS ลองกด ตรวจ DNS เพื่อดึงค่าจากผู้ให้บริการ</p>
    )
  );

  return (
    <div className="aov hv mx">
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">อีเมล</p>
          <h1>อีเมลโดเมน</h1>
          <p className="aov-sub">เลือกโดเมนเพื่อดูกล่องอีเมลในโดเมนนั้น ตั้งค่า DNS และสร้างกล่องให้ผู้ใช้</p>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn" onClick={refresh} disabled={refreshing} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล">
            <RefreshCw size={16} aria-hidden="true" className={refreshing ? "spin" : ""} />
          </button>
          <Link className="aov-btn aov-btn-label" href="/mail"><Mail size={16} aria-hidden="true" /> Webmail</Link>
          <button type="button" className="aov-btn aov-btn-label aov-btn-primary" onClick={() => setDialog("domain")}>
            <Plus size={16} aria-hidden="true" /> เพิ่มโดเมน
          </button>
        </div>
      </header>

      <div className="mx-health" aria-label="สถานะระบบอีเมล">
        <span className={`mx-svc ${!loaded ? "" : configured ? "is-ok" : "is-bad"}`}>
          <i aria-hidden="true" /><span>ส่งเมล</span><b>{!loaded ? "กำลังตรวจ" : configured ? "พร้อม" : "ยังไม่เชื่อม Resend"}</b>
        </span>
        <span className={`mx-svc ${!stalwart ? "" : stalwart.healthy ? "is-ok" : "is-bad"}`}>
          <i aria-hidden="true" /><span>รับเมล</span><b>{!stalwart ? "กำลังตรวจ" : !stalwart.configured ? "ยังไม่ตั้งค่า Stalwart" : stalwart.healthy ? "ออนไลน์" : "ออฟไลน์"}</b>
        </span>
        <span className="mx-tally"><b>{domains.length}</b> โดเมน <span aria-hidden="true">·</span> <b>{counts.mailboxes}</b> กล่อง</span>
        {isSuperadmin && (
          <Link className="mx-settings" href="/admin/settings?tab=mail"><Settings2 size={15} aria-hidden="true" /> ตั้งค่าการเชื่อมต่อ</Link>
        )}
      </div>

      <div className={`mx-split${showDetail || (loaded && !domains.length) ? " is-detail" : ""}${selectedId ? " has-pick" : ""}`}>
        <aside className="aov-panel mx-side" aria-label="โดเมนและกล่องอีเมล">
          <div className="mx-side-tools">
            <label className="th-search" role="search">
              <Search size={17} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
                placeholder="ค้นหาโดเมน"
                aria-label="ค้นหาโดเมน"
              />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
            </label>
            <div className="th-chips mx-filter" role="group" aria-label="สถานะ">
              <button type="button" className={filter === "" ? "is-active" : ""} aria-pressed={filter === ""} onClick={() => setFilter("")}>ทั้งหมด</button>
              <button type="button" className={filter === "setup" ? "is-active" : ""} aria-pressed={filter === "setup"} onClick={() => setFilter(filter === "setup" ? "" : "setup")}>
                รอตั้งค่า <span className="hv-chip-count">{counts.setup}</span>
              </button>
              <button type="button" className={filter === "active" ? "is-active" : ""} aria-pressed={filter === "active"} onClick={() => setFilter(filter === "active" ? "" : "active")}>
                ใช้งานได้ <span className="hv-chip-count">{counts.active}</span>
              </button>
            </div>
          </div>

          {!loaded ? (
            <ul className="mx-domains" aria-busy="true">
              {[0, 1, 2].map((i) => <li key={i} className="mx-skeleton"><span /><span /></li>)}
            </ul>
          ) : visible.length ? (
            <ul className="mx-domains">
              {visible.map((item) => {
                const state = statusOf(item.status);
                const current = selected?.id === item.id;
                const open = expandedId === item.id;
                const list = boxes[item.id];
                return (
                  <li key={item.id} className={open ? "is-open" : ""}>
                    <button
                      type="button"
                      className={`mx-domain${current ? " is-current" : ""}`}
                      aria-current={current ? "true" : undefined}
                      aria-expanded={open}
                      aria-controls={`mx-tree-${item.id}`}
                      onClick={() => pickDomain(item.id)}
                    >
                      <span className={`mx-dot ${state.tone}`} aria-hidden="true" />
                      <span className="mx-domain-copy">
                        <strong title={item.domain}>{item.domain}</strong>
                        <small>
                          {state.label} · {item.mailboxCount} กล่อง
                          {item.kind === "platform" && <span className="mx-tag">ระบบ</span>}
                        </small>
                      </span>
                      <ChevronDown size={16} aria-hidden="true" className="mx-chevron" />
                    </button>
                    {open && (
                      <ul className="mx-tree" id={`mx-tree-${item.id}`} aria-label={`กล่องอีเมลใน ${item.domain}`}>
                        <li className="mx-tree-detail">
                          <button type="button" onClick={() => openDomain(item.id)}>
                            <Settings2 size={14} aria-hidden="true" /> รายละเอียดและ DNS ของโดเมน
                          </button>
                        </li>
                        {list === undefined ? (
                          <li className="mx-tree-note" aria-busy="true">กำลังโหลดกล่องอีเมล...</li>
                        ) : list === "error" ? (
                          <li className="mx-tree-note">โหลดกล่องอีเมลไม่ได้ <button type="button" onClick={() => void fetchBoxes(item.id)}>ลองอีกครั้ง</button></li>
                        ) : !list.length ? (
                          <li className="mx-tree-note">ยังไม่มีกล่องอีเมล{item.status === "active" && <> <button type="button" onClick={() => openMailbox(item.id)}>สร้างกล่อง</button></>}</li>
                        ) : (
                          list.map((box) => (
                            <li key={box.id}>
                              <button type="button" className={focusBox === box.id && current ? "is-current" : ""} onClick={() => pickMailbox(item.id, box.id)} title={box.address}>
                                <Inbox size={14} aria-hidden="true" />
                                <span>{box.address.split("@")[0]}<small>@{item.domain}</small></span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mx-side-empty">
              {domains.length ? (
                <>ไม่พบโดเมนที่ตรงกับตัวกรอง <button type="button" onClick={() => { setQuery(""); setFilter(""); }}>ล้างตัวกรอง</button></>
              ) : "ยังไม่มีโดเมน"}
            </div>
          )}
        </aside>

        <section className="aov-panel mx-detail" ref={detailRef} aria-live="polite">
          {!loaded ? (
            <div className="mx-detail-loading"><span className="hv-spinner" aria-hidden="true" /> กำลังโหลด...</div>
          ) : !selected && domains.length ? (
            <p className="mx-empty">เลือกโดเมนจากรายการเพื่อดูรายละเอียด</p>
          ) : !selected ? (
            <div className="mx-start">
              <span className="mx-start-icon" aria-hidden="true"><Globe2 size={22} /></span>
              <h2>เริ่มจากเพิ่มโดเมน</h2>
              <ol>
                <li><b>1</b><span><strong>เพิ่มโดเมน</strong> เช่น example.com</span></li>
                <li><b>2</b><span><strong>ตั้งค่า DNS</strong> ตามค่าที่ระบบให้ แล้วกดตรวจ</span></li>
                <li><b>3</b><span><strong>สร้างกล่องอีเมล</strong> เช่น contact@example.com</span></li>
              </ol>
              <button type="button" className="hv-btn hv-btn-primary" onClick={() => setDialog("domain")}><Plus size={16} aria-hidden="true" /> เพิ่มโดเมน</button>
            </div>
          ) : (
            <>
              <header className="mx-detail-head">
                <button type="button" className="mx-back" onClick={() => setShowDetail(false)}>
                  <ChevronLeft size={16} aria-hidden="true" /> โดเมนทั้งหมด
                </button>
                <div className="mx-title">
                  <h2>{selected.domain}</h2>
                  <span className={`mx-pill ${statusOf(selected.status).tone}`}>{statusOf(selected.status).label}</span>
                </div>
                <p className="mx-meta">
                  {selected.kind === "platform" ? "โดเมนระบบ" : "โดเมนลูกค้า"}
                  {selected.ownerUsername ? <> · เจ้าของ @{selected.ownerUsername}</> : null}
                  {selected.usedBytes ? <> · ใช้ไป {formatBytes(selected.usedBytes)}</> : null}
                </p>
                <div className="mx-actions">
                  {selected.status === "active" && (
                    <button type="button" className="hv-btn hv-btn-primary" onClick={() => openMailbox(selected.id)}>
                      <MailPlus size={15} aria-hidden="true" /> สร้างกล่องอีเมล
                    </button>
                  )}
                  {selected.status === "pending_approval" && (
                    <button type="button" className="hv-btn hv-btn-primary" disabled={!!working} onClick={() => void setStatus(selected, "active", "อนุมัติโดเมนแล้ว")}>
                      <Check size={15} aria-hidden="true" /> อนุมัติ
                    </button>
                  )}
                  <button type="button" className="hv-btn" onClick={() => setDialog("dns")}>
                    <Globe2 size={15} aria-hidden="true" /> ระเบียน DNS
                    {records.length > 0 && <span className={`mx-count ${verifiedRecords === records.length ? "is-ok" : "is-wait"}`}>{verifiedRecords}/{records.length}</span>}
                  </button>
                  <button type="button" className="hv-btn" onClick={() => setDialog("sent")}>
                    <Send size={15} aria-hidden="true" /> ส่งล่าสุด <span className="mx-count">{domainSent.length}</span>
                  </button>
                  {selected.status === "active" && (
                    <button type="button" className="hv-btn hv-btn-danger-ghost hv-push" disabled={!!working} onClick={() => suspend(selected)}>ระงับโดเมน</button>
                  )}
                  {selected.status === "suspended" && (
                    <button type="button" className="hv-btn hv-push" disabled={!!working} onClick={() => void setStatus(selected, "active", "เปิดใช้โดเมนแล้ว")}>เปิดใช้อีกครั้ง</button>
                  )}
                </div>
              </header>

              {(() => {
                const hint = setupHint(selected);
                if (!hint) return null;
                return (
                  <div className={`mx-setup ${statusOf(selected.status).tone}`}>
                    <div className="mx-setup-copy">
                      <strong>{hint.title}</strong>
                      <span>{hint.body}</span>
                    </div>
                    {records.length > 0 && selected.status !== "suspended" && (
                      <div className="mx-progress" aria-label={`ผ่าน ${verifiedRecords} จาก ${records.length} ระเบียน`}>
                        <span>ผ่าน {verifiedRecords}/{records.length}</span>
                        <i><b style={{ width: `${(verifiedRecords / records.length) * 100}%` }} /></i>
                      </div>
                    )}
                    {isSetup(selected.status) && (
                      <button type="button" className="hv-btn hv-btn-primary" onClick={() => setDialog("dns")}><Globe2 size={15} aria-hidden="true" /> ดูค่า DNS</button>
                    )}
                  </div>
                );
              })()}

              {selected.stalwartLastError && (
                <div className="hv-callout is-error mx-callout">
                  <CircleAlert size={18} aria-hidden="true" />
                  <p><strong>เซิร์ฟเวอร์รับเมลมีปัญหากับโดเมนนี้</strong><span>{selected.stalwartLastError}</span></p>
                </div>
              )}

              <section className="mx-boxes" aria-labelledby="mx-boxes-title">
                <header className="mx-boxes-head">
                  <h3 id="mx-boxes-title">กล่องอีเมล</h3>
                  <span>{Array.isArray(selectedBoxes) ? selectedBoxes.length : selected.mailboxCount} กล่อง</span>
                </header>
                {selectedBoxes === undefined ? (
                  <ul className="mx-box-list" aria-busy="true">
                    {[0, 1].map((i) => <li key={i} className="mx-skeleton"><span /><span /></li>)}
                  </ul>
                ) : selectedBoxes === "error" ? (
                  <p className="mx-empty">โหลดกล่องอีเมลไม่ได้ <button type="button" onClick={() => void fetchBoxes(selected.id)}>ลองอีกครั้ง</button></p>
                ) : !selectedBoxes.length ? (
                  <div className="mx-empty">
                    <p>ยังไม่มีกล่องอีเมลในโดเมนนี้</p>
                    {selected.status === "active"
                      ? <button type="button" onClick={() => openMailbox(selected.id)}>สร้างกล่องแรก</button>
                      : <small>ตั้งค่า DNS ให้ผ่านและอนุมัติโดเมนก่อน จึงจะสร้างกล่องได้</small>}
                  </div>
                ) : (
                  <ul className="mx-box-list">
                    {selectedBoxes.map((box) => {
                      const usage = box.quotaBytes ? Math.min(100, (box.usedBytes / box.quotaBytes) * 100) : 0;
                      const broken = box.provisionState === "failed" || Boolean(box.provisionError);
                      return (
                        <li key={box.id} id={`mx-box-${box.id}`} className={`mx-box${focusBox === box.id ? " is-focus" : ""}`}>
                          <div className="mx-box-main">
                            <span className="mx-box-avatar" aria-hidden="true">{(box.displayName || box.address).charAt(0).toUpperCase()}</span>
                            <div className="mx-box-name">
                              <span className="mx-box-address">
                                <strong>{box.address}</strong>
                                {copyButton(box.address, `box:${box.id}`, "อีเมล")}
                              </span>
                              <small>{box.displayName || "ไม่มีชื่อที่แสดง"}{box.status !== "active" && <> · {box.status}</>}</small>
                            </div>
                          </div>
                          <dl className="mx-box-facts">
                            <div><dt>เจ้าของ</dt><dd>{box.owner ? `@${box.owner}` : "-"}</dd></div>
                            {box.members.length > 0 && <div><dt>สมาชิก</dt><dd>{box.members.map((name) => `@${name}`).join(", ")}</dd></div>}
                            {box.aliases.length > 0 && <div><dt>Alias</dt><dd>{box.aliases.join(", ")}</dd></div>}
                            <div><dt>สร้างเมื่อ</dt><dd>{when(box.createdAt, true)}</dd></div>
                          </dl>
                          <div className="mx-box-usage" title={`ใช้ไป ${usage.toFixed(1)}%`}>
                            <i><b className={usage > 90 ? "is-full" : ""} style={{ width: `${usage}%` }} /></i>
                            <small>{formatBytes(box.usedBytes)} จาก {formatBytes(box.quotaBytes)} · ส่งได้ {box.dailySendLimit} ฉบับต่อวัน</small>
                          </div>
                          {broken && (
                            <p className="mx-box-error"><CircleAlert size={14} aria-hidden="true" /> เซิร์ฟเวอร์รับเมลยังไม่มีกล่องนี้{box.provisionError ? `: ${box.provisionError}` : ""}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </section>
      </div>

      {dialog === "dns" && selected && (
        <Modal
          wide
          icon={<Globe2 size={20} />}
          eyebrow={selected.domain}
          title="ระเบียน DNS"
          onClose={() => setDialog("")}
          footer={
            <>
              {records.length > 0 && <span className="mx-modal-note">ผ่าน {verifiedRecords} จาก {records.length} ระเบียน</span>}
              {selected.status !== "active" && selected.status !== "suspended" && records.length > 0 && (
                <button type="button" className="hv-btn" disabled={!!working} onClick={() => void autoDns(selected)} title="สร้างระเบียนให้อัตโนมัติ (เมื่อโดเมนอยู่บน Cloudflare ของระบบ)">
                  <CloudCog size={15} aria-hidden="true" className={working === `dns:${selected.id}` ? "hv-spin" : ""} /> ตั้ง DNS ให้อัตโนมัติ
                </button>
              )}
              <button type="button" className="hv-btn hv-btn-primary" disabled={!!working} onClick={() => void verify(selected)}>
                <RefreshCw size={15} aria-hidden="true" className={working === `verify:${selected.id}` ? "hv-spin" : ""} /> ตรวจ DNS
              </button>
            </>
          }
        >
          <p className="mx-modal-lead">เพิ่มระเบียนเหล่านี้ที่ผู้ให้บริการ DNS ของโดเมน คัดลอกชื่อและค่าไปวางได้เลย</p>
          {dnsRecords}
        </Modal>
      )}

      {dialog === "sent" && selected && (
        <Modal wide icon={<Send size={20} />} eyebrow={selected.domain} title="อีเมลที่ส่งล่าสุด" onClose={() => setDialog("")}>
          {domainSent.length ? (
            <ul className="mx-sent">
              {domainSent.map((item) => {
                const state = deliveryStatus[item.status] || { label: item.status, tone: "is-off" };
                return (
                  <li key={item.id}>
                    <span className="mx-sent-copy">
                      <strong title={item.subject}>{item.subject || "(ไม่มีหัวข้อ)"}</strong>
                      <small title={`${item.from} → ${item.to}`}>{item.from} → {item.to}</small>
                    </span>
                    <span className={`mx-pill ${state.tone}`}>{state.label}</span>
                    <time>{when(item.date)}</time>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mx-empty">ยังไม่มีอีเมลที่ส่งจากโดเมนนี้</p>
          )}
        </Modal>
      )}

      {dialog === "domain" && typeof document !== "undefined" && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !domainBusy && setDialog("")}>
          <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="mx-domain-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <Globe2 size={20} className="hv-dh-icon" aria-hidden="true" />
                <div className="hv-dh-text">
                  <small>ขั้นที่ 1 จาก 3</small>
                  <h2 id="mx-domain-title">เพิ่มโดเมน</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setDialog("")} disabled={domainBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <form className="hv-form" onSubmit={addDomain}>
              <div className="hv-dialog-body">
                {!configured && (
                  <div className="hv-callout is-error">
                    <CircleAlert size={18} aria-hidden="true" />
                    <p>
                      <strong>ยังเพิ่มโดเมนไม่ได้</strong>
                      <span>{isSuperadmin ? <>ต้องเชื่อมต่อ Resend ก่อนที่ <Link href="/admin/settings?tab=mail">ตั้งค่าระบบ → ระบบอีเมล</Link></> : "ต้องให้ Superadmin เชื่อมต่อ Resend ก่อน"}</span>
                    </p>
                  </div>
                )}
                <div className="hv-field">
                  <label htmlFor="mx-domain">โดเมน <span className="hv-req">*</span></label>
                  <input id="mx-domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" required autoFocus inputMode="url" autoCapitalize="none" spellCheck={false} />
                  <small>ใส่เฉพาะชื่อโดเมน ไม่ต้องมี https:// หรือ www</small>
                </div>
                {isSuperadmin && (
                  <div className="hv-field">
                    <span>ประเภท</span>
                    <div className="th-chips mx-kind" role="radiogroup" aria-label="ประเภทโดเมน">
                      <button type="button" role="radio" aria-checked={newKind === "custom"} className={newKind === "custom" ? "is-active" : ""} onClick={() => setNewKind("custom")}>โดเมนลูกค้า</button>
                      <button type="button" role="radio" aria-checked={newKind === "platform"} className={newKind === "platform" ? "is-active" : ""} onClick={() => setNewKind("platform")}>โดเมนระบบ</button>
                    </div>
                  </div>
                )}
              </div>
              <footer className="hv-dialog-foot">
                <button type="button" className="hv-btn" onClick={() => setDialog("")} disabled={domainBusy}>ยกเลิก</button>
                <button type="submit" className="hv-btn hv-btn-primary" disabled={domainBusy || !configured || !newDomain.trim()}>
                  {domainBusy && <span className="hv-spinner" aria-hidden="true" />}
                  {domainBusy ? "กำลังเพิ่ม..." : "เพิ่มแล้วดูค่า DNS"}
                </button>
              </footer>
            </form>
          </section>
        </div>,
        document.body,
      )}

      {dialog === "mailbox" && typeof document !== "undefined" && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !mailboxBusy && setDialog("")}>
          <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="mx-mailbox-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <MailPlus size={20} className="hv-dh-icon" aria-hidden="true" />
                <div className="hv-dh-text">
                  <small>{activeDomains.find((item) => item.id === mailbox.domainId)?.domain || "โดเมนที่ใช้งานได้"}</small>
                  <h2 id="mx-mailbox-title">สร้างกล่องอีเมล</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setDialog("")} disabled={mailboxBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <form className="hv-form" onSubmit={addMailbox}>
              <div className="hv-dialog-body">
                <div className="hv-field">
                  <label htmlFor="mx-local">ที่อยู่อีเมล <span className="hv-req">*</span></label>
                  <div className="hv-domain-input mx-address">
                    <input id="mx-local" value={mailbox.localPart} onChange={(e) => setMailbox({ ...mailbox, localPart: e.target.value })} placeholder="contact" required autoFocus autoCapitalize="none" spellCheck={false} />
                    <select aria-label="โดเมน" value={mailbox.domainId} onChange={(e) => setMailbox({ ...mailbox, domainId: e.target.value })} required>
                      <option value="">@ เลือกโดเมน</option>
                      {activeDomains.map((item) => <option value={item.id} key={item.id}>@{item.domain}</option>)}
                    </select>
                  </div>
                </div>
                <div className="hv-field">
                  <label htmlFor="mx-display">ชื่อที่แสดง</label>
                  <input id="mx-display" value={mailbox.displayName} onChange={(e) => setMailbox({ ...mailbox, displayName: e.target.value })} placeholder="เช่น ฝ่ายขาย" />
                </div>
                <div className="hv-field">
                  <label htmlFor="mx-owner">เจ้าของ</label>
                  <input id="mx-owner" value={mailbox.ownerUsername} onChange={(e) => setMailbox({ ...mailbox, ownerUsername: e.target.value })} placeholder="ชื่อผู้ใช้" autoCapitalize="none" spellCheck={false} />
                  <small>เว้นว่างไว้ กล่องจะเป็นของเจ้าของโดเมน</small>
                </div>
              </div>
              <footer className="hv-dialog-foot">
                <button type="button" className="hv-btn" onClick={() => setDialog("")} disabled={mailboxBusy}>ยกเลิก</button>
                <button type="submit" className="hv-btn hv-btn-primary" disabled={mailboxBusy || !mailbox.domainId || !mailbox.localPart.trim()}>
                  {mailboxBusy && <span className="hv-spinner" aria-hidden="true" />}
                  {mailboxBusy ? "กำลังสร้าง..." : "สร้างกล่อง"}
                </button>
              </footer>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
