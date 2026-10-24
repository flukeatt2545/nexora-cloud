import type { Guild, GuildBasedChannel } from "discord.js";
import { isBotAdmin } from "./config";
import { settings } from "./settings";
import { isTempRoom } from "./tempvoice";
import { ticketByChannel } from "./tickets";

// Who may delete channels and roles without the anti-nuke stepping in, and which channels come
// and go on their own. The anti-nuke counting (security.ts) and the putting-back of deleted
// channels (the voice-room module's places.ts) both ask here, so they agree.

/** The server owner, the bot, the bot's admins, and whoever is on the trusted list (web page or /protect). */
export async function isTrusted(guild: Guild, userId: string) {
  if (userId === guild.ownerId || userId === guild.client.user.id || isBotAdmin(userId)) return true;
  const current = settings();
  if (current?.nukeTrustedUserIds?.includes(userId)) return true;
  const roles = current?.nukeTrustedRoleIds ?? [];
  if (!roles.length) return false;
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
  return Boolean(member && roles.some((id) => member.roles.cache.has(id)));
}

// Rooms the bot makes and removes by itself (voice rooms, join-to-create rooms, tickets): deleting
// one is not "destroying the server" and nothing puts it back. Remembered for a couple of minutes,
// because the audit log entry for the delete can arrive after the room's own bookkeeping ran.
const throwaway = new Map<string, number>();
const KEEP_MS = 2 * 60000;

/** Call first when a channel is deleted; ownRoom: it was one of the voice-room module's rooms. */
export function noteChannelDeleted(channel: { id: string; parentId?: string | null }, ownRoom: boolean) {
  const ticketCategory = settings()?.ticketCategoryId;
  const temporary = ownRoom || isTempRoom(channel.id) || Boolean(ticketByChannel(channel.id)) || Boolean(ticketCategory && channel.parentId === ticketCategory);
  const now = Date.now();
  for (const [id, until] of throwaway) if (until < now) throwaway.delete(id);
  if (temporary) throwaway.set(channel.id, now + KEEP_MS);
}

export function wasThrowaway(channelId: string) {
  return (throwaway.get(channelId) ?? 0) > Date.now();
}

// A deleted channel was made again (by the voice-room module): whoever listens can move what
// pointed at the old one (settings, panels) to the new one.
type Restored = (oldId: string, oldName: string, made: GuildBasedChannel, deleterId: string) => unknown;
let listener: Restored | null = null;

export function onChannelRestored(handler: Restored) {
  listener = handler;
}

export function channelRestored(oldId: string, oldName: string, made: GuildBasedChannel, deleterId: string) {
  if (!listener) return;
  Promise.resolve(listener(oldId, oldName, made, deleterId)).catch((error) => console.error("[ERROR] channel restored:", error));
}
