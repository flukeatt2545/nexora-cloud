import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  escapeMarkdown,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type Message,
  type NonThreadGuildBasedChannel,
  type VoiceChannel,
} from "discord.js";
import { api, logBotError } from "./api";
import { buildMessage, loadMessages, messageVersion, OLD_LOG_TITLE, type MessageKey } from "./messages";
import { HUB_NAME, OLD_HUB_NAMES, rememberHub, setHubs } from "./rooms";
import { protectSettings, reportProtection } from "./protect";
import { channelRestored, isTrusted, wasThrowaway } from "../../trust";
import { postSessionFeed, useVoiceLogLookup } from "./sessions";
import { COLOR } from "./ui";

// Channels the bot uses, kept in the site's database so they survive a restart:
//   hub    "+ คลิกเพื่อสร้างห้อง" (Join to Create)
//   panel  a channel with the button panel; messageId is the panel message
//   log    where room events are posted (one per server); messageId is the welcome message
//   voicelog  where joins and leaves are posted (one per server); messageId is its welcome
// Every server the bot is in has its own.
// Rows of other kinds were written by an earlier version and are cleared on the next check.

type Place = { kind: string; channelId: string; guildId: string; messageId: string; messageVersion: number };

export type RoomEvent = {
  id: number;
  guildId: string;
  roomName: string;
  ownerDiscordId: string;
  action: string;
  actorDiscordId: string;
  memberDiscordId: string;
  detail: string;
  createdAt: string;
};

let running = false;
// Panel messages the site knows about, so a pressed panel is only reported once.
const knownPanels = new Set<string>();
// Log channels already searched for a welcome posted before its message id was kept.
const searchedLogs = new Set<string>();
// A posted message that could not be edited is tried again after a minute, not every check.
const retryAt = new Map<string, number>();
// The bot's channels by channel id, from the last check: these are protected from deletion.
const known = new Map<string, Place>();
// Channels being put back after someone deleted them, so the check does not forget them meanwhile.
const restoring = new Set<string>();

/** A server's join/leave log channel, if one is set. */
function voiceLogChannel(guild: Guild) {
  for (const place of known.values()) {
    if (place.kind !== "voicelog" || place.guildId !== guild.id) continue;
    const channel = guild.channels.cache.get(place.channelId);
    if (channel?.isTextBased()) return channel;
  }
  return undefined;
}
useVoiceLogLookup(voiceLogChannel);

/** The rooms of the bot's panels and logs (a message clean-up leaves them alone). */
export function botPlaceChannelIds() {
  return [...known.values()].filter((place) => place.kind !== "hub").map((place) => place.channelId);
}

export async function addPlace(kind: "hub" | MessageKey, guildId: string, channelId: string, name: string, messageId = "", messageVersion = 0) {
  await api().post("/api/internal/bot/voice/places", { kind, guildId, channelId, name, messageId, messageVersion });
  if (kind === "panel" && messageId) knownPanels.add(messageId);
  // A server has one room log and one join/leave log: a new one replaces the old.
  if (kind === "log" || kind === "voicelog") {
    for (const [id, place] of known) if (place.kind === kind && place.guildId === guildId) known.delete(id);
  }
  known.set(channelId, { kind, guildId, channelId, messageId, messageVersion });
}

function forgetPlace(place: Place) {
  return api().delete(`/api/internal/bot/voice/places/${place.kind}/${place.channelId}`).catch((error) => logBotError("forget place", error));
}

function noteApplied(place: Place, messageId: string, version: number) {
  return api().post("/api/internal/bot/voice/places/applied", { kind: place.kind, channelId: place.channelId, messageId, version });
}

/** Someone pressed the buttons on a panel posted before panels were kept: keep this one now. */
export function notePanel(message: Message) {
  if (!message.guildId || knownPanels.has(message.id) || message.flags.has("Ephemeral")) return;
  knownPanels.add(message.id);
  const name = "name" in message.channel ? message.channel.name ?? "" : "";
  addPlace("panel", message.guildId, message.channelId, name, message.id).catch((error) => {
    knownPanels.delete(message.id);
    logBotError("note panel", error);
  });
}

/** Edits a posted panel or log welcome to the title, text and picture set on the web page. */
async function refreshMessage(place: Place, channel: GuildBasedChannel) {
  const key = `${place.kind}:${place.channelId}`;
  if ((retryAt.get(key) ?? 0) > Date.now() || !("messages" in channel)) return;
  const { version, complete, payload } = await buildMessage(place.kind as MessageKey);
  try {
    // attachments: [] drops the old picture; files adds the new one.
    await channel.messages.edit(place.messageId, { ...payload, attachments: [] });
    if (complete) await noteApplied(place, place.messageId, version);
    else retryAt.set(key, Date.now() + 60000);
  } catch (error) {
    // 10008: the message was deleted in Discord. A panel without its message is no use; the
    // log channel stays, it just has no welcome to update.
    if ((error as { code?: number })?.code === 10008) {
      if (place.kind === "panel") await forgetPlace(place);
      else await noteApplied(place, "", version);
      return;
    }
    retryAt.set(key, Date.now() + 60000);
    logBotError("update posted message", error);
  }
}

/** A log channel set before its welcome's id was kept: find that welcome so it can be updated. */
async function findOldWelcome(place: Place, channel: GuildBasedChannel) {
  if (searchedLogs.has(place.channelId) || !("messages" in channel)) return;
  searchedLogs.add(place.channelId);
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const welcome = recent?.find((message) => message.author.id === channel.client.user.id && message.embeds[0]?.title === OLD_LOG_TITLE);
  if (welcome) await noteApplied(place, welcome.id, 0);
}

/**
 * Every few seconds: keep the Join to Create list, forget channels deleted in Discord, bring the
 * posted panels and log welcome up to date, and post new room events to the log channel.
 */
export async function syncPlaces(client: Client) {
  if (running) return;
  running = true;
  try {
    await loadMessages().catch((error) => logBotError("load messages", error));
    const res = await api().get<{ places: Place[] }>("/api/internal/bot/voice/places");
    const hubs: string[] = [];
    const logs = new Map<string, GuildBasedChannel>();
    const voiceLogs = new Map<string, GuildBasedChannel>();
    const list = res.data?.places ?? [];
    known.clear();
    for (const place of list) if (!restoring.has(place.channelId)) known.set(place.channelId, place);
    for (const place of list) {
      const guild = client.guilds.cache.get(place.guildId);
      if (!guild || restoring.has(place.channelId)) continue;
      const channel = guild.channels.cache.get(place.channelId);
      // Gone while the bot was away (it was not there to put it back), or a kind no longer used.
      if (!channel || !["hub", "panel", "log", "voicelog"].includes(place.kind)) {
        known.delete(place.channelId);
        await forgetPlace(place);
        continue;
      }
      if (place.kind === "hub") {
        hubs.push(channel.id);
        if (OLD_HUB_NAMES.has(channel.name)) await (channel as VoiceChannel).setName(HUB_NAME, "ชื่อห้อง Join to Create ใหม่").catch(() => undefined);
        continue;
      }
      if (place.kind === "panel") knownPanels.add(place.messageId);
      if (place.kind === "log" && channel.isTextBased()) logs.set(place.guildId, channel);
      if (place.kind === "voicelog" && channel.isTextBased()) voiceLogs.set(place.guildId, channel);
      if (!place.messageId) {
        if (place.kind === "log") await findOldWelcome(place, channel);
      } else if (place.messageVersion < messageVersion(place.kind as MessageKey)) {
        await refreshMessage(place, channel);
      }
    }
    setHubs(hubs);
    if (logs.size) await postFeed(logs);
    if (voiceLogs.size) await postSessionFeed(voiceLogs);
  } catch (error) {
    logBotError("sync places", error);
  } finally {
    running = false;
  }
}

// Protection: the bot's channels are put back when someone deletes them.

const placeNames: Record<string, string> = {
  hub: "ห้อง + คลิกเพื่อสร้างห้อง",
  panel: "ห้องแผงปุ่ม",
  log: "ห้อง log",
  voicelog: "ห้องประวัติเข้าออก",
};

/** Who deleted a channel, from the server's audit log (needs View Audit Log). */
async function findDeleter(channel: NonThreadGuildBasedChannel) {
  const me = channel.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
  // The audit log entry can lag the delete event by a moment.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 6 }).catch(() => null);
  const entry = logs?.entries.find((item) => item.targetId === channel.id && Date.now() - item.createdTimestamp < 60000);
  return entry?.executor ?? null;
}

/** A new channel like the deleted one: name, type, category, position and permissions. */
async function recreate(channel: NonThreadGuildBasedChannel) {
  const guild = channel.guild;
  const parent = channel.parentId && guild.channels.cache.has(channel.parentId) ? channel.parentId : null;
  const permissionOverwrites = channel.permissionOverwrites.cache
    // Overwrites for roles deleted since would make Discord refuse the whole channel.
    .filter((item) => item.type !== OverwriteType.Role || guild.roles.cache.has(item.id))
    .map((item) => ({ id: item.id, type: item.type, allow: item.allow.bitfield, deny: item.deny.bitfield }));
  const base = { name: channel.name, parent, position: channel.rawPosition, permissionOverwrites, reason: "สร้างคืน หลังมีคนลบห้องของบอท" };
  if (channel.type === ChannelType.GuildVoice) return guild.channels.create({ ...base, type: ChannelType.GuildVoice, userLimit: channel.userLimit });
  if (channel.type === ChannelType.GuildText) {
    return guild.channels.create({ ...base, type: ChannelType.GuildText, topic: channel.topic ?? undefined, nsfw: channel.nsfw, rateLimitPerUser: channel.rateLimitPerUser });
  }
  if (channel.type === ChannelType.GuildAnnouncement) return guild.channels.create({ ...base, type: ChannelType.GuildAnnouncement, topic: channel.topic ?? undefined });
  if (channel.type === ChannelType.GuildStageVoice) return guild.channels.create({ ...base, type: ChannelType.GuildStageVoice });
  if (channel.type === ChannelType.GuildCategory) {
    const { parent: _parent, ...rest } = base;
    void _parent;
    return guild.channels.create({ ...rest, type: ChannelType.GuildCategory });
  }
  // Forums, media channels and the like are left alone (logged as not put back).
  return null;
}

/** The recreated channel takes over the deleted one's job, with a fresh panel or welcome. */
async function takeOver(kind: string, made: GuildBasedChannel) {
  const guildId = made.guild.id;
  if (kind === "hub") {
    rememberHub(made.id);
    await addPlace("hub", guildId, made.id, made.name);
    return;
  }
  if (!made.isTextBased()) return;
  const key = kind as MessageKey;
  const message = await buildMessage(key);
  const sent = await made.send(kind === "panel" ? message.payload : { ...message.payload, flags: MessageFlags.SuppressNotifications });
  await addPlace(key, guildId, made.id, made.name, sent.id, message.complete ? message.version : 0);
}

/**
 * Someone deleted a channel. The bot's own channels always come back; with channel protection on,
 * every other channel does too, unless the server owner deleted it. Nothing is posted in Discord:
 * the site logs who deleted what, for admins.
 */
export async function onChannelDeleted(channel: NonThreadGuildBasedChannel) {
  const place = known.get(channel.id);
  if (!place && !protectSettings().protectChannels) return;
  // Rooms that come and go on their own (join-to-create rooms, tickets) are not put back.
  if (!place && wasThrowaway(channel.id)) return;
  if (place) {
    known.delete(channel.id);
    restoring.add(channel.id);
  }
  // A deleted category leaves its channels outside any category; they go back into the new one.
  const children = channel.type === ChannelType.GuildCategory
    ? channel.guild.channels.cache.filter((item) => "parentId" in item && item.parentId === channel.id).map((item) => item.id)
    : [];
  try {
    const deleter = await findDeleter(channel);
    if (deleter?.id === channel.client.user.id) return;
    // The owner and the people the server trusts (web page or /protect) may delete channels.
    if (!place && deleter && await isTrusted(channel.guild, deleter.id)) return;
    let made: GuildBasedChannel | null = null;
    try {
      made = await recreate(channel);
      if (made && place) await takeOver(place.kind, made);
      if (made && children.length) {
        for (const id of children) {
          const child = channel.guild.channels.cache.get(id);
          if (child && "setParent" in child) await child.setParent(made.id, { lockPermissions: false }).catch(() => undefined);
        }
      }
    } catch (error) {
      logBotError("recreate channel", error);
    }
    if (made) channelRestored(channel.id, channel.name, made, deleter?.id ?? "");
    if (place) {
      await api().post("/api/internal/bot/voice/places/deleted", {
        kind: place.kind, guildId: place.guildId, channelId: channel.id, newChannelId: made?.id ?? "", name: channel.name,
        deleterId: deleter?.id ?? "", deleterName: deleter?.username ?? "",
      }).catch((error) => logBotError("report deleted channel", error));
    } else {
      reportProtection({
        kind: "channel", guild: channel.guild, userId: deleter?.id, userName: deleter?.username ?? "", channelId: made?.id ?? channel.id,
        channelName: channel.name, restored: Boolean(made),
      });
    }
  } finally {
    if (place) setTimeout(() => restoring.delete(channel.id), 60000).unref();
  }
}

/** /setup-stop: the bot stops using this channel (it can then be deleted without coming back). */
export async function stopUsing(channel: GuildBasedChannel) {
  const here = [...known.values()].filter((place) => place.channelId === channel.id);
  for (const place of here) {
    if (place.kind === "panel" && place.messageId && "messages" in channel) {
      await channel.messages.delete(place.messageId).catch(() => undefined);
      knownPanels.delete(place.messageId);
    }
    known.delete(place.channelId);
    await api().delete(`/api/internal/bot/voice/places/${place.kind}/${place.channelId}`);
  }
  return here.map((place) => placeNames[place.kind] ?? place.kind);
}

async function postFeed(logs: Map<string, GuildBasedChannel>) {
  const res = await api().get<{ events: RoomEvent[] }>("/api/internal/bot/voice/feed");
  const events = res.data?.events ?? [];
  if (!events.length) return;
  const posted: number[] = [];
  for (const [guildId, channel] of logs) {
    const mine = events.filter((event) => event.guildId === guildId);
    if (!mine.length || !channel.isTextBased()) continue;
    try {
      await channel.send({
        embeds: mine.map((event) => {
          const { title, text } = eventParts(event);
          return new EmbedBuilder()
            .setColor(eventColor(event))
            .setTitle(title)
            .setDescription(text)
            .setTimestamp(new Date(event.createdAt));
        }),
        // Show names without pinging anyone.
        allowedMentions: { parse: [] },
        // Silent: no sound or push notification for anyone; the channel still shows as unread.
        flags: MessageFlags.SuppressNotifications,
      });
      posted.push(...mine.map((event) => event.id));
    } catch (error) {
      // Not posted: tried again next time, for up to 15 minutes.
      logBotError("post room log", error);
    }
  }
  if (posted.length) await api().post("/api/internal/bot/voice/feed/ack", { ids: posted });
}

function eventColor(event: RoomEvent) {
  if (event.action === "deleted" || event.action === "kicked") return COLOR.danger;
  if (event.action === "created") return COLOR.ok;
  if (event.action === "unlocked") return COLOR.warn;
  return COLOR.brand;
}

/**
 * What happened, as a short title and one friendly sentence, for the log channel; /room history
 * uses the sentence alone.
 */
export function eventParts(event: RoomEvent) {
  const mention = (id: string) => (id ? `<@${id}>` : "");
  const by = mention(event.actorDiscordId) || mention(event.ownerDiscordId);
  const member = mention(event.memberDiscordId);
  const room = `**${escapeMarkdown(event.roomName)}**`;
  switch (event.action) {
    case "created":
      return { title: "มีห้องใหม่", text: `${by} สร้าง ${room}` };
    case "deleted":
      if (event.detail === "empty") return { title: "ห้องถูกลบ", text: `${room} ไม่มีใครอยู่แล้ว บอทเลยลบให้` };
      if (event.detail === "admin") return { title: "ห้องถูกลบ", text: `แอดมินลบ ${room} จากหน้าเว็บ` };
      if (event.detail === "missing") return { title: "ห้องถูกลบ", text: `มีคนลบ ${room} ใน Discord` };
      return { title: "ห้องถูกลบ", text: `${by} ลบ ${room}` };
    case "password_set":
      return { title: "ตั้งรหัสแล้ว", text: `${by} ตั้งรหัสให้ ${room} ใครจะเข้าต้องขอรหัสก่อน` };
    case "password_changed":
      return { title: "เปลี่ยนรหัสแล้ว", text: `${by} เปลี่ยนรหัส ${room} คนที่เคยเข้าต้องใส่รหัสใหม่` };
    case "kicked":
      return { title: "มีคนโดนเตะ", text: `${by} เตะ ${member} ออกจาก ${room}` };
    case "locked":
      return { title: "ล็อกห้อง", text: `${by} ล็อก ${room}` };
    case "unlocked":
      return { title: "ปลดล็อก", text: `${by} เปิด ${room} ให้ใครก็เข้าได้` };
    case "wrong_password":
      return { title: "รหัสผิด", text: `${member} ใส่รหัส ${room} ผิด` };
    case "locked_out":
      return { title: "รหัสผิดหลายรอบ", text: `${member} ใส่รหัส ${room} ผิดหลายรอบ เลยต้องรอสักพักก่อนลองใหม่` };
    case "denied":
      return { title: "เข้าโดยไม่มีรหัส", text: `${member} เข้า ${room} โดยไม่มีรหัส บอทเลยพาออกไป` };
    case "entered":
      return { title: "รหัสถูก", text: `${member} ใส่รหัสถูก เข้า ${room} ได้แล้ว` };
    case "owner_changed":
      return { title: "เปลี่ยนเจ้าของห้อง", text: `${member} ได้เป็นเจ้าของ ${room} ต่อจาก ${mention(event.actorDiscordId)}` };
    default:
      return { title: "ห้องเสียง", text: room };
  }
}

/** The sentence alone, for /room history. */
export function eventText(event: RoomEvent) {
  return eventParts(event).text;
}

/** The private reply to /room history. */
export function historyEmbed(events: RoomEvent[]) {
  const embed = new EmbedBuilder().setColor(COLOR.brand).setTitle("ประวัติห้องของคุณ");
  if (!events.length) return embed.setDescription("30 วันนี้ห้องของคุณยังเงียบอยู่ ยังไม่มีอะไรเกิดขึ้น");
  const lines: string[] = [];
  let length = 0;
  for (const event of events) {
    const line = `<t:${Math.floor(new Date(event.createdAt).getTime() / 1000)}:R> ${eventText(event)}`;
    if (length + line.length + 1 > 3900) break;
    lines.push(line);
    length += line.length + 1;
  }
  return embed.setDescription(lines.join("\n")).setFooter({ text: "25 อันล่าสุดใน 30 วัน · เห็นแค่คุณนะ" });
}
