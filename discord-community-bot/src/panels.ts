import { ChannelType, type BaseMessageOptions, type Guild, type TextChannel } from "discord.js";
import { logBotError } from "./api";
import { panels, savePanel, settings, type PanelKey } from "./settings";
import { bannerFile } from "./image";
import { ticketPanel, verifyPanel } from "./ui";

// The panels are one message each, edited in place when their content changes, moved when their
// channel changes, and removed when the feature is turned off. Verify and Ticket are synced here;
// the status picture and the boost panel use the same helpers from status.ts and boost.ts.

export function textChannel(guild: Guild, id: string) {
  const channel = id ? guild.channels.cache.get(id) : undefined;
  return channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) ? (channel as TextChannel) : undefined;
}

/**
 * Puts a panel's message in a channel: edits the saved one, or deletes it (it moved, or repost)
 * and sends a new one. Returns false when the channel is missing.
 */
export async function postPanel(guild: Guild, key: PanelKey, channelId: string, payload: BaseMessageOptions, repost = false) {
  const saved = panels()[key];
  const moved = saved.messageId && (saved.channelId !== channelId || repost);
  if (moved) await textChannel(guild, saved.channelId)?.messages.delete(saved.messageId).catch(() => undefined);
  const channel = textChannel(guild, channelId);
  if (!channel) return false;
  if (saved.messageId && !moved) {
    const message = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (message) {
      // A new picture replaces the old one.
      await message.edit({ ...payload, attachments: [] });
      return true;
    }
  }
  const message = await channel.send(payload);
  await savePanel(key, { channelId: channel.id, messageId: message.id });
  return true;
}

/** Deletes a panel's message and forgets it. */
export async function removePanel(guild: Guild, key: PanelKey) {
  const saved = panels()[key];
  if (!saved.messageId) return;
  await textChannel(guild, saved.channelId)?.messages.delete(saved.messageId).catch(() => undefined);
  await savePanel(key, { channelId: "", messageId: "" });
}

type SyncKey = "verify" | "ticket";

async function wanted(key: SyncKey): Promise<{ channelId: string; payload: BaseMessageOptions } | null> {
  const current = settings();
  if (!current) return null;
  if (key === "verify") {
    return current.verifyEnabled && current.verifyChannelId
      ? { channelId: current.verifyChannelId, payload: { ...verifyPanel(current.verifyMessage), files: [await bannerFile("verify")] } } : null;
  }
  return current.ticketsEnabled && current.ticketChannelId
    ? { channelId: current.ticketChannelId, payload: { ...ticketPanel(current.ticketMessage), files: [await bannerFile("ticket")] } } : null;
}

const label: Record<SyncKey, string> = { verify: "ยืนยันตัวตน", ticket: "Ticket" };

async function syncPanel(guild: Guild, key: SyncKey, repost: boolean) {
  const next = await wanted(key);
  if (!next) {
    await removePanel(guild, key);
    return "";
  }
  return (await postPanel(guild, key, next.channelId, next.payload, repost)) ? "" : `ไม่พบห้องสำหรับแผง${label[key]}`;
}

/** Puts each panel where the settings say. repost: post fresh copies (at the bottom of the room). */
export async function syncPanels(guild: Guild, repost = false) {
  const problems: string[] = [];
  for (const key of ["verify", "ticket"] as SyncKey[]) {
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
  for (const key of ["verify", "ticket", "status", "boost"] as PanelKey[]) {
    if (panels()[key].messageId === messageId) {
      await savePanel(key, { channelId: "", messageId: "" });
      return true;
    }
  }
  return false;
}
