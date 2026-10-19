"use client";

// /admin/bots: every Discord bot users run here. Admins add a bot (their own or for someone),
// stop one that misbehaves, give one more memory, and set how many bots a person may have.
import { Activity, Bot as BotIcon, CircleAlert, ExternalLink, MemoryStick, Plus, Power, RefreshCw, Search, SlidersHorizontal, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Ask, Notify } from "./types";
import { useEscape, useScrollLock } from "./useScrollLock";
import { BotAvatar, StatusPill, botApi, botIsUp, botSend, botStatusView, errorMessage, runtimeLabel, type Bot } from "./botsShared";
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

const memoryOptions = [128, 256, 384, 512, 768, 1024, 1536, 2048];
const cpuOptions = [100, 250, 500, 750, 1000, 1500, 2000];
const diskOptions = [256, 512, 1024, 2048, 4096];

export default function AdminBotsView({ notify, ask }: { notify: Notify; ask: Ask }) {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(2);
  const [failed, setFailed] = useState("");
  const [refreshing, setRefreshing] = useState(false);
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

  const counts = useMemo(() => {
    const list = bots || [];
    return {
      all: list.length,
      online: list.filter((bot) => bot.status === "running").length,
      bad: list.filter((bot) => botStatusView(bot).tone === "bad").length,
      off: list.filter((bot) => bot.status === "stopped").length,
      memory: list.filter(botIsUp).reduce((sum, bot) => sum + bot.resources.memoryMb, 0),
    };
  }, [bots]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (bots || []).filter((bot) => {
      if (filter === "online" && bot.status !== "running") return false;
      if (filter === "bad" && botStatusView(bot).tone !== "bad") return false;
      if (filter === "off" && bot.status !== "stopped") return false;
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
      setLimits((current) => { const next = { ...current }; delete next[owner.id]; return next; });
      setFinder("");
      void load();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    }
  }

  const quotaRow = (owner: Owner) => (
    <li key={owner.id}>
      <span className="bt-quota-who">
        <span className="bt-quota-initial" aria-hidden="true">{owner.username.charAt(0).toUpperCase()}</span>
        <b>{owner.username}</b>
      </span>
      <span className="bt-muted">มี {owner.bots} ตัว · โควตา {owner.limit ?? `${defaultLimit} (ค่าเริ่มต้น)`}</span>
      <form className="bt-quota-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void saveLimit(owner); }}>
        <input inputMode="numeric" value={limits[owner.id] ?? (owner.limit ?? "").toString()} onChange={(event) => setLimits((current) => ({ ...current, [owner.id]: event.target.value.replace(/[^0-9]/g, "") }))} placeholder={String(defaultLimit)} aria-label={`โควตาของ ${owner.username}`} />
        <button type="submit" className="bt-btn is-sm" disabled={limits[owner.id] === undefined}>บันทึก</button>
      </form>
    </li>
  );

  const empty = bots !== null && bots.length === 0;

  return (
    <div className="bt bt-admin">
      <header className="bt-head">
        <div className="bt-head-copy">
          <span className="bt-eyebrow">เว็บไซต์</span>
          <h1>บอทของผู้ใช้</h1>
          <p>บอท Discord ที่ผู้ใช้เอามารันบนเซิร์ฟเวอร์ เพิ่มบอทให้ใครก็ได้ ปิดตัวที่มีปัญหา ปรับทรัพยากร และกำหนดโควตาได้ที่นี่</p>
        </div>
        <div className="bt-head-side">
          <button type="button" className="bt-btn" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={15} aria-hidden="true" className={refreshing ? "bt-spin" : ""} />รีเฟรช
          </button>
          <button type="button" className="bt-btn bt-btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />เพิ่มบอท</button>
        </div>
      </header>

      <ul className="bt-kpis" aria-label="สรุป">
        <li><span className="bt-kpi-icon"><BotIcon size={18} aria-hidden="true" /></span><span><small>บอททั้งหมด</small><b>{bots ? counts.all : "-"}</b></span></li>
        <li className="is-ok"><span className="bt-kpi-icon"><Activity size={18} aria-hidden="true" /></span><span><small>ออนไลน์</small><b>{bots ? counts.online : "-"}</b></span></li>
        <li className={counts.bad ? "is-bad" : ""}><span className="bt-kpi-icon"><CircleAlert size={18} aria-hidden="true" /></span><span><small>มีปัญหา</small><b>{bots ? counts.bad : "-"}</b></span></li>
        <li><span className="bt-kpi-icon"><MemoryStick size={18} aria-hidden="true" /></span><span><small>RAM ที่จองอยู่</small><b>{bots ? (counts.memory >= 1024 ? `${(counts.memory / 1024).toLocaleString("th-TH", { maximumFractionDigits: 2 })} GB` : `${counts.memory} MB`) : "-"}</b></span></li>
      </ul>

      {failed && <div className="bt-callout is-bad" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{failed}</span><button type="button" className="bt-btn" onClick={() => void refresh()}>ลองอีกครั้ง</button></div>}

      <section className="bt-card-box bt-admin-table">
        <header className="bt-admin-table-head">
          <h2>รายการบอท</h2>
          {!empty && (
            <div className="bt-admin-tools">
              <label className="bt-admin-search">
                <Search size={16} aria-hidden="true" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นชื่อบอท หรือเจ้าของ" aria-label="ค้นบอท" />
                {query && <button type="button" className="bt-icon-btn is-sm" onClick={() => setQuery("")} aria-label="ล้างคำค้น"><X size={14} /></button>}
              </label>
              <div className="bt-admin-chips" role="group" aria-label="กรองสถานะ">
                {filters.map((item) => (
                  <button key={item.id} type="button" className={filter === item.id ? "is-active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                    {item.label}<span>{counts[item.id]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </header>
        {bots === null && !failed && <div className="bt-tree-skeleton" aria-busy="true"><span /><span /><span /></div>}
        {empty && (
          <div className="bt-admin-empty">
            <span className="bt-admin-empty-icon"><BotIcon size={26} aria-hidden="true" /></span>
            <h3>ยังไม่มีใครเพิ่มบอท</h3>
            <p>ผู้ใช้เพิ่มบอทเองได้ที่เมนู บอท Discord หรือแอดมินเพิ่มให้จากที่นี่ แต่ละคนมีโควตาเริ่มต้น {defaultLimit} ตัว</p>
            <div className="bt-admin-empty-actions">
              <button type="button" className="bt-btn bt-btn-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />เพิ่มบอท</button>
              <Link className="bt-btn" href="/bots"><ExternalLink size={15} aria-hidden="true" />ดูหน้าบอทของผู้ใช้</Link>
            </div>
          </div>
        )}
        {bots && bots.length > 0 && shown.length === 0 && <p className="bt-box-empty bt-admin-pad">ไม่พบบอทที่ตรงกับที่ค้น</p>}
        {shown.length > 0 && (
          <ul className="bt-admin-list">
            <li className="bt-admin-row is-head" aria-hidden="true"><span>บอท</span><span>เจ้าของ</span><span>สถานะ</span><span>ทรัพยากร</span><span /></li>
            {shown.map((bot) => (
              <li key={bot.id} className="bt-admin-row">
                <span className="bt-admin-bot">
                  <BotAvatar bot={bot} size={38} />
                  <span><b>{bot.name}</b><small>{bot.discord.username ? `@${bot.discord.username}` : "ยังไม่ใส่โทเคน"} · {runtimeLabel[bot.runtime]}</small></span>
                </span>
                <span className="bt-admin-owner">{bot.owner?.username || "-"}</span>
                <span className="bt-admin-status"><StatusPill bot={bot} />{bot.restartCount > 0 && <small>รีสตาร์ตเอง {bot.restartCount} ครั้ง</small>}</span>
                <span className="bt-admin-res">
                  {bot.resources.memoryMb} MB · {(bot.resources.cpuMillicores / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 })} คอร์
                  <small>ดิสก์ {bot.resources.diskUsedMb ?? "-"} / {bot.resources.diskLimitMb} MB</small>
                </span>
                <span className="bt-admin-actions">
                  <a className="bt-icon-btn" href={`/bots?id=${encodeURIComponent(bot.id)}`} title="เปิดหน้าบอท (คอนโซล ไฟล์)" aria-label={`เปิดหน้าบอท ${bot.name}`}><ExternalLink size={16} /></a>
                  <button type="button" className="bt-icon-btn" onClick={() => setEditing(bot)} title="ปรับทรัพยากร" aria-label={`ปรับทรัพยากร ${bot.name}`}><SlidersHorizontal size={16} /></button>
                  <button type="button" className="bt-icon-btn is-danger" onClick={() => stop(bot)} disabled={!botIsUp(bot) || Boolean(bot.pending)} title="ปิดบอท" aria-label={`ปิดบอท ${bot.name}`}><Power size={16} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bt-card-box">
        <header className="bt-box-head">
          <h2>โควตาต่อคน</h2>
          <span className="bt-muted">ค่าเริ่มต้น {defaultLimit} ตัวต่อคน</span>
        </header>
        <label className="bt-admin-search bt-quota-finder">
          <UserPlus size={16} aria-hidden="true" />
          <input value={finder} onChange={(event) => setFinder(event.target.value)} placeholder="ค้นชื่อผู้ใช้เพื่อตั้งโควตา" aria-label="ค้นชื่อผู้ใช้" />
          {finder && <button type="button" className="bt-icon-btn is-sm" onClick={() => setFinder("")} aria-label="ล้างคำค้น"><X size={14} /></button>}
        </label>
        {found !== null ? (
          found.length === 0 ? <p className="bt-box-empty">ไม่พบผู้ใช้ชื่อนี้</p> : <ul className="bt-env-list bt-quota-list">{found.map(quotaRow)}</ul>
        ) : owners.length === 0 ? (
          <p className="bt-box-empty">ยังไม่มีใครมีบอทหรือโควตาพิเศษ ค้นชื่อผู้ใช้ด้านบนเพื่อเพิ่มหรือลดโควตาให้ก่อนได้</p>
        ) : (
          <ul className="bt-env-list bt-quota-list">{owners.map(quotaRow)}</ul>
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
            {withCurrent(cpuOptions, cpu).map((value) => <option key={value} value={value}>{(value / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 })} คอร์</option>)}
          </select>
        </label>
        <label className="bt-field">
          <span>ดิสก์ (โค้ดรวมข้อมูล)</span>
          <select value={disk} onChange={(event) => setDisk(Number(event.target.value))}>
            {withCurrent(diskOptions, disk).map((value) => <option key={value} value={value}>{value >= 1024 ? `${value / 1024} GB` : `${value} MB`}</option>)}
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
