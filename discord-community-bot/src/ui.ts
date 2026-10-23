import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageActionRowComponentBuilder,
} from "discord.js";

export const COLOR = { brand: 0x2e7eff, ok: 0x18b77a, warn: 0xe3aa52, danger: 0xf43f5e };

export type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

export const row = (...components: MessageActionRowComponentBuilder[]): Row =>
  new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);

export function channelUrl(guildId: string, channelId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export function errorEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(COLOR.danger).setTitle(title).setDescription(description);
}

export function okEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(COLOR.ok).setTitle(title).setDescription(description);
}

export function linkButton(url: string, label: string) {
  return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
}

/** Discord time tags show each reader their own local time. */
export function when(date: Date, style: "t" | "f" | "R" = "f") {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function minutesText(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} ชั่วโมง ${minutes % 60} นาที` : `${hours} ชั่วโมง`;
}

// The panels posted in the server. Their text is set on the web page (or with /setup).

export function verifyPanel(text: string) {
  return {
    embeds: [new EmbedBuilder().setColor(COLOR.brand).setTitle("ยืนยันตัวตน").setDescription(text)],
    components: [row(new ButtonBuilder().setCustomId("cm:verify").setStyle(ButtonStyle.Success).setLabel("ยืนยันตัวตน").setEmoji("✅"))],
  };
}

export function rolesPanel(text: string, roleNames: string[]) {
  const list = roleNames.length ? roleNames.map((name) => `• ${name}`).join("\n") : "_ยังไม่มียศให้เลือก_";
  return {
    embeds: [new EmbedBuilder().setColor(COLOR.brand).setTitle("เลือกยศ").setDescription(`${text}\n\n${list}`)],
    components: [row(new ButtonBuilder().setCustomId("cm:roles:open").setStyle(ButtonStyle.Primary).setLabel("เลือกยศ").setEmoji("🎭"))],
  };
}

export function ticketPanel(text: string) {
  return {
    embeds: [new EmbedBuilder().setColor(COLOR.brand).setTitle("ติดต่อทีมงาน").setDescription(text)],
    components: [row(new ButtonBuilder().setCustomId("cm:ticket:open").setStyle(ButtonStyle.Primary).setLabel("เปิด Ticket").setEmoji("🎫"))],
  };
}

export function ticketModal() {
  return new ModalBuilder()
    .setCustomId("cm:ticket:create")
    .setTitle("เปิด Ticket")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
        .setCustomId("subject").setLabel("เรื่อง").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
        .setPlaceholder("เช่น เข้าเว็บไม่ได้, สอบถามเรื่องโฮสติ้ง")),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
        .setCustomId("detail").setLabel("รายละเอียด (ไม่ใส่ก็ได้)").setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(false)),
    );
}

export function closeModal(ticketId: number) {
  return new ModalBuilder()
    .setCustomId(`cm:ticket:closing:${ticketId}`)
    .setTitle("ปิด Ticket")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
      .setCustomId("reason").setLabel("เหตุผล (ไม่ใส่ก็ได้)").setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(false)
      .setPlaceholder("เช่น แก้ไขเรียบร้อยแล้ว")));
}

/** The first message in a ticket's room: what it is about, and the buttons. */
export function ticketHeader(ticket: { id: number; subject: string; openerId: string; claimedById: string }, detail: string) {
  const embed = new EmbedBuilder()
    .setColor(ticket.claimedById ? COLOR.ok : COLOR.brand)
    .setTitle(`Ticket #${ticket.id} · ${ticket.subject}`)
    .setDescription(detail || "_ไม่มีรายละเอียด_")
    .addFields(
      { name: "เปิดโดย", value: `<@${ticket.openerId}>`, inline: true },
      { name: "ผู้รับเรื่อง", value: ticket.claimedById ? `<@${ticket.claimedById}>` : "ยังไม่มี", inline: true },
    )
    .setFooter({ text: "ทีมงานกด รับเรื่อง เพื่อบอกว่ากำลังดูให้ · ปิดได้ทั้งคนเปิดและทีมงาน" });
  const buttons = row(
    new ButtonBuilder().setCustomId(`cm:ticket:claim:${ticket.id}`).setStyle(ButtonStyle.Success).setLabel("รับเรื่อง").setDisabled(Boolean(ticket.claimedById)),
    new ButtonBuilder().setCustomId(`cm:ticket:close:${ticket.id}`).setStyle(ButtonStyle.Danger).setLabel("ปิด Ticket"),
  );
  return { embeds: [embed], components: [buttons] };
}

export function idFrom(customId: string) {
  const id = Number(customId.split(":").pop());
  return Number.isInteger(id) && id > 0 ? id : 0;
}
