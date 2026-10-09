import {
  ActionRowBuilder,
  ActivityType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalActionRowComponentBuilder,
  ModalBuilder,
  Partials,
  REST,
  Routes,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import path from "path";
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
import { commands } from "./commands";
import {
  crowdSecConfigured,
  handleCrowdSecAutocomplete,
  handleCrowdSecCommand,
  refreshCrowdSecCache,
} from "./features/crowdsec";
import {
  canUseBotCommands,
  handleBotControlCommand,
  loadBotAccess,
} from "./features/bot-control";
import { buildBotPanelPayload, handleBotPanelComponent } from "./features/bot-panel";
import { handlePanelAction, resetPanelMainMenu } from "./features/panel-actions";
import { observeBotActivity } from "./features/activity-log";
import { botControlScope, botMemberRoleIds, canUseBotScope } from "./features/bot-control";
import { handleLockdownCommand } from "./features/lockdown";
import { handleUploadCommand } from "./features/upload";
import { handleMyUploadsCommand } from "./features/my-uploads";
import { handleGalleryCommand } from "./features/gallery";
import { startBot } from "./bot-token";

dotenv.config();

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const API_URL = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();
const SSO_DOMAIN = (process.env.DEFAULT_SSO_DOMAIN || "https://db.nkn02.com").replace(/\/+$/, "");
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || "https://nkn02.com").replace(/\/+$/, "");
const PRIVILEGED_ONLY_MESSAGE = "คุณไม่มีสิทธิ์ใช้คำสั่งนี้";
const USER_ONLY_FOOTER = "เห็นเฉพาะคุณ";

function privilegedDiscordIds(): string[] {
  const raw = process.env.DISCORD_ADMIN_IDS || "";
  return raw.split(",").map((item) => item.trim()).filter((id) => /^[0-9]{17,20}$/.test(id));
}
function isPrivilegedDiscordUser(userId: string, guildOwnerId?: string | null): boolean {
  if (guildOwnerId && userId === guildOwnerId) return true;
  return privilegedDiscordIds().includes(userId);
}

function botHeaders(actorDiscordId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Bot-Internal-Secret": BOT_SECRET,
  };
  if (actorDiscordId) {
    headers["X-Bot-Actor-Discord-Id"] = actorDiscordId;
  }
  return headers;
}


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// Rate limiter to prevent brute-force or abuse (per Discord User ID)
const userCooldowns = new Map<string, { count: number; firstAttempt: number; lastAttempt: number }>();

function checkRateLimit(userId: string): { allowed: boolean; waitSeconds?: number } {
  const now = Date.now();
  const entry = userCooldowns.get(userId);

  if (!entry) {
    userCooldowns.set(userId, { count: 1, firstAttempt: now, lastAttempt: now });
    return { allowed: true };
  }

  // If more than 60 seconds passed, reset window
  if (now - entry.firstAttempt > 60000) {
    userCooldowns.set(userId, { count: 1, firstAttempt: now, lastAttempt: now });
    return { allowed: true };
  }

  // Minimum 3 seconds between consecutive requests
  if (now - entry.lastAttempt < 3000) {
    const wait = Math.ceil((3000 - (now - entry.lastAttempt)) / 1000);
    return { allowed: false, waitSeconds: wait };
  }

  // Max 5 requests per minute
  if (entry.count >= 5) {
    const wait = Math.ceil((60000 - (now - entry.firstAttempt)) / 1000);
    return { allowed: false, waitSeconds: wait };
  }

  entry.count++;
  entry.lastAttempt = now;
  return { allowed: true };
}

// API helper to request student database SSO ticket
async function fetchStudentTicket(
  studentCode: string,
  discordUserId: string = "",
  discordUsername: string = "",
  isAdmin: boolean = false
) {
  try {
    const res = await axios.post(
      `${API_URL}/api/internal/bot/student-db-ticket`,
      {
        studentCode: studentCode.trim(),
        preferredDomain: SSO_DOMAIN,
        discordUserId,
        discordUsername,
        isAdmin,
      },
      {
        headers: botHeaders(discordUserId),
        timeout: 10000,
      }
    );
    return { ok: true, data: res.data };
  } catch (err: any) {
    return { ok: false, ...safeBotApiError(err) };
  }
}

function safeBotApiError(err: any): { error: string; code: string } {
  const code = typeof err?.response?.data?.code === "string" ? err.response.data.code : "";
  return { error: "เปิดไม่ได้ในตอนนี้", code };
}

function userNoticeEmbed(title: string, description: string, color = 0xf43f5e) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(description)
    .setFooter({ text: USER_ONLY_FOOTER });
}

function rateLimitPayload(waitSeconds?: number) {
  return {
    embeds: [userNoticeEmbed("รอก่อนนะ", `ส่งถี่เกินไป รออีก ${waitSeconds || 5} วินาที แล้วลองใหม่`)],
    components: [] as ActionRowBuilder<ButtonBuilder>[],
    ephemeral: true,
  };
}

function registerAgainRow(kind: "db" | "workspace") {
  const button = new ButtonBuilder()
    .setCustomId(kind === "db" ? "btn_register_again_db" : "btn_register_again_workspace")
    .setLabel("ลงทะเบียนใหม่")
    .setStyle(ButtonStyle.Primary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

// ---- activity log: report exactly what happened for /db and /code style requests ----
function ticketKindOf(interaction: any): "db" | "workspace" {
  const id = String(interaction?.customId || "");
  const command = String(interaction?.commandName || "");
  return /workspace/.test(id) || command === "code" ? "workspace" : "db";
}

function ticketLabel(kind: "db" | "workspace"): string {
  return kind === "db" ? "ฐานข้อมูล" : "พื้นที่เขียนโค้ด";
}

const ticketFailureReasons: Record<string, string> = {
  student_code_bound_to_other: "รหัสนี้ถูกผูกกับบัญชี Discord อื่นแล้ว",
  discord_user_already_has_mapping: "บัญชี Discord นี้ผูกกับรหัสอื่นอยู่แล้ว",
  student_db_not_found: "ไม่พบรหัสนี้ในระบบ",
  site_not_found: "ไม่พบรหัสนี้ในระบบ",
  student_access_revoked: "สิทธิ์ของบัญชีนี้ถูกยกเลิกแล้ว",
  database_suspended: "ฐานข้อมูลถูกระงับ",
  database_deleted: "ฐานข้อมูลถูกลบแล้ว",
};

function recordTicketSuccess(interaction: any, data: any) {
  const kind = ticketKindOf(interaction);
  const code = String(data?.studentCode || "").trim();
  interaction.recordBotActivity?.({
    outcome: "success",
    result: `ออกลิงก์เปิด${ticketLabel(kind)}ให้แล้ว (ใช้ได้ครั้งเดียว)`,
    target: code ? `รหัส ${code}` : "",
  });
}

function recordTicketFailure(interaction: any, result: any, studentCode?: string) {
  const kind = ticketKindOf(interaction);
  const code = String(studentCode || "").trim();
  interaction.recordBotActivity?.({
    outcome: "failure",
    result: `ออกลิงก์เปิด${ticketLabel(kind)}ไม่สำเร็จ`,
    target: code ? `รหัส ${code}` : "",
    details: `สาเหตุ: ${ticketFailureReasons[String(result?.code || "")] || "ระบบหลังบ้านออกลิงก์ไม่สำเร็จ"}`,
  });
}

function recordTicketRateLimited(interaction: any) {
  const kind = ticketKindOf(interaction);
  interaction.recordBotActivity?.({
    outcome: "failure",
    result: `ขอลิงก์เปิด${ticketLabel(kind)}ถี่เกินไป ระบบให้รอสักครู่`,
  });
}

function ticketErrorPayload(
  kind: "db" | "workspace",
  result: { error?: string; code?: string; ok?: boolean; data?: unknown },
  studentCode: string | undefined,
  discordUserId: string
) {
  if (result.code === "student_access_revoked" || result.code === "student_code_bound_to_other") {
    boundUsersCache.delete(discordUserId);
  }
  return kind === "db" ? getErrorPayload(result, studentCode) : getWorkspaceErrorPayload(result, studentCode);
}

// Helper to build context-aware, security-conscious error embeds
function getErrorPayload(result: { error?: string; code?: string }, _studentCode?: string) {
  let title = "เปิดไม่ได้ในตอนนี้";
  let description = "ลองใหม่อีกครั้ง หรือติดต่อผู้ดูแล";
  let components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (result.code === "student_code_bound_to_other") {
    title = "ใช้รหัสนี้ไม่ได้";
    description = "รหัสนี้มีคนใช้แล้ว ถ้าเป็นรหัสของคุณ ติดต่อผู้ดูแลได้เลย";
  } else if (result.code === "discord_user_already_has_mapping") {
    title = "บัญชีนี้มีรหัสอยู่แล้ว";
    description = "ถ้าต้องการเปลี่ยน ติดต่อผู้ดูแลได้เลย";
  } else if (result.code === "student_db_not_found") {
    title = "ไม่พบรหัสนี้";
    description = "ตรวจรหัสอีกครั้ง หรือติดต่อผู้ดูแล";
  } else if (result.code === "student_access_revoked") {
    title = "สิทธิ์ถูกยกเลิกแล้ว";
    description = "ใช้บัญชีนี้กับรหัสเดิมไม่ได้แล้ว ถ้ายังไม่มีคนใช้ กดลงทะเบียนใหม่ได้";
    components = [registerAgainRow("db")];
  } else if (result.code === "database_suspended") {
    title = "ฐานข้อมูลถูกระงับ";
    description = "ตอนนี้เปิดฐานข้อมูลนี้ไม่ได้ ติดต่อผู้ดูแลระบบเพื่อขอปลดระงับ";
  } else if (result.code === "database_deleted") {
    title = "ฐานข้อมูลถูกลบแล้ว";
    description = "ฐานข้อมูลของรหัสนี้ไม่มีแล้ว ติดต่อผู้ดูแล";
  } else if (result.code === "decrypt_failed") {
    title = "เปิดไม่ได้ในตอนนี้";
    description = "ลองใหม่อีกครั้ง หรือติดต่อผู้ดูแล";
  }

  return { embeds: [userNoticeEmbed(title, description)], components };
}

// API helper to request student workspace SSO ticket
async function fetchStudentWorkspaceTicket(
  studentCode: string,
  discordUserId: string = "",
  discordUsername: string = "",
  isAdmin: boolean = false
) {
  try {
    const res = await axios.post(
      `${API_URL}/api/internal/bot/student-workspace-ticket`,
      {
        studentCode: studentCode.trim(),
        preferredDomain: PUBLIC_APP_URL,
        discordUserId,
        discordUsername,
        isAdmin,
      },
      {
        headers: botHeaders(discordUserId),
        timeout: 10000,
      }
    );
    return { ok: true, data: res.data };
  } catch (err: any) {
    return { ok: false, ...safeBotApiError(err) };
  }
}

// Helper to build context-aware, security-conscious workspace error embeds
function getWorkspaceErrorPayload(result: { error?: string; code?: string }, _studentCode?: string) {
  let title = "เปิดไม่ได้ในตอนนี้";
  let description = "ลองใหม่อีกครั้ง หรือติดต่อผู้ดูแล";
  let components: ActionRowBuilder<ButtonBuilder>[] = [];

  if (result.code === "student_code_bound_to_other") {
    title = "ใช้รหัสนี้ไม่ได้";
    description = "รหัสนี้มีคนใช้แล้ว ถ้าเป็นรหัสของคุณ ติดต่อผู้ดูแลได้เลย";
  } else if (result.code === "discord_user_already_has_mapping") {
    title = "บัญชีนี้มีรหัสอยู่แล้ว";
    description = "ถ้าต้องการเปลี่ยน ติดต่อผู้ดูแลได้เลย";
  } else if (result.code === "site_not_found") {
    title = "ไม่พบรหัสนี้";
    description = "ตรวจรหัสอีกครั้ง หรือติดต่อผู้ดูแล";
  } else if (result.code === "student_access_revoked") {
    title = "สิทธิ์ถูกยกเลิกแล้ว";
    description = "ใช้บัญชีนี้กับรหัสเดิมไม่ได้แล้ว ถ้ายังไม่มีคนใช้ กดลงทะเบียนใหม่ได้";
    components = [registerAgainRow("workspace")];
  }

  return { embeds: [userNoticeEmbed(title, description)], components };
}

function ticketOwnerText(data: any): string {
  const name = String(data?.studentName || "").trim();
  const code = String(data?.studentCode || "").trim();
  if (name && code) return `${name} · รหัส ${code}`;
  if (name) return name;
  if (code) return `รหัส ${code}`;
  return "";
}

function ticketExpiryText(expiresAt?: unknown): string {
  const parsed = expiresAt ? new Date(String(expiresAt)) : new Date(Date.now() + 5 * 60 * 1000);
  const when = Number.isNaN(parsed.getTime()) ? new Date(Date.now() + 5 * 60 * 1000) : parsed;
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(when) + " น.";
}

function successDescription(data: any): string {
  const owner = ticketOwnerText(data);
  const expiry = ticketExpiryText(data?.expiresAt);
  return [owner ? `ของ ${owner}` : "", `ลิงก์หมดอายุ ${expiry}`, "กดปุ่มด้านล่างได้เลย"]
    .filter(Boolean)
    .join("\n");
}

// Build the Workspace Ephemeral Result Embed (Clean, Human-crafted, 0 Emojis)
function buildWorkspaceSuccessPayload(data: any) {
  const embed = new EmbedBuilder()
    .setTitle("เปิดพื้นที่เขียนโค้ดได้แล้ว")
    .setColor(0x6366f1)
    .setDescription(successDescription(data))
    .setFooter({ text: USER_ONLY_FOOTER });

  const appBase = PUBLIC_APP_URL.replace(/\/$/, "");
  const targetURL = data.ticket
    ? `${appBase}/workspace?ticket=${encodeURIComponent(String(data.ticket))}`
    : data.cUrl || data.url || data.workspaceUrl;

  if (!targetURL) {
    return getWorkspaceErrorPayload({ code: "workspace_link_missing" });
  }
  const button = new ButtonBuilder()
    .setLabel("เปิดพื้นที่เขียนโค้ด")
    .setStyle(ButtonStyle.Link)
    .setURL(targetURL);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  return { embeds: [embed], components: [row] };
}

// Build the Student Code Workspace Modal
function buildStudentWorkspaceModal(prefilledCode?: string) {
  const modal = new ModalBuilder()
    .setCustomId("modal_student_workspace")
    .setTitle("กรอกรหัสของคุณ");

  const input = new TextInputBuilder()
    .setCustomId("student_code_input")
    .setLabel("รหัส 3 ตัวท้าย")
    .setPlaceholder("เช่น 123")
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(10)
    .setRequired(true);

  if (prefilledCode) {
    input.setValue(prefilledCode);
  }

  const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  modal.addComponents(row);
  return modal;
}

// Helper to build a clean error embed
function buildErrorPayload(title: string, message: string) {
  return { embeds: [userNoticeEmbed(title, message)], components: [] };
}

// Build the Ephemeral Result Embed (Clean, Human-crafted, Responsive across all devices)
function buildSuccessPayload(data: any) {
  const embed = new EmbedBuilder()
    .setTitle("เปิดฐานข้อมูลได้แล้ว")
    .setColor(0x10b981)
    .setDescription(successDescription(data))
    .setFooter({ text: USER_ONLY_FOOTER });

  const button = new ButtonBuilder()
    .setLabel("เปิดฐานข้อมูล")
    .setStyle(ButtonStyle.Link)
    .setURL(data.url);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  return { embeds: [embed], components: [row] };
}

// Local cache of bound Discord users and registered student codes
const boundUsersCache = new Map<string, string>(); // discordUserId -> studentCode
const validStudentCodes = new Set<string>();

async function refreshLocalCache() {
  try {
    const adminActor = privilegedDiscordIds()[0];
    const res = await axios.get(`${API_URL}/api/internal/bot/student-mappings`, {
      headers: botHeaders(adminActor),
      timeout: 10000,
    });
    boundUsersCache.clear();
    validStudentCodes.clear();
    for (const item of res.data?.items || []) {
      const code = String(item.studentCode).trim();
      validStudentCodes.add(code);
      if (item.discordUserId) {
        boundUsersCache.set(String(item.discordUserId).trim(), code);
      }
    }
    console.log(`[CACHE] Refreshed: ${validStudentCodes.size} student codes, ${boundUsersCache.size} bound discord users.`);
  } catch (err: any) {
    console.warn("[WARN] Failed to refresh mappings cache:", err.message);
  }
}

// Helper to detect 3-digit student code from member nickname, display name, or username
function detectStudentCodeFromMember(member: any, user: any, codes: Set<string>): string | null {
  const candidates: string[] = [];

  // 1. Server Nickname
  if (member?.nickname) candidates.push(String(member.nickname));
  if (member?.nick) candidates.push(String(member.nick));

  // 2. Display Name / Global Name
  if (user?.displayName) candidates.push(String(user.displayName));
  if (user?.globalName) candidates.push(String(user.globalName));

  // 3. Username
  if (user?.username) candidates.push(String(user.username));

  const codeList = Array.from(codes);
  for (const text of candidates) {
    if (!text) continue;
    // Check exact matches
    for (const code of codeList) {
      const regex = new RegExp(`(^|\\D)${code}(\\D|$)`);
      if (regex.test(text)) {
        return code;
      }
    }

    // Check consecutive 2-4 digits
    const matches = text.match(/\d{2,4}/g);
    if (matches) {
      for (const m of matches) {
        if (codeList.includes(m)) return m;
        if (m.length > 3 && codeList.includes(m.slice(-3))) return m.slice(-3);
      }
    }
  }

  return null;
}

// Build the Student Code Modal
function buildStudentCodeModal(prefilledCode?: string) {
  const modal = new ModalBuilder()
    .setCustomId("modal_student_db")
    .setTitle("กรอกรหัสของคุณ");

  const input = new TextInputBuilder()
    .setCustomId("student_code_input")
    .setLabel("รหัส 3 ตัวท้าย")
    .setPlaceholder("เช่น 123")
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(10)
    .setRequired(true);

  if (prefilledCode) {
    input.setValue(prefilledCode);
  }

  const row = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  modal.addComponents(row);
  return modal;
}

// Register Slash Commands
async function registerSlashCommands() {
  // The client id comes from .env or, with a token set on the web page, from Discord itself.
  const applicationId = CLIENT_ID || client.application?.id;
  if (!client.token || !applicationId) return;
  try {
    const rest = new REST({ version: "10" }).setToken(client.token);
    const body = commands.map((cmd) => cmd.toJSON());
    const guildId = process.env.DISCORD_GUILD_ID;
    if (guildId) {
      console.log(`[INFO] Registering guild slash commands for ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
      console.log("[INFO] Clearing duplicate global slash commands...");
      await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    } else {
      console.log("[INFO] Registering Discord application slash commands globally...");
      await rest.put(Routes.applicationCommands(applicationId), { body });
    }
    console.log("[INFO] Successfully registered application slash commands.");
  } catch (error) {
    console.error("[ERROR] Failed to register slash commands:", error);
  }
}

function activityTypeFromName(value: string) {
  switch ((value || "").trim().toLowerCase()) {
    case "playing":
      return ActivityType.Playing;
    case "listening":
      return ActivityType.Listening;
    case "competing":
      return ActivityType.Competing;
    case "custom":
      return ActivityType.Custom;
    default:
      return ActivityType.Watching;
  }
}

function presenceActivity(activityType: string, activityText: string) {
  const type = activityTypeFromName(activityType);
  if (type === ActivityType.Custom) {
    return { name: "Custom Status", type, state: activityText };
  }
  return { name: activityText, type };
}

let lastPresenceKey = "";

async function syncNexoraBotPresence() {
  let activityType = process.env.DISCORD_ACTIVITY_TYPE || "watching";
  let activityText = process.env.DISCORD_ACTIVITY_TEXT || "NEXORA";
  let visibility: "online" | "hidden" = "online";
  try {
    const res = await axios.get(`${API_URL}/api/internal/bot/presence/nexora`, {
      headers: { "X-Bot-Internal-Secret": BOT_SECRET },
      timeout: 10000,
    });
    if (res.data?.activityType) activityType = String(res.data.activityType);
    if (res.data?.activityText) activityText = String(res.data.activityText);
  } catch {
    // Keep the last known or env fallback if the API is briefly unavailable.
  }
  try {
    visibility = (await loadBotAccess()).visibility;
  } catch {
    // Keep the bot online if access settings are briefly unavailable.
  }
  activityText = activityText.trim() || "NEXORA";
  const key = `${visibility}:${activityType}:${activityText}`;
  if (key === lastPresenceKey) return;
  await client.user?.setPresence({
    status: visibility === "hidden" ? "invisible" : "online",
    activities: [presenceActivity(activityType, activityText)],
  });
  lastPresenceKey = key;
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[READY] Logged in as ${c.user.tag}`);
  try {
    await syncNexoraBotPresence();
  } catch (error) {
    console.error("[ERROR] Failed to set Nexora bot presence");
  }
  setInterval(() => {
    void syncNexoraBotPresence();
  }, 15000);
  await refreshLocalCache();
  if (crowdSecConfigured()) {
    try {
      await refreshCrowdSecCache();
    } catch (error: any) {
      console.error("[ERROR] CrowdSec cache warmup:", error?.message || error);
    }
    setInterval(() => {
      void refreshCrowdSecCache().catch((error: any) => {
        console.error("[ERROR] CrowdSec cache refresh:", error?.message || error);
      });
    }, 15000);
  }
  await registerSlashCommands();
});

function isUserAdmin(interaction: { user?: { id?: string }; guild?: { ownerId?: string | null } | null }): boolean {
  return isPrivilegedDiscordUser(String(interaction.user?.id || ""), interaction.guild?.ownerId);
}

const lastPrivateReplies = new Map<string, () => Promise<void>>();
const lastGuildNotices = new Map<string, { id: string; delete: () => Promise<unknown> }>();
const lastChannelPanels = new Map<string, { delete: () => Promise<unknown> }>();

async function safeDelete(action?: () => Promise<unknown>) {
  if (!action) return;
  try {
    await action();
  } catch {
    // already gone, expired, or missing permission
  }
}

async function clearLastPrivateReply(userId: string) {
  const prev = lastPrivateReplies.get(userId);
  lastPrivateReplies.delete(userId);
  await safeDelete(prev);
}

function rememberPrivateReply(userId: string, deleter: () => Promise<void>) {
  lastPrivateReplies.set(userId, deleter);
}

function rememberInteractionReply(interaction: any) {
  rememberPrivateReply(String(interaction.user?.id || ""), async () => {
    await interaction.deleteReply();
  });
}

function isEphemeralMessage(message: any): boolean {
  if (!message) return false;
  if (typeof message.flags?.has === "function") {
    return message.flags.has(MessageFlags.Ephemeral);
  }
  return Boolean((message.flags?.bitfield ?? message.flags ?? 0) & 64);
}

async function deleteIfEphemeralMessage(message: any) {
  if (!isEphemeralMessage(message)) return;
  await safeDelete(() => message.delete());
}

async function beginPrivateReply(interaction: any) {
  const prev = lastPrivateReplies.get(interaction.user.id);
  lastPrivateReplies.delete(interaction.user.id);
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }
  rememberInteractionReply(interaction);
  void safeDelete(prev);
  void deleteIfEphemeralMessage(interaction.message);
}

async function sendPrivateReply(interaction: any, payload: any) {
  const prev = lastPrivateReplies.get(interaction.user.id);
  lastPrivateReplies.delete(interaction.user.id);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.reply({ ...payload, ephemeral: true });
  }
  rememberInteractionReply(interaction);
  void safeDelete(prev);
  void deleteIfEphemeralMessage(interaction.message);
}

async function showPrivateModal(interaction: any, modal: any) {
  const prev = lastPrivateReplies.get(interaction.user.id);
  lastPrivateReplies.delete(interaction.user.id);
  await interaction.showModal(modal);
  void safeDelete(prev);
  void deleteIfEphemeralMessage(interaction.message);
}

async function sendReplaceableNotice(channel: any, userId: string, content: string) {
  const key = `${channel.id}:${userId}`;
  const prev = lastGuildNotices.get(key);
  lastGuildNotices.delete(key);
  await safeDelete(prev?.delete);
  const notice = await channel.send({ content });
  lastGuildNotices.set(key, { id: notice.id, delete: () => notice.delete() });
  setTimeout(() => {
    notice.delete().catch(() => {});
    const current = lastGuildNotices.get(key);
    if (current?.id === notice.id) lastGuildNotices.delete(key);
  }, 10000);
}

async function replaceDirectMessage(userId: string, send: () => Promise<any>) {
  const prev = lastPrivateReplies.get(userId);
  lastPrivateReplies.delete(userId);
  const sent = await send();
  if (sent && typeof sent.delete === "function") {
    rememberPrivateReply(userId, async () => {
      await sent.delete();
    });
  }
  void safeDelete(prev);
}

async function replaceChannelPanel(channel: any, payload: any) {
  const title = payload.embeds?.[0]?.data?.title;
  if (title === "แผงควบคุม NEXORA" && channel.messages?.fetch) {
    const recent = await channel.messages.fetch({ limit: 50 });
    for (const message of recent.values()) {
      if (message.author.id === client.user?.id && message.embeds?.[0]?.title === title) {
        await message.delete();
      }
    }
  }
  const prev = lastChannelPanels.get(channel.id);
  lastChannelPanels.delete(channel.id);
  await safeDelete(prev?.delete);
  const sent = await channel.send(payload);
  lastChannelPanels.set(channel.id, { delete: () => sent.delete() });
  return sent;
}

async function replyPrivilegedOnly(interaction: any) {
  await sendPrivateReply(interaction, { content: PRIVILEGED_ONLY_MESSAGE });
}

// Handle Interactions
client.on(Events.InteractionCreate, async (interaction) => {
  const activity = observeBotActivity(interaction);
  interaction = activity.interaction;
  try {
    const isAdmin = isUserAdmin(interaction);

    const menuInteraction = interaction;
    try {
    const panelAction = await handlePanelAction(interaction, isAdmin, beginPrivateReply, showPrivateModal);
    if (panelAction === true) return;
    if (panelAction) interaction = panelAction;

  if ((interaction.isButton() || interaction.isAnySelectMenu()) && await handleBotPanelComponent(interaction, isAdmin, syncNexoraBotPresence, beginPrivateReply)) {
    return;
  }
    } finally {
      // Reset only after acknowledgement: showModal must be the first response.
      if (menuInteraction.isMessageComponent() && (menuInteraction.replied || menuInteraction.deferred)) await resetPanelMainMenu(menuInteraction);
    }

  const launcherId = "customId" in interaction ? interaction.customId : "";
  const launcherScope = ["btn_request_db","modal_student_db"].includes(launcherId) ? "db" : ["btn_request_workspace","modal_student_workspace"].includes(launcherId) ? "code" : "";
  if (launcherScope && !await canUseBotScope(interaction,launcherScope,isAdmin)) {
    await sendPrivateReply(interaction,{content:"คุณไม่มีสิทธิ์ใช้คำสั่งนี้"});
    return;
  }

  if (interaction.isAutocomplete()) {
    const canUnban = isAdmin || (interaction.commandName === "crowdsec" && await canUseBotScope(interaction,"crowdsec.unban",false));
    if (!(await handleCrowdSecAutocomplete(interaction, canUnban))) await interaction.respond([]);
    return;
  }

  // 1. Button Interaction
  if (interaction.isButton()) {
    if (interaction.customId === "btn_request_db") {
      // Feature: Check if this user is ALREADY bound to a student code (Non-admins only)
      if (!isAdmin) {
        const boundCode = boundUsersCache.get(interaction.user.id);
        if (boundCode) {
          await beginPrivateReply(interaction);
          const result = await fetchStudentTicket(
            boundCode,
            interaction.user.id,
            interaction.user.tag || interaction.user.username,
            isAdmin
          );

          if (!result.ok) {
            recordTicketFailure(interaction, result, boundCode);
            await interaction.editReply(ticketErrorPayload("db", result, boundCode, interaction.user.id));
            return;
          }

          const payload = buildSuccessPayload(result.data);
          recordTicketSuccess(interaction, result.data);
          await interaction.editReply(payload);
          return;
        }
      }

      // Feature: Not bound yet (or Admin testing) -> Try to auto-detect 3-digit code
      const detected = detectStudentCodeFromMember(interaction.member, interaction.user, validStudentCodes);
      const modal = buildStudentCodeModal(detected || undefined);
      await showPrivateModal(interaction, modal);
      return;
    }

    if (interaction.customId === "btn_request_workspace") {
      // Feature: Check if this user is ALREADY bound to a student code (Non-admins only)
      if (!isAdmin) {
        const boundCode = boundUsersCache.get(interaction.user.id);
        if (boundCode) {
          const rateCheck = checkRateLimit(interaction.user.id);
          if (!rateCheck.allowed) {
            recordTicketRateLimited(interaction);
            await sendPrivateReply(interaction, rateLimitPayload(rateCheck.waitSeconds));
            return;
          }

          await beginPrivateReply(interaction);
          const result = await fetchStudentWorkspaceTicket(
            boundCode,
            interaction.user.id,
            interaction.user.tag || interaction.user.username,
            isAdmin
          );

          if (!result.ok) {
            recordTicketFailure(interaction, result, boundCode);
            await interaction.editReply(ticketErrorPayload("workspace", result, boundCode, interaction.user.id));
            return;
          }

          const payload = buildWorkspaceSuccessPayload(result.data);
          recordTicketSuccess(interaction, result.data);
          await interaction.editReply(payload);
          return;
        }
      }

      // Feature: Not bound yet (or Admin testing) -> Try to auto-detect 3-digit code
      const detected = detectStudentCodeFromMember(interaction.member, interaction.user, validStudentCodes);
      const modal = buildStudentWorkspaceModal(detected || undefined);
      await showPrivateModal(interaction, modal);
      return;
    }

    if (interaction.customId === "btn_register_again_db") {
      boundUsersCache.delete(interaction.user.id);
      await showPrivateModal(interaction, buildStudentCodeModal());
      return;
    }

    if (interaction.customId === "btn_register_again_workspace") {
      boundUsersCache.delete(interaction.user.id);
      await showPrivateModal(interaction, buildStudentWorkspaceModal());
      return;
    }
    return;
  }

  // 2. Modal Submit Interaction
  if (interaction.isModalSubmit()) {
    if (interaction.customId === "modal_student_db") {
      await beginPrivateReply(interaction);

      // Rate limit check
      const rateCheck = checkRateLimit(interaction.user.id);
      if (!rateCheck.allowed && !isAdmin) {
        recordTicketRateLimited(interaction);
        await interaction.editReply(
          rateLimitPayload(rateCheck.waitSeconds)
        );
        return;
      }

      const studentCode = interaction.fields.getTextInputValue("student_code_input").trim();
      const result = await fetchStudentTicket(
        studentCode,
        interaction.user.id,
        interaction.user.tag || interaction.user.username,
        isAdmin
      );

      if (!result.ok) {
        recordTicketFailure(interaction, result, studentCode);
        await interaction.editReply(ticketErrorPayload("db", result, studentCode, interaction.user.id));
        return;
      }

      if (!isAdmin) {
        boundUsersCache.set(interaction.user.id, studentCode);
      }
      const payload = buildSuccessPayload(result.data);
      recordTicketSuccess(interaction, result.data);
      await interaction.editReply(payload);
      return;
    }

    if (interaction.customId === "modal_student_workspace") {
      await beginPrivateReply(interaction);

      // Rate limit check
      const rateCheck = checkRateLimit(interaction.user.id);
      if (!rateCheck.allowed && !isAdmin) {
        recordTicketRateLimited(interaction);
        await interaction.editReply(
          rateLimitPayload(rateCheck.waitSeconds)
        );
        return;
      }

      let studentCode = "";
      try {
        studentCode = interaction.fields.getTextInputValue("student_code_input");
      } catch {
        try {
          studentCode = interaction.fields.getTextInputValue("student_code_workspace_input");
        } catch {
          studentCode = "";
        }
      }

      studentCode = studentCode.trim();
      if (!studentCode) {
        (interaction as any).recordBotActivity?.({ outcome: "failure", result: "ขอลิงก์เปิดพื้นที่เขียนโค้ดไม่สำเร็จ", details: "สาเหตุ: ผู้ใช้ไม่ได้กรอกรหัส" });
        await interaction.editReply(
          buildErrorPayload("รหัสไม่ถูกต้อง", "กรอกรหัส 3 ตัวท้ายอีกครั้ง")
        );
        return;
      }

      const result = await fetchStudentWorkspaceTicket(
        studentCode,
        interaction.user.id,
        interaction.user.tag || interaction.user.username,
        isAdmin
      );

      if (!result.ok) {
        recordTicketFailure(interaction, result, studentCode);
        await interaction.editReply(ticketErrorPayload("workspace", result, studentCode, interaction.user.id));
        return;
      }

      if (!isAdmin) {
        boundUsersCache.set(interaction.user.id, studentCode);
      }
      const payload = buildWorkspaceSuccessPayload(result.data);
      recordTicketSuccess(interaction, result.data);
      await interaction.editReply(payload);
      return;
    }
    return;
  }

  // 3. Slash Command Interaction
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === "bot-panel") {
      if (!await canUseBotScope(interaction,"bot-panel",isAdmin)) {
        await replyPrivilegedOnly(interaction);
        return;
      }
      await beginPrivateReply(interaction);
      const panel = await buildBotPanelPayload();
      if (!interaction.channel || !("send" in interaction.channel)) {
        await interaction.editReply({ content: "คำสั่งนี้ใช้ในห้องเซิร์ฟเวอร์เท่านั้น ไม่รองรับแชตส่วนตัว" });
        return;
      }
      await replaceChannelPanel(interaction.channel, panel);
      await interaction.deleteReply();
      return;
    }

    if (commandName === "bot-control") {
      if (!await canUseBotScope(interaction,botControlScope(interaction.options.getSubcommand()),isAdmin)) {
        await replyPrivilegedOnly(interaction);
        return;
      }
      await beginPrivateReply(interaction);
      try {
        await handleBotControlCommand(interaction, syncNexoraBotPresence);
      } catch (error: any) {
        console.error("[ERROR] /bot-control:", error?.message || error);
        await interaction.editReply({ content: "บันทึกการตั้งค่าไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
      return;
    }

        // Command: /upload — ทุกคนในเซิร์ฟเวอร์ใช้ได้ (ไม่ต้องมีสิทธิ์พิเศษ)
        // Command: /my-uploads — ทุกคนในเซิร์ฟเวอร์ใช้ได้ (ไม่ต้องมีสิทธิ์พิเศษ)
        // Command: /gallery — ทุกคนในเซิร์ฟเวอร์ใช้ได้ (ไม่ต้องมีสิทธิ์พิเศษ)
    if (commandName === "gallery") {
      await beginPrivateReply(interaction);
      try {
        await handleGalleryCommand(interaction);
      } catch (error: any) {
        console.error("[ERROR] /gallery:", error?.message || error);
        await interaction.editReply({ content: "ขอลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
      return;
    }

if (commandName === "my-uploads") {
      await beginPrivateReply(interaction);
      try {
        await handleMyUploadsCommand(interaction);
      } catch (error: any) {
        console.error("[ERROR] /my-uploads:", error?.message || error);
        await interaction.editReply({ content: "ดูประวัติไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
      return;
    }

if (commandName === "upload") {
      await beginPrivateReply(interaction);
      try {
        await handleUploadCommand(interaction);
      } catch (error: any) {
        console.error("[ERROR] /upload:", error?.message || error);
        await interaction.editReply({ content: "อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
      return;
    }

if (["db","code"].includes(commandName) && !await canUseBotScope(interaction,commandName,isAdmin)) {
      await sendPrivateReply(interaction, { content: "คุณไม่มีสิทธิ์ใช้คำสั่งนี้" });
      return;
    }

    // Command: /db
    if (commandName === "db") {
      const codeOption = interaction.options.getString("code");
      if (!codeOption) {
        if (!isAdmin) {
          const boundCode = boundUsersCache.get(interaction.user.id);
          if (boundCode) {
            const rateCheck = checkRateLimit(interaction.user.id);
            if (!rateCheck.allowed) {
              recordTicketRateLimited(interaction);
              await sendPrivateReply(interaction, rateLimitPayload(rateCheck.waitSeconds));
              return;
            }

            await beginPrivateReply(interaction);
            const result = await fetchStudentTicket(
              boundCode,
              interaction.user.id,
              interaction.user.tag || interaction.user.username,
              isAdmin
            );

            if (!result.ok) {
              recordTicketFailure(interaction, result, boundCode);
              await interaction.editReply(ticketErrorPayload("db", result, boundCode, interaction.user.id));
              return;
            }

            const payload = buildSuccessPayload(result.data);
            recordTicketSuccess(interaction, result.data);
            await interaction.editReply(payload);
            return;
          }
        }

        const detected = detectStudentCodeFromMember(interaction.member, interaction.user, validStudentCodes);
        const modal = buildStudentCodeModal(detected || undefined);
        await showPrivateModal(interaction, modal);
        return;
      }

      await beginPrivateReply(interaction);

      // Rate limit check
      const rateCheck = checkRateLimit(interaction.user.id);
      if (!rateCheck.allowed && !isAdmin) {
        recordTicketRateLimited(interaction);
        await interaction.editReply(
          rateLimitPayload(rateCheck.waitSeconds)
        );
        return;
      }

      const result = await fetchStudentTicket(
        codeOption,
        interaction.user.id,
        interaction.user.tag || interaction.user.username,
        isAdmin
      );

      if (!result.ok) {
        recordTicketFailure(interaction, result, codeOption);
        await interaction.editReply(ticketErrorPayload("db", result, codeOption, interaction.user.id));
        return;
      }

      if (!isAdmin) {
        boundUsersCache.set(interaction.user.id, codeOption.trim());
      }
      const payload = buildSuccessPayload(result.data);
      recordTicketSuccess(interaction, result.data);
      await interaction.editReply(payload);
      return;
    }

    // Command: /code
    if (commandName === "code") {
      const codeOption = interaction.options.getString("code");
      if (!codeOption) {
        if (!isAdmin) {
          const boundCode = boundUsersCache.get(interaction.user.id);
          if (boundCode) {
            const rateCheck = checkRateLimit(interaction.user.id);
            if (!rateCheck.allowed) {
              recordTicketRateLimited(interaction);
              await sendPrivateReply(interaction, rateLimitPayload(rateCheck.waitSeconds));
              return;
            }

            await beginPrivateReply(interaction);
            const result = await fetchStudentWorkspaceTicket(
              boundCode,
              interaction.user.id,
              interaction.user.tag || interaction.user.username,
              isAdmin
            );

            if (!result.ok) {
              recordTicketFailure(interaction, result, boundCode);
              await interaction.editReply(ticketErrorPayload("workspace", result, boundCode, interaction.user.id));
              return;
            }

            const payload = buildWorkspaceSuccessPayload(result.data);
            recordTicketSuccess(interaction, result.data);
            await interaction.editReply(payload);
            return;
          }
        }

        const detected = detectStudentCodeFromMember(interaction.member, interaction.user, validStudentCodes);
        const modal = buildStudentWorkspaceModal(detected || undefined);
        await showPrivateModal(interaction, modal);
        return;
      }

      await beginPrivateReply(interaction);

      // Rate limit check
      const rateCheck = checkRateLimit(interaction.user.id);
      if (!rateCheck.allowed && !isAdmin) {
        recordTicketRateLimited(interaction);
        await interaction.editReply(
          rateLimitPayload(rateCheck.waitSeconds)
        );
        return;
      }

      const result = await fetchStudentWorkspaceTicket(
        codeOption,
        interaction.user.id,
        interaction.user.tag || interaction.user.username,
        isAdmin
      );

      if (!result.ok) {
        recordTicketFailure(interaction, result, codeOption);
        await interaction.editReply(ticketErrorPayload("workspace", result, codeOption, interaction.user.id));
        return;
      }

      if (!isAdmin) {
        boundUsersCache.set(interaction.user.id, codeOption.trim());
      }
      const payload = buildWorkspaceSuccessPayload(result.data);
      recordTicketSuccess(interaction, result.data);
      await interaction.editReply(payload);
      return;
    }

    // Command: /setup-panel (server owner only)
    if (commandName === "setup-panel") {
      if (!(await canUseBotScope(interaction,"setup-panel",isAdmin))) {
        await replyPrivilegedOnly(interaction);
        return;
      }
      await beginPrivateReply(interaction);

      const assetPath = path.resolve(__dirname, "../assets/cat-loaf-row.jpeg");
      const altAssetPath = path.resolve(__dirname, "assets/cat-loaf-row.jpeg");
      const rootAssetPath = path.resolve(process.cwd(), "assets/cat-loaf-row.jpeg");
      const imagePath = fs.existsSync(assetPath)
        ? assetPath
        : fs.existsSync(altAssetPath)
        ? altAssetPath
        : fs.existsSync(rootAssetPath)
        ? rootAssetPath
        : "";

      const files: AttachmentBuilder[] = [];
      const panelEmbed = new EmbedBuilder()
        .setTitle("เข้าใช้งาน")
        .setColor(0x4f46e5)
        .setDescription("กดปุ่มด้านล่าง แล้วกรอกรหัส 3 ตัวท้าย")
        .setFooter({ text: "ลิงก์จะส่งให้เฉพาะคุณ" });

      if (imagePath) {
        const attachment = new AttachmentBuilder(imagePath, { name: "cat-loaf-row.jpeg" });
        files.push(attachment);
        panelEmbed.setImage("attachment://cat-loaf-row.jpeg");
      } else {
        panelEmbed.setImage(`${PUBLIC_APP_URL}/cat-loaf-row.jpeg`);
      }

      const requestButton = new ButtonBuilder()
        .setCustomId("btn_request_db")
        .setLabel("ฐานข้อมูล")
        .setStyle(ButtonStyle.Primary);

      const workspaceButton = new ButtonBuilder()
        .setCustomId("btn_request_workspace")
        .setLabel("พื้นที่เขียนโค้ด")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(requestButton, workspaceButton);

      try {
        if (interaction.channel && "send" in interaction.channel) {
          await replaceChannelPanel(interaction.channel, {
            embeds: [panelEmbed],
            components: [row],
            files,
          });
        }
        await interaction.editReply({
          content: "ตั้งค่าในห้องนี้แล้ว",
        });
      } catch {
        await interaction.editReply({
          content: "ตั้งค่าในห้องนี้ไม่สำเร็จ ลองใหม่อีกครั้ง",
        });
      }
      return;
    }

    // Command: /admin-map (server owner only)
    if (commandName === "admin-map") {
      const sub = interaction.options.getSubcommand();
      if (!await canUseBotScope(interaction,`admin-map.${sub}`,isAdmin)) {
        await replyPrivilegedOnly(interaction);
        return;
      }
      const actorHeaders = botHeaders(interaction.user.id);
      actorHeaders["X-Bot-Actor-Discord-Roles"] = botMemberRoleIds(interaction).join(",");
      actorHeaders["X-Bot-Command-Scope"] = `admin-map.${sub}`;

      if (sub === "list") {
        await beginPrivateReply(interaction);
        try {
          const res = await axios.get(`${API_URL}/api/internal/bot/student-mappings`, {
            headers: actorHeaders,
            timeout: 10000,
          });
          const items = res.data?.items || [];
          if (items.length === 0) {
            await interaction.editReply({
              content: "ยังไม่มีรายการผูกรหัส เพิ่มได้จากเมนู ‘ผูกรหัสกับฐานข้อมูล’",
            });
            return;
          }

          const lines = items.slice(0, 25).map((item: any) =>
            `- รหัส **${item.studentCode}** -> DB: \`${item.dbName}\` (${item.studentName || item.ownerName || "-"})`
          );

          const listEmbed = new EmbedBuilder()
            .setTitle(`รายการผูกรหัสเข้าใช้งาน (${items.length} รายการ)`)
            .setColor(0x10b981)
            .setDescription(lines.join("\n"))
            .setFooter({ text: "จัดการรายการทั้งหมดได้ที่ https://nkn02.com/admin/databases" });

          await interaction.editReply({ embeds: [listEmbed] });
        } catch (err: any) {
          await interaction.editReply({
            content: "โหลดรายการไม่สำเร็จ ลองใหม่อีกครั้ง",
          });
        }
        return;
      }

      if (sub === "set") {
        await beginPrivateReply(interaction);
        const code = interaction.options.getString("code", true);
        const database = interaction.options.getString("database", true);
        const name = interaction.options.getString("name") || "";

        try {
          await axios.post(
            `${API_URL}/api/internal/bot/student-mappings`,
            {
              studentCode: code,
              dbPublicId: database,
              studentName: name,
            },
            {
              headers: actorHeaders,
              timeout: 10000,
            }
          );
          await interaction.editReply({
            content: `บันทึกการผูกรหัส **${code}** กับฐานข้อมูล \`${database}\` เรียบร้อยแล้ว`,
          });
        } catch (err: any) {
          await interaction.editReply({
            content: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง",
          });
        }
        return;
      }

      if (sub === "unbind") {
        await beginPrivateReply(interaction);
        const code = interaction.options.getString("code", true);

        try {
          const res = await axios.post(
            `${API_URL}/api/internal/bot/student-mappings/unbind`,
            { studentCode: code },
            {
              headers: actorHeaders,
              timeout: 10000,
            }
          );
          await refreshLocalCache();
          await interaction.editReply({
            content: res.data?.message || `ปลดการผูก Discord ของรหัส **${code}** เรียบร้อยแล้ว`,
          });
        } catch (err: any) {
          await interaction.editReply({
            content: "ปลดการผูกไม่สำเร็จ ลองใหม่อีกครั้ง",
          });
        }
        return;
      }

    }

    if (commandName === "crowdsec") {
      if (!(await canUseBotScope(interaction,`crowdsec.${interaction.options.getSubcommand()}`,isAdmin))) {
        await replyPrivilegedOnly(interaction);
        return;
      }
      await beginPrivateReply(interaction);
      await handleCrowdSecCommand(interaction);
      return;
    }

    if (commandName === "lockdown") {
      const sub = interaction.options.getSubcommand();
      const scope = sub === "status" ? "lockdown.status" : sub === "access" ? "lockdown.access" : "lockdown.manage";
      if (!(await canUseBotScope(interaction, scope, isAdmin))) {
        await replyPrivilegedOnly(interaction);
        return;
      }
      await beginPrivateReply(interaction);
      try {
        await handleLockdownCommand(interaction);
      } catch (error:any) {
        console.error("[ERROR] /lockdown:", error?.response?.status || "", error?.message || error);
        await interaction.editReply({ content:error?.response?.data?.error || error?.message || "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง",embeds:[] });
      }
      return;
    }
  }
} catch (fatalErr: any) {
  console.error("[ERROR] Unhandled interaction error:", fatalErr);
  try {
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await sendPrivateReply(interaction, { content: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" });
      } else {
        await sendPrivateReply(interaction, { content: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
    }
  } catch {}
} finally {
  void activity.finish(interaction);
}
});

// Handle Prefix Commands (!code, !db) in Guilds & Direct Messages (DM) from students
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const rawContent = message.content.trim();
  const lowerContent = rawContent.toLowerCase();

  // 1. Guild Prefix Commands: !code or !db
  if (message.guild) {
    if (lowerContent.startsWith("!code") || lowerContent.startsWith("!db")) {
      const isWorkspace = lowerContent.startsWith("!code");
      const prefix = isWorkspace ? "!code" : "!db";
      const args = rawContent.slice(prefix.length).trim();
      const isAdmin = isPrivilegedDiscordUser(message.author.id, message.guild.ownerId);

      // Immediately delete invocation message in guild to protect student's privacy
      if (message.deletable) {
        try {
          await message.delete();
        } catch {
          // Ignore delete failure if missing permissions
        }
      }

      if (!await canUseBotScope({ user: message.author, member: message.member }, isWorkspace ? "code" : "db", isAdmin)) {
        await replaceDirectMessage(message.author.id, () => message.author.send("คุณไม่มีสิทธิ์ใช้คำสั่งนี้"));
        return;
      }

      // Check rate limit
      const rateCheck = checkRateLimit(message.author.id);
      if (!rateCheck.allowed) {
        try {
          await replaceDirectMessage(message.author.id, () => message.author.send(rateLimitPayload(rateCheck.waitSeconds)));
        } catch {
          // Cannot DM user
        }
        return;
      }

      // Resolve student code: from args, or from bound user cache, or from nickname/display name
      let code = "";
      const match = args.match(/\d{2,10}/);
      if (match) {
        code = match[0].length > 3 ? match[0].slice(-3) : match[0];
      } else {
        const bound = boundUsersCache.get(message.author.id);
        if (bound) {
          code = bound;
        } else {
          const detected = detectStudentCodeFromMember(message.member, message.author, validStudentCodes);
          if (detected) {
            code = detected;
          }
        }
      }

      if (!code) {
        let dmSent = false;
        try {
          await replaceDirectMessage(message.author.id, () =>
            message.author.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle("กรอกรหัสของคุณ")
                  .setColor(0x0ea5e9)
                  .setDescription(`พิมพ์ \`${prefix} 123\` หรือส่งรหัส 3 ตัวท้ายมาในแชทนี้`)
                  .setFooter({ text: USER_ONLY_FOOTER }),
              ],
            })
          );
          dmSent = true;
        } catch {
          dmSent = false;
        }

        try {
          const noticeContent = dmSent
            ? `<@${message.author.id}> พิมพ์รหัส 3 ตัวท้ายมาในข้อความส่วนตัวได้เลย`
            : `<@${message.author.id}> พิมพ์ \`${prefix} 123\` หรือใช้ ${isWorkspace ? "/code" : "/db"}`;
          await sendReplaceableNotice(message.channel, message.author.id, noticeContent);
        } catch {}
        return;
      }

      // Fetch ticket
      if (isWorkspace) {
        const result = await fetchStudentWorkspaceTicket(
          code,
          message.author.id,
          message.author.tag || message.author.username,
          isAdmin
        );

        if (!result.ok) {
          try {
            await replaceDirectMessage(message.author.id, () =>
              message.author.send(ticketErrorPayload("workspace", result, code, message.author.id))
            );
          } catch {}
          return;
        }

        if (!isAdmin) {
          boundUsersCache.set(message.author.id, code);
        }
        let dmSent = false;
        try {
          await replaceDirectMessage(message.author.id, () =>
            message.author.send(buildWorkspaceSuccessPayload(result.data))
          );
          dmSent = true;
        } catch {
          dmSent = false;
        }

        try {
          const noticeContent = dmSent
            ? `<@${message.author.id}> ส่งให้ในข้อความส่วนตัวแล้ว`
            : `<@${message.author.id}> เปิดรับข้อความส่วนตัวก่อน หรือใช้ /code`;
          await sendReplaceableNotice(message.channel, message.author.id, noticeContent);
        } catch {}
      } else {
        const result = await fetchStudentTicket(
          code,
          message.author.id,
          message.author.tag || message.author.username,
          isAdmin
        );

        if (!result.ok) {
          try {
            await replaceDirectMessage(message.author.id, () =>
              message.author.send(ticketErrorPayload("db", result, code, message.author.id))
            );
          } catch {}
          return;
        }

        if (!isAdmin) {
          boundUsersCache.set(message.author.id, code);
        }
        let dmSent = false;
        try {
          await replaceDirectMessage(message.author.id, () =>
            message.author.send(buildSuccessPayload(result.data))
          );
          dmSent = true;
        } catch {
          dmSent = false;
        }

        try {
          const noticeContent = dmSent
            ? `<@${message.author.id}> ส่งให้ในข้อความส่วนตัวแล้ว`
            : `<@${message.author.id}> เปิดรับข้อความส่วนตัวก่อน หรือใช้ /db`;
          await sendReplaceableNotice(message.channel, message.author.id, noticeContent);
        } catch {}
      }
      return;
    }
    return; // Ignore other guild messages
  }

  // 2. Direct Messages (DM) handling
  const isWorkspaceDM = lowerContent.startsWith("!code") || lowerContent.startsWith("code");
  const isAdmin = isPrivilegedDiscordUser(message.author.id);
  if (!await canUseBotScope({ user: message.author }, isWorkspaceDM ? "code" : "db", isAdmin)) {
    await replaceDirectMessage(message.author.id, () => message.reply("คุณไม่มีสิทธิ์ใช้คำสั่งนี้"));
    return;
  }

  // Extract digits
  const match = rawContent.match(/\d{2,10}/);
  if (!match) {
    const guideEmbed = new EmbedBuilder()
      .setTitle("กรอกรหัสของคุณ")
      .setColor(0x0284c7)
      .setDescription("พิมพ์รหัส 3 ตัวท้ายมาในแชทนี้ได้เลย เช่น `123` หรือ `!code 123`")
      .setFooter({ text: USER_ONLY_FOOTER });
    await replaceDirectMessage(message.author.id, () => message.reply({ embeds: [guideEmbed] }));
    return;
  }

  // Rate limit check
  const rateCheck = checkRateLimit(message.author.id);
  if (!rateCheck.allowed) {
    await replaceDirectMessage(message.author.id, () => message.reply(rateLimitPayload(rateCheck.waitSeconds)));
    return;
  }

  let code = match[0];
  if (code.length > 3) {
    code = code.slice(-3);
  }

  if (isWorkspaceDM) {
    const result = await fetchStudentWorkspaceTicket(
      code,
      message.author.id,
      message.author.tag || message.author.username,
      isAdmin
    );
    if (!result.ok) {
      await replaceDirectMessage(message.author.id, () =>
        message.reply(ticketErrorPayload("workspace", result, code, message.author.id))
      );
      return;
    }
    if (!isAdmin) {
      boundUsersCache.set(message.author.id, code);
    }
    await replaceDirectMessage(message.author.id, () => message.reply(buildWorkspaceSuccessPayload(result.data)));
  } else {
    const result = await fetchStudentTicket(
      code,
      message.author.id,
      message.author.tag || message.author.username,
      isAdmin
    );
    if (!result.ok) {
      await replaceDirectMessage(message.author.id, () =>
        message.reply(ticketErrorPayload("db", result, code, message.author.id))
      );
      return;
    }
    if (!isAdmin) {
      boundUsersCache.set(message.author.id, code);
    }
    await replaceDirectMessage(message.author.id, () => message.reply(buildSuccessPayload(result.data)));
  }
});

if (!BOT_SECRET) {
  console.error("[FATAL] BOT_INTERNAL_SECRET is required.");
  process.exitCode = 1;
} else {
  void startBot({ botKey: "nexora", envToken: TOKEN, apiUrl: API_URL, secret: BOT_SECRET, client });
}
