import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
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
import { closeModal, COLOR, errorEmbed, idFrom, linkButton, okEmbed, row, channelUrl, ticketHeader, ticketModal, when } from "./ui";

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
    ...ticketHeader(ticket, detail),
    allowedMentions: { users: [member.id], roles: staff },
  }).then((message) => message.pin().catch(() => undefined)).catch((error) => logBotError("ticket header", error));
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
    const detail = interaction.message.embeds[0]?.description ?? "";
    await interaction.update(ticketHeader(res.data, detail === "_ไม่มีรายละเอียด_" ? "" : detail));
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

/** Every message in the room, oldest first (up to 2,000), as plain text. */
async function transcript(channel: TextChannel, ticket: Ticket) {
  const messages: Message[] = [];
  let before: string | undefined;
  while (messages.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    before = batch.last()!.id;
    if (batch.size < 100) break;
  }
  messages.reverse();
  const stamp = (date: Date) => date.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "medium" });
  const lines = [
    `Ticket #${ticket.id} · ${ticket.subject}`,
    `เปิดโดย ${ticket.openerName} (${ticket.openerId})`,
    `ห้อง #${channel.name} · ${messages.length} ข้อความ`,
    "",
  ];
  for (const message of messages) {
    const text = [message.content, ...message.embeds.map((embed) => [embed.title, embed.description].filter(Boolean).join(" — "))]
      .filter(Boolean).join("\n  ");
    const files = message.attachments.map((file) => file.url).join(" ");
    lines.push(`[${stamp(message.createdAt)}] ${message.author.username}: ${text}${files ? ` ${files}` : ""}`);
  }
  return { text: lines.join("\n"), count: messages.length };
}

async function closeTicket(guild: Guild, ticket: Ticket, by: GuildMember, reason: string) {
  if (closing.has(ticket.id)) return;
  closing.add(ticket.id);
  const channel = guild.channels.cache.get(ticket.channelId) as TextChannel | undefined;
  let file: AttachmentBuilder | null = null;
  let count = 0;
  if (channel) {
    try {
      const result = await transcript(channel, ticket);
      count = result.count;
      file = new AttachmentBuilder(Buffer.from(result.text, "utf8"), { name: `ticket-${String(ticket.id).padStart(4, "0")}.txt` });
    } catch (error) {
      logBotError("transcript", error);
    }
  }
  await closeRecord(ticket.id, by.id, by.user.username, reason, count);
  open.delete(ticket.channelId);
  const embed = new EmbedBuilder()
    .setColor(COLOR.warn)
    .setTitle(`ปิด Ticket #${ticket.id} · ${ticket.subject}`)
    .addFields(
      { name: "เปิดโดย", value: `<@${ticket.openerId}>`, inline: true },
      { name: "ปิดโดย", value: `<@${by.id}>`, inline: true },
      { name: "ผู้รับเรื่อง", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "ไม่มี", inline: true },
      { name: "เปิดเมื่อ", value: when(new Date(ticket.createdAt)), inline: true },
      { name: "ข้อความ", value: count.toLocaleString("th-TH"), inline: true },
    );
  if (reason) embed.setDescription(`เหตุผล: ${reason}`);
  const logId = settings()?.ticketLogChannelId;
  const log = logId ? guild.channels.cache.get(logId) : undefined;
  if (log?.type === ChannelType.GuildText) {
    await (log as TextChannel).send({ embeds: [embed], files: file ? [file] : [] }).catch((error) => logBotError("ticket log", error));
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
