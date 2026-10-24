import axios from "axios";
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { recordActivity } from "./activity-log";
import { describeError, errorStatus } from "./errors";

const API_URL = (process.env.NEXORA_API_URL || "http://api:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();

const HISTORY_LIMIT = 10;

export const myUploadsCommand = new SlashCommandBuilder()
  .setName("my-uploads")
  .setDescription("ดูรูปที่เคยอัปโหลดผ่านบอท");

type HistoryItem = {
  url: string;
  filename: string;
  size: number;
  content_type: string;
  created_at: string;
};

function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}

function shortName(name: string, max = 40): string {
  const s = String(name || "ไฟล์รูป");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export async function handleMyUploadsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // NOTE: index.ts must route commandName === "my-uploads" here WITHOUT
  // admin/scope gating (everyone in the guild may use it), after beginPrivateReply().
  const user = interaction.user;
  const userId = String(user?.id || "");
  const username = String(user?.username || "unknown");
  const guildId = String(interaction.guildId || "");

  try {
    const res = await axios.get(`${API_URL}/api/internal/bot/uploads`, {
      params: { discord_user_id: userId, guild_id: guildId, limit: HISTORY_LIMIT },
      headers: {
        "X-Bot-Internal-Secret": BOT_SECRET,
        "X-Bot-Actor-Discord-Id": userId,
      },
      timeout: 30000,
    });
    const items: HistoryItem[] = res.data?.items || [];
    if (!items.length) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("ยังไม่มีประวัติการอัปโหลด")
            .setDescription("คุณยังไม่เคยอัปโหลดรูปผ่านบอทในเซิร์ฟเวอร์นี้\nลองใช้คำสั่ง `/upload` ได้เลย")
            .setColor(0xf59e0b),
        ],
      });
      return;
    }

    const embeds = items.map((item, i) =>
      new EmbedBuilder()
        .setTitle(`รูปที่ ${i + 1} — ${shortName(item.filename)}`)
        .setDescription(
          `[เปิดรูปเต็ม](${item.url})\n\`${item.url}\`\n${fmtSize(item.size)} · ${fmtDate(item.created_at)}`
        )
        .setImage(item.url)
        .setColor(0x5865f2)
    );
    embeds[0]
      .setFooter({ text: `ประวัติการอัปโหลดของ ${username} (${items.length} รูปล่าสุด)` })
      .setTimestamp();
    recordActivity(interaction, {
      outcome: "success",
      result: `แสดงรูปที่เคยอัปโหลดล่าสุด ${items.length} รูป`,
    });
    await interaction.editReply({
      content: `เจอ **${items.length} รูป** ที่คุณเคยอัปโหลด\nอยากลบรูปไหน ใช้คำสั่ง "/gallery" เพื่อเปิดหน้าจัดการ`,
      embeds: embeds.slice(0, 10),
    });
  } catch (error) {
    console.error("[ERROR] /my-uploads", errorStatus(error) || "", describeError(error));
    recordActivity(interaction, { outcome: "failure", result: "ดึงประวัติการอัปโหลดไม่สำเร็จ ระบบหลังบ้านไม่ตอบสนอง", details: String((error instanceof Error && error.message) || "unknown").slice(0, 200) });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("ดูประวัติไม่สำเร็จ")
          .setDescription("ลองอีกครั้ง หากยังไม่ได้ให้ผู้ดูแลตรวจสอบ")
          .setColor(0xf59e0b),
      ],
    });
  }
}
