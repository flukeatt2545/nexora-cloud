"use client";

import { useEffect, useState } from "react";
import { SITE_THEME_EVENT, siteThemeInfo, type SiteThemeId } from "./siteThemes";

/** The theme that is on right now ("default" when none), kept up to date when it changes (a preview, a date range starting). */
export function useSiteTheme(): SiteThemeId {
  const [theme, setTheme] = useState<SiteThemeId>("default");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(siteThemeInfo(root.dataset.siteTheme)?.id ?? "default");
    read();
    window.addEventListener(SITE_THEME_EVENT, read);
    const watcher = new MutationObserver(read);
    watcher.observe(root, { attributes: true, attributeFilter: ["data-site-theme"] });
    return () => {
      window.removeEventListener(SITE_THEME_EVENT, read);
      watcher.disconnect();
    };
  }, []);
  return theme;
}
