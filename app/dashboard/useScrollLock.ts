import { useEffect } from "react";

// While a dialog is open the page behind it neither scrolls nor shifts sideways.
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { body, documentElement } = document;
    const previous = { body: body.style.overflow, html: documentElement.style.overflow, pad: body.style.paddingRight };
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = previous.body;
      documentElement.style.overflow = previous.html;
      body.style.paddingRight = previous.pad;
    };
  }, [active]);
}

// Esc closes the top dialog, unless a confirmation is showing over it.
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".system-dialog-backdrop.is-confirm")) return;
      onEscape();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
}
