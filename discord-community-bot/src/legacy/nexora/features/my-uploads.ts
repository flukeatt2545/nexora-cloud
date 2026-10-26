import axios from "axios";
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { recordActivity } from "./activity-log";
import { describeError, errorStatus } from "./errors";
import { displayName, fmtSize } from "./upload";

const API_URL = (process.env.NEXORA_API_URL || "http://api:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();

const HISTORY_LIMIT = 10;

export const myUploadsCommand = new SlashCommandBuilder()
  .setName("my-uploads")
  .setNameLocalizations({ th: "รูปของฉัน" })
  .setDescription("ดูรูปที่เคยอัปโหลดผ่านบอท")
  .setDMPermission(false);

type HistoryItem = {
  url: string;
  filename: string;
  size: number;
  content_type: string;
  created_at: string;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
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

    // One card with the list, and the newest pictures as a grid (embeds sharing a URL).
    const lines = items.map(
      (item, i) => `**${i + 1}.** [${displayName(item.filename)}](${item.url})\n└ ${fmtSize(item.size)} · ${fmtDate(item.created_at)}`
    );
    const gridUrl = items[0].url;
    const summary = new EmbedBuilder()
      .setTitle(`รูปที่คุณอัปโหลดล่าสุด ${items.length} รูป`)
      .setDescription(lines.join("\n"))
      .setURL(gridUrl)
      .setImage(items[0].url)
      .setColor(0x5865f2)
      .setFooter({ text: `${username} · ลบรูปได้ที่ /gallery` })
      .setTimestamp();
    const grid = items.slice(1, 4).map((item) => new EmbedBuilder().setURL(gridUrl).setImage(item.url).setColor(0x5865f2));
    recordActivity(interaction, {
      outcome: "success",
      result: `แสดงรูปที่เคยอัปโหลดล่าสุด ${items.length} รูป`,
    });
    await interaction.editReply({ content: "", embeds: [summary, ...grid] });
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
