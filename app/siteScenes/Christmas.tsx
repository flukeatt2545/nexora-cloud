import type { CSSProperties } from "react";
import { n, seeded } from "./seeded";
import "./christmas.css";

// Christmas and New Year: a snowy night with an aurora, pine trees, a lit cabin and a snowman, snow
// falling in front and a string of lights along the top edge.

/** A pine made of four tiers; one side of each tier is lit by snow. */
function Pine({ x, y, height, seed, lights = false }: { x: number; y: number; height: number; seed: number; lights?: boolean }) {
  const tiers = 4;
  const width = height * 0.52;
  const tierHeight = height / (tiers + 0.6);
  const parts = Array.from({ length: tiers }, (_, index) => {
    const top = y - height + index * tierHeight * 0.82;
    const half = (width / 2) * (0.42 + (index / (tiers - 1)) * 0.58);
    return { top, half, bottom: top + tierHeight * 1.18 };
  });
  return (
    <g>
      <rect x={n(x - height * 0.035)} y={n(y - height * 0.08)} width={n(height * 0.07)} height={n(height * 0.1)} fill="#1b0f0a" />
      {parts.map((part, index) => (
        <g key={index}>
          <path d={`M${n(x)} ${n(part.top)}L${n(x + part.half)} ${n(part.bottom)}Q${n(x)} ${n(part.bottom + 5)} ${n(x - part.half)} ${n(part.bottom)}z`} fill="#0a2a22" />
          <path d={`M${n(x)} ${n(part.top)}L${n(x + part.half)} ${n(part.bottom)}Q${n(x + part.half * 0.4)} ${n(part.bottom - 6)} ${n(x + part.half * 0.06)} ${n(part.bottom - 2)}z`} fill="#e8f3fb" opacity=".78" />
        </g>
      ))}
      {lights && parts.flatMap((part, index) => [-0.5, 0.15, 0.62].map((offset, k) => (
        <circle key={`${index}-${k}`} className={`xm-bulb xm-bulb-${(index + k) % 4}`} cx={n(x + part.half * offset * 1.5 + (seeded(index * 3 + k, seed) - 0.5) * 8)} cy={n(part.bottom - 8 - seeded(index + k, seed + 2) * 8)} r="3.4" />
      )))}
    </g>
  );
}

function Cabin() {
  return (
    <g>
      <path d="M1280 668C1268 710 1200 744 1150 790L1120 900H1210C1250 820 1310 770 1326 668z" fill="rgba(255,200,97,.1)" />
      <path d="M1180 676c40-10 160-14 270-2v10H1180z" fill="#dce9f4" />
      <rect x="1214" y="586" width="206" height="92" fill="#3c2418" />
      {Array.from({ length: 5 }, (_, index) => <path key={index} d={`M1214 ${600 + index * 17}h206`} stroke="#25140c" strokeWidth="2" />)}
      <path d="M1198 592l120-72 120 72z" fill="#22140d" />
      <path d="M1198 592l120-72 120 72-16 0-104-62-104 62z" fill="#f3f9ff" />
      <path d="M1198 592h240l-8 10h-224z" fill="#e7f1fa" />
      <rect x="1378" y="508" width="26" height="52" fill="#2d1b12" />
      <rect x="1374" y="500" width="34" height="12" fill="#f3f9ff" />
      <g className="xm-smoke" fill="#cbd9e8">
        <circle cx="1391" cy="494" r="8" /><circle cx="1391" cy="494" r="8" /><circle cx="1391" cy="494" r="8" />
      </g>
      <g fill="#ffc861" className="xm-glow">
        <rect x="1236" y="616" width="38" height="34" />
        <rect x="1366" y="616" width="38" height="34" />
      </g>
      <path d="M1255 616v34M1236 633h38M1385 616v34M1366 633h38" stroke="#22140d" strokeWidth="2.6" />
      <path d="M1296 678v-44a22 22 0 0 1 44 0v44z" fill="#4a2a18" />
      <circle cx="1318" cy="622" r="11" fill="none" stroke="#1f8a4b" strokeWidth="5" />
      <circle cx="1311" cy="617" r="2.6" fill="#e5434f" /><circle cx="1324" cy="626" r="2.6" fill="#e5434f" />
      {Array.from({ length: 13 }, (_, index) => <circle key={index} className={`xm-bulb xm-bulb-${index % 4}`} cx={1204 + index * 19} cy={n(592 - (6 - Math.abs(6 - index)) * 6 * 0.6)} r="3.4" />)}
    </g>
  );
}

function Snowman() {
  return (
    <g transform="translate(200 760)">
      <ellipse cx="0" cy="40" rx="62" ry="9" fill="rgba(5,12,28,.4)" />
      <circle cx="0" cy="-2" r="34" fill="#f2f8ff" />
      <circle cx="0" cy="-56" r="25" fill="#f6fbff" />
      <circle cx="0" cy="-98" r="19" fill="#f9fcff" />
      <path d="M-18 -112h36l-4 -26h-28z" fill="#1c1630" />
      <path d="M-24 -112h48v6h-48z" fill="#1c1630" />
      <circle cx="-7" cy="-100" r="2.4" fill="#1b1b24" /><circle cx="7" cy="-100" r="2.4" fill="#1b1b24" />
      <path d="M0 -95l17 3-17 4z" fill="#f08a2c" />
      <path d="M-20 -80c14 6 26 6 40 0l2 9c-14 7-30 7-44 0z" fill="#d9363f" />
      <path d="M10 -76l6 22 8-2-5-20z" fill="#c22b34" />
      <circle cx="0" cy="-60" r="2.6" fill="#1b1b24" /><circle cx="0" cy="-46" r="2.6" fill="#1b1b24" />
      <path d="M-24 -62l-44 -22M-68 -84l-8 -9M-68 -84l-10 2M24 -62l44 -20M68 -82l9 -9M68 -82l10 4" stroke="#5a3a22" strokeWidth="3" strokeLinecap="round" fill="none" />
    </g>
  );
}

export function Back() {
  return (
    <>
      <div className="xm-sky" />
      <i className="xm-aurora xm-aurora-a" />
      <i className="xm-aurora xm-aurora-b" />
      <div className="xm-stars">
        {Array.from({ length: 60 }, (_, index) => (
          <i key={index} style={{
            left: `${n(seeded(index, 3) * 100)}%`, top: `${n(seeded(index, 4) * 55)}%`,
            "--s": `${n(0.8 + seeded(index, 5) ** 3 * 2.6)}px`, "--t": `${n(2 + seeded(index, 6) * 5)}s`, "--d": `${n(seeded(index, 7) * 6)}s`,
          } as CSSProperties} />
        ))}
      </div>
      <svg className="xm-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
          <linearGradient id="xm-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#eef6fd" /><stop offset="1" stopColor="#b9d2ea" /></linearGradient>
        </defs>
        <path d="M0 600L160 470 260 560 420 400 560 540 720 430 900 570 1060 450 1200 560 1360 440 1480 540 1600 480V900H0z" fill="#1a3350" />
        <path d="M420 400l-40 44 28 8 22-14 18 10zM720 430l-30 36 22 6 18-12 14 8zM1360 440l-34 40 26 6 20-14 14 10z" fill="#d7e8f6" opacity=".85" />
        {[120, 210, 330, 470, 560, 700, 840, 990, 1150, 1260].map((x, index) => <Pine key={x} x={x} y={640 + (index % 3) * 12} height={110 + seeded(index, 21) * 60} seed={index} />)}
        <path d="M0 680C200 650 420 670 640 690C860 710 1040 664 1240 672C1400 678 1500 662 1600 666V900H0z" fill="url(#xm-snow)" />
        <path d="M0 790C220 760 420 782 660 796C900 810 1120 772 1330 784C1460 792 1540 782 1600 778V900H0z" fill="#f3f9ff" />
      </svg>
      <svg className="xm-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
        <Pine x={70} y={800} height={330} seed={2} lights />
        <Pine x={380} y={796} height={190} seed={7} />
        <Snowman />
      </svg>
      <svg className="xm-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
        <Cabin />
        <Pine x={1090} y={792} height={230} seed={4} lights />
        <Pine x={1540} y={800} height={300} seed={9} />
      </svg>
    </>
  );
}

const BULB_COLORS = ["#e5434f", "#ffc861", "#3ccf86", "#5cb8ff"];

export function Front() {
  return (
    <>
      <div className="xm-snowfall">
        {Array.from({ length: 48 }, (_, index) => (
          <i key={index} style={{
            left: `${n(seeded(index, 31) * 100)}%`, "--s": `${n(2 + seeded(index, 32) ** 2 * 6)}px`, "--o": `${n(0.35 + seeded(index, 33) * 0.55)}`,
            "--t": `${n(9 + seeded(index, 34) * 14)}s`, "--d": `${n(-seeded(index, 35) * 22)}s`, "--x": `${n((seeded(index, 36) - 0.5) * 140)}px`,
          } as CSSProperties} />
        ))}
      </div>
    </>
  );
}

/** Above the page headers too: the string of lights along the very top. */
export function Top() {
  return (
    <svg className="xm-lights" width="100%" height="46" aria-hidden="true">
      <defs>
        <pattern id="xm-wire" width="132" height="46" patternUnits="userSpaceOnUse">
          <path d="M0 6Q66 40 132 6" fill="none" stroke="#2b4239" strokeWidth="1.6" />
        </pattern>
        {BULB_COLORS.map((color, index) => {
          // The wire sags like a rope from 6 down to 23 and back; each bulb hangs a little below it.
          const cx = [20, 50, 82, 112][index];
          const t = cx / 132;
          const cy = 6 + 68 * t * (1 - t) + 8;
          return (
            <pattern key={color} id={`xm-light-${index}`} width="132" height="46" patternUnits="userSpaceOnUse">
              <path d={`M${cx - 3} ${n(cy - 8)}h6l-1 5h-4z`} fill="#22362f" />
              <circle cx={cx} cy={n(cy)} r="5" fill={color} />
            </pattern>
          );
        })}
      </defs>
      <rect width="100%" height="46" fill="url(#xm-wire)" />
      {BULB_COLORS.map((color, index) => <rect key={color} className={`xm-chase xm-chase-${index}`} width="100%" height="46" fill={`url(#xm-light-${index})`} />)}
    </svg>
  );
}
