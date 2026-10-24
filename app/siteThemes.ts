import { brandVariables } from "./themeColor";

/**
 * The site's themes (only Halloween for now; add one here, in SiteScene.tsx and in backend/site_theme.go). The admin picks one on the settings page, or sets date
 * ranges in which one is on by itself (backend/site_theme.go); /api/settings/public says which is on
 * today as `theme`. A theme sets the colour mode and brand colour for the whole site, tints the
 * surfaces (app/site-themes.css) and draws a scene behind every page (app/SiteScene.tsx).
 */

export type SiteThemeId = "default" | "halloween";

export type SiteThemeInfo = {
  id: Exclude<SiteThemeId, "default">;
  name: string;
  blurb: string;
  // A theme is drawn for one colour mode only, so it always looks the way it was designed.
  mode: "light" | "dark";
  primary: string;
  // Three colours for the little preview on the settings page.
  swatch: [string, string, string];
  // The lettering font for big headings (Latin letters; Thai falls back to the site font).
  font?: { family: string; url: string };
};

export const SITE_THEMES: SiteThemeInfo[] = [
  {
    id: "halloween", name: "ฮาโลวีน", blurb: "หมู่บ้านใต้พระจันทร์ บ้านผีสิง ฟักทองเรืองแสง ค้างคาว", mode: "dark", primary: "#f08a2c", swatch: ["#17102f", "#f08a2c", "#f4e9d0"],
    font: { family: "UnifrakturCook", url: "https://fonts.googleapis.com/css2?family=UnifrakturCook:wght@700&display=swap" },
  },
];

export const siteThemeInfo = (id: string | null | undefined) => SITE_THEMES.find((theme) => theme.id === id);

export const SITE_THEME_EVENT = "nexora-site-theme";
const STYLE_ID = "nexora-site-brand";
const STORE = "nexora-site-theme";

/**
 * Puts a theme on the page (or takes it off with "default"). The theme wins over the admin's colour
 * and mode, which other code on the page may still try to set, so its brand colour is written as an
 * !important rule and SiteScene puts the colour mode back if anything changes it.
 * persist: false previews it (the settings page) without remembering it for the next page load.
 */
export function applySiteTheme(id: string | null | undefined, persist = true) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const info = siteThemeInfo(id);
  let style = document.getElementById(STYLE_ID);
  if (!info) {
    delete root.dataset.siteTheme;
    style?.remove();
    try {
      // Back to the admin's own colour mode.
      const saved = window.localStorage.getItem("nexora-theme");
      if (saved === "light" || saved === "dark") root.dataset.theme = saved;
      if (persist) window.localStorage.removeItem(STORE);
    } catch {
      // storage may be blocked
    }
  } else {
    const variables = brandVariables(info.primary) ?? {};
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = `html[data-site-theme]{${Object.entries(variables).map(([name, value]) => `${name}:${value} !important`).join(";")}}`;
    root.dataset.siteTheme = info.id;
    root.dataset.theme = info.mode;
    if (persist) {
      try {
        window.localStorage.setItem(STORE, info.id);
      } catch {
        // storage may be blocked
      }
    }
  }
  window.dispatchEvent(new CustomEvent(SITE_THEME_EVENT, { detail: info?.id ?? "default" }));
}

/**
 * Runs in the page head before the first paint (layout.tsx inlines its source), so the theme's
 * colours are there from the start. Self-contained on purpose: it may not use anything outside its
 * own body.
 */
export function siteThemeBoot(
  modes: Record<string, [string, string]>,
  brand: (hex: string) => Record<string, string> | null,
) {
  const stored = window.localStorage.getItem("nexora-site-theme");
  const entry = stored ? modes[stored] : undefined;
  if (!stored || !entry) return;
  const root = document.documentElement;
  root.dataset.siteTheme = stored;
  root.dataset.theme = entry[0];
  const variables = brand(entry[1]);
  if (!variables) return;
  const style = document.createElement("style");
  style.id = "nexora-site-brand";
  style.textContent = "html[data-site-theme]{" + Object.keys(variables).map((name) => name + ":" + variables[name] + " !important").join(";") + "}";
  document.head.appendChild(style);
}
