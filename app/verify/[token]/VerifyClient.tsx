"use client";

import { CircleAlert, ExternalLink, LoaderCircle } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../runtime";
import "../verify.css";

// The page a member opens from the verify button in Discord. The API decides what is checked
// (backend/discord_verify.go); this page only shows the steps and talks to it. The look follows
// the welcome card the bot draws (black and red, cut corners, a ring around the picture).

type Info = {
  guildName: string;
  username: string;
  identified: boolean;
  avatarUrl: string;
  captcha: boolean;
  siteKey: string;
  ready: boolean;
  minAgeDays: number;
  needAvatar: boolean;
};

type View = "loading" | "expired" | "off" | "login" | "check" | "done" | "blocked" | "error";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstileLoading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  turnstileLoading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      turnstileLoading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return turnstileLoading;
}

/** The Cloudflare Turnstile box. onToken gets "" again when the answer expires. */
function Captcha({ siteKey, onToken, onFail }: { siteKey: string; onToken: (token: string) => void; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let widget = "";
    let gone = false;
    loadTurnstile()
      .then((turnstile) => {
        if (gone || !box.current) return;
        widget = turnstile.render(box.current, {
          sitekey: siteKey,
          theme: "dark",
          size: window.innerWidth < 390 ? "compact" : "normal",
          language: "th",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(""),
          "error-callback": () => {
            onToken("");
            onFail();
          },
        });
      })
      .catch(onFail);
    return () => {
      gone = true;
      if (widget) window.turnstile?.remove(widget);
    };
  }, [siteKey, onToken, onFail]);
  return <div className="vf-captcha-box" ref={box} />;
}

const WRONG_ACCOUNT = "คุณเข้าสู่ระบบด้วยบัญชี Discord อื่น ต้องใช้บัญชีเดียวกับที่กดปุ่มยืนยันตัวตนในเซิร์ฟ";
const OAUTH_FAILED = "เชื่อมต่อ Discord ไม่สำเร็จ ลองอีกครั้ง";

// Only a picture from Discord's own CDN is shown.
const safeAvatar = (url: string) => (url.startsWith("https://cdn.discordapp.com/") ? url : "");

const step = (index: number) => ({ "--i": index }) as CSSProperties;

function Check() {
  return (
    <svg className="vf-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
  );
}

function Shield() {
  return (
    <svg className="vf-shield" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7.5 2.8v5.6c0 4.6-3 8.1-7.5 9.6-4.5-1.5-7.5-5-7.5-9.6V5.8L12 3z" />
      <path className="vf-shield-tick" d="M8.8 12.3l2.2 2.2 4.2-4.4" />
    </svg>
  );
}

export default function VerifyClient({ token }: { token: string }) {
  const started = useRef(false);
  const [view, setView] = useState<View>("loading");
  const [info, setInfo] = useState<Info | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [captchaBroken, setCaptchaBroken] = useState(false);
  // Changing it builds a new captcha box (a Turnstile answer works only once).
  const [captchaRound, setCaptchaRound] = useState(0);
  const [returnUrl, setReturnUrl] = useState("");
  // Changes every time a message appears, so the box shakes again for the same text.
  const [shake, setShake] = useState(0);

  const base = `${API_BASE}/api/public/community-verify/${encodeURIComponent(token)}`;

  const show = useCallback((next: Info) => {
    setInfo(next);
    setView(next.identified ? "check" : "login");
  }, []);

  const warn = useCallback((text: string) => {
    setMessage(text);
    setShake((count) => count + 1);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const problem = new URLSearchParams(window.location.search).get("e");
    if (problem) window.history.replaceState(null, "", window.location.pathname);
    fetch(base, { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json().catch(() => ({})) }))
      .then(({ response, payload }) => {
        if (response.ok) {
          show(payload as Info);
          if (problem) warn(problem === "wrong_account" ? WRONG_ACCOUNT : OAUTH_FAILED);
        } else if (payload.code === "verify_off") {
          setMessage(payload.error);
          setView("off");
        } else if (response.status === 404) {
          setView("expired");
        } else {
          setView("error");
        }
      })
      .catch(() => setView("error"));
  }, [base, show, warn]);

  async function signIn() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${base}/discord`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && typeof payload.redirectUrl === "string") {
        window.location.assign(payload.redirectUrl);
        return;
      }
      if (response.status === 404) setView("expired");
      else warn(payload.error || OAUTH_FAILED);
    } catch {
      warn(OAUTH_FAILED);
    }
    setBusy(false);
  }

  async function finish() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${base}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captcha: answer }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        setReturnUrl(typeof payload.returnUrl === "string" ? payload.returnUrl : "https://discord.com/app");
        setView("done");
        return;
      }
      switch (payload.code) {
        case "verify_expired":
        case "verify_locked":
          setMessage(payload.error);
          setView("expired");
          break;
        case "account_too_new":
          setMessage(payload.error);
          setView("blocked");
          break;
        case "no_avatar":
          // They can set a picture in Discord and sign in again.
          warn(payload.error);
          setInfo((current) => (current ? { ...current, identified: false } : current));
          setView("login");
          break;
        case "captcha_failed":
        case "captcha_unavailable":
          warn(payload.error);
          setAnswer("");
          setCaptchaRound((round) => round + 1);
          break;
        case "verify_login_needed":
          setView("login");
          break;
        default:
          warn(payload.error || "ยืนยันไม่สำเร็จ ลองอีกครั้ง");
      }
    } catch {
      warn("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้ง");
    }
    setBusy(false);
  }

  const captchaFail = useCallback(() => setCaptchaBroken(true), []);
  const needsCaptcha = Boolean(info?.captcha && info.siteKey);
  const canFinish = !busy && (!needsCaptcha || Boolean(answer));
  const server = info?.guildName || "เซิร์ฟเวอร์ Discord";
  const avatar = info ? safeAvatar(info.avatarUrl) : "";
  const asking = view === "login" || view === "check";
  const failed = view === "expired" || view === "blocked" || view === "off" || view === "error";

  // The two lines of text at the top, like "ยินดีต้อนรับ / name" on the welcome card.
  const kicker = asking ? "ยืนยันตัวตนเพื่อเข้า" : view === "done" ? "ยืนยันตัวตน" : view === "loading" ? "กำลังเตรียม" : "ขออภัย";
  const title = asking ? server
    : view === "done" ? "สำเร็จ"
    : view === "loading" ? "รอสักครู่"
    : view === "expired" ? "ลิงก์หมดอายุ"
    : view === "blocked" ? "ยังไม่ผ่าน"
    : view === "off" ? "ปิดอยู่"
    : "ไม่สำเร็จ";

  // What is checked, in order. Numbered steps are the ones the member does; the rest happen by themselves.
  const steps: { key: string; title: string; text: string; state: "done" | "now" | "todo"; auto?: boolean }[] = [];
  if (info) {
    steps.push({ key: "login", title: "เข้าสู่ระบบด้วย Discord", text: "ยืนยันว่าเป็นบัญชีของคุณจริง ๆ", state: info.identified ? "done" : "now" });
    if (needsCaptcha) steps.push({ key: "captcha", title: "ยืนยันว่าเป็นคน", text: "ติ๊กช่องด้านล่างให้ผ่าน", state: info.identified ? "now" : "todo" });
    if (info.minAgeDays > 0) steps.push({ key: "age", title: `บัญชีอายุอย่างน้อย ${info.minAgeDays} วัน`, text: "ระบบตรวจให้เอง", state: "todo", auto: true });
    if (info.needAvatar) steps.push({ key: "avatar", title: "มีรูปโปรไฟล์ Discord", text: "ระบบตรวจให้เอง", state: "todo", auto: true });
  }
  let number = 0;

  return (
    <main className="vf" data-view={view}>
      <div className="vf-bg" aria-hidden="true">
        <i className="vf-glow" />
        <i className="vf-lines" />
        <span className="vf-mark">NEXORA</span>
      </div>

      <div className="vf-frame">
        <section className="vf-panel" aria-live="polite" aria-busy={view === "loading"}>
          <header className="vf-top vf-in" style={step(0)}>
            <i className="vf-diamond" aria-hidden="true" />
            <b>NEXORA CLOUD</b>
            <span>DISCORD VERIFY</span>
          </header>

          <div className="vf-body">
            <div className="vf-copy">
              <p className="vf-kicker vf-in" style={step(1)}>{kicker}</p>
              <h1 className={`vf-title${title.length > 12 ? " is-long" : ""}`} key={`${view}-${title}`}><span>{title}</span></h1>
              <i className="vf-bar vf-in" style={step(3)} aria-hidden="true" />
              {asking && info && (
                <dl className="vf-facts vf-in" style={step(4)}>
                  <div><dt>บัญชี</dt><dd>{info.username || "-"}</dd></div>
                  <div><dt>ขั้นตอน</dt><dd>{info.identified ? (needsCaptcha ? "2" : "1") : "1"}<em>/{needsCaptcha ? 2 : 1}</em></dd></div>
                </dl>
              )}
              {view === "done" && <p className="vf-lead vf-in" style={step(4)}>ยศสมาชิกจะขึ้นภายในไม่กี่วินาที กลับไปที่ Discord แล้วเข้าห้องต่าง ๆ ได้เลย</p>}
              {failed && (
                <p className="vf-lead vf-in" style={step(4)}>
                  {message || (view === "expired"
                    ? "เพื่อความปลอดภัย ลิงก์ใช้ได้ครั้งเดียวและมีเวลา 10 นาที กลับไปกดปุ่มยืนยันตัวตนใน Discord เพื่อขอลิงก์ใหม่"
                    : "ลองใหม่อีกครั้ง หรือบอกทีมงานในเซิร์ฟ")}
                </p>
              )}
            </div>

            <div className={`vf-badge vf-in${view === "done" ? " is-done" : ""}${failed ? " is-failed" : ""}${view === "loading" ? " is-loading" : ""}`} style={step(2)} aria-hidden="true">
              <i className="vf-ring vf-ring-dash" />
              <i className="vf-ring vf-ring-arc" />
              <i className="vf-dot vf-dot-n" /><i className="vf-dot vf-dot-e" /><i className="vf-dot vf-dot-s" />
              <div className="vf-core">
                {view === "done" ? <Check />
                  : failed ? <span className="vf-bang">!</span>
                  : view === "loading" ? <LoaderCircle className="vf-spin" />
                  : avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                  : <Shield />}
              </div>
              {view === "done" && <span className="vf-burst">{Array.from({ length: 14 }, (_, index) => <i key={index} style={{ "--r": `${index * (360 / 14)}deg`, "--d": `${(index % 4) * 40}ms` } as CSSProperties} />)}</span>}
            </div>
          </div>

          {asking && info && (
            <div className="vf-flow">
              <ol className="vf-steps">
                {steps.map((item, index) => {
                  if (!item.auto) number += 1;
                  return (
                    <li key={item.key} data-state={item.state} className="vf-in" style={step(5 + index)}>
                      <span className="vf-node">{item.state === "done" ? <Check /> : item.auto ? <i /> : number}</span>
                      <div><b>{item.title}</b><small>{item.text}</small></div>
                      {item.auto && <em>อัตโนมัติ</em>}
                    </li>
                  );
                })}
              </ol>

              {message && <p className="vf-alert" role="alert" key={shake}><CircleAlert size={16} aria-hidden="true" />{message}</p>}
              {!info.ready && <p className="vf-alert" role="alert"><CircleAlert size={16} aria-hidden="true" />ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ ลองบอกทีมงานดูนะ</p>}

              {view === "login" ? (
                <button type="button" className="vf-btn vf-in" style={step(9)} onClick={() => void signIn()} disabled={busy || !info.ready}>
                  {busy ? <LoaderCircle size={20} className="vf-spin" /> : <img src="/brands/discord-symbol.svg" alt="" />}
                  <span>เข้าสู่ระบบด้วย Discord</span>
                </button>
              ) : (
                <>
                  {needsCaptcha && (
                    <div className={`vf-captcha vf-in${answer ? " is-ok" : ""}`} style={step(9)}>
                      <Captcha key={captchaRound} siteKey={info.siteKey} onToken={setAnswer} onFail={captchaFail} />
                      {answer && <p className="vf-captcha-ok"><Check />ผ่านการตรวจแล้ว คุณเป็นคนจริง ๆ</p>}
                    </div>
                  )}
                  {captchaBroken && <p className="vf-alert" role="alert"><CircleAlert size={16} aria-hidden="true" />โหลดกล่องยืนยันไม่ได้ ปิดตัวบล็อกโฆษณาหรือรีเฟรชหน้านี้</p>}
                  <button type="button" className="vf-btn vf-in" style={step(10)} onClick={() => void finish()} disabled={!canFinish || !info.ready}>
                    {busy ? <LoaderCircle size={20} className="vf-spin" /> : null}
                    <span>ยืนยันตัวตน</span>
                  </button>
                </>
              )}
              <p className="vf-note vf-in" style={step(11)}>เราอ่านแค่ชื่อและรหัสบัญชี Discord ของคุณ ไม่ขออีเมล และไม่เห็นเซิร์ฟเวอร์อื่นของคุณ</p>
            </div>
          )}

          {view === "done" && (
            <div className="vf-flow is-single">
              <a className="vf-btn vf-in" style={step(5)} href={returnUrl}><span>กลับไปที่ Discord</span><ExternalLink size={18} aria-hidden="true" /></a>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
