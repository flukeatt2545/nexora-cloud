import {
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Client,
} from "discord.js";
import { api, logBotError } from "./api";
import { COLOR, MESSAGE_ID_RE, button, clip, plain, row, thaiTime } from "./ui";

export type NotifyItem = {
  discordUserId: string;
  mailboxId: string;
  address: string;
  total: number;
  messages: { id: string; from: string; fromName: string; subject: string; preview: string; date: string }[];
};

const POLL_MS = 30000;
let running = false;

export function notificationMessage(item: NotifyItem) {
  const lines = item.messages.map((message) => {
    const who = plain(clip(message.fromName || message.from || "ไม่ทราบผู้ส่ง", 60));
    const subject = plain(clip(message.subject || "ไม่มีหัวข้อ", 90));
    const preview = message.preview ? `\n${plain(clip(message.preview, 140))}` : "";
    return `**${subject}**\n${who} · ${thaiTime(message.date, "short")}${preview}`;
  });
  if (item.total > item.messages.length) lines.push(`และอีก ${item.total - item.messages.length} ฉบับ`);
  const embed = new EmbedBuilder()
    .setTitle(item.total > 1 ? `เมลใหม่ ${item.total} ฉบับ` : "เมลใหม่")
    .setColor(COLOR.brand)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: item.address });
  const options = item.messages
    .filter((message) => MESSAGE_ID_RE.test(message.id))
    .map((message) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(clip(message.subject || "ไม่มีหัวข้อ", 100))
        .setDescription(clip(message.fromName || message.from || "ไม่ทราบผู้ส่ง", 100))
        .setValue(message.id)
    );
  const components = [];
  if (options.length) {
    components.push(
      row(new StringSelectMenuBuilder().setCustomId(`m:dm:open:${item.mailboxId}`).setPlaceholder("อ่านเมล").addOptions(options))
    );
  }
  components.push(row(button(`m:dm:off:${item.mailboxId}`, "ปิดแจ้งเตือนกล่องนี้", ButtonStyle.Secondary)));
  return { embeds: [embed], components };
}

async function sendNotification(client: Client, item: NotifyItem) {
  const user = await client.users.fetch(item.discordUserId);
  await user.send(notificationMessage(item));
}

async function poll(client: Client) {
  if (running) return;
  running = true;
  try {
    const res = await api().get("/api/internal/bot/mail/notify/poll", { timeout: 25000 });
    const items = (res.data?.items || []) as NotifyItem[];
    for (const item of items) {
      try {
        await sendNotification(client, item);
      } catch {
        // Usually the member has closed DMs from server members; nothing to do but skip.
        console.warn(`[WARN] Could not DM new-mail notice for ${item.address}`);
      }
    }
  } catch (error) {
    logBotError("notify-poll", error);
  } finally {
    running = false;
  }
}

export function startNotifications(client: Client) {
  setInterval(() => void poll(client), POLL_MS);
  setTimeout(() => void poll(client), 5000);
}
