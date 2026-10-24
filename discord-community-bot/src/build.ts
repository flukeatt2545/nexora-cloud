import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type OverwriteResolvable,
  type PermissionResolvable,
  type Role,
  type TextChannel,
} from "discord.js";
import { assignable } from "./access";
import { logBotError } from "./api";
import { nameStyle, settings, type Settings } from "./settings";
import { statsNames } from "./stats";
import { siteUp } from "./status";
import { categoryName, channelName, fancy, restyle, roleName, splitName } from "./style";
import { COLOR, row } from "./ui";

// "Make what is missing": a tidy server in one go. Roles in the usual order (owner, admin,
// moderator, staff, VIP, member, bots, then roles members pick), and categories for getting
// started, chatting, voice, support, stats and staff, each with its channels. Names follow the
// style chosen in the settings. Anything that already exists (same words, any style) is used
// as it is; a setting that points at something still there is left alone.

const view = PermissionFlagsBits.ViewChannel;
const send = PermissionFlagsBits.SendMessages;
const connect = PermissionFlagsBits.Connect;
const botAllow = [view, send, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ManageChannels, connect, PermissionFlagsBits.MoveMembers];

type Plan = { change: Partial<Settings>; created: string[] };

/** Who sees a channel: everyone (read only or not), members only, staff only, or only before verifying. */
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

/** Words of a name without emoji, frame or style, for "is this the same channel/role?". */
function key(name: string) {
  return splitName(name).words.toLowerCase().replace(/[-\s]+/g, " ");
}

function exists(guild: Guild, id: string, types: ChannelType[]) {
  const channel = id ? guild.channels.cache.get(id) : undefined;
  return channel && types.includes(channel.type) ? channel : undefined;
}

function byWords(guild: Guild, words: string[], types: ChannelType[]) {
  const wanted = words.map((word) => word.toLowerCase().replace(/[-\s]+/g, " "));
  // "สมาชิก: 128" is still the members stats channel.
  return guild.channels.cache.find((channel) => types.includes(channel.type)
    && wanted.some((word) => key(channel.name) === word || key(channel.name).startsWith(`${word} `)));
}

// Roles

type RoleSpec = {
  id: string;
  emoji: string;
  english: string;
  /** Older or Thai names that count as this role already. */
  aliases: string[];
  color: number;
  hoist: boolean;
  permissions: PermissionResolvable[];
};

const MOD_PERMISSIONS = [PermissionFlagsBits.KickMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageNicknames, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.ViewAuditLog];

const ROLES: RoleSpec[] = [
  { id: "owner", emoji: "👑", english: "Owner", aliases: ["เจ้าของ", "owner", "เจ้าของเซิร์ฟ"], color: 0xf1c40f, hoist: true, permissions: [] },
  { id: "admin", emoji: "🛡️", english: "Admin", aliases: ["แอดมิน", "admin", "administrator"], color: 0xe74c3c, hoist: true,
    permissions: [...MOD_PERMISSIONS, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageGuild, PermissionFlagsBits.MentionEveryone, PermissionFlagsBits.DeafenMembers] },
  { id: "mod", emoji: "⚔️", english: "Moderator", aliases: ["ม็อด", "mod", "moderator"], color: 0xe67e22, hoist: true, permissions: MOD_PERMISSIONS },
  { id: "staff", emoji: "🎫", english: "Staff", aliases: ["ทีมงาน", "staff"], color: 0x2e7eff, hoist: true, permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.MoveMembers] },
  { id: "vip", emoji: "💎", english: "VIP", aliases: ["vip", "วีไอพี"], color: 0x9b59b6, hoist: true, permissions: [] },
  { id: "member", emoji: "✨", english: "Member", aliases: ["สมาชิก", "member", "members"], color: 0x18b77a, hoist: false, permissions: [] },
  { id: "bots", emoji: "🤖", english: "Bots", aliases: ["บอท", "bot", "bots"], color: 0x95a5a6, hoist: true, permissions: [] },
];

// Roles members pick for themselves on the roles panel, made when none are set yet.
const SELF_ROLES: RoleSpec[] = [
  { id: "gamer", emoji: "🎮", english: "Gamer", aliases: ["เกมเมอร์", "gamer"], color: 0x5865f2, hoist: false, permissions: [] },
  { id: "music", emoji: "🎵", english: "Music", aliases: ["ฟังเพลง", "music"], color: 0x1abc9c, hoist: false, permissions: [] },
  { id: "coder", emoji: "💻", english: "Coder", aliases: ["โปรแกรมเมอร์", "coder", "dev"], color: 0x3498db, hoist: false, permissions: [] },
  { id: "artist", emoji: "🎨", english: "Artist", aliases: ["ศิลปิน", "artist"], color: 0xe91e63, hoist: false, permissions: [] },
  { id: "student", emoji: "📚", english: "Student", aliases: ["นักเรียน", "นักศึกษา", "student"], color: 0xf39c12, hoist: false, permissions: [] },
  { id: "updates", emoji: "🔔", english: "Updates", aliases: ["แจ้งเตือน", "updates", "แจ้งเตือนประกาศ"], color: 0x95a5a6, hoist: false, permissions: [] },
];

function findRole(guild: Guild, spec: RoleSpec, preferId: string) {
  const known = preferId ? guild.roles.cache.get(preferId) : undefined;
  if (known) return known;
  const names = [spec.english, ...spec.aliases].map((name) => name.toLowerCase());
  return guild.roles.cache.find((role) => !role.managed && names.includes(key(role.name)));
}

async function ensureRole(guild: Guild, plan: Plan, spec: RoleSpec, preferId = ""): Promise<Role> {
  const found = findRole(guild, spec, preferId);
  if (found) return found;
  const name = roleName(nameStyle(), spec.emoji, spec.english);
  const base = { name, color: spec.color, hoist: spec.hoist, mentionable: false, reason: "/setup: สร้างยศที่ขาด" };
  // Without Administrator the bot cannot hand out permissions it lacks; make the role plain then.
  const role = await guild.roles.create({ ...base, permissions: spec.permissions })
    .catch(() => guild.roles.create({ ...base, permissions: [] }));
  plan.created.push(`ยศ ${name}`);
  return role;
}

async function buildRoles(guild: Guild, plan: Plan, problems: string[]) {
  const current = settings()!;
  const made = new Map<string, Role>();
  for (const spec of ROLES) {
    const preferId = spec.id === "member" ? current.memberRoleId : spec.id === "staff" ? current.staffRoleIds[0] ?? "" : "";
    try {
      made.set(spec.id, await ensureRole(guild, plan, spec, preferId));
    } catch (error) {
      logBotError(`role ${spec.id}`, error);
      problems.push(`สร้างยศ ${spec.english} ไม่ได้ (บอทอาจไม่มีสิทธิ์ Manage Roles)`);
    }
  }
  const member = made.get("member");
  const staff = made.get("staff");
  if (member && member.id !== current.memberRoleId) plan.change.memberRoleId = member.id;
  // Staff rooms and tickets: the staff role plus moderators and admins. /setup: admins.
  const admin = made.get("admin");
  const mod = made.get("mod");
  if (staff && !current.staffRoleIds.some((id) => guild.roles.cache.has(id))) {
    plan.change.staffRoleIds = [staff, mod, admin].filter((role): role is Role => Boolean(role)).map((role) => role.id);
  }
  if (admin && !current.managerRoleIds.some((id) => guild.roles.cache.has(id))) plan.change.managerRoleIds = [admin.id];

  if (!current.selfRoleIds.some((id) => guild.roles.cache.has(id))) {
    const picks: Role[] = [];
    for (const spec of SELF_ROLES) {
      try {
        picks.push(await ensureRole(guild, plan, spec));
      } catch (error) {
        logBotError(`self role ${spec.id}`, error);
      }
    }
    if (picks.length) plan.change.selfRoleIds = picks.map((role) => role.id);
    picks.forEach((role, index) => made.set(`self-${index}`, role));
  }

  // Top to bottom, right under the bot's own role. Roles the bot cannot move stay where they are.
  const me = guild.members.me;
  if (me) {
    const order = [...made.values()].filter((role) => assignable(guild, role.id));
    const top = me.roles.highest.position - 1;
    await guild.roles.setPositions(order.map((role, index) => ({ role: role.id, position: Math.max(1, top - index) })))
      .catch((error) => logBotError("order roles", error));
  }

  // The owner gets the owner role and bots get the bots role, so the member list reads well.
  const owner = made.get("owner");
  if (owner && assignable(guild, owner.id)) {
    const ownerMember = await guild.members.fetch(guild.ownerId).catch(() => null);
    if (ownerMember && !ownerMember.roles.cache.has(owner.id)) await ownerMember.roles.add(owner.id, "/setup: ยศเจ้าของเซิร์ฟ").catch(() => undefined);
  }
  const bots = made.get("bots");
  if (bots && assignable(guild, bots.id)) {
    const all = await guild.members.fetch().catch(() => null);
    for (const botMember of all?.filter((item) => item.user.bot && !item.roles.cache.has(bots.id)).values() ?? []) {
      await botMember.roles.add(bots.id, "/setup: ยศบอท").catch(() => undefined);
    }
  }
}

// Channels

async function ensureCategory(guild: Guild, plan: Plan, emoji: string, english: string, thai: string, audience: Audience, idHint = ""): Promise<CategoryChannel> {
  const current = settings()!;
  const found = exists(guild, idHint, [ChannelType.GuildCategory]) ?? byWords(guild, [thai, english, `${english} ${thai}`], [ChannelType.GuildCategory]);
  if (found) return found as CategoryChannel;
  const name = categoryName(nameStyle(), emoji, english, thai);
  const category = await guild.channels.create({
    name, type: ChannelType.GuildCategory, reason: "/setup: สร้างหมวดที่ขาด",
    permissionOverwrites: overwrites(guild, audience, plan.change.memberRoleId ?? current.memberRoleId, plan.change.staffRoleIds ?? current.staffRoleIds),
  });
  plan.created.push(`หมวด ${name}`);
  return category;
}

type ChannelSpec = {
  key?: keyof Settings;
  emoji: string;
  name: string;
  type: ChannelType.GuildText | ChannelType.GuildVoice;
  audience: Audience;
  /** Older names that count as this channel already. */
  aliases?: string[];
};

async function ensureChannel(guild: Guild, plan: Plan, parent: CategoryChannel, spec: ChannelSpec, exactName?: string): Promise<GuildBasedChannel> {
  const current = settings()!;
  const id = spec.key ? ((plan.change[spec.key] as string | undefined) ?? (current[spec.key] as string)) : "";
  const found = exists(guild, id, [spec.type, ...(spec.type === ChannelType.GuildText ? [ChannelType.GuildAnnouncement] : [])])
    ?? byWords(guild, [spec.name, ...(spec.aliases ?? [])], [spec.type]);
  if (found) {
    if (spec.key && found.id !== id) (plan.change as Record<string, unknown>)[spec.key] = found.id;
    return found;
  }
  const name = exactName ?? channelName(nameStyle(), spec.emoji, spec.type === ChannelType.GuildText ? spec.name.replace(/\s+/g, "-") : spec.name);
  const channel = await guild.channels.create({
    name, type: spec.type, parent: parent.id, reason: "/setup: สร้างห้องที่ขาด",
    permissionOverwrites: overwrites(guild, spec.audience, plan.change.memberRoleId ?? current.memberRoleId,
      plan.change.staffRoleIds ?? current.staffRoleIds, spec.type === ChannelType.GuildVoice),
  });
  if (spec.key) (plan.change as Record<string, unknown>)[spec.key] = channel.id;
  plan.created.push(`${spec.type === ChannelType.GuildVoice ? "ห้องเสียง" : "ห้อง"} ${name}`);
  return channel;
}

const text = ChannelType.GuildText as const;
const voice = ChannelType.GuildVoice as const;

/** Builds the roles, categories and channels. Returns the settings to save and what was made. */
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
  await buildRoles(guild, plan, problems);
  const memberRoleId = plan.change.memberRoleId ?? current.memberRoleId;
  if (memberRoleId && !assignable(guild, memberRoleId)) problems.push("ยศสมาชิกอยู่สูงกว่ายศของบอท ลากยศของบอทขึ้นไปไว้บนสุดในตั้งค่าเซิร์ฟ");

  if (current.statsEnabled) {
    await step("ห้องสถิติ", async () => {
      const category = await ensureCategory(guild, plan, "📊", "Stats", "สถิติเซิร์ฟ", "everyone", current.statsCategoryId);
      if (category.id !== current.statsCategoryId) plan.change.statsCategoryId = category.id;
      // Stats sit at the top of the channel list.
      if (plan.created.some((item) => item.includes(category.name))) await category.setPosition(0).catch(() => undefined);
      const counts = await guild.client.guilds.fetch({ guild: guild.id, withCounts: true, force: true }).catch(() => guild);
      const stat = (key: keyof Settings, words: string, name: string) =>
        ensureChannel(guild, plan, category, { key, emoji: "", name: words, type: voice, audience: "everyone-read" }, name);
      await stat("statsMembersChannelId", "สมาชิก", statsNames.members(counts.approximateMemberCount ?? guild.memberCount));
      await stat("statsOnlineChannelId", "ออนไลน์", statsNames.online(counts.approximatePresenceCount ?? 0));
      await stat("statsSiteChannelId", "เว็บ", statsNames.site(siteUp()));
    });
  }

  await step("หมวดเริ่มต้น", async () => {
    const hint = exists(guild, current.welcomeChannelId, [text]);
    const category = await ensureCategory(guild, plan, "📌", "Start", "เริ่มต้นที่นี่", "everyone", hint && "parentId" in hint ? hint.parentId ?? "" : "");
    if (current.welcomeEnabled) await ensureChannel(guild, plan, category, { key: "welcomeChannelId", emoji: "👋", name: "ยินดีต้อนรับ", type: text, audience: "everyone-read", aliases: ["welcome"] });
    if (current.verifyEnabled) await ensureChannel(guild, plan, category, { key: "verifyChannelId", emoji: "✅", name: "ยืนยันตัวตน", type: text, audience: "unverified", aliases: ["verify"] });
    await ensureChannel(guild, plan, category, { emoji: "📜", name: "กฎ", type: text, audience: "everyone-read", aliases: ["กฎเซิร์ฟ", "rules"] });
    await ensureChannel(guild, plan, category, { emoji: "📢", name: "ประกาศ", type: text, audience: "members-read", aliases: ["announcements", "news"] });
    await ensureChannel(guild, plan, category, { key: "rolesChannelId", emoji: "🎭", name: "เลือกยศ", type: text, audience: "members-read", aliases: ["roles"] });
    if (current.statusEnabled) await ensureChannel(guild, plan, category, { key: "statusChannelId", emoji: "📡", name: "สถานะระบบ", type: text, audience: "members-read", aliases: ["status"] });
  });

  await step("หมวดพูดคุย", async () => {
    const category = await ensureCategory(guild, plan, "💬", "Community", "พูดคุย", "members");
    await ensureChannel(guild, plan, category, { emoji: "💬", name: "แชททั่วไป", type: text, audience: "members", aliases: ["general", "แชท", "ทั่วไป"] });
    await ensureChannel(guild, plan, category, { emoji: "🖼️", name: "รูปภาพ", type: text, audience: "members", aliases: ["media", "รูป"] });
    await ensureChannel(guild, plan, category, { emoji: "🤖", name: "คำสั่งบอท", type: text, audience: "members", aliases: ["bot commands", "commands"] });
  });

  await step("หมวดห้องเสียง", async () => {
    const hub = exists(guild, current.tempHubChannelId, [voice]);
    const parent = hub && "parentId" in hub && hub.parentId ? hub.parentId : "";
    const category = await ensureCategory(guild, plan, "🔊", "Voice", "ห้องเสียง", "members", parent);
    if (current.tempVoiceEnabled) await ensureChannel(guild, plan, category, { key: "tempHubChannelId", emoji: "➕", name: "สร้างห้องเสียง", type: voice, audience: "members" });
    await ensureChannel(guild, plan, category, { emoji: "🛋️", name: "นั่งเล่น", type: voice, audience: "members", aliases: ["lounge", "general"] });
  });

  if (current.ticketsEnabled) {
    await step("หมวด Ticket", async () => {
      const category = await ensureCategory(guild, plan, "🎫", "Support", "ช่วยเหลือ", "members", current.ticketCategoryId);
      if (category.id !== current.ticketCategoryId) plan.change.ticketCategoryId = category.id;
      await ensureChannel(guild, plan, category, { key: "ticketChannelId", emoji: "🎫", name: "เปิด ticket", type: text, audience: "members-read" });
      await ensureChannel(guild, plan, category, { key: "ticketLogChannelId", emoji: "📝", name: "ticket log", type: text, audience: "staff" });
    });
  }

  await step("หมวดทีมงาน", async () => {
    const category = await ensureCategory(guild, plan, "🛡️", "Staff", "ทีมงาน", "staff");
    await ensureChannel(guild, plan, category, { emoji: "🛡️", name: "ห้องทีมงาน", type: text, audience: "staff", aliases: ["staff chat"] });
    if (current.securityEnabled) {
      await ensureChannel(guild, plan, category, { key: "securityChannelId", emoji: "🚨", name: "แจ้งเตือนความปลอดภัย", type: text, audience: "staff", aliases: ["security", "security log", "แจ้งเตือน"] });
    }
    await ensureChannel(guild, plan, category, { emoji: "⚙️", name: "ตั้งค่าบอท", type: text, audience: "staff", aliases: ["bot setup"] });
  });

  return { ...plan, problems };
}

/**
 * Renames every channel and category to the chosen style, keeping each one's emoji and words.
 * Channels the bot cannot manage are skipped; the stats channels get their numbers next update.
 */
export async function decorateAll(guild: Guild) {
  const style = nameStyle();
  let changed = 0;
  let failed = 0;
  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread()) continue;
    const name = restyle(style, channel.type, channel.name);
    if (!name || name === channel.name) continue;
    try {
      await channel.setName(name, "แต่งชื่อห้องด้วยอักษรพิเศษ");
      changed += 1;
    } catch (error) {
      logBotError("decorate channel", error);
      failed += 1;
    }
  }
  return { changed, failed };
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

// An empty server (no text channel at all, e.g. right after "delete everything") gets one room
// only admins see, with a button that opens the settings, so there is somewhere to type /setup.

let makingSetupRoom = false;

export async function ensureSetupChannel(guild: Guild, note?: string): Promise<TextChannel | null> {
  const textChannels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement);
  if ((textChannels.size > 0 && !note) || makingSetupRoom) return null;
  makingSetupRoom = true;
  try {
    const managers = (settings()?.managerRoleIds ?? []).filter((id) => guild.roles.cache.has(id));
    const existing = textChannels.find((channel) => key(channel.name) === "ตั้งค่าบอท") as TextChannel | undefined;
    const channel = existing ?? await guild.channels.create({
      name: channelName(nameStyle(), "⚙️", "ตั้งค่าบอท"),
      type: ChannelType.GuildText,
      reason: "เซิร์ฟยังไม่มีห้องพิมพ์ สร้างห้องไว้ตั้งค่าบอท",
      permissionOverwrites: [
        { id: guild.id, type: OverwriteType.Role, deny: [view] },
        { id: guild.client.user.id, type: OverwriteType.Member, allow: botAllow },
        ...managers.map((id) => ({ id, type: OverwriteType.Role, allow: [view, send] })),
      ],
    });
    const embed = new EmbedBuilder()
      .setColor(COLOR.brand)
      .setTitle(`${fancy("Setup", "bold")} ・ ตั้งค่าบอทดูแลเซิร์ฟ`)
      .setDescription([
        note ?? "เซิร์ฟนี้ยังไม่มีห้องพิมพ์ บอทเลยสร้างห้องนี้ไว้ให้ตั้งค่า (เห็นเฉพาะแอดมิน)",
        "",
        "กด **เปิดหน้าตั้งค่า** หรือพิมพ์ `/setup` แล้วกด **🛠️ สร้างที่ขาดให้** บอทจะสร้างยศ หมวด และห้องที่ต้องใช้ทั้งหมด",
      ].join("\n"));
    await channel.send({ embeds: [embed], components: [row(new ButtonBuilder().setCustomId("cm:setup:open").setStyle(ButtonStyle.Primary).setLabel("เปิดหน้าตั้งค่า").setEmoji("⚙️"))] });
    return channel;
  } catch (error) {
    logBotError("setup channel", error);
    return null;
  } finally {
    makingSetupRoom = false;
  }
}

// Delete everything: every channel and category (the server owner or an Administrator only).

export async function deleteAllChannels(guild: Guild) {
  // Rooms inside categories first, then the categories.
  const channels = [...guild.channels.cache.values()].filter((channel) => !channel.isThread())
    .sort((a, b) => Number(a.type === ChannelType.GuildCategory) - Number(b.type === ChannelType.GuildCategory));
  let deleted = 0;
  const failed: string[] = [];
  for (const channel of channels) {
    try {
      await channel.delete("ลบห้องและหมวดทั้งหมดผ่าน /setup");
      deleted += 1;
    } catch (error) {
      logBotError("delete channel", error);
      // A Community server's rules and updates rooms cannot be deleted while Community is on.
      failed.push(channel.name);
    }
  }
  return { deleted, failed };
}
