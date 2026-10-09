import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesheets = [
  "app/globals.css",
  "app/theme.css",
  "app/dashboard/dashboard.css",
  "app/c/oauth-ticket.css",
];

test("site animations are not disabled by the Windows motion preference", async () => {
  for (const stylesheet of stylesheets) {
    const css = await readFile(stylesheet, "utf8");
    assert.doesNotMatch(
      css,
      /@media\s*\([^)]*prefers-reduced-motion\s*:\s*reduce/i,
      `${stylesheet} must not disable animation from the operating-system setting`,
    );
  }
});


