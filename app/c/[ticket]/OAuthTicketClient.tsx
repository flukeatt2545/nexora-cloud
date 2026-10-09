"use client";

import Link from "next/link";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import SocialOAuthButton, { SocialMode, SocialProvider } from "../../SocialOAuthButton";
import { API_BASE } from "../../runtime";
import "../oauth-ticket.css";

const providerDetails: Record<SocialProvider, { name: string; icon: string }> = {
  discord: { name: "Discord", icon: "/brands/discord-symbol.svg" },
  google: { name: "Google", icon: "/brands/google-g.png" },
  github: { name: "GitHub", icon: "/brands/github-mark.png" },
};

type TicketState = "loading" | "unavailable" | "expired" | "unauthenticated" | "error";

export default function OAuthTicketClient({ ticket }: { ticket: string }) {
  const started = useRef(false);
  const [state, setState] = useState<TicketState>("loading");
  const [provider, setProvider] = useState<SocialProvider>("google");
  const [mode, setMode] = useState<SocialMode>("login");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch(`${API_BASE}/api/auth/oauth/ticket/consume`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    })
      .then(async (response) => ({ response, payload: await response.json().catch(() => ({})) }))
      .then(({ response, payload }) => {
        if (response.ok && typeof payload.redirectUrl === "string") {
          window.location.replace(payload.redirectUrl);
          return;
        }
        if (payload.code === "provider_unavailable") {
          if (payload.provider === "discord" || payload.provider === "google" || payload.provider === "github") setProvider(payload.provider);
          if (payload.mode === "connect" || payload.mode === "register") setMode(payload.mode);
          setState("unavailable");
        } else if (payload.code === "ticket_expired" || payload.code === "invalid_ticket") {
          setState("expired");
        } else if (payload.code === "unauthenticated") {
          setState("unauthenticated");
        } else {
          setState("error");
        }
      })
      .catch(() => setState("error"));
  }, [ticket]);

  const detail = providerDetails[provider];
  const backHref = mode === "connect" ? "/profile" : "/";
  const backLabel = mode === "connect" ? "กลับไปหน้าโปรไฟล์" : "กลับไปหน้าหลัก";

  return (
    <main className="social-status-page">
      <section className="social-status-card" aria-live="polite">
        <header className="social-status-brand">
          <img src="/logo-v2.png?v=3" alt="" aria-hidden="true" />
          <div><strong>NEXORA CLOUD</strong><span>SECURE ACCESS</span></div>
        </header>

        {state === "loading" ? (
          <>
            <div className="social-provider-mark social-ticket-loading" aria-hidden="true"><LoaderCircle /></div>
            <div className="social-status-copy">
              <h1>กำลังเตรียมการเชื่อมต่อ</h1>
              <p>โปรดรอสักครู่ ระบบกำลังพาคุณไปยังบริการที่เลือก</p>
            </div>
          </>
        ) : state === "unavailable" ? (
          <>
            <div className={`social-provider-mark social-provider-${provider}`} aria-hidden="true"><img src={detail.icon} alt="" /></div>
            <div className="social-status-copy">
              <h1>เชื่อมต่อ {detail.name} ไม่สำเร็จ</h1>
              <p>ขณะนี้บริการเชื่อมต่อบัญชียังไม่พร้อม<br />กรุณาลองใหม่อีกครั้งในภายหลัง</p>
            </div>
            <div className="social-status-actions">
              <Link className="social-status-secondary" href={backHref}><ArrowLeft size={18} />{backLabel}</Link>
              <SocialOAuthButton className="social-status-primary" provider={provider} mode={mode}><RefreshCw size={18} />ลองอีกครั้ง</SocialOAuthButton>
            </div>
            <p className="social-status-help">ไม่ต้องกังวล บัญชีและข้อมูลของคุณยังปลอดภัย</p>
          </>
        ) : (
          <>
            <div className="social-provider-mark social-ticket-error" aria-hidden="true"><span>!</span></div>
            <div className="social-status-copy">
              <h1>{state === "expired" ? "ลิงก์นี้หมดอายุแล้ว" : state === "unauthenticated" ? "กรุณาเข้าสู่ระบบอีกครั้ง" : "ยังดำเนินการต่อไม่ได้"}</h1>
              <p>{state === "expired" ? "เพื่อความปลอดภัย ลิงก์เชื่อมต่อสามารถใช้ได้เพียงครั้งเดียว" : state === "unauthenticated" ? "เซสชันของคุณอาจหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่" : "กรุณากลับไปยังหน้าก่อนหน้าแล้วลองอีกครั้ง"}</p>
            </div>
            <div className="social-status-actions social-status-actions-single">
              <Link className="social-status-secondary" href="/"><ArrowLeft size={18} />กลับไปหน้าหลัก</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
