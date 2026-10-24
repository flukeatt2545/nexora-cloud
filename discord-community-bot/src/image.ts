import path from "path";
import axios from "axios";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";
import { logBotError } from "./api";
import { unfancy } from "./style";

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
  const cleaned = unfancy(name).replace(/[^฀-๿A-Za-z0-9 ._\-'!?@#&()+*:~]/g, "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function background(ctx: SKRSContext2D, w: number, h: number, accents: [string, string, string]) {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, "#050506");
  base.addColorStop(0.55, "#15060a");
  base.addColorStop(1, "#2a0a0e");
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
  ctx.fillStyle = "rgba(255,90,100,0.06)";
  for (let gx = 20; gx < w; gx += 28) for (let gy = 20; gy < h; gy += 28) ctx.fillRect(gx, gy, 2, 2);
}

function glass(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,70,85,0.28)";
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
  drawText(ctx, "ยินดีต้อนรับ", left, 148, { size: 36, weight: 600, color: "#ff4d5e" });
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
  drawText(ctx, "สมาชิกคนที่", left, 322, { size: 18, color: "rgba(255,255,255,0.55)" });
  const number = `#${data.count.toLocaleString("en-US")}`;
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
  if (picture) ctx.drawImage(picture, cx - radius, cy - radius, radius * 2, radius * 2);
  else {
    ctx.fillStyle = "#2a0f14";
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.restore();

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
  const accent = allUp ? "#3ddc97" : "#ff4d5e";
  background(ctx, w, h, ["#ff2d3f", "#8b0a1a", "#ff7a3d"]);
  glass(ctx, 24, 24, w - 48, h - 48, 32);

  drawText(ctx, title.toUpperCase(), 64, 82, { size: 22, weight: 600, color: "#ff4d5e", letterSpacing: 8 });
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
    const color = row.up ? "#3ddc97" : "#ff4d5e";
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
      ctx.fillStyle = sample === undefined ? "rgba(255,255,255,0.1)" : sample ? "#3ddc97" : "#ff4d5e";
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
  background(ctx, w, h, ["#ff2d3f", "#8b0a1a", "#ff7a3d"]);
  glass(ctx, 24, 24, w - 48, h - 48, 32);

  drawText(ctx, "SERVER BOOST", 64, 82, { size: 22, weight: 600, color: "#ff4d5e", letterSpacing: 8 });
  drawText(ctx, `เลเวล ${data.level}`, 64, 160, { size: 64, weight: 800 });
  const next = TIERS[data.level + 1];
  const note = next === undefined ? "ถึงเลเวลสูงสุดแล้ว" : `อีก ${Math.max(next - data.boosts, 0)} บูสต์ถึงเลเวล ${data.level + 1}`;
  drawText(ctx, note, 64, 204, { size: 26, color: "rgba(255,255,255,0.75)", maxWidth: 600 });
  drawText(ctx, String(data.boosts), w - 64, 160, { size: 78, weight: 800, align: "right", color: "#ff6b78" });
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
    fill.addColorStop(0, "#8b0a1a");
    fill.addColorStop(0.5, "#ff2d3f");
    fill.addColorStop(1, "#ff7a3d");
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

// Panel banners (verify, ticket): a badge with a drawn icon, the title and one line under it.
// They never change, so each is drawn once.

export type BannerKind = "verify" | "ticket";

const BANNERS: Record<BannerKind, { label: string; title: string; subtitle: string }> = {
  verify: { label: "VERIFY", title: "ยืนยันตัวตน", subtitle: "กดปุ่มด้านล่างเพื่อเข้าถึงทุกห้องในเซิร์ฟ" },
  ticket: { label: "SUPPORT", title: "ติดต่อทีมงาน", subtitle: "เปิด Ticket เพื่อคุยส่วนตัวกับทีมงาน" },
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
  background(ctx, w, h, ["#ff2d3f", "#8b0a1a", "#ff7a3d"]);
  glass(ctx, 24, 24, w - 48, h - 48, 32);
  const edge = ctx.createLinearGradient(24, 0, w - 24, 0);
  edge.addColorStop(0, "#8b0a1a");
  edge.addColorStop(0.5, "#ff2d3f");
  edge.addColorStop(1, "#ff7a3d");
  ctx.fillStyle = edge;
  roundRect(ctx, 80, 24, w - 160, 4, 2);
  ctx.fill();
  ctx.lineWidth = 2;
  [[w - 80, 50, 140, 0.1], [w - 80, 50, 96, 0.08]].forEach(([rx, ry, rr, alpha]) => {
    ctx.strokeStyle = `rgba(255,70,85,${alpha})`;
    ctx.beginPath();
    ctx.arc(rx, ry, rr, 0, Math.PI * 2);
    ctx.stroke();
  });
  // The badge
  const bx = 160;
  const by = h / 2;
  const aura = ctx.createRadialGradient(bx, by, 40, bx, by, 150);
  aura.addColorStop(0, "rgba(255,45,63,0.4)");
  aura.addColorStop(1, "rgba(255,45,63,0)");
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(bx, by, 150, 0, Math.PI * 2);
  ctx.fill();
  const badge = ctx.createLinearGradient(bx - 80, by - 80, bx + 80, by + 80);
  badge.addColorStop(0, "#ff7a3d");
  badge.addColorStop(0.55, "#ff2d3f");
  badge.addColorStop(1, "#8b0a1a");
  ctx.fillStyle = badge;
  ctx.beginPath();
  ctx.arc(bx, by, 78, 0, Math.PI * 2);
  ctx.fill();
  drawIcon(ctx, kind, bx, by, 38);
  drawText(ctx, text.label, 290, 98, { size: 21, weight: 600, color: "#ff4d5e", letterSpacing: 9 });
  drawText(ctx, text.title, 290, 168, { size: 64, weight: 800, maxWidth: w - 290 - 90 });
  drawText(ctx, text.subtitle, 290, 212, { size: 25, color: "rgba(255,255,255,0.72)", maxWidth: w - 290 - 90 });
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
