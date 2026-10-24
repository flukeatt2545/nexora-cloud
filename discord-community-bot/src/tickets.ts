import {
  AttachmentBuilder,
  ChannelType,
  cleanContent,
  EmbedBuilder,
  MessageFlags,
  MessageType,
  OverwriteType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type ModalSubmitInteraction,
  type OverwriteResolvable,
  type TextChannel,
} from "discord.js";
import { canUse, isStaff } from "./access";
import { api, apiMessage, apiStatus, logBotError } from "./api";
import { homeGuild } from "./guild";
import { settings } from "./settings";
import { closeModal, COLOR, errorEmbed, idFrom, linkButton, minutesText, okEmbed, row, channelUrl, ticketHeader, ticketModal, when } from "./ui";

const ephemeral = MessageFlags.Ephemeral as const;

// Tickets: a private room per question, seen by the member who opened it and the staff roles.
// Closing one sends its transcript to the log room (and to the member), then deletes the room.

export type Ticket = {
  id: number;
  guildId: string;
  channelId: string;
  openerId: string;
  openerName: string;
  subject: string;
  status: "open" | "closed";
  claimedById: string;
  claimedByName: string;
  createdAt: string;
};

const open = new Map<string, Ticket>();
const closing = new Set<number>();

export function ticketByChannel(channelId: string) {
  return open.get(channelId);
}

/** After a restart: forget tickets whose room is gone. */
export async function syncTickets(client: Client) {
  const guild = homeGuild(client);
  if (!guild) return;
  try {
    const res = await api().get<{ tickets: Ticket[] }>("/api/internal/bot/community/tickets/open");
    open.clear();
    for (const ticket of res.data.tickets) {
      if (ticket.guildId !== guild.id || !ticket.channelId) continue;
      if (guild.channels.cache.has(ticket.channelId)) open.set(ticket.channelId, ticket);
      else await closeRecord(ticket.id, "", "", "ห้อง Ticket หายไป", 0);
    }
  } catch (error) {
    logBotError("sync tickets", error);
  }
}

async function closeRecord(id: number, byId: string, byName: string, reason: string, messageCount: number) {
  await api().post(`/api/internal/bot/community/tickets/${id}/close`, { closedById: byId, closedByName: byName, reason, messageCount })
    .catch((error) => { if (apiStatus(error) !== 404) logBotError("close ticket", error); });
}

const memberAllow = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks,
];

function ticketOverwrites(guild: Guild, openerId: string): OverwriteResolvable[] {
  const staff = settings()?.staffRoleIds ?? [];
  return [
    { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.client.user.id, type: OverwriteType.Member, allow: [...memberAllow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    { id: openerId, type: OverwriteType.Member, allow: memberAllow },
    ...staff.filter((id) => guild.roles.cache.has(id)).map((id) => ({ id, type: OverwriteType.Role, allow: [...memberAllow, PermissionFlagsBits.ManageMessages] })),
  ];
}

export async function onTicketButton(interaction: ButtonInteraction) {
  const current = settings();
  const member = interaction.member as GuildMember;
  if (!current?.ticketsEnabled || !current.ticketCategoryId) {
    await interaction.reply({ embeds: [errorEmbed("ยังเปิด Ticket ไม่ได้", "แอดมินยังไม่ได้ตั้งค่า Ticket")], flags: ephemeral });
    return;
  }
  if (!canUse(member)) {
    await interaction.reply({ embeds: [errorEmbed("ยังเปิด Ticket ไม่ได้", "Ticket เปิดได้เฉพาะคนที่มียศที่แอดมินกำหนด")], flags: ephemeral });
    return;
  }
  await interaction.showModal(ticketModal());
}

export async function onTicketCreate(interaction: ModalSubmitInteraction) {
  const guild = interaction.guild!;
  const current = settings();
  const member = interaction.member as GuildMember;
  await interaction.deferReply({ flags: ephemeral });
  const category = current?.ticketCategoryId ? guild.channels.cache.get(current.ticketCategoryId) : undefined;
  if (!current?.ticketsEnabled || category?.type !== ChannelType.GuildCategory) {
    await interaction.editReply({ embeds: [errorEmbed("เปิด Ticket ไม่ได้", "ไม่พบหมวดที่จะสร้างห้อง Ticket ลองบอกแอดมินดูนะ")] });
    return;
  }
  const subject = interaction.fields.getTextInputValue("subject").trim();
  const detail = interaction.fields.getTextInputValue("detail").trim();
  let ticket: Ticket;
  try {
    const res = await api(interaction.user).post<Ticket>("/api/internal/bot/community/tickets", {
      guildId: guild.id, openerId: member.id, openerName: interaction.user.username, subject,
    });
    ticket = res.data;
  } catch (error) {
    logBotError("open ticket", error);
    await interaction.editReply({ embeds: [errorEmbed("เปิด Ticket ไม่ได้", apiMessage(error, "ลองใหม่อีกครั้ง"))] });
    return;
  }
  let channel: TextChannel;
  try {
    channel = await guild.channels.create({
      name: `ticket-${String(ticket.id).padStart(4, "0")}`,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Ticket #${ticket.id} · ${ticket.subject} · เปิดโดย ${interaction.user.username}`,
      permissionOverwrites: ticketOverwrites(guild, member.id),
      reason: `Ticket #${ticket.id}`,
    });
    const res = await api(interaction.user).put<Ticket>(`/api/internal/bot/community/tickets/${ticket.id}/channel`, { channelId: channel.id });
    ticket = res.data;
  } catch (error) {
    logBotError("ticket channel", error);
    await closeRecord(ticket.id, "", "", "สร้างห้องไม่สำเร็จ", 0);
    await interaction.editReply({ embeds: [errorEmbed("เปิด Ticket ไม่ได้", "บอทยังไม่มีสิทธิ์สร้างห้อง ลองบอกแอดมินดูนะ")] });
    return;
  }
  open.set(channel.id, ticket);
  const staff = (current.staffRoleIds ?? []).filter((id) => guild.roles.cache.has(id));
  await channel.send({
    content: [`<@${member.id}>`, ...staff.map((id) => `<@&${id}>`)].join(" "),
    ...ticketHeader(ticket, detail, member.displayAvatarURL({ size: 128 })),
    allowedMentions: { users: [member.id], roles: staff },
  }).catch((error) => logBotError("ticket header", error));
  await interaction.editReply({
    embeds: [okEmbed(`เปิด Ticket #${ticket.id} แล้ว`, "ไปคุยกับทีมงานในห้องของคุณได้เลย")],
    components: [row(linkButton(channelUrl(guild.id, channel.id), "ไปที่ห้อง Ticket"))],
  });
}

function ticketFor(interaction: ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction, id?: number) {
  const ticket = interaction.channelId ? open.get(interaction.channelId) : undefined;
  return ticket && (!id || ticket.id === id) ? ticket : undefined;
}

export async function onTicketClaim(interaction: ButtonInteraction) {
  const ticket = ticketFor(interaction, idFrom(interaction.customId));
  const member = interaction.member as GuildMember;
  if (!ticket) {
    await interaction.reply({ embeds: [errorEmbed("ไม่พบ Ticket นี้", "อาจถูกปิดไปแล้ว")], flags: ephemeral });
    return;
  }
  if (!isStaff(member)) {
    await interaction.reply({ embeds: [errorEmbed("รับเรื่องไม่ได้", "ปุ่มนี้สำหรับทีมงาน")], flags: ephemeral });
    return;
  }
  try {
    const res = await api(interaction.user).post<Ticket>(`/api/internal/bot/community/tickets/${ticket.id}/claim`, {
      staffId: member.id, staffName: interaction.user.username,
    });
    open.set(ticket.channelId, res.data);
    const first = interaction.message.embeds[0];
    // The header quotes the member's words (every line starts with "> "); put them back as they were.
    const detail = (first?.description ?? "").split("\n").map((line) => line.replace(/^> ?/, "")).join("\n");
    await interaction.update(ticketHeader(res.data, detail, first?.thumbnail?.url));
    await (interaction.channel as TextChannel).send({ embeds: [okEmbed("รับเรื่องแล้ว", `<@${member.id}> กำลังดูเรื่องนี้ให้`)] });
  } catch (error) {
    logBotError("claim ticket", error);
    await interaction.reply({ embeds: [errorEmbed("รับเรื่องไม่ได้", apiMessage(error, "ลองใหม่อีกครั้ง"))], flags: ephemeral });
  }
}

function mayClose(member: GuildMember, ticket: Ticket) {
  return member.id === ticket.openerId || isStaff(member);
}

export async function onTicketCloseButton(interaction: ButtonInteraction) {
  const ticket = ticketFor(interaction, idFrom(interaction.customId));
  if (!ticket || !mayClose(interaction.member as GuildMember, ticket)) {
    await interaction.reply({ embeds: [errorEmbed("ปิดไม่ได้", ticket ? "ปิดได้เฉพาะคนเปิดและทีมงาน" : "ไม่พบ Ticket นี้")], flags: ephemeral });
    return;
  }
  await interaction.showModal(closeModal(ticket.id));
}

export async function onTicketCloseSubmit(interaction: ModalSubmitInteraction) {
  const ticket = ticketFor(interaction, idFrom(interaction.customId));
  if (!ticket || !mayClose(interaction.member as GuildMember, ticket)) {
    await interaction.reply({ embeds: [errorEmbed("ปิดไม่ได้", "ไม่พบ Ticket นี้")], flags: ephemeral });
    return;
  }
  await interaction.deferReply();
  await closeTicket(interaction.guild!, ticket, interaction.member as GuildMember, interaction.fields.getTextInputValue("reason").trim());
  await interaction.editReply({ embeds: [okEmbed("ปิด Ticket แล้ว", "ห้องนี้จะถูกลบใน 5 วินาที")] }).catch(() => undefined);
}

const stamp = (date: Date) => date.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "medium" });

/** What a message says as plain text: mentions turned into names, embeds and files included. */
function messageText(message: Message, names: Map<string, string>) {
  const parts = [
    cleanContent(message.content, message.channel),
    ...message.embeds.map((embed) => cleanContent([embed.title, embed.description, ...embed.fields.map((field) => `${field.name}: ${field.value}`)].filter(Boolean).join(" — "), message.channel)),
    ...message.attachments.map((file) => `📎 ${file.name} ${file.url}`),
  ].filter(Boolean);
  // Members the bot does not have cached stay as <@id>; the ones in this ticket are named.
  return parts.join("\n").replace(/<@!?(\d+)>/g, (whole, id: string) => (names.has(id) ? `@${names.get(id)}` : whole));
}

/**
 * The chat as a text file: a summary on top, then every message oldest first (up to 2,000).
 * The bot's opening card is left out (its details are in the summary) and so are Discord's own
 * notices such as pins; mentions show as names.
 */
async function transcript(channel: TextChannel, ticket: Ticket, by: GuildMember, reason: string) {
  const all: Message[] = [];
  let before: string | undefined;
  while (all.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    all.push(...batch.values());
    before = batch.last()!.id;
    if (batch.size < 100) break;
  }
  all.reverse();
  const me = channel.client.user.id;
  const header = all.find((message) => message.author.id === me && message.embeds[0]?.title?.includes(`Ticket #${ticket.id} ·`));
  const detail = header?.embeds[0]?.description?.split("\n").map((line) => line.replace(/^> ?/, "")).join("\n") ?? "";
  const messages = all.filter((message) => message !== header && (message.type === MessageType.Default || message.type === MessageType.Reply));
  const names = new Map<string, string>([[ticket.openerId, ticket.openerName], [by.id, by.displayName]]);
  if (ticket.claimedById) names.set(ticket.claimedById, ticket.claimedByName);
  const line = "─".repeat(46);
  const lines = [
    `Ticket #${ticket.id} · ${ticket.subject}`,
    "═".repeat(46),
    `เปิดโดย      ${ticket.openerName} (${ticket.openerId})`,
    `ผู้รับเรื่อง    ${ticket.claimedByName || "ไม่มี"}`,
    `เปิดเมื่อ      ${stamp(new Date(ticket.createdAt))}`,
    `ปิดเมื่อ       ${stamp(new Date())}`,
    `ปิดโดย       ${by.displayName}${reason ? ` · ${reason}` : ""}`,
    `ข้อความ      ${messages.length}`,
    ...(detail ? ["", "รายละเอียดตอนเปิด", ...detail.split("\n").map((text) => `  ${text}`)] : []),
    line,
    "",
  ];
  for (const message of messages) {
    const name = message.member?.displayName ?? message.author.username;
    lines.push(`[${stamp(message.createdAt)}] ${name}${message.author.bot ? " (บอท)" : ""}`, `  ${messageText(message, names).replace(/\n/g, "\n  ")}`, "");
  }
  return { text: lines.join("\n"), count: messages.length };
}

/** The card shared by the log room and the member's copy. */
function closedEmbed(ticket: Ticket, by: GuildMember, reason: string, count: number) {
  const embed = new EmbedBuilder()
    .setColor(COLOR.warn)
    .setTitle(`🔒 ปิด Ticket #${ticket.id} · ${ticket.subject}`.slice(0, 256))
    .addFields(
      { name: "เปิดโดย", value: `<@${ticket.openerId}>`, inline: true },
      { name: "ปิดโดย", value: `<@${by.id}>`, inline: true },
      { name: "ผู้รับเรื่อง", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "—", inline: true },
      { name: "เปิดเมื่อ", value: when(new Date(ticket.createdAt)), inline: true },
      { name: "ใช้เวลา", value: minutesText(Date.now() - new Date(ticket.createdAt).getTime()), inline: true },
      { name: "ข้อความ", value: count.toLocaleString("th-TH"), inline: true },
    );
  if (reason) embed.setDescription(`**เหตุผล** ${reason}`);
  return embed;
}

async function closeTicket(guild: Guild, ticket: Ticket, by: GuildMember, reason: string) {
  if (closing.has(ticket.id)) return;
  closing.add(ticket.id);
  const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
  let file: AttachmentBuilder | null = null;
  let count = 0;
  if (channel) {
    try {
      const result = await transcript(channel, ticket, by, reason);
      count = result.count;
      file = new AttachmentBuilder(Buffer.from(result.text, "utf8"), { name: `ticket-${String(ticket.id).padStart(4, "0")}.txt` });
    } catch (error) {
      logBotError("transcript", error);
    }
  }
  await closeRecord(ticket.id, by.id, by.user.username, reason, count);
  open.delete(ticket.channelId);
  const embed = closedEmbed(ticket, by, reason, count);
  const logId = settings()?.ticketLogChannelId;
  const log = logId ? guild.channels.cache.get(logId) : undefined;
  if (log?.type === ChannelType.GuildText) {
    await (log as TextChannel).send({ embeds: [embed], files: file ? [file] : [], allowedMentions: { parse: [] } }).catch((error) => logBotError("ticket log", error));
  }
  // The member gets a copy too, when their DMs are open.
  const opener = await guild.members.fetch(ticket.openerId).catch(() => null);
  if (opener) {
    await opener.send({ content: `Ticket #${ticket.id} ใน **${guild.name}** ปิดแล้ว นี่คือประวัติการคุย`, embeds: [embed], files: file ? [file] : [] })
      .catch(() => undefined);
  }
  setTimeout(() => {
    void channel?.delete(`ปิด Ticket #${ticket.id}`).catch((error) => logBotError("delete ticket channel", error));
    closing.delete(ticket.id);
  }, 5000);
}

/** A ticket room deleted by hand: close the ticket too. */
export function onChannelGone(channelId: string) {
  const ticket = open.get(channelId);
  if (!ticket || closing.has(ticket.id)) return;
  open.delete(channelId);
  void closeRecord(ticket.id, "", "", "ห้อง Ticket ถูกลบ", 0);
}

/** /ticket add, /ticket remove, /ticket close inside a ticket room. */
export async function onTicketCommand(interaction: ChatInputCommandInteraction) {
  const ticket = ticketFor(interaction);
  const member = interaction.member as GuildMember;
  const sub = interaction.options.getSubcommand();
  if (!ticket) {
    await interaction.reply({ embeds: [errorEmbed("ใช้ได้เฉพาะในห้อง Ticket", "ไปที่ห้อง Ticket ก่อน แล้วค่อยใช้คำสั่งนี้")], flags: ephemeral });
    return;
  }
  if (sub === "close") {
    if (!mayClose(member, ticket)) {
      await interaction.reply({ embeds: [errorEmbed("ปิดไม่ได้", "ปิดได้เฉพาะคนเปิดและทีมงาน")], flags: ephemeral });
      return;
    }
    await interaction.showModal(closeModal(ticket.id));
    return;
  }
  if (!isStaff(member)) {
    await interaction.reply({ embeds: [errorEmbed("ทำไม่ได้", "คำสั่งนี้สำหรับทีมงาน")], flags: ephemeral });
    return;
  }
  const user = interaction.options.getUser("member", true);
  const channel = interaction.channel as TextChannel;
  try {
    if (sub === "add") {
      await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true }, { reason: `Ticket #${ticket.id}` });
      await interaction.reply({ embeds: [okEmbed("เพิ่มแล้ว", `<@${user.id}> เห็นห้องนี้แล้ว`)], allowedMentions: { users: [user.id] } });
    } else {
      if (user.id === ticket.openerId) {
        await interaction.reply({ embeds: [errorEmbed("เอาออกไม่ได้", "เอาคนเปิด Ticket ออกไม่ได้")], flags: ephemeral });
        return;
      }
      await channel.permissionOverwrites.delete(user.id, `Ticket #${ticket.id}`);
      await interaction.reply({ embeds: [okEmbed("เอาออกแล้ว", `<@${user.id}> ไม่เห็นห้องนี้แล้ว`)], allowedMentions: { parse: [] } });
    }
  } catch (error) {
    logBotError("ticket member", error);
    await interaction.reply({ embeds: [errorEmbed("ทำไม่ได้", "บอทอาจไม่มีสิทธิ์จัดการห้องนี้")], flags: ephemeral });
  }
}
