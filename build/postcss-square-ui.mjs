/*
 * Square UI (html[data-ui="square"], picked by the admin; see app/uiShape.ts).
 *
 * The site's 1,500-odd rounded corners are written as literal radii all over app/**.css, so
 * instead of a hand-kept list this PostCSS step adds, right after every rule that sets a radius,
 * a twin rule that only applies in square mode:
 *
 *   .card { border-radius: 14px }
 *   :root[data-ui="square"] .card { border-radius: 0 var(--ui-cut-m) 0 0 !important; ... }
 *
 * Lengths become cut corners like the verify page's card (top-right and bottom-left bevelled,
 * the other two square); the cut sizes are tokens in app/ui-square.css, 0 where the browser has
 * no corner-shape. Percentages (circles: avatars, dots, spinners) stay as they are. Every
 * radius rule gets a twin, zeros included, and the twin is one step more specific than its
 * original, so the twins override each other in the same order the originals did.
 */

const RADIUS = /^border-(?:radius|(?:top|bottom)-(?:left|right)-radius|(?:start|end)-(?:start|end)-radius)$/;
const SCOPE = ':root[data-ui="square"]';
// Already the square look, or not ours.
const SKIP_FILE = /\/app\/verify\//;
const KEYWORD = /^(?:inherit|initial|unset|revert|revert-layer)$/i;

// Which corner each longhand is. "cut" corners (top right, bottom left) are bevelled, the rest go square.
const CORNER = {
  "border-top-left-radius": "flat",
  "border-top-right-radius": "cut",
  "border-bottom-right-radius": "flat",
  "border-bottom-left-radius": "cut",
  "border-start-start-radius": "flat",
  "border-start-end-radius": "cut",
  "border-end-end-radius": "flat",
  "border-end-start-radius": "cut",
};

/** Splits on whitespace outside brackets, so calc(1px + 2px) stays one value. */
function words(value) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const char of value.trim()) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (/\s/.test(char) && depth === 0) {
      if (current) out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) out.push(current);
  return out;
}

/** The size of cut a corner of this radius gets. */
function cut(value) {
  const v = value.trim();
  if (KEYWORD.test(v)) return v;
  const match = /^(-?[\d.]+)(px|rem|em)?$/i.exec(v);
  if (!match) return "var(--ui-cut-m)"; // var(), calc(): a card-sized cut
  const px = Number(match[1]) * (match[2] && match[2].toLowerCase() !== "px" ? 16 : 1);
  if (px < 5) return "0";
  if (px < 8) return "var(--ui-cut-xs)"; // checkboxes, tags
  if (px < 12) return "var(--ui-cut-s)";
  if (px < 18) return "var(--ui-cut-m)";
  if (px < 90) return "var(--ui-cut-l)";
  return "var(--ui-cut-s)"; // 999px pills are small chips and switches
}

const corner = (kind, value) => (KEYWORD.test(value.trim()) ? value.trim() : kind === "cut" ? cut(value) : "0");

/** The square-mode value for one radius declaration, or null to keep it as written (circles). */
function squared(prop, value) {
  const main = value.split("/")[0];
  if (main.includes("%")) return null;
  if (prop !== "border-radius") return corner(CORNER[prop], words(main)[0] || "0");
  const parts = words(main);
  if (parts.length === 1 && KEYWORD.test(parts[0])) return parts[0];
  const [tl, tr = tl, br = tl, bl = tr] = parts;
  const out = [corner("flat", tl), corner("cut", tr), corner("flat", br), corner("cut", bl)];
  return out.every((value) => value === "0") ? "0" : out.join(" ");
}

/** Index where the first top-level combinator starts, or the end of the selector. */
function firstCompoundEnd(selector) {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\\") { i += 1; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(char)) return i;
  }
  return selector.length;
}

/** The selector limited to square mode. Selectors that start at the root element get the attribute on it. */
function scoped(selector, boost) {
  const tag = boost ? `${SCOPE}:not(#\\#)` : SCOPE;
  const s = selector.trim();
  const end = firstCompoundEnd(s);
  const head = s.slice(0, end);
  if (/^html(?![\w-])/i.test(head)) return `html[data-ui="square"]${boost ? ":not(#\\#)" : ""}${s.slice(4)}`;
  if (/^:root(?![\w-])/i.test(head)) return `${tag}${s.slice(5)}`;
  if (/^\[data-theme\b/i.test(head)) return `[data-ui="square"]${boost ? ":not(#\\#)" : ""}${s}`;
  return `${tag} ${s}`;
}

function insideKeyframesOrBase(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type !== "atrule") continue;
    if (/keyframes$/i.test(parent.name)) return true;
    // Tailwind's preflight resets buttons and inputs to 0 in @layer base; leave it alone.
    if (parent.name === "layer" && /^base\b/.test(parent.params)) return true;
  }
  return false;
}

export default function squareUi() {
  return {
    postcssPlugin: "nexora-square-ui",
    OnceExit(root, { Rule, Declaration }) {
      const file = (root.source?.input?.file || "").replace(/\\/g, "/");
      if (!file.includes("/app/") || SKIP_FILE.test(file)) return;
      root.walkRules((rule) => {
        if (rule.selector.includes('[data-ui="square"]') || insideKeyframesOrBase(rule)) return;
        const decls = rule.nodes.filter((node) => node.type === "decl" && RADIUS.test(node.prop));
        if (!decls.length) return;
        // Originally !important declarations get an id-level boost so they still beat the others.
        for (const important of [false, true]) {
          const group = decls.filter((decl) => Boolean(decl.important) === important);
          if (!group.length) continue;
          const twin = new Rule({ selectors: rule.selectors.map((selector) => scoped(selector, important)) });
          let round = false;
          let cornered = false;
          for (const decl of group) {
            const value = squared(decl.prop, decl.value);
            if (value === null) round = true;
            else if (!/^0( 0)*$/.test(value)) cornered = true;
            twin.append(new Declaration({ prop: decl.prop, value: value ?? decl.value, important: true }));
          }
          // A circle that also matches a bevelled rule would turn into a diamond: say which shape wins.
          if (round || cornered) twin.append(new Declaration({ prop: "corner-shape", value: round ? "round" : "bevel", important: true }));
          rule.after(twin);
        }
      });
    },
  };
}
squareUi.postcss = true;
