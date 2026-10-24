import { BOT_ADMIN_ID, makeGuild, makeMember, useSettings } from "./support";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { isTrusted, noteChannelDeleted, wasThrowaway } from "../src/trust";

// Who may delete channels without being stopped, and which channels come and go on their own.

before(() => useSettings({ nukeTrustedUserIds: ["TRUSTED-USER"], nukeTrustedRoleIds: ["TRUSTED-ROLE"], ticketCategoryId: "TICKETS" }));

test("the owner, the bot and the bot's admins are always trusted", async () => {
  const guild = makeGuild();
  assert.equal(await isTrusted(guild, "OWN"), true);
  assert.equal(await isTrusted(guild, "BOT"), true);
  assert.equal(await isTrusted(guild, BOT_ADMIN_ID), true);
});

test("a stranger is not trusted", async () => {
  const guild = makeGuild();
  makeMember(guild, "STRANGER");
  assert.equal(await isTrusted(guild, "STRANGER"), false);
});

test("people on the trusted list, and people with a trusted role, are trusted", async () => {
  const guild = makeGuild();
  makeMember(guild, "WITH-ROLE", { roles: ["TRUSTED-ROLE"] });
  makeMember(guild, "OTHER-ROLE", { roles: ["SOMETHING-ELSE"] });
  assert.equal(await isTrusted(guild, "TRUSTED-USER"), true);
  assert.equal(await isTrusted(guild, "WITH-ROLE"), true);
  assert.equal(await isTrusted(guild, "OTHER-ROLE"), false);
});

test("a member who is not cached is looked up before deciding", async () => {
  const guild = makeGuild();
  const member = makeMember(guild, "UNCACHED", { roles: ["TRUSTED-ROLE"] });
  guild.members.cache.delete("UNCACHED");
  guild.members.fetch = async () => member;
  assert.equal(await isTrusted(guild, "UNCACHED"), true);
});

test("a member who left the server is not trusted just because a role is on the list", async () => {
  const guild = makeGuild();
  assert.equal(await isTrusted(guild, "GONE"), false);
});

test("the voice module's own rooms and tickets count as throwaway when deleted", () => {
  noteChannelDeleted({ id: "own-room" }, true);
  noteChannelDeleted({ id: "ticket-room", parentId: "TICKETS" }, false);
  assert.equal(wasThrowaway("own-room"), true);
  assert.equal(wasThrowaway("ticket-room"), true);
});

test("an ordinary channel is never throwaway, so deleting it still counts", () => {
  noteChannelDeleted({ id: "general", parentId: "TEXT" }, false);
  assert.equal(wasThrowaway("general"), false);
  assert.equal(wasThrowaway("never-seen"), false);
});
