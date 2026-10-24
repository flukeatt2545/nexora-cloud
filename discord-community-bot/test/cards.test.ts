import "./support";
import assert from "node:assert/strict";
import { test } from "node:test";
import { bannerCard, boostCard, statusCard, welcomeCard, type BannerKind } from "../src/image";

// The panel pictures are drawn with a canvas, so a typo in the drawing code only shows up when
// the picture is made. These make each one and check it comes out as a PNG of the right size.

function size(png: Buffer) {
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("the verify, ticket and roles banners are 1100x260 pictures", async () => {
  for (const kind of ["verify", "ticket", "roles"] as BannerKind[]) {
    assert.deepEqual(size(await bannerCard(kind)), { width: 1100, height: 260 }, kind);
  }
});

test("the boost card draws at every level, from none to the top", async () => {
  for (const [level, boosts] of [[0, 0], [1, 2], [2, 7], [3, 14], [3, 40]]) {
    assert.deepEqual(size(await boostCard({ server: "NEXORA", level, boosts })), { width: 1100, height: 390 }, `${boosts} boosts`);
  }
});

test("the status card grows with the number of services", async () => {
  const row = (up: boolean) => ({ label: "API", up, detail: "api.nkn02.com", latencyMs: up ? 40 : null, uptime: up ? 100 : 97.5, history: [true, false, true] });
  assert.equal(size(await statusCard([row(true)], "NEXORA")).height, 250 + 118);
  assert.equal(size(await statusCard([row(true), row(false), row(true)], "NEXORA")).height, 250 + 3 * 118);
});

test("the welcome and goodbye cards still draw (they keep their own design)", async () => {
  const base = { name: "F12", username: "f12", avatarUrl: "", server: "NEXORA", count: 100 };
  assert.equal(size(await welcomeCard(base)).width, 1100);
  assert.equal(size(await welcomeCard({ ...base, leaving: { days: 3 } })).width, 1100);
});
