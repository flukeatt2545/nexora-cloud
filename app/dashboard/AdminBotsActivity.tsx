"use client";

// /admin/bots/activity: what the bot runtime is working on (jobs waiting and running, and the
// ones that just failed) next to the trail of who changed what.
import { CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { botApi, errorMessage } from "./botsShared";
import { AdminBotsHead, actionLabel, ago, count, fullDate, type BotEvent, type BotOperation } from "./adminBotsShared";
import "./bots-view.css";
import "./admin-bots.css";

type Data = { operations: BotOperation[]; events: BotEvent[] };
type OpFilter = "all" | "active" | "failed";

const stateText: Record<BotOperation["state"], string> = { queued: "รอคิว", running: "กำลังทำ", succeeded: "สำเร็จ", failed: "ไม่สำเร็จ" };
const stateTone: Record<BotOperation["state"], string> = { queued: "busy", running: "busy", succeeded: "online", failed: "bad" };

/** How long a job took or has been waiting, in plain minutes and seconds. */
function span(from: string | null, to: string | null, now: number) {
  if (!from) return "";
  const seconds = Math.max(0, Math.round(((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000));
  if (seconds < 60) return `${seconds} วิ`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} นาที ${seconds % 60} วิ` : `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

/** The detail line of an audit entry, from what the entry recorded. */
function eventDetail(event: BotEvent) {
  const data = event.metadata || {};
  if (event.action === "bot.resources.updated") return `RAM ${data.memoryMb} MB · CPU ${(Number(data.cpuMillicores) / 1000).toLocaleString("th-TH")} คอร์ · ดิสก์ ${data.diskLimitMb} MB`;
  if (event.action === "bot.limit.updated") return data.limit === null || data.limit === undefined ? "กลับไปใช้ค่าเริ่มต้น" : `โควตา ${data.limit} ตัว`;
  return "";
}

export default function AdminBotsActivity() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<OpFilter>("all");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await botApi<Data>("/api/admin/bots/activity"));
      setFailed("");
    } catch (error) {
      setFailed(errorMessage(error));
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const operations = data?.operations || [];
  const active = operations.filter((operation) => operation.state === "queued" || operation.state === "running");
  const bad = operations.filter((operation) => operation.state === "failed");
  const shown = filter === "active" ? active : filter === "failed" ? bad : operations;
  const loading = data === null && !failed;

  return (
    <div className="abx" aria-busy={loading}>
      <AdminBotsHead tab="activity" title="คิวงานและประวัติ" sub="งานที่ระบบกำลังทำให้บอท (เปิด ปิด รีสตาร์ต ติดตั้ง ลบ) และบันทึกว่าใครเปลี่ยนอะไร">
        <button type="button" className="abx-btn is-icon" onClick={() => void refresh()} disabled={refreshing} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล"><RefreshCw size={16} aria-hidden="true" className={refreshing ? "abx-rotating" : ""} /></button>
      </AdminBotsHead>

      {failed && (
        <div className="abx-banner is-bad" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>ดึงข้อมูลไม่สำเร็จ: {failed}{data ? " (ข้อมูลที่เห็นเป็นรอบก่อน)" : ""}</span>
          <button type="button" className="abx-link" onClick={() => void refresh()} disabled={refreshing}>ลองอีกครั้ง</button>
        </div>
      )}

      <div className="abx-cols is-even">
        <section className="abx-panel" aria-labelledby="abx-ops-title">
          <header className="abx-panel-head">
            <h2 id="abx-ops-title">คิวงานของระบบ</h2>
            <span>{data ? (active.length ? `กำลังทำ ${count(active.length)} งาน` : "ไม่มีงานค้าง") : "กำลังโหลด"}</span>
          </header>
          <div className="abx-filterbar is-flush">
            <div className="abx-chips" role="group" aria-label="กรองงาน">
              <button type="button" className={filter === "all" ? "is-active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>ล่าสุด<span>{data ? count(operations.length) : "–"}</span></button>
              <button type="button" className={filter === "active" ? "is-active" : ""} aria-pressed={filter === "active"} onClick={() => setFilter("active")}>ค้างอยู่<span>{data ? count(active.length) : "–"}</span></button>
              <button type="button" className={filter === "failed" ? "is-active" : ""} aria-pressed={filter === "failed"} onClick={() => setFilter("failed")}>ไม่สำเร็จ<span>{data ? count(bad.length) : "–"}</span></button>
            </div>
          </div>
          {loading ? (
            <ul className="abx-list">{[0, 1, 2].map((index) => <li className="abx-row is-skeleton" key={index}><span /><span /><span /></li>)}</ul>
          ) : shown.length === 0 ? (
            <div className="abx-empty is-tight"><b>{filter === "failed" ? "ไม่มีงานที่ล้มเหลว" : filter === "active" ? "ไม่มีงานค้าง" : "ยังไม่มีงาน"}</b><p>{filter === "all" ? "เมื่อมีคนเปิดหรือปิดบอท งานจะมาปรากฏที่นี่" : "ดูแท็บ “ล่าสุด” เพื่อดูงานทั้งหมด"}</p></div>
          ) : (
            <ul className="abx-jobs">
              {shown.map((operation) => (
                <li key={operation.id} className={`is-${stateTone[operation.state]}`}>
                  <span className={`abx-pill is-${stateTone[operation.state]}`}><i aria-hidden="true" />{stateText[operation.state]}</span>
                  <div className="abx-job-copy">
                    <b>{actionLabel[operation.kind] || operation.kind} <a href={`/admin/bots/list?bot=${encodeURIComponent(operation.bot.id)}`}>{operation.bot.name}</a></b>
                    <small>
                      @{operation.owner || "-"}{operation.actor && operation.actor !== operation.owner ? ` · สั่งโดย ${operation.actor}` : ""}
                      {operation.state === "running" && operation.phase ? ` · ขั้น ${operation.phase}` : ""}
                      {operation.attempt > 1 ? ` · ลองรอบที่ ${operation.attempt}` : ""}
                    </small>
                    {operation.state === "failed" && operation.error && <small className="abx-job-error">{operation.error}</small>}
                  </div>
                  <time dateTime={operation.createdAt} title={fullDate(operation.createdAt)}>
                    {ago(operation.createdAt, now)}
                    {operation.startedAt && <small>{operation.state === "queued" ? "" : `ใช้เวลา ${span(operation.startedAt, operation.finishedAt, now)}`}</small>}
                    {operation.state === "queued" && <small>รอมา {span(operation.createdAt, null, now)}</small>}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="abx-panel" aria-labelledby="abx-trail-title">
          <header className="abx-panel-head"><h2 id="abx-trail-title">ใครทำอะไร</h2><span>60 รายการล่าสุด</span></header>
          {loading ? (
            <ul className="abx-list">{[0, 1, 2].map((index) => <li className="abx-row is-skeleton" key={index}><span /><span /><span /></li>)}</ul>
          ) : (data?.events.length ?? 0) === 0 ? (
            <div className="abx-empty is-tight"><b>ยังไม่มีประวัติ</b><p>การสร้าง ลบ ปรับทรัพยากร และเปลี่ยนโควตาจะถูกบันทึกไว้ที่นี่</p></div>
          ) : (
            <ol className="abx-trail">
              {data!.events.map((event) => (
                <li key={event.id} className={event.outcome === "failure" ? "is-bad" : ""}>
                  <i aria-hidden="true" />
                  <div>
                    <b>{actionLabel[event.action] || event.action}{event.targetName && <span> · {event.targetName}</span>}</b>
                    <small>โดย {event.actor || "ระบบ"}{event.actorRole === "superadmin" ? " (ผู้ดูแลสูงสุด)" : event.actorRole === "admin" ? " (แอดมิน)" : ""}{eventDetail(event) && ` · ${eventDetail(event)}`}{event.outcome === "failure" && " · ไม่สำเร็จ"}</small>
                  </div>
                  <time dateTime={event.createdAt} title={fullDate(event.createdAt)}>{ago(event.createdAt, now)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <p className="abx-foot">รีเฟรชอัตโนมัติทุก 5 วินาที · ประวัติทั้งหมดของระบบดูได้ที่เมนู บันทึกกิจกรรม (ผู้ดูแลสูงสุด)</p>
    </div>
  );
}
