import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type OverwriteResolvable,
  type Role,
} from "discord.js";
import { assignable } from "./access";
import { logBotError } from "./api";
import { settings, type Settings } from "./settings";
import { statsNames } from "./stats";
import { siteUp } from "./status";

// "Make what is missing": the roles, categories and channels each turned-on feature needs.
// A setting that points at something that still exists is left alone; otherwise a channel or
// role with the expected name is used, and only then a new one is made.

const view = PermissionFlagsBits.ViewChannel;
const send = PermissionFlagsBits.SendMessages;
const connect = PermissionFlagsBits.Connect;
const botAllow = [view, send, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ManageChannels, connect, PermissionFlagsBits.MoveMembers];

type Plan = {
  change: Partial<Settings>;
  created: string[];
};

/** Who sees a channel: everyone (read only or not), members only, or staff only. */
type Audience = "everyone-read" | "everyone" | "members" | "members-read" | "staff" | "unverified";

function overwrites(guild: Guild, audience: Audience, memberRoleId: string, staffRoleIds: string[], voice = false): OverwriteResolvable[] {
  const everyone = guild.id;
  const bot = { id: guild.client.user.id, type: OverwriteType.Member, allow: botAllow };
  const members = memberRoleId || everyone;
  const staff = staffRoleIds.filter((id) => guild.roles.cache.has(id)).map((id) => ({ id, type: OverwriteType.Role, allow: [view, send, connect] }));
  switch (audience) {
    case "everyone":
      return [bot];
    case "everyone-read":
      return [{ id: everyone, type: OverwriteType.Role, deny: voice ? [connect] : [send] }, bot];
    case "unverified":
      // The verify room: everyone sees it until they have the member role.
      return [
        { id: everyone, type: OverwriteType.Role, allow: [view], deny: [send] },
        ...(memberRoleId ? [{ id: memberRoleId, type: OverwriteType.Role, deny: [view] }] : []),
        bot,
      ];
    case "members":
    case "members-read": {
      const deny = audience === "members-read" ? [send] : [];
      if (members === everyone) return [{ id: everyone, type: OverwriteType.Role, deny }, bot];
      return [{ id: everyone, type: OverwriteType.Role, deny: [view] }, { id: members, type: OverwriteType.Role, allow: [view], deny }, bot, ...staff];
    }
    case "staff":
      return [{ id: everyone, type: OverwriteType.Role, deny: [view] }, bot, ...staff];
  }
}

function exists(guild: Guild, id: string, type: ChannelType) {
  const channel = id ? guild.channels.cache.get(id) : undefined;
  return channel?.type === type ? channel : undefined;
}

function byName(guild: Guild, name: string, type: ChannelType, parentId?: string) {
  return guild.channels.cache.find((channel) => channel.type === type && channel.name === name && (!parentId || ("parentId" in channel && channel.parentId === parentId)));
}

async function ensureRole(guild: Guild, plan: Plan, key: "memberRoleId", name: string, color: number): Promise<Role | undefined> {
  const current = settings()!;
  const id = (plan.change[key] as string | undefined) ?? current[key];
  const found = (id && guild.roles.cache.get(id)) || guild.roles.cache.find((role) => role.name === name);
  if (found) {
    if (found.id !== id) plan.change[key] = found.id;
    return found;
  }
  const role = await guild.roles.create({ name, color, reason: "/setup: สร้างยศที่ขาด" });
  plan.change[key] = role.id;
  plan.created.push(`ยศ ${name}`);
  return role;
}

async function ensureCategory(guild: Guild, plan: Plan, name: string, audience: Audience, idHint = ""): Promise<CategoryChannel> {
  const current = settings()!;
  const memberRoleId = plan.change.memberRoleId ?? current.memberRoleId;
  const staff = plan.change.staffRoleIds ?? current.staffRoleIds;
  const found = exists(guild, idHint, ChannelType.GuildCategory) ?? byName(guild, name, ChannelType.GuildCategory);
  if (found) return found as CategoryChannel;
  const category = await guild.channels.create({
    name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites(guild, audience, memberRoleId, staff), reason: "/setup: สร้างหมวดที่ขาด",
  });
  plan.created.push(`หมวด ${name}`);
  return category;
}

async function ensureChannel(guild: Guild, plan: Plan, key: keyof Settings, name: string, type: ChannelType.GuildText | ChannelType.GuildVoice,
  parent: CategoryChannel, audience: Audience): Promise<GuildBasedChannel> {
  const current = settings()!;
  const memberRoleId = plan.change.memberRoleId ?? current.memberRoleId;
  const staff = plan.change.staffRoleIds ?? current.staffRoleIds;
  const id = (plan.change[key] as string | undefined) ?? (current[key] as string);
  const found = exists(guild, id, type) ?? byName(guild, name, type, parent.id);
  if (found) {
    if (found.id !== id) (plan.change as Record<string, unknown>)[key] = found.id;
    return found;
  }
  const channel = await guild.channels.create({
    name, type, parent: parent.id, reason: "/setup: สร้างห้องที่ขาด",
    permissionOverwrites: overwrites(guild, audience, memberRoleId, staff, type === ChannelType.GuildVoice),
  });
  (plan.change as Record<string, unknown>)[key] = channel.id;
  plan.created.push(`${type === ChannelType.GuildVoice ? "ห้องเสียง" : "ห้อง"} ${name}`);
  return channel;
}

/** Builds what the turned-on features need. Returns the settings to save and what was made. */
export async function buildMissing(guild: Guild): Promise<Plan & { problems: string[] }> {
  const current = settings()!;
  const plan: Plan = { change: {}, created: [] };
  const problems: string[] = [];
  const step = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      logBotError(`setup ${label}`, error);
      problems.push(`สร้าง${label}ไม่ได้ (บอทอาจไม่มีสิทธิ์ Manage Channels / Manage Roles)`);
    }
  };

  // Roles first: the channels' permissions refer to them.
  if (current.verifyEnabled || current.memberRoleId) {
    await step("ยศสมาชิก", () => ensureRole(guild, plan, "memberRoleId", "สมาชิก", 0x18b77a));
  }
  if (current.ticketsEnabled && !current.staffRoleIds.some((id) => guild.roles.cache.has(id))) {
    await step("ยศทีมงาน", async () => {
      let staff = guild.roles.cache.find((role) => role.name === "ทีมงาน");
      if (!staff) {
        staff = await guild.roles.create({ name: "ทีมงาน", color: 0x2e7eff, hoist: true, reason: "/setup: สร้างยศที่ขาด" });
        plan.created.push("ยศ ทีมงาน");
      }
      plan.change.staffRoleIds = [staff.id];
    });
  }

  const memberRoleId = plan.change.memberRoleId ?? current.memberRoleId;
  if (memberRoleId && !assignable(guild, memberRoleId)) problems.push("ยศสมาชิกอยู่สูงกว่ายศของบอท ลากยศของบอทขึ้นไปไว้บนสุดในตั้งค่าเซิร์ฟ");

  const startHere = current.welcomeEnabled || current.verifyEnabled || current.statusEnabled || current.selfRoleIds.length > 0;
  if (startHere) {
    await step("หมวดเริ่มต้น", async () => {
      const hint = exists(guild, current.welcomeChannelId, ChannelType.GuildText);
      const category = await ensureCategory(guild, plan, "📌 เริ่มต้นที่นี่", "everyone", hint && "parentId" in hint ? hint.parentId ?? "" : "");
      if (current.welcomeEnabled) await ensureChannel(guild, plan, "welcomeChannelId", "👋・ยินดีต้อนรับ", ChannelType.GuildText, category, "everyone-read");
      if (current.verifyEnabled) await ensureChannel(guild, plan, "verifyChannelId", "✅・ยืนยันตัวตน", ChannelType.GuildText, category, "unverified");
      if (current.selfRoleIds.length) await ensureChannel(guild, plan, "rolesChannelId", "🎭・เลือกยศ", ChannelType.GuildText, category, "members-read");
      if (current.statusEnabled) await ensureChannel(guild, plan, "statusChannelId", "📢・สถานะระบบ", ChannelType.GuildText, category, "members-read");
    });
  }

  if (current.ticketsEnabled) {
    await step("หมวด Ticket", async () => {
      const category = await ensureCategory(guild, plan, "🎫 ช่วยเหลือ", "members", current.ticketCategoryId);
      if (category.id !== current.ticketCategoryId) plan.change.ticketCategoryId = category.id;
      await ensureChannel(guild, plan, "ticketChannelId", "🎫・เปิด-ticket", ChannelType.GuildText, category, "members-read");
      await ensureChannel(guild, plan, "ticketLogChannelId", "📝・ticket-log", ChannelType.GuildText, category, "staff");
    });
  }

  if (current.tempVoiceEnabled) {
    await step("ห้องสร้างห้องเสียง", async () => {
      const hub = exists(guild, current.tempHubChannelId, ChannelType.GuildVoice);
      if (hub) return;
      const category = await ensureCategory(guild, plan, "🔊 ห้องเสียง", "members");
      await ensureChannel(guild, plan, "tempHubChannelId", "➕ สร้างห้องเสียง", ChannelType.GuildVoice, category, "members");
    });
  }

  if (current.statsEnabled) {
    await step("ห้องสถิติ", async () => {
      const category = await ensureCategory(guild, plan, "📊 สถิติเซิร์ฟ", "everyone", current.statsCategoryId);
      if (category.id !== current.statsCategoryId) plan.change.statsCategoryId = category.id;
      // Stats sit at the top of the channel list.
      if (plan.created.includes("หมวด 📊 สถิติเซิร์ฟ")) await category.setPosition(0).catch(() => undefined);
      const counts = await guild.client.guilds.fetch({ guild: guild.id, withCounts: true, force: true }).catch(() => guild);
      await ensureChannel(guild, plan, "statsMembersChannelId", statsNames.members(counts.approximateMemberCount ?? guild.memberCount), ChannelType.GuildVoice, category, "everyone-read");
      await ensureChannel(guild, plan, "statsOnlineChannelId", statsNames.online(counts.approximatePresenceCount ?? 0), ChannelType.GuildVoice, category, "everyone-read");
      await ensureChannel(guild, plan, "statsSiteChannelId", statsNames.site(siteUp()), ChannelType.GuildVoice, category, "everyone-read");
    });
  }

  return { ...plan, problems };
}

/**
 * Hides what everyone can see now behind the member role, so new members see only the
 * "start here" category until they verify. Rooms that are already private are left alone.
 */
export async function hideFromUnverified(guild: Guild) {
  const current = settings()!;
  const memberRoleId = current.memberRoleId;
  if (!memberRoleId || !guild.roles.cache.has(memberRoleId)) return { changed: 0, failed: 0, missingRole: true };
  const keep = new Set([current.welcomeChannelId, current.verifyChannelId].filter(Boolean));
  for (const id of [...keep]) {
    const channel = guild.channels.cache.get(id);
    if (channel && "parentId" in channel && channel.parentId) keep.add(channel.parentId);
  }
  const everyone = guild.roles.everyone;
  let changed = 0;
  let failed = 0;
  for (const channel of guild.channels.cache.values()) {
    if (keep.has(channel.id) || ("parentId" in channel && channel.parentId && keep.has(channel.parentId))) continue;
    if (channel.isThread() || !("permissionOverwrites" in channel)) continue;
    if (!channel.permissionsFor(everyone).has(view)) continue;
    try {
      await channel.permissionOverwrites.edit(guild.client.user.id, { ViewChannel: true, SendMessages: true, Connect: true }, { reason: "ซ่อนห้องจากคนที่ยังไม่ยืนยัน" });
      await channel.permissionOverwrites.edit(memberRoleId, { ViewChannel: true }, { reason: "ซ่อนห้องจากคนที่ยังไม่ยืนยัน" });
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: false }, { reason: "ซ่อนห้องจากคนที่ยังไม่ยืนยัน" });
      changed += 1;
    } catch (error) {
      logBotError("hide channel", error);
      failed += 1;
    }
  }
  return { changed, failed, missingRole: false };
}
