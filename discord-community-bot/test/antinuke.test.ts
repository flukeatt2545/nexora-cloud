import { ChannelType, makeChannel, makeGuild, makeMember, useSettings } from "./support";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { AuditLogEvent } from "discord.js";
import { onAuditLogEntry } from "../src/security";
import { noteChannelDeleted } from "../src/trust";

// The anti-nuke: someone who is not trusted deleting channels is stopped (roles removed, timed
// out), and the security room says so. Each test uses its own person, because the bot only
// punishes the same person once every five minutes.

type Setup = { guild: ReturnType<typeof makeGuild>; room: ReturnType<typeof makeChannel>; who: ReturnType<typeof makeMember> };

function setup(id: string, options: { bot?: boolean; roles?: string[] } = {}): Setup {
  const guild = makeGuild();
  const room = makeChannel(guild, "SEC", { type: ChannelType.GuildText });
  const who = makeMember(guild, id, { roles: options.roles ?? ["ROLE-A", "ROLE-B"], topRole: 10, bot: options.bot });
  return { guild, room, who };
}

function deleteChannel(executorId: string, channelId = "chan-1") {
  return { action: AuditLogEvent.ChannelDelete, executorId, targetId: channelId, changes: [{ key: "name", old: "general" }], reason: null };
}

/** Lets the punishment (started without being awaited) finish. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(() => useSettings());

test("the first channel deleted by someone untrusted stops them: roles removed, timed out, security room told", async () => {
  const { guild, room, who } = setup("NUKER-1");
  await onAuditLogEntry(deleteChannel("NUKER-1") as never, guild);
  await settled();
  assert.deepEqual(who.roles.remove.calls[0][0], ["ROLE-A", "ROLE-B"]);
  assert.equal(who.timeout.calls.length, 1);
  const titles = room.sent.map((payload: { embeds: { toJSON(): { title: string } }[] }) => payload.embeds[0].toJSON().title);
  assert.ok(titles.some((title: string) => title.includes("Anti-nuke")), titles.join(" | "));
});

test("roles the bot cannot manage (above its own) are left alone", async () => {
  const guild = makeGuild();
  makeChannel(guild, "SEC", { type: ChannelType.GuildText });
  const who = makeMember(guild, "NUKER-2", { roles: ["LOW", "HIGH"] });
  who.roles.cache.get("HIGH").position = 500;
  who.roles.cache.get("LOW").position = 5;
  await onAuditLogEntry(deleteChannel("NUKER-2") as never, guild);
  await settled();
  assert.deepEqual(who.roles.remove.calls[0][0], ["LOW"]);
});

test("the owner, trusted people and trusted roles can delete channels freely", async () => {
  await useSettings({ nukeTrustedUserIds: ["FRIEND"], nukeTrustedRoleIds: ["TRUSTED"] });
  const { guild, room } = setup("OWN", { roles: [] });
  const friend = makeMember(guild, "FRIEND", { roles: ["ROLE-A"] });
  const staff = makeMember(guild, "STAFF", { roles: ["TRUSTED"] });
  for (const id of ["OWN", "FRIEND", "STAFF"]) await onAuditLogEntry(deleteChannel(id) as never, guild);
  await settled();
  assert.equal(friend.roles.remove.calls.length + staff.roles.remove.calls.length, 0);
  assert.equal(friend.timeout.calls.length + staff.timeout.calls.length, 0);
  assert.equal(room.sent.filter((payload: { embeds: { toJSON(): { title: string } }[] }) => payload.embeds[0].toJSON().title.includes("Anti-nuke")).length, 0);
});

test("a room the bot deletes itself (voice room, ticket) is not counted", async () => {
  const { guild, who } = setup("NUKER-3");
  noteChannelDeleted({ id: "temp-room" }, true);
  await onAuditLogEntry(deleteChannel("NUKER-3", "temp-room") as never, guild);
  await settled();
  assert.equal(who.roles.remove.calls.length, 0);
  assert.equal(who.timeout.calls.length, 0);
});

test("with the limit set to 2, one channel is fine and the second stops them", async () => {
  await useSettings({ nukeChannelLimit: 2 });
  const { guild, who } = setup("NUKER-4");
  await onAuditLogEntry(deleteChannel("NUKER-4", "a") as never, guild);
  await settled();
  assert.equal(who.timeout.calls.length, 0);
  await onAuditLogEntry(deleteChannel("NUKER-4", "b") as never, guild);
  await settled();
  assert.equal(who.timeout.calls.length, 1);
});

test("a limit outside 1-5 is pulled back into range", async () => {
  await useSettings({ nukeChannelLimit: 99 });
  const { guild, who } = setup("NUKER-5");
  for (const id of ["a", "b", "c", "d"]) await onAuditLogEntry(deleteChannel("NUKER-5", id) as never, guild);
  await settled();
  assert.equal(who.timeout.calls.length, 0, "4 deletions are under the cap of 5");
  await onAuditLogEntry(deleteChannel("NUKER-5", "e") as never, guild);
  await settled();
  assert.equal(who.timeout.calls.length, 1);
});

test("nothing happens while the anti-nuke is switched off", async () => {
  await useSettings({ antiNukeEnabled: false });
  const { guild, who } = setup("NUKER-6");
  await onAuditLogEntry(deleteChannel("NUKER-6") as never, guild);
  await settled();
  assert.equal(who.roles.remove.calls.length, 0);
  assert.equal(who.timeout.calls.length, 0);
});

test("a bot that deletes channels is kicked, not just timed out", async () => {
  const { guild, who } = setup("NUKER-BOT", { bot: true });
  await onAuditLogEntry(deleteChannel("NUKER-BOT") as never, guild);
  await settled();
  assert.equal(who.kick.calls.length, 1);
  assert.equal(who.timeout.calls.length, 0);
});

test("deleting roles is counted on its own (3 in a minute)", async () => {
  const { guild, who } = setup("NUKER-7");
  const role = (id: string) => ({ action: AuditLogEvent.RoleDelete, executorId: "NUKER-7", targetId: id, changes: [], reason: null });
  await onAuditLogEntry(role("r1") as never, guild);
  await onAuditLogEntry(role("r2") as never, guild);
  await settled();
  assert.equal(who.timeout.calls.length, 0);
  await onAuditLogEntry(role("r3") as never, guild);
  await settled();
  assert.equal(who.timeout.calls.length, 1);
});
