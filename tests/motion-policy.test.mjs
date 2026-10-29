import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

// The site's animations always run: they are not tied to the Windows Animation Effects setting
// (prefers-reduced-motion), anywhere on nkn02.com. See the motion policy note in app/theme.css.

async function files(dir, pattern) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path, pattern)));
    else if (pattern.test(entry.name)) out.push(path);
  }
  return out;
}

const REDUCED = /prefers-reduced-motion\s*:\s*reduce/i;

test("site animations are not disabled by the Windows motion preference", async () => {
  const checked = [
    ...(await files("app", /\.(css|tsx?)$/)),
    "deploy/crowdsec-ban.html",
    "backend/vps_uptime_assets.go",
  ];
  assert.ok(checked.length > 50, "expected to find the site's stylesheets and components");
  for (const file of checked) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, REDUCED, `${file} must not turn animation off from the operating-system setting`);
    // auto-animate skips its animation under the OS setting unless told not to.
    for (const call of text.matchAll(/useAutoAnimate(?:<[^>]*>)?\(([^)]*)\)/g)) {
      assert.match(call[1], /disrespectUserMotionPreference:\s*true/, `${file}: useAutoAnimate needs { disrespectUserMotionPreference: true }`);
    }
  }
});
