import { ChannelType, OverwriteType, PermissionFlagsBits, type Client, type GuildMember, type VoiceChannel, type VoiceState } from "discord.js";
import { canUse } from "./access";
import { api, logBotError } from "./api";
import { homeGuild, isHome } from "./guild";
import { fillTemplate, settings } from "./settings";

// Join to Create: joining the hub channel makes a voice room for that member (in the hub's
// category) and moves them in. The owner can rename it and set a limit from Discord's own channel
// settings. The room is deleted as soon as it is empty.

type Room = { channelId: string; guildId: string; ownerId: string };

const rooms = new Map<string, Room>();
const lastMade = new Map<string, number>();
const MAKE_GAP_MS = 10000;

export function isTempRoom(channelId: string) {
  return rooms.has(channelId);
}

/** After a restart: delete rooms that emptied while the bot was away. */
export async function syncTempRooms(client: Client) {
  const guild = homeGuild(client);
  try {
    const res = await api().get<{ rooms: Room[] }>("/api/internal/bot/community/temp-rooms");
    rooms.clear();
    for (const room of res.data.rooms) {
      const channel = guild?.id === room.guildId ? guild.channels.cache.get(room.channelId) : undefined;
      if (channel?.type === ChannelType.GuildVoice && channel.members.size > 0) {
        rooms.set(room.channelId, room);
        continue;
      }
      if (channel) await channel.delete("ห้องเสียงชั่วคราวว่างแล้ว").catch((error) => logBotError("delete temp room", error));
      if (channel || guild?.id === room.guildId) await forget(room.channelId);
    }
  } catch (error) {
    logBotError("sync temp rooms", error);
  }
}

async function forget(channelId: string) {
  rooms.delete(channelId);
  await api().delete(`/api/internal/bot/community/temp-rooms/${channelId}`).catch((error) => logBotError("forget temp room", error));
}

async function makeRoom(member: GuildMember, hub: VoiceChannel) {
  const current = settings()!;
  // One room each: someone who already has one goes back to it.
  const existing = [...rooms.values()].find((room) => room.ownerId === member.id);
  const existingChannel = existing && member.guild.channels.cache.get(existing.channelId);
  if (existingChannel?.type === ChannelType.GuildVoice) {
    await member.voice.setChannel(existingChannel).catch(() => undefined);
    return;
  }
  if (!canUse(member)) {
    await member.voice.disconnect("ไม่มียศที่สร้างห้องเสียงได้").catch(() => undefined);
    return;
  }
  const now = Date.now();
  if (now - (lastMade.get(member.id) ?? 0) < MAKE_GAP_MS) {
    await member.voice.disconnect("สร้างห้องถี่เกินไป").catch(() => undefined);
    return;
  }
  lastMade.set(member.id, now);
  const name = fillTemplate(current.tempNameTemplate, { user: member.displayName, name: member.displayName }).slice(0, 100);
  // Same permissions as the category, plus the owner may manage their own room.
  const inherited = hub.parent ? [...hub.parent.permissionOverwrites.cache.values()] : [];
  const channel = await member.guild.channels.create({
    name,
    type: ChannelType.GuildVoice,
    parent: hub.parentId ?? undefined,
    bitrate: hub.bitrate,
    permissionOverwrites: [
      ...inherited.map((item) => ({ id: item.id, type: item.type, allow: item.allow, deny: item.deny })),
      { id: member.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
      { id: member.client.user.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
    ],
    reason: `ห้องเสียงชั่วคราวของ ${member.user.username}`,
  });
  const room = { channelId: channel.id, guildId: member.guild.id, ownerId: member.id };
  rooms.set(channel.id, room);
  await api(member.user).post("/api/internal/bot/community/temp-rooms", room).catch((error) => logBotError("save temp room", error));
  try {
    await member.voice.setChannel(channel, "ย้ายเข้าห้องเสียงที่สร้าง");
  } catch {
    // They left the hub before the room was ready.
    await channel.delete("เจ้าของออกไปก่อนห้องพร้อม").catch(() => undefined);
    await forget(channel.id);
  }
}

export async function onVoiceState(oldState: VoiceState, newState: VoiceState) {
  if (!isHome(newState.guild)) return;
  const current = settings();
  const member = newState.member;
  if (current?.tempVoiceEnabled && current.tempHubChannelId && newState.channelId === current.tempHubChannelId && member && !member.user.bot) {
    const hub = newState.channel;
    if (hub?.type === ChannelType.GuildVoice) await makeRoom(member, hub).catch((error) => logBotError("make temp room", error));
  }
  const left = oldState.channelId;
  if (left && left !== newState.channelId && rooms.has(left)) {
    const channel = oldState.guild.channels.cache.get(left);
    if (!channel) await forget(left);
    else if (channel.type === ChannelType.GuildVoice && channel.members.size === 0) {
      await channel.delete("ห้องเสียงชั่วคราวว่างแล้ว").catch((error) => logBotError("delete temp room", error));
      await forget(left);
    }
  }
}

export function onChannelGone(channelId: string) {
  if (rooms.has(channelId)) void forget(channelId);
}
