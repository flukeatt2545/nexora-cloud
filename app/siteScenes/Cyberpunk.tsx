import type { CSSProperties } from "react";
import { n, seeded } from "./seeded";
import "./cyberpunk.css";

// Cyberpunk and neon: a night city under a striped neon sun, a grid floor sliding toward you, signs
// that flicker, and scan lines and corner brackets over the pages.

type Tower = { x: number; width: number; height: number };

function skyline(seed: number, from: number, to: number, min: number, max: number): Tower[] {
  const towers: Tower[] = [];
  let x = from;
  for (let index = 0; x < to; index++) {
    const width = 40 + seeded(index, seed) * 70;
    towers.push({ x, width, height: min + seeded(index, seed + 1) ** 1.6 * (max - min) });
    x += width + seeded(index, seed + 2) * 12;
  }
  return towers;
}

const WINDOW_COLORS = ["#00f0ff", "#ff2bd6", "#ffd23f", "#00f0ff"];

function Towers({ towers, ground, fill, seed, lit }: { towers: Tower[]; ground: number; fill: string; seed: number; lit: boolean }) {
  return (
    <g>
      {towers.map((tower, index) => {
        const top = ground - tower.height;
        const rows = Math.floor(tower.height / 22);
        const cols = Math.max(2, Math.floor(tower.width / 14));
        return (
          <g key={index}>
            <rect x={n(tower.x)} y={n(top)} width={n(tower.width)} height={n(tower.height + 2)} fill={fill} />
            {lit && <rect x={n(tower.x + tower.width - 2)} y={n(top)} width="2" height={n(tower.height)} fill={WINDOW_COLORS[index % 4]} opacity=".55" />}
            {lit && Array.from({ length: rows * cols }, (_, cell) => {
              if (seeded(cell + index * 31, seed + 5) < 0.62) return null;
              const col = cell % cols;
              const row = Math.floor(cell / cols);
              return <rect key={cell} x={n(tower.x + 6 + col * ((tower.width - 12) / cols))} y={n(top + 10 + row * 20)} width="5" height="8" fill={WINDOW_COLORS[(cell + index) % 4]} opacity={n(0.5 + seeded(cell, seed + 6) * 0.5)} />;
            })}
            {lit && index % 5 === 2 && <g><path d={`M${n(tower.x + tower.width / 2)} ${n(top)}v-26`} stroke={fill} strokeWidth="2" /><circle className="cy-blink" cx={n(tower.x + tower.width / 2)} cy={n(top - 28)} r="3" fill="#ff3b4e" /></g>}
          </g>
        );
      })}
    </g>
  );
}

const SIGNS = [
  { x: 372, y: 372, w: 16, h: 120, color: "#ff2bd6", delay: 0 },
  { x: 1134, y: 332, w: 14, h: 96, color: "#00f0ff", delay: -1.7 },
  { x: 1472, y: 400, w: 16, h: 84, color: "#ffd23f", delay: -3.1 },
];

export function Back() {
  const far = skyline(11, -20, 1640, 90, 300);
  const near = skyline(23, -20, 1640, 160, 460);
  return (
    <>
      <div className="cy-sky" />
      <div className="cy-stars">
        {Array.from({ length: 40 }, (_, index) => (
          <i key={index} style={{ left: `${n(seeded(index, 3) * 100)}%`, top: `${n(seeded(index, 4) * 42)}%`, "--s": `${n(0.8 + seeded(index, 5) * 1.6)}px`, "--d": `${n(seeded(index, 7) * 5)}s` } as CSSProperties} />
        ))}
      </div>
      <div className="cy-sun" />
      <svg className="cy-city" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <Towers towers={far} ground={620} fill="#1a0b3a" seed={31} lit={false} />
        <Towers towers={near} ground={640} fill="#07030f" seed={41} lit />
        {SIGNS.map((sign) => (
          <g key={sign.x} className="cy-sign" style={{ animationDelay: `${sign.delay}s` }}>
            <rect x={sign.x} y={sign.y} width={sign.w} height={sign.h} fill="none" stroke={sign.color} strokeWidth="3" />
            <rect x={sign.x + 5} y={sign.y + 8} width={sign.w - 10} height={sign.h - 16} fill={sign.color} opacity=".35" />
          </g>
        ))}
        <rect x="0" y="636" width="1600" height="4" fill="#ff2bd6" opacity=".7" />
      </svg>
      <div className="cy-floor"><i className="cy-grid" /></div>
    </>
  );
}

export function Front() {
  return (
    <>
      <i className="cy-scanlines" />
      <i className="cy-sweep" />
      <i className="cy-corner cy-corner-tl" /><i className="cy-corner cy-corner-tr" /><i className="cy-corner cy-corner-bl" /><i className="cy-corner cy-corner-br" />
    </>
  );
}
