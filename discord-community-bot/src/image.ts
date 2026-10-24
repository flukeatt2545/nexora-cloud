import path from "path";
import axios from "axios";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { logBotError } from "./api";

// The pictures the bot posts: the welcome card, the status card and the boost progress card.
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
  const cleaned = name.replace(/[^฀-๿A-Za-z0-9 ._\-'!?@#&()+*:~]/g, "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function background(ctx: SKRSContext2D, w: number, h: number, accents: [string, string, string]) {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, "#080c1c");
  base.addColorStop(0.55, "#141238");
  base.addColorStop(1, "#0a2540");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // Soft glows.
  const glow = (cx: number, cy: number, radius: number, color: string) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  glow(w * 0.12, h * 0.1, h * 1.1, `${accents[0]}55`);
  glow(w * 0.92, h * 0.95, h * 1.2, `${accents[1]}44`);
  glow(w * 0.62, h * 0.05, h * 0.7, `${accents[2]}22`);
  // A fine dot grid.
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let gx = 20; gx < w; gx += 28) for (let gy = 20; gy < h; gy += 28) ctx.fillRect(gx, gy, 2, 2);
}

function glass(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.stroke();
}

function pill(ctx: SKRSContext2D, x: number, y: number, text: string, color: string, size = 22) {
  const width = textWidth(ctx, text, size, 600) + 36;
  roundRect(ctx, x, y, width, size + 20, (size + 20) / 2);
  ctx.fillStyle = `${color}33`;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `${color}99`;
  ctx.stroke();
  drawText(ctx, text, x + 18, y + size + 5, { size, weight: 600, color });
  return width;
}

async function avatar(url: string): Promise<Image | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 8000 });
    return await loadImage(Buffer.from(res.data));
  } catch (error) {
    logBotError("welcome avatar", error);
    return null;
  }
}

// Welcome

export type WelcomeData = { name: string; username: string; avatarUrl: string; server: string; count: number };

export async function welcomeCard(data: WelcomeData) {
  const w = 1100;
  const h = 420;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  background(ctx, w, h, ["#7c5cff", "#22d3ee", "#f472b6"]);

  // Frame and a bright edge on top.
  glass(ctx, 24, 24, w - 48, h - 48, 32);
  const edge = ctx.createLinearGradient(24, 0, w - 24, 0);
  edge.addColorStop(0, "#7c5cff");
  edge.addColorStop(0.5, "#22d3ee");
  edge.addColorStop(1, "#f472b6");
  ctx.fillStyle = edge;
  roundRect(ctx, 80, 24, w - 160, 4, 2);
  ctx.fill();

  // Avatar with a gradient ring and a soft glow.
  const cx = 230;
  const cy = h / 2;
  const radius = 112;
  const ring = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  ring.addColorStop(0, "#22d3ee");
  ring.addColorStop(0.5, "#7c5cff");
  ring.addColorStop(1, "#f472b6");
  const aura = ctx.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 1.9);
  aura.addColorStop(0, "rgba(124,92,255,0.45)");
  aura.addColorStop(1, "rgba(124,92,255,0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0b1020";
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
  ctx.fill();
  const picture = await avatar(data.avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (picture) ctx.drawImage(picture, cx - radius, cy - radius, radius * 2, radius * 2);
  else {
    ctx.fillStyle = "#1e2a55";
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();

  // Text
  const left = 400;
  const room = w - left - 70;
  // Rings on the right, for some depth.
  ctx.lineWidth = 2;
  [[w - 90, 70, 150, 0.1], [w - 90, 70, 105, 0.08], [w - 150, h - 40, 120, 0.08]].forEach(([rx, ry, rr, alpha]) => {
    ctx.strokeStyle = `rgba(167,139,250,${alpha})`;
    ctx.beginPath();
    ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.stroke();
  });
  drawText(ctx, "WELCOME", left, 126, { size: 22, weight: 600, color: "#22d3ee", letterSpacing: 9 });
  drawText(ctx, "ยินดีต้อนรับ", left, 204, { size: 66, weight: 800, color: "#ffffff", maxWidth: room });
  const name = drawable(data.name, drawable(data.username, "สมาชิกใหม่"));
  const nameGradient = ctx.createLinearGradient(left, 0, left + room, 0);
  nameGradient.addColorStop(0, "#a78bfa");
  nameGradient.addColorStop(1, "#f9a8d4");
  drawText(ctx, name, left, 272, { size: 50, weight: 600, color: nameGradient, maxWidth: room });
  const server = drawable(data.server, "เซิร์ฟเวอร์");
  drawText(ctx, `สู่ ${server}`, left, 316, { size: 26, weight: 400, color: "rgba(255,255,255,0.75)", maxWidth: room });
  pill(ctx, left, 334, `สมาชิกคนที่ ${data.count.toLocaleString("en-US")}`, "#22d3ee", 20);

  return canvas.toBuffer("image/png");
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
  const accent = allUp ? "#34d399" : "#fb7185";
  background(ctx, w, h, [allUp ? "#34d399" : "#fb7185", "#7c5cff", "#22d3ee"]);
  glass(ctx, 24, 24, w - 48, h - 48, 32);

  drawText(ctx, title.toUpperCase(), 64, 82, { size: 22, weight: 600, color: "#22d3ee", letterSpacing: 8 });
  drawText(ctx, "สถานะระบบ", 64, 154, { size: 60, weight: 800 });
  const banner = allUp ? "ทุกระบบทำงานปกติ" : "พบระบบที่ใช้งานไม่ได้";
  const bannerWidth = textWidth(ctx, banner, 24, 600) + 70;
  const bx = w - 64 - bannerWidth;
  roundRect(ctx, bx, 92, bannerWidth, 54, 27);
  ctx.fillStyle = `${accent}26`;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `${accent}aa`;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(bx + 30, 119, 8, 0, Math.PI * 2);
  ctx.fill();
  drawText(ctx, banner, bx + 50, 128, { size: 24, weight: 600, color: accent });

  rows.forEach((row, index) => {
    const y = 190 + index * rowHeight;
    const color = row.up ? "#34d399" : "#fb7185";
    glass(ctx, 56, y, w - 112, rowHeight - 16, 22);
    // Status dot with a halo
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
    // Response time
    drawText(ctx, row.latencyMs === null ? "—" : `${row.latencyMs} ms`, 490, y + 62, { size: 30, weight: 600, align: "center", color: row.up ? "#ffffff" : color });
    drawText(ctx, "ตอบสนอง", 490, y + 90, { size: 17, align: "center", color: "rgba(255,255,255,0.5)" });
    // Uptime
    drawText(ctx, `${row.uptime.toFixed(row.uptime === 100 ? 0 : 2)}%`, 640, y + 62, { size: 30, weight: 600, align: "center" });
    drawText(ctx, "uptime", 640, y + 90, { size: 17, align: "center", color: "rgba(255,255,255,0.5)" });
    // The last checks as small bars, oldest to newest.
    const bars = row.history.slice(-30);
    const barWidth = 6;
    const gap = 4;
    const start = w - 56 - 30 - 30 * (barWidth + gap) + gap;
    for (let i = 0; i < 30; i += 1) {
      const sample = bars[i - (30 - bars.length)];
      roundRect(ctx, start + i * (barWidth + gap), y + 26, barWidth, 46, 3);
      ctx.fillStyle = sample === undefined ? "rgba(255,255,255,0.1)" : sample ? "#34d399" : "#fb7185";
      ctx.fill();
    }
    drawText(ctx, "30 ครั้งล่าสุด", start + 15 * (barWidth + gap), y + 90, { size: 17, align: "center", color: "rgba(255,255,255,0.5)" });
  });

  drawText(ctx, `อัปเดตล่าสุด ${thaiTime.format(new Date())} น.`, 64, h - 50, { size: 20, color: "rgba(255,255,255,0.6)" });
  drawText(ctx, "ตรวจทุก 1 นาที · อัปเดตอัตโนมัติ", w - 64, h - 50, { size: 20, align: "right", color: "rgba(255,255,255,0.6)" });
  return canvas.toBuffer("image/png");
}

// Boost progress

export type BoostData = { server: string; level: number; boosts: number };

const TIERS = [0, 2, 7, 14];

export async function boostCard(data: BoostData) {
  const w = 1100;
  const h = 360;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  background(ctx, w, h, ["#f472b6", "#7c5cff", "#22d3ee"]);
  glass(ctx, 24, 24, w - 48, h - 48, 32);

  drawText(ctx, "SERVER BOOST", 64, 82, { size: 22, weight: 600, color: "#f472b6", letterSpacing: 8 });
  drawText(ctx, `เลเวล ${data.level}`, 64, 160, { size: 64, weight: 800 });
  const next = TIERS[data.level + 1];
  const note = next === undefined ? "ถึงเลเวลสูงสุดแล้ว" : `อีก ${Math.max(next - data.boosts, 0)} บูสต์ถึงเลเวล ${data.level + 1}`;
  drawText(ctx, note, 64, 204, { size: 26, color: "rgba(255,255,255,0.75)", maxWidth: 600 });
  drawText(ctx, String(data.boosts), w - 64, 160, { size: 78, weight: 800, align: "right", color: "#f9a8d4" });
  drawText(ctx, "บูสต์ทั้งหมด", w - 64, 200, { size: 24, align: "right", color: "rgba(255,255,255,0.7)" });

  // One bar from 0 to the top tier, with a tick for each level.
  const barX = 64;
  const barW = w - 128 - 50;
  const barY = 248;
  const barH = 26;
  const top = TIERS[TIERS.length - 1];
  const pos = (boosts: number) => barX + (Math.min(boosts, top) / top) * barW;
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fill();
  if (data.boosts > 0) {
    const fillW = Math.max(pos(data.boosts) - barX, barH);
    const fill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    fill.addColorStop(0, "#22d3ee");
    fill.addColorStop(0.5, "#7c5cff");
    fill.addColorStop(1, "#f472b6");
    ctx.save();
    roundRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(barX, barY, fillW, barH);
    ctx.restore();
  }
  TIERS.slice(1).forEach((tier, index) => {
    const tx = pos(tier);
    const reached = data.boosts >= tier;
    ctx.fillStyle = reached ? "#ffffff" : "rgba(255,255,255,0.35)";
    ctx.fillRect(tx - 1.5, barY - 8, 3, barH + 16);
    drawText(ctx, `เลเวล ${index + 1}`, tx, barY + barH + 38, { size: 20, weight: 600, align: "center", color: reached ? "#ffffff" : "rgba(255,255,255,0.55)" });
    drawText(ctx, `${tier} บูสต์`, tx, barY + barH + 62, { size: 17, align: "center", color: "rgba(255,255,255,0.5)" });
  });
  return canvas.toBuffer("image/png");
}
