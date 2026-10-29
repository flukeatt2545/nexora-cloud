"use client";

import { LockKeyhole, RotateCw, Home } from "lucide-react";
import { type CSSProperties, useEffect } from "react";
import { applyUiShape, UI_SHAPE_KEY } from "../../uiShape";
import { fitLength, Mark } from "../../verify/VerifyMark";
import "../../verify/verify.css";
import "./error-screen.css";

const step = (index: number) => ({ "--i": index }) as CSSProperties;

// The page follows the shape the admin picked (app/uiShape.ts): the usual rounded screen, or in
// square mode the verify page's card (app/verify/verify.css). Both are in the page and
// error-screen.css shows one by html[data-ui], so nothing jumps when the shape is known.
// The links here reload the whole page on purpose: after a crash the app's state is not trusted,
// so client-side navigation (next/link) would carry the broken state along.
/* eslint-disable @next/next/no-html-link-for-pages */
export default function ErrorScreen({ status, reset }: { status: number; reset?: () => void }) {
  const copy = status === 404 ? { title: "ไม่พบหน้านี้", message: "ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว" } : { title: "เว็บมีปัญหา", message: "ลองโหลดหน้าใหม่อีกครั้งในอีกสักครู่" };
  const fitLen = fitLength(copy.title);

  // global-error.tsx draws its own <html> without the script in app/layout.tsx, so set the shape and theme here.
  useEffect(() => {
    const root = document.documentElement;
    try {
      if (!root.dataset.ui && window.localStorage.getItem(UI_SHAPE_KEY) === "square") applyUiShape("square", false);
      const theme = window.localStorage.getItem("nexora-theme");
      if (!root.dataset.theme && (theme === "light" || theme === "dark")) root.dataset.theme = theme;
    } catch {
      // storage blocked: the rounded screen in dark
    }
  }, []);

  return <>
    <div className="nexora-error-screen">
      <header><a className="error-brand" href="/">NEXORA</a></header>
      <main><section><div className="error-status-wrap"><div className="error-status" aria-label={`ข้อผิดพลาด ${status}`}>{status}</div><LockKeyhole className="error-lock" size={38} aria-hidden="true" /></div><h1>{copy.title}</h1><p>{copy.message}</p></section>
        <nav aria-label="ตัวเลือกเมื่อพบปัญหา">{reset && <button type="button" onClick={reset}><RotateCw size={18} aria-hidden="true" />ลองใหม่</button>}<a href="/"><Home size={18} aria-hidden="true" />กลับหน้าแรก</a></nav>
      </main></div>

    <main className="vf nexora-error-square" data-view="error">
      <div className="vf-bg" aria-hidden="true">
        <i className="vf-glow" />
        <i className="vf-lines" />
        <Mark />
        <i className="vf-wslice" style={{ "--y": "9%", "--h": "3%" } as CSSProperties} />
        <i className="vf-wslice is-b" style={{ "--y": "27%", "--h": "6%" } as CSSProperties} />
        <i className="vf-wslice" style={{ "--y": "52%", "--h": "2%" } as CSSProperties} />
        <i className="vf-wslice is-b" style={{ "--y": "71%", "--h": "7%" } as CSSProperties} />
        <i className="vf-wslice" style={{ "--y": "90%", "--h": "4%" } as CSSProperties} />
      </div>
      <i className="vf-crt" aria-hidden="true" />

      <div className="vf-frame">
        <section className="vf-panel">
          <header className="vf-top vf-in" style={step(0)}>
            <i className="vf-diamond" aria-hidden="true" />
            <b>NEXORA CLOUD</b>
            <span>ERROR {status}</span>
          </header>

          <span className="vf-slice" style={{ "--y": "14%", "--h": "5%" } as CSSProperties} aria-hidden="true" />
          <span className="vf-slice is-b" style={{ "--y": "38%", "--h": "9%" } as CSSProperties} aria-hidden="true" />
          <span className="vf-slice" style={{ "--y": "61%", "--h": "4%" } as CSSProperties} aria-hidden="true" />
          <span className="vf-slice is-b" style={{ "--y": "83%", "--h": "7%" } as CSSProperties} aria-hidden="true" />

          <div className="vf-body">
            <div className="vf-copy">
              <h1 className={`vf-title${copy.title.length > 12 ? " is-long" : ""}${fitLen ? " is-fit" : ""}`} style={fitLen ? ({ "--vf-n": fitLen } as CSSProperties) : undefined} data-text={copy.title}><span>{copy.title}</span></h1>
              <i className="vf-bar vf-in" style={step(3)} aria-hidden="true" />
              <p className="vf-lead vf-in" style={step(4)}>{copy.message}</p>
            </div>

            <div className="vf-badge vf-in is-failed" style={step(2)} aria-label={`ข้อผิดพลาด ${status}`} role="img">
              <div className="vf-fx">
                <i className="vf-ring vf-ring-dash" />
                <i className="vf-ring vf-ring-arc" />
                <i className="vf-dot vf-dot-n" /><i className="vf-dot vf-dot-e" /><i className="vf-dot vf-dot-s" />
                <div className="vf-core"><span className="vf-bang vf-code">{status}</span></div>
              </div>
            </div>
          </div>

          <nav className="vf-actions vf-in" style={step(5)} aria-label="ตัวเลือกเมื่อพบปัญหา">
            {reset && <button type="button" className="vf-btn" onClick={reset}><RotateCw size={18} aria-hidden="true" /><span>ลองใหม่</span></button>}
            <a className={`vf-btn${reset ? " is-ghost" : ""}`} href="/"><Home size={18} aria-hidden="true" /><span>กลับหน้าแรก</span></a>
          </nav>
        </section>
      </div>
    </main>
  </>;
}
