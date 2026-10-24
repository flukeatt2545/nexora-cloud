import { ChannelType } from "discord.js";
import { nameEmoji } from "./settings";

// Decorated names for the channels, categories and roles the bot makes, in the style picked on
// the web page or with /setup. A style is a frame or separator, an emoji (when "emoji in names"
// is on) and Unicode letters (𝐁𝐨𝐥𝐝, ꜱᴍᴀʟʟ ᴄᴀᴘꜱ) for English words; Thai has no such letters and
// keeps its own. One style across the server keeps the channel list tidy instead of mixing symbols.

export type NameStyle = "plain" | "frame" | "line" | "cute";

export const STYLE_LABELS: Record<NameStyle, string> = {
  frame: "กรอบ  『👋』ยินดีต้อนรับ",
  line: "เส้นคั่น  ┊👋┊ยินดีต้อนรับ",
  cute: "น่ารัก  ꒰👋꒱・ยินดีต้อนรับ",
  plain: "เรียบ ๆ  👋・ยินดีต้อนรับ",
};

type Font = "bold" | "boldSans" | "smallCaps";

const SMALL_CAPS = "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ";
const ALPHABETS = { bold: [0x1d400, 0x1d41a, 0x1d7ce], boldSans: [0x1d5d4, 0x1d5ee, 0x1d7ec] };

/** A-Z, a-z and 0-9 in another Unicode alphabet; everything else (Thai, emoji) stays. */
export function fancy(text: string, font: Font) {
  return [...text].map((char) => {
    const code = char.codePointAt(0)!;
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;
    const digit = code >= 48 && code <= 57;
    if (font === "smallCaps") return upper || lower ? SMALL_CAPS[(code | 32) - 97] : char;
    const [upperBase, lowerBase, digitBase] = ALPHABETS[font];
    if (upper) return String.fromCodePoint(upperBase + code - 65);
    if (lower) return String.fromCodePoint(lowerBase + code - 97);
    if (digit) return String.fromCodePoint(digitBase + code - 48);
    return char;
  }).join("");
}

/** Back to plain letters, so a name decorated earlier can be decorated again in another style. */
export function unfancy(text: string) {
  return [...text].map((char) => {
    const code = char.codePointAt(0)!;
    const small = SMALL_CAPS.indexOf(char);
    if (small >= 0) return String.fromCharCode(97 + small);
    for (const [upper, lower, digit] of Object.values(ALPHABETS)) {
      if (code >= upper && code < upper + 26) return String.fromCharCode(65 + code - upper);
      if (code >= lower && code < lower + 26) return String.fromCharCode(97 + code - lower);
      if (code >= digit && code < digit + 10) return String.fromCharCode(48 + code - digit);
    }
    return char;
  }).join("");
}

// The emoji the bot gives the rooms and roles it knows by name (lower case words, no frame).
const ICONS: Record<string, string> = {
  // roles
  owner: "👑", admin: "🛡️", moderator: "⚔️", staff: "🎫", vip: "💎", member: "✨", bots: "🤖",
  gamer: "🎮", music: "🎵", coder: "💻", artist: "🎨", student: "📚", updates: "🔔",
  // channels
  "ยินดีต้อนรับ": "👋", "คนออก": "👋", welcome: "👋", "web activity": "🌐", "discord activity": "🚨", sayonara: "👋", verify: "✅", roles: "🏷️", "เช็คยศ": "🏷️", "system status": "🛰️", links: "🔗", "ยืนยันตัวตน": "✅", "กฎ": "📜", "ประกาศ": "📢", "สถานะระบบ": "🛰️",
  "แชททั่วไป": "💬", "รูปภาพ": "🖼️", "คำสั่งบอท": "🤖", "สร้างห้องเสียง": "➕", "นั่งเล่น": "🛋️",
  "เปิด ticket": "🎫", "ticket log": "📝", "ห้องทีมงาน": "🛡️", "แจ้งเตือนความปลอดภัย": "🚨", "ตั้งค่าบอท": "⚙️",
  "บูสต์": "🚀", "ห้องบูสเตอร์": "💖", "สมาชิก": "👥", "ออนไลน์": "🟢", "เว็บ": "🌐",
  // categories
  start: "📌", community: "💬", voice: "🔊", support: "🎫", stats: "📊", boost: "🚀",
  "เริ่มต้นที่นี่": "📌", "พูดคุย": "💬", "ห้องเสียง": "🔊", "ช่วยเหลือ": "🎫", "ทีมงาน": "🛡️", "สถิติเซิร์ฟ": "📊",
};

const DEFAULT_ICON: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: "💬",
  [ChannelType.GuildVoice]: "🔊",
  [ChannelType.GuildAnnouncement]: "📢",
  [ChannelType.GuildForum]: "🗂️",
  [ChannelType.GuildStageVoice]: "🎤",
  [ChannelType.GuildCategory]: "📁",
};

/** The emoji for a room or role by its words ("" when it has none). */
export function iconOf(words: string) {
  return ICONS[words.toLowerCase().replace(/[-\s]+/g, " ").trim()] ?? "";
}

/** Names carry an emoji only when the setting is on. */
const withIcon = (emoji: string) => (nameEmoji() ? emoji : "");

/** A text or voice channel. */
export function channelName(style: NameStyle, name: string, emoji = "") {
  const e = withIcon(emoji);
  switch (style) {
    case "frame": return e ? `『${e}』${name}` : `『${name}』`;
    case "line": return e ? `┊${e}┊${name}` : `┊・${name}`;
    case "cute": return e ? `꒰${e}꒱・${name}` : `꒰${name}꒱`;
    default: return e ? `${e}・${name}` : name;
  }
}

/** A category: the English word in fancy letters, then the Thai name (either may be empty). */
export function categoryName(style: NameStyle, english: string, thai: string, emoji = "") {
  const e = withIcon(emoji);
  const label = (font: Font, joiner: string) =>
    [english && fancy(font === "smallCaps" ? english : english.toUpperCase(), font), thai].filter(Boolean).join(joiner);
  switch (style) {
    // Frame: bold English, a dot, the Thai name; no emoji or brackets (START · เริ่มต้นที่นี่).
    case "frame": return label("bold", " · ");
    case "line": return `╭┈ ${e ? `${e} ` : ""}${label("boldSans", " ┊ ")}`;
    case "cute": return e ? `⋆˚꒰${e}꒱ ${label("smallCaps", " ・ ")}` : english && thai ? `⋆˚꒰${label("smallCaps", "")}꒱ ${thai}` : `⋆˚꒰${label("smallCaps", "")}꒱`;
    default: return e ? `${e} ${thai || english}` : thai || english;
  }
}

export function roleName(style: NameStyle, name: string, emoji = "") {
  const e = withIcon(emoji);
  switch (style) {
    case "frame": return e ? `『${e}』${fancy(name, "bold")}` : `『${fancy(name, "bold")}』`;
    case "line": return e ? `┊${e}┊${fancy(name, "boldSans")}` : `┊ ${fancy(name, "boldSans")}`;
    case "cute": return e ? `꒰${e}꒱ ${fancy(name, "smallCaps")}` : `꒰${fancy(name, "smallCaps")}꒱`;
    default: return e ? `${e} ${name}` : name;
  }
}

// Restyling a name that is already there: take off emoji, frames and separators, keep the words
// (and the emoji, when it is wanted), then put them back in the chosen style.

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
const FIRST_EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*|[\u{1F1E6}-\u{1F1FF}]{2}/u;
const FRAME_CHARS = /[『』「」【】〔〕꒰꒱┊│|╭╮╰╯┈─━・·•⋆˚｡✦✧★☆:：\-_\s]+/gu;

// English room names shown in bold capitals, as the bot builds them.
const BOLD_CHANNELS = new Set(["welcome", "sayonara", "verify", "roles", "system status", "web activity", "discord activity", "boost", "links"]);

/** The words of a name, without emoji, frame, separators or fancy letters. */
export function nameWords(raw: string) {
  return unfancy(raw).replace(EMOJI, " ").replace(FRAME_CHARS, " ").trim();
}

/** The emoji a name already has ("" when none). */
function emojiOf(raw: string) {
  return unfancy(raw).match(FIRST_EMOJI)?.[0] ?? "";
}

/** The same channel or category name in another style ("" when there is nothing to keep). */
export function restyle(style: NameStyle, type: ChannelType, raw: string) {
  const words = nameWords(raw);
  if (!words) return "";
  const emoji = emojiOf(raw) || iconOf(words) || DEFAULT_ICON[type] || "💬";
  if (type === ChannelType.GuildCategory) {
    // English words (at the start) get the fancy letters; Thai keeps its own letters.
    if (/^[\x20-\x7e]+$/.test(words)) return categoryName(style, words, "", emoji || iconOf(words)).slice(0, 100);
    const mixed = words.match(/^([A-Za-z0-9&'. ]+?)\s+([^\x20-\x7e].*)$/u);
    const english = mixed?.[1] ?? "";
    return categoryName(style, english, mixed?.[2] ?? words, emojiOf(raw) || iconOf(english) || iconOf(mixed?.[2] ?? words) || emoji).slice(0, 100);
  }
  // Text channel names cannot have spaces (Discord turns them into dashes).
  const dashed = type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement || type === ChannelType.GuildForum ? words.replace(/\s+/g, "-") : words;
  const name = BOLD_CHANNELS.has(words.toLowerCase().replace(/[-\s]+/g, " ")) ? fancy(dashed.toUpperCase(), "bold") : dashed;
  return channelName(style, name, emoji).slice(0, 100);
}

/** A role name in another style ("" when there is nothing to keep). */
export function restyleRole(style: NameStyle, raw: string) {
  const words = nameWords(raw);
  return words ? roleName(style, words, emojiOf(raw) || iconOf(words)).slice(0, 100) : "";
}
