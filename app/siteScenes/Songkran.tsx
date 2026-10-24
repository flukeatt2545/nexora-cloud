import type { CSSProperties } from "react";
import { n, seeded } from "./seeded";
import "./songkran.css";

// Songkran: a bright morning over a Thai temple, a golden chedi, coconut palms and green hills, with
// water at the bottom (waves moving, marigolds floating), bubbles drifting up in front and a strip
// of lotus pattern along the top. Drawn like the other themes: layered shapes, grown not stamped.

/** A wave: a smooth line that repeats every 800 units, drawn four times so sliding it by half its width loops. */
function wave(amplitude: number, top: number) {
  let path = `M0 ${top}Q200 ${top - amplitude} 400 ${top}`;
  for (let index = 0; index < 7; index++) path += `T${800 + index * 400} ${top}`;
  return `${path}V300H0z`;
}

/** The crest of a wave on its own, for the white foam line drawn along it. */
function crest(amplitude: number, top: number) {
  return wave(amplitude, top).replace(/V300H0z$/, "");
}

function Marigold({ className = "" }: { className?: string }) {
  return (
    <svg className={`sk-flower ${className}`} viewBox="0 0 60 60" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => (
        <ellipse key={index} cx="30" cy="12" rx="5.6" ry="11" transform={`rotate(${index * 22.5} 30 30)`} fill={index % 2 ? "#ffb81c" : "#ff9a1a"} />
      ))}
      {Array.from({ length: 10 }, (_, index) => (
        <ellipse key={index} cx="30" cy="19" rx="4.2" ry="8" transform={`rotate(${index * 36 + 18} 30 30)`} fill={index % 2 ? "#ffd34d" : "#ffc02a"} />
      ))}
      <circle cx="30" cy="30" r="7" fill="#e07a0a" />
      <circle cx="30" cy="30" r="3.4" fill="#b55a05" />
    </svg>
  );
}

/** A coconut palm: a trunk that tapers and leans, and fronds that arch out and droop. */
function Palm({ x, y, height, lean, seed }: { x: number; y: number; height: number; lean: number; seed: number }) {
  const topX = x + lean;
  const topY = y - height;
  const trunk = `M${n(x - 8)} ${y}Q${n(x - 8 + lean * 0.15)} ${n(y - height * 0.55)} ${n(topX - 3)} ${n(topY)}L${n(topX + 3)} ${n(topY)}Q${n(x + 8 + lean * 0.15)} ${n(y - height * 0.55)} ${n(x + 8)} ${y}z`;
  const fronds = Array.from({ length: 10 }, (_, index) => {
    const angle = ((-170 + index * (160 / 9) + (seeded(index, seed) - 0.5) * 14) * Math.PI) / 180;
    const length = height * (0.42 + seeded(index, seed + 1) * 0.16);
    const ex = topX + Math.cos(angle) * length;
    const ey = topY + Math.sin(angle) * length * 0.5 + length * 0.42;
    const cx = topX + Math.cos(angle) * length * 0.55;
    const cy = topY + Math.sin(angle) * length * 0.62 - length * 0.12;
    const side = Math.cos(angle) >= 0 ? 1 : -1;
    const width = length * 0.11;
    return { d: `M${n(topX)} ${n(topY)}Q${n(cx)} ${n(cy - width)} ${n(ex)} ${n(ey)}Q${n(cx + side * 4)} ${n(cy + width)} ${n(topX)} ${n(topY)}z`, dark: index % 2 === 0 };
  });
  return (
    <g className="sk-palm" style={{ transformOrigin: `${x}px ${y}px` }}>
      <path d={trunk} fill="url(#sk-trunk)" />
      {Array.from({ length: 9 }, (_, index) => {
        const t = (index + 1) / 10;
        const px = x + lean * t * t + (seeded(index, seed + 5) - 0.5) * 2;
        return <path key={index} d={`M${n(px - 7 + t * 4)} ${n(y - height * t)}h${n(14 - t * 8)}`} stroke="#4c3320" strokeWidth="1.6" opacity=".6" />;
      })}
      {fronds.map((frond, index) => <path key={index} d={frond.d} fill={frond.dark ? "#1d7050" : "#34a673"} />)}
      <circle cx={n(topX - 5)} cy={n(topY + 8)} r="6" fill="#5a3b22" />
      <circle cx={n(topX + 5)} cy={n(topY + 9)} r="6" fill="#654326" />
      <circle cx={n(topX)} cy={n(topY + 14)} r="6" fill="#5a3b22" />
    </g>
  );
}

/** A chedi: stepped base, a bell, rings, and a long spire up to a gold point. */
function Chedi({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M-46 0V-14H46V0zM-38 -14V-28H38V-14z" fill="#efe0b4" />
      <path d="M-32 -28V-36H32V-28z" fill="#e3cf9b" />
      <path d="M-26 -36C-28 -92 -14 -128 0 -150C14 -128 28 -92 26 -36z" fill="url(#sk-gold)" />
      <path d="M-24 -52H24M-22 -70H22M-18 -92H18M-12 -114H12" stroke="#b97f14" strokeWidth="2" fill="none" opacity=".75" />
      {Array.from({ length: 8 }, (_, index) => <rect key={index} x={n(-9 + index * 0.9)} y={n(-166 - index * 11)} width={n(18 - index * 1.8)} height="7" fill="url(#sk-gold)" />)}
      <path d="M-2 -256L0 -290L2 -256z" fill="#ffd34d" />
      <circle cx="0" cy="-152" r="5" fill="#ffe99a" />
    </g>
  );
}

/** The temple hall: a white hall with red doors under two tiers of tiled roof, the ends curling up. */
function Temple() {
  return (
    <g>
      <path d="M1040 676h310v12h-310z" fill="#e6d6ae" />
      <ellipse cx="1195" cy="682" rx="190" ry="9" fill="#2f6f58" opacity=".35" />
      <rect x="1068" y="598" width="254" height="78" fill="url(#sk-wall)" />
      {Array.from({ length: 6 }, (_, index) => <rect key={index} x={1068 + index * 50} y="598" width="8" height="78" fill="#efdcae" />)}
      {[1100, 1180, 1260].map((x) => (
        <g key={x}>
          <path d={`M${x} 676v-44a16 16 0 0 1 32 0v44z`} fill="#6a1f12" />
          <path d={`M${x + 4} 676v-40a12 12 0 0 1 24 0v40z`} fill="#ffd27a" className="sk-lamp" />
          <path d={`M${x} 676v-44a16 16 0 0 1 32 0v44z`} fill="none" stroke="#e8b236" strokeWidth="2.4" />
        </g>
      ))}
      <path d="M1030 604L1090 548H1300L1360 604z" fill="#d34a2a" />
      <path d="M1030 604Q1020 596 1014 584Q1030 588 1044 598zM1360 604Q1370 596 1376 584Q1360 588 1346 598z" fill="#d34a2a" />
      <path d="M1040 604L1096 552M1350 604L1294 552M1030 604H1360" stroke="#f0c24a" strokeWidth="2.6" fill="none" />
      <path d="M1084 556L1130 504H1260L1306 556z" fill="#bd3a20" />
      <path d="M1084 556Q1074 548 1068 536Q1084 540 1098 550zM1306 556Q1316 548 1322 536Q1306 540 1292 550z" fill="#bd3a20" />
      <path d="M1094 556L1136 508M1296 556L1254 508M1084 556H1306" stroke="#f0c24a" strokeWidth="2.6" fill="none" />
      <path d="M1126 504Q1120 492 1116 478Q1130 486 1138 500zM1264 504Q1270 492 1274 478Q1260 486 1252 500z" fill="url(#sk-gold)" />
      <path d="M1195 504V476M1189 484l6-12 6 12" stroke="#e8b236" strokeWidth="3" fill="none" strokeLinecap="round" />
    </g>
  );
}

export function Back() {
  return (
    <>
      <div className="sk-sky" />
      <div className="sk-sun"><i /></div>
      <i className="sk-cloud sk-cloud-a" />
      <i className="sk-cloud sk-cloud-b" />
      <i className="sk-cloud sk-cloud-c" />
      <svg className="sk-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
          <linearGradient id="sk-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f6d56a" /><stop offset=".45" stopColor="#ffe99a" /><stop offset="1" stopColor="#c98f1d" /></linearGradient>
          <linearGradient id="sk-hill-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#cdeee8" /><stop offset="1" stopColor="#9fd6cf" /></linearGradient>
          <linearGradient id="sk-hill-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fd9b4" /><stop offset="1" stopColor="#5fb592" /></linearGradient>
          <linearGradient id="sk-hill-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#58b394" /><stop offset="1" stopColor="#2f8a74" /></linearGradient>
          <linearGradient id="sk-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".6" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        </defs>
        <path d="M0 600C200 560 380 590 560 570c200-22 340 30 540 6c200-24 350 8 500-6V900H0z" fill="url(#sk-hill-far)" />
        <rect className="sk-haze" x="-200" y="560" width="2000" height="120" fill="url(#sk-haze)" />
        <path d="M0 700C200 694 420 700 600 706C780 714 900 690 1040 676C1140 666 1220 668 1300 670C1420 672 1520 676 1600 678V900H0z" fill="url(#sk-hill-mid)" />
        <path d="M0 724C200 718 420 724 600 730M0 748C220 742 440 748 640 754M1000 700C1160 690 1400 696 1600 704M1000 724C1200 716 1400 722 1600 730" stroke="#98dbbd" strokeWidth="3" fill="none" opacity=".8" />
        <path d="M0 790C220 770 440 788 680 800C920 812 1140 782 1340 790C1460 796 1540 790 1600 786V900H0z" fill="url(#sk-hill-near)" />
      </svg>
      <svg className="sk-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
        <defs><linearGradient id="sk-trunk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8a6240" /><stop offset=".55" stopColor="#6b4a2f" /><stop offset="1" stopColor="#4a3220" /></linearGradient></defs>
        <ellipse cx="190" cy="750" rx="190" ry="10" fill="#1f5f4c" opacity=".35" />
        <Palm x={90} y={740} height={400} lean={46} seed={3} />
        <Palm x={250} y={744} height={290} lean={-34} seed={8} />
        <Palm x={380} y={748} height={200} lean={26} seed={14} />
      </svg>
      <svg className="sk-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
        <defs>
          <linearGradient id="sk-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f6d56a" /><stop offset=".45" stopColor="#ffe99a" /><stop offset="1" stopColor="#c98f1d" /></linearGradient>
          <linearGradient id="sk-wall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fffbea" /><stop offset=".6" stopColor="#fff0cf" /><stop offset="1" stopColor="#e9d3a6" /></linearGradient>
        </defs>
        <ellipse cx="1470" cy="690" rx="120" ry="9" fill="#2f6f58" opacity=".35" />
        <Temple />
        <Chedi x={1470} y={680} scale={1.25} />
        <Chedi x={1390} y={686} scale={0.62} />
        <Chedi x={1556} y={686} scale={0.52} />
        <defs><linearGradient id="sk-trunk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8a6240" /><stop offset=".55" stopColor="#6b4a2f" /><stop offset="1" stopColor="#4a3220" /></linearGradient></defs>
        <Palm x={1030} y={700} height={260} lean={-26} seed={21} />
      </svg>
      <div className="sk-waves">
        <svg className="sk-wave sk-wave-1" viewBox="0 0 3200 300" preserveAspectRatio="none"><path d={wave(46, 120)} fill="#8bdcff" opacity=".7" /><path d={crest(46, 120)} fill="none" stroke="#fff" strokeWidth="4" opacity=".7" /></svg>
        <svg className="sk-wave sk-wave-2" viewBox="0 0 3200 300" preserveAspectRatio="none"><path d={wave(38, 140)} fill="#3bb4f2" opacity=".78" /><path d={crest(38, 140)} fill="none" stroke="#fff" strokeWidth="3.4" opacity=".6" /></svg>
        <svg className="sk-wave sk-wave-3" viewBox="0 0 3200 300" preserveAspectRatio="none"><path d={wave(30, 160)} fill="#0b88d6" opacity=".92" /><path d={crest(30, 160)} fill="none" stroke="#fff" strokeWidth="3" opacity=".5" /></svg>
        <Marigold className="sk-flower-a" />
        <Marigold className="sk-flower-b" />
        <Marigold className="sk-flower-c" />
      </div>
    </>
  );
}

export function Front() {
  return (
    <div className="sk-bubbles">
      {Array.from({ length: 30 }, (_, index) => (
        <i key={index} style={{
          left: `${n(seeded(index, 41) * 100)}%`, "--s": `${n(7 + seeded(index, 42) ** 2 * 22)}px`,
          "--t": `${n(10 + seeded(index, 43) * 14)}s`, "--d": `${n(-seeded(index, 44) * 24)}s`, "--x": `${n((seeded(index, 45) - 0.5) * 120)}px`,
        } as CSSProperties} />
      ))}
    </div>
  );
}

/** Above the page headers too: the strip of lotus pattern along the very top. */
export function Top() {
  return (
    <svg className="sk-thai" width="100%" height="18" aria-hidden="true">
      <defs>
        <pattern id="sk-lotus" width="44" height="18" patternUnits="userSpaceOnUse">
          <path d="M0 18Q11 18 22 3Q33 18 44 18z" fill="#e8a825" opacity=".85" />
          <path d="M8 18Q15 18 22 8Q29 18 36 18z" fill="#fff6d6" opacity=".9" />
          <circle cx="22" cy="3" r="1.8" fill="#b8791a" />
        </pattern>
      </defs>
      <rect width="100%" height="4" fill="#e8a825" opacity=".9" />
      <rect y="4" width="100%" height="14" fill="url(#sk-lotus)" />
    </svg>
  );
}
