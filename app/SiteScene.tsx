"use client";

import { lazy, Suspense, useEffect, useState } from "react";
import { loadFontStylesheet } from "./fontLink";
import { SITE_THEME_EVENT, siteThemeInfo, type SiteThemeId } from "./siteThemes";
import "./site-themes.css";
import "./site-angular.css";

// The picture behind every page for the theme that is on, and a light layer of moving things over
// the pages. Each theme's drawing is loaded only when that theme is on. The theme itself (colours,
// colour mode) is set on <html> by app/siteThemes.ts; this only draws, and puts the theme's colour
// mode back if some other part of the page changes it.

const back = {
  halloween: lazy(() => import("./siteScenes/Halloween").then((module) => ({ default: module.Back }))),
};
const front = {
  halloween: lazy(() => import("./siteScenes/Halloween").then((module) => ({ default: module.Front }))),
};

// Only some themes draw something above the headers (a string of lights, a pattern along the edge).
const top: Partial<Record<SiteThemeId, ReturnType<typeof lazy>>> = {
  halloween: lazy(() => import("./siteScenes/HalloweenSlime")),
};

export default function SiteScene() {
  const [theme, setTheme] = useState<SiteThemeId>("default");

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const info = siteThemeInfo(root.dataset.siteTheme);
      // Other code on the page sets the admin's colour mode when it loads; a theme keeps its own.
      if (info && root.dataset.theme !== info.mode) root.dataset.theme = info.mode;
      setTheme(info?.id ?? "default");
    };
    sync();
    window.addEventListener(SITE_THEME_EVENT, sync);
    const watcher = new MutationObserver(sync);
    watcher.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-site-theme"] });
    return () => {
      window.removeEventListener(SITE_THEME_EVENT, sync);
      watcher.disconnect();
    };
  }, []);

  useEffect(() => {
    const font = siteThemeInfo(theme)?.font;
    if (font) loadFontStylesheet(font.url);
  }, [theme]);

  if (theme === "default") return null;
  const Back = back[theme];
  const Front = front[theme];
  const Top = top[theme];
  return (
    <>
      <div className={`st-layer st-back st-${theme}`} aria-hidden="true"><Suspense fallback={null}><Back /></Suspense></div>
      <div className={`st-layer st-front st-${theme}`} aria-hidden="true"><Suspense fallback={null}><Front /></Suspense></div>
      {Top && <div className={`st-layer st-top st-${theme}`} aria-hidden="true"><Suspense fallback={null}><Top /></Suspense></div>}
    </>
  );
}
