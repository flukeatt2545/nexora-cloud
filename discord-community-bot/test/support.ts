// Shared set-up for the tests: import this file FIRST in every test file.
//
// - The bot talks to the site through axios; here that goes to a recorder with canned replies.
// - settings.ts keeps a copy on disk; it is pointed at a throw-away folder so a test never touches
//   the copy a real bot on this machine would read.
// - The builders make small stand-ins for the discord.js objects the modules use (guild, member,
//   channel, message, interaction). They are plain objects with just what the code reads, so a
//   test shows exactly which parts of Discord the code depends on.
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

const scratch = mkdtempSync(path.join(os.tmpdir(), "nexora-bot-test-"));
process.env.TEMP = process.env.TMP = process.env.TMPDIR = scratch;
export const BOT_ADMIN_ID = "999999999999999999";
process.env.COMMUNITY_DISCORD_ADMIN_IDS = BOT_ADMIN_ID;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = require("axios");

type Request = { method: string; url: string; body: unknown };
export const requests: Request[] = [];
const replies = new Map<string, unknown>();

/** Answers `METHOD /path` (a prefix of the url is enough) with this data in later tests. */
export function reply(method: string, url: string, data: unknown) {
  replies.set(`${method.toUpperCase()} ${url}`, data);
}

function answer(method: string, url: string, body: unknown) {
  requests.push({ method, url, body });
  const key = [...replies.keys()].filter((item) => item.startsWith(`${method} `) && url.startsWith(item.slice(method.length + 1))).sort((a, b) => b.length - a.length)[0];
  return Promise.resolve({ data: key ? replies.get(key) : {} });
}

axios.create = () => ({
  get: (url: string) => answer("GET", url, undefined),
  post: (url: string, body: unknown) => answer("POST", url, body),
  put: (url: string, body: unknown) => answer("PUT", url, body),
  patch: (url: string, body: unknown) => answer("PATCH", url, body),
  delete: (url: string) => answer("DELETE", url, undefined),
});

export function requestsTo(method: string, urlPart: string) {
  return requests.filter((item) => item.method === method && item.url.includes(urlPart));
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Collection, ChannelType } = require("discord.js") as typeof import("discord.js");
export { Collection, ChannelType };

/** Loads settings the way the bot does (from the site's answer), on top of quiet defaults. */
export async function useSettings(partial: Record<string, unknown> = {}, panels: Record<string, unknown> = {}) {
  const none = { channelId: "", messageId: "" };
  reply("GET", "/api/internal/bot/community/settings", {
    version: Date.now() + Math.random(),
    settings: {
      guildId: "G", securityEnabled: true, securityChannelId: "SEC", securitySiteEvents: false, securitySiteChannelId: "",
      antiNukeEnabled: true, nukeChannelLimit: 1, nukeTrustedUserIds: [], nukeTrustedRoleIds: [],
      managerRoleIds: [], staffRoleIds: [], usageRoleIds: [], ticketCategoryId: "", ticketLogChannelId: "",
      tempVoiceEnabled: false, tempHubChannelId: "", tempNameTemplate: "ห้องของ {user}",
      ...partial,
    },
    panels: { verify: none, roles: none, ticket: none, status: none, boost: none, roleCheck: none, ...panels },
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  await (require("../src/settings") as typeof import("../src/settings")).loadSettings();
}

type Spy<T extends unknown[] = unknown[]> = ((...args: T) => Promise<unknown>) & { calls: T[] };
export function spy<T extends unknown[] = unknown[]>(result?: (...args: T) => unknown): Spy<T> {
  const fn = ((...args: T) => {
    fn.calls.push(args);
    return Promise.resolve(result ? result(...args) : undefined);
  }) as Spy<T>;
  fn.calls = [];
  return fn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function makeGuild(options: { id?: string; ownerId?: string } = {}): Any {
  const guild: Any = {
    id: options.id ?? "G",
    name: "NEXORA",
    ownerId: options.ownerId ?? "OWN",
    client: { user: { id: "BOT" }, channels: { fetch: async (id: string) => guild.channels.cache.get(id) ?? null } },
    channels: {
      cache: new Collection(),
      created: [] as Any[],
      create: async (input: Any) => {
        const made = makeChannel(guild, `new${guild.channels.created.length + 1}`, { type: input.type, name: input.name, parentId: input.parent ?? null });
        guild.channels.created.push({ ...input, id: made.id });
        return made;
      },
    },
    roles: { cache: new Collection(), everyone: { id: options.id ?? "G" } },
    members: {
      cache: new Collection(),
      fetch: async (id: string) => guild.members.cache.get(id) ?? null,
      me: undefined as Any,
    },
  };
  guild.members.me = makeMember(guild, "BOT", { topRole: 100, bot: true });
  return guild;
}

/** A member. `topRole` is the position of their highest role; `roles` are extra role ids they hold. */
export function makeMember(guild: Any, id: string, options: { roles?: string[]; admin?: boolean; bot?: boolean; topRole?: number } = {}): Any {
  const held = new Collection<string, Any>();
  held.set(guild.id, { id: guild.id, position: 0, managed: false });
  (options.roles ?? []).forEach((roleId, index) => held.set(roleId, { id: roleId, position: (options.topRole ?? 10) - index, managed: false }));
  const member: Any = {
    id, guild, displayName: id, user: { id, username: id, bot: options.bot ?? false },
    displayAvatarURL: () => `https://cdn.test/${id}.png`,
    permissions: { has: () => Boolean(options.admin) },
    roles: { cache: held, highest: { position: options.topRole ?? 10 }, remove: spy() },
    kickable: true, moderatable: true, kick: spy(), timeout: spy(), send: spy(),
    voice: { setChannel: spy(), disconnect: spy() },
  };
  guild.members.cache.set(id, member);
  return member;
}

type Message = { id: string; author: string; pinned: boolean; ageMs: number; bot: boolean; embedTitle: string; components: number };
type MessageSpec = Partial<Message>;

/**
 * A text channel (or the chat of a voice channel) with messages, newest first. Messages younger
 * than 14 days go through bulkDelete like on Discord; older ones throw there, so the code has to
 * delete those one by one.
 */
export function makeChannel(guild: Any, id: string, options: { type?: number; name?: string; parentId?: string | null; messages?: MessageSpec[]; botCan?: boolean; deny?: string[] } = {}): Any {
  const now = Date.now();
  const list: Any[] = (options.messages ?? []).map((spec, index) => makeMessage(`${id}-m${index}`, { ageMs: index * 1000, ...spec }, now));
  const channel: Any = {
    id, guild, guildId: guild.id, name: options.name ?? id, type: options.type ?? ChannelType.GuildText,
    parentId: options.parentId ?? null, rawPosition: guild.channels.cache.size,
    isDMBased: () => false, isTextBased: () => true,
    permissionsFor: (who: Any) => ({ has: () => (who?.id === "BOT" ? options.botCan ?? true : !(options.deny ?? []).includes(who?.id)) }),
    sent: [] as Any[], bulkCalls: [] as number[], list,
    send: async (payload: Any) => { channel.sent.push(payload); return { id: `sent${channel.sent.length}` }; },
    messages: {
      // Like Discord: "before" is a position in the history, whether or not that message still exists.
      fetch: async ({ limit, before }: { limit: number; before?: string }) => {
        const start = before ? list.findIndex((message) => message.id === before) + 1 : 0;
        return new Collection<string, Any>(list.slice(start).filter((message) => !message.deleted).slice(0, limit).map((message) => [message.id, message]));
      },
    },
    bulkDelete: async (messages: Any[]) => {
      const gone = new Collection<string, Any>();
      for (const message of messages) {
        if (now - message.createdTimestamp > 14 * 86400000) throw new Error("bulkDelete got a message older than 14 days");
        if (!message.deleted) { message.deleted = true; gone.set(message.id, message); }
      }
      channel.bulkCalls.push(gone.size);
      return gone;
    },
    setParent: spy((parent: string) => { channel.parentId = parent; }),
    permissionOverwrites: { edit: spy(), delete: spy(), cache: new Collection() },
    members: new Collection(),
  };
  guild.channels.cache.set(id, channel);
  return channel;
}

export function makeMessage(id: string, spec: MessageSpec = {}, now = Date.now()): Any {
  const message: Any = {
    id, pinned: spec.pinned ?? false, deletable: true, createdTimestamp: now - (spec.ageMs ?? 0),
    author: { id: spec.author ?? "A" }, client: { user: { id: "BOT" } },
    components: Array.from({ length: spec.components ?? 0 }, () => ({})),
    embeds: spec.embedTitle ? [{ title: spec.embedTitle }] : [],
    deleted: false,
  };
  if (spec.bot) message.author = { id: "BOT" };
  message.delete = async () => { message.deleted = true; return message; };
  return message;
}

/** Ids of the messages still in the channel. */
export function remaining(channel: Any) {
  return channel.list.filter((message: Any) => !message.deleted).map((message: Any) => message.id) as string[];
}

export type Fake = Any;

/** A slash command, button or form submit from `member`; what the code answers ends up in `.answers`. */
export function makeInteraction(guild: Any, member: Any, options: { options?: Record<string, unknown>; customId?: string; channel?: Any; fields?: Record<string, string> } = {}): Any {
  const given = options.options ?? {};
  const interaction: Any = {
    guild, client: guild.client, channel: options.channel ?? null, member, user: member.user, customId: options.customId ?? "",
    answers: [] as Any[], modal: null as Any,
    options: {
      getString: (name: string) => given[name] ?? null,
      getInteger: (name: string) => given[name] ?? null,
      getBoolean: (name: string) => given[name] ?? null,
      getUser: (name: string) => (given[name] ? { id: given[name] } : null),
      getChannel: (name: string) => (given[name] ? { id: given[name] } : null),
    },
    fields: { getTextInputValue: (name: string) => options.fields?.[name] ?? "" },
    isFromMessage: () => true,
    showModal: async (modal: Any) => { interaction.modal = modal; },
  };
  for (const name of ["reply", "update", "editReply", "deferReply"]) {
    interaction[name] = async (payload: Any) => { interaction.answers.push({ via: name, ...payload }); };
  }
  return interaction;
}

/** The embed of the last thing the code said (title and fields as plain data). */
export function lastEmbed(interaction: Any) {
  const answer = [...interaction.answers].reverse().find((item: Any) => item.embeds?.length);
  return answer?.embeds[0].toJSON ? answer.embeds[0].toJSON() : answer?.embeds[0];
}

/** The custom id of the first button on the last answer. */
export function firstButtonId(interaction: Any) {
  const answer = [...interaction.answers].reverse().find((item: Any) => item.components?.length);
  return answer.components[0].toJSON().components[0].custom_id as string;
}
