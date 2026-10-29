// The messages the outside checker posts through the Discord webhook. Same look as the
// Discord bot's status alerts (discord-community-bot/src/status.ts), without emoji.
// Times use Discord's own stamps (<t:..:t>, <t:..:R>) so each reader sees their time zone.

export const COLOR = { down: 0xff3b4a, back: 0x3ddc97, was: 0xf59e0b, quiet: 0x6b7280 };
const AUTHOR = { name: "NEXORA CLOUD · STATUS" };
const SOURCE = "เช็กจาก Cloudflare";

type Embed = {
  author: { name: string };
  title: string;
  description: string;
  color: number;
  footer?: { text: string };
  timestamp?: string;
};

export type WebhookMessage = {
  username: string;
  content?: string;
  embeds: Embed[];
  /** Who may be pinged: only the role picked on the admin page, and only in a "down" alert. */
  allowed_mentions: { parse: string[]; roles?: string[] };
};

const stamp = (at: Date, style: "t" | "R" | "f") => `<t:${Math.floor(at.getTime() / 1000)}:${style}>`;

/** 1 นาที, 45 นาที, 2 ชั่วโมง 5 นาที, 1 วัน 3 ชั่วโมง */
export function duration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} ชั่วโมง ${minutes % 60} นาที` : `${hours} ชั่วโมง`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} วัน ${hours % 24} ชั่วโมง` : `${days} วัน`;
}

function message(username: string, embed: Embed, content?: string, roles: string[] = []): WebhookMessage {
  return { username, ...(content ? { content } : {}), embeds: [embed], allowed_mentions: { parse: [], ...(roles.length ? { roles } : {}) } };
}

/**
 * Red while it is down. Given `endedAt`, the same alert turned orange once it is back
 * (the old message is edited, so the channel reads as history).
 */
export function downEmbed(username: string, name: string, since: Date, detail: string, roleId: string, endedAt?: Date): WebhookMessage {
  const embed: Embed = {
    author: AUTHOR,
    title: `${name}ล่ม`,
    description: `ใช้งาน${name}ไม่ได้ตั้งแต่ ${stamp(since, "t")} (${stamp(since, "R")})\nสาเหตุ: ${detail}`,
    color: endedAt ? COLOR.was : COLOR.down,
    footer: { text: endedAt ? `กลับมาแล้ว · ล่มไป ${duration(endedAt.getTime() - since.getTime())} · ${SOURCE}` : `${SOURCE} · จะแจ้งอีกครั้งเมื่อกลับมา` },
  };
  // The edit keeps the mention text but pings nobody a second time.
  return message(username, embed, roleId ? `<@&${roleId}>` : undefined, roleId && !endedAt ? [roleId] : []);
}

export function backEmbed(username: string, name: string, since: Date, endedAt: Date): WebhookMessage {
  return message(username, {
    author: AUTHOR,
    title: `${name}กลับมาใช้ได้แล้ว`,
    description: `ล่มไป ${duration(endedAt.getTime() - since.getTime())} (${stamp(since, "t")} – ${stamp(endedAt, "t")})`,
    color: COLOR.back,
    footer: { text: SOURCE },
  });
}

/** Failed once and passed on the retry 15 seconds later. */
export function blipEmbed(username: string, name: string, at: Date, detail: string): WebhookMessage {
  return message(username, {
    author: AUTHOR,
    title: `${name}สะดุด`,
    description: `${stamp(at, "t")} เช็กไม่ผ่าน แต่ลองใหม่แล้วใช้ได้\n${detail}`,
    color: COLOR.quiet,
    footer: { text: `${SOURCE} · ไม่นับเป็นล่ม` },
  });
}

/** Failed rounds that ended before reaching the alert. */
export function minorEmbed(username: string, name: string, since: Date, endedAt: Date, detail: string): WebhookMessage {
  return message(username, {
    author: AUTHOR,
    title: `${name}เช็กไม่ผ่านช่วงสั้นๆ`,
    description: `${stamp(since, "t")} – ${stamp(endedAt, "t")}\n${detail}`,
    color: COLOR.quiet,
    footer: { text: `${SOURCE} · ไม่ถึงเกณฑ์แจ้งล่ม` },
  });
}

export function digestEmbed(username: string, day: string, items: { name: string; at: string; detail: string }[]): WebhookMessage {
  const lines = items.slice(0, 20).map((item) => `${stamp(new Date(item.at), "t")} ${item.name}: ${item.detail}`);
  if (items.length > 20) lines.push(`และอีก ${items.length - 20} ครั้ง`);
  return message(username, {
    author: AUTHOR,
    title: `สรุปการสะดุดของวันที่ ${day}`,
    description: `${items.length} ครั้ง ไม่มีครั้งไหนถึงเกณฑ์แจ้งล่ม\n\n${lines.join("\n")}`.slice(0, 4000),
    color: COLOR.quiet,
    footer: { text: SOURCE },
  });
}

/** What an alert looks like, sent from the admin page. Shows the role but pings nobody. */
export function testEmbed(username: string, roleId: string): WebhookMessage {
  const now = new Date();
  return {
    username,
    ...(roleId ? { content: `<@&${roleId}>` } : {}),
    embeds: [{
      author: AUTHOR,
      title: "ทดสอบ: เว็บไซต์ล่ม",
      description: `ใช้งานเว็บไซต์ไม่ได้ตั้งแต่ ${stamp(now, "t")} (${stamp(now, "R")})\nสาเหตุ: HTTP 502 · 1234 ms · เช็กจาก SIN`,
      color: COLOR.down,
      footer: { text: `ข้อความทดสอบ ไม่ได้ล่มจริง · ${SOURCE}` },
    }],
    allowed_mentions: { parse: [] },
  };
}
