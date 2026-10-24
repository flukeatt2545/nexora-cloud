import { ChannelType, makeChannel, makeGuild, makeMember, requestsTo, useSettings } from "./support";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { addPlace } from "../src/legacy/voice/places";
import { rememberHub } from "../src/legacy/voice/rooms";
import { onSessionVoiceState } from "../src/legacy/voice/sessions";

// The join/leave log: a card when someone comes in or changes rooms. Leaving is posted later,
// with how long they stayed, by the site's feed; here the bot only has to tell the site.

const voice = ChannelType.GuildVoice;
const room = (id: string, name: string) => ({ id, name, type: voice });

async function logged() {
  const guild = makeGuild();
  const log = makeChannel(guild, "LOG", { type: ChannelType.GuildText });
  await addPlace("voicelog", guild.id, "LOG", "log");
  return { guild, log };
}

const card = (log: { sent: { embeds: { toJSON(): Record<string, unknown> }[] }[] }, index = 0) =>
  log.sent[index].embeds[0].toJSON() as { author: { name: string }; description: string; fields: { name: string }[] };

before(() => useSettings());

test("coming in posts a card with who, which room and when", async () => {
  const { guild, log } = await logged();
  const member = makeMember(guild, "m-join");
  member.displayName = "F12";
  onSessionVoiceState({ channel: null, member } as never, { channel: room("r1", "ห้องของ F12"), member, guild } as never);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(log.sent.length, 1);
  assert.equal(card(log).author.name, "F12 เข้าห้องเสียง");
  assert.match(card(log).description, /ห้องของ F12/);
  assert.deepEqual(card(log).fields.map((field) => field.name), ["เวลา"]);
});

test("changing rooms posts one card that shows both rooms", async () => {
  const { guild, log } = await logged();
  const member = makeMember(guild, "m-move");
  onSessionVoiceState({ channel: room("r1", "ห้อง A"), member } as never, { channel: room("r2", "ห้อง B"), member, guild } as never);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(log.sent.length, 1);
  assert.match(card(log).author.name, /ย้ายห้องเสียง/);
  assert.match(card(log).description, /ห้อง A.*→.*ห้อง B/);
});

test("leaving posts no card now, but the site is told so the stay can be closed", async () => {
  const { guild, log } = await logged();
  const member = makeMember(guild, "m-leave");
  onSessionVoiceState({ channel: room("r1", "ห้อง A"), member } as never, { channel: null, member, guild } as never);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(log.sent.length, 0);
  const told = requestsTo("POST", "/voice/sessions/move").filter((item) => (item.body as { discordId: string }).discordId === "m-leave");
  assert.equal(told.length, 1);
  assert.equal((told[0].body as { channelId: string }).channelId, "");
});

test("passing through a Join to Create room is not counted as a stay", async () => {
  const { guild, log } = await logged();
  rememberHub("hub-1");
  const member = makeMember(guild, "m-hub");
  onSessionVoiceState({ channel: null, member } as never, { channel: room("hub-1", "+ คลิกเพื่อสร้างห้อง"), member, guild } as never);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(log.sent.length, 0);
  assert.equal(requestsTo("POST", "/voice/sessions/move").filter((item) => (item.body as { discordId: string }).discordId === "m-hub").length, 0);
});

test("bots and moves within the same room are ignored", async () => {
  const { guild, log } = await logged();
  const bot = makeMember(guild, "bot-1", { bot: true });
  onSessionVoiceState({ channel: null, member: bot } as never, { channel: room("r1", "ห้อง A"), member: bot, guild } as never);
  const person = makeMember(guild, "m-same");
  onSessionVoiceState({ channel: room("r1", "ห้อง A"), member: person } as never, { channel: room("r1", "ห้อง A"), member: person, guild } as never);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(log.sent.length, 0);
});

test("without a log channel nothing is posted but the stay is still recorded", async () => {
  const guild = makeGuild({ id: "G2" });
  const member = makeMember(guild, "m-nolog");
  onSessionVoiceState({ channel: null, member } as never, { channel: room("r1", "ห้อง A"), member, guild } as never);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestsTo("POST", "/voice/sessions/move").filter((item) => (item.body as { discordId: string }).discordId === "m-nolog").length, 1);
});
