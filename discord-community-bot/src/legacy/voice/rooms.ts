import {
  ChannelType,
  escapeMarkdown,
  OverwriteType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type VoiceChannel,
  type VoiceState,
} from "discord.js";
import { api, apiMessage, logBotError, type Actor, type VoiceRoom, type VoiceSettings } from "./api";
import { CATEGORY_ID, CATEGORY_NAME } from "./config";
import { roomPanel } from "./ui";

// What the bot knows about each room channel, refreshed from the API every sync.
type CachedRoom = { id: number; ownerId: string; name: string; locked: boolean; hasPassword: boolean; kind: string };

const rooms = new Map<string, CachedRoom>();
// Join to Create channels: joining one makes a room for that member.
const hubs = new Set<string>();
// When each member joined each room, so a room can pass to whoever has been there longest.
const joinedAt = new Map<string, Map<string, number>>();
const emptyTimers = new Map<string, NodeJS.Timeout>();
// Channels the bot is deleting itself, so the channelDelete event does not report them again.
const deleting = new Set<string>();
const categoryByGuild = new Map<string, string>();
// A short pause between rooms made from a hub, so hopping in and out cannot spam channels.
const lastHubRoom = new Map<string, number>();

// The Join to Create channel's name. Hubs made before it changed are renamed on the next sync.
export const HUB_NAME = "+ คลิกเพื่อสร้างห้อง";
export const OLD_HUB_NAMES = new Set(["+ สร้างห้อง"]);

let settings: VoiceSettings = { enabled: true, maxRoomsPerUser: 3, emptyDeleteMinutes: 5, maxFailures: 5, lockoutMinutes: 10 };

export function currentSettings() {
  return settings;
}

export function roomByChannel(channelId: string) {
  return rooms.get(channelId);
}

/** A member's rooms in one server (the bot can be in several). */
export function roomsOwnedBy(userId: string, guild: Guild) {
  return [...rooms.entries()]
    .filter(([channelId, room]) => room.ownerId === userId && guild.channels.cache.has(channelId))
    .map(([channelId, room]) => ({ channelId, ...room }));
}

export function isHub(channelId: string) {
  return hubs.has(channelId);
}

/**
 * Rooms in a server that take a password and this member can see (a room in a private
 * category stays out of the list for those outside it), busiest first.
 */
export function lockedRooms(guild: Guild, member: GuildMember) {
  return [...rooms.entries()]
    .filter(([channelId, room]) => {
      const channel = guild.channels.cache.get(channelId);
      return room.locked && room.hasPassword && channel?.type === ChannelType.GuildVoice && canSee(channel as VoiceChannel, member);
    })
    .map(([channelId, room]) => {
      const channel = guild.channels.cache.get(channelId) as VoiceChannel;
      return { channelId, ...room, people: people(channel).size, ownerName: guild.members.cache.get(room.ownerId)?.displayName ?? "" };
    })
    .sort((a, b) => b.people - a.people);
}

export function rememberRoom(channelId: string, room: CachedRoom) {
  rooms.set(channelId, room);
}

/** "ห้อง X" in bold, without saying ห้อง twice when the name already starts with it. */
function roomLabel(name: string) {
  const bold = `**${escapeMarkdown(name)}**`;
  return name.startsWith("ห้อง") ? bold : `ห้อง ${bold}`;
}

/** One of the bot's own voice rooms (they come and go; deleting one is not protected against). */
export function isRoomChannel(channelId: string) {
  return rooms.has(channelId) || deleting.has(channelId);
}

export function rememberHub(channelId: string) {
  hubs.add(channelId);
}

/** The Join to Create channels, from the list the site keeps (see places.ts). */
export function setHubs(channelIds: string[]) {
  hubs.clear();
  for (const id of channelIds) hubs.add(id);
}

function people(channel: VoiceChannel) {
  return channel.members.filter((member) => !member.user.bot);
}

/** Finds the category rooms go in: the configured one, or one named CATEGORY_NAME (made if missing). */
export async function roomCategory(guild: Guild): Promise<string | undefined> {
  // A category id from .env belongs to one server; elsewhere the category is found by name.
  if (CATEGORY_ID && guild.channels.cache.has(CATEGORY_ID)) return CATEGORY_ID;
  const known = categoryByGuild.get(guild.id);
  if (known && guild.channels.cache.has(known)) return known;
  const existing = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME);
  if (existing) {
    categoryByGuild.set(guild.id, existing.id);
    return existing.id;
  }
  try {
    const made = await guild.channels.create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory });
    categoryByGuild.set(guild.id, made.id);
    return made.id;
  } catch (error) {
    logBotError("create category", error);
    return undefined;
  }
}

type Overwrite = { id: string; type: OverwriteType; allow: bigint; deny: bigint };

const NONE = BigInt(0);

/**
 * The category's permissions, as a starting point for a channel made in it, so a private
 * category keeps its rooms private: whoever cannot see the category cannot see them either.
 */
function categoryOverwrites(guild: Guild, parentId: string | null | undefined): Overwrite[] {
  const parent = parentId ? guild.channels.cache.get(parentId) : undefined;
  if (!parent || parent.type !== ChannelType.GuildCategory) return [];
  return parent.permissionOverwrites.cache.map((item) => ({ id: item.id, type: item.type, allow: item.allow.bitfield, deny: item.deny.bitfield }));
}

/** Adds to (or starts) one role's or member's overwrite, keeping what the category gave it. */
function addOverwrite(list: Overwrite[], id: string, type: OverwriteType, allow: bigint, deny = NONE) {
  let item = list.find((entry) => entry.id === id);
  if (!item) list.push((item = { id, type, allow: NONE, deny: NONE }));
  item.allow = (item.allow | allow) & ~deny;
  item.deny = (item.deny | deny) & ~allow;
}

const SEE_AND_JOIN = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect;

/**
 * Makes the voice channel, closed: it has the category's permissions (who can see it), and on
 * top of that only the owner and the bot can connect. Members who give the right password get
 * their own Connect overwrite later, and the owner can open it to everyone.
 * Discord shows such a room as "not synced" with its category; that is the lock, not a mistake.
 */
export async function createRoomChannel(guild: Guild, owner: GuildMember, name: string, userLimit: number, options: { parent?: string | null } = {}) {
  const parent = options.parent ?? (await roomCategory(guild));
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const overwrites = categoryOverwrites(guild, parent);
  addOverwrite(overwrites, guild.roles.everyone.id, OverwriteType.Role, NONE, PermissionFlagsBits.Connect);
  addOverwrite(overwrites, me.id, OverwriteType.Member, SEE_AND_JOIN | PermissionFlagsBits.MoveMembers);
  addOverwrite(overwrites, owner.id, OverwriteType.Member, SEE_AND_JOIN);
  return guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent,
    userLimit,
    permissionOverwrites: overwrites,
    reason: `ห้องของ ${owner.user.username}`,
  });
}

/**
 * The hub members join to get a room: synced with its category. The bot adds its own overwrite
 * only when the category would stop it seeing the hub or moving people out of it.
 */
export async function createHubChannel(guild: Guild, parent: string | undefined) {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const overwrites = categoryOverwrites(guild, parent);
  const category = parent ? guild.channels.cache.get(parent) : undefined;
  const needs = SEE_AND_JOIN | PermissionFlagsBits.MoveMembers;
  if (!category || !category.permissionsFor(me).has(needs)) addOverwrite(overwrites, me.id, OverwriteType.Member, needs);
  return guild.channels.create({
    name: HUB_NAME,
    type: ChannelType.GuildVoice,
    parent,
    permissionOverwrites: overwrites,
    reason: "ห้อง Join to Create",
  });
}

/**
 * Lets a member who gave the right password connect. It does not make the room visible: only
 * people who can already see it (through the category) can pick it and enter the password.
 */
export async function grantAccess(channel: VoiceChannel, userId: string) {
  await channel.permissionOverwrites.edit(userId, { Connect: true }, { type: OverwriteType.Member, reason: "ได้สิทธิ์เข้าห้อง" });
}

/** Whether a member can see a room (its category may be private). */
export function canSee(channel: VoiceChannel, member: GuildMember) {
  return channel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel);
}

export async function revokeAccess(channel: VoiceChannel, userId: string, ownerId: string) {
  if (userId === ownerId || userId === channel.client.user.id) return;
  await channel.permissionOverwrites.delete(userId, "ยกเลิกสิทธิ์เข้าห้อง").catch(() => undefined);
}

export async function setLocked(channel: VoiceChannel, locked: boolean, hasPassword?: boolean) {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, { Connect: locked ? false : null }, { type: OverwriteType.Role });
  const cached = rooms.get(channel.id);
  if (cached) {
    cached.locked = locked;
    if (hasPassword !== undefined) cached.hasPassword = hasPassword;
  }
}

/** Disconnects everyone in the room who may not be there any more (after a new password, or a kick). */
export async function removeUnallowed(channel: VoiceChannel) {
  let removed = 0;
  for (const member of people(channel).values()) {
    try {
      const res = await api().get("/api/internal/bot/voice/check", { params: { channelId: channel.id, discordId: member.id } });
      if (res.data?.allowed === false) {
        await member.voice.disconnect("ไม่มีรหัสห้อง");
        removed++;
      }
    } catch (error) {
      logBotError("recheck member", error);
    }
  }
  return removed;
}

export async function deleteRoom(channel: VoiceChannel | undefined, roomId: number, reason: "empty" | "missing" | "admin" | "owner", actorId?: Actor) {
  if (channel) {
    deleting.add(channel.id);
    rooms.delete(channel.id);
    joinedAt.delete(channel.id);
    clearEmptyTimer(channel.id);
    await channel.delete(reason === "empty" ? "ห้องว่างนานเกินกำหนด" : "ลบห้อง").catch((error) => logBotError("delete channel", error));
    setTimeout(() => deleting.delete(channel.id), 30000).unref();
  }
  const query = reason === "owner" ? "" : `?reason=${reason}`;
  await api(actorId).delete(`/api/internal/bot/voice/rooms/${roomId}${query}`);
}

function clearEmptyTimer(channelId: string) {
  const timer = emptyTimers.get(channelId);
  if (timer) clearTimeout(timer);
  emptyTimers.delete(channelId);
}

/** Starts the countdown to delete a room nobody is in. Joining cancels it. */
function watchEmpty(channel: VoiceChannel) {
  const room = rooms.get(channel.id);
  if (!room || emptyTimers.has(channel.id) || people(channel).size > 0) return;
  const timer = setTimeout(() => {
    emptyTimers.delete(channel.id);
    const fresh = channel.guild.channels.cache.get(channel.id) as VoiceChannel | undefined;
    const current = rooms.get(channel.id);
    if (!fresh || !current || people(fresh).size > 0) return;
    deleteRoom(fresh, current.id, "empty").catch((error) => logBotError("delete empty room", error));
  }, Math.max(1, settings.emptyDeleteMinutes) * 60000);
  timer.unref();
  emptyTimers.set(channel.id, timer);
}

export function startEmptyWatch(channel: VoiceChannel) {
  watchEmpty(channel);
}

function noteJoin(channelId: string, memberId: string) {
  let members = joinedAt.get(channelId);
  if (!members) joinedAt.set(channelId, (members = new Map()));
  if (!members.has(memberId)) members.set(memberId, Date.now());
}

/** The owner left but others are still in the room: it goes to whoever has been there longest. */
async function passOwnership(channel: VoiceChannel, leaver: GuildMember) {
  const room = rooms.get(channel.id);
  if (!room || room.ownerId !== leaver.id) return;
  const remaining = [...people(channel).values()];
  if (remaining.length === 0) return;
  const times = joinedAt.get(channel.id) ?? new Map<string, number>();
  const next = remaining.sort((a, b) => (times.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (times.get(b.id) ?? Number.MAX_SAFE_INTEGER))[0];
  try {
    await api().post(`/api/internal/bot/voice/rooms/${room.id}/transfer`, { discordId: next.id, username: next.user.username });
  } catch (error) {
    logBotError("transfer room", error);
    return;
  }
  room.ownerId = next.id;
  await grantAccess(channel, next.id).catch(() => undefined);
  await channel.send(`${leaver} ออกไปแล้ว ตอนนี้ ${next} เป็นเจ้าของห้องแทน`).catch(() => undefined);
}

/** Someone joined a Join to Create channel: make them a room and move them into it. */
async function openRoomFromHub(member: GuildMember, hub: VoiceChannel) {
  const guild = hub.guild;
  // Already has a room here: go back to it instead of making another.
  const own = roomsOwnedBy(member.id, guild)[0];
  if (own) {
    await member.voice.setChannel(own.channelId, "กลับห้องของตัวเอง").catch((error) => logBotError("move to own room", error));
    return;
  }
  const last = lastHubRoom.get(member.id) ?? 0;
  if (Date.now() - last < 10000) {
    await member.voice.disconnect("สร้างห้องถี่เกินไป").catch(() => undefined);
    return;
  }
  lastHubRoom.set(member.id, Date.now());
  const name = `ห้องของ ${member.displayName}`.slice(0, 100);
  let roomId: number;
  let roomName: string;
  try {
    const res = await api(member.user).post("/api/internal/bot/voice/rooms", {
      guildId: guild.id, guildName: guild.name, name, open: true, userLimit: 0, ownerUsername: member.user.username,
    });
    roomId = res.data.id;
    roomName = res.data.name;
  } catch (error) {
    logBotError("hub room", error);
    await member.voice.disconnect("สร้างห้องไม่ได้").catch(() => undefined);
    await member.send(`สร้างห้องไม่ได้: ${apiMessage(error, "ลองใหม่อีกครั้ง")}`).catch(() => undefined);
    return;
  }
  let channel: VoiceChannel;
  try {
    channel = await createRoomChannel(guild, member, roomName, 0, { parent: hub.parentId });
    await api(member.user).put(`/api/internal/bot/voice/rooms/${roomId}/channel`, { channelId: channel.id });
  } catch (error) {
    logBotError("hub channel", error);
    await api().delete(`/api/internal/bot/voice/rooms/${roomId}?reason=missing`).catch(() => undefined);
    await member.voice.disconnect("สร้างห้องไม่ได้").catch(() => undefined);
    return;
  }
  rooms.set(channel.id, { id: roomId, ownerId: member.id, name: roomName, locked: true, hasPassword: false, kind: "join" });
  noteJoin(channel.id, member.id);
  await member.voice.setChannel(channel, "ห้องใหม่จาก Join to Create").catch(() => undefined);
  watchEmpty(channel);
  await channel.send(roomPanel(roomId, roomName, member.id)).catch(() => undefined);
}

/** Someone joined, left or moved. Makes rooms from hubs and keeps people out of locked rooms. */
export async function onVoiceState(oldState: VoiceState, newState: VoiceState) {
  if (oldState.channelId === newState.channelId) return;
  const leaver = oldState.member;
  if (oldState.channel?.type === ChannelType.GuildVoice && rooms.has(oldState.channel.id)) {
    joinedAt.get(oldState.channel.id)?.delete(oldState.id);
    if (leaver && !leaver.user.bot) await passOwnership(oldState.channel, leaver);
    watchEmpty(oldState.channel);
  }
  const channel = newState.channel;
  const member = newState.member;
  if (!channel || channel.type !== ChannelType.GuildVoice || !member || member.user.bot) return;
  if (hubs.has(channel.id)) {
    await openRoomFromHub(member, channel);
    return;
  }
  const room = rooms.get(channel.id);
  if (!room) return;
  clearEmptyTimer(channel.id);
  if (member.id !== room.ownerId) {
    try {
      const res = await api().get("/api/internal/bot/voice/check", { params: { channelId: channel.id, discordId: member.id } });
      if (res.data?.allowed === false) {
        await member.voice.disconnect("ยังไม่ได้ใส่รหัสห้อง").catch((error) => logBotError("disconnect", error));
        await api().post(`/api/internal/bot/voice/rooms/${room.id}/denied`, { discordId: member.id, username: member.user.username }).catch(() => undefined);
        // A DM has no server around it, and the bot can be in several: say which one.
        const where = `${roomLabel(room.name)} ในเซิร์ฟ **${escapeMarkdown(channel.guild.name)}**`;
        await member.send(room.hasPassword
          ? `${where} ล็อกอยู่ บอทเลยพาออกมาก่อนนะ\nถ้าอยากเข้า ขอรหัสจากเจ้าของห้อง แล้วกดปุ่ม "เข้าห้องที่ล็อก" ที่แผงห้องเสียงในเซิร์ฟนั้น`
          : `${where} ยังไม่เปิดให้คนอื่นเข้า บอทเลยพาออกมาก่อนนะ\nรอเจ้าของห้องตั้งรหัสหรือเปิดห้องก่อน`).catch(() => undefined);
        watchEmpty(channel);
        return;
      }
    } catch (error) {
      // If the site cannot answer, the Connect permission is still the real gate.
      logBotError("voice check", error);
    }
  }
  noteJoin(channel.id, member.id);
}

/**
 * A room channel was deleted by hand in Discord: forget it too. A deleted Join to Create
 * channel stops working at once; the next places check removes it from the list.
 */
export async function onChannelDelete(channelId: string) {
  if (hubs.delete(channelId)) return;
  if (deleting.has(channelId)) return;
  const room = rooms.get(channelId);
  if (!room) return;
  rooms.delete(channelId);
  joinedAt.delete(channelId);
  clearEmptyTimer(channelId);
  await api().delete(`/api/internal/bot/voice/rooms/${room.id}?reason=missing`).catch((error) => logBotError("forget room", error));
}

async function fetchVoice(guild: Guild, channelId: string) {
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  return channel?.type === ChannelType.GuildVoice ? (channel as VoiceChannel) : undefined;
}

/** Brings the bot in line with the site: new limits, rooms deleted from the web page, lost channels. Join to Create channels: see places.ts. */
export async function syncRooms(client: Client) {
  try {
    const res = await api().get<VoiceSettings>("/api/internal/bot/voice/settings");
    if (res.data && typeof res.data.emptyDeleteMinutes === "number") settings = res.data;
  } catch (error) {
    logBotError("load settings", error);
  }
  let list: VoiceRoom[];
  try {
    const res = await api().get<{ rooms: VoiceRoom[] }>("/api/internal/bot/voice/rooms");
    list = res.data?.rooms ?? [];
  } catch (error) {
    logBotError("load rooms", error);
    return;
  }
  const seen = new Set<string>();
  for (const room of list) {
    const guild = client.guilds.cache.get(room.guildId);
    if (!guild) continue;
    const channel = await fetchVoice(guild, room.channelId);
    if (!channel) {
      await api().delete(`/api/internal/bot/voice/rooms/${room.id}?reason=missing`).catch((error) => logBotError("forget missing room", error));
      continue;
    }
    if (room.deleteRequested) {
      await deleteRoom(channel, room.id, "admin").catch((error) => logBotError("delete requested room", error));
      continue;
    }
    seen.add(channel.id);
    rooms.set(channel.id, { id: room.id, ownerId: room.ownerDiscordId, name: room.name, locked: room.locked, hasPassword: room.hasPassword, kind: room.kind });
    for (const id of people(channel).keys()) noteJoin(channel.id, id);
    watchEmpty(channel);
  }
  for (const channelId of [...rooms.keys()]) {
    if (!seen.has(channelId)) {
      rooms.delete(channelId);
      clearEmptyTimer(channelId);
    }
  }
}
