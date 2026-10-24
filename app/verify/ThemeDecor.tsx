import type { CSSProperties } from "react";
import type { SiteThemeId } from "../siteThemes";
import { Ghost, Spider, Web } from "./Halloween";
import "./verify.themes.css";

// What each site theme adds to the verify card itself (the scene behind the page is SiteScene's):
// cobwebs and a spider for Halloween, snow and holly for Christmas, a lotus band and marigolds for
// Songkran, neon corner brackets for Cyberpunk. The lettering and colours are in verify.themes.css
// and verify.halloween.css.

export const THEME_TAG: Record<string, string> = {
  halloween: "TRICK OR VERIFY",
  christmas: "MERRY & SECURE",
  songkran: "สวัสดีปีใหม่ไทย",
  cyberpunk: "SYSTEM ACCESS",
};

const n = (value: number) => Math.round(value * 10) / 10;

function SnowCap() {
  // A band of snow along the top edge with soft round lumps.
  let path = "M0 0H400V8";
  const lumps = [8, 30, 18, 38, 14, 26, 36, 12, 24, 34, 16];
  lumps.forEach((height, index) => {
    const x = 400 - index * 36.4;
    path += `C${n(x - 4)} ${n(height + 4)} ${n(x - 28)} ${n(height + 4)} ${n(x - 32)} 8`;
  });
  path += "L0 8z";
  return (
    <svg className="tm-snowcap" viewBox="0 0 400 44" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="#f4f9ff" />
      <path d={path} fill="none" stroke="#b9d2ea" strokeWidth="1" opacity=".7" />
    </svg>
  );
}

function Holly() {
  return (
    <svg className="tm-holly" viewBox="0 0 120 90" aria-hidden="true">
      <path d="M60 52C44 30 18 28 6 44c14 4 22 12 30 22 8-8 16-12 24-14z" fill="#1f8a4b" />
      <path d="M60 52C76 30 102 28 114 44c-14 4-22 12-30 22-8-8-16-12-24-14z" fill="#2aa35c" />
      <path d="M60 52C46 36 40 18 54 6c4 14 10 28 6 46z" fill="#1a7a42" />
      <path d="M14 42Q36 46 56 54M106 42Q84 46 64 54M56 12Q58 32 60 50" stroke="#0f5a30" strokeWidth="1.4" fill="none" opacity=".7" />
      <circle cx="58" cy="60" r="9" fill="#d9363f" /><circle cx="73" cy="64" r="8" fill="#e5434f" /><circle cx="49" cy="70" r="7.4" fill="#c22b34" />
      <circle cx="55" cy="57" r="2.4" fill="#ff9aa2" opacity=".85" /><circle cx="70" cy="61" r="2.2" fill="#ffb0b6" opacity=".85" />
    </svg>
  );
}

function Lotus() {
  return (
    <svg className="tm-lotus" width="100%" height="16" aria-hidden="true">
      <defs>
        <pattern id="tm-lotus-pattern" width="40" height="16" patternUnits="userSpaceOnUse">
          <path d="M0 16Q10 16 20 3Q30 16 40 16z" fill="#e8a825" opacity=".9" />
          <path d="M7 16Q14 16 20 8Q26 16 33 16z" fill="#fff6d6" />
          <circle cx="20" cy="3" r="1.6" fill="#b8791a" />
        </pattern>
      </defs>
      <rect width="100%" height="3" fill="#e8a825" />
      <rect y="3" width="100%" height="13" fill="url(#tm-lotus-pattern)" />
    </svg>
  );
}

function Flower({ className }: { className: string }) {
  return (
    <svg className={`tm-flower ${className}`} viewBox="0 0 60 60" aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => <ellipse key={index} cx="30" cy="12" rx="5.6" ry="11" transform={`rotate(${index * (360 / 14)} 30 30)`} fill={index % 2 ? "#ffb81c" : "#ff9a1a"} />)}
      {Array.from({ length: 9 }, (_, index) => <ellipse key={index} cx="30" cy="19" rx="4.2" ry="8" transform={`rotate(${index * 40 + 20} 30 30)`} fill={index % 2 ? "#ffd34d" : "#ffc02a"} />)}
      <circle cx="30" cy="30" r="6" fill="#e07a0a" />
    </svg>
  );
}

function Drop() {
  return (
    <svg className="tm-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3C8 9 5 12.2 5 15.6A7 7 0 0 0 19 15.6C19 12.2 16 9 12 3z" />
      <path d="M9 16a3 3 0 0 0 3 3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Flake() {
  return (
    <svg className="tm-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v20M3.4 7l17.2 10M3.4 17L20.6 7M12 5l-2.4-2M12 5l2.4-2M12 19l-2.4 2M12 19l2.4 2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Chip() {
  return (
    <svg className="tm-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="none" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M10 12h4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** The picture in the middle of the ring when the member has no Discord picture of their own. */
export function ThemeBadgeIcon({ theme }: { theme: SiteThemeId }) {
  if (theme === "halloween") return <Ghost className="hw-ghost-core" />;
  if (theme === "christmas") return <Flake />;
  if (theme === "songkran") return <Drop />;
  if (theme === "cyberpunk") return <Chip />;
  return null;
}

export function PanelDecor({ theme }: { theme: SiteThemeId }) {
  if (theme === "halloween") {
    return (
      <>
        <Web className="hw-web-a" />
        <Web className="hw-web-b" />
        <Spider />
      </>
    );
  }
  if (theme === "christmas") {
    return (
      <>
        <SnowCap />
        <Holly />
      </>
    );
  }
  if (theme === "songkran") {
    return (
      <>
        <Lotus />
        <Flower className="tm-flower-a" />
        <Flower className="tm-flower-b" />
      </>
    );
  }
  if (theme === "cyberpunk") {
    return (
      <>
        <i className="tm-bracket tm-bracket-tl" />
        <i className="tm-bracket tm-bracket-br" />
        <i className="tm-scan" style={{ "--d": "0s" } as CSSProperties} />
      </>
    );
  }
  return null;
}
