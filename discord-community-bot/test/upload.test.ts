import "./support";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApplicationCommandOptionType } from "discord.js";
import { attachmentProblem, batchProblem, displayName, isDiscordCdnUrl, MAX_FILES, MAX_TOTAL_BYTES, OPTION_FILES, resultMessage, sniffImage, uploadCommand, uploadModal } from "../src/legacy/nexora/features/upload";

const cdn = "https://cdn.discordapp.com/attachments/1/2/photo.png";
const image = { name: "photo.png", contentType: "image/png", size: 1000, url: cdn };

test("/upload needs no attachment, so it can open the picker, in Thai and English", () => {
  const json = uploadCommand.toJSON();
  assert.equal(json.options!.length, OPTION_FILES);
  assert.ok(json.options!.every((option) => option.type === ApplicationCommandOptionType.Attachment));
  assert.ok(json.options!.every((option) => !option.required));
  assert.equal(json.name_localizations?.th, "อัปโหลด");
  assert.equal(json.options![0].name_localizations?.th, "รูป1");
  assert.equal(json.dm_permission, false);
});

test("only Discord's own CDN over https is fetched", () => {
  assert.ok(isDiscordCdnUrl(cdn));
  assert.ok(isDiscordCdnUrl("https://media.discordapp.net/attachments/1/2/a.png?ex=1"));
  for (const bad of ["http://cdn.discordapp.com/a.png", "https://evil.example/a.png", "https://cdn.discordapp.com.evil.example/a.png", "https://user:pw@cdn.discordapp.com/a.png", "http://api:8080/x", "not a url"]) {
    assert.equal(isDiscordCdnUrl(bad), false, bad);
  }
});

test("a picture is checked before anything is downloaded", () => {
  assert.equal(attachmentProblem(image), "");
  assert.match(attachmentProblem({ ...image, contentType: "application/pdf" }), /ไม่ใช่รูปภาพ/);
  assert.match(attachmentProblem({ ...image, contentType: "image/svg+xml" }), /ไม่ใช่รูปภาพ/);
  assert.match(attachmentProblem({ ...image, size: 26 * 1024 * 1024 }), /25MB/);
  assert.match(attachmentProblem({ ...image, size: 0 }), /25MB/);
  assert.match(attachmentProblem({ ...image, url: "https://evil.example/a.png" }), /ดึงไฟล์ไม่ได้/);
});

test("the real file type is read from the bytes, not from what the client says", () => {
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImage(Buffer.from("GIF89a....")), "image/gif");
  assert.equal(sniffImage(Buffer.from("RIFF....WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(sniffImage(Buffer.from("MZ\u0090\u0000 not an image")), null);
});

test("file names cannot break out of the markdown link they are shown in", () => {
  const name = displayName("x](https://evil.example) [click‮.png");
  assert.ok(!/[\[\]()‮]/.test(name), name);
  assert.equal(displayName(""), "รูปภาพ");
  assert.ok(displayName("a".repeat(200)).length <= 40);
});

test("the picker takes up to the most files the bot accepts", () => {
  const json = JSON.parse(JSON.stringify(uploadModal().toJSON()));
  const picker = json.components[0].component;
  assert.equal(picker.max_values, MAX_FILES);
  assert.equal(picker.min_values, 1);
  assert.ok(MAX_FILES <= 10);
});

test("a batch that is too many or too big is refused before anything is downloaded", () => {
  assert.equal(batchProblem([{ size: 1000 }, { size: 1000 }]), "");
  assert.notEqual(batchProblem(Array.from({ length: MAX_FILES + 1 }, () => ({ size: 1 }))), "");
  assert.notEqual(batchProblem([{ size: MAX_TOTAL_BYTES }, { size: 1 }]), "");
});

test("ten pictures get ten buttons on rows of five", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ url: `https://nkn02.com/assets/uploads/${i}.png`, filename: `p${i}.png`, size: 1000 }));
  const message = resultMessage(items, "somchai");
  assert.deepEqual(message.components.map((row) => row.components.length), [5, 5]);
});

test("the result is one card with every link, a grid of up to four pictures and a button each", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ url: `https://nkn02.com/assets/uploads/${i}.png`, filename: `p${i}.png`, size: 2048 }));
  const message = resultMessage(items, "somchai");
  assert.equal(message.embeds.length, 4);
  const urls = message.embeds.map((embed) => embed.toJSON().url);
  assert.equal(new Set(urls).size, 1);
  assert.equal(message.components[0].components.length, 5);
  const single = resultMessage(items.slice(0, 1), "somchai");
  assert.equal(single.embeds.length, 1);
  assert.match(single.embeds[0].toJSON().description!, /uploads\/0\.png/);
});
