import axios from "axios";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { recordActivity } from "./activity-log";
import { describeError, errorStatus } from "./errors";

const API_URL = (process.env.NEXORA_API_URL || "http://api:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();

export const galleryCommand = new SlashCommandBuilder()
  .setName("gallery")
  .setDescription("รับลิงก์แกลเลอรีรูปของคุณ (ดูและลบรูปได้ ไม่ต้องล็อกอิน)");

export async function handleGalleryCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // NOTE: index.ts must route commandName === "gallery" here WITHOUT admin/scope
  // gating (everyone in the guild may use it), after beginPrivateReply().
  const user = interaction.user;
  const userId = String(user?.id || "");
  const username = String(user?.username || "unknown");
  const guildId = String(interaction.guildId || "");

  try {
    // If the user has no uploads yet, tell them directly instead of sending
    // them to an empty gallery page.
    try {
      const hist = await axios.get(`${API_URL}/api/internal/bot/uploads`, {
        params: { discord_user_id: userId, guild_id: guildId, limit: 1 },
        headers: { "X-Bot-Internal-Secret": BOT_SECRET },
        timeout: 15000,
      });
      const items = hist.data?.items || [];
      if (!items.length) {
        recordActivity(interaction, {
          outcome: "success",
          result: "ยังไม่ได้ออกลิงก์ เพราะผู้ใช้ยังไม่เคยอัปโหลดรูป",
        });
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("ยังไม่มีรูปในแกลเลอรี")
              .setDescription(
                "คุณยังไม่เคยอัปโหลดรูปในเซิร์ฟเวอร์นี้\nลองใช้คำสั่ง /upload เพื่ออัปโหลดรูปแรกได้เลย"
              )
              .setColor(0x5865f2),
          ],
        });
        return;
      }
    } catch (checkErr) {
      // Non-fatal: if the check itself fails, fall through and issue the
      // ticket anyway rather than blocking the user.
      console.warn("[WARN] /gallery upload check failed, continuing:", describeError(checkErr));
    }

    const res = await axios.post(
      `${API_URL}/api/internal/bot/gallery-ticket`,
      {
        discord_user_id: userId,
        discord_username: username,
        guild_id: guildId,
      },
      {
        headers: {
          "X-Bot-Internal-Secret": BOT_SECRET,
          "X-Bot-Actor-Discord-Id": userId,
        },
        timeout: 30000,
      }
    );
    const url = String(res.data?.url || "");
    if (!url) throw new Error("backend returned no url");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setLabel("เปิดแกลเลอรีของฉัน").setStyle(ButtonStyle.Link).setURL(url)
    );
    recordActivity(interaction, {
      outcome: "success",
      result: "ออกลิงก์เข้าแกลเลอรีให้แล้ว (ใช้ได้ครั้งเดียว หมดอายุใน 10 นาที)",
    });
    await interaction.editReply({
      content:
        "กดปุ่มด้านล่างเพื่อเปิดแกลเลอรีรูปของคุณ\n" +
        "ลิงก์นี้ใช้ได้ครั้งเดียว หมดอายุใน 10 นาที ไม่ต้องล็อกอิน",
      components: [row],
    });
  } catch (error) {
    console.error("[ERROR] /gallery", errorStatus(error) || "", describeError(error));
    recordActivity(interaction, { outcome: "failure", result: "ออกลิงก์แกลเลอรีไม่สำเร็จ ระบบหลังบ้านไม่ตอบสนอง", details: String((error instanceof Error && error.message) || "unknown").slice(0, 200) });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("ขอลิงก์ไม่สำเร็จ")
          .setDescription("ลองอีกครั้ง หากยังไม่ได้ให้ผู้ดูแลตรวจสอบ")
          .setColor(0xf59e0b),
      ],
    });
  }
}
