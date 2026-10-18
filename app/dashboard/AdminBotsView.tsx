"use client";

// /admin/bots: every Discord bot users run here. Admins stop a bot that misbehaves, give one
// more memory, and set how many bots a person may have.
import { ExternalLink, Power, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Ask, Notify } from "./types";
import { useEscape, useScrollLock } from "./useScrollLock";
import { BotAvatar, StatusPill, botApi, botIsUp, botSend, botStatusView, errorMessage, runtimeLabel, type Bot } from "./botsShared";
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Bot | null>(null);
  const [limits, setLimits] = useState<Record<number, string>>({});

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
      void load();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    }
  }

  return (
    <div className="bt bt-admin">
      <header className="bt-head">
        <div className="bt-head-copy">
          <h1>บอทของผู้ใช้</h1>
          <p>บอท Discord ที่ผู้ใช้เอามารันบนเซิร์ฟเวอร์ ปิดตัวที่มีปัญหา เพิ่มหน่วยความจำ และกำหนดโควตาได้ที่นี่</p>
        </div>
        <button type="button" className="bt-btn" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />รีเฟรช</button>
      </header>

      <dl className="bt-stats bt-admin-kpis">
        <div><dt>บอททั้งหมด</dt><dd>{bots ? counts.all : "-"}</dd></div>
        <div><dt>ออนไลน์</dt><dd>{bots ? counts.online : "-"}</dd></div>
        <div><dt>มีปัญหา</dt><dd>{bots ? counts.bad : "-"}</dd></div>
        <div><dt>RAM ที่จองอยู่</dt><dd>{bots ? `${(counts.memory / 1024).toLocaleString("th-TH", { maximumFractionDigits: 2 })} GB` : "-"}</dd></div>
      </dl>

      <div className="bt-admin-tools">
        <label className="bt-admin-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นชื่อบอท หรือเจ้าของ" aria-label="ค้นบอท" />
        </label>
        <div className="bt-admin-chips" role="group" aria-label="กรองสถานะ">
          {filters.map((item) => (
            <button key={item.id} type="button" className={filter === item.id ? "is-active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
              {item.label}<span>{counts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {failed && <div className="bt-callout is-bad" role="alert"><span>{failed}</span></div>}

      <section className="bt-card-box bt-admin-table">
        {bots === null && !failed && <div className="bt-tree-skeleton" aria-busy="true"><span /><span /><span /></div>}
        {bots && shown.length === 0 && <p className="bt-box-empty">{bots.length ? "ไม่พบบอทที่ตรงกับที่ค้น" : "ยังไม่มีใครเพิ่มบอท"}</p>}
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
                  <a className="bt-icon-btn" href={`/bots?id=${encodeURIComponent(bot.id)}`} target="_blank" rel="noreferrer" title="เปิดหน้าบอท (คอนโซล ไฟล์)" aria-label={`เปิดหน้าบอท ${bot.name}`}><ExternalLink size={16} /></a>
                  <button type="button" className="bt-icon-btn" onClick={() => setEditing(bot)} title="ปรับทรัพยากร" aria-label={`ปรับทรัพยากร ${bot.name}`}><SlidersHorizontal size={16} /></button>
                  <button type="button" className="bt-icon-btn is-danger" onClick={() => stop(bot)} disabled={!botIsUp(bot) || Boolean(bot.pending)} title="ปิดบอท" aria-label={`ปิดบอท ${bot.name}`}><Power size={16} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bt-card-box">
        <header className="bt-box-head"><h2>โควตาต่อคน</h2><span className="bt-muted">ค่าเริ่มต้น {defaultLimit} ตัว (ตั้งใน BOT_DEFAULT_LIMIT)</span></header>
        {owners.length === 0 ? <p className="bt-box-empty">ยังไม่มีใครมีบอท</p> : (
          <ul className="bt-env-list bt-quota-list">
            {owners.map((owner) => (
              <li key={owner.id}>
                <b>{owner.username}</b>
                <span className="bt-muted">มี {owner.bots} ตัว · โควตา {owner.limit ?? `${defaultLimit} (เริ่มต้น)`}</span>
                <form className="bt-quota-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void saveLimit(owner); }}>
                  <input inputMode="numeric" value={limits[owner.id] ?? (owner.limit ?? "").toString()} onChange={(event) => setLimits((current) => ({ ...current, [owner.id]: event.target.value.replace(/[^0-9]/g, "") }))} placeholder={String(defaultLimit)} aria-label={`โควตาของ ${owner.username}`} />
                  <button type="submit" className="bt-btn is-sm" disabled={limits[owner.id] === undefined}>บันทึก</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <ResourceDialog bot={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} notify={notify} />}
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
