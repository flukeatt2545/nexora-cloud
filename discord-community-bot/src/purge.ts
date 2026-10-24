import { randomBytes } from "crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
} from "discord.js";
import { isManager } from "./access";
import { logBotError } from "./api";
import { botPlaceChannelIds } from "./legacy/voice/places";
import { announceCleanup } from "./security";
import { panels, settings } from "./settings";
import { mayWipe } from "./setup";
import { ticketByChannel } from "./tickets";
import { COLOR, errorEmbed, okEmbed } from "./ui";

const ephemeral = MessageFlags.Ephemeral as const;

// /clear (/ลบข้อความ): delete messages in this room, a chosen room, or every text room. A number
// deletes that many of the newest messages at once; without one it asks first and deletes them all.
// Pinned messages and the bot's own panels are kept. Rooms that hold the bot's logs, tickets and
// panels are skipped when clearing every room, so the records stay.

type Job = {
  userId: string;
  everywhere: boolean;
  channelId: string;
  count: number;
  from: string;
  at: number;
};

const pending = new Map<string, Job>();
const CONFIRM_MS = 5 * 60 * 1000;
// Discord only bulk-deletes messages younger than 14 days; older ones go one by one (slow).
const BULK_MAX_AGE_MS = 14 * 24 * 3600 * 1000 - 10 * 60 * 1000;
// An interaction can be answered for 15 minutes, so a long clean-up stops before that and says so.
const RUN_LIMIT_MS = 12 * 60 * 1000;
let running = false;

setInterval(() => {
  const cutoff = Date.now() - CONFIRM_MS;
  for (const [token, job] of pending) if (job.at < cutoff) pending.delete(token);
}, 60000).unref();

function mayClear(member: GuildMember, channel: GuildTextBasedChannel) {
  return isManager(member) || Boolean(channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageMessages));
}

function botCanClear(channel: GuildTextBasedChannel) {
  const me = channel.guild.members.me;
  return Boolean(me && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]));
}

/** Why a room is left alone when clearing every room ("" = it is cleared). */
function exemptReason(channel: GuildTextBasedChannel) {
  const current = settings();
  const logs = [current?.securityChannelId, current?.securitySiteChannelId, current?.ticketLogChannelId].filter(Boolean);
  if (logs.includes(channel.id) || botPlaceChannelIds().includes(channel.id)) return "ห้องบันทึก (log) และแผงของบอท";
  if (ticketByChannel(channel.id) || (current?.ticketCategoryId && channel.parentId === current.ticketCategoryId)) return "ห้อง Ticket";
  return "";
}

/** Every text and announcement room in the server. */
function allRooms(guild: Guild) {
  return [...guild.channels.cache.values()]
    .filter((channel): channel is GuildTextBasedChannel & { type: ChannelType.GuildText | ChannelType.GuildAnnouncement } =>
      channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
    .sort((a, b) => a.rawPosition - b.rawPosition);
}

function panelMessageIds() {
  const all = panels();
  return new Set(Object.values(all).map((panel) => panel.messageId).filter(Boolean));
}

type Progress = { deleted: number; room: string };

/** Deletes in one room, newest first. Returns how many went and whether the time ran out. */
async function clearRoom(channel: GuildTextBasedChannel, job: Job, skip: Set<string>, deadline: number, progress: () => void) {
  let deleted = 0;
  let before: string | undefined;
  const limit = job.count || Number.MAX_SAFE_INTEGER;
  while (deleted < limit) {
    if (Date.now() > deadline) return { deleted, timedOut: true };
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    before = batch.last()!.id;
    const now = Date.now();
    const targets = [...batch.values()]
      .filter((message) => !message.pinned && !skip.has(message.id) && message.deletable && (!job.from || message.author.id === job.from))
      .slice(0, limit - deleted);
    const recent = targets.filter((message) => now - message.createdTimestamp < BULK_MAX_AGE_MS);
    if (recent.length) {
      const gone = await channel.bulkDelete(recent, true);
      deleted += gone.size;
      progress();
    }
    for (const message of targets.filter((item) => !recent.includes(item))) {
      if (Date.now() > deadline) return { deleted, timedOut: true };
      if (await message.delete().then(() => true, () => false)) {
        deleted += 1;
        progress();
      }
    }
    if (batch.size < 100) break;
  }
  return { deleted, timedOut: false };
}

function scopeText(job: Job, where: string) {
  const who = job.from ? ` ของ <@${job.from}>` : "";
  const how = job.count ? `${job.count} ข้อความล่าสุด` : "ทุกข้อความ";
  return `${how}${who} ${where}`;
}

/** What is being deleted, where and whose, as three short columns. */
function scopeFields(job: Job) {
  return [
    { name: "ลบ", value: job.count ? `${job.count} ข้อความล่าสุด` : "ทุกข้อความ", inline: true },
    { name: "ในห้อง", value: job.everywhere ? "ทุกห้องข้อความ" : `<#${job.channelId}>`, inline: true },
    { name: "ของใคร", value: job.from ? `<@${job.from}>` : "ทุกคน", inline: true },
  ];
}

/** Room mentions on one line, cut off after a few so a field stays under Discord's limit. */
function mentions(ids: string[], max = 15) {
  const shown = ids.slice(0, max).map((id) => `<#${id}>`).join(" ");
  return ids.length > max ? `${shown} และอีก ${ids.length - max} ห้อง` : shown;
}

function workingEmbed(text: string) {
  return new EmbedBuilder().setColor(COLOR.warn).setTitle("🧹 กำลังลบข้อความ").setDescription(text);
}

async function run(interaction: ChatInputCommandInteraction | ButtonInteraction, job: Job) {
  const guild = interaction.guild!;
  const member = interaction.member as GuildMember;
  const skip = panelMessageIds();
  const rooms: GuildTextBasedChannel[] = [];
  const skipped: { id: string; reason: string }[] = [];
  if (job.everywhere) {
    for (const channel of allRooms(guild)) {
      const reason = exemptReason(channel);
      if (reason) skipped.push({ id: channel.id, reason });
      else if (!botCanClear(channel)) skipped.push({ id: channel.id, reason: "บอทไม่มีสิทธิ์ลบ" });
      else rooms.push(channel);
    }
  } else {
    const channel = await interaction.client.channels.fetch(job.channelId).catch(() => null);
    if (!channel || channel.isDMBased() || !channel.isTextBased() || !("bulkDelete" in channel)) {
      await interaction.editReply({ embeds: [errorEmbed("ไม่เจอห้องนี้", "ห้องอาจถูกลบไปแล้ว")], components: [] });
      return;
    }
    rooms.push(channel as GuildTextBasedChannel);
  }
  running = true;
  const where = job.everywhere ? "ทุกห้องข้อความ" : `ใน <#${job.channelId}>`;
  const deadline = Date.now() + RUN_LIMIT_MS;
  const results: { id: string; deleted: number }[] = [];
  const state: Progress = { deleted: 0, room: "" };
  let lastEdit = 0;
  const show = () => {
    if (Date.now() - lastEdit < 3000) return;
    lastEdit = Date.now();
    void interaction.editReply({ embeds: [workingEmbed(`ลบไปแล้ว **${state.deleted}** ข้อความ${state.room ? `\nตอนนี้อยู่ที่ <#${state.room}>` : ""}`)], components: [] }).catch(() => undefined);
  };
  let timedOut = false;
  let failed = "";
  try {
    for (const room of rooms) {
      state.room = room.id;
      let done = 0;
      try {
        const result = await clearRoom(room, job, skip, deadline, () => {
          state.deleted = results.reduce((sum, item) => sum + item.deleted, 0) + done;
          show();
        });
        done = result.deleted;
        timedOut = result.timedOut;
      } catch (error) {
        logBotError("clear room", error);
        failed = `<#${room.id}>`;
      }
      results.push({ id: room.id, deleted: done });
      state.deleted = results.reduce((sum, item) => sum + item.deleted, 0);
      if (timedOut) break;
    }
  } finally {
    running = false;
  }
  const total = results.reduce((sum, item) => sum + item.deleted, 0);
  const deletedIn = results.filter((item) => item.deleted > 0);
  const embed = new EmbedBuilder()
    .setColor(total ? COLOR.ok : COLOR.warn)
    .setTitle(total ? `🧹 ลบแล้ว ${total} ข้อความ` : "🧹 ไม่มีข้อความให้ลบ")
    .addFields(scopeFields(job))
    .setFooter({ text: "ข้ามข้อความที่ปักหมุดและแผงของบอท" });
  // The per-room list only helps when more than one room was touched.
  if (deletedIn.length > 1) embed.addFields({ name: "ห้องที่ลบ", value: deletedIn.slice(0, 20).map((item) => `<#${item.id}> · **${item.deleted}**`).join("\n") });
  const reasons = new Map<string, string[]>();
  for (const item of skipped) reasons.set(item.reason, [...(reasons.get(item.reason) ?? []), item.id]);
  for (const [reason, ids] of reasons) embed.addFields({ name: `ข้ามห้อง · ${reason}`, value: mentions(ids) });
  const warnings = [
    ...(timedOut ? ["หยุดก่อนเพราะใช้เวลานานเกินไป สั่งซ้ำได้เพื่อลบส่วนที่เหลือ"] : []),
    ...(failed ? [`ลบใน ${failed} ไม่สำเร็จ (บอทอาจไม่มีสิทธิ์)`] : []),
  ];
  if (warnings.length) embed.addFields({ name: "⚠️ หมายเหตุ", value: warnings.join("\n") });
  await interaction.editReply({ embeds: [embed], components: [], allowedMentions: { parse: [] } }).catch(() => undefined);
  if (total > 0) await announceCleanup(guild, member, scopeText(job, where), total).catch(() => undefined);
}

function confirmPayload(token: string, job: Job) {
  const embed = new EmbedBuilder().setColor(COLOR.danger).setTitle("🧹 ยืนยันลบข้อความ").addFields(scopeFields(job)).setDescription([
    "ลบแล้วกู้คืนไม่ได้",
    "• ข้ามข้อความที่ปักหมุดและแผงของบอท",
    ...(job.everywhere ? ["• ข้ามห้องบันทึก (log) และห้อง Ticket"] : []),
    "• ข้อความเก่ากว่า 14 วันต้องลบทีละข้อความ อาจใช้เวลานาน",
  ].join("\n"));
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`cm:purge:go:${token}`).setLabel("ลบเลย").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cm:purge:no:${token}`).setLabel("ยกเลิก").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [buttons], allowedMentions: { parse: [] as never[] } };
}

export async function onPurgeCommand(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember;
  const guild = interaction.guild!;
  const everywhere = interaction.options.getString("scope") === "all";
  const count = interaction.options.getInteger("count") ?? 0;
  const from = interaction.options.getUser("member")?.id ?? "";
  const picked = interaction.options.getChannel("room");
  const reject = (title: string, text: string) => interaction.reply({ embeds: [errorEmbed(title, text)], flags: ephemeral });
  if (running) return void (await reject("กำลังลบอยู่", "รอให้รอบที่แล้วเสร็จก่อน"));
  if (everywhere && (picked || count)) return void (await reject("เลือกซ้อนกัน", "ขอบเขต \"ทุกห้อง\" ใช้ร่วมกับ \"ห้อง\" หรือ \"จำนวน\" ไม่ได้ (จะลบทุกข้อความในทุกห้อง) เลือกอย่างใดอย่างหนึ่ง"));
  if (everywhere) {
    // Clearing the whole server is the owner's and Administrators' call, like wiping channels.
    if (!mayWipe(member)) return void (await reject("ใช้ไม่ได้", "ลบข้อความทุกห้องได้เฉพาะเจ้าของเซิร์ฟและคนที่มีสิทธิ์ Administrator"));
    const job: Job = { userId: interaction.user.id, everywhere: true, channelId: "", count: 0, from, at: Date.now() };
    const token = randomBytes(6).toString("hex");
    pending.set(token, job);
    await interaction.reply({ ...confirmPayload(token, job), flags: ephemeral });
    return;
  }
  const channel = picked ? await interaction.client.channels.fetch(picked.id).catch(() => null) : interaction.channel;
  if (!channel || channel.isDMBased() || !channel.isTextBased() || !("bulkDelete" in channel) || channel.guildId !== guild.id) {
    return void (await reject("ลบในห้องนี้ไม่ได้", "เลือกห้องข้อความ ห้องประกาศ หรือห้องแชทของห้องเสียง"));
  }
  const room = channel as GuildTextBasedChannel;
  if (!mayClear(member, room)) return void (await reject("ใช้ไม่ได้", "ต้องมีสิทธิ์ \"จัดการข้อความ\" ในห้องนี้"));
  if (!botCanClear(room)) return void (await reject("บอทลบไม่ได้", "บอทต้องมีสิทธิ์ ดูห้อง, อ่านประวัติข้อความ และจัดการข้อความ ในห้องนี้"));
  const job: Job = { userId: interaction.user.id, everywhere: false, channelId: room.id, count, from, at: Date.now() };
  if (count) {
    // A set number is deleted straight away; "all" always asks first.
    await interaction.deferReply({ flags: ephemeral });
    await run(interaction, job);
    return;
  }
  const token = randomBytes(6).toString("hex");
  pending.set(token, job);
  await interaction.reply({ ...confirmPayload(token, job), flags: ephemeral });
}

export async function onPurgeButton(interaction: ButtonInteraction) {
  const [, , action, token] = interaction.customId.split(":");
  const job = pending.get(token);
  if (!job || job.userId !== interaction.user.id) {
    await interaction.reply({ embeds: [errorEmbed("หมดอายุแล้ว", "สั่ง /ลบข้อความ ใหม่อีกครั้ง")], flags: ephemeral });
    return;
  }
  pending.delete(token);
  if (action === "no") {
    await interaction.update({ embeds: [okEmbed("ยกเลิกแล้ว", "ยังไม่ได้ลบอะไร")], components: [] });
    return;
  }
  const member = interaction.member as GuildMember;
  if (running) {
    await interaction.update({ embeds: [errorEmbed("กำลังลบอยู่", "รอให้รอบที่แล้วเสร็จก่อน")], components: [] });
    return;
  }
  // Rights are checked again: roles can change between the command and the button.
  const room = job.everywhere ? null : await interaction.client.channels.fetch(job.channelId).catch(() => null);
  const allowed = job.everywhere ? mayWipe(member) : Boolean(room && !room.isDMBased() && "bulkDelete" in room && mayClear(member, room as GuildTextBasedChannel));
  if (!allowed) {
    await interaction.update({ embeds: [errorEmbed("ใช้ไม่ได้", "สิทธิ์ของคุณเปลี่ยนไปแล้ว")], components: [] });
    return;
  }
  await interaction.update({ embeds: [workingEmbed("เริ่มแล้ว…")], components: [] });
  await run(interaction, job);
}
