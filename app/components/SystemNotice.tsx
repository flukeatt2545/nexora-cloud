"use client";

import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./system-notice.css";

// The site's notice: a card in the middle of the screen that wipes in with a glitch (the colour
// split of the verify page), instead of a toast at the top. Success and info notices leave by
// themselves after a countdown that pauses while the pointer is on them; errors, and notices
// marked persistent, dim the page and wait for the button.

export type SystemNoticeKind = "success" | "error" | "info";
export type SystemNoticeData = { kind: SystemNoticeKind; text: string; title?: string; persistent?: boolean };

const HOLD_MS: Record<SystemNoticeKind, number> = { success: 2600, info: 3600, error: 0 };
const TITLE: Record<SystemNoticeKind, string> = { success: "สำเร็จ", error: "ไม่สำเร็จ", info: "แจ้งเตือน" };
const CODE: Record<SystemNoticeKind, string> = { success: "SYSTEM · OK", error: "SYSTEM · ERROR", info: "SYSTEM · NOTICE" };
const ICON = { success: CircleCheck, error: TriangleAlert, info: Info };
// How long the leaving wipe takes (system-notice.css, sn-wipe-out).
const LEAVE_MS = 180;

export default function SystemNotice({ notice, onClose }: { notice: SystemNoticeData; onClose: () => void }) {
  // Every new notice, even with the same text, plays the entrance again: it gets a new round.
  const [state, setState] = useState({ notice, round: 0, leaving: false });
  if (state.notice !== notice) setState({ notice, round: state.round + 1, leaving: false });
  const leave = useCallback(() => setState((current) => (current.leaving ? current : { ...current, leaving: true })), []);

  const waits = notice.kind === "error" || Boolean(notice.persistent);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!state.leaving) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onClose, reduced ? 0 : LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [state.leaving, state.round, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The notice is on top: Escape closes it and not the dialog under it as well.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); leave(); }
      // A waiting notice is a dialog with one button: keep the focus on it.
      if (event.key === "Tab" && waits) { event.preventDefault(); button.current?.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leave, waits]);

  // A waiting notice takes the focus, and gives it back when it goes.
  useEffect(() => {
    if (!waits) return;
    const before = document.activeElement as HTMLElement | null;
    button.current?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  }, [waits, state.round]);

  if (typeof document === "undefined") return null;
  const Icon = ICON[notice.kind];
  const hold = waits ? 0 : HOLD_MS[notice.kind];

  return createPortal(
    <div
      className={`sn-overlay sn-${notice.kind}${waits ? " is-waiting" : ""}${state.leaving ? " is-leaving" : ""}`}
      onMouseDown={(event) => { if (waits && event.target === event.currentTarget) leave(); }}
    >
      <section
        key={state.round}
        className="sn-card"
        role={waits ? "alertdialog" : "status"}
        aria-modal={waits || undefined}
        aria-live={waits ? undefined : "polite"}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        onClick={waits ? undefined : leave}
        style={hold ? ({ "--sn-hold": `${hold}ms` } as CSSProperties) : undefined}
      >
        <div className="sn-art" aria-hidden="true">
          <span className="sn-layer sn-ghost is-r"><Icon /></span>
          <span className="sn-layer sn-ghost is-b"><Icon /></span>
          <span className="sn-layer sn-base"><Icon /></span>
        </div>
        <div className="sn-body">
          <p className="sn-code">{CODE[notice.kind]}</p>
          <h2 className="sn-title" id={`${id}-title`}>{notice.title || TITLE[notice.kind]}</h2>
          <i className="sn-bar" aria-hidden="true" />
          <p className="sn-text" id={`${id}-text`}>{notice.text}</p>
          <div className="sn-actions">
            <button type="button" ref={button} className="sn-btn" onClick={(event) => { event.stopPropagation(); leave(); }}>ตกลง</button>
          </div>
        </div>
        {hold > 0 && <i className="sn-timer" aria-hidden="true" onAnimationEnd={leave} />}
      </section>
    </div>,
    document.body,
  );
}
