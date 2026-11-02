import axios from "axios";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  type Attachment,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { AxiosProgressEvent } from "axios";
import { recordActivity } from "./activity-log";
import { apiErrorField, describeError, errorStatus } from "./errors";

const API_URL = (process.env.NEXORA_API_URL || "http://api:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();

export const OPTION_FILES = 5; // a slash command takes one file per option, so the form is the main way in
export const MAX_FILES = 10; // the most a modal's file picker allows; matches the backend limit
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // matches the backend limit
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024; // every picture is held in memory until it is sent
export const UPLOAD_MODAL_ID = "modal_upload";
const UPLOAD_FILES_ID = "upload_files";
const COOLDOWN_MS = 15_000;

// Progress UI: download phase counts as 0–50%, upload phase as 50–100%.
const DOWNLOAD_SHARE = 50;
const PROGRESS_THROTTLE_MS = 1500;

const BLUE = 0x5865f2;
const GREEN = 0x22c55e;
const AMBER = 0xf59e0b;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

// Attachments only ever come from Discord's own CDN: anything else is not fetched.
const CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export const uploadCommand = (() => {
  const command = new SlashCommandBuilder()
    .setName("upload")
    .setNameLocalizations({ th: "อัปโหลด" })
    .setDescription("อัปโหลดรูปขึ้น nkn02.com ได้ทีละหลายรูป แล้วรับลิงก์ (JPG, PNG, GIF, WebP ไม่เกิน 25MB)")
    .setDMPermission(false);
  for (let i = 1; i <= OPTION_FILES; i++) {
    command.addAttachmentOption((opt) =>
      opt
        .setName(`image${i}`)
        .setNameLocalizations({ th: `รูป${i}` })
        .setDescription(`รูปที่ ${i} (ไม่แนบก็ได้ จะขึ้นหน้าต่างให้เลือกหลายรูป)`)
    );
  }
  return command;
})();

/** The form with a file picker, where several pictures can be chosen at once. */
export function uploadModal() {
  return new ModalBuilder()
    .setCustomId(UPLOAD_MODAL_ID)
    .setTitle("อัปโหลดรูป")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`เลือกรูป ได้สูงสุด ${MAX_FILES} รูป`)
        .setDescription("JPG, PNG, GIF, WebP รูปละไม่เกิน 25MB")
        .setFileUploadComponent(new FileUploadBuilder().setCustomId(UPLOAD_FILES_ID).setMinValues(1).setMaxValues(MAX_FILES))
    );
}

/** The pictures attached to the slash command itself; none means the form should open. */
export function commandAttachments(interaction: ChatInputCommandInteraction): Attachment[] {
  const attachments: Attachment[] = [];
  for (let i = 1; i <= OPTION_FILES; i++) {
    const att = interaction.options.getAttachment(`image${i}`);
    if (att) attachments.push(att);
  }
  return attachments;
}

export function modalAttachments(interaction: ModalSubmitInteraction): Attachment[] {
  return [...(interaction.fields.getUploadedFiles(UPLOAD_FILES_ID) ?? new Map<string, Attachment>()).values()];
}

/** Why this set of pictures cannot go together, or "". */
export function batchProblem(attachments: Pick<Attachment, "size">[]): string {
  if (attachments.length > MAX_FILES) return `เลือกได้ไม่เกิน ${MAX_FILES} รูปต่อครั้ง`;
  const total = attachments.reduce((sum, att) => sum + (Number(att.size) || 0), 0);
  return total > MAX_TOTAL_BYTES ? `รูปรวมกันต้องไม่เกิน ${MAX_TOTAL_BYTES / 1024 / 1024}MB ต่อครั้ง` : "";
}

type UploadedItem = { url: string; filename: string; size: number };

/** Message shown when something is wrong; `title` says what, `description` says what to do. */
function notice(title: string, description: string) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(AMBER);
}

export function progressBar(pct: number, width = 14): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function progressEmbed(phase: string, pct: number) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return new EmbedBuilder()
    .setTitle("กำลังอัปโหลดรูป...")
    .setDescription(`${phase}\n${progressBar(p)} **${p}%**`)
    .setColor(BLUE);
}

export function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** A file name that is safe to show inside Discord markdown links. */
export function displayName(name: string, max = 40): string {
  const clean = String(name || "")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[\[\]()*_`~|>\\]/g, "")
    .trim() || "รูปภาพ";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Only an https link on Discord's CDN, so the bot cannot be pointed at another server. */
export function isDiscordCdnUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && CDN_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** What the file really is, from its first bytes — the type Discord reports is not trusted. */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  const startsWith = (...sig: number[]) => sig.every((byte, i) => bytes[i] === byte);
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (startsWith(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** Why an attachment cannot be uploaded, or "" when it can. Checked before anything is downloaded. */
export function attachmentProblem(att: Pick<Attachment, "name" | "contentType" | "size" | "url">): string {
  const name = displayName(att.name);
  const type = String(att.contentType || "").split(";")[0].trim().toLowerCase();
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) return `**${name}** ไม่ใช่รูปภาพที่รองรับ — รับเฉพาะ JPG, PNG, GIF, WebP`;
  if (!(att.size > 0) || att.size > MAX_FILE_BYTES) return `**${name}** ใหญ่เกิน ${MAX_FILE_BYTES / 1024 / 1024}MB`;
  if (!isDiscordCdnUrl(att.url)) return `**${name}** ดึงไฟล์ไม่ได้ ลองแนบใหม่อีกครั้ง`;
  return "";
}

// One upload at a time per member, and a short pause between uploads.
const running = new Set<string>();
const lastDone = new Map<string, number>();

/** Seconds the member still has to wait, or 0 when they may start. */
function waitSeconds(userId: string, now = Date.now()): number {
  for (const [id, at] of lastDone) if (now - at > COOLDOWN_MS) lastDone.delete(id);
  const at = lastDone.get(userId);
  return at ? Math.max(0, Math.ceil((COOLDOWN_MS - (now - at)) / 1000)) : 0;
}

/** The backend's own wording for the problems a member can fix; anything else stays generic. */
function failureNotice(error: unknown) {
  const status = errorStatus(error);
  const code = apiErrorField(error, "code");
  const message = apiErrorField(error, "error");
  const fixable = ["unsupported_type", "invalid_file_size", "too_many_files", "upload_rate_limited", "upload_quota_exceeded"];
  if (message && fixable.includes(code)) return notice("อัปโหลดไม่ได้", message);
  if (status === 503) return notice("ระบบเก็บไฟล์ยังไม่พร้อม", "รอสักครู่แล้วลองใหม่อีกครั้ง");
  return notice("อัปโหลดไม่สำเร็จ", "ลองอีกครั้ง หากยังไม่ได้ให้ผู้ดูแลตรวจสอบ");
}

/** One summary card with every link, the first pictures as a grid, and a button per picture. */
export function resultMessage(items: UploadedItem[], username: string) {
  const lines = items.map((item, i) => `**${i + 1}.** [${displayName(item.filename)}](${item.url}) · ${fmtSize(item.size)}`);
  const summary = new EmbedBuilder()
    .setTitle(`อัปโหลดสำเร็จ ${items.length} รูป`)
    .setDescription(
      lines.join("\n") + (items.length === 1 ? `\n\n**ลิงก์สำหรับคัดลอก**\n\`\`\`${items[0].url}\`\`\`` : "")
    )
    .setColor(GREEN)
    .setFooter({ text: `อัปโหลดโดย ${username} · ลบรูปได้ที่ /gallery` })
    .setTimestamp();
  // Embeds that share one URL are shown by Discord as a single picture grid (up to four).
  const gridUrl = items[0].url;
  const preview = items.slice(0, 4);
  summary.setURL(gridUrl).setImage(preview[0].url);
  const grid = preview.slice(1).map((item) => new EmbedBuilder().setURL(gridUrl).setImage(item.url).setColor(GREEN));

  // Discord fits five buttons on a row.
  const buttons = items.slice(0, MAX_FILES).map((item, i) =>
    new ButtonBuilder().setLabel(items.length === 1 ? "เปิดรูปเต็ม" : `เปิดรูป ${i + 1}`).setStyle(ButtonStyle.Link).setURL(item.url)
  );
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  return { embeds: [summary, ...grid], components: rows };
}

export async function handleUpload(interaction: ChatInputCommandInteraction | ModalSubmitInteraction, attachments: Attachment[]): Promise<void> {
  // NOTE: index.ts must route /upload and its form here WITHOUT admin/scope
  // gating (everyone in the guild may use it), after beginPrivateReply().
  if (!attachments.length) {
    await interaction.editReply({ embeds: [notice("แนบรูปก่อน", "เลือกรูปอย่างน้อย 1 รูป")] });
    return;
  }

  const user = interaction.user;
  const userId = String(user?.id || "");
  const username = String(user?.username || "unknown");
  const guildId = String(interaction.guildId || "");
  if (!interaction.guildId) {
    await interaction.editReply({ embeds: [notice("ใช้ได้เฉพาะในเซิร์ฟเวอร์", "คำสั่งนี้ใช้ในเซิร์ฟเวอร์เท่านั้น")] });
    return;
  }

  // Validate before downloading anything.
  const tooMuch = batchProblem(attachments);
  if (tooMuch) {
    await interaction.editReply({ embeds: [notice("อัปโหลดไม่ได้", tooMuch)] });
    return;
  }
  for (const att of attachments) {
    const problem = attachmentProblem(att);
    if (problem) {
      await interaction.editReply({ embeds: [notice("อัปโหลดไม่ได้", problem)] });
      return;
    }
  }

  if (running.has(userId)) {
    await interaction.editReply({ embeds: [notice("กำลังอัปโหลดอยู่", "รอให้รูปก่อนหน้าอัปโหลดเสร็จก่อน")] });
    return;
  }
  const wait = waitSeconds(userId);
  if (wait > 0) {
    await interaction.editReply({ embeds: [notice("ใจเย็นนิดนึง", `รออีก ${wait} วินาทีแล้วลองใหม่`)] });
    return;
  }
  running.add(userId);

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
    form.append("discord_user_id", userId);
    form.append("discord_username", username);

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const phase = `กำลังดาวน์โหลดรูปที่ ${i + 1}/${attachments.length}`;
      const res = await axios.get<ArrayBuffer>(att.url, {
        responseType: "arraybuffer",
        timeout: 60000,
        maxContentLength: MAX_FILE_BYTES,
        maxRedirects: 0,
        onDownloadProgress: (e: AxiosProgressEvent) => {
          const loaded = downloadedBytes + (Number(e?.loaded) || 0);
          const pct = totalBytes > 0 ? (loaded / totalBytes) * DOWNLOAD_SHARE : 0;
          void updateProgress(phase, pct);
        },
      });
      const data: ArrayBuffer = res.data;
      const type = sniffImage(new Uint8Array(data, 0, Math.min(16, data.byteLength)));
      if (!type) {
        await interaction.editReply({
          embeds: [notice("อัปโหลดไม่ได้", `**${displayName(att.name)}** ไม่ใช่รูปภาพจริง — รับเฉพาะ JPG, PNG, GIF, WebP`)],
        });
        return;
      }
      downloadedBytes += data.byteLength;
      const pct = totalBytes > 0 ? (downloadedBytes / totalBytes) * DOWNLOAD_SHARE : DOWNLOAD_SHARE;
      await updateProgress(`ดาวน์โหลดรูปที่ ${i + 1}/${attachments.length} เสร็จ`, pct, true);
      form.append("file", new Blob([data], { type }), att.name || "image");
    }

    // Phase 2: upload to the Nexora backend (50–100%).
    const res = await axios.post(`${API_URL}/api/internal/bot/uploads`, form, {
      headers: {
        "X-Bot-Internal-Secret": BOT_SECRET,
        "X-Bot-Actor-Discord-Id": userId,
      },
      timeout: 120000,
      maxBodyLength: MAX_TOTAL_BYTES + 1024 * 1024,
      onUploadProgress: (e: AxiosProgressEvent) => {
        const total = Number(e?.total) || 0;
        const frac = total > 0 ? Number(e?.loaded || 0) / total : 0;
        void updateProgress("กำลังอัปโหลดขึ้นเซิร์ฟเวอร์...", DOWNLOAD_SHARE + frac * (100 - DOWNLOAD_SHARE));
      },
    });
    await updateProgress("อัปโหลดเสร็จสมบูรณ์", 100, true);

    const items: UploadedItem[] = res.data?.items || [];
    if (!items.length) throw new Error("backend returned no items");

    recordActivity(interaction, {
      outcome: "success",
      result: `อัปโหลดรูปสำเร็จ ${items.length} ไฟล์`,
    });
    await interaction.editReply({ content: "", ...resultMessage(items, username) });
  } catch (error) {
    console.error("[ERROR] /upload", errorStatus(error) || "", describeError(error));
    recordActivity(interaction, { outcome: "failure", result: "อัปโหลดรูปไม่สำเร็จ", details: String((error instanceof Error && error.message) || "unknown").slice(0, 200) });
    await interaction.editReply({ content: "", embeds: [failureNotice(error)], components: [] });
  } finally {
    running.delete(userId);
    lastDone.set(userId, Date.now());
  }
}
