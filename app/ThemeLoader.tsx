"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { applyThemeColor } from "./themeColor";
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

export default function ThemeLoader() {
  const pathname = usePathname();
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("nexora-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
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
        if (data?.themeMode) {
          document.documentElement.dataset.theme = data.themeMode;
          window.localStorage.setItem("nexora-theme", data.themeMode);
        }
        if (data?.primaryColor) applyThemeColor(data.primaryColor);
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

  return null;
}
