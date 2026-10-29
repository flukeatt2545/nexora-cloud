import { Collection, makeGuild, makeInteraction, makeMember, reply, requests, requestsTo, spy, useSettings, lastEmbed } from "./support";
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { onVerify, VERIFY_MESSAGE_MS, verifyLinkMessage } from "../src/members";
import { giveVerifiedRoles } from "../src/verifyweb";

// Verifying on the website: the button hands out a link instead of the role, and the role comes
// only when the site says the member passed.

const ROLE = "ROLE";

function server() {
  const guild = makeGuild();
  guild.roles.cache.set(ROLE, { id: ROLE, position: 5, managed: false });
  return guild;
}

function person(guild: ReturnType<typeof makeGuild>, id: string, roles: string[] = []) {
  const member = makeMember(guild, id, { roles });
  member.roles.add = spy((roleId: string) => member.roles.cache.set(roleId, { id: roleId }));
  return member;
}

const sentRoleRequests = () => requestsTo("POST", "/verify/start");

beforeEach(async () => {
  requests.length = 0;
  await useSettings({ guildId: "G", verifyEnabled: true, memberRoleId: ROLE, verifyLevel: "standard", rolesChannelId: "", selfRoleIds: [] });
});

test("on the website levels the button gives a link and no role", async () => {
  reply("POST", "/api/internal/bot/community/verify/start", { url: "https://nkn02.com/verify/abc" });
  const guild = server();
  const member = person(guild, "U1");
  const click = makeInteraction(guild, member);
  await onVerify(click);

  assert.equal(member.roles.add.calls.length, 0);
  assert.deepEqual(sentRoleRequests().map((item) => item.body), [{ userId: "U1", username: "U1" }]);
  const answer = click.answers.at(-1);
  const button = answer.components[0].toJSON().components[0];
  assert.equal(button.url, "https://nkn02.com/verify/abc");
  assert.ok(answer.flags, "the link is private to the member");
});

test("the link message lists the steps and counts down to when the link and the message end", () => {
  const now = new Date("2026-10-28T04:16:00Z");
  const message = verifyLinkMessage("https://nkn02.com/verify/abc", 600, now);
  const embed = message.embeds[0].toJSON();
  const fields = Object.fromEntries((embed.fields ?? []).map((field) => [field.name, field.value]));
  const seconds = Math.floor(now.getTime() / 1000);
  assert.match(fields["ขั้นตอน"], /\*\*1\.\*\*[\s\S]*\*\*2\.\*\*[\s\S]*\*\*3\.\*\*/);
  assert.match(fields["ลิงก์"], new RegExp(`<t:${seconds + 600}:R>`));
  assert.match(fields["ข้อความนี้"], new RegExp(`<t:${seconds + VERIFY_MESSAGE_MS / 1000}:R>`));
  assert.match(embed.footer?.text ?? "", /อย่าส่งให้คนอื่น/);
  const button = message.components[0].toJSON().components[0] as { url: string; label: string };
  assert.equal(button.url, "https://nkn02.com/verify/abc");
  assert.equal(button.label, "เปิดหน้ายืนยัน");
});

test("the link message disappears after ten seconds, and a second click removes the first one at once", async () => {
  reply("POST", "/api/internal/bot/community/verify/start", { url: "https://nkn02.com/verify/abc" });
  const guild = server();
  const member = person(guild, "U1");
  const first = makeInteraction(guild, member);
  const second = makeInteraction(guild, member);
  first.deleteReply = spy();
  second.deleteReply = spy();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await onVerify(first);
    assert.equal(first.deleteReply.calls.length, 0, "still there right after it is sent");
    await onVerify(second);
    assert.equal(first.deleteReply.calls.length, 1, "the earlier message goes when a new one is sent");
    assert.equal(second.deleteReply.calls.length, 0);
    mock.timers.tick(VERIFY_MESSAGE_MS - 1);
    assert.equal(second.deleteReply.calls.length, 0);
    mock.timers.tick(1);
    assert.equal(second.deleteReply.calls.length, 1, "gone after ten seconds");
  } finally {
    mock.timers.reset();
  }
  assert.equal(VERIFY_MESSAGE_MS, 10000);
});

test("the plain button level still gives the role straight away", async () => {
  await useSettings({ guildId: "G", verifyEnabled: true, memberRoleId: ROLE, verifyLevel: "button", rolesChannelId: "", selfRoleIds: [] });
  const guild = server();
  const member = person(guild, "U1");
  await onVerify(makeInteraction(guild, member));
  assert.deepEqual(member.roles.add.calls.map((call: unknown[]) => call[0]), [ROLE]);
  assert.equal(sentRoleRequests().length, 0);
});

test("settings from before the levels existed behave like the plain button", async () => {
  await useSettings({ guildId: "G", verifyEnabled: true, memberRoleId: ROLE, verifyLevel: undefined, rolesChannelId: "", selfRoleIds: [] });
  const guild = server();
  const member = person(guild, "U1");
  await onVerify(makeInteraction(guild, member));
  assert.equal(member.roles.add.calls.length, 1);
});

test("a member who is already verified gets no new link", async () => {
  const guild = server();
  const member = person(guild, "U1", [ROLE]);
  const click = makeInteraction(guild, member);
  await onVerify(click);
  assert.equal(sentRoleRequests().length, 0);
  assert.equal(lastEmbed(click).title, "ยืนยันแล้ว");
});

test("when the site cannot make a link the member is told why", async () => {
  const axios = require("axios");
  const original = axios.create;
  axios.create = () => ({ post: () => Promise.reject(Object.assign(new Error("409"), { isAxiosError: true, response: { status: 409, data: { error: "ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ" } } })) });
  try {
    const guild = server();
    const click = makeInteraction(guild, person(guild, "U1"));
    await onVerify(click);
    assert.equal(lastEmbed(click).description, "ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ");
  } finally {
    axios.create = original;
  }
});

function clientOf(guild: ReturnType<typeof makeGuild>) {
  return { guilds: { cache: new Collection([[guild.id, guild]]) } } as never;
}

test("members who passed on the site get the role, and the site is told it is done", async () => {
  const guild = server();
  const waiting = person(guild, "U1");
  const already = person(guild, "U2", [ROLE]);
  reply("GET", "/api/internal/bot/community/verify/results", {
    items: [{ id: 1, userId: "U1", username: "a" }, { id: 2, userId: "U2", username: "b" }, { id: 3, userId: "GONE", username: "c" }],
  });
  await giveVerifiedRoles(clientOf(guild));

  assert.deepEqual(waiting.roles.add.calls.map((call: unknown[]) => call[0]), [ROLE]);
  assert.equal(already.roles.add.calls.length, 0);
  const ack = requestsTo("POST", "/verify/results/ack").pop();
  assert.deepEqual((ack?.body as { ids: number[] }).ids.sort(), [1, 2, 3], "one who left is let go too");
});

test("a role that fails is tried again, and given up on after a few rounds", async () => {
  const guild = server();
  const member = person(guild, "U9");
  member.roles.add = spy(() => { throw new Error("Missing Permissions"); });
  reply("GET", "/api/internal/bot/community/verify/results", { items: [{ id: 9, userId: "U9", username: "z" }] });
  const log = console.error;
  console.error = () => undefined;
  try {
    for (let round = 1; round <= 5; round++) {
      requests.length = 0;
      await giveVerifiedRoles(clientOf(guild));
      assert.equal(requestsTo("POST", "/verify/results/ack").length, round < 5 ? 0 : 1, `round ${round}`);
    }
  } finally {
    console.error = log;
  }
});
