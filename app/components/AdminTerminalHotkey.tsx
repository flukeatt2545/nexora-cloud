"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const AdminTerminal = dynamic(() => import("./AdminTerminal"), { ssr: false });

// Ways to open the emergency sign-in:
// - Ctrl+Z pressed twice. Typing fields keep Ctrl+Z for undo.
// - On touch screens, the logo tapped 7 times.
// - Any page with ?terminal=1 in its address.
const DOUBLE_PRESS_MS = 600;
const LOGO_TAPS = 7;
const LOGO_TAPS_WITHIN_MS = 3000;
// A logo is usually a link, so a tap waits this long to see whether another follows before it navigates.
const LOGO_TAP_WAIT_MS = 400;
const LOGO_SELECTOR = ".brand, .auth-logo, .dashboard-brand, .dashboard-mobile-brand, .usb-brand, .cl-brand, .terms-logo-img";

export default function AdminTerminalHotkey() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let last = 0;
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.repeat || event.key.toLowerCase() !== "z") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true'], .monaco-editor")) return;
      const now = Date.now();
      if (now - last <= DOUBLE_PRESS_MS) {
        last = 0;
        event.preventDefault();
        setOpen(true);
        return;
      }
      last = now;
    };

    let taps = 0;
    let firstTap = 0;
    let waiting = 0;
    let replaying = false;
    const onClick = (event: MouseEvent) => {
      if (replaying || !window.matchMedia("(pointer: coarse)").matches || !(event.target instanceof Element)) return;
      const logo = event.target.closest(LOGO_SELECTOR);
      if (!logo) return;
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(waiting);
      const now = Date.now();
      if (now - firstTap > LOGO_TAPS_WITHIN_MS) {
        taps = 0;
        firstTap = now;
      }
      taps += 1;
      if (taps >= LOGO_TAPS) {
        taps = 0;
        firstTap = 0;
        setOpen(true);
        return;
      }
      waiting = window.setTimeout(() => {
        const link = logo.closest("a");
        if (!link || !link.isConnected) return;
        replaying = true;
        link.click();
        replaying = false;
      }, LOGO_TAP_WAIT_MS);
    };

    const fromLink = window.setTimeout(() => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("terminal") !== "1") return;
      url.searchParams.delete("terminal");
      window.history.replaceState(window.history.state, "", url);
      setOpen(true);
    }, 0);

    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    return () => {
      window.clearTimeout(fromLink);
      window.clearTimeout(waiting);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return open ? <AdminTerminal onClose={() => setOpen(false)} /> : null;
}
