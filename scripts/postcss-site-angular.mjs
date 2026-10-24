/*
 * PostCSS plugin for the angular look of the site themes (see app/site-angular.css).
 *
 * Class names across the site are all different, so guessing from the name leaves boxes rounded. This reads
 * the real rules instead: every rule that rounds a corner gets a twin that only applies while a site theme
 * is on (html[data-site-theme]) and squares it. Circles and pills (50%, 999px, anything past a small radius)
 * stay round, so avatars, dots, switches and spinners keep their shape without a list of names.
 */

// A corner bigger than this is a pill or a circle, not a rounded box.
const MAX_BOX_RADIUS_PX = 28;

const RADIUS_PROP = /^border(-(top|bottom)-(left|right)|-(start|end)-(start|end))?-radius$/;

function isBoxRadius(value) {
  const text = value.trim().toLowerCase();
  const v = text.replace(/\s*!important\s*$/, "");
  if (!v) return false;
  if (/^(0|0px|inherit|initial|unset|none|revert)$/.test(v)) return false;
  // A percentage is a circle or an ellipse, whatever the box.
  if (v.includes("%")) return false;
  // A radius variable (--radius, --bt-radius...) is a box corner; any other variable is not known, so it is left alone.
  if (v.includes("var(")) return /^var\(--[a-z0-9-]*radius[a-z0-9-]*\s*(,[^)]*)?\)$/.test(v);
  const lengths = [...v.matchAll(/(-?\d*\.?\d+)(px|rem|em)\b/g)];
  if (!lengths.length) return false;
  let any = false;
  for (const [, num, unit] of lengths) {
    const px = Number(num) * (unit === "px" ? 1 : 16);
    if (px > MAX_BOX_RADIUS_PX) return false;
    if (px > 0) any = true;
  }
  return any;
}

function themedSelector(selector) {
  const s = selector.trim();
  if (!s) return "";
  // Pieces that are not about one element (keyframe steps, the page root) are left alone.
  if (/^(from|to|\d+(\.\d+)?%)$/.test(s) || s.includes("&")) return "";
  if (/^(html|:root)\b/.test(s)) return s.replace(/^(html|:root)/, "html[data-site-theme]");
  return `html[data-site-theme] ${s}`;
}

function insideKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true;
  }
  return false;
}

const plugin = () => ({
  postcssPlugin: "site-angular",
  Once(root, { Rule }) {
    const file = root.source?.input?.file ?? "";
    if (file.includes("node_modules")) return;
    // The verify page and the theme sheets draw their own corners.
    if (/[\\/]verify[\\/]/.test(file) || /site-angular\.css$/.test(file)) return;

    const twins = [];
    root.walkRules((rule) => {
      if (insideKeyframes(rule)) return;
      const squared = [];
      rule.each((decl) => {
        if (decl.type === "decl" && RADIUS_PROP.test(decl.prop) && isBoxRadius(decl.value)) squared.push(decl.prop);
      });
      if (!squared.length) return;
      const selectors = rule.selectors.map(themedSelector).filter(Boolean);
      if (!selectors.length) return;
      twins.push({ rule, selectors, props: [...new Set(squared)] });
    });

    // Added after the walk so the twins are not walked themselves. Each goes right behind its own rule
    // (so a media query it sits in still applies), and a later plain rule can not undo it: it is !important.
    for (const { rule, selectors, props } of twins) {
      const twin = new Rule({ selectors });
      for (const prop of props) twin.append({ prop, value: "0", important: true });
      rule.after(twin);
    }
  },
});
plugin.postcss = true;

export default plugin;
