"use client";

// The panel that opens from a row on the admin bot pages: facts about the bot, its latest log
// lines, its resource limits, and the things an admin does to it (start, stop, restart, delete).
// The owner's own workspace (files, variables, token) is one link away, not rebuilt here.
import { Copy, ExternalLink, Play, Power, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Ask, Notify } from "./types";
import { useEscape, useScrollLock } from "./useScrollLock";
import { BotAvatar, botApi, botSend, botStatusView, errorMessage, runtimeLabel, uptimeText, type Bot, type BotLogLine } from "./botsShared";
import { PageLink, actionVerb, allowedActions, ago, cpuOptions, cores, deleteBot, diskOptions, diskPercent, fullDate, megabytes, memoryOptions, sendBotAction, type BotAction } from "./adminBotsShared";

type Tab = "info" | "logs" | "resources";

const tabNames: { id: Tab; label: string }[] = [
  { id: "info", label: "ข้อมูล" },
  { id: "logs", label: "ล็อก" },
  { id: "resources", label: "ทรัพยากร" },
];

const tokenText = (bot: Bot) => {
  if (!bot.discord.hasToken) return { text: "ยังไม่ใส่โทเคน", tone: "wait" };
  if (bot.discord.tokenState === "invalid") return { text: "Discord ปฏิเสธโทเคน", tone: "bad" };
  if (bot.discord.tokenState === "valid") return { text: "โทเคนใช้งานได้", tone: "ok" };
  return { text: "มีโทเคน ยังไม่ได้ตรวจ", tone: "" };
};

const sourceText = (bot: Bot) => {
  if (!bot.source.hasCode) return "ยังไม่มีโค้ด";
  if (bot.source.kind === "github") return `GitHub ${bot.source.githubRepo}${bot.source.githubRef ? `@${bot.source.githubRef}` : ""}`;
  if (bot.source.kind === "template") return "เริ่มจากเทมเพลต";
  return "อัปโหลดไฟล์ ZIP";
};

export default function AdminBotDrawer({ bot, onClose, onChanged, notify, ask }: { bot: Bot; onClose: () => void; onChanged: () => void; notify: Notify; ask: Ask }) {
  const [tab, setTab] = useState<Tab>("info");
  const [now, setNow] = useState(() => Date.now());
  const closeRef = useRef<HTMLButtonElement>(null);
  const view = botStatusView(bot);
  const can = allowedActions(bot);
  useScrollLock(true);
  useEscape(true, onClose);

  useEffect(() => {
    closeRef.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  function run(action: BotAction) {
    const send = async () => {
      await sendBotAction(bot, action);
      notify({ kind: "success", text: `สั่ง${actionVerb[action]} ${bot.name} แล้ว` });
      onChanged();
      window.setTimeout(onChanged, 2500);
    };
    if (action === "start") {
      void send().catch((error) => notify({ kind: "error", text: errorMessage(error) }));
      return;
    }
    ask({
      title: `${actionVerb[action]} ${bot.name}`,
      message: action === "stop" ? `บอทของ @${bot.owner?.username || "ผู้ใช้"} จะออฟไลน์ เจ้าของเปิดใหม่ได้เองจากหน้าของเขา` : "บอทจะหลุดจาก Discord สักพักแล้วกลับมาใหม่",
      confirmLabel: `${actionVerb[action]}บอท`,
      danger: action === "stop",
      action: send,
    });
  }

  function remove() {
    ask({
      title: `ลบ ${bot.name}`,
      message: `บอทและไฟล์ทั้งหมดของ @${bot.owner?.username || "ผู้ใช้"} จะถูกลบถาวร กู้คืนไม่ได้ ใช้เมื่อบอทผิดกฎหรือเจ้าของขอให้ลบเท่านั้น`,
      confirmLabel: "ลบบอทถาวร",
      danger: true,
      action: async () => {
        await deleteBot(bot);
        notify({ kind: "success", text: `กำลังลบ ${bot.name}` });
        onChanged();
        onClose();
      },
    });
  }

  const token = tokenText(bot);
  const disk = diskPercent(bot);
  const facts: [string, React.ReactNode][] = [
    ["เจ้าของ", <PageLink key="owner" href="/admin/users" className="abx-link">@{bot.owner?.username || "-"}</PageLink>],
    ["ภาษา", `${runtimeLabel[bot.runtime]} · ${bot.startMode === "npm_start" ? "npm start" : bot.entryFile}`],
    ["โค้ด", <>{sourceText(bot)}{bot.source.pendingChanges && <span className="abx-tag is-wait">แก้แล้วยังไม่รีสตาร์ต</span>}</>],
    ["โทเคน Discord", <span key="token" className={`abx-tone is-${token.tone}`}>{token.text}</span>],
    ["บัญชีบอท", bot.discord.username ? <>@{bot.discord.username}{bot.discord.inviteUrl && <> · <a className="abx-link" href={bot.discord.inviteUrl} target="_blank" rel="noreferrer">ลิงก์เชิญ</a></>}</> : "–"],
    ["สร้างเมื่อ", fullDate(bot.createdAt)],
    ["เริ่มล่าสุด", bot.startedAt ? `${fullDate(bot.startedAt)}${view.tone === "online" ? ` · เปิดมา ${uptimeText(bot.startedAt, now)}` : ""}` : "–"],
    ["หยุดล่าสุด", bot.stoppedAt ? `${ago(bot.stoppedAt, now)}${bot.lastExitCode !== null ? ` · รหัสออก ${bot.lastExitCode}` : ""}` : "–"],
    ["รีสตาร์ตเอง", bot.restartCount ? `${bot.restartCount} ครั้ง` : "ไม่มี"],
  ];

  return createPortal(
    <div className="abx-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="abx-drawer" role="dialog" aria-modal="true" aria-label={`รายละเอียดของ ${bot.name}`}>
        <header className="abx-drawer-head">
          <BotAvatar bot={bot} size={44} />
          <div className="abx-drawer-id">
            <h2 title={bot.name}>{bot.name}</h2>
            <p><span className={`abx-pill is-${view.tone}`}><i aria-hidden="true" />{view.label}</span><span>@{bot.owner?.username || "-"}</span></p>
          </div>
          <button type="button" ref={closeRef} className="abx-icon" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={18} /></button>
        </header>

        {(view.tone === "bad" || bot.statusMessage) && (
          <p className={`abx-note ${view.tone === "bad" ? "is-bad" : ""}`} role="status">{bot.statusMessage || view.label}</p>
        )}

        <div className="abx-drawer-actions">
          <button type="button" className="abx-btn is-primary" onClick={() => run("start")} disabled={!can.start}><Play size={15} aria-hidden="true" />เปิด</button>
          <button type="button" className="abx-btn" onClick={() => run("restart")} disabled={!can.restart}><RotateCcw size={15} aria-hidden="true" />รีสตาร์ต</button>
          <button type="button" className="abx-btn is-danger-ghost" onClick={() => run("stop")} disabled={!can.stop}><Power size={15} aria-hidden="true" />ปิด</button>
          <a className="abx-btn is-quiet" href={`/bots?id=${encodeURIComponent(bot.id)}`} title="เปิดมุมมองของเจ้าของ: คอนโซล ไฟล์ ตัวแปร"><ExternalLink size={15} aria-hidden="true" />ไฟล์และคอนโซล</a>
        </div>

        <div className="abx-seg" role="tablist" aria-label="ส่วนของรายละเอียด">
          {tabNames.map((item) => (
            <button key={item.id} type="button" role="tab" id={`abx-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="abx-drawer-panel" className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>
          ))}
        </div>

        <div className="abx-drawer-body" id="abx-drawer-panel" role="tabpanel" aria-labelledby={`abx-tab-${tab}`}>
          {tab === "info" && (
            <>
              <dl className="abx-facts">
                {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
              <section className="abx-danger" aria-label="ลบบอท">
                <div>
                  <h3>ลบบอทนี้</h3>
                  <p>ลบถาวรพร้อมไฟล์และตัวแปรทั้งหมด โควตาของเจ้าของจะว่างขึ้น 1 ตัว</p>
                </div>
                <button type="button" className="abx-btn is-danger" onClick={remove} disabled={bot.pending?.kind === "bot.delete"}><Trash2 size={15} aria-hidden="true" />ลบบอท</button>
              </section>
            </>
          )}
          {tab === "logs" && <LogsTab bot={bot} />}
          {tab === "resources" && <ResourcesTab bot={bot} disk={disk} onSaved={onChanged} notify={notify} />}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

const streamLabel: Record<BotLogLine["stream"], string> = { system: "ระบบ", stdout: "out", stderr: "err" };

function LogsTab({ bot }: { bot: Bot }) {
  const [lines, setLines] = useState<BotLogLine[] | null>(null);
  const [failed, setFailed] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const cursor = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const pull = useCallback(async () => {
    try {
      const after = cursor.current > 0 ? `?after=${cursor.current}` : "";
      const data = await botApi<{ items: BotLogLine[] }>(`/api/bots/${encodeURIComponent(bot.id)}/logs${after}`);
      setFailed("");
      if (data.items.length === 0) {
        setLines((current) => current ?? []);
        return;
      }
      cursor.current = data.items[data.items.length - 1].id;
      setLines((current) => [...(current ?? []), ...data.items].slice(-600));
    } catch (error) {
      setFailed(errorMessage(error));
    }
  }, [bot.id]);

  useEffect(() => {
    cursor.current = 0;
    const first = window.setTimeout(() => void pull(), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void pull(); }, 3000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [pull]);

  useEffect(() => {
    const element = box.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lines, errorsOnly]);

  const shown = (lines ?? []).filter((line) => !errorsOnly || line.stream !== "stdout");
  const time = (value: string) => new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="abx-logs">
      <div className="abx-logs-bar">
        <label className="abx-check"><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />เฉพาะข้อผิดพลาดและระบบ</label>
        <button type="button" className="abx-link" onClick={() => void navigator.clipboard?.writeText(shown.map((line) => `${time(line.at)} ${line.message}`).join("\n"))} disabled={shown.length === 0}><Copy size={14} aria-hidden="true" />คัดลอก</button>
      </div>
      {failed && <p className="abx-note is-bad" role="alert">อ่านล็อกไม่สำเร็จ: {failed}</p>}
      <div
        className="abx-console"
        ref={box}
        tabIndex={0}
        role="log"
        aria-label={`ล็อกของ ${bot.name}`}
        onScroll={(event) => { const element = event.currentTarget; pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40; }}
      >
        {lines === null && !failed && <p className="abx-console-empty">กำลังโหลดล็อก...</p>}
        {lines !== null && shown.length === 0 && <p className="abx-console-empty">{errorsOnly ? "ยังไม่มีข้อผิดพลาด" : "บอทยังไม่เคยพิมพ์อะไรออกมา"}</p>}
        {shown.map((line) => (
          <p key={line.id} className={`is-${line.stream}`}><time dateTime={line.at}>{time(line.at)}</time><b>{streamLabel[line.stream]}</b><span>{line.message}</span></p>
        ))}
      </div>
      <p className="abx-hint">แสดง {shown.length.toLocaleString("th-TH")} บรรทัดล่าสุด อัปเดตทุก 3 วินาที</p>
    </div>
  );
}

function ResourcesTab({ bot, disk, onSaved, notify }: { bot: Bot; disk: number | null; onSaved: () => void; notify: Notify }) {
  const [memory, setMemory] = useState(bot.resources.memoryMb);
  const [cpu, setCpu] = useState(bot.resources.cpuMillicores);
  const [diskLimit, setDiskLimit] = useState(bot.resources.diskLimitMb);
  const [saving, setSaving] = useState(false);
  const dirty = memory !== bot.resources.memoryMb || cpu !== bot.resources.cpuMillicores || diskLimit !== bot.resources.diskLimitMb;
  const withCurrent = (options: number[], value: number) => (options.includes(value) ? options : [...options, value].sort((a, b) => a - b));

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await botApi<{ restartRequired: boolean }>(`/api/admin/bots/${encodeURIComponent(bot.id)}`, botSend("PATCH", { memoryMb: memory, cpuMillicores: cpu, diskLimitMb: diskLimit }));
      notify({ kind: "success", text: result.restartRequired ? `บันทึกแล้ว ค่าใหม่มีผลเมื่อ ${bot.name} รีสตาร์ต` : "บันทึกแล้ว" });
      onSaved();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="abx-form" onSubmit={save}>
      <div className="abx-usage" aria-label="พื้นที่ดิสก์ที่ใช้">
        <div><span>ดิสก์ที่ใช้</span><b>{bot.resources.diskUsedMb === null ? "ยังไม่ทราบ" : `${bot.resources.diskUsedMb.toLocaleString("th-TH")} / ${megabytes(bot.resources.diskLimitMb)}`}</b></div>
        <span className={`abx-meter${disk !== null && disk >= 98 ? " is-full" : disk !== null && disk >= 85 ? " is-high" : ""}`}><i style={{ width: `${disk ?? 0}%` }} /></span>
      </div>
      <label className="abx-field">
        <span>หน่วยความจำ</span>
        <select value={memory} onChange={(event) => setMemory(Number(event.target.value))}>
          {withCurrent(memoryOptions, memory).map((value) => <option key={value} value={value}>{megabytes(value)}</option>)}
        </select>
      </label>
      <label className="abx-field">
        <span>CPU</span>
        <select value={cpu} onChange={(event) => setCpu(Number(event.target.value))}>
          {withCurrent(cpuOptions, cpu).map((value) => <option key={value} value={value}>{cores(value)} คอร์</option>)}
        </select>
      </label>
      <label className="abx-field">
        <span>ดิสก์ (โค้ดรวมข้อมูล)</span>
        <select value={diskLimit} onChange={(event) => setDiskLimit(Number(event.target.value))}>
          {withCurrent(diskOptions, diskLimit).map((value) => <option key={value} value={value}>{megabytes(value)}</option>)}
        </select>
      </label>
      <p className="abx-hint">{bot.status === "running" ? "บอทกำลังทำงานอยู่ ค่าใหม่มีผลเมื่อรีสตาร์ต" : "ค่าใหม่มีผลตอนเปิดบอทครั้งถัดไป"}</p>
      <div className="abx-form-foot">
        <button type="button" className="abx-btn" onClick={() => { setMemory(bot.resources.memoryMb); setCpu(bot.resources.cpuMillicores); setDiskLimit(bot.resources.diskLimitMb); }} disabled={!dirty || saving}>คืนค่าเดิม</button>
        <button type="submit" className="abx-btn is-primary" disabled={!dirty || saving}>{saving && <span className="abx-spin" aria-hidden="true" />}บันทึก</button>
      </div>
    </form>
  );
}
