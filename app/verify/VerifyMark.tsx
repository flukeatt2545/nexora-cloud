"use client";

import { useEffect, useRef } from "react";

// Pieces of the verify page's look (verify.css) that other pages reuse: the error screen in square
// mode (app/components/errors/ErrorScreen.tsx) draws the same backdrop and headline.

/**
 * The big outlined NEXORA behind the card, in three rows. Each row picks a place to drift to and
 * how long to take, then picks again, so the rows never move together or in the same pattern.
 */
export function Mark() {
  const rows = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    const timers: number[] = [];
    const move = (index: number) => {
      const row = rows.current[index];
      if (!row) return;
      const reach = window.innerWidth * (0.1 + Math.random() * 0.18);
      const seconds = 4 + Math.random() * 8;
      row.style.setProperty("--dur", `${seconds}s`);
      row.style.setProperty("--x", `${(Math.random() * 2 - 1) * reach}px`);
      timers[index] = window.setTimeout(() => move(index), seconds * 1000 * (0.55 + Math.random() * 0.5));
    };
    [0, 1, 2].forEach((index) => { timers[index] = window.setTimeout(() => move(index), 300 + index * 900); });
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
