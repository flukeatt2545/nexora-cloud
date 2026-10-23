"use client";

// One bot's page: status and controls on top, then the console, files, secrets and settings.
// A single request every two seconds brings both new console lines and the bot's state.
import { ArrowLeft, CircleAlert, ExternalLink, FileCode, KeyRound, Play, Power, RefreshCw, RotateCcw, Settings, SquareTerminal, Variable } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Ask } from "./types";
import { BotAvatar, StatusPill, botApi, botIsBusy, botIsUp, botSend, errorMessage, runtimeLabel, shortDateTime, uptimeText, type Bot, type BotLogLine } from "./botsShared";
import BotConsole from "./BotConsole";
import BotFiles from "./BotFiles";
import { BotEnvironment, BotSettings } from "./BotSettings";

type Notify = (notice: { kind: "success" | "error"; text: string; title?: string }) => void;
type Tab = "console" | "files" | "env" | "settings";

const tabs: { id: Tab; label: string; icon: typeof SquareTerminal }[] = [
  { id: "console", label: "คอนโซล", icon: SquareTerminal },
  { id: "files", label: "ไฟล์", icon: FileCode },
  { id: "env", label: "ตัวแปรลับ", icon: Variable },
  { id: "settings", label: "ตั้งค่า", icon: Settings },
];

const MAX_LINES = 2000;
const phaseStep: Record<string, number> = { preparing: 0, installing: 1, starting: 2 };

export default function BotDetail({ botId, onBack, notify, ask }: { botId: string; onBack: () => void; notify: Notify; ask: Ask }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [missing, setMissing] = useState("");
  const [lines, setLines] = useState<BotLogLine[]>([]);
  const [tab, setTab] = useState<Tab>("console");
  const [now, setNow] = useState(() => Date.now());
  const [acting, setActing] = useState("");
  const lastId = useRef(0);
  const polling = useRef(false);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const after = lastId.current;
      const data = await botApi<{ items: BotLogLine[]; bot: Bot }>(`/api/bots/${encodeURIComponent(botId)}/logs${after ? `?after=${after}` : ""}`);
      setBot(data.bot);
      setMissing("");
      if (data.items.length) {
        lastId.current = data.items[data.items.length - 1].id;
        setLines((current) => {
          const merged = after ? current.concat(data.items) : data.items;
          return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
        });
      }
    } catch (error) {
      setMissing((current) => current || errorMessage(error));
    } finally {
      polling.current = false;
    }
  }, [botId]);

  useEffect(() => {
    const first = window.setTimeout(() => void poll(), 0);
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (!document.hidden) void poll();
    }, 2000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [poll]);

  const refresh = useCallback((next?: Bot) => {
    if (next) setBot(next);
    void poll();
  }, [poll]);

  async function operate(action: "start" | "stop" | "restart" | "rebuild") {
    if (!bot) return;
    setActing(action);
    const kind = action === "rebuild" ? "bot.deploy" : `bot.${action}`;
    setBot({ ...bot, pending: { kind, state: "queued", phase: "pending" } });
    try {
      await botApi(`/api/bots/${encodeURIComponent(bot.id)}/operations`, botSend("POST", { action }));
      if (action !== "stop") setTab("console");
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
    } finally {
      setActing("");
      void poll();
    }
  }

  if (!bot) {
    return (
      <div className="bt">
        <button type="button" className="bt-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />บอททั้งหมด</button>
        {missing ? (
          <div className="bt-callout is-bad" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{missing}</span></div>
        ) : (
          <div className="bt-hero is-skeleton" aria-busy="true"><span /><span /></div>
        )}
      </div>
    );
  }

  const up = botIsUp(bot);
  const busy = botIsBusy(bot) || Boolean(acting);
  // The worker names its step in the job's phase (runtime-worker bots.go setBotPhase).
  const phase = bot.pending ? (phaseStep[bot.pending.phase] ?? 0) : -1;
  const startingJob = bot.pending && bot.pending.kind !== "bot.stop" && bot.pending.kind !== "bot.delete";
  // The API refuses start/restart without a token (code bot_no_token); keep the buttons in step.
  const needsToken = bot.source.hasCode && !bot.discord.hasToken;

  return (
    <div className="bt">
      <button type="button" className="bt-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />บอททั้งหมด</button>

      <section className={`bt-hero is-${bot.status}`}>
        <div className="bt-hero-id">
          <BotAvatar bot={bot} size={64} />
          <div className="bt-hero-copy">
            <h1>{bot.name}</h1>
            <p>
              {bot.discord.username ? <>@{bot.discord.username}</> : "ยังไม่ได้เชื่อมกับบอทใน Discord"}
              {bot.owner && <> · ของ {bot.owner.username}</>}
            </p>
            <StatusPill bot={bot} />
          </div>
        </div>
        <div className="bt-hero-actions">
          {up ? (
            <>
              <button type="button" className="bt-btn" onClick={() => void operate("restart")} disabled={busy || !bot.source.hasCode || needsToken}><RotateCcw size={16} aria-hidden="true" />รีสตาร์ต</button>
              <button type="button" className="bt-btn bt-btn-stop" onClick={() => ask({ title: "ปิดบอท", message: `${bot.name} จะออฟไลน์จนกว่าจะเปิดใหม่`, confirmLabel: "ปิดบอท", action: () => operate("stop") })} disabled={busy}>
                {acting === "stop" || bot.pending?.kind === "bot.stop" ? <span className="bt-spinner" aria-hidden="true" /> : <Power size={16} aria-hidden="true" />}ปิดบอท
              </button>
            </>
          ) : (
            <button type="button" className="bt-btn bt-btn-primary bt-btn-lg" onClick={() => void operate("start")} disabled={busy || !bot.source.hasCode || needsToken} title={needsToken ? "ใส่โทเคนบอทก่อนถึงจะเปิดได้" : undefined}>
              {busy ? <span className="bt-spinner" aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}{busy ? "กำลังเปิด" : "เปิดบอท"}
            </button>
          )}
          {bot.discord.inviteUrl && (
            <a className="bt-btn" href={bot.discord.inviteUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />เชิญเข้าเซิร์ฟเวอร์</a>
          )}
        </div>

        {startingJob && (
          <ol className="bt-phases" aria-label="ความคืบหน้า">
            {["เตรียมโค้ด", "ติดตั้งแพ็กเกจ", "เปิดบอท"].map((label, index) => (
              <li key={label} className={index < phase ? "is-done" : index === phase ? "is-current" : ""}>
                <span aria-hidden="true" />{label}
              </li>
            ))}
          </ol>
        )}
      </section>

      {!bot.source.hasCode && (
        <div className="bt-callout">
          <FileCode size={18} aria-hidden="true" />
          <span>บอทตัวนี้ยังไม่มีโค้ด อัปโหลดไฟล์ ZIP หรือดึงจาก GitHub ในแท็บไฟล์</span>
          <button type="button" className="bt-btn" onClick={() => setTab("files")}>ไปที่ไฟล์</button>
        </div>
      )}
      {needsToken && (
        <div className="bt-callout is-warn" role="status">
          <KeyRound size={18} aria-hidden="true" />
          <span>ยังไม่ได้ใส่โทเคนบอท ต้องใส่ก่อนถึงจะเปิดบอทได้</span>
          <button type="button" className="bt-btn" onClick={() => setTab("env")}>ใส่โทเคน</button>
        </div>
      )}
      {(bot.status === "crashed" || bot.status === "error") && bot.statusMessage && !bot.pending && (
        <div className="bt-callout is-bad" role="status">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{bot.statusMessage}</span>
          <button type="button" className="bt-btn" onClick={() => setTab("console")}>ดูคอนโซล</button>
        </div>
      )}
      {bot.source.pendingChanges && up && !bot.pending && (
        <div className="bt-callout">
          <RefreshCw size={18} aria-hidden="true" />
          <span>โค้ดถูกแก้หลังจากเปิดบอท รีสตาร์ตเพื่อใช้โค้ดใหม่</span>
          <button type="button" className="bt-btn" onClick={() => void operate("rebuild")}>รีสตาร์ตด้วยโค้ดใหม่</button>
        </div>
      )}

      <dl className="bt-stats">
        <div><dt>{up ? "ออนไลน์มา" : "ปิดเมื่อ"}</dt><dd>{up ? (bot.status === "running" ? uptimeText(bot.startedAt, now) : "กำลังเปิด") : (shortDateTime(bot.stoppedAt) || "ยังไม่เคยเปิด")}</dd></div>
        <div><dt>ภาษา</dt><dd>{runtimeLabel[bot.runtime]}</dd></div>
        <div><dt>หน่วยความจำ</dt><dd>{bot.resources.memoryMb} MB</dd></div>
        <div><dt>CPU</dt><dd>{(bot.resources.cpuMillicores / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 })} คอร์</dd></div>
        <div><dt>ดิสก์</dt><dd>{bot.resources.diskUsedMb != null ? `${bot.resources.diskUsedMb} / ` : ""}{bot.resources.diskLimitMb} MB</dd></div>
        <div><dt>รีสตาร์ตเอง</dt><dd>{bot.restartCount} ครั้ง{bot.lastExitCode != null ? ` · รหัสล่าสุด ${bot.lastExitCode}` : ""}</dd></div>
      </dl>

      <div className="bt-tabs" role="tablist" aria-label="ส่วนของบอท">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" id={`bt-tab-${id}`} aria-selected={tab === id} aria-controls={`bt-panel-${id}`} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      <div key={tab} className="bt-panel" role="tabpanel" id={`bt-panel-${tab}`} aria-labelledby={`bt-tab-${tab}`}>
        {tab === "console" && <BotConsole lines={lines} bot={bot} onClear={() => setLines([])} />}
        {tab === "files" && <BotFiles bot={bot} onChanged={refresh} notify={notify} ask={ask} />}
        {tab === "env" && <BotEnvironment bot={bot} onChanged={refresh} notify={notify} ask={ask} onRestart={() => void operate("restart")} />}
        {tab === "settings" && <BotSettings bot={bot} onChanged={refresh} onDeleted={onBack} notify={notify} ask={ask} />}
      </div>
    </div>
  );
}
