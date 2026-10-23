"use client";

// /admin/bots: every Discord bot users run here. Admins add a bot (their own or for someone),
// stop one that misbehaves, give one more memory, and set how many bots a person may have.
// Built on the shared admin page parts (aov-*, hv-*, th-*) like the databases and hosting pages;
// only the bot-specific pieces live in bots-view.css (bf-*).
import { Activity, Bot as BotIcon, CheckCircle2, CircleAlert, CircleDot, ExternalLink, MemoryStick, Minus, Plus, Power, RefreshCw, RotateCcw, Search, SlidersHorizontal, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Ask, Notify } from "./types";
import { useEscape, useScrollLock } from "./useScrollLock";
import { BotAvatar, botApi, botIsUp, botSend, botStatusView, errorMessage, runtimeLabel, type Bot, type StatusTone } from "./botsShared";
import BotCreateWizard from "./BotCreateWizard";
import Link from "next/link";
import "./admin-overview.css";
import "./hosting-view.css";
import "./bots-view.css";

type Owner = { id: number; username: string; limit: number | null; bots: number };
type Filter = "all" | "online" | "bad" | "off";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "online", label: "ออนไลน์" },
  { id: "bad", label: "มีปัญหา" },
  { id: "off", label: "ปิดอยู่" },
];

// Status pill per tone, in the hosting page's colours.
const statusClass: Record<StatusTone, string> = { online: "is-running", busy: "is-provisioning", bad: "is-error", off: "" };

const memoryOptions = [128, 256, 384, 512, 768, 1024, 1536, 2048];
const cpuOptions = [100, 250, 500, 750, 1000, 1500, 2000];
const diskOptions = [256, 512, 1024, 2048, 4096];

const megabytes = (value: number) => (value >= 1024 ? `${(value / 1024).toLocaleString("th-TH", { maximumFractionDigits: 2 })} GB` : `${value} MB`);
const cores = (millicores: number) => (millicores / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const clock = (date: Date) => date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function StatusIcon({ tone }: { tone: StatusTone }) {
  if (tone === "online") return <CheckCircle2 size={13} aria-hidden="true" />;
  if (tone === "busy") return <span className="hv-spinner bf-status-spin" aria-hidden="true" />;
  if (tone === "bad") return <CircleAlert size={13} aria-hidden="true" />;
  return <CircleDot size={13} aria-hidden="true" />;
}

export default function AdminBotsView({ notify, ask }: { notify: Notify; ask: Ask }) {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(2);
  const [failed, setFailed] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Bot | null>(null);
  const [creating, setCreating] = useState(false);
  const [limits, setLimits] = useState<Record<number, string>>({});
  const [finder, setFinder] = useState("");
  const [found, setFound] = useState<Owner[] | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await botApi<{ items: Bot[]; owners: Owner[]; defaultLimit: number }>("/api/admin/bots");
      setBots(data.items);
      setOwners(data.owners);
      setDefaultLimit(data.defaultLimit);
      setLoadedAt(new Date());
      setFailed("");
    } catch (error) {
      setFailed(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  // Look people up as the admin types, once they pause.
  useEffect(() => {
    const needle = finder.trim();
    const timer = window.setTimeout(() => {
      if (!needle) { setFound(null); return; }
      botApi<{ items: Owner[] }>(`/api/admin/bot-limits?q=${encodeURIComponent(needle)}`).then((data) => setFound(data.items)).catch(() => setFound([]));
    }, needle ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [finder]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Everything counts by the status the row shows, so the summary, the chips and the rows agree.
  const counts = useMemo(() => {
    const list = bots || [];
    const tones: Record<StatusTone, number> = { online: 0, busy: 0, bad: 0, off: 0 };
    for (const bot of list) tones[botStatusView(bot).tone] += 1;
    const up = list.filter(botIsUp);
    return { all: list.length, ...tones, up: up.length, memory: up.reduce((sum, bot) => sum + bot.resources.memoryMb, 0) };
  }, [bots]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (bots || []).filter((bot) => {
      if (filter !== "all" && botStatusView(bot).tone !== filter) return false;
      if (!needle) return true;
      return [bot.name, bot.discord.username, bot.owner?.username || ""].some((value) => value.toLowerCase().includes(needle));
    });
  }, [bots, filter, query]);

  function stop(bot: Bot) {
    ask({
      title: `ปิด ${bot.name}`,
      message: `บอทของ ${bot.owner?.username || "ผู้ใช้"} จะออฟไลน์ เจ้าของเปิดใหม่ได้เองจากหน้าของเขา`,
      confirmLabel: "ปิดบอท",
      danger: true,
      action: async () => {
        await botApi(`/api/bots/${encodeURIComponent(bot.id)}/operations`, botSend("POST", { action: "stop" }));
        notify({ kind: "success", text: `กำลังปิด ${bot.name}` });
        void load();
      },
    });
  }

  async function saveLimit(owner: Owner) {
    const raw = (limits[owner.id] ?? "").trim();
    const limit = raw === "" ? null : Number(raw);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 50)) {
      notify({ kind: "error", text: "โควตาต้องเป็นตัวเลข 0 ถึง 50 หรือเว้นว่างเพื่อใช้ค่าเริ่มต้น" });
      return;
    }
    try {
      await botApi(`/api/admin/bot-limits/${owner.id}`, botSend("PATCH", { limit }));
      notify({ kind: "success", text: limit === null ? `${owner.username} ใช้โควตาเริ่มต้น ${defaultLimit} ตัว` : `${owner.username} สร้างบอทได้ ${limit} ตัว` });
      forgetLimit(owner.id);
      setFinder("");
      void load();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    }
  }

  function forgetLimit(id: number) {
    setLimits((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  function stepLimit(owner: Owner, by: number) {
    const raw = limits[owner.id] ?? (owner.limit ?? "").toString();
    const now = raw === "" ? defaultLimit : Number(raw);
    setLimits((current) => ({ ...current, [owner.id]: String(Math.min(50, Math.max(0, now + by))) }));
  }

  const quotaRow = (owner: Owner) => {
    const dirty = limits[owner.id] !== undefined;
    const raw = limits[owner.id] ?? (owner.limit ?? "").toString();
    const value = raw === "" ? defaultLimit : Number(raw);
    const allowed = owner.limit ?? defaultLimit;
    return (
      <li key={owner.id} className={`hv-row bf-quota-row${dirty ? " is-dirty" : ""}`}>
        <div className="hv-site">
          <span className="bf-initial" aria-hidden="true">{owner.username.charAt(0).toUpperCase()}</span>
          <div className="hv-site-copy">
            <span className="bf-quota-name">{owner.username}</span>
            <small className={`hv-site-domain${owner.bots > allowed ? " bf-over" : ""}`}><span className="bf-nowrap">มี {owner.bots} จาก {allowed} ตัว</span>{owner.limit === null && <span className="bf-nowrap"> · ค่าเริ่มต้น</span>}</small>
          </div>
        </div>
        <form className="bf-quota-edit" onSubmit={(event: FormEvent) => { event.preventDefault(); void saveLimit(owner); }}>
          <span className="bf-stepper">
            <button type="button" onClick={() => stepLimit(owner, -1)} disabled={value <= 0} aria-label={`ลดโควตาของ ${owner.username}`}><Minus size={15} aria-hidden="true" /></button>
            <input inputMode="numeric" value={raw} onChange={(event) => setLimits((current) => ({ ...current, [owner.id]: event.target.value.replace(/[^0-9]/g, "") }))} onKeyDown={(event) => { if (event.key === "Escape" && dirty) { event.stopPropagation(); forgetLimit(owner.id); } }} placeholder={String(defaultLimit)} aria-label={`โควตาของ ${owner.username} (เว้นว่างเพื่อใช้ค่าเริ่มต้น)`} />
            <button type="button" onClick={() => stepLimit(owner, 1)} disabled={value >= 50} aria-label={`เพิ่มโควตาของ ${owner.username}`}><Plus size={15} aria-hidden="true" /></button>
          </span>
          <span className="bf-quota-save">
            <button type="submit" className="hv-btn hv-btn-primary" disabled={!dirty}>บันทึก</button>
            <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => forgetLimit(owner.id)} disabled={!dirty} aria-label={`ยกเลิกการแก้โควตาของ ${owner.username}`} title="ยกเลิก"><X size={15} aria-hidden="true" /></button>
          </span>
        </form>
      </li>
    );
  };

  const loading = bots === null && !failed;
  const empty = bots !== null && bots.length === 0;
  const filtering = filter !== "all" || Boolean(query.trim());
  const skel = (value: string | number) => (bots ? value : <i className="aov-skel" />);
  const noResult = filter === "bad" && !query.trim()
    ? "ตอนนี้ไม่มีบอทที่มีปัญหา"
    : filter === "online" && !query.trim()
      ? "ยังไม่มีบอทตัวไหนออนไลน์"
      : filter === "off" && !query.trim()
        ? "ไม่มีบอทที่ปิดอยู่"
        : "ไม่พบบอทที่ตรงกับตัวกรอง";

  return (
    <div className="bt bt-admin aov hv bf" aria-busy={loading}>
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">เว็บไซต์</p>
          <h1>บอทของผู้ใช้</h1>
          <p className="aov-sub">บอท Discord ที่ผู้ใช้รันบนเซิร์ฟเวอร์ เพิ่มบอทให้ใครก็ได้ ปิดตัวที่มีปัญหา ปรับทรัพยากร และกำหนดโควตา</p>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn" onClick={() => void refresh()} disabled={refreshing} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล">
            <RefreshCw size={16} aria-hidden="true" className={refreshing ? "spin" : ""} />
          </button>
          <button type="button" className="aov-btn aov-btn-label aov-btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> เพิ่มบอท
          </button>
        </div>
      </header>

      {failed && (
        <div className="aov-status" role="alert">
          <div className="aov-alert is-bad">
            <CircleAlert size={18} aria-hidden="true" />
            <span>ดึงรายการบอทไม่สำเร็จ: {failed}{bots ? " (ข้อมูลที่เห็นเป็นรอบก่อน)" : ""}</span>
            <button type="button" className="bf-retry" onClick={() => void refresh()} disabled={refreshing}>ลองอีกครั้ง</button>
          </div>
        </div>
      )}

      <section className="aov-kpis" aria-label="สรุปบอท">
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><BotIcon size={16} /></span>บอททั้งหมด</span>
          <strong>{skel(counts.all.toLocaleString("th-TH"))}</strong>
          <span className="aov-kpi-note">{bots ? `กำลังเปิดหรือปิด ${counts.busy} ตัว` : "กำลังโหลด"}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Activity size={16} /></span>ออนไลน์</span>
          <strong className={counts.online ? "is-ok" : ""}>{skel(counts.online.toLocaleString("th-TH"))}</strong>
          <span className="aov-kpi-note">{bots ? `ปิดอยู่ ${counts.off} ตัว` : "กำลังโหลด"}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CircleAlert size={16} /></span>มีปัญหา</span>
          <strong className={counts.bad ? "is-bad" : ""}>{skel(counts.bad.toLocaleString("th-TH"))}</strong>
          <span className="aov-kpi-note">โค้ดพังหรือเปิดไม่สำเร็จ</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><MemoryStick size={16} /></span>RAM ที่จองไว้</span>
          <strong>{skel(megabytes(counts.memory))}</strong>
          <span className="aov-kpi-note">{bots ? `ของบอทที่เปิดอยู่ ${counts.up} ตัว` : "กำลังโหลด"}</span>
        </div>
      </section>

      <section className="aov-panel" aria-label="รายการบอท">
        {!empty && (
          <div className="th-filters">
            <label className="th-search" role="search">
              <Search size={17} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); } }}
                placeholder="ค้นชื่อบอท ชื่อใน Discord หรือเจ้าของ"
                aria-label="ค้นบอท"
              />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="ล้างคำค้น"><X size={15} /></button>}
            </label>
            <div className="th-chips" role="group" aria-label="กรองสถานะ">
              {filters.map((item) => (
                <button key={item.id} type="button" className={filter === item.id ? "is-active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                  {item.label}{item.id !== "all" && <span className="hv-chip-count">{bots ? counts[item.id] : "–"}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {!empty && (
          <div className="th-meta" aria-live="polite">
            <span>{loading ? "กำลังโหลด..." : bots === null ? "ยังโหลดรายการไม่ได้" : `${shown.length.toLocaleString("th-TH")} จาก ${counts.all.toLocaleString("th-TH")} บอท`}</span>
            {filtering
              ? <button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>ล้างตัวกรอง</button>
              : loadedAt && <span className="bf-synced">อัปเดตอัตโนมัติ · {clock(loadedAt)}</span>}
          </div>
        )}

        {loading && (
          <ul className="hv-list" aria-busy="true">
            {[0, 1, 2].map((index) => <li className="hv-row is-skeleton" key={index}><span /><span /><span /></li>)}
          </ul>
        )}

        {empty && (
          <div className="aov-empty hv-empty bf-empty">
            <span>ยังไม่มีใครเพิ่มบอท ผู้ใช้เพิ่มเองได้ที่เมนู บอท Discord แต่ละคนสร้างได้ {defaultLimit} ตัวเป็นค่าเริ่มต้น</span>
            <div className="bf-empty-actions">
              <button type="button" onClick={() => setCreating(true)}>เพิ่มบอทตัวแรก</button>
              <Link href="/bots">ดูหน้าที่ผู้ใช้เห็น</Link>
            </div>
          </div>
        )}

        {bots && bots.length > 0 && shown.length === 0 && (
          <div className="aov-empty hv-empty">
            <span>{noResult}</span>
            <button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>ดูบอททั้งหมด</button>
          </div>
        )}

        {shown.length > 0 && (
          <ul className="hv-list">
            <li className="hv-row bf-row hv-row-head" aria-hidden="true">
              <span>บอท</span><span>เจ้าของ</span><span>ทรัพยากร</span><span>สถานะ</span><span />
            </li>
            {shown.map((bot) => {
              const view = botStatusView(bot);
              const used = bot.resources.diskUsedMb;
              const fill = used === null ? 0 : Math.min(100, (used / Math.max(1, bot.resources.diskLimitMb)) * 100);
              const disk = `ดิสก์ ${used ?? "–"} / ${megabytes(bot.resources.diskLimitMb)}`;
              return (
                <li key={bot.id} className={`hv-row bf-row${view.tone === "bad" ? " bf-row-bad" : ""}`}>
                  <div className="hv-site">
                    <BotAvatar bot={bot} size={36} />
                    <div className="hv-site-copy">
                      <a className="hv-site-name" href={`/bots?id=${encodeURIComponent(bot.id)}`} title={bot.name}>{bot.name}</a>
                      <small className="hv-site-domain bf-sub">
                        <span className={`bf-rt is-${bot.runtime}`}>{runtimeLabel[bot.runtime]}</span>
                        {bot.discord.username ? <span className="bf-handle">@{bot.discord.username}</span> : <span>ยังไม่ใส่โทเคน</span>}
                      </small>
                      <small className="hv-site-meta">
                        @{bot.owner?.username || "-"} · <span className="bf-nowrap">{bot.resources.memoryMb} MB · {cores(bot.resources.cpuMillicores)} คอร์</span> · <span className="bf-nowrap">{disk}</span>
                      </small>
                    </div>
                  </div>
                  <span className="hv-cell hv-owner" title={bot.owner?.username || "-"}>@{bot.owner?.username || "-"}</span>
                  <span className="bf-res">
                    <span>{bot.resources.memoryMb} MB · {cores(bot.resources.cpuMillicores)} คอร์</span>
                    <small>{disk}</small>
                    <span className={`bf-meter${fill >= 95 ? " is-full" : fill >= 80 ? " is-high" : ""}`} role="img" aria-label={used === null ? "ยังไม่รู้พื้นที่ที่ใช้" : `ใช้ดิสก์ไป ${Math.round(fill)}%`}><i style={{ width: `${fill}%` }} /></span>
                  </span>
                  <span className="bf-state">
                    <span className={`hv-status ${statusClass[view.tone]}`}><StatusIcon tone={view.tone} />{view.label}</span>
                    {bot.restartCount > 0 && <small><RotateCcw size={12} aria-hidden="true" />รีสตาร์ตเอง {bot.restartCount} ครั้ง</small>}
                  </span>
                  <div className="hv-row-actions">
                    <a className="hv-btn hv-icon-btn" href={`/bots?id=${encodeURIComponent(bot.id)}`} title="เปิดหน้าบอท (คอนโซล ไฟล์)" aria-label={`เปิดหน้าบอท ${bot.name}`}><ExternalLink size={16} aria-hidden="true" /></a>
                    <button type="button" className="hv-btn hv-icon-btn" onClick={() => setEditing(bot)} title="ปรับทรัพยากร" aria-label={`ปรับทรัพยากร ${bot.name}`}><SlidersHorizontal size={16} aria-hidden="true" /></button>
                    <button type="button" className="hv-btn hv-btn-danger-ghost bf-stop" onClick={() => stop(bot)} disabled={!botIsUp(bot) || Boolean(bot.pending)} title={botIsUp(bot) ? "ปิดบอท" : "บอทไม่ได้ทำงานอยู่"} aria-label={`ปิดบอท ${bot.name}`}><Power size={15} aria-hidden="true" /><span>ปิดบอท</span></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="aov-panel bf-quota" aria-labelledby="bf-quota-title">
        <header>
          <h2 id="bf-quota-title">โควตาต่อคน</h2>
          <span className="bf-quota-default">ค่าเริ่มต้น {defaultLimit} ตัวต่อคน</span>
        </header>
        <div className="th-filters">
          <label className="th-search" role="search">
            <UserPlus size={17} aria-hidden="true" />
            <input value={finder} onChange={(event) => setFinder(event.target.value)} placeholder="ค้นชื่อผู้ใช้เพื่อตั้งโควตา" aria-label="ค้นชื่อผู้ใช้" />
            {finder && <button type="button" onClick={() => setFinder("")} aria-label="ล้างคำค้น"><X size={15} /></button>}
          </label>
        </div>
        <div className="th-meta">
          <span>{found !== null ? `ผลการค้น ${found.length} คน` : "คนที่มีบอทหรือมีโควตาพิเศษ"} · ตั้งได้ 0 ถึง 50 หรือลบตัวเลขเพื่อใช้ค่าเริ่มต้น</span>
        </div>
        {found !== null ? (
          found.length === 0
            ? <div className="aov-empty hv-empty"><span>ไม่พบผู้ใช้ชื่อ “{finder.trim()}”</span></div>
            : <ul className="hv-list">{found.map(quotaRow)}</ul>
        ) : owners.length === 0 ? (
          <div className="aov-empty hv-empty"><span>ยังไม่มีใครมีบอทหรือโควตาพิเศษ ค้นชื่อผู้ใช้ด้านบนเพื่อให้โควตาล่วงหน้าได้</span></div>
        ) : (
          <ul className="hv-list">{owners.map(quotaRow)}</ul>
        )}
      </section>

      {editing && <ResourceDialog bot={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} notify={notify} />}
      {creating && (
        <BotCreateWizard
          forAdmin
          onClose={() => setCreating(false)}
          onCreated={(bot) => { setCreating(false); window.location.href = `/bots?id=${encodeURIComponent(bot.id)}`; }}
          notify={notify}
        />
      )}
    </div>
  );
}

function ResourceDialog({ bot, onClose, onSaved, notify }: { bot: Bot; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const [memory, setMemory] = useState(bot.resources.memoryMb);
  const [cpu, setCpu] = useState(bot.resources.cpuMillicores);
  const [disk, setDisk] = useState(bot.resources.diskLimitMb);
  const [saving, setSaving] = useState(false);
  useScrollLock(true);
  useEscape(!saving, onClose);

  const withCurrent = (options: number[], value: number) => (options.includes(value) ? options : [...options, value].sort((a, b) => a - b));

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await botApi<{ restartRequired: boolean }>(`/api/admin/bots/${encodeURIComponent(bot.id)}`, botSend("PATCH", { memoryMb: memory, cpuMillicores: cpu, diskLimitMb: disk }));
      notify({ kind: "success", text: result.restartRequired ? `บันทึกแล้ว ค่าใหม่มีผลเมื่อ ${bot.name} รีสตาร์ต` : "บันทึกแล้ว" });
      onSaved();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
      setSaving(false);
    }
  }

  return createPortal(
    <div className="bt-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <form className="bt-dialog bt-form" role="dialog" aria-modal="true" aria-label={`ทรัพยากรของ ${bot.name}`} onSubmit={save}>
        <header className="bt-dialog-head">
          <h2>ทรัพยากรของ {bot.name}</h2>
          <button type="button" className="bt-icon-btn" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
        </header>
        <label className="bt-field">
          <span>หน่วยความจำ</span>
          <select value={memory} onChange={(event) => setMemory(Number(event.target.value))}>
            {withCurrent(memoryOptions, memory).map((value) => <option key={value} value={value}>{value} MB</option>)}
          </select>
        </label>
        <label className="bt-field">
          <span>CPU</span>
          <select value={cpu} onChange={(event) => setCpu(Number(event.target.value))}>
            {withCurrent(cpuOptions, cpu).map((value) => <option key={value} value={value}>{cores(value)} คอร์</option>)}
          </select>
        </label>
        <label className="bt-field">
          <span>ดิสก์ (โค้ดรวมข้อมูล)</span>
          <select value={disk} onChange={(event) => setDisk(Number(event.target.value))}>
            {withCurrent(diskOptions, disk).map((value) => <option key={value} value={value}>{megabytes(value)}</option>)}
          </select>
        </label>
        <footer className="bt-dialog-foot">
          <button type="button" className="bt-btn" onClick={onClose} disabled={saving}>ยกเลิก</button>
          <button type="submit" className="bt-btn bt-btn-primary" disabled={saving}>{saving && <span className="bt-spinner" aria-hidden="true" />}บันทึก</button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
