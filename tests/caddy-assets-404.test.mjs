import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const caddy = readFileSync(new URL("../Caddyfile", import.meta.url), "utf8");
const hostCaddy = readFileSync(new URL("../deploy/Caddyfile.vps_host", import.meta.url), "utf8");
const crowdsec = readFileSync(new URL("../deploy/crowdsec-errors.caddy", import.meta.url), "utf8");

test("missing uploaded assets do not pass S3 XML through to HTML navigations", () => {
  assert.match(caddy, /@uploaded_asset/);
  assert.match(caddy, /uri replace \/assets\/ \/nexora-assets\/ 1/);
  assert.doesNotMatch(caddy, /uri strip_prefix \/assets\s+rewrite \* \/nexora-assets\{path\}/);
  assert.match(caddy, /@browser_asset/);
  assert.match(caddy, /http\.request\.header\.Accept.*contains\("text\/html"\)/);
  assert.match(caddy, /rewrite \* \/nexora-missing-object/);
  assert.match(caddy, /rewrite \* \/nexora-missing-object/);
  assert.doesNotMatch(caddy, /handle_path \/assets\/\* \{\s*rewrite \* \/nexora-assets\{path\}\s*reverse_proxy minio:9000\s*\}/);
});

test("platform HTML error page still covers nested asset navigations", () => {
  assert.match(crowdsec, /not path \/api\/\* \/_next\/\* \/health/);
  assert.doesNotMatch(crowdsec, /not path \/api\/\* \/assets\/\* \/_next\/\* \/health/);
});


