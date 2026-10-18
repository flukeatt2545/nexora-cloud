"use client";

// /bots: the user's Discord bots. The list and one bot's page share this view; the open bot is
// kept in ?id= so the back button and a shared link both work.
import { ArrowRight, Check, FileArchive, GitBranch, KeyRound, MemoryStick, Play, Plus, Power, RefreshCw, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Ask } from "./types";
import { BotAvatar, StatusPill, botApi, botIsBusy, botIsUp, botSend, errorMessage, runtimeLabel, uptimeText, type Bot } from "./botsShared";
import BotCreateWizard from "./BotCreateWizard";
import BotDetail from "./BotDetail";
import "./bots-view.css";

type Notify = (notice: { kind: "success" | "error"; text: string; title?: string }) => void;
type Quota = { limit: number; used: number };

function idFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("id") || "";
}

export default function BotsView({ notify, ask }: { notify: Notify; ask: Ask }) {
  const [openId, setOpenId] = useState(idFromLocation);

  useEffect(() => {
    const sync = () => setOpenId(idFromLocation());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const open = useCallback((id: string) => {
    const url = id ? `/bots?id=${encodeURIComponent(id)}` : "/bots";
    window.history.pushState(null, "", url);
    setOpenId(id);
    window.scrollTo({ top: 0 });
  }, []);

  if (openId) return <BotDetail key={openId} botId={openId} onBack={() => open("")} notify={notify} ask={ask} />;
  return <BotList onOpen={open} notify={notify} />;
}

function BotList({ onOpen, notify }: { onOpen: (id: string) => void; notify: Notify }) {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [quota, setQuota] = useState<Quota>({ limit: 2, used: 0 });
  const [failed, setFailed] = useState("");
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await botApi<{ items: Bot[]; quota: Quota }>("/api/bots");
      setBots(data.items);
      setQuota(data.quota);
      setFailed("");
    } catch (error) {
      setFailed(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  // Refresh quickly while something is starting or stopping, slowly otherwise.
  const anyBusy = Boolean(bots?.some(botIsBusy));
  useEffect(() => {
    busyRef.current = anyBusy;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (!document.hidden) void load();
    }, anyBusy ? 2500 : 20000);
    return () => window.clearInterval(timer);
  }, [anyBusy, load]);

  async function toggle(bot: Bot) {
    const action = botIsUp(bot) ? "stop" : "start";
    setBots((items) => items?.map((item) => item.id === bot.id ? { ...item, pending: { kind: `bot.${action}`, state: "queued", phase: "pending" } } : item) ?? null);
    try {
      await botApi(`/api/bots/${encodeURIComponent(bot.id)}/operations`, botSend("POST", { action }));
      void load();
    } catch (error) {
      notify({ kind: "error", text: errorMessage(error) });
      void load();
    }
  }

  const full = quota.used >= quota.limit;

  return (
    <div className="bt">
      <header className="bt-head">
        <div className="bt-head-copy">
          <h1>บอท Discord</h1>
          <p>เอาบอทที่เขียนไว้มาเปิดทิ้งไว้บนเซิร์ฟเวอร์ของเรา ไม่ต้องเปิดคอมค้างไว้เอง</p>
        </div>
        <div className="bt-head-side">
          <div className="bt-quota" title={`สร้างได้ ${quota.limit} ตัว`}>
            <span>ใช้ไป {quota.used} จาก {quota.limit} ตัว</span>
            <span className="bt-quota-bar" aria-hidden="true">
              {Array.from({ length: Math.max(quota.limit, 1) }, (_, index) => <i key={index} className={index < quota.used ? "is-used" : ""} />)}
            </span>
          </div>
          <button type="button" className="bt-btn bt-btn-primary" onClick={() => setCreating(true)} disabled={full || bots === null} title={full ? "ครบโควตาแล้ว ลบบอทที่ไม่ใช้ก่อน" : undefined}>
            <Plus size={17} aria-hidden="true" />เพิ่มบอท
          </button>
        </div>
      </header>

      {failed && bots === null && (
        <div className="bt-callout is-bad" role="alert">
          <span>{failed}</span>
          <button type="button" className="bt-btn" onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />ลองอีกครั้ง</button>
        </div>
      )}

      {bots === null && !failed && (
        <div className="bt-grid" aria-busy="true" aria-label="กำลังโหลด">
          {[0, 1].map((index) => <div key={index} className="bt-card is-skeleton"><span /><span /><span /></div>)}
        </div>
      )}

      {bots && bots.length === 0 && <EmptyState onCreate={() => setCreating(true)} disabled={full} />}

      {bots && bots.length > 0 && (
        <ul className="bt-grid" aria-label="บอทของฉัน">
          {bots.map((bot, index) => (
            <li key={bot.id} className="bt-card" style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
              <button type="button" className="bt-card-main" onClick={() => onOpen(bot.id)} aria-label={`เปิดหน้าบอท ${bot.name}`}>
                <BotAvatar bot={bot} size={48} />
                <span className="bt-card-name">
                  <strong>{bot.name}</strong>
                  <small>{bot.discord.username ? `@${bot.discord.username}` : "ยังไม่ได้ใส่โทเคน"}</small>
                </span>
                <ArrowRight className="bt-card-go" size={18} aria-hidden="true" />
              </button>
              <div className="bt-card-status">
                <StatusPill bot={bot} />
                {bot.status === "running" && !bot.pending && <span className="bt-muted">ออนไลน์มา {uptimeText(bot.startedAt, now)}</span>}
              </div>
              <dl className="bt-card-facts">
                <div><dt>ภาษา</dt><dd>{runtimeLabel[bot.runtime]}</dd></div>
                <div><dt>หน่วยความจำ</dt><dd>{bot.resources.memoryMb} MB</dd></div>
                <div><dt>รีสตาร์ตเอง</dt><dd>{bot.restartCount} ครั้ง</dd></div>
              </dl>
              <div className="bt-card-foot">
                {!bot.source.hasCode ? (
                  <button type="button" className="bt-btn" onClick={() => onOpen(bot.id)}><FileArchive size={15} aria-hidden="true" />ใส่โค้ด</button>
                ) : (
                  <button type="button" className={`bt-btn ${botIsUp(bot) ? "" : "bt-btn-primary"}`} onClick={() => void toggle(bot)} disabled={Boolean(bot.pending)}>
                    {bot.pending ? <span className="bt-spinner" aria-hidden="true" /> : botIsUp(bot) ? <Power size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                    {botIsUp(bot) ? "ปิดบอท" : "เปิดบอท"}
                  </button>
                )}
                {bot.discord.tokenState !== "valid" && bot.source.hasCode && (
                  <button type="button" className="bt-link" onClick={() => onOpen(bot.id)}><KeyRound size={14} aria-hidden="true" />ใส่โทเคน</button>
                )}
              </div>
            </li>
          ))}
          {!full && (
            <li className="bt-card bt-card-add" style={{ animationDelay: `${Math.min(bots.length, 8) * 60}ms` }}>
              <button type="button" onClick={() => setCreating(true)}>
                <Plus size={22} aria-hidden="true" />
                <span>เพิ่มบอทอีกตัว</span>
                <small>เหลืออีก {quota.limit - quota.used} ตัว</small>
              </button>
            </li>
          )}
        </ul>
      )}

      {creating && (
        <BotCreateWizard
          onClose={() => setCreating(false)}
          onCreated={(bot) => { setCreating(false); onOpen(bot.id); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <section className="bt-empty">
      <svg className="bt-empty-art" viewBox="0 0 160 120" aria-hidden="true">
        <line className="bt-art-antenna" x1="80" y1="18" x2="80" y2="34" />
        <circle className="bt-art-light" cx="80" cy="14" r="5" />
        <rect className="bt-art-head" x="42" y="34" width="76" height="54" rx="14" />
        <circle className="bt-art-eye" cx="64" cy="60" r="6" />
        <circle className="bt-art-eye" cx="96" cy="60" r="6" />
        <path className="bt-art-mouth" d="M68 75 q12 7 24 0" />
        <rect className="bt-art-ear" x="32" y="52" width="10" height="18" rx="4" />
        <rect className="bt-art-ear" x="118" y="52" width="10" height="18" rx="4" />
        <line className="bt-art-floor" x1="24" y1="106" x2="136" y2="106" />
      </svg>
      <h2>ยังไม่มีบอท</h2>
      <p>อัปโหลดโค้ดบอทที่เขียนไว้ หรือเริ่มจากบอทตัวอย่างที่ตอบคำสั่ง /ping ได้ทันที</p>
      <button type="button" className="bt-btn bt-btn-primary" onClick={onCreate} disabled={disabled}><Plus size={17} aria-hidden="true" />เพิ่มบอทตัวแรก</button>
      <ol className="bt-steps">
        <li><span className="bt-step-icon"><FileArchive size={18} aria-hidden="true" /></span><b>เอาโค้ดขึ้นมา</b><small>ไฟล์ ZIP, ลิงก์ GitHub หรือบอทตัวอย่าง</small></li>
        <li><span className="bt-step-icon"><KeyRound size={18} aria-hidden="true" /></span><b>ใส่โทเคนบอท</b><small>เก็บเข้ารหัสไว้ ไม่มีใครเห็นค่า</small></li>
        <li><span className="bt-step-icon"><Power size={18} aria-hidden="true" /></span><b>กดเปิด</b><small>ล่มเมื่อไหร่ ระบบเปิดให้ใหม่เอง</small></li>
      </ol>
      <ul className="bt-specs" aria-label="สเปกที่ได้">
        <li><MemoryStick size={15} aria-hidden="true" />RAM 256 MB ต่อบอท</li>
        <li><SquareTerminal size={15} aria-hidden="true" />Node.js 22 และ Python 3.12</li>
        <li><GitBranch size={15} aria-hidden="true" />ดึงโค้ดจาก GitHub ได้</li>
        <li><Check size={15} aria-hidden="true" />ไม่มีค่าใช้จ่าย</li>
      </ul>
    </section>
  );
}
