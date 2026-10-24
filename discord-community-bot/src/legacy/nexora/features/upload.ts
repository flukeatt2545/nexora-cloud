import axios from "axios";
import { EmbedBuilder, SlashCommandBuilder, type Attachment, type ChatInputCommandInteraction } from "discord.js";
import type { AxiosProgressEvent } from "axios";
import { recordActivity } from "./activity-log";
import { describeError, errorStatus } from "./errors";

const API_URL = (process.env.NEXORA_API_URL || "http://api:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();

const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB — matches Discord's own attachment limit
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// Progress UI: download phase counts as 0–50%, upload phase as 50–100%.
const DOWNLOAD_SHARE = 50;
const PROGRESS_THROTTLE_MS = 1500;

export const uploadCommand = new SlashCommandBuilder()
  .setName("upload")
  .setDescription("อัปโหลดรูปภาพขึ้นเว็บ nkn02.com แล้วรับลิงก์")
  .addAttachmentOption((opt) => opt.setName("file1").setDescription("รูปที่ 1").setRequired(true))
  .addAttachmentOption((opt) => opt.setName("file2").setDescription("รูปที่ 2").setRequired(false))
  .addAttachmentOption((opt) => opt.setName("file3").setDescription("รูปที่ 3").setRequired(false))
  .addAttachmentOption((opt) => opt.setName("file4").setDescription("รูปที่ 4").setRequired(false))
  .addAttachmentOption((opt) => opt.setName("file5").setDescription("รูปที่ 5").setRequired(false))
  .addAttachmentOption((opt) => opt.setName("file6").setDescription("รูปที่ 6").setRequired(false))
  .addAttachmentOption((opt) => opt.setName("file7").setDescription("รูปที่ 7").setRequired(false))
  .addAttachmentOption((opt) => opt.setName("file8").setDescription("รูปที่ 8").setRequired(false))
  .addAttachmentOption((opt) => opt.setName("file9").setDescription("รูปที่ 9").setRequired(false))
  .addAttachmentOption((opt) => opt.setName("file10").setDescription("รูปที่ 10").setRequired(false));

type UploadedItem = { url: string; filename: string; size: number };

function notice(title: string, description: string) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(0xf59e0b);
}

function progressBar(pct: number, width = 14): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function progressEmbed(phase: string, pct: number) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return new EmbedBuilder()
    .setTitle("กำลังอัปโหลดรูป...")
    .setDescription(`${phase}\n${progressBar(p)} **${p}%**`)
    .setColor(0x5865f2);
}

export async function handleUploadCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // NOTE: index.ts must route commandName === "upload" here WITHOUT admin/scope
  // gating (everyone in the guild may use it), after beginPrivateReply().
  const attachments: Attachment[] = [];
  for (let i = 1; i <= MAX_FILES; i++) {
    const att = interaction.options.getAttachment(`file${i}`);
    if (att) attachments.push(att);
  }
  if (!attachments.length) {
    await interaction.editReply({ embeds: [notice("แนบรูปก่อน", "เลือกไฟล์รูปอย่างน้อย 1 รูป")] });
    return;
  }

  // Validate before downloading anything.
  for (const att of attachments) {
    const type = String(att.contentType || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
      await interaction.editReply({
        embeds: [notice("ไฟล์ไม่รองรับ", `**${att.name}** ไม่ใช่รูปภาพ\nรับเฉพาะ JPG, PNG, GIF, WebP`)],
      });
      return;
    }
    if ((att.size || 0) > MAX_FILE_BYTES) {
      await interaction.editReply({
        embeds: [notice("ไฟล์ใหญ่เกินไป", `**${att.name}** เกิน 25MB`)],
      });
      return;
    }
  }

  const user = interaction.user;
  const username = String(user?.username || "unknown");
  const guildId = String(interaction.guildId || "dm");

  // Throttled progress updater. Discord rate-limits message edits, so updates
  // are at most one per PROGRESS_THROTTLE_MS unless forced (milestones / 100%).
  let lastPct = -1;
  let lastEdit = 0;
  const updateProgress = async (phase: string, pct: number, force = false): Promise<void> => {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const now = Date.now();
    if (p === lastPct) return;
    if (!force && p < 100 && now - lastEdit < PROGRESS_THROTTLE_MS) return;
    lastPct = p;
    lastEdit = now;
    try {
      await interaction.editReply({ embeds: [progressEmbed(phase, p)] });
    } catch {
      // Non-fatal: the final result message will overwrite anyway.
    }
  };

  try {
    await updateProgress("กำลังเตรียมอัปโหลด...", 0, true);

    // Phase 1: download from Discord CDN (0–50%).
    const totalBytes = attachments.reduce((s: number, a: Attachment) => s + (Number(a.size) || 0), 0);
    let downloadedBytes = 0;
    const form = new FormData();
    form.append("guild_id", guildId);
    form.append("discord_user_id", String(user?.id || ""));
    form.append("discord_username", username);

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const phase = `กำลังดาวน์โหลดรูปที่ ${i + 1}/${attachments.length}`;
      const res = await axios.get<ArrayBuffer>(att.url, {
        responseType: "arraybuffer",
        timeout: 60000,
        onDownloadProgress: (e: AxiosProgressEvent) => {
          const loaded = downloadedBytes + (Number(e?.loaded) || 0);
          const pct = totalBytes > 0 ? (loaded / totalBytes) * DOWNLOAD_SHARE : 0;
          void updateProgress(phase, pct);
        },
      });
      const data: ArrayBuffer = res.data;
      downloadedBytes += data.byteLength;
      const pct = totalBytes > 0 ? (downloadedBytes / totalBytes) * DOWNLOAD_SHARE : DOWNLOAD_SHARE;
      await updateProgress(`ดาวน์โหลดรูปที่ ${i + 1}/${attachments.length} เสร็จ`, pct, true);
      const blob = new Blob([data], { type: String(att.contentType || "application/octet-stream") });
      form.append("file", blob, att.name || "image");
    }

    // Phase 2: upload to the Nexora backend (50–100%).
    const res = await axios.post(`${API_URL}/api/internal/bot/uploads`, form, {
      headers: {
        "X-Bot-Internal-Secret": BOT_SECRET,
        "X-Bot-Actor-Discord-Id": String(user?.id || ""),
      },
      timeout: 120000,
      maxBodyLength: Infinity,
      onUploadProgress: (e: AxiosProgressEvent) => {
        const total = Number(e?.total) || 0;
        const frac = total > 0 ? Number(e?.loaded || 0) / total : 0;
        void updateProgress("กำลังอัปโหลดขึ้นเซิร์ฟเวอร์...", DOWNLOAD_SHARE + frac * (100 - DOWNLOAD_SHARE));
      },
    });
    await updateProgress("อัปโหลดเสร็จสมบูรณ์", 100, true);

    const items: UploadedItem[] = res.data?.items || [];
    if (!items.length) throw new Error("backend returned no items");

    const embeds = items.map((item, i) =>
      new EmbedBuilder()
        .setTitle(`รูปที่ ${i + 1}`)
        .setDescription(`[เปิดรูปเต็ม](${item.url})\n\`${item.url}\``)
        .setImage(item.url)
        .setColor(0x5865f2)
    );
    embeds[0].setFooter({ text: `อัปโหลดโดย ${username}` }).setTimestamp();
    recordActivity(interaction, {
      outcome: "success",
      result: `อัปโหลดรูปสำเร็จ ${items.length} ไฟล์`,
    });
    await interaction.editReply({
      content: `อัปโหลดสำเร็จ **${items.length} รูป**`,
      embeds: embeds.slice(0, 10),
    });
  } catch (error) {
    console.error("[ERROR] /upload", errorStatus(error) || "", describeError(error));
    recordActivity(interaction, { outcome: "failure", result: "อัปโหลดรูปไม่สำเร็จ", details: String((error instanceof Error && error.message) || "unknown").slice(0, 200) });
    await interaction.editReply({
      embeds: [notice("อัปโหลดไม่สำเร็จ", "ลองอีกครั้ง หากยังไม่ได้ให้ผู้ดูแลตรวจสอบ")],
    });
  }
}
