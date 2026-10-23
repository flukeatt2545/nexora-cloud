import { ChannelType, type Guild, type TextChannel } from "discord.js";
import { logBotError } from "./api";
import { panels, savePanel, settings, type PanelKey } from "./settings";
import { rolesPanel, ticketPanel, verifyPanel } from "./ui";

// The three panels (verify, pick roles, open a ticket) are one message each, edited in place
// when their text changes on the web page, moved when their channel changes, and removed when
// the feature is turned off.

type Payload = ReturnType<typeof verifyPanel>;

function textChannel(guild: Guild, id: string) {
  const channel = id ? guild.channels.cache.get(id) : undefined;
  return channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) ? (channel as TextChannel) : undefined;
}

function wanted(guild: Guild, key: PanelKey): { channelId: string; payload: Payload } | null {
  const current = settings();
  if (!current) return null;
  if (key === "verify") {
    return current.verifyEnabled && current.verifyChannelId ? { channelId: current.verifyChannelId, payload: verifyPanel(current.verifyMessage) } : null;
  }
  if (key === "roles") {
    const names = current.selfRoleIds.flatMap((id) => guild.roles.cache.get(id)?.toString() ?? []);
    return current.rolesChannelId && current.selfRoleIds.length ? { channelId: current.rolesChannelId, payload: rolesPanel(current.rolesMessage, names) } : null;
  }
  return current.ticketsEnabled && current.ticketChannelId ? { channelId: current.ticketChannelId, payload: ticketPanel(current.ticketMessage) } : null;
}

async function syncPanel(guild: Guild, key: PanelKey, repost: boolean) {
  const saved = panels()[key];
  const next = wanted(guild, key);
  const moved = saved.messageId && (!next || next.channelId !== saved.channelId || repost);
  if (moved) {
    await textChannel(guild, saved.channelId)?.messages.delete(saved.messageId).catch(() => undefined);
  }
  if (!next) {
    if (saved.messageId) await savePanel(key, { channelId: "", messageId: "" });
    return "";
  }
  const channel = textChannel(guild, next.channelId);
  if (!channel) return `ไม่พบห้องสำหรับแผง${label[key]}`;
  if (saved.messageId && !moved) {
    const message = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (message) {
      await message.edit(next.payload);
      return "";
    }
  }
  const message = await channel.send(next.payload);
  await savePanel(key, { channelId: channel.id, messageId: message.id });
  return "";
}

const label: Record<PanelKey, string> = { verify: "ยืนยันตัวตน", roles: "เลือกยศ", ticket: "Ticket" };

/** Puts each panel where the settings say. repost: post fresh copies (at the bottom of the room). */
export async function syncPanels(guild: Guild, repost = false) {
  const problems: string[] = [];
  for (const key of ["verify", "roles", "ticket"] as PanelKey[]) {
    try {
      const problem = await syncPanel(guild, key, repost);
      if (problem) problems.push(problem);
    } catch (error) {
      logBotError(`panel ${key}`, error);
      problems.push(`ลงแผง${label[key]}ไม่ได้ (บอทอาจไม่มีสิทธิ์ส่งข้อความในห้องนั้น)`);
    }
  }
  return problems;
}

/** Someone deleted one of the panels: forget it, so the next sync posts it again. */
export async function onMessageDeleted(messageId: string) {
  for (const key of ["verify", "roles", "ticket"] as PanelKey[]) {
    if (panels()[key].messageId === messageId) {
      await savePanel(key, { channelId: "", messageId: "" });
      return true;
    }
  }
  return false;
}
