"use client";

// /admin/bots/quotas: how many bots each person may have. The default comes from the server;
// here an admin raises or lowers it for one person, including people who have no bot yet.
import { CircleAlert, Minus, Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Notify } from "./types";
import { botApi, botSend, errorMessage } from "./botsShared";
import { AdminBotsHead, count, useFleet, type Owner } from "./adminBotsShared";
import "./bots-view.css";
import "./admin-bots.css";

type Filter = "all" | "over" | "custom";

export default function AdminBotsQuotas({ notify }: { notify: Notify }) {
  const { bots, owners, defaultLimit, failed, refreshing, load, refresh } = useFleet();
  const [finder, setFinder] = useState("");
  const [found, setFound] = useState<Owner[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    const start = new URLSearchParams(window.location.search).get("q");
    if (!start) return;
    const timer = window.setTimeout(() => setFinder(start), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Look people up as the admin types, once they pause.
  useEffect(() => {
    const needle = finder.trim();
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!needle) { setFound(null); return; }
      botApi<{ items: Owner[] }>(`/api/admin/bot-limits?q=${encodeURIComponent(needle)}`).then((data) => { if (alive) setFound(data.items); }).catch(() => { if (alive) setFound([]); });
    }, needle ? 300 : 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [finder]);

  const allowedOf = (owner: Owner) => owner.limit ?? defaultLimit;
  const summary = useMemo(() => ({
    people: owners.length,
    custom: owners.filter((owner) => owner.limit !== null).length,
    over: owners.filter((owner) => owner.bots > (owner.limit ?? defaultLimit)).length,
  }), [owners, defaultLimit]);

  const listed = useMemo(() => {
    if (found !== null) return found;
    const list = owners.filter((owner) => (filter === "over" ? owner.bots > allowedOf(owner) : filter === "custom" ? owner.limit !== null : true));
    return [...list].sort((a, b) => b.bots - a.bots || a.username.localeCompare(b.username, "th"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, owners, filter, defaultLimit]);

  const forget = (id: number) => setDrafts((current) => { const next = { ...current }; delete next[id]; return next; });

  function step(owner: Owner, by: number) {
    const raw = drafts[owner.id] ?? (owner.limit ?? "").toString();
    const now = raw === "" ? defaultLimit : Number(raw);
    setDrafts((current) => ({ ...current, [owner.id]: String(Math.min(50, Math.max(0, now + by))) }));
  }

  async function save(owner: Owner) {
    const raw = (drafts[owner.id] ?? "").trim();
    const limit = raw === "" ? null : Number(raw);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 50)) {
      notify({ kind: "error", text: "โควตาต้องเป็นตัวเลข 0 ถึง 50 หรือเว้นว่างเพื่อใช้ค่าเริ่มต้น" });
      return;
    }
    setSaving(owner.id);
    try {
      await botApi(`/api/admin/bot-limits/${owner.id}`, botSend("PATCH", { limit }));
      notify({ kind: "success", text: limit === null ? `@${owner.username} ใช้โควตาเริ่มต้น ${defaultLimit} ตัว` : `@${owner.username} สร้างบอทได้ ${limit} ตัว` });
      forget(owner.id);
      if (found !== null) setFound((current) => (current ? current.map((item) => (item.id === owner.id ? { ...item, limit } : item)) : current));
      void load();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    } finally {
      setSaving(null);
    }
  }

  const row = (owner: Owner) => {
    const dirty = drafts[owner.id] !== undefined;
    const raw = drafts[owner.id] ?? (owner.limit ?? "").toString();
    const value = raw === "" ? defaultLimit : Number(raw);
    const allowed = allowedOf(owner);
    const over = owner.bots > allowed;
    const slots = Math.max(allowed, owner.bots);
    return (
      <li key={owner.id} className={`abx-qrow${dirty ? " is-dirty" : ""}${over ? " is-over" : ""}`}>
        <span className="abx-initial" aria-hidden="true">{owner.username.charAt(0).toUpperCase()}</span>
        <div className="abx-qwho">
          <a href={`/admin/bots/list?q=${encodeURIComponent(owner.username)}`} title="ดูบอทของคนนี้">@{owner.username}</a>
          <small className={over ? "is-wait" : ""}>
            มี {count(owner.bots)} จาก {count(allowed)} ตัว{owner.limit === null ? " · ค่าเริ่มต้น" : " · โควตาพิเศษ"}{over && " · เกินโควตา"}
          </small>
        </div>
        <span className="abx-slots" role="img" aria-label={`ใช้ ${owner.bots} จาก ${allowed} ตัว`}>
          {slots <= 24 ? Array.from({ length: slots }, (_, index) => <i key={index} className={index < owner.bots ? (index >= allowed ? "is-over" : "is-used") : ""} />) : <i className="is-used" style={{ width: `${Math.min(100, (owner.bots / slots) * 100)}%` }} />}
        </span>
        <form className="abx-qedit" onSubmit={(event: FormEvent) => { event.preventDefault(); void save(owner); }}>
          <span className="abx-stepper">
            <button type="button" onClick={() => step(owner, -1)} disabled={value <= 0} aria-label={`ลดโควตาของ ${owner.username}`}><Minus size={15} aria-hidden="true" /></button>
            <input
              inputMode="numeric"
              value={raw}
              onChange={(event) => setDrafts((current) => ({ ...current, [owner.id]: event.target.value.replace(/[^0-9]/g, "") }))}
              onKeyDown={(event) => { if (event.key === "Escape" && dirty) { event.stopPropagation(); forget(owner.id); } }}
              placeholder={String(defaultLimit)}
              aria-label={`โควตาของ ${owner.username} (เว้นว่างเพื่อใช้ค่าเริ่มต้น)`}
            />
            <button type="button" onClick={() => step(owner, 1)} disabled={value >= 50} aria-label={`เพิ่มโควตาของ ${owner.username}`}><Plus size={15} aria-hidden="true" /></button>
          </span>
          <span className="abx-qsave">
            <button type="submit" className="abx-btn is-primary is-sm" disabled={!dirty || saving === owner.id}>{saving === owner.id && <span className="abx-spin" aria-hidden="true" />}บันทึก</button>
            <button type="button" className="abx-icon is-sm" onClick={() => forget(owner.id)} disabled={!dirty || saving === owner.id} aria-label={`ยกเลิกการแก้โควตาของ ${owner.username}`} title="ยกเลิก"><X size={15} aria-hidden="true" /></button>
          </span>
        </form>
      </li>
    );
  };

  const loading = bots === null && !failed;
  const chips: { id: Filter; label: string; n: number }[] = [
    { id: "all", label: "ทั้งหมด", n: summary.people },
    { id: "over", label: "เกินโควตา", n: summary.over },
    { id: "custom", label: "โควตาพิเศษ", n: summary.custom },
  ];

  return (
    <div className="abx" aria-busy={loading}>
      <AdminBotsHead tab="quotas" title="โควตาบอทต่อคน" sub="กำหนดว่าแต่ละคนสร้างบอทได้กี่ตัว คนที่ไม่ได้ตั้งไว้จะใช้ค่าเริ่มต้นของระบบ">
        <button type="button" className="abx-btn is-icon" onClick={() => void refresh()} disabled={refreshing} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล"><RefreshCw size={16} aria-hidden="true" className={refreshing ? "abx-rotating" : ""} /></button>
      </AdminBotsHead>

      {failed && (
        <div className="abx-banner is-bad" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>ดึงข้อมูลโควตาไม่สำเร็จ: {failed}</span>
          <button type="button" className="abx-link" onClick={() => void refresh()} disabled={refreshing}>ลองอีกครั้ง</button>
        </div>
      )}

      <section className="abx-kpis is-three" aria-label="สรุปโควตา">
        <div className="abx-kpi"><span>ค่าเริ่มต้นต่อคน</span><strong>{bots ? `${count(defaultLimit)} ตัว` : <i className="abx-skel" />}</strong><small>ตั้งที่เซิร์ฟเวอร์ ใช้กับทุกคนที่ไม่มีโควตาพิเศษ</small></div>
        <div className="abx-kpi"><span>โควตาพิเศษ</span><strong>{bots ? count(summary.custom) : <i className="abx-skel" />}</strong><small>คนที่แอดมินตั้งให้เป็นรายคน</small></div>
        <div className="abx-kpi"><span>เกินโควตา</span><strong className={summary.over ? "is-wait" : ""}>{bots ? count(summary.over) : <i className="abx-skel" />}</strong><small>มีบอทมากกว่าที่ได้รับ (เกิดเมื่อลดโควตาทีหลัง)</small></div>
      </section>

      <section className="abx-panel" aria-label="รายการโควตา">
        <div className="abx-tools is-single">
          <label className="abx-search" role="search">
            <Search size={17} aria-hidden="true" />
            <input value={finder} onChange={(event) => setFinder(event.target.value)} placeholder="ค้นชื่อผู้ใช้เพื่อตั้งโควตา" aria-label="ค้นชื่อผู้ใช้" />
            {finder && <button type="button" onClick={() => setFinder("")} aria-label="ล้างคำค้น"><X size={15} /></button>}
          </label>
        </div>
        <div className="abx-filterbar">
          {found === null ? (
            <div className="abx-chips" role="group" aria-label="กรองรายชื่อ">
              {chips.map((chip) => (
                <button key={chip.id} type="button" className={filter === chip.id ? "is-active" : ""} aria-pressed={filter === chip.id} onClick={() => setFilter(chip.id)}>{chip.label}<span>{bots ? count(chip.n) : "–"}</span></button>
              ))}
            </div>
          ) : <p className="abx-meta">ผลการค้น {count(found.length)} คน</p>}
          <p className="abx-meta">ตั้งได้ 0 ถึง 50 · เว้นว่างเพื่อใช้ค่าเริ่มต้น</p>
        </div>

        {loading ? (
          <ul className="abx-list" aria-busy="true">{[0, 1, 2].map((index) => <li className="abx-row is-skeleton" key={index}><span /><span /><span /></li>)}</ul>
        ) : found !== null && found.length === 0 ? (
          <div className="abx-empty"><b>ไม่พบผู้ใช้ชื่อ “{finder.trim()}”</b><p>ลองพิมพ์ชื่อผู้ใช้ให้ครบขึ้นหรือสั้นลง</p></div>
        ) : listed.length === 0 ? (
          <div className="abx-empty"><b>{filter === "over" ? "ไม่มีใครเกินโควตา" : filter === "custom" ? "ยังไม่มีใครมีโควตาพิเศษ" : "ยังไม่มีใครมีบอท"}</b><p>ค้นชื่อผู้ใช้ด้านบนเพื่อตั้งโควตาให้ล่วงหน้าได้</p></div>
        ) : (
          <ul className="abx-qlist">{listed.map(row)}</ul>
        )}
      </section>
    </div>
  );
}
