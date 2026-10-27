// Square UI: the verify page's cut-corner look for the whole site, chosen per browser.
// The choice is html[data-ui="square"] (set before paint by the script in app/layout.tsx),
// remembered under this key. The styles are app/ui-square.css and build/postcss-square-ui.mjs.

export type UiShape = "round" | "square";

export const UI_SHAPE_KEY = "nexora-ui";
/** Fired on window when the shape changes in this tab. */
export const UI_SHAPE_EVENT = "nexora:ui-shape";

export function currentUiShape(): UiShape {
  return typeof document !== "undefined" && document.documentElement.dataset.ui === "square" ? "square" : "round";
}

export function setUiShape(shape: UiShape) {
  const root = document.documentElement;
  if (shape === "square") root.dataset.ui = "square";
  else delete root.dataset.ui;
  try {
    window.localStorage.setItem(UI_SHAPE_KEY, shape);
  } catch {
    // storage may be blocked; the choice then lasts until the page is closed
  }
  window.dispatchEvent(new CustomEvent(UI_SHAPE_EVENT, { detail: shape }));
}
