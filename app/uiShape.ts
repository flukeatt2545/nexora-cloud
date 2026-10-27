// The site's shape, picked by the admin (Settings → General, saved as system_settings.ui_shape):
// the usual rounded UI, or the square one with the verify page's cut corners (app/ui-square.css,
// build/postcss-square-ui.mjs). It is html[data-ui="square"]. The last value seen is kept under
// this key so the script in app/layout.tsx can set it before the first paint, like nexora-theme.

export type UiShape = "round" | "square";

export const UI_SHAPE_KEY = "nexora-ui";

/** Shows the site in this shape. remember=false is for previews in the settings form. */
export function applyUiShape(shape: UiShape | undefined, remember = true) {
  const square = shape === "square";
  const root = document.documentElement;
  if (square) root.dataset.ui = "square";
  else delete root.dataset.ui;
  if (!remember) return;
  try {
    window.localStorage.setItem(UI_SHAPE_KEY, square ? "square" : "round");
  } catch {
    // storage may be blocked; the next page load then shows the shape once settings arrive
  }
}
