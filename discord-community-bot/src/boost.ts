import { AttachmentBuilder, EmbedBuilder, type Client, type Guild, type GuildMember, type PartialGuildMember } from "discord.js";
import { logBotError } from "./api";
import { homeGuild } from "./guild";
import { boostCard } from "./image";
import { postPanel, removePanel, textChannel } from "./panels";
import { settings } from "./settings";
import { when } from "./ui";

// The boost room: one message with the server's boost level, a progress bar to the next level,
// what each level unlocks, the perks boosters get here and who boosts. Refreshed every 10
// minutes and when a boost starts or the level changes. The lounge is a chat for boosters.

const LEVELS = [
  { level: 1, boosts: 2, perks: "อีโมจิ 100 ช่อง · สติกเกอร์ 15 อัน · เสียง 128 kbps · ไอคอนเซิร์ฟเคลื่อนไหว" },
  { level: 2, boosts: 7, perks: "อีโมจิ 150 ช่อง · สติกเกอร์ 30 อัน · เสียง 256 kbps · แบนเนอร์เซิร์ฟ · ไอคอนยศ · อัปโหลด 50 MB" },
  { level: 3, boosts: 14, perks: "อีโมจิ 250 ช่อง · สติกเกอร์ 60 อัน · เสียง 384 kbps · ลิงก์เชิญเฉพาะ · แบนเนอร์เคลื่อนไหว · อัปโหลด 100 MB" },
];

const BAR_CELLS = 14;
const MAX_LISTED = 15;

async function boosters(guild: Guild) {
  // Everyone is in the cache after one fetch; the member events keep it fresh from then on.
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => undefined);
  return [...guild.members.cache.values()].filter((member) => member.premiumSince)
    .sort((a, b) => a.premiumSinceTimestamp! - b.premiumSinceTimestamp!);
}

function bar(boosts: number) {
  const filled = Math.min(BAR_CELLS, Math.round((boosts / LEVELS[LEVELS.length - 1].boosts) * BAR_CELLS));
  return `${"▰".repeat(filled)}${"▱".repeat(BAR_CELLS - filled)}`;
}

/** Only boosters (and staff) see the lounge; Discord makes the booster role at the first boost. */
async function openLounge(guild: Guild) {
  const lounge = settings()?.boostLoungeChannelId;
  const channel = lounge ? guild.channels.cache.get(lounge) : undefined;
  const role = guild.roles.premiumSubscriberRole;
  if (!channel || !("permissionOverwrites" in channel) || !role || channel.permissionOverwrites.cache.has(role.id)) return;
  await channel.permissionOverwrites.create(role, { ViewChannel: true, SendMessages: true }, { reason: "ห้องบูสเตอร์: ให้ยศ Server Booster เห็นห้อง" })
    .catch((error) => logBotError("lounge permissions", error));
}

export async function refreshBoost(client: Client, repost = false) {
  const guild = homeGuild(client);
  const current = settings();
  if (!guild) return;
  if (!current?.boostEnabled || !current.boostChannelId) {
    await removePanel(guild, "boost").catch(() => undefined);
    return;
  }
  await openLounge(guild);
  const list = await boosters(guild);
  const count = guild.premiumSubscriptionCount ?? list.length;
  const level = guild.premiumTier as number;
  const picture = await boostCard({ server: guild.name, level, boosts: count });
  const levels = LEVELS.map((item) => `${level >= item.level ? "✅" : "🔒"} **เลเวล ${item.level}** (${item.boosts} บูสต์) · ${item.perks}`).join("\n");
  const names = list.slice(0, MAX_LISTED).map((member) => `• ${member} · ตั้งแต่ ${when(member.premiumSince!, "D")}`).join("\n");
  const lounge = current.boostLoungeChannelId ? `\nห้องของบูสเตอร์: <#${current.boostLoungeChannelId}>` : "";
  const embed = new EmbedBuilder()
    .setColor(0xf47fff)
    .setTitle("บูสต์เซิร์ฟเวอร์")
    .setImage("attachment://boost.png")
    .setDescription(`\`${bar(count)}\` **${count}** / ${LEVELS[LEVELS.length - 1].boosts} บูสต์`)
    .addFields(
      { name: "สิทธิประโยชน์ของบูสเตอร์", value: `${current.boostPerks}${lounge}`.slice(0, 1024) },
      { name: "สิ่งที่เซิร์ฟได้ในแต่ละเลเวล", value: levels.slice(0, 1024) },
      { name: `บูสเตอร์ (${list.length})`, value: (names || "_ยังไม่มีใครบูสต์ เป็นคนแรกเลย!_") + (list.length > MAX_LISTED ? `\n…และอีก ${list.length - MAX_LISTED} คน` : "") },
    )
    .setFooter({ text: "อัปเดตอัตโนมัติ" })
    .setTimestamp();
  await postPanel(guild, "boost", current.boostChannelId, { embeds: [embed], files: [new AttachmentBuilder(picture, { name: "boost.png" })] }, repost);
}

/** A member starts boosting: thank them in the boost room, then refresh the panel. */
export async function onMemberUpdate(before: GuildMember | PartialGuildMember, after: GuildMember) {
  const current = settings();
  if (!current?.boostEnabled || Boolean(before.premiumSince) === Boolean(after.premiumSince)) return;
  const client = after.client;
  if (after.premiumSince) {
    const channel = textChannel(after.guild, current.boostChannelId);
    await channel?.send({ content: `ขอบคุณ ${after} ที่บูสต์เซิร์ฟ 💖 ตอนนี้เซิร์ฟมี ${after.guild.premiumSubscriptionCount ?? "?"} บูสต์`, allowedMentions: { users: [after.id] } })
      .catch((error) => logBotError("boost thanks", error));
  }
  await refreshBoost(client).catch((error) => logBotError("boost panel", error));
}

export function startBoost(client: Client) {
  void refreshBoost(client).catch((error) => logBotError("boost panel", error));
  setInterval(() => void refreshBoost(client).catch((error) => logBotError("boost panel", error)), 10 * 60 * 1000).unref();
}
