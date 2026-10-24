import { useEffect } from "react";

/** Loads a stylesheet of web fonts once per page (and not at all until a component asks for it). */
export function loadFontStylesheet(url: string) {
  if (typeof document === "undefined" || document.querySelector(`link[data-nexora-font="${url}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  link.dataset.nexoraFont = url;
  document.head.appendChild(link);
}

export function useFontStylesheet(url: string | undefined) {
  useEffect(() => {
    if (url) loadFontStylesheet(url);
  }, [url]);
}
