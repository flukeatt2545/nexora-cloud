"use client";

// /admin/bots: every Discord bot users run here. Admins add a bot (their own or for someone),
// stop one that misbehaves, give one more memory, and set how many bots a person may have.
// Laid out as a fleet roster: one status strip, the roster itself, then quotas (bf-* classes).
import { CircleAlert, ExternalLink, Minus, Plus, Power, RefreshCw, RotateCcw, Search, SlidersHorizontal, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Ask, Notify } from "./types";
import { useEscape, useScrollLock } from "./useScrollLock";
import { BotAvatar, botApi, botIsUp, botSend, botStatusView, errorMessage, runtimeLabel, type Bot, type StatusTone } from "./botsShared";
import BotCreateWizard from "./BotCreateWizard";
import Link from "next/link";
import "./bots-view.css";

type Owner = { id: number; username: string; limit: number | null; bots: number };
type Filter = "all" | "online" | "bad" | "off";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "online", label: "ออนไลน์" },
  { id: "bad", label: "มีปัญหา" },
  { id: "off", label: "ปิดอยู่" },
];

// The fleet strip's segments, in the order they sit on the bar.
const segments: { tone: StatusTone; label: string }[] = [
  { tone: "online", label: "ออนไลน์" },
  { tone: "busy", label: "กำลังเปิด/ปิด" },
  { tone: "bad", label: "มีปัญหา" },
  { tone: "off", label: "ปิดอยู่" },
];

const memoryOptions = [128, 256, 384, 512, 768, 1024, 1536, 2048];
const cpuOptions = [100, 250, 500, 750, 1000, 1500, 2000];
const diskOptions = [256, 512, 1024, 2048, 4096];

const megabytes = (value: number) => (value >= 1024 ? `${(value / 1024).toLocaleString("th-TH", { maximumFractionDigits: 2 })} GB` : `${value} MB`);
const cores = (millicores: number) => (millicores / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const clock = (date: Date) => date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

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

  // Everything counts by the status the row shows, so the strip, the chips and the rows agree.
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
      <li key={owner.id} className={`bf-quota-row${dirty ? " is-dirty" : ""}`}>
        <span className="bf-quota-name">{owner.username}</span>
        <span className={`bf-quota-use${owner.bots > allowed ? " is-over" : ""}`}>
          <b>{owner.bots}</b> / {allowed} ตัว{owner.limit === null && <small>ค่าเริ่มต้น</small>}
        </span>
        <form className="bf-quota-edit" onSubmit={(event: FormEvent) => { event.preventDefault(); void saveLimit(owner); }}>
          <span className="bf-stepper">
            <button type="button" onClick={() => stepLimit(owner, -1)} disabled={value <= 0} aria-label={`ลดโควตาของ ${owner.username}`}><Minus size={15} aria-hidden="true" /></button>
            <input inputMode="numeric" value={raw} onChange={(event) => setLimits((current) => ({ ...current, [owner.id]: event.target.value.replace(/[^0-9]/g, "") }))} onKeyDown={(event) => { if (event.key === "Escape" && dirty) { event.stopPropagation(); forgetLimit(owner.id); } }} placeholder={String(defaultLimit)} aria-label={`โควตาของ ${owner.username} (เว้นว่างเพื่อใช้ค่าเริ่มต้น)`} />
            <button type="button" onClick={() => stepLimit(owner, 1)} disabled={value >= 50} aria-label={`เพิ่มโควตาของ ${owner.username}`}><Plus size={15} aria-hidden="true" /></button>
          </span>
          <span className="bf-quota-save">
            <button type="submit" className="bf-btn is-primary is-sm" disabled={!dirty}>บันทึก</button>
            <button type="button" className="bf-icon" onClick={() => forgetLimit(owner.id)} disabled={!dirty} aria-label={`ยกเลิกการแก้โควตาของ ${owner.username}`}><X size={15} aria-hidden="true" /></button>
          </span>
        </form>
      </li>
    );
  };

  const loading = bots === null && !failed;
  const empty = bots !== null && bots.length === 0;
  const noResult = filter === "bad" && !query.trim()
    ? "ตอนนี้ไม่มีบอทที่มีปัญหา ทุกตัวทำงานปกติหรือปิดไว้ตามตั้งใจ"
    : filter === "online" && !query.trim()
      ? "ยังไม่มีบอทตัวไหนออนไลน์อยู่ในตอนนี้"
      : filter === "off" && !query.trim()
        ? "ไม่มีบอทที่ปิดอยู่ ทุกตัวกำลังทำงานหรือกำลังเปิด"
        : `ไม่พบบอทที่ตรงกับ “${query.trim()}”${filter === "all" ? "" : ` ในกลุ่ม${filters.find((item) => item.id === filter)?.label}`}`;

  return (
    <div className="bt bt-admin bf">
      <header className="bf-head">
        <div className="bf-head-copy">
          <span className="bf-kicker">เว็บไซต์ · บอท Discord</span>
          <h1>บอทของผู้ใช้</h1>
          <p>บอทที่ผู้ใช้เอามารันบนเซิร์ฟเวอร์นี้ เพิ่มบอทให้ใครก็ได้ ปิดตัวที่มีปัญหา ปรับทรัพยากร และกำหนดโควตาของแต่ละคน</p>
        </div>
        <div className="bf-head-side">
          <span className="bf-synced" aria-live="off">{loadedAt ? <>อัปเดต <time>{clock(loadedAt)}</time></> : "กำลังเชื่อมต่อ"}</span>
          <button type="button" className="bf-btn" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={15} aria-hidden="true" className={refreshing ? "bt-spin" : ""} />รีเฟรช
          </button>
          <button type="button" className="bf-btn is-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />เพิ่มบอท</button>
        </div>
      </header>

      <section className={`bf-fleet${loading ? " is-loading" : ""}`} aria-label="สถานะของบอททั้งหมด" aria-busy={loading}>
        <div className="bf-fleet-lead">
          <span className="bf-label">ออนไลน์ตอนนี้</span>
          <p className="bf-figure"><span className="bf-figure-n">{bots ? counts.online : "–"}</span><span>/ {bots ? counts.all : "–"} ตัว</span></p>
        </div>
        <div className="bf-fleet-mix">
          <div className="bf-mix-bar" role="img" aria-label={segments.map((segment) => `${segment.label} ${counts[segment.tone]}`).join(" · ")}>
            {segments.map((segment) => (
              <i key={segment.tone} className={`is-${segment.tone}${counts[segment.tone] ? "" : " is-zero"}`} style={{ flexGrow: counts[segment.tone] }} />
            ))}
          </div>
          <ul className="bf-mix-legend">
            {segments.map((segment) => (
              <li key={segment.tone} className={`is-${segment.tone}${segment.tone === "bad" && counts.bad > 0 ? " is-alert" : ""}`}>
                <i aria-hidden="true" />{segment.label}<b>{bots ? counts[segment.tone] : "–"}</b>
              </li>
            ))}
          </ul>
        </div>
        <dl className="bf-fleet-ram">
          <dt className="bf-label">RAM ที่จองไว้</dt>
          <dd><span className="bf-ram-n">{bots ? megabytes(counts.memory) : "–"}</span><small>ให้บอทที่เปิดอยู่ {bots ? counts.up : "–"} ตัว</small></dd>
        </dl>
      </section>

      {failed && (
        <div className="bf-alert" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <p><b>ดึงรายการบอทไม่สำเร็จ</b><span>{failed}{bots ? " ตัวเลขที่เห็นอยู่เป็นข้อมูลรอบก่อน" : ""}</span></p>
          <button type="button" className="bf-btn" onClick={() => void refresh()} disabled={refreshing}>ลองอีกครั้ง</button>
        </div>
      )}

      <section className="bf-roster" aria-labelledby="bf-roster-title">
        <header className="bf-roster-head">
          <h2 id="bf-roster-title">รายชื่อบอท</h2>
          {!empty && (
            <>
              <div className="bf-filters" role="group" aria-label="กรองสถานะ">
                {filters.map((item) => (
                  <button key={item.id} type="button" className={filter === item.id ? "is-active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                    {item.label}<span>{bots ? counts[item.id] : "–"}</span>
                  </button>
                ))}
              </div>
              <label className="bf-search">
                <Search size={16} aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นชื่อบอท ชื่อใน Discord หรือเจ้าของ" aria-label="ค้นบอท" />
                {query && <button type="button" className="bf-icon is-sm" onClick={() => setQuery("")} aria-label="ล้างคำค้น"><X size={14} aria-hidden="true" /></button>}
              </label>
            </>
          )}
        </header>

        {!empty && (bots === null || shown.length > 0) && (
          <div className="bf-cols" aria-hidden="true"><span>บอท</span><span>เจ้าของ</span><span>สถานะ</span><span>RAM · CPU</span><span>ดิสก์</span><span /></div>
        )}

        {loading && (
          <ul className="bf-list" aria-busy="true" aria-label="กำลังโหลดรายชื่อบอท">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="bf-row is-skeleton" style={{ animationDelay: `${index * 120}ms` }}>
                <span className="bf-bot"><i className="bf-sk is-avatar" /><span className="bf-bot-text"><i className="bf-sk" style={{ width: `${62 - index * 7}%` }} /><i className="bf-sk is-thin" /></span></span>
                <span className="bf-owner"><i className="bf-sk" /></span>
                <span className="bf-state"><i className="bf-sk" /></span>
                <span className="bf-res"><i className="bf-sk" /></span>
                <span className="bf-disk"><i className="bf-sk" /></span>
                <span className="bf-actions" />
              </li>
            ))}
          </ul>
        )}

        {bots === null && failed && <p className="bf-note">รายชื่อจะขึ้นตรงนี้เมื่อเชื่อมต่อเซิร์ฟเวอร์ได้</p>}

        {empty && (
          <div className="bf-empty">
            <ol className="bf-empty-ghost" aria-hidden="true"><li /><li /><li /></ol>
            <div className="bf-empty-copy">
              <h3>ยังไม่มีบอทสักตัวบนเซิร์ฟเวอร์</h3>
              <p>เมื่อผู้ใช้เพิ่มบอทจากเมนู บอท Discord บอทจะมาเรียงแถวตรงนี้ หรือแอดมินจะเพิ่มให้ใครก่อนก็ได้ แต่ละคนเริ่มต้นสร้างได้ {defaultLimit} ตัว</p>
              <div className="bf-empty-actions">
                <button type="button" className="bf-btn is-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />เพิ่มบอทตัวแรก</button>
                <Link className="bf-btn" href="/bots"><ExternalLink size={15} aria-hidden="true" />ดูหน้าที่ผู้ใช้เห็น</Link>
              </div>
            </div>
          </div>
        )}

        {bots && bots.length > 0 && shown.length === 0 && (
          <div className="bf-none">
            <p>{noResult}</p>
            <button type="button" className="bf-link" onClick={() => { setQuery(""); setFilter("all"); }}>ดูบอททั้งหมด {counts.all} ตัว</button>
          </div>
        )}

        {shown.length > 0 && (
          <ul key={filter} className="bf-list">
            {shown.map((bot) => {
              const view = botStatusView(bot);
              const used = bot.resources.diskUsedMb;
              const fill = used === null ? 0 : Math.min(100, (used / Math.max(1, bot.resources.diskLimitMb)) * 100);
              return (
                <li key={bot.id} className={`bf-row is-${view.tone}`}>
                  <span className="bf-bot">
                    <BotAvatar bot={bot} size={36} />
                    <span className="bf-bot-text">
                      <b>{bot.name}</b>
                      <span className="bf-bot-sub">
                        <span className={`bf-rt is-${bot.runtime}`}>{runtimeLabel[bot.runtime]}</span>
                        {bot.discord.username ? <span className="bf-handle">@{bot.discord.username}</span> : <span className="bf-handle is-missing">ยังไม่ใส่โทเคน</span>}
                      </span>
                    </span>
                  </span>
                  <span className="bf-owner"><span className="bf-cell-label">เจ้าของ</span><span className="bf-owner-name">{bot.owner?.username || "-"}</span></span>
                  <span className={`bf-state is-${view.tone}`}>
                    <span className="bf-cell-label">สถานะ</span>
                    <span className="bf-state-word"><i className="bf-dot" aria-hidden="true" />{view.label}</span>
                    {bot.restartCount > 0 && <small><RotateCcw size={12} aria-hidden="true" />รีสตาร์ตเอง {bot.restartCount} ครั้ง</small>}
                  </span>
                  <span className="bf-res">
                    <span className="bf-cell-label">RAM · CPU</span>
                    <span className="bf-num">{bot.resources.memoryMb} MB</span>
                    <small>{cores(bot.resources.cpuMillicores)} คอร์</small>
                  </span>
                  <span className="bf-disk">
                    <span className="bf-cell-label">ดิสก์</span>
                    <span className="bf-num">{used ?? "–"} <span>/ {megabytes(bot.resources.diskLimitMb)}</span></span>
                    <span className={`bf-meter${fill >= 95 ? " is-full" : fill >= 80 ? " is-high" : ""}`} role="img" aria-label={used === null ? "ยังไม่รู้พื้นที่ที่ใช้" : `ใช้ดิสก์ไป ${Math.round(fill)}%`}><i style={{ width: `${fill}%` }} /></span>
                  </span>
                  <span className="bf-actions">
                    <a className="bf-act" href={`/bots?id=${encodeURIComponent(bot.id)}`} title="เปิดหน้าบอท (คอนโซล ไฟล์)" aria-label={`เปิดหน้าบอท ${bot.name}`}><ExternalLink size={16} aria-hidden="true" /><span>หน้าบอท</span></a>
                    <button type="button" className="bf-act" onClick={() => setEditing(bot)} title="ปรับทรัพยากร" aria-label={`ปรับทรัพยากร ${bot.name}`}><SlidersHorizontal size={16} aria-hidden="true" /><span>ทรัพยากร</span></button>
                    <button type="button" className="bf-act is-danger" onClick={() => stop(bot)} disabled={!botIsUp(bot) || Boolean(bot.pending)} title={botIsUp(bot) ? "ปิดบอท" : "บอทปิดอยู่แล้ว"} aria-label={`ปิดบอท ${bot.name}`}><Power size={16} aria-hidden="true" /><span>ปิดบอท</span></button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="bf-quota" aria-labelledby="bf-quota-title">
        <div className="bf-quota-intro">
          <h2 id="bf-quota-title">โควตาต่อคน</h2>
          <p>ทุกคนสร้างบอทได้ <b>{defaultLimit} ตัว</b> เป็นค่าเริ่มต้น ปรับให้บางคนได้ตั้งแต่ 0 ถึง 50 ตัว หรือลบตัวเลขออกเพื่อกลับไปใช้ค่าเริ่มต้น</p>
          <label className="bf-search">
            <UserPlus size={16} aria-hidden="true" />
            <input value={finder} onChange={(event) => setFinder(event.target.value)} placeholder="ค้นชื่อผู้ใช้เพื่อตั้งโควตา" aria-label="ค้นชื่อผู้ใช้" />
            {finder && <button type="button" className="bf-icon is-sm" onClick={() => setFinder("")} aria-label="ล้างคำค้น"><X size={14} aria-hidden="true" /></button>}
          </label>
        </div>
        <div className="bf-quota-body">
          <div className="bf-quota-cols" aria-hidden="true"><span>{found !== null ? "ผลการค้น" : "คนที่มีบอทหรือโควตาพิเศษ"}</span><span>มี / ได้</span><span>โควตา</span></div>
          {found !== null ? (
            found.length === 0 ? <p className="bf-note">ไม่พบผู้ใช้ชื่อ “{finder.trim()}”</p> : <ul className="bf-quota-list">{found.map(quotaRow)}</ul>
          ) : owners.length === 0 ? (
            <p className="bf-note">ยังไม่มีใครมีบอทหรือโควตาพิเศษ ค้นชื่อผู้ใช้ทางซ้ายเพื่อให้โควตาล่วงหน้าได้</p>
          ) : (
            <ul className="bf-quota-list">{owners.map(quotaRow)}</ul>
          )}
        </div>
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
