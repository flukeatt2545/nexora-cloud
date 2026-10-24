import { ChannelType, firstButtonId, lastEmbed, makeChannel, makeGuild, makeInteraction, makeMember, remaining, useSettings } from "./support";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { onPurgeButton, onPurgeCommand, onPurgeModal } from "../src/purge";

// /clear deletes messages and cannot be undone, so these tests cover who may do it, what it
// leaves alone, and the confirmations.

const DAY = 86400000;
const names = (count: number, prefix = "m") => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

function server() {
  const guild = makeGuild();
  const owner = makeMember(guild, "OWN", { admin: true });
  const chat = makeChannel(guild, "chat", { messages: Array.from({ length: 10 }, () => ({})) });
  return { guild, owner, chat };
}

async function command(guild: ReturnType<typeof makeGuild>, who: ReturnType<typeof makeMember>, options: Record<string, unknown>, channel?: unknown) {
  const interaction = makeInteraction(guild, who, { options, channel });
  await onPurgeCommand(interaction);
  return interaction;
}

async function press(guild: ReturnType<typeof makeGuild>, who: ReturnType<typeof makeMember>, customId: string) {
  const interaction = makeInteraction(guild, who, { customId });
  await onPurgeButton(interaction);
  return interaction;
}

beforeEach(() => useSettings({ securityChannelId: "SEC" }));

test("a number deletes that many of the newest messages straight away, keeping pins and bot panels", async () => {
  await useSettings({ securityChannelId: "SEC" }, { verify: { channelId: "chat", messageId: "chat-m1" } });
  const { guild, owner, chat } = server();
  chat.list[2].pinned = true;
  const done = await command(guild, owner, { count: 4 }, chat);
  assert.equal(lastEmbed(done).title, "🧹 ลบแล้ว 4 ข้อความ");
  assert.deepEqual(remaining(chat), ["chat-m1", "chat-m2", ...names(4, "chat-m").map((_, index) => `chat-m${index + 6}`)]);
});

test("only one person's messages go when a member is chosen", async () => {
  const guild = makeGuild();
  const owner = makeMember(guild, "OWN", { admin: true });
  const chat = makeChannel(guild, "chat", { messages: [{ author: "A" }, { author: "B" }, { author: "A" }, { author: "B" }] });
  await command(guild, owner, { count: 100, member: "A" }, chat);
  assert.deepEqual(remaining(chat), ["chat-m1", "chat-m3"]);
});

test("messages older than 14 days are deleted one by one instead of failing the bulk delete", async () => {
  const guild = makeGuild();
  const owner = makeMember(guild, "OWN", { admin: true });
  const chat = makeChannel(guild, "chat", { messages: [{}, {}, {}, { ageMs: 20 * DAY }, { ageMs: 21 * DAY }, { ageMs: 22 * DAY }] });
  const done = await command(guild, owner, { count: 100 }, chat);
  assert.equal(lastEmbed(done).title, "🧹 ลบแล้ว 6 ข้อความ");
  assert.deepEqual(chat.bulkCalls, [3]);
  assert.deepEqual(remaining(chat), []);
});

test("without a number it asks first and deletes nothing until the button is pressed", async () => {
  const { guild, owner, chat } = server();
  const asked = await command(guild, owner, {}, chat);
  assert.equal(remaining(chat).length, 10);
  assert.match(lastEmbed(asked).title, /ยืนยัน/);
  const go = await press(guild, owner, firstButtonId(asked));
  assert.equal(lastEmbed(go).title, "🧹 ลบแล้ว 10 ข้อความ");
});

test("cancel deletes nothing, and someone else cannot press my button", async () => {
  const { guild, owner, chat } = server();
  const stranger = makeMember(guild, "OTHER", { admin: true });
  const asked = await command(guild, owner, {}, chat);
  const go = firstButtonId(asked);
  const refused = await press(guild, stranger, go);
  assert.equal(lastEmbed(refused).title, "หมดอายุแล้ว");
  await press(guild, owner, go.replace(":go:", ":no:"));
  assert.equal(remaining(chat).length, 10);
  const reused = await press(guild, owner, go);
  assert.equal(lastEmbed(reused).title, "หมดอายุแล้ว", "a cancelled request cannot be used again");
});

test("someone without Manage Messages in the room is refused", async () => {
  const guild = makeGuild();
  const plain = makeMember(guild, "PLAIN");
  const chat = makeChannel(guild, "chat", { messages: [{}, {}], deny: ["PLAIN"] });
  const done = await command(guild, plain, { count: 5 }, chat);
  assert.equal(lastEmbed(done).title, "ใช้ไม่ได้");
  assert.equal(remaining(chat).length, 2);
});

test("the bot refuses when it lacks the rights to delete there", async () => {
  const guild = makeGuild();
  const owner = makeMember(guild, "OWN", { admin: true });
  const chat = makeChannel(guild, "chat", { messages: [{}, {}], botCan: false });
  const done = await command(guild, owner, { count: 5 }, chat);
  assert.equal(lastEmbed(done).title, "บอทลบไม่ได้");
  assert.equal(remaining(chat).length, 2);
});

test("clearing every room is refused for managers who are not owner or Administrator", async () => {
  const { guild } = server();
  const manager = makeMember(guild, "MANAGER", { roles: ["MANAGERS"] });
  await useSettings({ managerRoleIds: ["MANAGERS"] });
  for (const scope of ["all", "full"]) {
    const done = await command(guild, manager, { scope });
    assert.equal(lastEmbed(done).title, "ใช้ไม่ได้", scope);
  }
});

test("a scope cannot be combined with a room or a number", async () => {
  const { guild, owner, chat } = server();
  const done = await command(guild, owner, { scope: "all", count: 5 }, chat);
  assert.equal(lastEmbed(done).title, "เลือกซ้อนกัน");
  assert.equal(remaining(chat).length, 10);
});

function rooms() {
  const guild = makeGuild();
  const owner = makeMember(guild, "OWN", { admin: true });
  const chat = makeChannel(guild, "chat", { messages: [{ pinned: true }, {}, {}] });
  const log = makeChannel(guild, "SEC", { messages: [{}, {}] });
  const ticket = makeChannel(guild, "t-1", { parentId: "TICKETS", messages: [{}, {}] });
  const voiceChat = makeChannel(guild, "vc", { type: ChannelType.GuildVoice, messages: [{}, {}] });
  const locked = makeChannel(guild, "locked", { botCan: false, messages: [{}] });
  return { guild, owner, chat, log, ticket, voiceChat, locked };
}

test("\"all rooms\" skips the log room, ticket rooms and pins, and says which rooms it skipped", async () => {
  await useSettings({ securityChannelId: "SEC", ticketCategoryId: "TICKETS" });
  const { guild, owner, chat, log, ticket, voiceChat, locked } = rooms();
  const asked = await command(guild, owner, { scope: "all" });
  const done = await press(guild, owner, firstButtonId(asked));
  assert.deepEqual(remaining(chat), ["chat-m0"], "the pinned message stays");
  assert.equal(remaining(log).length, 2);
  assert.equal(remaining(ticket).length, 2);
  assert.equal(remaining(voiceChat).length, 2, "voice chats are not part of the plain scope");
  assert.equal(remaining(locked).length, 1);
  const skipped = lastEmbed(done).fields.filter((field: { name: string }) => field.name.startsWith("ข้ามห้อง")).map((field: { name: string }) => field.name);
  assert.equal(skipped.length, 3, "log rooms, ticket rooms, and the room the bot has no rights in: " + skipped.join(" | "));
});

test("\"everything\" needs the typed word, then clears every room including logs, tickets and pins", async () => {
  await useSettings({ securityChannelId: "SEC", ticketCategoryId: "TICKETS" });
  const { guild, owner, chat, log, ticket, voiceChat } = rooms();
  const asked = await command(guild, owner, { scope: "full" });
  const goId = firstButtonId(asked);

  const click = await press(guild, owner, goId);
  assert.ok(click.modal, "the button opens the form for the typed word");
  assert.equal(remaining(log).length, 2);

  const wrong = makeInteraction(guild, owner, { customId: goId.replace(":go:", ":text:"), fields: { word: "ลบ" } });
  await onPurgeModal(wrong);
  assert.equal(lastEmbed(wrong).title, "พิมพ์ไม่ตรง");
  assert.equal(remaining(log).length, 2);

  const right = makeInteraction(guild, owner, { customId: goId.replace(":go:", ":text:"), fields: { word: "ลบทั้งหมด" } });
  await onPurgeModal(right);
  assert.deepEqual([chat, log, ticket, voiceChat].map((channel) => remaining(channel).length), [0, 0, 0, 0]);
  assert.match(lastEmbed(right).title, /ลบแล้ว/);
});

test("\"everything\" still keeps the bot's own panels", async () => {
  await useSettings({}, { ticket: { channelId: "chat", messageId: "chat-m1" } });
  const { guild, owner, chat } = rooms();
  const asked = await command(guild, owner, { scope: "full" });
  const goId = firstButtonId(asked);
  await onPurgeModal(makeInteraction(guild, owner, { customId: goId.replace(":go:", ":text:"), fields: { word: "ลบทั้งหมด" } }));
  assert.deepEqual(remaining(chat), ["chat-m1"]);
});

test("the clean-up is reported to the security room", async () => {
  const guild = makeGuild();
  const owner = makeMember(guild, "OWN", { admin: true });
  const chat = makeChannel(guild, "chat", { messages: [{}, {}, {}] });
  const security = makeChannel(guild, "SEC", { type: ChannelType.GuildText });
  await command(guild, owner, { count: 2 }, chat);
  assert.equal(security.sent.length, 1);
  assert.match(security.sent[0].embeds[0].toJSON().description, /2/);
});
