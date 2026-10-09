import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the NEXORA CLOUD storefront", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>NEXORA CLOUD<\/title>/i);
  assert.match(html, /NEXORA/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("HTML responses use a unique CSP nonce for every script", async () => {
  const [first, second] = await Promise.all([render("/"), render("/terms")]);
  const firstPolicy = first.headers.get("content-security-policy") ?? "";
  const secondPolicy = second.headers.get("content-security-policy") ?? "";
  const firstNonce = firstPolicy.match(/'nonce-([^']+)'/)?.[1];
  const secondNonce = secondPolicy.match(/'nonce-([^']+)'/)?.[1];

  assert.ok(firstNonce);
  assert.ok(secondNonce);
  assert.notEqual(firstNonce, secondNonce);
  assert.doesNotMatch(firstPolicy.match(/(?:^|; )script-src ([^;]+)/)?.[1] ?? "", /'unsafe-inline'|'unsafe-eval'/);
  assert.match(firstPolicy, /script-src-attr 'none'/);
  assert.match(firstPolicy, /connect-src 'self' blob:/);
  assert.doesNotMatch(firstPolicy, /localhost:8080|ws:\/\/localhost/);

  const html = await first.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.match(script[1], new RegExp(`\\bnonce=["']${firstNonce.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  }
});

test("build exposes every protected dashboard route", async () => {
  for (const path of ["/profile", "/hosting", "/topups", "/admin", "/admin/profile", "/admin/users", "/admin/access", "/admin/logs", "/admin/announcements", "/admin/settings", "/admin/hosting", "/admin/databases"]) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /global-page-loading|user-app-loading|hosting-spinner|กำลังตรวจสอบ(?:บัญชี|สิทธิ์)/, path);
  }
});

test("build exposes the public terms page", async () => {
  const response = await render("/terms");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /terms-page-root/);
});

test("dashboard keeps authorization and sensitive data server-side", async () => {
  const [dashboard, backend] = await Promise.all([
    readFile(new URL("../app/dashboard/DashboardApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../backend/platform.go", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /credentials:\s*"include"/);
  assert.match(dashboard, /superadmin/);
  assert.match(backend, /requireRoles/);
  assert.match(backend, /token_hash/);
  assert.doesNotMatch(dashboard, /246266|DISCORD_CLIENT_SECRET|GOOGLE_CLIENT_SECRET|GITHUB_CLIENT_SECRET/);
});

test("hosting phase one keeps operations and access checks server-side", async () => {
  const [handler, migration] = await Promise.all([
    readFile(new URL("../backend/hosting_handlers.go", import.meta.url), "utf8"),
    readFile(new URL("../backend/migrations/008_hosting_core.sql", import.meta.url), "utf8"),
  ]);
  assert.match(handler, /Idempotency-Key/);
  assert.match(handler, /pgx\.Serializable/);
  assert.match(handler, /FOR UPDATE OF s/);
  assert.match(migration, /hosting_operations_one_active_per_site/);
  assert.match(migration, /hosting_sites_subdomain_active_unique/);
  assert.match(migration, /hosting_sites_custom_domain_active_unique/);
  assert.doesNotMatch(handler, /docker\.sock|\/var\/run\/docker/);
});

test("hosting runtime isolates Docker access and validates deployments", async () => {
  const [worker, docker, archive, gateway, compose, migration] = await Promise.all([
    readFile(new URL("../backend/runtime-worker/main.go", import.meta.url), "utf8"),
    readFile(new URL("../backend/runtime-worker/docker.go", import.meta.url), "utf8"),
    readFile(new URL("../backend/runtime-worker/archive.go", import.meta.url), "utf8"),
    readFile(new URL("../backend/runtime-gateway/main.go", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"),
    readFile(new URL("../backend/migrations/009_hosting_runtime.sql", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /FOR UPDATE OF o SKIP LOCKED/);
  assert.match(worker, /pg_advisory_xact_lock/);
  assert.match(worker, /validateRuntimeCommands/);
  assert.match(docker, /ReadonlyRootfs/);
  assert.match(docker, /no-new-privileges:true/);
  assert.match(docker, /CapDrop/);
  assert.match(archive, /path traversal/);
  assert.match(archive, /ModeSymlink/);
  assert.match(gateway, /NewSingleHostReverseProxy/);
  assert.match(compose, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.doesNotMatch(compose.match(/runtime-gateway:[\s\S]*?runtime-worker:/)?.[0] ?? "", /docker\.sock/);
  assert.match(migration, /hosting_port_leases_active_port_unique/);
});

test("personal file share links are public download pages with owner APIs", async () => {
  const [page, shareLayout, library, backend, migration] = await Promise.all([
    readFile(new URL("../app/files/d/[token]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/files/d/[token]/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/FileLibraryView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../backend/user_files.go", import.meta.url), "utf8"),
    readFile(new URL("../backend/migrations/035_user_file_share_links.sql", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\/api\/public\/files\//);
  assert.doesNotMatch(page, /UserApp|requireUser/);
  assert.match(shareLayout, /generateMetadata/);
  assert.match(shareLayout, /\/api\/public\/files\/\$\{safeToken\}/);
  assert.match(shareLayout, /download\?preview=1/);
  assert.match(shareLayout, /file\.name/);
  assert.match(library, /shareEndpoint\(shareTarget\.id\)/);
  assert.match(library, /\/api\/admin\/user-files\//);
  assert.doesNotMatch(library, /อยากให้เพื่อนอัปไฟล์ด้วย\?/);
  assert.match(backend, /createOwnUserFileShare/);
  assert.match(backend, /downloadPublicSharedUserFile/);
  assert.match(migration, /share_token/);
  assert.match(migration, /share_expires_at/);
});
