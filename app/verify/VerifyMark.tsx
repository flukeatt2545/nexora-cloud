"use client";

import { useEffect, useRef } from "react";

// Pieces of the verify page's look (verify.css) that other pages reuse: the error screen in square
// mode (app/components/errors/ErrorScreen.tsx) draws the same backdrop and headline.

// Where each row starts (verify.css sets the same offsets), as a share of the window width.
const MARK_START = [-0.09, 0.07, -0.03];

/**
 * The big outlined NEXORA behind the card, in three rows. Each row swings to a random place on the
 * other side, then picks again, so the rows never move together or in the same pattern. How long a
 * swing takes comes from its length and one shared speed range, so no row crawls while the others move.
 */
export function Mark() {
  const rows = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const timers: number[] = [];
    const at = MARK_START.map((share) => share * window.innerWidth);
    const move = (index: number) => {
      const row = rows.current[index];
      if (!row) return;
      const width = window.innerWidth;
      const side = at[index] > 0 ? -1 : 1;
      const x = side * width * (0.08 + Math.random() * 0.2);
      const speed = width * (0.03 + Math.random() * 0.012);
      const seconds = Math.min(12, Math.max(3, Math.abs(x - at[index]) / speed));
      at[index] = x;
      row.style.setProperty("--dur", `${seconds}s`);
      row.style.setProperty("--x", `${x}px`);
      timers[index] = window.setTimeout(() => move(index), seconds * 1000 + Math.random() * 600);
    };
    [0, 1, 2].forEach((index) => { timers[index] = window.setTimeout(() => move(index), 200 + index * 300); });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  return (
    <span className="vf-mark">
      {[0, 1, 2].map((index) => <span key={index} ref={(row) => { rows.current[index] = row; }}>NEXORA NEXORA NEXORA</span>)}
    </span>
  );
}

/**
 * Thai has no spaces, so a one-word title would break in the middle of the phrase. Short single words are
 * shrunk to fit on one line instead (.vf-title.is-fit); vowels and tone marks sit above or below a letter
 * and take no width. Returns the letters that take width, or 0 when the title can wrap normally.
 */
export function fitLength(title: string) {
  const baseLen = title.replace(/[ัิ-ฺ็-๎]/g, "").length;
  return !/\s/.test(title) && baseLen <= 14 ? baseLen : 0;
}
