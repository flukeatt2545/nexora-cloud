import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("light and dark themes share a complete token contract", async () => {
  const css = await read("app/theme.css");
  const tokens = [
    "--background",
    "--surface",
    "--primary",
    "--text",
    "--muted",
    "--theme-input",
    "--theme-text-strong",
    "--theme-text-soft",
    "--theme-line-soft",
    "--theme-hover",
    "--theme-overlay",
    "--control-surface",
    "--control-surface-strong",
  ];

  for (const selector of [":root", '[data-theme="dark"]', '[data-theme="light"]']) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const token of tokens) {
    assert.equal((css.match(new RegExp(token, "g")) ?? []).length >= 2, true, `${token} must exist in both themes`);
  }
});

test("light theme covers every application surface and modal", async () => {
  const css = await read("app/theme.css");
  const surfaces = [
    ".navbar",
    ".auth-modal",
    ".announcement-popup",
    ".dashboard-root",
    ".dashboard-sidebar",
    ".dashboard-topbar",
    ".dash-card",
    ".system-dialog",
    ".user-app-container",
    ".user-premium-card",
    ".premium-settings-card",
    ".hosting-site-card",
    ".hosting-create-dialog",
    ".hosting-detail-dialog",
    ".hosting-detail-top",
    ".hosting-detail-section",
    ".hosting-database-card",
    ".hosting-runtime-summary",
    ".file-manager-dialog",
    ".db-detail-dialog",
    ".db-user-dropdown",
    ".log-detail-dialog",
    ".announcement-card",
    ".terms-page-root",
  ];

  for (const surface of surfaces) {
    assert.match(
      css,
      new RegExp(`\\[data-theme="light"\\][^{]*\\${surface.replace(".", ".")}`),
      `missing light-theme coverage for ${surface}`,
    );
  }
});

test("all frontend shells load system theme and avoid inline theme colors", async () => {
  const [home, admin, databaseAdmin, user, hosting, layout] = await Promise.all([
    read("app/GamingStore.tsx"),
    read("app/dashboard/DashboardApp.tsx"),
    read("app/dashboard/DatabaseAdminView.tsx"),
    read("app/dashboard/UserApp.tsx"),
    read("app/dashboard/HostingView.tsx"),
    read("app/layout.tsx"),
  ]);

  for (const source of [home, admin, user]) {
    assert.match(source, /document\.documentElement\.dataset\.theme/);
    assert.match(source, /applyThemeColor/);
  }
  for (const stylesheet of ["globals.css", "dashboard/dashboard.css", "theme.css", "user-app.css"]) {
    assert.match(layout, new RegExp(stylesheet.replace(".", "\\.")));
  }
  for (const [name, source] of [["admin", admin], ["database admin", databaseAdmin], ["user", user], ["hosting", hosting]]) {
    assert.doesNotMatch(
      source,
      /style=\{\{[^\n}]*background\s*:\s*["'](?:#000|#fff|#111|#222|black|white)["']/,
      `${name} UI must use reusable theme classes instead of hardcoded background colors`,
    );
  }
});
