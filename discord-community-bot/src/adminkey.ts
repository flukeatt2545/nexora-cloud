import { AttachmentBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { api, apiMessage, logBotError } from "./api";
import { errorEmbed, okEmbed } from "./ui";

// /adminkey: a superadmin makes an emergency sign-in key for themselves. The site decides who may;
// it checks the member is linked to an active superadmin account. The reply is only visible to them.
export async function onAdminKeyCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const label = interaction.options.getString("name", true);
  const expiresInDays = Number(interaction.options.getString("expires") ?? "90");
  try {
    const { data } = await api(interaction.user).post<{ key: string }>("/api/internal/bot/admin-keys", { label, expiresInDays });
    const file = new AttachmentBuilder(Buffer.from(`${data.key}\n`, "utf8"), { name: "nexora-admin.key" });
    await interaction.editReply({
      embeds: [okEmbed("สร้างคีย์แล้ว", "ดาวน์โหลดไฟล์นี้เก็บไว้เลย ข้อความนี้จะหายเมื่อปิด Discord และเรียกดูคีย์ซ้ำไม่ได้\nยกเลิกคีย์ได้ที่หน้าตั้งค่าเข้าสู่ระบบบนเว็บ")],
      files: [file],
    });
  } catch (error) {
    logBotError("adminkey", error);
    await interaction.editReply({ embeds: [errorEmbed("สร้างคีย์ไม่ได้", apiMessage(error, "ตอนนี้สร้างคีย์ไม่ได้ ลองใหม่อีกครั้ง"))] });
  }
}
