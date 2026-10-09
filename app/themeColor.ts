const HEX_COLOR = /^#?([0-9a-f]{6})$/i;

/**
 * CSS variables for a brand colour, for both modes. app/theme.css maps them onto --primary,
 * --primary-rgb and --primary-hover per [data-theme], so the brand never overrides a mode.
 * Light mode gets the colour darkened until it reads on white with some margin for the grey page
 * background (5.2:1 on white keeps 4.5:1 on the grey, which WCAG asks); a bright brand
 * such as #18cc00 would otherwise be unreadable as text or icons there.
 *
 * Self-contained on purpose: layout.tsx inlines its source to apply the saved colour before
 * the first paint, so it may not reference anything outside its own body.
 */
export function brandVariables(hex: string): Record<string, string> | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  const rgb = [value >> 16, (value >> 8) & 255, value & 255];
  const toHex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const mix = (c: number[], target: number, amount: number) => c.map((v) => v + (target - v) * amount);
  const channel = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  const onWhite = (c: number[]) => 1.05 / (luminance(c) + 0.05);
  let light = rgb;
  for (let step = 0; step < 15 && onWhite(light) < 5.2; step++) light = mix(rgb, 0, (step + 1) * 0.04);
  const vars: Record<string, string> = {
    "--brand": toHex(rgb),
    "--brand-rgb": rgb.join(" "),
    "--brand-hover": toHex(mix(rgb, 0, 0.12)),
    "--brand-light": toHex(light),
    "--brand-light-rgb": light.map(Math.round).join(" "),
    "--brand-light-hover": toHex(mix(light, 0, 0.14)),
  };
  return vars;
}

// persist: false previews a colour (the settings page) without caching it for the next page load.
export function applyThemeColor(input?: string, persist = true) {
  if (typeof document === "undefined") return;
  const match = input?.trim().match(HEX_COLOR);
  if (!match) return;

  const primary = `#${match[1].toLowerCase()}`;
  const vars = brandVariables(primary);
  if (!vars) return;
  const root = document.documentElement;
  // Earlier versions wrote --primary and friends here, which pinned one colour on both modes.
  for (const name of ["--primary", "--primary-hover", "--primary-rgb", "--primary-glow", "--primary-border", "--border", "--dash-line"]) {
    root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  if (!persist) return;

  try {
    window.localStorage.setItem("nexora-primary", primary);
  } catch {
    // ignore storage failures
  }
}
