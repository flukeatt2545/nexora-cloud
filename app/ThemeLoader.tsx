"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { applyThemeColor } from "./themeColor";
import { applySiteTheme, siteThemeInfo } from "./siteThemes";
import { getDocumentTitle, type SiteTitleMode } from "./pageTitle";
import { API_BASE } from "./runtime";

type PublicSettings = {
  brandName?: string;
  siteTitle?: string;
  siteTitleMode?: SiteTitleMode;
  siteDescription?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
  ogCardType?: string;
  ogColor?: string;
  primaryColor?: string;
  themeMode?: "light" | "dark";
  // The look that is on today (halloween...); "default" is the plain look from the colour and mode.
  theme?: string;
  logoUrl?: string;
  faviconUrl?: string;
};

function updateMetaTag(attr: "name" | "property", value: string, content: string) {
  if (typeof document === "undefined" || !content) return;
  let el = document.querySelector(`meta[${attr}="${value}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, value);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function updateLinkTag(rel: string, href: string) {
  if (typeof document === "undefined" || !href) return;
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function normalizeAssetUrl(urlStr?: string): string {
  if (!urlStr) return "";
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    if (urlStr.startsWith("http://localhost:8088/")) {
      return urlStr.replace(/^http:\/\/localhost:8088/, window.location.origin);
    }
    if (urlStr.startsWith("http://") && !urlStr.includes("localhost") && !urlStr.includes("127.0.0.1")) {
      return urlStr.replace(/^http:\/\//, "https://");
    }
  }
  return urlStr;
}

/** ?theme=halloween on any address shows that theme for a look, without saving it for anyone. */
function previewedTheme(): string | null {
  const wanted = new URLSearchParams(window.location.search).get("theme");
  return wanted && (wanted === "default" || siteThemeInfo(wanted)) ? wanted : null;
}

export default function ThemeLoader() {
  const pathname = usePathname();
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("nexora-theme");
    // A theme that was on at the last visit already set its own mode before the first paint.
    if ((savedTheme === "light" || savedTheme === "dark") && !document.documentElement.dataset.siteTheme) {
      document.documentElement.dataset.theme = savedTheme;
    }
    const savedPrimary = window.localStorage.getItem("nexora-primary");
    if (savedPrimary) {
      applyThemeColor(savedPrimary);
    }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/settings/public`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        // The admin's own mode and colour are kept even while a theme is on, for when it ends.
        if (data?.themeMode) window.localStorage.setItem("nexora-theme", data.themeMode);
        if (data?.primaryColor) applyThemeColor(data.primaryColor);
        const shown = previewedTheme() ?? data?.theme;
        if (data?.themeMode && !siteThemeInfo(shown)) document.documentElement.dataset.theme = data.themeMode;
        applySiteTheme(shown, !previewedTheme());
        setSettings(data);

        // Dynamic Icon & Meta sync
        const iconUrl = normalizeAssetUrl(data.faviconUrl || data.logoUrl || "/logo-v2.png");
        updateLinkTag("icon", iconUrl);
        updateLinkTag("shortcut icon", iconUrl);
        updateLinkTag("apple-touch-icon", iconUrl);

        const isLightMode = (data?.themeMode === "light" || document.documentElement.dataset.theme === "light");
        const metaThemeColor = isLightMode ? "#ffffff" : "#08090d";
        updateMetaTag("name", "theme-color", metaThemeColor);
        updateMetaTag("name", "msapplication-TileColor", metaThemeColor);

        // File-share pages receive per-file metadata from their server layout.
        // Do not replace it with the site-wide Open Graph values after hydration.
        // Read the address now: the settings arrive after the page may have changed.
        if (!/^\/files\/d\/[a-f0-9]{32}$/i.test(window.location.pathname)) {
          const description = data.ogDescription || data.siteDescription;
          if (description) {
            updateMetaTag("name", "description", description);
            updateMetaTag("property", "og:description", description);
            updateMetaTag("name", "twitter:description", description);
          }
          const siteTitle = data.brandName || data.siteTitle || "NEXORA CLOUD";
          updateMetaTag("property", "og:site_name", siteTitle);

          const ogImage = normalizeAssetUrl(data.ogImageUrl) || iconUrl;
          if (ogImage) {
            updateMetaTag("property", "og:image", ogImage);
            updateMetaTag("name", "twitter:image", ogImage);
          }
          const cardType = data.ogCardType === "summary" ? "summary" : "summary_large_image";
          updateMetaTag("name", "twitter:card", cardType);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (/^\/files\/d\/[a-f0-9]{32}$/i.test(pathname || "")) return;
    const fullTitle = getDocumentTitle(settings, pathname || window.location.pathname);
    document.title = fullTitle;
    const ogTitle = settings.ogTitle || fullTitle;
    updateMetaTag("property", "og:title", ogTitle);
    updateMetaTag("name", "twitter:title", ogTitle);
  }, [pathname, settings]);

  // A theme set for certain dates changes by itself, so a page left open picks it up too.
  useEffect(() => {
    const check = async () => {
      if (previewedTheme()) return;
      try {
        const res = await fetch(`${API_BASE}/api/settings/public`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const next = siteThemeInfo(data?.theme)?.id ?? "default";
        if (next !== (siteThemeInfo(document.documentElement.dataset.siteTheme)?.id ?? "default")) {
          if (next === "default" && data?.themeMode) document.documentElement.dataset.theme = data.themeMode;
          applySiteTheme(next);
        }
      } catch {
        // ignore
      }
    };
    const timer = window.setInterval(check, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
