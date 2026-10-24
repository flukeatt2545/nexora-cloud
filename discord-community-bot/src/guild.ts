import { ChannelType, PermissionFlagsBits, type Client, type Guild } from "discord.js";
import { assignable } from "./access";
import { api, logBotError } from "./api";
import { GUILD_ID } from "./config";
import { settings, settingsVersion } from "./settings";

// The bot looks after one server (GUILD_ID). In any other server it answers only with a note,
// and it leaves such a server as soon as it notices (see index.ts).

export function homeGuildId(_client?: Client) {
  return GUILD_ID;
}

export function homeGuild(client: Client): Guild | undefined {
  const id = homeGuildId(client);
  return id ? client.guilds.cache.get(id) : undefined;
}

export function isHome(guild: Guild | null | undefined) {
  return Boolean(guild && guild.id === homeGuildId(guild.client));
}

const typeNames: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildCategory]: "category",
  [ChannelType.GuildAnnouncement]: "announcement",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildForum]: "forum",
};

/** What stops a setting from working: missing permissions, missing channels, roles out of reach. */
function problems(guild: Guild): string[] {
  const current = settings();
  const me = guild.members.me;
  const out: string[] = [];
  if (!me || !current) return out;
  const needs: [bigint, string][] = [
    [PermissionFlagsBits.ManageChannels, "Manage Channels (สร้างห้อง, Ticket, ห้องเสียง, สถิติ)"],
    [PermissionFlagsBits.ManageRoles, "Manage Roles (ให้ยศ, ตั้งสิทธิ์ห้อง)"],
    [PermissionFlagsBits.MoveMembers, "Move Members (ย้ายคนเข้าห้องเสียงที่สร้าง)"],
    [PermissionFlagsBits.AttachFiles, "Attach Files (ส่งประวัติ Ticket)"],
  ];
  for (const [flag, label] of needs) {
    if (!me.permissions.has(flag)) out.push(`บอทยังไม่มีสิทธิ์ ${label}`);
  }
  const channel = (id: string, label: string, on: boolean) => {
    if (on && id && !guild.channels.cache.has(id)) out.push(`ไม่พบ${label}ที่ตั้งไว้ (อาจถูกลบ)`);
  };
  channel(current.welcomeChannelId, "ห้องต้อนรับ", current.welcomeEnabled);
  channel(current.verifyChannelId, "ห้องยืนยันตัวตน", current.verifyEnabled);
  channel(current.boostChannelId, "ห้องบูสต์", current.boostEnabled);
  channel(current.boostLoungeChannelId, "ห้องบูสเตอร์", current.boostEnabled);
  channel(current.ticketChannelId, "ห้อง Ticket", current.ticketsEnabled);
  channel(current.ticketCategoryId, "หมวด Ticket", current.ticketsEnabled);
  channel(current.ticketLogChannelId, "ห้อง log Ticket", current.ticketsEnabled);
  channel(current.tempHubChannelId, "ห้องสร้างห้องเสียง", current.tempVoiceEnabled);
  channel(current.statusChannelId, "ห้องแจ้งสถานะ", current.statusEnabled);
  channel(current.securityChannelId, "ห้องแจ้งเตือนความปลอดภัย", current.securityEnabled);
  if (current.securityEnabled && !me.permissions.has(PermissionFlagsBits.ViewAuditLog)) out.push("บอทยังไม่มีสิทธิ์ View Audit Log (แจ้งว่าใครลบห้อง/แบนใคร และ anti-nuke)");
  if ((current.antiNukeEnabled || current.antiSpamEnabled) && !me.permissions.has(PermissionFlagsBits.ModerateMembers)) out.push("บอทยังไม่มีสิทธิ์ Timeout Members (พักการพิมพ์คนที่สแปมหรือทำลายเซิร์ฟ)");
  if (current.securityEnabled && !current.securityChannelId) out.push("เปิดแจ้งเตือนความปลอดภัยแล้ว แต่ยังไม่ได้เลือกห้อง (กด สร้างที่ขาดให้ ใน /setup)");
  if (current.memberRoleId && !assignable(guild, current.memberRoleId)) {
    out.push("ยศสมาชิกอยู่สูงกว่ายศของบอท (หรือหายไป) ลากยศของบอทให้อยู่เหนือยศสมาชิกในตั้งค่าเซิร์ฟ");
  }
  if (current.verifyEnabled && !current.memberRoleId) out.push("เปิดยืนยันตัวตนแล้ว แต่ยังไม่ได้เลือกยศสมาชิก");
  if (current.ticketsEnabled && !current.ticketCategoryId) out.push("เปิด Ticket แล้ว แต่ยังไม่ได้เลือกหมวดที่จะสร้างห้อง Ticket");
  return out;
}

let reportTimer: NodeJS.Timeout | null = null;
let appliedVersion = 0;

export function markApplied(version = settingsVersion()) {
  appliedVersion = version;
}

/** Tells the site what the server looks like (for the pickers on the web page) and what is wrong. */
export async function reportGuild(client: Client) {
  const guild = homeGuild(client);
  if (!guild) return;
  const me = guild.members.me;
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => typeNames[channel.type])
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: typeNames[channel.type],
      parentId: "parentId" in channel ? channel.parentId ?? "" : "",
      position: "rawPosition" in channel ? channel.rawPosition : 0,
    }));
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      assignable: Boolean(me && !role.managed && role.position < me.roles.highest.position),
    }));
  await api().post("/api/internal/bot/community/guild", {
    guildId: guild.id,
    guildName: guild.name,
    memberCount: guild.memberCount,
    channels: channels.slice(0, 600),
    roles: roles.slice(0, 300),
    appliedVersion,
    problems: problems(guild),
  }).catch((error) => logBotError("report guild", error));
}

/** Channels and roles change in bursts (a setup run makes ten at once); report once after. */
export function reportSoon(client: Client) {
  if (reportTimer) clearTimeout(reportTimer);
  reportTimer = setTimeout(() => {
    reportTimer = null;
    void reportGuild(client);
  }, 3000);
}
