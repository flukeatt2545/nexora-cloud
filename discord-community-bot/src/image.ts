import path from "path";
import axios from "axios";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";
import { logBotError } from "./api";
import { unfancy } from "./style";

// The pictures the bot posts: the welcome and goodbye cards, the status card, the boost progress card and the panel banners.
// Drawn with Prompt (a modern Thai and Latin typeface from @fontsource). The Thai and Latin
// parts are two font files, so every piece of text is drawn in runs, each with its own file.

const FONT_DIR = path.dirname(require.resolve("@fontsource/prompt/package.json"));
for (const weight of ["400", "600", "800"]) {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "files", `prompt-latin-${weight}-normal.woff2`), "PromptLatin");
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "files", `prompt-thai-${weight}-normal.woff2`), "PromptThai");
}

const THAI = /[฀-๿]/;

type Weight = 400 | 600 | 800;
type TextOptions = { size: number; weight?: Weight; color?: string | CanvasGradient; align?: "left" | "center" | "right"; maxWidth?: number; letterSpacing?: number };

function runs(text: string) {
  return text.match(/[฀-๿]+|[^฀-๿]+/g) ?? [];
}

function fontFor(run: string, size: number, weight: Weight) {
  return `${weight} ${size}px ${THAI.test(run[0]) ? "PromptThai" : "PromptLatin"}`;
}

function textWidth(ctx: SKRSContext2D, text: string, size: number, weight: Weight, spacing = 0) {
  let width = 0;
  for (const run of runs(text)) {
    ctx.font = fontFor(run, size, weight);
    width += ctx.measureText(run).width + spacing * [...run].length;
  }
  return width;
}

/** Draws text at a baseline; shrinks the size until it fits maxWidth. Returns the width drawn. */
export function drawText(ctx: SKRSContext2D, text: string, x: number, y: number, options: TextOptions) {
  const weight = options.weight ?? 400;
  const spacing = options.letterSpacing ?? 0;
  let size = options.size;
  let width = textWidth(ctx, text, size, weight, spacing);
  while (options.maxWidth && width > options.maxWidth && size > 12) {
    size -= 2;
    width = textWidth(ctx, text, size, weight, spacing);
  }
  let cx = options.align === "center" ? x - width / 2 : options.align === "right" ? x - width : x;
  ctx.fillStyle = options.color ?? "#ffffff";
  ctx.textBaseline = "alphabetic";
  for (const run of runs(text)) {
    ctx.font = fontFor(run, size, weight);
    if (spacing) {
      for (const char of run) {
        ctx.fillText(char, cx, y);
        cx += ctx.measureText(char).width + spacing;
      }
    } else {
      ctx.fillText(run, cx, y);
      cx += ctx.measureText(run).width;
    }
  }
  return width;
}

/** A name safe to draw: Thai, Latin, digits and common marks (other scripts, emoji and fancy letters have no glyph here). */
export function drawable(name: string, fallback: string) {
  const cleaned = unfancy(name).replace(/[^฀-๿A-Za-z0-9 ._\-'!?@#&()+*:~]/g, "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

async function avatar(url: string): Promise<Image | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 4000 });
    return await loadImage(Buffer.from(res.data));
  } catch (error) {
    logBotError("welcome avatar", error);
    return null;
  }
}

// Welcome

export type WelcomeData = {
  name: string; username: string; avatarUrl: string; server: string; count: number;
  /** The goodbye card: "ลาก่อน", a grey avatar, and how long they stayed (null = unknown). */
  leaving?: { days: number | null };
};

export async function welcomeCard(data: WelcomeData) {
  const w = 1100;
  const h = 400;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  // Near-black base with a red heat behind the avatar.
  ctx.fillStyle = "#070304";
  ctx.fillRect(0, 0, w, h);
  const heat = ctx.createRadialGradient(850, 200, 20, 850, 200, 460);
  heat.addColorStop(0, "rgba(255,45,63,0.55)");
  heat.addColorStop(0.45, "rgba(150,12,28,0.28)");
  heat.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = heat;
  ctx.fillRect(0, 0, w, h);

  // A big outlined NEXORA behind everything, cut off by the edge.
  ctx.save();
  ctx.font = "800 250px PromptLatin";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,70,85,0.13)";
  ctx.strokeText("NEXORA", -26, 318);
  ctx.restore();

  // Diagonal stripes on the right, inside a slanted band.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(700, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h);
  ctx.lineTo(610, h);
  ctx.closePath();
  ctx.clip();
  const band = ctx.createLinearGradient(610, 0, w, 0);
  band.addColorStop(0, "rgba(255,45,63,0.04)");
  band.addColorStop(1, "rgba(255,45,63,0.2)");
  ctx.fillStyle = band;
  ctx.fillRect(600, 0, 500, h);
  ctx.strokeStyle = "rgba(255,90,100,0.1)";
  ctx.lineWidth = 2;
  for (let x = 560; x < w + h; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x - h, h);
    ctx.stroke();
  }
  ctx.restore();
  // The band's bright edge.
  const edgeLine = ctx.createLinearGradient(0, 0, 0, h);
  edgeLine.addColorStop(0, "rgba(255,77,94,0)");
  edgeLine.addColorStop(0.5, "rgba(255,77,94,0.9)");
  edgeLine.addColorStop(1, "rgba(255,77,94,0)");
  ctx.strokeStyle = edgeLine;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(700, 0);
  ctx.lineTo(610, h);
  ctx.stroke();

  // Frame
  roundRect(ctx, 14, 14, w - 28, h - 28, 26);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,70,85,0.3)";
  ctx.stroke();

  // Brand mark
  const markX = 70;
  ctx.save();
  ctx.translate(markX + 11, 62);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#ff2d3f";
  ctx.fillRect(-9, -9, 18, 18);
  ctx.restore();
  drawText(ctx, "NEXORA CLOUD", markX + 34, 69, { size: 19, weight: 600, color: "rgba(255,255,255,0.8)", letterSpacing: 6 });

  // Greeting, the member's name as the hero, and an accent bar.
  const left = 70;
  const room = 600;
  drawText(ctx, data.leaving ? "ลาก่อน" : "ยินดีต้อนรับ", left, 148, { size: 36, weight: 600, color: "#ff4d5e" });
  const name = drawable(data.name, drawable(data.username, "สมาชิกใหม่"));
  drawText(ctx, name, left, 246, { size: 98, weight: 800, maxWidth: room });
  const bar = ctx.createLinearGradient(left, 0, left + 120, 0);
  bar.addColorStop(0, "#ff2d3f");
  bar.addColorStop(1, "#ff7a3d");
  ctx.fillStyle = bar;
  roundRect(ctx, left, 272, 120, 6, 3);
  ctx.fill();

  // Two figures: which member, which server.
  const server = drawable(data.server, "เซิร์ฟเวอร์");
  drawText(ctx, data.leaving ? "อยู่กับเรา" : "สมาชิกคนที่", left, 322, { size: 18, color: "rgba(255,255,255,0.55)" });
  const number = data.leaving ? (data.leaving.days === null ? "—" : `${data.leaving.days.toLocaleString("en-US")} วัน`) : `#${data.count.toLocaleString("en-US")}`;
  const numberWidth = drawText(ctx, number, left, 368, { size: 46, weight: 800, color: "#ff5a68" });
  const second = left + Math.max(numberWidth, 110) + 44;
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillRect(second - 22, 322, 2, 50);
  drawText(ctx, "เซิร์ฟเวอร์", second, 322, { size: 18, color: "rgba(255,255,255,0.55)" });
  drawText(ctx, server, second, 366, { size: 32, weight: 600, maxWidth: 670 - second });

  // The avatar: a thick gradient ring, a thin outer ring and four corner ticks.
  const cx = 880;
  const cy = 200;
  const radius = 122;
  const outer = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  outer.addColorStop(0, "#ff7a3d");
  outer.addColorStop(0.5, "#ff2d3f");
  outer.addColorStop(1, "#7a0a18");
  ctx.strokeStyle = "rgba(255,90,100,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ff4d5e";
  [0, 90, 180, 270].forEach((deg) => {
    const rad = (deg * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(rad) * (radius + 30), cy + Math.sin(rad) * (radius + 30), 5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = outer;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#070304";
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.fill();
  const picture = await avatar(data.avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (picture) {
    if (data.leaving) ctx.filter = "grayscale(1) brightness(0.8)";
    ctx.drawImage(picture, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.filter = "none";
  } else {
    ctx.fillStyle = "#2a0f14";
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();

  return canvas.toBuffer("image/png");
}

// The panel pictures (status, boost, and the verify / ticket / roles banners) share one look taken
// from the NEXORA cover: near-black, cut corners, a thin red neon edge with HUD corners, and an
// orbit ring around the icon. The welcome and goodbye cards above have their own design.

const RED = "#ff2d3f";
const RED_SOFT = "#ff4d5e";
const ORANGE = "#ff7a3d";
const DEEP = "#8b0a1a";
const GREEN = "#3ddc97";

function hudBackground(ctx: SKRSContext2D, w: number, h: number) {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, "#030304");
  base.addColorStop(0.6, "#0d0508");
  base.addColorStop(1, "#1c070b");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const glow = (cx: number, cy: number, radius: number, color: string) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  glow(w * 0.08, h * 1.05, h * 1.4, `${RED}45`);
  glow(w * 0.96, -h * 0.1, h * 1.1, `${ORANGE}26`);
  // Faint scan lines.
  ctx.fillStyle = "rgba(255,255,255,0.022)";
  for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 1);
}

/** A box with two cut corners (top-left and bottom-right) and two small ones. */
function cutPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, cut: number, small = cut / 3) {
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - small, y);
  ctx.lineTo(x + w, y + small);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + small, y + h);
  ctx.lineTo(x, y + h - small);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
}

/** The frame: a cut-corner panel, a glowing red edge, bright brackets on two corners, and "///" on the top edge. */
function hudPanel(ctx: SKRSContext2D, w: number, h: number) {
  const x = 22;
  const y = 22;
  const pw = w - 44;
  const ph = h - 44;
  const cut = 36;
  const small = 12;
  cutPath(ctx, x, y, pw, ph, cut);
  ctx.fillStyle = "rgba(255,255,255,0.028)";
  ctx.fill();
  ctx.save();
  ctx.shadowColor = `${RED}aa`;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,60,75,0.6)";
  cutPath(ctx, x, y, pw, ph, cut);
  ctx.stroke();
  ctx.restore();
  const edge = ctx.createLinearGradient(x, 0, x + pw, 0);
  edge.addColorStop(0, DEEP);
  edge.addColorStop(0.5, RED);
  edge.addColorStop(1, ORANGE);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 4;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  ctx.beginPath();
  ctx.moveTo(x + pw - 90, y);
  ctx.lineTo(x + pw - small, y);
  ctx.lineTo(x + pw, y + small);
  ctx.lineTo(x + pw, y + 64);
  ctx.moveTo(x + 90, y + ph);
  ctx.lineTo(x + small, y + ph);
  ctx.lineTo(x, y + ph - small);
  ctx.lineTo(x, y + ph - 64);
  ctx.stroke();
  ctx.fillStyle = RED;
  for (let i = 0; i < 3; i += 1) {
    const sx = x + cut + 28 + i * 14;
    ctx.beginPath();
    ctx.moveTo(sx + 6, y - 5);
    ctx.lineTo(sx + 12, y - 5);
    ctx.lineTo(sx + 6, y + 7);
    ctx.lineTo(sx, y + 7);
    ctx.closePath();
    ctx.fill();
  }
}

/** The small caption on top of a title: a red bar and spaced capitals. */
function caption(ctx: SKRSContext2D, text: string, x: number, y: number) {
  ctx.fillStyle = RED;
  ctx.fillRect(x, y - 12, 34, 4);
  drawText(ctx, text, x + 50, y, { size: 20, weight: 600, color: RED_SOFT, letterSpacing: 9 });
}

function brandMark(ctx: SKRSContext2D, w: number) {
  drawText(ctx, "NEXORA CLOUD", w - 70, 78, { size: 15, weight: 600, align: "right", color: "rgba(255,255,255,0.32)", letterSpacing: 6 });
}

function star(ctx: SKRSContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.28;
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.closePath();
}

/** The icon inside an orbit: a dark disc, a thin ring with a bright arc that ends in a spark. */
function orbitBadge(ctx: SKRSContext2D, kind: BannerKind, cx: number, cy: number) {
  const aura = ctx.createRadialGradient(cx, cy, 30, cx, cy, 170);
  aura.addColorStop(0, `${RED}55`);
  aura.addColorStop(1, `${RED}00`);
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, 170, 0, Math.PI * 2);
  ctx.fill();
  const disc = ctx.createRadialGradient(cx, cy - 20, 6, cx, cy, 76);
  disc.addColorStop(0, "#32101a");
  disc.addColorStop(1, "#080305");
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, 76, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,70,85,0.5)";
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,70,85,0.22)";
  ctx.beginPath();
  ctx.arc(cx, cy, 94, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([3, 9]);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.arc(cx, cy, 110, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const arc = ctx.createLinearGradient(cx - 94, cy - 94, cx + 94, cy);
  arc.addColorStop(0, DEEP);
  arc.addColorStop(1, ORANGE);
  const from = (-165 * Math.PI) / 180;
  const to = (-35 * Math.PI) / 180;
  ctx.save();
  ctx.shadowColor = RED;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = arc;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, 94, from, to);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  star(ctx, cx + Math.cos(to) * 94, cy + Math.sin(to) * 94, 13);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.shadowColor = RED;
  ctx.shadowBlur = 14;
  drawIcon(ctx, kind, cx, cy, 36);
  ctx.restore();
}

// Status

export type StatusRow = { label: string; up: boolean; detail: string; latencyMs: number | null; uptime: number; history: boolean[] };

const thaiTime = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

export async function statusCard(rows: StatusRow[], title: string) {
  const w = 1100;
  const rowHeight = 118;
  const h = 250 + rows.length * rowHeight;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const allUp = rows.every((row) => row.up);
  const accent = allUp ? GREEN : RED_SOFT;
  hudBackground(ctx, w, h);
  hudPanel(ctx, w, h);

  caption(ctx, title.toUpperCase(), 64, 86);
  drawText(ctx, "สถานะระบบ", 64, 156, { size: 62, weight: 800 });
  const banner = allUp ? "ทุกระบบทำงานปกติ" : "พบระบบที่ใช้งานไม่ได้";
  const bannerWidth = textWidth(ctx, banner, 24, 600) + 74;
  const bx = w - 64 - bannerWidth;
  cutPath(ctx, bx, 96, bannerWidth, 52, 16, 6);
  ctx.fillStyle = `${accent}22`;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `${accent}bb`;
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 12;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(bx + 30, 122, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawText(ctx, banner, bx + 50, 131, { size: 24, weight: 600, color: accent });

  rows.forEach((row, index) => {
    const y = 190 + index * rowHeight;
    const color = row.up ? GREEN : RED_SOFT;
    cutPath(ctx, 56, y, w - 112, rowHeight - 16, 22, 8);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,70,85,0.22)";
    ctx.stroke();
    // A bar down the left edge in the row's colour, and the dot with its halo.
    ctx.fillStyle = color;
    ctx.fillRect(56, y + 26, 5, rowHeight - 16 - 52);
    ctx.fillStyle = `${color}33`;
    ctx.beginPath();
    ctx.arc(104, y + 51, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(104, y + 51, 10, 0, Math.PI * 2);
    ctx.fill();
    drawText(ctx, row.label, 148, y + 46, { size: 32, weight: 600, maxWidth: 300 });
    drawText(ctx, row.up ? row.detail || "ออนไลน์" : row.detail || "ล่ม", 148, y + 80, { size: 20, color: "rgba(255,255,255,0.6)", maxWidth: 300 });
    drawText(ctx, row.latencyMs === null ? "—" : `${row.latencyMs} ms`, 490, y + 62, { size: 30, weight: 600, align: "center", color: row.up ? "#ffffff" : color });
    drawText(ctx, "ตอบสนอง", 490, y + 90, { size: 17, align: "center", color: "rgba(255,255,255,0.5)" });
    drawText(ctx, `${row.uptime.toFixed(row.uptime === 100 ? 0 : 2)}%`, 640, y + 62, { size: 30, weight: 600, align: "center" });
    drawText(ctx, "uptime", 640, y + 90, { size: 17, align: "center", color: "rgba(255,255,255,0.5)" });
    // The last checks as small slanted bars, oldest to newest.
    const bars = row.history.slice(-30);
    const barWidth = 6;
    const gap = 4;
    const start = w - 56 - 30 - 30 * (barWidth + gap) + gap;
    for (let i = 0; i < 30; i += 1) {
      const sample = bars[i - (30 - bars.length)];
      const bar = start + i * (barWidth + gap);
      ctx.beginPath();
      ctx.moveTo(bar + 3, y + 26);
      ctx.lineTo(bar + 3 + barWidth, y + 26);
      ctx.lineTo(bar + barWidth, y + 72);
      ctx.lineTo(bar, y + 72);
      ctx.closePath();
      ctx.fillStyle = sample === undefined ? "rgba(255,255,255,0.1)" : sample ? GREEN : RED_SOFT;
      ctx.fill();
    }
    drawText(ctx, "30 ครั้งล่าสุด", start + 15 * (barWidth + gap), y + 90, { size: 17, align: "center", color: "rgba(255,255,255,0.5)" });
  });

  drawText(ctx, `อัปเดตล่าสุด ${thaiTime.format(new Date())} น.`, 64, h - 50, { size: 20, color: "rgba(255,255,255,0.6)" });
  drawText(ctx, "ตรวจทุก 30 วินาที · อัปเดตอัตโนมัติ", w - 64, h - 50, { size: 20, align: "right", color: "rgba(255,255,255,0.6)" });
  return canvas.toBuffer("image/png");
}

// Boost progress

export type BoostData = { server: string; level: number; boosts: number };

const TIERS = [0, 2, 7, 14];

export async function boostCard(data: BoostData) {
  const w = 1100;
  const h = 390;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  hudBackground(ctx, w, h);
  hudPanel(ctx, w, h);

  caption(ctx, "SERVER BOOST", 64, 86);
  drawText(ctx, `เลเวล ${data.level}`, 64, 170, { size: 78, weight: 800 });
  const next = TIERS[data.level + 1];
  const note = next === undefined ? "ถึงเลเวลสูงสุดแล้ว" : `อีก ${Math.max(next - data.boosts, 0)} บูสต์ถึงเลเวล ${data.level + 1}`;
  drawText(ctx, note, 64, 216, { size: 26, color: "rgba(255,255,255,0.75)", maxWidth: 600 });
  const number = ctx.createLinearGradient(w - 300, 0, w - 64, 0);
  number.addColorStop(0, ORANGE);
  number.addColorStop(1, RED);
  drawText(ctx, String(data.boosts), w - 64, 170, { size: 100, weight: 800, align: "right", color: number });
  drawText(ctx, "บูสต์ทั้งหมด", w - 64, 214, { size: 24, align: "right", color: "rgba(255,255,255,0.7)" });

  // One slanted cell for every boost up to the top level, a tick and a label at each level.
  const top = TIERS[TIERS.length - 1];
  const barX = 64;
  const barW = w - 128;
  const barY = 262;
  const barH = 36;
  const gap = 8;
  const skew = 10;
  const cell = (barW - skew - gap * (top - 1)) / top;
  const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  fill.addColorStop(0, DEEP);
  fill.addColorStop(0.5, RED);
  fill.addColorStop(1, ORANGE);
  for (let i = 0; i < top; i += 1) {
    const x = barX + i * (cell + gap);
    ctx.beginPath();
    ctx.moveTo(x + skew, barY);
    ctx.lineTo(x + skew + cell, barY);
    ctx.lineTo(x + cell, barY + barH);
    ctx.lineTo(x, barY + barH);
    ctx.closePath();
    if (i < data.boosts) {
      ctx.save();
      ctx.shadowColor = `${RED}99`;
      ctx.shadowBlur = 10;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,70,85,0.2)";
      ctx.stroke();
    }
  }
  TIERS.slice(1).forEach((tier, index) => {
    const reached = data.boosts >= tier;
    const last = index === TIERS.length - 2;
    const tx = barX + tier * (cell + gap) - gap / 2 + skew / 2;
    ctx.fillStyle = reached ? "#ffffff" : "rgba(255,255,255,0.35)";
    ctx.fillRect(tx - 1.5, barY + barH + 6, 3, 12);
    const labelX = last ? barX + barW : tx;
    const align = last ? "right" : "center";
    drawText(ctx, `เลเวล ${index + 1}`, labelX, barY + barH + 44, { size: 21, weight: 600, align, color: reached ? "#ffffff" : "rgba(255,255,255,0.55)" });
    drawText(ctx, `${tier} บูสต์`, labelX, barY + barH + 68, { size: 17, align, color: "rgba(255,255,255,0.5)" });
  });
  return canvas.toBuffer("image/png");
}

// Panel banners (verify, ticket, roles): the icon in its orbit, the title and one line under it.
// They never change, so each is drawn once.

export type BannerKind = "verify" | "ticket" | "roles";

const BANNERS: Record<BannerKind, { label: string; title: string; subtitle: string }> = {
  verify: { label: "VERIFY", title: "ยืนยันตัวตน", subtitle: "กดปุ่มด้านล่างเพื่อเข้าถึงทุกห้องในเซิร์ฟ" },
  ticket: { label: "SUPPORT", title: "ติดต่อทีมงาน", subtitle: "เปิด Ticket เพื่อคุยส่วนตัวกับทีมงาน" },
  roles: { label: "ROLES", title: "เช็คยศ", subtitle: "กดปุ่มด้านล่างเพื่อดูยศของคุณ" },
};

function drawIcon(ctx: SKRSContext2D, kind: BannerKind, cx: number, cy: number, size: number) {
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = size * 0.1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (kind === "verify") {
    // A shield with a check mark.
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size * 0.8, cy - size * 0.65);
    ctx.lineTo(cx + size * 0.8, cy + size * 0.05);
    ctx.quadraticCurveTo(cx + size * 0.7, cy + size * 0.65, cx, cy + size);
    ctx.quadraticCurveTo(cx - size * 0.7, cy + size * 0.65, cx - size * 0.8, cy + size * 0.05);
    ctx.lineTo(cx - size * 0.8, cy - size * 0.65);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.35, cy);
    ctx.lineTo(cx - size * 0.08, cy + size * 0.28);
    ctx.lineTo(cx + size * 0.4, cy - size * 0.28);
    ctx.stroke();
  } else if (kind === "roles") {
    // A crown.
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.9, cy + size * 0.55);
    ctx.lineTo(cx - size * 0.9, cy - size * 0.45);
    ctx.lineTo(cx - size * 0.45, cy + size * 0.05);
    ctx.lineTo(cx, cy - size * 0.7);
    ctx.lineTo(cx + size * 0.45, cy + size * 0.05);
    ctx.lineTo(cx + size * 0.9, cy - size * 0.45);
    ctx.lineTo(cx + size * 0.9, cy + size * 0.55);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.9, cy + size * 0.85);
    ctx.lineTo(cx + size * 0.9, cy + size * 0.85);
    ctx.stroke();
  } else {
    // A ticket with a notch on each side and a dashed tear line.
    const half = size * 0.95;
    const tall = size * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - tall);
    ctx.lineTo(cx + half, cy - tall);
    ctx.lineTo(cx + half, cy - size * 0.17);
    ctx.arc(cx + half, cy, size * 0.17, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(cx + half, cy + tall);
    ctx.lineTo(cx - half, cy + tall);
    ctx.lineTo(cx - half, cy + size * 0.17);
    ctx.arc(cx - half, cy, size * 0.17, Math.PI / 2, -Math.PI / 2, true);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([size * 0.12, size * 0.14]);
    ctx.beginPath();
    ctx.moveTo(cx + size * 0.28, cy - tall + size * 0.15);
    ctx.lineTo(cx + size * 0.28, cy + tall - size * 0.15);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = size * 0.08;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.6, cy - size * 0.12);
    ctx.lineTo(cx - size * 0.05, cy - size * 0.12);
    ctx.moveTo(cx - size * 0.6, cy + size * 0.14);
    ctx.lineTo(cx - size * 0.25, cy + size * 0.14);
    ctx.stroke();
  }
}

export async function bannerCard(kind: BannerKind) {
  const text = BANNERS[kind];
  const w = 1100;
  const h = 260;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  hudBackground(ctx, w, h);
  hudPanel(ctx, w, h);
  orbitBadge(ctx, kind, 170, h / 2);
  brandMark(ctx, w);
  caption(ctx, text.label, 320, 96);
  drawText(ctx, text.title, 320, 172, { size: 66, weight: 800, maxWidth: w - 320 - 110 });
  drawText(ctx, text.subtitle, 320, 216, { size: 25, color: "rgba(255,255,255,0.72)", maxWidth: w - 320 - 110 });
  // A row of ticks, like a gauge, in the bottom right corner.
  for (let i = 0; i < 14; i += 1) {
    ctx.fillStyle = `rgba(255,70,85,${0.55 - i * 0.035})`;
    ctx.fillRect(w - 230 + i * 12, h - 62 - (i % 3 === 0 ? 14 : 8), 3, i % 3 === 0 ? 14 : 8);
  }
  return canvas.toBuffer("image/png");
}

const bannerCache = new Map<BannerKind, Buffer>();

/** The banner as an attachment named `<kind>.png` (reference it as attachment://<kind>.png). */
export async function bannerFile(kind: BannerKind) {
  let picture = bannerCache.get(kind);
  if (!picture) {
    picture = await bannerCard(kind);
    bannerCache.set(kind, picture);
  }
  return new AttachmentBuilder(picture, { name: `${kind}.png` });
}
