import { ChannelType, makeChannel, makeGuild, makeMember, reply, requestsTo, useSettings } from "./support";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { PermissionFlagsBits } from "discord.js";
import { PRIVATE_CATEGORY_NAME, PUBLIC_CATEGORY_NAME } from "../src/legacy/voice/config";
import { isHub, onVoiceState, rememberRoom, setLocked } from "../src/legacy/voice/rooms";

// The password voice rooms: which category a room sits in, what the ➕ room makes, and what
// someone sees when they walk into a closed room.

const voice = ChannelType.GuildVoice;
const categoryNamed = (guild: ReturnType<typeof makeGuild>, name: string) => guild.channels.created.find((item: { name: string }) => item.name === name);

beforeEach(() => useSettings());

test("opening a room moves it to the public category, locking it moves it back to the private one", async () => {
  const guild = makeGuild();
  const room = makeChannel(guild, "room", { type: voice });
  await setLocked(room, false);
  assert.equal(room.parentId, categoryNamed(guild, PUBLIC_CATEGORY_NAME).id);
  await setLocked(room, true, true);
  assert.equal(room.parentId, categoryNamed(guild, PRIVATE_CATEGORY_NAME).id);
});

test("the two categories are made once and then reused", async () => {
  const guild = makeGuild();
  const room = makeChannel(guild, "room", { type: voice });
  for (const locked of [false, true, false, true]) await setLocked(room, locked, true);
  assert.equal(guild.channels.created.length, 2);
});

test("categories that already exist are used instead of making new ones", async () => {
  const guild = makeGuild();
  makeChannel(guild, "cat-public", { type: ChannelType.GuildCategory, name: PUBLIC_CATEGORY_NAME });
  makeChannel(guild, "cat-private", { type: ChannelType.GuildCategory, name: PRIVATE_CATEGORY_NAME });
  const room = makeChannel(guild, "room", { type: voice });
  await setLocked(room, false);
  assert.equal(room.parentId, "cat-public");
  assert.equal(guild.channels.created.length, 0);
  assert.deepEqual(room.setParent.calls[0][1], { lockPermissions: false, reason: room.setParent.calls[0][1].reason }, "the room keeps its own permissions");
});

test("the ➕ room makes a closed password room in the private category, named from the template", async () => {
  await useSettings({ tempVoiceEnabled: true, tempHubChannelId: "HUB", tempNameTemplate: "🎧 {user}" });
  reply("POST", "/api/internal/bot/voice/rooms", { id: 7, name: "🎧 Alice" });
  const guild = makeGuild();
  const hub = makeChannel(guild, "HUB", { type: voice, parentId: "SOMEWHERE" });
  const alice = makeMember(guild, "alice-id");
  alice.displayName = "Alice";
  await onVoiceState({ channelId: null, channel: null } as never, { channelId: "HUB", channel: hub, member: alice } as never);

  assert.equal(requestsTo("POST", "/api/internal/bot/voice/rooms")[0].body && (requestsTo("POST", "/api/internal/bot/voice/rooms")[0].body as { name: string }).name, "🎧 Alice");
  const made = guild.channels.created.find((item: { type: number }) => item.type === voice);
  assert.equal(made.parent, categoryNamed(guild, PRIVATE_CATEGORY_NAME).id);
  const everyone = made.permissionOverwrites.find((item: { id: string }) => item.id === guild.id);
  assert.ok(everyone.deny & PermissionFlagsBits.Connect, "closed to everyone else");
  const owner = made.permissionOverwrites.find((item: { id: string }) => item.id === "alice-id");
  assert.ok(owner.allow & PermissionFlagsBits.Connect, "open to the owner");
  assert.equal(alice.voice.setChannel.calls[0][0].id, made.id, "the owner is moved in");
  const panel = guild.channels.cache.get(made.id).sent[0];
  assert.match(JSON.stringify(panel.components[0].toJSON()), /จัดการห้อง/);
});

test("the ➕ room turns away members who do not have a role allowed to make rooms", async () => {
  await useSettings({ tempVoiceEnabled: true, tempHubChannelId: "HUB", usageRoleIds: ["MEMBERS"] });
  const guild = makeGuild();
  const hub = makeChannel(guild, "HUB", { type: voice });
  const bob = makeMember(guild, "bob-id");
  const before = requestsTo("POST", "/api/internal/bot/voice/rooms").length;
  await onVoiceState({ channelId: null, channel: null } as never, { channelId: "HUB", channel: hub, member: bob } as never);
  assert.equal(bob.voice.disconnect.calls.length, 1);
  assert.equal(requestsTo("POST", "/api/internal/bot/voice/rooms").length, before);
  assert.equal(guild.channels.created.length, 0);
});

test("the ➕ room is only a hub while the temporary rooms feature is on", async () => {
  await useSettings({ tempVoiceEnabled: true, tempHubChannelId: "HUB" });
  assert.equal(isHub("HUB"), true);
  assert.equal(isHub("somewhere-else"), false);
  await useSettings({ tempVoiceEnabled: false, tempHubChannelId: "HUB" });
  assert.equal(isHub("HUB"), false);
});

async function walkIn(options: { hasPassword: boolean; roomId: string }) {
  reply("GET", "/api/internal/bot/voice/check", { allowed: false });
  const guild = makeGuild();
  const room = makeChannel(guild, options.roomId, { type: voice });
  rememberRoom(room.id, { id: 1, ownerId: "owner-id", name: "ห้องลับ", locked: true, hasPassword: options.hasPassword, kind: "command" });
  const visitor = makeMember(guild, `visitor-${options.roomId}`);
  await onVoiceState({ channelId: null, channel: null } as never, { channelId: room.id, channel: room, member: visitor } as never);
  return { visitor, card: visitor.send.calls[0]?.[0] };
}

test("walking into a locked room without the password gets you moved out, with a card that says what to do", async () => {
  const { visitor, card } = await walkIn({ hasPassword: true, roomId: "locked-room" });
  assert.equal(visitor.voice.disconnect.calls.length, 1);
  const embed = card.embeds[0].toJSON();
  assert.match(embed.title, /ล็อกอยู่/);
  assert.match(embed.description, /ขอรหัสจากเจ้าของห้อง/);
  assert.deepEqual(embed.fields.map((field: { name: string }) => field.name), ["ห้อง", "เซิร์ฟเวอร์"]);
  assert.match(JSON.stringify(card.components[0].toJSON()), /discord\.com\/channels\//);
});

test("a closed room without a password says to wait for the owner instead", async () => {
  const { card } = await walkIn({ hasPassword: false, roomId: "closed-room" });
  const embed = card.embeds[0].toJSON();
  assert.match(embed.title, /ยังไม่เปิด/);
  assert.doesNotMatch(embed.description, /ขอรหัส/);
});

test("the owner walks into their own closed room without being checked", async () => {
  const guild = makeGuild();
  const room = makeChannel(guild, "own-room", { type: voice });
  rememberRoom(room.id, { id: 2, ownerId: "owner-id", name: "ของฉัน", locked: true, hasPassword: true, kind: "command" });
  const owner = makeMember(guild, "owner-id");
  await onVoiceState({ channelId: null, channel: null } as never, { channelId: room.id, channel: room, member: owner } as never);
  assert.equal(owner.voice.disconnect.calls.length, 0);
});
