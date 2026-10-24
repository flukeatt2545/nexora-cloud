import { ChannelType, type Client, type VoiceState } from "discord.js";
import { api, logBotError } from "./api";
import { homeGuild, isHome } from "./guild";

// Rooms made from the ➕ hub now come from the voice room module (password, public or private;
// see legacy/voice/rooms.ts). This only clears the plain temporary rooms made before that:
// each one is deleted once it is empty.

type Room = { channelId: string; guildId: string; ownerId: string };

const rooms = new Map<string, Room>();

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

export async function onVoiceState(oldState: VoiceState, newState: VoiceState) {
  if (!isHome(newState.guild)) return;
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
