import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import { api, logBotError } from "./api";
import { COLOR, panelButtons } from "./ui";

// The messages the bot posts and keeps up to date: the button panel and the log channel welcome.
// Their title, text and picture are set on the admin Discord bot page; version changes on every
// save there, and places.ts edits each posted copy that shows an older one.

export type MessageKey = "panel" | "log" | "voicelog";

type MessageSettings = { title: string; body: string; hasImage: boolean; imageType: string; version: number };

// Used until the site answers; the same text the site starts with.
const fallback: Record<MessageKey, MessageSettings> = {
  panel: { title: "ห้องเสียง", body: "สร้างห้องของตัวเองแล้วตั้งรหัสได้ หรือใส่รหัสเข้าห้องเพื่อน\nห้องไหนไม่มีใครอยู่ เดี๋ยวหายไปเอง", hasImage: false, imageType: "", version: 0 },
  log: { title: "ห้อง log ห้องเสียง", body: "มีห้องใหม่หรือห้องถูกลบ บอทจะมาบอกที่นี่", hasImage: false, imageType: "", version: 0 },
  voicelog: { title: "ประวัติเข้าออกห้องเสียง", body: "ใครออกจากห้องเสียง บอทจะมาบอกที่นี่ว่าอยู่ห้องไหน นานแค่ไหน", hasImage: false, imageType: "", version: 0 },
};

/** The title the log welcome had before it could be changed, to find copies posted back then. */
export const OLD_LOG_TITLE = fallback.log.title;

let current: Record<MessageKey, MessageSettings> = { ...fallback };
// Pictures by key and version, so one is downloaded once.
const images = new Map<string, Buffer>();

const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export async function loadMessages() {
  const res = await api().get<{ messages: Record<MessageKey, MessageSettings> }>("/api/internal/bot/voice/messages");
  const messages = res.data?.messages;
  if (messages?.panel && messages.log && messages.voicelog) current = { panel: messages.panel, log: messages.log, voicelog: messages.voicelog };
}

export function messageVersion(key: MessageKey) {
  return current[key].version;
}

async function image(key: MessageKey, settings: MessageSettings) {
  const id = `${key}:${settings.version}`;
  const cached = images.get(id);
  if (cached) return cached;
  const res = await api().get<ArrayBuffer>(`/api/internal/bot/voice/messages/${key}/image`, { responseType: "arraybuffer" });
  const data = Buffer.from(res.data);
  for (const old of images.keys()) if (old.startsWith(`${key}:`)) images.delete(old);
  images.set(id, data);
  return data;
}

/**
 * What to post (or edit a posted copy to): the embed with its picture, and a panel's buttons.
 * complete is false when the picture could not be loaded, so an edit is tried again later.
 */
export async function buildMessage(key: MessageKey) {
  const settings = current[key];
  const embed = new EmbedBuilder().setColor(key === "panel" ? COLOR.brand : COLOR.ok);
  if (settings.title) embed.setTitle(settings.title);
  if (settings.body) embed.setDescription(settings.body);
  const files: AttachmentBuilder[] = [];
  if (settings.hasImage) {
    try {
      const name = `${key}.${extensions[settings.imageType] ?? "png"}`;
      files.push(new AttachmentBuilder(await image(key, settings), { name }));
      embed.setImage(`attachment://${name}`);
    } catch (error) {
      logBotError("message image", error);
    }
  }
  // A picture-only message whose picture could not be loaded still needs something to show.
  if (!settings.title && !settings.body && files.length === 0) embed.setDescription(fallback[key].body);
  return {
    version: settings.version,
    complete: !settings.hasImage || files.length > 0,
    payload: { embeds: [embed], files, components: key === "panel" ? [panelButtons()] : [] },
  };
}
