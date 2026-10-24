"use client";

// /admin/bots/list: every bot on the platform as a working list. Find one, see what it is doing,
// start or stop it from the row, stop several at once, and open its panel for logs and limits.
import { ChevronRight, CircleAlert, Play, Plus, Power, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Ask, Notify } from "./types";
import { BotAvatar, botIsUp, botStatusView, errorMessage, runtimeLabel, uptimeText, type Bot, type StatusTone } from "./botsShared";
import BotCreateWizard from "./BotCreateWizard";
import AdminBotDrawer from "./AdminBotDrawer";
import { AdminBotsHead, allowedActions, ago, clock, cores, count, diskPercent, megabytes, sendBotAction, useFleet } from "./adminBotsShared";
import "./bots-view.css";
import "./admin-bots.css";

type Filter = "all" | StatusTone;
type Sort = "new" | "attention" | "name" | "owner" | "memory" | "disk";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "online", label: "ออนไลน์" },
  { id: "busy", label: "กำลังทำงาน" },
  { id: "bad", label: "มีปัญหา" },
  { id: "off", label: "ปิดอยู่" },
];

const sorts: { id: Sort; label: string }[] = [
  { id: "new", label: "สร้างล่าสุด" },
  { id: "attention", label: "มีปัญหาก่อน" },
  { id: "name", label: "ชื่อบอท" },
  { id: "owner", label: "ชื่อเจ้าของ" },
  { id: "memory", label: "RAM มากสุด" },
  { id: "disk", label: "ดิสก์เต็มสุด" },
];

const toneRank: Record<StatusTone, number> = { bad: 0, busy: 1, online: 2, off: 3 };

/** The URL keeps the filter and the open bot, so a link to "the broken ones" or one bot works. */
function readUrl() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  return { filter: (filters.some((item) => item.id === status) ? status : "all") as Filter, query: params.get("q") || "", open: params.get("bot") || "" };
}

function writeUrl(values: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value && value !== "all") url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export default function AdminBotsFleet({ notify, ask }: { notify: Notify; ask: Ask }) {
  const fleet = useFleet();
  const { bots, failed, loadedAt, refreshing, load, refresh } = fleet;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("new");
  const [runtime, setRuntime] = useState<"all" | Bot["runtime"]>("all");
  const [openId, setOpenId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const start = readUrl();
    const timer = window.setTimeout(() => { setFilter(start.filter); setQuery(start.query); setOpenId(start.open); }, 0);
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { window.clearTimeout(timer); window.clearInterval(tick); };
  }, []);

  const counts = useMemo(() => {
    const tones: Record<StatusTone, number> = { online: 0, busy: 0, bad: 0, off: 0 };
    for (const bot of bots || []) tones[botStatusView(bot).tone] += 1;
    return { all: (bots || []).length, ...tones };
  }, [bots]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^@/, "");
    const list = (bots || []).filter((bot) => {
      if (filter !== "all" && botStatusView(bot).tone !== filter) return false;
      if (runtime !== "all" && bot.runtime !== runtime) return false;
      if (!needle) return true;
      return [bot.name, bot.discord.username, bot.owner?.username || "", bot.id].some((value) => value.toLowerCase().includes(needle));
    });
    const by: Record<Sort, (a: Bot, b: Bot) => number> = {
      new: (a, b) => b.createdAt.localeCompare(a.createdAt),
      attention: (a, b) => toneRank[botStatusView(a).tone] - toneRank[botStatusView(b).tone] || b.restartCount - a.restartCount,
      name: (a, b) => a.name.localeCompare(b.name, "th"),
      owner: (a, b) => (a.owner?.username || "").localeCompare(b.owner?.username || "", "th") || a.name.localeCompare(b.name, "th"),
      memory: (a, b) => b.resources.memoryMb - a.resources.memoryMb,
      disk: (a, b) => (diskPercent(b) ?? -1) - (diskPercent(a) ?? -1),
    };
    return [...list].sort(by[sort]);
  }, [bots, filter, query, runtime, sort]);

  const opened = openId ? (bots || []).find((bot) => bot.id === openId) || null : null;
  // A bot that was deleted while its panel was open simply closes the panel.
  useEffect(() => {
    if (openId && bots && !bots.some((bot) => bot.id === openId)) {
      const timer = window.setTimeout(() => { setOpenId(""); writeUrl({ bot: "" }); }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [bots, openId]);

  const open = (bot: Bot | null) => { setOpenId(bot?.id || ""); writeUrl({ bot: bot?.id || "" }); };
  const changeFilter = (next: Filter) => { setFilter(next); writeUrl({ status: next }); };
  const changeQuery = (next: string) => { setQuery(next); writeUrl({ q: next.trim() }); };
  const clearFilters = () => { setFilter("all"); setQuery(""); setRuntime("all"); writeUrl({ status: "", q: "" }); };

  const visiblePicked = shown.filter((bot) => picked.has(bot.id));
  const pickable = shown.filter((bot) => allowedActions(bot).stop);
  const allPicked = pickable.length > 0 && pickable.every((bot) => picked.has(bot.id));
  const toggle = (bot: Bot) => setPicked((current) => { const next = new Set(current); if (next.has(bot.id)) next.delete(bot.id); else next.add(bot.id); return next; });

  function stopOne(bot: Bot) {
    ask({
      title: `ปิด ${bot.name}`,
      message: `บอทของ @${bot.owner?.username || "ผู้ใช้"} จะออฟไลน์ เจ้าของเปิดใหม่ได้เองจากหน้าของเขา`,
      confirmLabel: "ปิดบอท",
      danger: true,
      action: async () => {
        await sendBotAction(bot, "stop");
        notify({ kind: "success", text: `กำลังปิด ${bot.name}` });
        void load();
      },
    });
  }

  function startOne(bot: Bot) {
    sendBotAction(bot, "start")
      .then(() => { notify({ kind: "success", text: `กำลังเปิด ${bot.name}` }); void load(); })
      .catch((error) => notify({ kind: "error", text: errorMessage(error) }));
  }

  function stopPicked() {
    const targets = visiblePicked.filter((bot) => allowedActions(bot).stop);
    if (targets.length === 0) return;
    ask({
      title: `ปิดบอท ${count(targets.length)} ตัว`,
      message: `${targets.slice(0, 4).map((bot) => bot.name).join(", ")}${targets.length > 4 ? ` และอีก ${targets.length - 4} ตัว` : ""} จะออฟไลน์ เจ้าของเปิดใหม่ได้เอง`,
      confirmLabel: `ปิด ${count(targets.length)} ตัว`,
      danger: true,
      action: async () => {
        const results = await Promise.allSettled(targets.map((bot) => sendBotAction(bot, "stop")));
        const failedCount = results.filter((result) => result.status === "rejected").length;
        notify(failedCount === 0
          ? { kind: "success", text: `กำลังปิดบอท ${count(targets.length)} ตัว` }
          : { kind: "error", text: `ปิดสำเร็จ ${count(targets.length - failedCount)} ตัว ไม่สำเร็จ ${count(failedCount)} ตัว` });
        setPicked(new Set());
        void load();
      },
    });
  }

  const loading = bots === null && !failed;
  const empty = bots !== null && bots.length === 0;
  const filtering = filter !== "all" || runtime !== "all" || Boolean(query.trim());

  return (
    <div className="abx" aria-busy={loading}>
      <AdminBotsHead tab="list" title="บอททั้งหมด" sub="ค้นหา ดูสถานะ เปิดหรือปิดบอทของทุกคน แล้วเปิดแผงรายละเอียดเพื่อดูล็อกและปรับทรัพยากร">
        <button type="button" className="abx-btn is-icon" onClick={() => void refresh()} disabled={refreshing} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล"><RefreshCw size={16} aria-hidden="true" className={refreshing ? "abx-rotating" : ""} /></button>
        <button type="button" className="abx-btn is-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />เพิ่มบอทให้ผู้ใช้</button>
      </AdminBotsHead>

      {failed && (
        <div className="abx-banner is-bad" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>ดึงรายการบอทไม่สำเร็จ: {failed}{bots ? " (ข้อมูลที่เห็นเป็นรอบก่อน)" : ""}</span>
          <button type="button" className="abx-link" onClick={() => void refresh()} disabled={refreshing}>ลองอีกครั้ง</button>
        </div>
      )}

      <section className="abx-panel" aria-label="รายการบอท">
        {!empty && (
          <div className="abx-tools">
            <label className="abx-search" role="search">
              <Search size={17} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); changeQuery(""); } }}
                placeholder="ค้นชื่อบอท เจ้าของ หรือชื่อใน Discord"
                aria-label="ค้นบอท"
              />
              {query && <button type="button" onClick={() => changeQuery("")} aria-label="ล้างคำค้น"><X size={15} /></button>}
            </label>
            <label className="abx-select">
              <span>ภาษา</span>
              <select value={runtime} onChange={(event) => setRuntime(event.target.value as typeof runtime)}>
                <option value="all">ทุกภาษา</option>
                <option value="node">{runtimeLabel.node}</option>
                <option value="python">{runtimeLabel.python}</option>
              </select>
            </label>
            <label className="abx-select">
              <span>เรียงตาม</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                {sorts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          </div>
        )}
        {!empty && (
          <div className="abx-filterbar">
            <div className="abx-chips" role="group" aria-label="กรองตามสถานะ">
              {filters.map((item) => (
                <button key={item.id} type="button" className={filter === item.id ? "is-active" : ""} aria-pressed={filter === item.id} onClick={() => changeFilter(item.id)}>
                  {item.label}<span>{bots ? count(counts[item.id]) : "–"}</span>
                </button>
              ))}
            </div>
            <p className="abx-meta" aria-live="polite">
              {loading ? "กำลังโหลด..." : bots === null ? "ยังโหลดรายการไม่ได้" : `${count(shown.length)} จาก ${count(counts.all)} ตัว`}
              {filtering ? <button type="button" className="abx-link" onClick={clearFilters}>ล้างตัวกรอง</button> : loadedAt && <span className="abx-synced"> · อัปเดต {clock(loadedAt)}</span>}
            </p>
          </div>
        )}

        {visiblePicked.length > 0 && (
          <div className="abx-bulk" role="region" aria-label="การทำงานกับบอทที่เลือก">
            <b>เลือก {count(visiblePicked.length)} ตัว</b>
            <div>
              <button type="button" className="abx-btn is-danger-ghost is-sm" onClick={stopPicked} disabled={!visiblePicked.some((bot) => allowedActions(bot).stop)}><Power size={14} aria-hidden="true" />ปิดที่เลือก</button>
              <button type="button" className="abx-btn is-quiet is-sm" onClick={() => setPicked(new Set())}>ยกเลิกการเลือก</button>
            </div>
          </div>
        )}

        {loading && (
          <ul className="abx-list" aria-busy="true">
            {[0, 1, 2, 3].map((index) => <li className="abx-row is-skeleton" key={index}><span /><span /><span /></li>)}
          </ul>
        )}

        {empty && (
          <div className="abx-empty">
            <b>ยังไม่มีบอทบนเซิร์ฟเวอร์</b>
            <p>ผู้ใช้สร้างเองได้จากเมนูบอท Discord ของเขา (ได้คนละ {count(fleet.defaultLimit)} ตัวเป็นค่าเริ่มต้น) หรือคุณจะเพิ่มให้ใครก็ได้ตรงนี้</p>
            <button type="button" className="abx-btn is-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />เพิ่มบอทตัวแรก</button>
          </div>
        )}

        {bots && bots.length > 0 && shown.length === 0 && (
          <div className="abx-empty">
            <b>ไม่พบบอทที่ตรงกับตัวกรอง</b>
            <p>ลองเปลี่ยนคำค้นหรือดูบอททั้งหมด</p>
            <button type="button" className="abx-btn" onClick={clearFilters}>ดูบอททั้งหมด</button>
          </div>
        )}

        {shown.length > 0 && (
          <>
            <div className="abx-row abx-row-head" aria-hidden="true">
              <span className="abx-cell-check" />
              <span>บอท</span><span>เจ้าของ</span><span>สถานะ</span><span>ทรัพยากร</span><span />
            </div>
            <ul className="abx-list">
              {shown.map((bot) => {
                const view = botStatusView(bot);
                const can = allowedActions(bot);
                const disk = diskPercent(bot);
                return (
                  <li key={bot.id} className={`abx-row is-${view.tone}${picked.has(bot.id) ? " is-picked" : ""}`}>
                    <span className="abx-cell-check">
                      <input type="checkbox" checked={picked.has(bot.id)} onChange={() => toggle(bot)} disabled={!can.stop && !picked.has(bot.id)} aria-label={`เลือก ${bot.name}`} title={can.stop ? "เลือกเพื่อปิดหลายตัว" : "บอทไม่ได้ทำงานอยู่"} />
                    </span>
                    <button type="button" className="abx-cell-bot" onClick={() => open(bot)} aria-label={`เปิดรายละเอียด ${bot.name}`}>
                      <BotAvatar bot={bot} size={38} />
                      <span className="abx-bot-copy">
                        <strong>{bot.name}</strong>
                        <small><span className={`abx-rt is-${bot.runtime}`}>{runtimeLabel[bot.runtime]}</span>{bot.discord.username ? `@${bot.discord.username}` : "ยังไม่ใส่โทเคน"}</small>
                      </span>
                    </button>
                    <span className="abx-cell-owner" title={bot.owner?.username || "-"}><small>เจ้าของ</small>@{bot.owner?.username || "-"}</span>
                    <span className="abx-cell-state">
                      <span className={`abx-pill is-${view.tone}`}><i aria-hidden="true" />{view.label}</span>
                      <small>
                        {view.tone === "online" && bot.startedAt ? `เปิดมา ${uptimeText(bot.startedAt, now)}` : view.tone === "off" && bot.stoppedAt ? `หยุด ${ago(bot.stoppedAt, now)}` : view.tone === "bad" && bot.stoppedAt ? ago(bot.stoppedAt, now) : ""}
                        {bot.restartCount > 0 && <span className={bot.restartCount >= 3 ? "is-wait" : ""}> · รีสตาร์ตเอง {bot.restartCount}</span>}
                      </small>
                    </span>
                    <span className="abx-cell-res">
                      <span>{megabytes(bot.resources.memoryMb)} · {cores(bot.resources.cpuMillicores)} คอร์</span>
                      <small>ดิสก์ {bot.resources.diskUsedMb ?? "–"} / {megabytes(bot.resources.diskLimitMb)}</small>
                      <span className={`abx-meter${disk !== null && disk >= 98 ? " is-full" : disk !== null && disk >= 85 ? " is-high" : ""}`} role="img" aria-label={disk === null ? "ยังไม่รู้พื้นที่ที่ใช้" : `ใช้ดิสก์ไป ${Math.round(disk)}%`}><i style={{ width: `${disk ?? 0}%` }} /></span>
                    </span>
                    <span className="abx-cell-actions">
                      {botIsUp(bot) || bot.pending
                        ? <button type="button" className="abx-icon is-danger" onClick={() => stopOne(bot)} disabled={!can.stop} title="ปิดบอท" aria-label={`ปิด ${bot.name}`}><Power size={17} aria-hidden="true" /></button>
                        : <button type="button" className="abx-icon is-ok" onClick={() => startOne(bot)} disabled={!can.start} title="เปิดบอท" aria-label={`เปิด ${bot.name}`}><Play size={17} aria-hidden="true" /></button>}
                      <button type="button" className="abx-icon" onClick={() => open(bot)} title="รายละเอียด" aria-label={`รายละเอียด ${bot.name}`}><ChevronRight size={18} aria-hidden="true" /></button>
                    </span>
                  </li>
                );
              })}
            </ul>
            {pickable.length > 1 && (
              <label className="abx-selectall">
                <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(pickable.map((bot) => bot.id)))} />
                เลือกบอทที่กำลังทำงานทั้งหมดในรายการนี้ ({count(pickable.length)} ตัว)
              </label>
            )}
          </>
        )}
      </section>

      {opened && <AdminBotDrawer bot={opened} onClose={() => open(null)} onChanged={() => void load()} notify={notify} ask={ask} />}
      {creating && (
        <BotCreateWizard
          forAdmin
          onClose={() => setCreating(false)}
          onCreated={(bot) => { setCreating(false); void load().then(() => open(bot)); }}
          notify={notify}
        />
      )}
    </div>
  );
}
