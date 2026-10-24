"use client";

// /admin/bots: the state of the bot hosting at a glance. What needs a person first, then the
// numbers (how many, how much memory and disk the bots hold), who uses the most, and what just happened.
import { CheckCircle2, ChevronRight, CircleAlert, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Ask, Notify } from "./types";
import { botApi, botIsUp, botStatusView, runtimeLabel, type Bot, type StatusTone } from "./botsShared";
import BotCreateWizard from "./BotCreateWizard";
import AdminBotDrawer from "./AdminBotDrawer";
import { AdminBotsHead, PageLink, actionLabel, ago, allowedActions, clock, cores, count, findIssues, megabytes, sendBotAction, toneLabel, useFleet, type BotEvent, type BotOperation } from "./adminBotsShared";
import "./bots-view.css";
import "./admin-bots.css";

const toneOrder: StatusTone[] = ["online", "busy", "bad", "off"];

export default function AdminBotsOverview({ notify, ask }: { notify: Notify; ask: Ask }) {
  const { bots, owners, defaultLimit, failed, loadedAt, refreshing, load, refresh } = useFleet();
  const [recent, setRecent] = useState<{ operations: BotOperation[]; events: BotEvent[] } | null>(null);
  const [openId, setOpenId] = useState("");
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const pull = () => botApi<{ operations: BotOperation[]; events: BotEvent[] }>("/api/admin/bots/activity").then((data) => { if (alive) setRecent(data); }).catch(() => { if (alive) setRecent((current) => current ?? { operations: [], events: [] }); });
    const first = window.setTimeout(pull, 0);
    const timer = window.setInterval(() => { if (!document.hidden) { pull(); setNow(Date.now()); } }, 15000);
    return () => { alive = false; window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  const stats = useMemo(() => {
    const list = bots || [];
    const tones: Record<StatusTone, number> = { online: 0, busy: 0, bad: 0, off: 0 };
    const runtimes = { node: 0, python: 0 };
    let upMemory = 0, upCpu = 0, allMemory = 0, allCpu = 0, diskUsed = 0, diskGranted = 0, diskKnown = 0;
    const byOwner = new Map<string, { name: string; bots: number; up: number; memory: number }>();
    for (const bot of list) {
      tones[botStatusView(bot).tone] += 1;
      runtimes[bot.runtime] += 1;
      allMemory += bot.resources.memoryMb;
      allCpu += bot.resources.cpuMillicores;
      diskGranted += bot.resources.diskLimitMb;
      if (bot.resources.diskUsedMb !== null) { diskUsed += bot.resources.diskUsedMb; diskKnown += 1; }
      const up = botIsUp(bot);
      if (up) { upMemory += bot.resources.memoryMb; upCpu += bot.resources.cpuMillicores; }
      const key = bot.owner?.username || "-";
      const entry = byOwner.get(key) || { name: key, bots: 0, up: 0, memory: 0 };
      entry.bots += 1;
      if (up) { entry.up += 1; entry.memory += bot.resources.memoryMb; }
      byOwner.set(key, entry);
    }
    const top = [...byOwner.values()].sort((a, b) => b.memory - a.memory || b.bots - a.bots).slice(0, 5);
    return { total: list.length, tones, runtimes, upMemory, upCpu, allMemory, allCpu, diskUsed, diskGranted, diskKnown, top, people: byOwner.size };
  }, [bots]);

  const issues = useMemo(() => findIssues(bots || [], owners, defaultLimit), [bots, owners, defaultLimit]);
  const opened = openId ? (bots || []).find((bot) => bot.id === openId) || null : null;
  const loading = bots === null && !failed;
  const skel = (value: string) => (bots ? value : <i className="abx-skel" />);

  function restart(bot: Bot) {
    ask({
      title: `รีสตาร์ต ${bot.name}`,
      message: "บอทจะหลุดจาก Discord สักพักแล้วกลับมาใหม่ ถ้าโค้ดยังพังอยู่ก็จะล้มอีก ดูล็อกก่อนจะรู้สาเหตุ",
      confirmLabel: "รีสตาร์ต",
      action: async () => {
        await sendBotAction(bot, bot.status === "running" ? "restart" : "start");
        notify({ kind: "success", text: `สั่งรีสตาร์ต ${bot.name} แล้ว` });
        void load();
      },
    });
  }

  return (
    <div className="abx" aria-busy={loading}>
      <AdminBotsHead tab="overview" title="ภาพรวมบอท" sub="ดูว่าบอทของผู้ใช้ทั้งหมดเป็นอย่างไร ใครใช้ทรัพยากรมากที่สุด และมีอะไรที่ต้องมีคนไปดู">
        <button type="button" className="abx-btn is-icon" onClick={() => { void refresh(); }} disabled={refreshing} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล"><RefreshCw size={16} aria-hidden="true" className={refreshing ? "abx-rotating" : ""} /></button>
        <button type="button" className="abx-btn is-primary" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" />เพิ่มบอทให้ผู้ใช้</button>
      </AdminBotsHead>

      {failed && (
        <div className="abx-banner is-bad" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <span>ดึงข้อมูลบอทไม่สำเร็จ: {failed}{bots ? " (ข้อมูลที่เห็นเป็นรอบก่อน)" : ""}</span>
          <button type="button" className="abx-link" onClick={() => void refresh()} disabled={refreshing}>ลองอีกครั้ง</button>
        </div>
      )}

      <section className="abx-attention" aria-label="สิ่งที่ต้องดูแล" aria-live="polite">
        <header>
          <h2>{bots === null ? "สิ่งที่ต้องดูแล" : issues.length ? <>ต้องดูแล <span className="abx-count is-bad">{issues.length}</span></> : "สิ่งที่ต้องดูแล"}</h2>
          {issues.length > 0 && <PageLink className="abx-more" href="/admin/bots/list?status=bad">ดูบอทที่มีปัญหา<ChevronRight size={15} aria-hidden="true" /></PageLink>}
        </header>
        {bots === null ? (
          <div className="abx-calm"><span className="abx-skel" /></div>
        ) : issues.length === 0 ? (
          <p className="abx-calm"><CheckCircle2 size={18} aria-hidden="true" />ตอนนี้ไม่มีบอทที่พัง ดิสก์ใกล้เต็ม หรือเกินโควตา</p>
        ) : (
          <ul>
            {issues.slice(0, 6).map((issue) => (
              <li key={issue.id} className={`is-${issue.level}`}>
                {issue.level === "bad" ? <CircleAlert size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}
                <div><b>{issue.title}</b><span>{issue.detail}</span></div>
                {issue.kind === "bot" && issue.bot ? (
                  <div className="abx-issue-actions">
                    {issue.bot.status === "crashed" || issue.bot.status === "error" || issue.id.startsWith("loop") ? (
                      <button type="button" className="abx-btn is-sm" onClick={() => restart(issue.bot!)} disabled={!allowedActions(issue.bot).start && !allowedActions(issue.bot).restart}>รีสตาร์ต</button>
                    ) : null}
                    <button type="button" className="abx-btn is-sm is-primary" onClick={() => setOpenId(issue.bot!.id)}>ดูรายละเอียด</button>
                  </div>
                ) : (
                  <div className="abx-issue-actions"><PageLink className="abx-btn is-sm is-primary" href={`/admin/bots/quotas?q=${encodeURIComponent(issue.owner?.username || "")}`}>ตั้งโควตา</PageLink></div>
                )}
              </li>
            ))}
            {issues.length > 6 && <li className="abx-more-row"><PageLink href="/admin/bots/list?status=bad">และอีก {count(issues.length - 6)} เรื่อง ดูในรายการบอท</PageLink></li>}
          </ul>
        )}
      </section>

      <section className="abx-kpis" aria-label="สรุปบอท">
        <PageLink className="abx-kpi" href="/admin/bots/list">
          <span>บอททั้งหมด</span>
          <strong>{skel(count(stats.total))}</strong>
          <small>{bots ? `ของผู้ใช้ ${count(stats.people)} คน` : "กำลังโหลด"}</small>
        </PageLink>
        <PageLink className="abx-kpi" href="/admin/bots/list?status=online">
          <span>ออนไลน์</span>
          <strong className={stats.tones.online ? "is-ok" : ""}>{skel(count(stats.tones.online))}</strong>
          <small>{bots ? `ปิดอยู่ ${count(stats.tones.off)} · กำลังเปิดหรือปิด ${count(stats.tones.busy)}` : "กำลังโหลด"}</small>
        </PageLink>
        <PageLink className="abx-kpi" href="/admin/bots/list?status=bad">
          <span>มีปัญหา</span>
          <strong className={stats.tones.bad ? "is-bad" : ""}>{skel(count(stats.tones.bad))}</strong>
          <small>โค้ดพังหรือเปิดไม่สำเร็จ</small>
        </PageLink>
        <div className="abx-kpi">
          <span>RAM ที่ใช้อยู่ตอนนี้</span>
          <strong>{skel(megabytes(stats.upMemory))}</strong>
          <small>{bots ? `CPU ${cores(stats.upCpu)} คอร์ · จากบอทที่เปิด ${count(stats.tones.online + stats.tones.busy)} ตัว` : "กำลังโหลด"}</small>
        </div>
      </section>

      <div className="abx-cols">
        <section className="abx-panel" aria-labelledby="abx-res-title">
          <header className="abx-panel-head"><h2 id="abx-res-title">ทรัพยากร</h2><span>เทียบกับที่ให้บอททุกตัวไว้</span></header>
          <div className="abx-gauges">
            <Gauge label="RAM" used={stats.upMemory} total={stats.allMemory} format={megabytes} note="ที่บอทเปิดอยู่จองไว้" ready={bots !== null} />
            <Gauge label="CPU" used={stats.upCpu} total={stats.allCpu} format={(value) => `${cores(value)} คอร์`} note="ที่บอทเปิดอยู่จองไว้" ready={bots !== null} />
            <Gauge label="ดิสก์" used={stats.diskUsed} total={stats.diskGranted} format={megabytes} note={bots && stats.diskKnown < stats.total ? `วัดแล้ว ${count(stats.diskKnown)} จาก ${count(stats.total)} ตัว` : "ที่ใช้จริงของทุกบอท"} ready={bots !== null} />
          </div>
          <div className="abx-split" aria-label="สถานะของบอททั้งหมด">
            <div className="abx-split-bar" role="img" aria-label={toneOrder.map((tone) => `${toneLabel[tone]} ${stats.tones[tone]} ตัว`).join(" ")}>
              {toneOrder.map((tone) => stats.tones[tone] > 0 && <i key={tone} className={`is-${tone}`} style={{ flexGrow: stats.tones[tone] }} />)}
              {stats.total === 0 && <i className="is-off" style={{ flexGrow: 1 }} />}
            </div>
            <ul>
              {toneOrder.map((tone) => <li key={tone}><i className={`is-${tone}`} aria-hidden="true" />{toneLabel[tone]}<b>{bots ? count(stats.tones[tone]) : "–"}</b></li>)}
              <li className="is-sep"><i className="is-node" aria-hidden="true" />{runtimeLabel.node}<b>{bots ? count(stats.runtimes.node) : "–"}</b></li>
              <li><i className="is-python" aria-hidden="true" />{runtimeLabel.python}<b>{bots ? count(stats.runtimes.python) : "–"}</b></li>
            </ul>
          </div>
        </section>

        <section className="abx-panel" aria-labelledby="abx-top-title">
          <header className="abx-panel-head"><h2 id="abx-top-title">ผู้ใช้ที่ใช้มากที่สุด</h2><span>ตาม RAM ของบอทที่เปิดอยู่</span></header>
          {bots === null ? <div className="abx-empty is-tight"><span className="abx-skel" /></div> : stats.top.length === 0 ? (
            <div className="abx-empty is-tight"><p>ยังไม่มีใครมีบอท</p></div>
          ) : (
            <ol className="abx-top">
              {stats.top.map((entry) => (
                <li key={entry.name}>
                  <PageLink href={`/admin/bots/list?q=${encodeURIComponent(entry.name)}`}>
                    <span className="abx-initial" aria-hidden="true">{entry.name.charAt(0).toUpperCase()}</span>
                    <span className="abx-top-copy"><b>@{entry.name}</b><small>มี {count(entry.bots)} ตัว · เปิดอยู่ {count(entry.up)}</small></span>
                    <span className="abx-top-ram">{megabytes(entry.memory)}</span>
                  </PageLink>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="abx-panel" aria-labelledby="abx-recent-title">
        <header className="abx-panel-head">
          <h2 id="abx-recent-title">ล่าสุด</h2>
          <PageLink className="abx-more" href="/admin/bots/activity">คิวงานและประวัติทั้งหมด<ChevronRight size={15} aria-hidden="true" /></PageLink>
        </header>
        {recent === null ? <div className="abx-empty is-tight"><span className="abx-skel" /></div> : recent.events.length === 0 ? (
          <div className="abx-empty is-tight"><p>ยังไม่มีความเคลื่อนไหว</p></div>
        ) : (
          <ul className="abx-feed">
            {recent.events.slice(0, 6).map((event) => (
              <li key={event.id}>
                <i className={event.outcome === "failure" ? "is-bad" : ""} aria-hidden="true" />
                <span><b>{actionLabel[event.action] || event.action}</b>{event.targetName ? ` · ${event.targetName}` : ""}<small> โดย {event.actor || "ระบบ"}</small></span>
                <time dateTime={event.createdAt}>{ago(event.createdAt, now)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loadedAt && <p className="abx-foot">อัปเดตอัตโนมัติทุก 10 วินาที · ล่าสุด {clock(loadedAt)}</p>}

      {opened && <AdminBotDrawer bot={opened} onClose={() => setOpenId("")} onChanged={() => void load()} notify={notify} ask={ask} />}
      {creating && (
        <BotCreateWizard
          forAdmin
          onClose={() => setCreating(false)}
          onCreated={(bot) => { setCreating(false); window.location.href = `/admin/bots/list?bot=${encodeURIComponent(bot.id)}`; }}
          notify={notify}
        />
      )}
    </div>
  );
}

function Gauge({ label, used, total, format, note, ready }: { label: string; used: number; total: number; format: (value: number) => string; note: string; ready: boolean }) {
  const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="abx-gauge">
      <div className="abx-gauge-top"><span>{label}</span><b>{ready ? `${format(used)} / ${format(total)}` : "–"}</b></div>
      <span className="abx-meter is-wide" role="img" aria-label={ready ? `${label} ${Math.round(percent)}%` : `${label} กำลังโหลด`}><i style={{ width: `${percent}%` }} /></span>
      <small>{note}</small>
    </div>
  );
}
