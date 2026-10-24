import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import { WEBMAIL } from "./config";

export const COLOR = {
  brand: 0x2e7eff,
  ok: 0x18b77a,
  warn: 0xe3aa52,
  danger: 0xf43f5e,
};

export const FOLDERS: Record<string, { key: string; label: string }> = {
  i: { key: "inbox", label: "กล่องเข้า" },
  s: { key: "sent", label: "ส่งแล้ว" },
  t: { key: "trash", label: "ถังขยะ" },
};

export const MAILBOX_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const MESSAGE_ID_RE = /^[A-Za-z0-9._/=+-]{1,80}$/;
export const PUBLIC_ID_RE = /^[A-Za-z0-9]{8,64}$/;

export type Payload = {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  files?: AttachmentBuilder[];
};

export type Interaction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction
  | ChatInputCommandInteraction;

export type Edit = (payload: Payload) => Promise<unknown>;

// The member's open private window per kind. Opening a new one deletes the old one so they do
// not pile up. Discord only lets the bot delete it within 15 minutes of opening.
const openWindows = new Map<string, { interaction: Interaction; openedAt: number }>();
const WINDOW_TTL_MS = 14 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - WINDOW_TTL_MS;
  for (const [key, value] of openWindows) {
    if (value.openedAt < cutoff) openWindows.delete(key);
  }
}, 60000).unref();

/**
 * Starts the response. "update" edits the private message the member clicked in;
 * "reply" opens a new private window (public panels, DMs and slash commands) and closes
 * the member's previous window of the same kind.
 */
export async function begin(interaction: Interaction, mode: "update" | "reply", kind: "mail" | "admin" = "mail"): Promise<Edit> {
  if (mode === "update" && (interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage()))) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const key = `${interaction.user.id}:${kind}`;
    const previous = openWindows.get(key);
    openWindows.set(key, { interaction, openedAt: Date.now() });
    if (previous && Date.now() - previous.openedAt < WINDOW_TTL_MS) {
      previous.interaction.deleteReply().catch(() => undefined);
    }
  }
  // attachments: [] drops images from the previous screen; files adds this screen's.
  return (payload) => interaction.editReply({ content: "", embeds: [], components: [], attachments: [], files: [], ...payload });
}

/** Shows a short private note, then removes it. */
export async function flash(interaction: Interaction, content: string, ms = 6000) {
  await interaction.editReply({ content, embeds: [], components: [] });
  setTimeout(() => {
    interaction.deleteReply().catch(() => undefined);
  }, ms).unref();
}

/** "label value" lines that read well on phones, unlike inline embed fields. */
export function facts(items: [string, string][]) {
  return items.map(([label, value]) => `${label}  **${value}**`).join("\n");
}

// The error card and the button row are the bot's shared ones (src/ui.ts).
export { errorEmbed, row } from "../../ui";

export function linkButton(label: string, url: string) {
  return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
}

export function button(customId: string, label: string, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(customId.slice(0, 100)).setLabel(label).setStyle(style).setDisabled(disabled);
}

export function webmailButton() {
  return linkButton("เปิด Webmail", WEBMAIL);
}

export function clip(text: string, limit: number): string {
  const value = (text || "").trim();
  return value.length > limit ? `${value.slice(0, limit - 1).trimEnd()}…` : value;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${Number((bytes / 1024 ** 3).toFixed(1))} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The date's parts in Thai time (UTC+7 all year), read from a shifted UTC date. */
function bangkokParts(time: number) {
  const shifted = new Date(time + BANGKOK_OFFSET_MS);
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth(),
    year: shifted.getUTCFullYear() + 543,
    clock: `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`,
    dayNumber: Math.floor((time + BANGKOK_OFFSET_MS) / 86400000),
  };
}

/**
 * Thai date and time, the same for everyone. Discord's own <t:…> timestamps follow each
 * viewer's app language, so they showed in English for many members.
 *   full  7 ต.ค. 2569 เวลา 22:28 น.
 *   short วันนี้ 22:28 · เมื่อวาน 22:28 · 7 ต.ค. 22:28 · 7 ต.ค. 2568
 *   date  7 ต.ค. 2569
 */
export function thaiTime(date: string, style: "full" | "short" | "date" = "full"): string {
  const time = Date.parse(date);
  if (!Number.isFinite(time) || time <= 0) return "-";
  const value = bangkokParts(time);
  const dayMonth = `${value.day} ${THAI_MONTHS[value.month]}`;
  if (style === "date") return `${dayMonth} ${value.year}`;
  if (style === "full") return `${dayMonth} ${value.year} เวลา ${value.clock} น.`;
  const today = bangkokParts(Date.now());
  if (value.dayNumber === today.dayNumber) return `วันนี้ ${value.clock}`;
  if (value.dayNumber === today.dayNumber - 1) return `เมื่อวาน ${value.clock}`;
  if (value.year === today.year) return `${dayMonth} ${value.clock}`;
  return `${dayMonth} ${value.year}`;
}

/**
 * Escapes text that comes from mail so it cannot add Discord formatting or mentions.
 * Quote, heading and list markers only mean something at the start of a line, so only
 * escape them there; escaping ">" everywhere left stray backslashes after addresses.
 */
export function plain(text: string): string {
  return (text || "")
    .replace(/([\\*_~`|\[\]])/g, "\\$1")
    .replace(/^(\s*)([>#-])/gm, "$1\\$2")
    .replace(/@/g, "@​");
}

// The line mail apps put above a quoted reply, e.g. "On Tue, … wrote:" or Gmail's Thai
// "ในวันที่ พฤ 7 ต.ค. 2026 … เขียนว่า:". It may wrap onto the next line.
const QUOTE_INTRO = /^(on\s.+|ในวันที่\s.+|เมื่อ\s.+)/i;
const QUOTE_INTRO_END = /(wrote|เขียนว่า)\s*:\s*$/i;

/**
 * Drops the earlier conversation that a reply quotes, so only the new text shows, as Gmail
 * does. Returns the whole text unchanged if nothing new would be left.
 */
export function stripQuotedReply(text: string): { text: string; hidden: boolean } {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith(">")) {
      cut = i;
      break;
    }
    // The intro ends with "wrote:" on this line or, when wrapped, on one of the next two.
    if (QUOTE_INTRO.test(line) && lines.slice(i, i + 3).some((next) => QUOTE_INTRO_END.test(next.trim()))) {
      cut = i;
      break;
    }
    if (/^-{2,}\s*(original message|forwarded message|ข้อความต้นฉบับ)/i.test(line)) {
      cut = i;
      break;
    }
  }
  if (cut < 0) return { text: text.trim(), hidden: false };
  const fresh = lines.slice(0, cut).join("\n").trim();
  return fresh ? { text: fresh, hidden: true } : { text: text.trim(), hidden: false };
}
