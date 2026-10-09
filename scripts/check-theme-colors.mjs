#!/usr/bin/env node
// Theme colour guard.
//
// The brand colour is chosen in the admin settings (applyThemeColor sets --primary and
// --primary-rgb at runtime), and light/dark mode swaps the surface, text and --danger tokens
// in app/theme.css. Any colour written straight into a component rule ignores both, which is
// how light mode kept showing pink panels and red text on a green-themed site.
//
// This script finds hard-coded reds and blues in app CSS and says which token to use instead:
//   - reds in rules about errors, deleting, failures and the like  → var(--danger) / --danger-rgb
//   - other reds and blues (brand accents, highlights, tints)      → var(--primary) and friends
//   - blues that mean something (info, Word files, other brands)   → left alone
// Custom property definitions ("--x: #...") are where literal colours belong and are skipped.
// Mark a deliberate exception with a comment on the same line: /* theme-ok */
//
//   node scripts/check-theme-colors.mjs          report, exit 1 if anything is found
//   node scripts/check-theme-colors.mjs --fix    rewrite to theme tokens

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = join(ROOT, "app");
const FIX = process.argv.includes("--fix");

// Rules whose selector mentions one of these are about something going wrong or being
// destroyed, so their red is semantic and must stay red whatever the brand colour is.
const DANGER_WORDS = /danger|error|invalid|delete|remove|destructive|destroy|fail|reject|refund|logout|log-out|sign-out|ban|block|offline|stop|required|trash|critical|expired|revoke|lockdown|alert|warn|down|unhealthy|crash|kill|unbind|disconnect|leave|cancel|deny|denied|forbidden|is-short|is-out|is-error|soldout|sold-out|negative|minus|deduct|spent|clear-secret|toast\.error|\.bad\b|\.err\b|missing|suspend|stderr|-del\b|bounced|outcome\.failure|confirm-icon|cover-current|bulk|notice-modal\.e|\.req\b|label b\b|title b\b|member-list button|upload-status button/i;

// Fixed palette colours that mean something on their own (a PDF is red, a "rose" stat icon is
// rose) are neither brand nor danger and are left alone.
const KEEP_WORDS = /pdf|rose|ruby|youtube|gmail|google|log-category-icon/i;

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    const info = statSync(path);
    if (info.isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}

function hsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: h * 60, s, l };
}

// A red hue that is clearly saturated, including the pale pink tints (#fff8f8) light mode
// used as "warm white".
function isRed(c) {
  const { h, s, l } = hsl(c);
  if (!(h <= 14 || h >= 346) || c.r - Math.max(c.g, c.b) < 5) return false;
  if (l > 0.9) return c.r - c.g >= 4;
  return s >= 0.45;
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g;

function parse(token) {
  if (token.startsWith("#")) return [4, 5, 7, 9].includes(token.length) ? hexToRgb(token) : null;
  const n = token.match(/[\d.]+%?/g).map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v)));
  return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}

function replacement(c, danger) {
  const { l } = hsl(c);
  const alpha = round(c.a);
  const base = danger ? "danger" : "primary";
  if (l > 0.9) {
    // Pale tint over white: how far green/blue dropped tells how much red was mixed in.
    const pct = Math.max(1, Math.round(((255 - Math.min(c.g, c.b)) / 239) * 100));
    const tint = `color-mix(in srgb, var(--${base}) ${pct}%, #fff)`;
    // Translucent warm white (fades, washes): keep it white, just tinted by the theme colour.
    return alpha < 1 ? `color-mix(in srgb, ${tint} ${Math.round(alpha * 100)}%, transparent)` : tint;
  }
  if (l < 0.18 && alpha < 1) {
    // A translucent near-black (shadows, scrims): the faint red tint carries no meaning.
    return `rgb(0 0 0 / ${alpha})`;
  }
  if (l < 0.18) {
    // Very dark red-tinted surface: the colour mixed into near-black.
    const pct = Math.max(4, Math.min(40, Math.round((c.r - Math.max(c.g, c.b)) / 2.4)));
    return `color-mix(in srgb, var(--${base}) ${pct}%, #08090d)`;
  }
  if (alpha < 1) return `rgb(var(--${base}-rgb) / ${alpha})`;
  if (danger) return "var(--danger)";
  return l < 0.36 ? "var(--primary-ink)" : "var(--primary)";
}

// Selector of the rule that contains `offset` (text between the previous "}"/"{" and the
// "{" that opens the current block).
function selectorAt(text, offset) {
  const open = text.lastIndexOf("{", offset);
  if (open < 0 || text.lastIndexOf("}", offset) > open) return "";
  const start = Math.max(text.lastIndexOf("}", open), text.lastIndexOf("{", open - 1), text.lastIndexOf(";", open)) + 1;
  return text.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
}

let found = 0;
const report = [];
for (const file of cssFiles(APP)) {
  const text = readFileSync(file, "utf8");
  let out = "";
  let last = 0;
  for (const match of text.matchAll(COLOR)) {
    const token = match[0];
    const offset = match.index;
    const lineStart = text.lastIndexOf("\n", offset) + 1;
    const lineEnd = text.indexOf("\n", offset);
    const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if (line.includes("theme-ok")) continue;
    const declStart = Math.max(text.lastIndexOf(";", offset), text.lastIndexOf("{", offset), text.lastIndexOf("}", offset), lineStart - 1) + 1;
    if (/^\s*--[\w-]+\s*:/.test(text.slice(declStart, offset))) continue;
    const c = parse(token);
    if (!c || !isRed(c)) continue;
    const selector = selectorAt(text, offset);
    if (KEEP_WORDS.test(selector)) continue;
    const danger = DANGER_WORDS.test(selector) || /danger|error/i.test(text.slice(declStart, offset));
    const next = replacement(c, danger);
    found++;
    const lineNo = text.slice(0, offset).split("\n").length;
    report.push(`${relative(ROOT, file)}:${lineNo}  ${token}  →  ${next}${danger ? "  (danger)" : ""}   ${selector.slice(0, 70)}`);
    if (FIX) {
      out += text.slice(last, offset) + next;
      last = offset + token.length;
    }
  }
  if (FIX && last > 0) writeFileSync(file, out + text.slice(last));
}

// Sky and blue were the other "default accent": the file library, date picker and admin tools
// were styled blue before the brand colour became a setting, so they stayed blue on a red or
// green site. Blue that means something keeps its colour: info notices (--info-ink), a Word
// document, the login category in the logs, image file types, other brands (Discord, Google)
// and previews that copy their look, and the indigo that marks "system" items. The error screen
// can render without app/theme.css (global-error replaces the root layout), so it keeps literals.
const BLUE_KEEP_WORDS = /info|\.word\b|log-category-icon|sch-icon\.login|\.image\b|discord|dsc-|google|og-|indigo|violet|is-system|\.system\b|nexora-error-screen/i;
// Fallbacks of brand tokens are never used (the tokens are always defined) but still read as
// "this is blue", so they go too. --info-ink fallbacks are the dark-mode info colour: kept.
const BRAND_FALLBACK = /var\(\s*(--(?:primary|primary-ink|primary-hover|primary-soft|primary-border|primary-subtle|primary-text|primary-color|primary-glow))\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*\)/g;
function isBlue(c) {
  const { h, s, l } = hsl(c);
  if (h < 190 || h > 226 || s < 0.45 || l < 0.25) return false;
  return l > 0.9 ? c.b - c.r >= 8 : c.b - c.r >= 40;
}
function blueReplacement(c) {
  const { l } = hsl(c);
  const alpha = round(c.a);
  if (alpha < 1) return `rgb(var(--primary-rgb) / ${alpha})`;
  if (l > 0.9) return `color-mix(in srgb, var(--primary) ${Math.max(1, Math.round(((255 - Math.min(c.r, c.g)) / 239) * 100))}%, #fff)`;
  return l < 0.36 ? "var(--primary-ink)" : "var(--primary)";
}
let blueFound = 0;
const blueReport = [];
for (const file of cssFiles(APP)) {
  const original = readFileSync(file, "utf8");
  const text = original.replace(BRAND_FALLBACK, (whole, token, fallback, offset) => {
    const c = parse(fallback);
    if (!c || !isBlue(c)) return whole;
    blueFound++;
    if (!FIX) blueReport.push(`${relative(ROOT, file)}:${original.slice(0, offset).split("\n").length}  ${whole}  →  var(${token})`);
    return `var(${token})`;
  });
  let out = "";
  let last = 0;
  for (const match of text.matchAll(COLOR)) {
    const token = match[0];
    const offset = match.index;
    const lineStart = text.lastIndexOf("\n", offset) + 1;
    const lineEnd = text.indexOf("\n", offset);
    if (text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).includes("theme-ok")) continue;
    const declStart = Math.max(text.lastIndexOf(";", offset), text.lastIndexOf("{", offset), text.lastIndexOf("}", offset), lineStart - 1) + 1;
    const before = text.slice(declStart, offset);
    // A fallback inside var(--token, …) belongs to that token (brand fallbacks went above).
    if (/^\s*--[\w-]+\s*:/.test(before) || /var\(\s*--[\w-]+\s*,\s*$/.test(before)) continue;
    const c = parse(token);
    if (!c || !isBlue(c)) continue;
    // Near-white with a cool cast (#e8edf7) as a text colour is "light text", not a blue tint.
    if (hsl(c).l > 0.9 && /^\s*color\s*:/.test(before)) continue;
    const selector = selectorAt(text, offset);
    if (BLUE_KEEP_WORDS.test(selector)) continue;
    const next = blueReplacement(c);
    blueFound++;
    blueReport.push(`${relative(ROOT, file)}:${text.slice(0, offset).split("\n").length}  ${token}  →  ${next}   ${selector.slice(0, 70)}`);
    out += text.slice(last, offset) + next;
    last = offset + token.length;
  }
  const result = last > 0 ? out + text.slice(last) : text;
  if (FIX && result !== original) writeFileSync(file, result);
}
if (FIX && blueFound) console.log(`Rewrote ${blueFound} hard-coded blue(s) to theme tokens.`);
if (!FIX && blueReport.length) {
  console.log(blueReport.join("\n"));
  console.log(`\n${blueReport.length} hard-coded blue(s). Brand accents use var(--primary) and friends; mark a meaningful blue with /* theme-ok */ or run with --fix.`);
  process.exitCode = 1;
}

// Status colours used as text (amber, green, sky, violet) are tuned for dark backgrounds and
// fade to unreadable on white. Route them through a per-mode "ink" token with the original
// colour as the fallback: dark mode keeps it exactly (the token is only defined for light
// mode in app/theme.css), light mode gets a darker shade that reads on white.
const INK = [
  { token: "--warning-ink", from: 28, to: 55 },
  { token: "--success-ink", from: 90, to: 170 },
  { token: "--info-ink", from: 185, to: 240 },
  { token: "--violet-ink", from: 250, to: 300 },
];
// Areas that stay dark in both modes keep their light text: code and terminals, embeds that
// copy another app's look, and text laid over pictures.
const ALWAYS_DARK = /code|terminal|console|cm-|hljs|token|editor|log-line|runtime-log|stdout|stderr|\bpre\b|monaco|snippet|dsc-|discord-preview|og-discord|og-preview|overlay|caption|banner|hero|lightbox|player|tooltip|toast|backdrop|scrim|on-image|thumb|cover|data-theme="dark"|data-theme="light"/i;
const inkReport = [];
let inkFixed = 0;
// Light neutral text (light greys, translucent white) is the dark-mode way of writing "text"
// and "muted text"; on white it all but disappears. Pure white is left alone: it is almost
// always text on a coloured button or badge.
function neutralInk(c) {
  const { h, s, l } = hsl(c);
  if (c.a < 1 && Math.min(c.r, c.g, c.b) >= 200) return c.a >= 0.75 ? "--strong-ink" : "--soft-ink";
  // Tailwind's slate greys (#e2e8f0, #cbd5e1, #94a3b8) carry a blue cast that pushes their
  // saturation past 0.3, but they are still "light text" and vanish on white just the same.
  const coolGrey = s < 0.5 && h >= 190 && h <= 230;
  if (c.a < 1 || (s >= 0.3 && !coolGrey) || l < 0.6 || l >= 0.99) return null;
  return l >= 0.85 ? "--strong-ink" : "--soft-ink";
}
// A rule that paints its own dark or coloured fill (a solid button, a badge) keeps its light
// text in every mode, so its colour must not follow the page.
function ownsFill(text, offset) {
  const open = text.lastIndexOf("{", offset);
  const close = text.indexOf("}", offset);
  const body = text.slice(open + 1, close < 0 ? undefined : close);
  for (const m of body.matchAll(/(?:^|[;\s])background(?:-color|-image)?\s*:\s*([^;]+)/g)) {
    const value = m[1];
    if (/var\(--(primary|brand|danger|success|warning|discord)|gradient\(/.test(value)) return true;
    for (const token of value.match(COLOR) || []) {
      const c = parse(token);
      if (!c || c.a < 0.6) continue;
      const lum = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      if (0.2126 * lum(c.r) + 0.7152 * lum(c.g) + 0.0722 * lum(c.b) < 0.4) return true;
    }
  }
  return false;
}
for (const file of cssFiles(APP)) {
  if (file.endsWith(join("app", "theme.css"))) continue;
  const text = readFileSync(file, "utf8");
  let changed = false;
  const next = text.replace(/((?:^|[;{\s])color\s*:\s*)(#[0-9a-fA-F]{6}(?![0-9a-fA-F])|#[0-9a-fA-F]{3}(?![0-9a-fA-F])|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[\d.]+\s*\))/g, (whole, prefix, hex, offset) => {
    const lineStart = text.lastIndexOf("\n", offset) + 1;
    if (text.slice(lineStart, text.indexOf("\n", offset)).includes("theme-ok")) return whole;
    const selector = selectorAt(text, offset + prefix.length);
    if (ALWAYS_DARK.test(selector) || ownsFill(text, offset)) return whole;
    const c = parse(hex);
    if (!c) return whole;
    const { h, s, l } = hsl(c);
    const neutral = neutralInk(c);
    let ink = neutral ? { token: neutral } : null;
    if (!ink) {
      if (c.a < 1 || s < 0.4 || l < 0.3 || l > 0.85) return whole;
      const lum = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      const onWhite = 1.05 / (0.2126 * lum(c.r) + 0.7152 * lum(c.g) + 0.0722 * lum(c.b) + 0.05);
      if (onWhite >= 3) return whole;
      ink = INK.find((k) => h >= k.from && h <= k.to);
    }
    if (!ink) return whole;
    if (FIX) {
      inkFixed++;
      changed = true;
      return `${prefix}var(${ink.token}, ${hex})`;
    }
    inkReport.push(`${relative(ROOT, file)}:${text.slice(0, offset).split("\n").length}  color: ${hex}  →  var(${ink.token}, ${hex})   ${selector.slice(0, 60)}`);
    return whole;
  });
  // Areas that stay dark keep their original colour even if an earlier run wrapped it.
  const unwrapped = next.replace(/(color\s*:\s*)var\((--(?:warning|success|info|violet|strong|soft)-ink), (#[0-9a-fA-F]{3,6}|rgba\([^)]*\))\)/g, (whole, prefix, token, hex, offset) => {
    if (!ALWAYS_DARK.test(selectorAt(next, offset + prefix.length)) && !(/--(strong|soft)-ink/.test(token) && ownsFill(next, offset))) return whole;
    if (next.slice(next.lastIndexOf("\n", offset) + 1, next.indexOf("\n", offset)).includes("theme-ok")) return whole;
    if (!FIX) inkReport.push(`${relative(ROOT, file)}:${next.slice(0, offset).split("\n").length}  var(${token}, ${hex})  →  ${hex} (always-dark area)`);
    changed = true;
    return `${prefix}${hex}`;
  });
  if (FIX && changed) writeFileSync(file, unwrapped);
}
if (FIX && inkFixed) console.log(`Routed ${inkFixed} status text colour(s) through light-mode ink tokens.`);
if (!FIX && inkReport.length) {
  console.log(inkReport.join("\n"));
  console.log(`\n${inkReport.length} status text colour(s) unreadable on white. Use var(--warning-ink|--success-ink|--info-ink|--violet-ink, <colour>) or run with --fix.`);
  process.exitCode = 1;
}

// Variables that are used but never defined. var(--x, #e8edf7) then always takes its
// fallback, which was written for dark mode, so light mode silently gets dark-mode colours.
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(css|tsx?|mjs)$/.test(name)) out.push(path);
  }
  return out;
}
// A variable defined in theme.css or on :root/html/body/[data-theme] reaches every page.
// One defined on some component selector only reaches that component, so it counts only
// for uses in the same stylesheet (a gallery-only --surface-2 does not help the mail pages).
const GLOBAL_SELECTOR = /^(:root|html|body|\[data-theme(="(light|dark)")?\])(\s*,\s*(:root|html|body|\[data-theme(="(light|dark)")?\]))*$/;
const defined = new Set();
const definedIn = new Map();
const uses = [];
for (const file of sourceFiles(APP)) {
  const text = readFileSync(file, "utf8");
  const isCss = file.endsWith(".css");
  const isTheme = file.endsWith(join("app", "theme.css"));
  for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) {
    if (!isCss || isTheme || GLOBAL_SELECTOR.test(selectorAt(text, m.index))) defined.add(m[1]);
    else {
      if (!definedIn.has(m[1])) definedIn.set(m[1], new Set());
      definedIn.get(m[1]).add(file);
    }
  }
  // Set from scripts or style objects: setProperty("--x", …), { "--x": … }, `--x`.
  if (!isCss) for (const m of text.matchAll(/["'`](--[\w-]+)["'`]/g)) defined.add(m[1]);
  if (!isCss) continue;
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) uses.push({ name: m[1], file, offset: m.index, text });
}
const undefinedVars = new Map();
for (const use of uses) {
  if (defined.has(use.name) || definedIn.get(use.name)?.has(use.file)) continue;
  const lineStart = use.text.lastIndexOf("\n", use.offset) + 1;
  if (use.text.slice(lineStart, use.text.indexOf("\n", use.offset)).includes("theme-ok")) continue;
  const line = use.text.slice(0, use.offset).split("\n").length;
  if (!undefinedVars.has(use.name)) undefinedVars.set(use.name, `${relative(ROOT, use.file)}:${line}`);
}

if (process.argv.includes("--verbose") || !FIX) console.log(report.join("\n"));
if (undefinedVars.size) {
  console.log(`\nUndefined CSS variables (their dark-mode fallbacks leak into light mode); define them in app/theme.css:`);
  for (const [name, where] of undefinedVars) console.log(`  ${name}  first used at ${where}`);
  if (!FIX) process.exitCode = 1;
}
if (FIX) {
  console.log(`Rewrote ${found} hard-coded red(s) to theme tokens.`);
} else if (found) {
  console.log(`\n${found} hard-coded red(s). Use var(--primary)/var(--primary-ink)/rgb(var(--primary-rgb) / a) for brand colour, var(--danger)/rgb(var(--danger-rgb) / a) for errors, or run with --fix.`);
  process.exit(1);
} else {
  console.log(blueFound && !FIX ? "No hard-coded reds found." : "No hard-coded reds or blues found.");
}
