"use client";

import { CircleAlert, CircleCheck, ExternalLink, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../runtime";
import "../../c/oauth-ticket.css";
import "../verify.css";

// The page a member opens from the verify button in Discord. The API decides what is checked
// (backend/discord_verify.go); this page only shows the steps and talks to it.

type Info = {
  guildName: string;
  username: string;
  identified: boolean;
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
          theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
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
  return <div className="verify-captcha" ref={box} />;
}

const WRONG_ACCOUNT = "คุณเข้าสู่ระบบด้วยบัญชี Discord อื่น ต้องใช้บัญชีเดียวกับที่กดปุ่มยืนยันตัวตนในเซิร์ฟ";
const OAUTH_FAILED = "เชื่อมต่อ Discord ไม่สำเร็จ ลองอีกครั้ง";

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

  const base = `${API_BASE}/api/public/community-verify/${encodeURIComponent(token)}`;

  const show = useCallback((next: Info) => {
    setInfo(next);
    setView(next.identified ? "check" : "login");
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
          if (problem === "wrong_account") setMessage(WRONG_ACCOUNT);
          else if (problem) setMessage(OAUTH_FAILED);
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
  }, [base, show]);

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
      else setMessage(payload.error || OAUTH_FAILED);
    } catch {
      setMessage(OAUTH_FAILED);
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
          setMessage(payload.error);
          setInfo((current) => (current ? { ...current, identified: false } : current));
          setView("login");
          break;
        case "captcha_failed":
        case "captcha_unavailable":
          setMessage(payload.error);
          setAnswer("");
          setCaptchaRound((round) => round + 1);
          break;
        case "verify_login_needed":
          setView("login");
          break;
        default:
          setMessage(payload.error || "ยืนยันไม่สำเร็จ ลองอีกครั้ง");
      }
    } catch {
      setMessage("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้ง");
    }
    setBusy(false);
  }

  const captchaFail = useCallback(() => setCaptchaBroken(true), []);
  const needsCaptcha = Boolean(info?.captcha && info.siteKey);
  const canFinish = !busy && (!needsCaptcha || Boolean(answer));
  const server = info?.guildName || "เซิร์ฟเวอร์ Discord";

  return (
    <main className="social-status-page">
      <section className="social-status-card verify-card" aria-live="polite">
        <header className="social-status-brand">
          <img src="/logo-v2.png?v=3" alt="" aria-hidden="true" />
          <div><strong>NEXORA CLOUD</strong><span>DISCORD VERIFY</span></div>
        </header>

        {view === "loading" && (
          <>
            <div className="social-provider-mark social-ticket-loading" aria-hidden="true"><LoaderCircle /></div>
            <div className="social-status-copy"><h1>กำลังเตรียมหน้ายืนยัน</h1><p>โปรดรอสักครู่</p></div>
          </>
        )}

        {(view === "login" || view === "check") && info && (
          <>
            <div className="social-provider-mark verify-mark" aria-hidden="true"><ShieldCheck /></div>
            <div className="social-status-copy">
              <h1>ยืนยันตัวตนเพื่อเข้า {server}</h1>
              <p>{info.username ? <>สวัสดี <b>{info.username}</b> </> : null}ทำตามขั้นตอนด้านล่างให้ครบ แล้วกลับไปที่ Discord ได้เลย</p>
            </div>

            <ol className="verify-steps">
              <li className={info.identified ? "is-done" : "is-now"}>
                <span aria-hidden="true">{info.identified ? <CircleCheck size={18} /> : "1"}</span>
                <div><b>เข้าสู่ระบบด้วย Discord</b><small>เพื่อให้แน่ใจว่าเป็นบัญชีของคุณจริง ๆ</small></div>
              </li>
              {needsCaptcha && (
                <li className={info.identified ? "is-now" : ""}>
                  <span aria-hidden="true">2</span>
                  <div><b>ยืนยันว่าเป็นคน</b><small>ติ๊กช่องด้านล่างให้ผ่าน</small></div>
                </li>
              )}
              {info.minAgeDays > 0 && (
                <li><span aria-hidden="true"><LockKeyhole size={16} /></span><div><b>บัญชี Discord อายุอย่างน้อย {info.minAgeDays} วัน</b><small>ระบบตรวจให้เอง</small></div></li>
              )}
              {info.needAvatar && (
                <li><span aria-hidden="true"><LockKeyhole size={16} /></span><div><b>ต้องมีรูปโปรไฟล์ Discord</b><small>ระบบตรวจให้เอง</small></div></li>
              )}
            </ol>

            {message && <p className="verify-message" role="alert"><CircleAlert size={16} aria-hidden="true" />{message}</p>}
            {!info.ready && <p className="verify-message" role="alert"><CircleAlert size={16} aria-hidden="true" />ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ ลองบอกทีมงานดูนะ</p>}

            {view === "login" ? (
              <div className="social-status-actions social-status-actions-single">
                <button type="button" className="social-status-primary" onClick={() => void signIn()} disabled={busy || !info.ready}>
                  {busy ? <LoaderCircle size={18} className="verify-spin" /> : <img className="verify-discord" src="/brands/discord-symbol.svg" alt="" />}
                  เข้าสู่ระบบด้วย Discord
                </button>
              </div>
            ) : (
              <>
                {needsCaptcha && (
                  <>
                    <Captcha key={captchaRound} siteKey={info.siteKey} onToken={setAnswer} onFail={captchaFail} />
                    {captchaBroken && <p className="verify-message" role="alert"><CircleAlert size={16} aria-hidden="true" />โหลดกล่องยืนยันไม่ได้ ปิดตัวบล็อกโฆษณาหรือรีเฟรชหน้านี้</p>}
                  </>
                )}
                <div className="social-status-actions social-status-actions-single">
                  <button type="button" className="social-status-primary" onClick={() => void finish()} disabled={!canFinish || !info.ready}>
                    {busy ? <LoaderCircle size={18} className="verify-spin" /> : <ShieldCheck size={18} />}
                    ยืนยันตัวตน
                  </button>
                </div>
              </>
            )}
            <p className="social-status-help">เราอ่านแค่ชื่อและรหัสบัญชี Discord ของคุณ ไม่ขออีเมล และไม่เห็นเซิร์ฟเวอร์อื่นของคุณ</p>
          </>
        )}

        {view === "done" && (
          <>
            <div className="social-provider-mark verify-mark verify-ok" aria-hidden="true"><CircleCheck /></div>
            <div className="social-status-copy">
              <h1>ยืนยันตัวตนสำเร็จ</h1>
              <p>ยศสมาชิกจะขึ้นภายในไม่กี่วินาที กลับไปที่ Discord แล้วเข้าห้องต่าง ๆ ได้เลย</p>
            </div>
            <div className="social-status-actions social-status-actions-single">
              <a className="social-status-primary" href={returnUrl}><ExternalLink size={18} />กลับไปที่ Discord</a>
            </div>
          </>
        )}

        {(view === "expired" || view === "blocked" || view === "off" || view === "error") && (
          <>
            <div className="social-provider-mark social-ticket-error" aria-hidden="true"><span>!</span></div>
            <div className="social-status-copy">
              <h1>{view === "expired" ? "ลิงก์นี้หมดอายุแล้ว" : view === "blocked" ? "ยืนยันตัวตนไม่ผ่าน" : view === "off" ? "ยืนยันผ่านเว็บไม่ได้ตอนนี้" : "ยังดำเนินการต่อไม่ได้"}</h1>
              <p>
                {message || (view === "expired"
                  ? "เพื่อความปลอดภัย ลิงก์ใช้ได้ครั้งเดียวและมีเวลา 10 นาที กลับไปกดปุ่มยืนยันตัวตนใน Discord เพื่อขอลิงก์ใหม่"
                  : "ลองใหม่อีกครั้ง หรือบอกทีมงานในเซิร์ฟ")}
              </p>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
