import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("MySQL phpMyAdmin access uses a short-lived server ticket", () => {
  const view = readFileSync(new URL("../app/dashboard/HostingView.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../backend/phpmyadmin_ticket.go", import.meta.url), "utf8");
  const signon = readFileSync(new URL("../phpmyadmin_config/signon.php", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
  const provisioning = readFileSync(new URL("../backend/hosting_db.go", import.meta.url), "utf8");

  assert.match(view, /openPhpMyAdmin\(database/);
  assert.match(view, /database\/phpmyadmin/);
  assert.match(view, /database\/test/);
  assert.match(view, /https:\/\/\$\{site\.subdomain\}\.nkn02\.com/);
  assert.match(view, /data-lpignore="true"/);
  assert.match(view, /autoComplete="new-password"/);
  assert.match(api, /const phpMyAdminTicketTTL = 45 \* time\.Second/);
  assert.match(api, /token_hash/);
  assert.match(api, /subtle\.ConstantTimeCompare/);
  assert.match(signon, /X-PMA-Internal-Secret/);
  assert.match(signon, /CURLOPT_CONNECTTIMEOUT/);
  assert.match(signon, /\$_POST\["ticket"\]/);
  assert.doesNotMatch(signon, /\$_GET\["t"\]/);
  assert.match(signon, /"samesite" => "Lax"/);
  assert.doesNotMatch(compose, /PMA_PASSWORD:/);
  assert.doesNotMatch(compose, /PMA_USER:/);
  assert.match(provisioning, /'mysql','tenant-db',3306/);
  assert.match(provisioning, /MAX_USER_CONNECTIONS 10/);
  assert.match(provisioning, /testHostingSiteDatabase/);
  assert.match(provisioning, /site\.AccessRole == "viewer"/);
});
