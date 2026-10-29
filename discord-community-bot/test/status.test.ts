import "./support";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { check, downReason } from "../src/status";

// A local server: `answer` decides what each request gets; a request it leaves alone hangs.
async function server(answer: (res: http.ServerResponse) => void) {
  const srv = http.createServer((_req, res) => answer(res));
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`, close: () => { srv.closeAllConnections(); srv.close(); } };
}

test("a check that answers has no problem and no trace", async () => {
  const srv = await server((res) => res.writeHead(403).end());
  const result = await check(srv.url, 2000);
  srv.close();
  assert.equal(result.problem, "");
  assert.equal(result.trace, "");
});

test("a 5xx is a problem, and the trace shows the address it reached", async () => {
  const srv = await server((res) => res.writeHead(502).end());
  const result = await check(srv.url, 2000);
  srv.close();
  assert.equal(result.problem, "HTTP 502");
  assert.match(result.trace, /^status=502 ray=- ip=127\.0\.0\.1 dns=- connect=\d+ms tls=- total=\d+ms$/);
});

test("a server that connects but never answers is a timeout after the connection", async () => {
  const srv = await server(() => undefined);
  const result = await check(srv.url, 300);
  srv.close();
  assert.equal(result.problem, "ไม่ตอบภายใน 1 วินาที");
  assert.match(result.trace, /^code=ECONNABORTED ip=127\.0\.0\.1 dns=- connect=\d+ms /);
});

test("a closed port is a failed connection, with no connect time", async () => {
  const srv = await server(() => undefined);
  srv.close();
  const result = await check(srv.url, 2000);
  assert.equal(result.problem, "เชื่อมต่อไม่ได้ (ECONNREFUSED)");
  assert.match(result.trace, /^code=ECONNREFUSED ip=127\.0\.0\.1 dns=- connect=- /);
});

test("one failed check is never down", () => {
  assert.equal(downReason("ไม่ตอบ", 1), null);
  assert.equal(downReason("ไม่ตอบ", 1, "เชื่อมต่อไม่ได้"), null);
});

test("two failed checks are down when there is no direct check or it fails too", () => {
  assert.equal(downReason("ไม่ตอบ", 2), "ไม่ตอบ");
  assert.equal(downReason("ไม่ตอบ", 2, "เชื่อมต่อไม่ได้ (ECONNREFUSED)"), "ไม่ตอบ");
});

test("while the web container answers, the alert waits about 3 minutes and says the site is up", () => {
  assert.equal(downReason("ไม่ตอบ", 2, ""), null);
  assert.equal(downReason("ไม่ตอบ", 5, ""), null);
  assert.equal(downReason("ไม่ตอบ", 6, ""), "ไม่ตอบ\nตัวเว็บยังทำงานอยู่ แต่เข้าผ่านอินเทอร์เน็ตไม่ได้");
});
