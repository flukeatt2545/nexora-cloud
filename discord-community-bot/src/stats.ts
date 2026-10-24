import type { Client, GuildBasedChannel } from "discord.js";
import { logBotError } from "./api";
import { homeGuild } from "./guild";
import { nameStyle, settings } from "./settings";
import { channelName } from "./style";
import { siteUp } from "./status";

// Voice channels whose names show the member count, how many are online, and whether the
// website is up. Discord lets a bot rename a channel only twice per 10 minutes, so names are
// checked every 5 minutes and changed only when the number did.

const renames = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;

function mayRename(channelId: string) {
  const recent = (renames.get(channelId) ?? []).filter((at) => Date.now() - at < WINDOW_MS);
  renames.set(channelId, recent);
  return recent.length < 2;
}

async function rename(channel: GuildBasedChannel | undefined, name: string) {
  if (!channel || channel.name === name || !mayRename(channel.id)) return;
  renames.get(channel.id)!.push(Date.now());
  await channel.setName(name, "อัปเดตห้องสถิติ").catch((error) => logBotError("rename stats", error));
}

export const statsNames = {
  members: (count: number) => channelName(nameStyle(), `สมาชิก: ${count.toLocaleString("th-TH")}`, "👥"),
  online: (count: number) => channelName(nameStyle(), `ออนไลน์: ${count.toLocaleString("th-TH")}`, "🟢"),
  site: (up: boolean) => (up ? channelName(nameStyle(), "เว็บ: ใช้งานได้", "🌐") : channelName(nameStyle(), "เว็บ: ล่ม", "🔴")),
};

export async function updateStats(client: Client) {
  const current = settings();
  const guild = homeGuild(client);
  if (!current?.statsEnabled || !guild) return;
  // Fetching the server again gives Discord's own member and online counts (no extra intent).
  const counted = await client.guilds.fetch({ guild: guild.id, withCounts: true, force: true }).catch(() => guild);
  const members = counted.approximateMemberCount ?? guild.memberCount;
  const online = counted.approximatePresenceCount ?? 0;
  const channel = (id: string) => (id ? guild.channels.cache.get(id) : undefined);
  await rename(channel(current.statsMembersChannelId), statsNames.members(members));
  await rename(channel(current.statsOnlineChannelId), statsNames.online(online));
  await rename(channel(current.statsSiteChannelId), statsNames.site(siteUp()));
}

export function startStats(client: Client) {
  void updateStats(client);
  setInterval(() => void updateStats(client), 5 * 60 * 1000).unref();
}
