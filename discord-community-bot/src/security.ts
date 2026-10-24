import {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type APIEmbed,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildAuditLogsEntry,
  type GuildMember,
  type Message,
  type TextChannel,
} from "discord.js";
import { isStaff } from "./access";
import { api, logBotError } from "./api";
import { homeGuild, isHome } from "./guild";
import { settings } from "./settings";
import { isTrusted, wasThrowaway } from "./trust";
import { BRAND, brandEmbed, COLOR, when } from "./ui";

// The security room (staff only): who kicked, banned or deleted what (from the server's audit
// log), accounts that are only days old, new bots and webhooks, the website's own security
// events, and what the automatic protection did:
// - anti-nuke: someone (not the owner) deleting channels or roles, or banning/kicking, many times
//   in a minute loses their roles and is timed out; a bot doing it is kicked.
// - spam: invite links, mass mentions and message floods are deleted and the sender timed out.
// - raid: many joins at once turns on raid mode for 10 minutes, kicking brand-new accounts.

const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageWebhooks,
];
const DANGEROUS_MASK = DANGEROUS.reduce((all, flag) => all | flag, 0n);

const PERMISSION_NAMES: [bigint, string][] = [
  [PermissionFlagsBits.Administrator, "Administrator"], [PermissionFlagsBits.ManageGuild, "จัดการเซิร์ฟ"],
  [PermissionFlagsBits.ManageRoles, "จัดการยศ"], [PermissionFlagsBits.ManageChannels, "จัดการห้อง"],
  [PermissionFlagsBits.BanMembers, "แบน"], [PermissionFlagsBits.KickMembers, "เตะ"], [PermissionFlagsBits.ManageWebhooks, "จัดการ webhook"],
];

function dangerousNames(bits: bigint) {
  return PERMISSION_NAMES.filter(([flag]) => (bits & flag) === flag).map(([, name]) => name).join(", ");
}

function securityChannel(guild: Guild) {
  const current = settings();
  if (!current?.securityEnabled || !current.securityChannelId) return undefined;
  const channel = guild.channels.cache.get(current.securityChannelId);
  return channel?.type === ChannelType.GuildText ? (channel as TextChannel) : undefined;
}

/** The room for the website's events, apart from the Discord one. */
function siteChannel(guild: Guild) {
  const current = settings();
  if (!current?.securityEnabled || !current.securitySiteEvents || !current.securitySiteChannelId) return undefined;
  const channel = guild.channels.cache.get(current.securitySiteChannelId);
  return channel?.type === ChannelType.GuildText ? (channel as TextChannel) : undefined;
}

// At most 20 alerts a minute, so an attack does not bury the room (or hit Discord's limits).
let sentThisMinute = 0;
let dropped = 0;
setInterval(() => {
  sentThisMinute = 0;
  if (dropped) {
    const guild = lastGuild;
    const count = dropped;
    dropped = 0;
    if (guild) void securityChannel(guild)?.send({ embeds: [new EmbedBuilder().setColor(COLOR.warn).setDescription(`ข้ามการแจ้งเตือนไป ${count} รายการในนาทีที่แล้ว (เยอะเกิน) ดูเพิ่มได้ใน Audit Log ของเซิร์ฟ`)] }).catch(() => undefined);
  }
}, 60000).unref();
let lastGuild: Guild | null = null;

async function alert(guild: Guild, embed: EmbedBuilder | APIEmbed, content?: string) {
  const channel = securityChannel(guild);
  if (!channel) return;
  lastGuild = guild;
  if (sentThisMinute >= 20) {
    dropped += 1;
    return;
  }
  sentThisMinute += 1;
  await channel.send({ content, embeds: [embed], allowedMentions: { users: content ? [guild.ownerId] : [] } })
    .catch((error) => logBotError("security alert", error));
}

function card(color: number, title: string, description: string) {
  return brandEmbed(color).setAuthor({ name: `${BRAND} · SECURITY` }).setTitle(title).setDescription(description).setTimestamp(new Date());
}

/** Tells the security room that someone cleared messages (/clear). */
export function announceCleanup(guild: Guild, who: GuildMember, scope: string, count: number) {
  return alert(guild, card(COLOR.warn, "🧹 ลบข้อความ", `${who} ลบ **${count}** ข้อความ\nขอบเขต: ${scope}`));
}

function logEvent(kind: "nuke" | "spam" | "raid", guild: Guild, name: string, id: string, details: string[]) {
  void api().post("/api/internal/bot/community/event", { kind, guildId: guild.id, name, id, created: details }).catch((error) => logBotError("log security", error));
}

// Anti-nuke

const actions = new Map<string, { kind: string; at: number }[]>();
const punished = new Map<string, number>();
const WINDOW_MS = 60000;
// Deleting a channel has its own limit (1 = the first one), set on the web page or with /protect.
const LIMITS: Record<string, number> = { destroy: 3, punish: 4, create: 8, webhook: 3 };
const KIND_TEXT: Record<string, string> = { channel: "ลบห้อง", destroy: "ลบยศ", punish: "เตะหรือแบนสมาชิก", create: "สร้างห้อง", webhook: "สร้าง webhook" };

function limitFor(kind: string) {
  if (kind !== "channel") return LIMITS[kind];
  return Math.min(5, Math.max(1, Math.round(settings()?.nukeChannelLimit ?? 1)));
}

async function stopNuker(guild: Guild, executorId: string, kind: string, count: number) {
  if (Date.now() - (punished.get(executorId) ?? 0) < 5 * 60000) return;
  punished.set(executorId, Date.now());
  const member = await guild.members.fetch(executorId).catch(() => null);
  const did: string[] = [];
  if (member) {
    if (member.user.bot) {
      if (member.kickable) await member.kick(`anti-nuke: ${KIND_TEXT[kind]} ${count} ครั้งใน 1 นาที`).then(() => did.push("เตะบอทออกจากเซิร์ฟ")).catch(() => undefined);
    } else {
      const me = guild.members.me!;
      const removable = member.roles.cache.filter((role) => role.id !== guild.id && !role.managed && role.position < me.roles.highest.position);
      if (removable.size) await member.roles.remove([...removable.keys()], "anti-nuke").then(() => did.push(`ถอดยศ ${removable.size} ยศ`)).catch(() => undefined);
      if (member.moderatable) await member.timeout(60 * 60000, "anti-nuke").then(() => did.push("พักการพิมพ์และพูด 1 ชั่วโมง")).catch(() => undefined);
    }
  }
  const result = did.length ? did.join(" · ") : "หยุดไม่ได้ (ยศของคนนี้อยู่สูงกว่ายศของบอท) ต้องจัดการเอง";
  await alert(guild, card(COLOR.danger, "🚨 Anti-nuke: หยุดคนที่ทำลายเซิร์ฟ",
    `<@${executorId}> ${KIND_TEXT[kind]} **${count} ครั้งใน 1 นาที**\nบอททำแล้ว: ${result}\nตรวจดู Audit Log ของเซิร์ฟ แล้วคืนยศให้เองถ้าเป็นเรื่องเข้าใจผิด`), `<@${guild.ownerId}>`);
  logEvent("nuke", guild, member?.user.username ?? executorId, executorId, [`${KIND_TEXT[kind]} ${count} ครั้งใน 1 นาที`, result]);
}

async function countAction(guild: Guild, executorId: string, kind: string) {
  if (!settings()?.antiNukeEnabled || await isTrusted(guild, executorId)) return;
  const now = Date.now();
  const list = (actions.get(executorId) ?? []).filter((item) => now - item.at < WINDOW_MS);
  list.push({ kind, at: now });
  actions.set(executorId, list);
  const count = list.filter((item) => item.kind === kind).length;
  if (count >= limitFor(kind)) void stopNuker(guild, executorId, kind, count);
}

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [id, list] of actions) if (!list.some((item) => item.at > cutoff)) actions.delete(id);
}, 60000).unref();

// Audit log: alerts and anti-nuke counting

function changed(entry: GuildAuditLogsEntry, key: string) {
  return entry.changes.find((change) => change.key === key);
}

export async function onAuditLogEntry(entry: GuildAuditLogsEntry, guild: Guild) {
  if (!isHome(guild) || !entry.executorId) return;
  const by = entry.executorId;
  const byText = `<@${by}>`;
  const target = entry.targetId ? `<@${entry.targetId}>` : "";
  const reason = entry.reason ? `\nเหตุผล: ${entry.reason}` : "";
  const ours = by === guild.client.user.id;
  const quiet = ours || !settings()?.securityEnabled;
  switch (entry.action) {
    case AuditLogEvent.MemberKick:
      await countAction(guild, by, "punish");
      if (!quiet) await alert(guild, card(COLOR.warn, "👢 เตะสมาชิก", `${byText} เตะ ${target} ออกจากเซิร์ฟ${reason}`));
      break;
    case AuditLogEvent.MemberBanAdd:
      await countAction(guild, by, "punish");
      if (!quiet) await alert(guild, card(COLOR.danger, "🔨 แบนสมาชิก", `${byText} แบน ${target}${reason}`));
      break;
    case AuditLogEvent.MemberBanRemove:
      if (!quiet) await alert(guild, card(COLOR.brand, "🔓 ยกเลิกแบน", `${byText} ยกเลิกแบน ${target}${reason}`));
      break;
    case AuditLogEvent.ChannelDelete: {
      const name = String(changed(entry, "name")?.old ?? entry.targetId);
      // Rooms the bot makes and removes by itself (temporary voice rooms, tickets) are not
      // counted; they are noted a moment before or after this entry arrives.
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (entry.targetId && wasThrowaway(entry.targetId)) break;
      await countAction(guild, by, "channel");
      if (!quiet) await alert(guild, card(COLOR.danger, "🗑️ ห้องถูกลบ", `${byText} ลบห้อง **${name}**${reason}`));
      break;
    }
    case AuditLogEvent.ChannelCreate:
      await countAction(guild, by, "create");
      break;
    case AuditLogEvent.RoleDelete: {
      await countAction(guild, by, "destroy");
      const name = String(changed(entry, "name")?.old ?? entry.targetId);
      if (!quiet) await alert(guild, card(COLOR.danger, "🗑️ ยศถูกลบ", `${byText} ลบยศ **${name}**${reason}`));
      break;
    }
    case AuditLogEvent.RoleUpdate: {
      const permissions = changed(entry, "permissions");
      if (!permissions || quiet) break;
      const gained = BigInt(String(permissions.new ?? "0")) & ~BigInt(String(permissions.old ?? "0")) & DANGEROUS_MASK;
      if (gained) await alert(guild, card(COLOR.warn, "⚠️ ยศได้สิทธิ์สูงขึ้น", `${byText} ให้ยศ <@&${entry.targetId}> มีสิทธิ์ **${dangerousNames(gained)}**${reason}`));
      break;
    }
    case AuditLogEvent.MemberRoleUpdate: {
      const added = (changed(entry, "$add")?.new ?? []) as { id: string; name: string }[];
      const risky = added.filter((role) => {
        const bits = guild.roles.cache.get(role.id)?.permissions.bitfield ?? 0n;
        return (bits & DANGEROUS_MASK) !== 0n;
      });
      if (risky.length && !quiet) {
        const bits = risky.reduce((all, role) => all | (guild.roles.cache.get(role.id)?.permissions.bitfield ?? 0n), 0n);
        await alert(guild, card(COLOR.warn, "⚠️ ได้ยศสิทธิ์สูง", `${byText} ให้ยศ ${risky.map((role) => `<@&${role.id}>`).join(" ")} กับ ${target}\nสิทธิ์: ${dangerousNames(bits & DANGEROUS_MASK)}`));
      }
      break;
    }
    case AuditLogEvent.BotAdd:
      if (!quiet) await alert(guild, card(COLOR.warn, "🤖 มีบอทใหม่เข้าเซิร์ฟ", `${byText} เชิญบอท ${target} เข้าเซิร์ฟ`));
      break;
    case AuditLogEvent.WebhookCreate:
      await countAction(guild, by, "webhook");
      if (!quiet) await alert(guild, card(COLOR.warn, "🪝 สร้าง webhook", `${byText} สร้าง webhook **${String(changed(entry, "name")?.new ?? "")}**`));
      break;
    default:
      break;
  }
}

/** The voice-room module made a deleted channel again: tell the security room. */
export async function announceRestore(guild: Guild, oldName: string, made: GuildBasedChannel, deleterId: string) {
  if (!settings()?.securityEnabled) return;
  await alert(guild, card(COLOR.ok, "♻️ สร้างห้องคืนแล้ว",
    `${deleterId ? `<@${deleterId}> ลบห้อง` : "มีคนลบห้อง"} **${oldName}** → บอทสร้างคืนเป็น <#${made.id}> (ชื่อ หมวด ตำแหน่ง และสิทธิ์เดิม)
ข้อความที่เคยอยู่ในห้องกู้คืนไม่ได้`));
}

// Joins: new accounts and raids

const joins: number[] = [];
let raidUntil = 0;
const RAID_JOINS = 8;
const RAID_WINDOW_MS = 30000;

/** Returns true when the member was kicked (raid mode), so no welcome is sent. */
export async function onSecurityJoin(member: GuildMember) {
  const current = settings();
  if (!current) return false;
  const guild = member.guild;
  const now = Date.now();
  const ageDays = (now - member.user.createdTimestamp) / 86400000;
  const young = current.newAccountDays > 0 && ageDays < current.newAccountDays;

  if (current.antiSpamEnabled) {
    joins.push(now);
    while (joins.length && now - joins[0] > RAID_WINDOW_MS) joins.shift();
    if (joins.length >= RAID_JOINS && now > raidUntil) {
      raidUntil = now + 10 * 60000;
      await alert(guild, card(COLOR.danger, "🚨 คนเข้ารัว (raid)", `มีคนเข้าเซิร์ฟ ${joins.length} คนใน 30 วินาที\nเปิดโหมดกัน raid 10 นาที${current.newAccountDays ? `: บัญชีอายุไม่ถึง ${current.newAccountDays} วันจะถูกเตะ` : ""}`), `<@${guild.ownerId}>`);
      logEvent("raid", guild, guild.name, guild.id, [`${joins.length} คนใน 30 วินาที`]);
    }
    if (now < raidUntil && young && !member.user.bot && member.kickable) {
      await member.send(`ตอนนี้เซิร์ฟ **${guild.name}** ปิดรับบัญชีใหม่ชั่วคราว ลองเข้าใหม่ในอีกสักครู่`).catch(() => undefined);
      await member.kick("โหมดกัน raid: บัญชีใหม่").catch((error) => logBotError("raid kick", error));
      await alert(guild, card(COLOR.warn, "👢 เตะบัญชีใหม่ (โหมดกัน raid)", `${member.user.tag} (\`${member.id}\`) อายุบัญชี ${Math.floor(ageDays)} วัน`));
      return true;
    }
  }
  if (young && current.securityEnabled && !member.user.bot) {
    // Not awaited: the welcome should not wait for the staff notice.
    void alert(guild, card(COLOR.warn, "🆕 บัญชีเพิ่งสร้างเข้าเซิร์ฟ",
      `<@${member.id}> (${member.user.tag}) บัญชีอายุ **${Math.max(0, Math.floor(ageDays))} วัน** (สร้างเมื่อ ${when(member.user.createdAt, "R")})`));
  }
  return false;
}

// Messages: invite links, mass mentions, floods

const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const recent = new Map<string, { at: number; text: string; id: string; channelId: string }[]>();
const warned = new Map<string, number>();

function exempt(member: GuildMember | null) {
  return !member || member.user.bot || isStaff(member) || member.permissions.has(PermissionFlagsBits.ManageMessages);
}

async function punishSpam(message: Message, what: string, timeoutMinutes: number, deleteRecent: boolean) {
  const member = message.member!;
  const guild = message.guild!;
  await message.delete().catch(() => undefined);
  if (deleteRecent && message.channel.type === ChannelType.GuildText) {
    const ids = (recent.get(member.id) ?? []).filter((item) => item.channelId === message.channelId).map((item) => item.id);
    if (ids.length) await (message.channel as TextChannel).bulkDelete(ids, true).catch(() => undefined);
  }
  if (timeoutMinutes && member.moderatable) await member.timeout(timeoutMinutes * 60000, `กันสแปม: ${what}`).catch(() => undefined);
  // One alert per person per minute.
  if (Date.now() - (warned.get(member.id) ?? 0) < 60000) return;
  warned.set(member.id, Date.now());
  if (message.channel.type === ChannelType.GuildText) {
    const note = await (message.channel as TextChannel).send({ content: `<@${member.id}> ${what} ไม่ได้ในเซิร์ฟนี้${timeoutMinutes ? ` (พักการพิมพ์ ${timeoutMinutes} นาที)` : ""}`, allowedMentions: { users: [member.id] } }).catch(() => null);
    if (note) setTimeout(() => void note.delete().catch(() => undefined), 8000);
  }
  await alert(guild, card(COLOR.warn, "🛡️ กันสแปม", `<@${member.id}> ${what} ใน <#${message.channelId}>${timeoutMinutes ? `\nพักการพิมพ์ ${timeoutMinutes} นาที` : ""}`));
  logEvent("spam", guild, member.user.username, member.id, [what]);
}

export async function onSecurityMessage(message: Message) {
  if (!message.inGuild() || !isHome(message.guild) || !settings()?.antiSpamEnabled) return;
  const member = message.member;
  if (exempt(member)) return;
  const now = Date.now();
  const list = (recent.get(member!.id) ?? []).filter((item) => now - item.at < 30000);
  list.push({ at: now, text: message.content.trim().toLowerCase(), id: message.id, channelId: message.channelId });
  recent.set(member!.id, list);

  if (INVITE.test(message.content)) return punishSpam(message, "ส่งลิงก์เชิญเซิร์ฟอื่น", 0, false);
  const mentions = message.mentions.users.size + message.mentions.roles.size;
  if (mentions > 5 || /@(everyone|here)/.test(message.content)) return punishSpam(message, "แท็กคนจำนวนมาก", 10, false);
  const burst = list.filter((item) => now - item.at < 5000).length;
  const same = message.content.trim() ? list.filter((item) => item.text === message.content.trim().toLowerCase()).length : 0;
  if (burst >= 6 || same >= 4) return punishSpam(message, "ส่งข้อความรัวหรือซ้ำ ๆ", 5, true);
}

setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [id, list] of recent) if (!list.some((item) => item.at > cutoff)) recent.delete(id);
  for (const [id, at] of warned) if (at < cutoff) warned.delete(id);
}, 60000).unref();

// Security events queued by the API: the website's go to the web room, what happened in Discord
// (a voice room turning someone away) to the Discord room.

export function startSiteSecurityFeed(client: Client) {
  setInterval(async () => {
    const guild = homeGuild(client);
    if (!guild) return;
    try {
      const res = await api().get<{ items: { id: number; room?: string; embed: APIEmbed }[] }>("/api/internal/bot/community/security-feed");
      const posted: number[] = [];
      for (const item of res.data.items) {
        // Without its own room an event waits (the API keeps them a day); it is never moved to the other room.
        const channel = item.room === "discord" ? securityChannel(guild) : siteChannel(guild);
        if (!channel) continue;
        await channel.send({ embeds: [item.embed] }).catch((error) => logBotError("security feed", error));
        posted.push(item.id);
      }
      if (posted.length) await api().post("/api/internal/bot/community/security-feed/ack", { ids: posted });
    } catch (error) {
      logBotError("site security feed", error);
    }
  }, 10000).unref();
}
