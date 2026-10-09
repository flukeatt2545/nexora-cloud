import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

test("frontend API routing is centralized and supports any development host", async () => {
  const runtime = await readFile(path.join(root, "app/runtime.ts"), "utf8");
  assert.match(runtime, /process\.env\.NODE_ENV/);
  assert.match(runtime, /window\.location\.hostname/);
  assert.match(runtime, /:8080/);

  for (const file of await sourceFiles(path.join(root, "app"))) {
    if (file.endsWith(`${path.sep}runtime.ts`)) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /window\.location\.port\s*[!=]==?\s*["']3000["']/, file);
    assert.doesNotMatch(source, /http:\/\/localhost:8080/, file);
  }
});

test("production CSP excludes development endpoints", async () => {
  const [proxy, caddy] = await Promise.all([
    readFile(path.join(root, "proxy.ts"), "utf8"),
    readFile(path.join(root, "Caddyfile"), "utf8"),
  ]);
  assert.match(proxy, /if \(isDevelopment\)/);
  const productionBlock = caddy.match(/@platform_production[\s\S]*?\n\t}/)?.[0] ?? "";
  assert.match(productionBlock, /connect-src 'self' blob:/);
  assert.doesNotMatch(productionBlock, /localhost|127\.0\.0\.1|ws:\/\//);
});
