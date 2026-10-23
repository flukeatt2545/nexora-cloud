import { PermissionFlagsBits, type Guild, type GuildMember } from "discord.js";
import { isBotAdmin } from "./config";
import { settings } from "./settings";

function hasAny(member: GuildMember, roleIds: string[]) {
  return roleIds.some((id) => member.roles.cache.has(id));
}

/** Server admins: Manage Server, or listed in COMMUNITY_DISCORD_ADMIN_IDS. */
export function isAdmin(member: GuildMember) {
  return isBotAdmin(member.id) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

/** May run /setup and /create. */
export function isManager(member: GuildMember) {
  return isAdmin(member) || hasAny(member, settings()?.managerRoleIds ?? []);
}

/** Handles tickets: sees every ticket, claims, closes and adds people. */
export function isStaff(member: GuildMember) {
  const current = settings();
  return isManager(member) || hasAny(member, current?.staffRoleIds ?? []);
}

/** May open tickets and make voice rooms. No roles set = every member. */
export function canUse(member: GuildMember) {
  const roles = settings()?.usageRoleIds ?? [];
  return roles.length === 0 || hasAny(member, roles) || isStaff(member);
}

/** The roles the bot can give: below its own highest role, and not run by Discord or another bot. */
export function assignable(guild: Guild, roleId: string) {
  const role = guild.roles.cache.get(roleId);
  const me = guild.members.me;
  return Boolean(role && me && !role.managed && role.id !== guild.id && role.position < me.roles.highest.position);
}
