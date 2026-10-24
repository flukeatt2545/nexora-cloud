import type { CSSProperties } from "react";
import "./verify.halloween.css";

// The Halloween look of the verify page, drawn as one scene: a village on a hill under a low moon,
// a dead tree, a lit house, a fence, pumpkins on the ground, and a vintage poster for a card. It is
// inline SVG and CSS (the only outside file is the lettering fonts, loaded by the page that shows it).
// Shapes that should look grown, not stamped (the tree, the fence, the stars) come from a seeded
// generator, so the server and the browser draw the same thing.

const seeded = (index: number, salt: number) => {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const n = (value: number) => Math.round(value * 10) / 10;

/** Paint shared by the pieces below, referenced by id. */
export function HalloweenDefs() {
  return (
    <svg width="0" height="0" className="hw-defs" aria-hidden="true">
      <defs>
        <radialGradient id="hw-pk" cx="50%" cy="42%" r="64%">
          <stop offset="0" stopColor="#f5a043" />
          <stop offset=".6" stopColor="#e2701c" />
          <stop offset="1" stopColor="#a8470d" />
        </radialGradient>
        <radialGradient id="hw-candle" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffe08a" stopOpacity=".85" />
          <stop offset="1" stopColor="#ff9a2e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hw-ghost" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f1ff" />
          <stop offset="1" stopColor="#bfb0e8" />
        </linearGradient>
        <linearGradient id="hw-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9a77b" stopOpacity="0" />
          <stop offset=".5" stopColor="#d9a77b" stopOpacity=".16" />
          <stop offset="1" stopColor="#d9a77b" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hw-house" x1="0" y1="0" x2="1" y2=".25">
          <stop offset="0" stopColor="#06030d" />
          <stop offset=".62" stopColor="#0d0818" />
          <stop offset="1" stopColor="#241838" />
        </linearGradient>
        <filter id="hw-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
    </svg>
  );
}

export function Bat({ style }: { style?: CSSProperties }) {
  return (
    <svg className="hw-bat" viewBox="0 0 80 40" style={style} aria-hidden="true">
      <g className="hw-wing hw-wing-l"><path d="M40 18C34 8 20 4 2 10c6 4 8 10 6 18 6-4 12-4 16 2 4-6 10-6 16-2z" /></g>
      <g className="hw-wing hw-wing-r"><path d="M40 18C46 8 60 4 78 10c-6 4-8 10-6 18-6-4-12-4-16 2-4-6-10-6-16-2z" /></g>
      <path d="M35 15 36 4l4 7 4-7 1 11z" />
      <ellipse cx="40" cy="22" rx="5.5" ry="9.5" />
    </svg>
  );
}

/** A pumpkin that sits on the ground: lumpy, ribbed, with a crooked carved face lit from inside. */
export function Pumpkin({ className = "", seed = 1 }: { className?: string; seed?: number }) {
  const lean = (seeded(seed, 2) - 0.5) * 6;
  return (
    <svg className={`hw-pumpkin ${className}`} viewBox="0 0 150 124" aria-hidden="true">
      <ellipse cx="75" cy="116" rx="62" ry="7" fill="#000" opacity=".5" />
      <g transform={`rotate(${n(lean)} 75 100)`}>
        <path d="M70 26c-1-10 3-18 12-24l5 4c-5 5-7 11-7 20z" fill="#4c5a24" />
        <path d="M82 6c8-5 16-2 15 6-1 5-7 6-9 2" fill="none" stroke="#6f8a2e" strokeWidth="2.4" strokeLinecap="round" />
        <ellipse cx="32" cy="72" rx="26" ry="38" fill="#c25a10" />
        <ellipse cx="118" cy="72" rx="26" ry="38" fill="#c25a10" />
        <ellipse cx="50" cy="72" rx="28" ry="42" fill="#d9661a" />
        <ellipse cx="100" cy="72" rx="28" ry="42" fill="#d9661a" />
        <ellipse cx="75" cy="72" rx="26" ry="45" fill="url(#hw-pk)" />
        <path d="M52 32c-14 24-14 62 0 80M98 32c14 24 14 62 0 80M75 28v88M32 44c-8 18-8 46 0 62M118 44c8 18 8 46 0 62" fill="none" stroke="#7a3205" strokeWidth="1.6" opacity=".45" strokeLinecap="round" />
        <ellipse className="hw-inner" cx="75" cy="76" rx="40" ry="30" fill="url(#hw-candle)" />
        <g className="hw-face">
          <path d="M40 62l17-3-6-17z" />
          <path d="M93 59l18 4-11-19z" />
          <path d="M75 68l-7 12 4 2h6z" />
          <path d="M38 84l8 8 7-9 6 11 8-10 8 11 7-10 8 8 8-8 5-2c-7 24-61 24-75 0z" />
        </g>
      </g>
    </svg>
  );
}

/** A ghost icon for the badge (when the member has no Discord picture). */
export function Ghost({ className = "" }: { className?: string }) {
  return (
    <svg className={`hw-ghost ${className}`} viewBox="0 0 80 100" aria-hidden="true">
      <path d="M8 92V42C8 20 22 6 40 6s32 14 32 36v50l-10-9-11 10-11-10-11 10-11-10z" fill="url(#hw-ghost)" />
      <ellipse cx="29" cy="40" rx="6" ry="8" fill="#1a0c2e" />
      <ellipse cx="51" cy="40" rx="6" ry="8" fill="#1a0c2e" />
      <ellipse cx="40" cy="60" rx="7" ry="9" fill="#1a0c2e" />
    </svg>
  );
}

/** A cobweb that hangs in the corner (the top left of the box it sits in). */
export function Web({ className = "" }: { className?: string }) {
  const rays = [[120, 0], [112, 38], [88, 82], [44, 112], [0, 120]];
  const rings = [26, 48, 70, 94];
  const arcs = rings.map((radius) => {
    const points = rays.map(([x, y]) => {
      const length = Math.hypot(x, y) || 1;
      return [(x / length) * radius, (y / length) * radius];
    });
    return points.slice(1).reduce((path, [x, y], index) => {
      const [px, py] = points[index];
      return `${path}Q${n((px + x) / 2 - 3)} ${n((py + y) / 2 - 3)} ${n(x)} ${n(y)}`;
    }, `M${n(points[0][0])} ${n(points[0][1])}`);
  });
  return (
    <svg className={`hw-web ${className}`} viewBox="0 0 120 120" aria-hidden="true">
      {rays.map(([x, y]) => <path key={`${x}-${y}`} d={`M0 0L${x} ${y}`} />)}
      {arcs.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** A spider that lets itself down on a thread from the web and goes back up. */
export function Spider() {
  return (
    <span className="hw-spider" aria-hidden="true">
      <i />
      <svg viewBox="0 0 30 26">
        <path d="M15 12c-5-8-10-9-14-6M15 12c-6-3-11-1-13 4M15 14c-6 1-10 5-10 9M15 15c-3 3-4 6-3 9M15 12c5-8 10-9 14-6M15 12c6-3 11-1 13 4M15 14c6 1 10 5 10 9M15 15c3 3 4 6 3 9" fill="none" stroke="#0a0612" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="15" cy="10" r="3.6" />
        <ellipse cx="15" cy="18" rx="5" ry="5.6" />
      </svg>
    </span>
  );
}

/** A dead tree, grown branch by branch: each branch bends a little and splits into one or two thinner ones. */
function Tree({ x, y, length, seed }: { x: number; y: number; length: number; seed: number }) {
  const parts: { d: string; w: number }[] = [];
  const grow = (px: number, py: number, angle: number, size: number, width: number, level: number, id: number) => {
    const bend = (seeded(id, seed) - 0.5) * 0.5;
    const a = Math.max(-1.35, Math.min(1.35, angle + bend));
    const ex = px + Math.sin(a) * size;
    const ey = py - Math.cos(a) * size;
    const cx = px + Math.sin(angle) * size * 0.5 + (seeded(id, seed + 3) - 0.5) * size * 0.3;
    const cy = py - Math.cos(angle) * size * 0.5;
    parts.push({ d: `M${n(px)} ${n(py)}Q${n(cx)} ${n(cy)} ${n(ex)} ${n(ey)}`, w: width });
    if (level >= 6 || size < 7) return;
    const count = level < 2 ? 2 : seeded(id, seed + 9) > 0.32 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const side = count === 1 ? (seeded(id, seed + 4) > 0.5 ? 1 : -1) : i === 0 ? -1 : 1;
      grow(ex, ey, a + side * (0.3 + seeded(id * 7 + i, seed + 5) * 0.55), size * (0.7 + seeded(id * 3 + i, seed + 6) * 0.14), width * 0.66, level + 1, id * 2 + i + 1);
    }
  };
  grow(x, y, 0.06, length, 17, 0, 1);
  return (
    <g className="hw-tree" fill="none" stroke="#080410" strokeLinecap="round">
      {parts.map((part, index) => <path key={index} d={part.d} strokeWidth={n(Math.max(part.w, 1.2))} />)}
    </g>
  );
}

/** A fence that has seen better days: every picket leans a little differently. */
function Fence({ from, to, y, seed }: { from: number; to: number; y: number; seed: number }) {
  const count = Math.floor((to - from) / 24);
  return (
    <g fill="#05020a">
      <rect x={from} y={y - 38} width={to - from} height="5" />
      <rect x={from} y={y - 16} width={to - from} height="5" />
      {Array.from({ length: count }, (_, index) => {
        const px = from + index * 24 + seeded(index, seed) * 6;
        const height = 54 + seeded(index, seed + 1) * 16;
        const tilt = (seeded(index, seed + 2) - 0.5) * 7;
        return <path key={index} transform={`rotate(${n(tilt)} ${n(px)} ${y})`} d={`M${n(px)} ${y}V${n(y - height + 8)}L${n(px + 5)} ${n(y - height)}L${n(px + 10)} ${n(y - height + 8)}V${y}z`} />;
      })}
    </g>
  );
}

function Tomb({ x, y, scale = 1, cross = false }: { x: number; y: number; scale?: number; cross?: boolean }) {
  return cross
    ? <path transform={`translate(${x} ${y}) scale(${scale})`} d="M-4 0V-34H-14V-42H-4V-54H4V-42H14V-34H4V0z" fill="#05020a" />
    : <path transform={`translate(${x} ${y}) scale(${scale})`} d="M-18 0V-40a18 18 0 0 1 36 0V0z" fill="#05020a" />;
}

/** Behind the card: the sky, the moon and clouds, the village landscape, pumpkins and fireflies. */
export function HalloweenBack() {
  return (
    <>
      <div className="hw-sky" />
      <div className="hw-stars">
        {Array.from({ length: 56 }, (_, index) => (
          <i key={index} style={{
            left: `${n(seeded(index, 3) * 100)}%`, top: `${n(seeded(index, 4) * 58)}%`,
            "--s": `${n(0.8 + seeded(index, 5) ** 3 * 2.4)}px`, "--t": `${n(2.5 + seeded(index, 6) * 5)}s`, "--d": `${n(seeded(index, 7) * 6)}s`,
          } as CSSProperties} />
        ))}
      </div>
      <div className="hw-moon"><i /><i /><i /><i /></div>
      <div className="hw-cloud hw-cloud-a" />
      <div className="hw-cloud hw-cloud-b" />

      {/* The land is three drawings that line up differently, so nothing important is cropped on any screen: the hills in the middle, the tree against the left edge, the house against the right edge. The hills are flat where the tree and the house stand, so they sit on the ground however the drawings slide against each other. */}
      <svg className="hw-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path d="M0 640C200 590 380 622 560 600c200-24 340 38 540 8 200-30 350 12 500-8V900H0z" fill="#2a1a46" />
        <rect className="hw-mist hw-mist-a" x="-200" y="560" width="2000" height="160" fill="url(#hw-mist)" />
        <path d="M0 722C200 716 420 722 600 728C780 736 900 700 1040 676C1140 662 1220 664 1300 666C1420 668 1520 672 1600 676V900H0z" fill="#170d2b" />
        <rect className="hw-mist hw-mist-b" x="-200" y="700" width="2000" height="150" fill="url(#hw-mist)" />
        <path d="M0 806C200 772 420 794 640 806c220 12 400-24 600-14 150 8 250-8 360-14V900H0z" fill="#07030d" />
        <Tomb x={640} y={826} scale={0.9} />
        <Tomb x={700} y={832} scale={0.7} cross />
        <Tomb x={960} y={826} scale={0.8} cross />
        <Tomb x={1030} y={832} scale={1} />
      </svg>
      <svg className="hw-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
        <Tree x={250} y={730} length={104} seed={4} />
        <Fence from={-10} to={520} y={830} seed={11} />
      </svg>
      <svg className="hw-scene" viewBox="0 0 1600 900" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
        <path className="hw-path" d="M1316 664C1306 700 1250 730 1186 760L1140 900H1220C1250 820 1330 760 1344 664z" fill="rgba(255,179,71,.09)" />
        <g className="hw-house" fill="url(#hw-house)">
          {/* ground under the house, and a sagging porch roof over the door */}
          <path d="M1150 670c60-14 180-20 330-6v10H1150z" fill="#06030d" />
          <path d="M1296 636l36-20 38 20-4 4h-66z" />
          <path d="M1302 640h4v26h-4zM1358 640h4v26h-4z" />
          {/* main body, a little out of square */}
          <path d="M1200 666l3-72 176-4 4 76z" />
          {/* steep roof with a dip in it, and eaves that hang over */}
          <path d="M1184 604l106-90q6-6 12 0l98 84q6 8-2 8H1190q-8 0-6-2z" />
          <path d="M1196 606l92-78M1300 520l86 76" fill="none" stroke="#06030d" strokeWidth="2" opacity=".5" />
          {/* dormer on the front slope */}
          <path d="M1224 592v-34l22-20 24 20v34z" />
          <path d="M1218 560l28-26 30 26z" />
          {/* the tower, leaning a bit, with a ledge, a cone roof and a weathervane */}
          <path d="M1382 666l-2-196 38-6 30 4 2 198z" />
          <path d="M1370 476l44-84 46 86q-46-8-90-2z" />
          <path d="M1374 506h88v6h-88z" />
          <path d="M1414 394v-26m-12 12l12-4 14 4" fill="none" stroke="#06030d" strokeWidth="2.4" strokeLinecap="round" />
          {/* crooked chimney */}
          <path d="M1232 556l2-70 28-4-2 74z" />
          <path d="M1228 488h40v8h-40z" />
          {/* door with an arch, and a broken shutter on each side */}
          <path d="M1318 666v-34a14 14 0 0 1 28 0v34z" fill="#02010a" />
          <path d="M1206 618l14 4-4 30-12-6z" fill="#02010a" />
          <path d="M1371 624l12-4 4 26-12 6z" fill="#02010a" />
        </g>
        <g className="hw-windows" fill="#ffb347">
          <rect className="hw-win" x="1224" y="620" width="22" height="30" />
          <rect className="hw-win hw-win-2" x="1362" y="620" width="14" height="30" opacity=".85" />
          <rect className="hw-win hw-win-3" x="1398" y="518" width="18" height="30" />
          <rect className="hw-win hw-win-4" x="1236" y="548" width="16" height="22" />
          <circle className="hw-win hw-win-2" cx="1294" cy="564" r="10" />
          <rect className="hw-win hw-win-3" x="1330" y="636" width="2.4" height="26" opacity=".7" />
          <circle className="hw-win hw-win-4" cx="1303" cy="630" r="3.4" fill="#ffd27a" />
        </g>
        {/* window bars over the glow, and two windows that stay dark */}
        <g stroke="#06030d" strokeWidth="2" fill="none">
          <path d="M1235 620v30M1224 635h22M1294 554v20M1284 564h20M1244 548v22M1236 559h16M1407 518v30M1398 533h18" />
        </g>
        <g fill="#02010a">
          <rect x="1272" y="620" width="20" height="30" />
          <rect x="1398" y="572" width="18" height="30" />
        </g>
        <g className="hw-smoke" fill="#bda9d8">
          <circle cx="1250" cy="480" r="9" /><circle cx="1250" cy="480" r="9" /><circle cx="1250" cy="480" r="9" />
        </g>
        <path d="M1156 668c10-18 24-26 36-24-4-14 4-26 12-30-2 12 2 22 10 28 6-6 14-6 22 2-12 2-22 8-26 24z" fill="#06030d" />
        <Fence from={1100} to={1610} y={826} seed={23} />
      </svg>

      <Pumpkin className="hw-pumpkin-a" seed={1} />
      <Pumpkin className="hw-pumpkin-b" seed={5} />
      <Pumpkin className="hw-pumpkin-c" seed={9} />

      <div className="hw-flies">
        {Array.from({ length: 14 }, (_, index) => (
          <i key={index} style={{
            left: `${n(seeded(index, 8) * 100)}%`, top: `${n(58 + seeded(index, 13) * 36)}%`,
            "--t": `${n(9 + seeded(index, 10) * 10)}s`, "--d": `${n(-seeded(index, 11) * 18)}s`,
            "--x": `${n((seeded(index, 12) - 0.5) * 160)}px`, "--y": `${n((seeded(index, 14) - 0.5) * 90)}px`,
          } as CSSProperties} />
        ))}
      </div>
    </>
  );
}

const BATS = [
  { top: 9, size: 52, time: 19, delay: -3, dir: 1 },
  { top: 24, size: 30, time: 24, delay: -12, dir: -1 },
  { top: 6, size: 24, time: 15, delay: -7, dir: 1 },
  { top: 36, size: 36, time: 28, delay: -17, dir: -1 },
];

/** A few bats flying across the screen. */
export function HalloweenBats() {
  return (
    <>
      {BATS.map((bat, index) => (
        <span key={index} className={`hw-flyer${bat.dir < 0 ? " is-back" : ""}`}
          style={{ top: `${bat.top}%`, "--w": `${bat.size}px`, "--t": `${bat.time}s`, "--d": `${bat.delay}s` } as CSSProperties}>
          <Bat />
        </span>
      ))}
    </>
  );
}

/** In front of everything: the bats, and grain and a dark edge over the whole screen so it reads as a print. */
export function HalloweenFront() {
  return (
    <div className="hw-front" aria-hidden="true">
      <HalloweenBats />
      <i className="hw-grain" />
    </div>
  );
}
