import { Collection, makeGuild, reply, requestsTo, spy } from "./support";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AutoModerationRuleTriggerType } from "discord.js";
import { syncProtection } from "../src/legacy/voice/protect";

// The bot keeps Discord's AutoMod rules in line with the web page. A server can have only one
// spam rule and one mention rule, so the bot must find its own earlier rules (even ones made by
// the voice bot that used to be a bot of its own) and must not try to make a second one.

let version = 0;

type Rule = { id: string; name: string; creatorId: string; triggerType: number; edit: ReturnType<typeof spy>; delete: ReturnType<typeof spy> };
const rule = (id: string, name: string, triggerType: number, creatorId = "BOT"): Rule => ({ id, name, creatorId, triggerType, edit: spy(), delete: spy() });

function server(rules: Rule[], options: { canManage?: boolean } = {}) {
  const guild = makeGuild({ id: `AM-${++version}` });
  guild.members.me.permissions.has = () => options.canManage ?? true;
  guild.autoModerationRules = {
    fetch: async () => new Collection(rules.map((item) => [item.id, item])),
    create: spy((input: { name: string }) => ({ id: `made-${input.name}` })),
  };
  return guild;
}

async function sync(guild: ReturnType<typeof makeGuild>, wanted: Record<string, unknown>) {
  reply("GET", "/api/internal/bot/protect/settings", {
    protectChannels: true, blockLinks: false, allowedDomains: [], blockInvites: false, blockSpam: false, mentionLimit: 0,
    blockedWords: [], floodEnabled: false, floodMessages: 6, floodSeconds: 5, floodTimeoutMinutes: 5, version: ++version, ...wanted,
  });
  await syncProtection({ guilds: { cache: new Collection([[guild.id, guild]]) } } as never);
  const status = requestsTo("POST", "/protect/status").filter((item) => (item.body as { guildId: string }).guildId === guild.id).pop();
  return (status?.body as { problems: string[] }).problems;
}

const created = (guild: ReturnType<typeof makeGuild>) => guild.autoModerationRules.create.calls.map((call: [{ name: string }]) => call[0].name) as string[];

test("rules the bot has not made yet are created", async () => {
  const guild = server([]);
  const problems = await sync(guild, { blockSpam: true, mentionLimit: 5 });
  assert.deepEqual(created(guild).sort(), ["NEXORA · สแปม", "NEXORA · แท็กหลายคน"].sort());
  assert.deepEqual(problems.filter((text) => text.includes("ตั้งกฎ")), []);
});

test("its own earlier rule is updated, even one made by the voice bot that used to be separate", async () => {
  const old = rule("r1", "NEXORA · สแปม", AutoModerationRuleTriggerType.Spam, "OLD-VOICE-BOT");
  const guild = server([old, rule("r2", "NEXORA · แท็กหลายคน", AutoModerationRuleTriggerType.MentionSpam, "OLD-VOICE-BOT")]);
  const problems = await sync(guild, { blockSpam: true, mentionLimit: 5 });
  assert.deepEqual(created(guild), [], "a second spam rule would be refused by Discord");
  assert.equal(old.edit.calls.length, 1);
  assert.deepEqual(problems.filter((text) => text.includes("ตั้งกฎ")), []);
});

test("a spam rule the server made itself is left alone, and the page is told why", async () => {
  const theirs = rule("r1", "Block spam", AutoModerationRuleTriggerType.Spam, "AN-ADMIN");
  const guild = server([theirs]);
  const problems = await sync(guild, { blockSpam: true });
  assert.deepEqual(created(guild), []);
  assert.equal(theirs.edit.calls.length + theirs.delete.calls.length, 0);
  assert.ok(problems.some((text) => text.includes("สแปม") && text.includes("มีกฎแบบนี้อยู่แล้ว")), problems.join(" | "));
});

test("turning a rule off removes the bot's rule and nothing else", async () => {
  const ours = rule("r1", "NEXORA · สแปม", AutoModerationRuleTriggerType.Spam);
  const theirs = rule("r2", "Block spam", AutoModerationRuleTriggerType.MentionSpam, "AN-ADMIN");
  const guild = server([ours, theirs]);
  await sync(guild, { blockSpam: false, mentionLimit: 0 });
  assert.equal(ours.delete.calls.length, 1);
  assert.equal(theirs.delete.calls.length, 0);
});

test("without the right to manage the server the bot does not touch any rule", async () => {
  const guild = server([], { canManage: false });
  const problems = await sync(guild, { blockSpam: true });
  assert.deepEqual(created(guild), []);
  assert.ok(problems.some((text) => text.includes("ยังไม่มีสิทธิ์")));
});
