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

// Black and red: embeds get the red stripe, the pictures (image.ts) match it.
export const COLOR = { brand: 0xe11d2e, ok: 0x3ddc97, warn: 0xf59e0b, danger: 0xff3b4a };

export const BRAND = "NEXORA CLOUD";

/** The look every panel and notice shares: red stripe, brand line on top, a quiet footer. */
export function brandEmbed(color: number = COLOR.brand) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: BRAND });
}

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
export function when(date: Date, style: "t" | "f" | "R" | "D" = "f") {
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
    embeds: [brandEmbed().setImage("attachment://verify.png").setDescription(text).setFooter({ text: "กดครั้งเดียวก็เห็นทุกห้อง" })],
    components: [row(new ButtonBuilder().setCustomId("cm:verify").setStyle(ButtonStyle.Success).setLabel("ยืนยันตัวตน").setEmoji("✅"))],
  };
}

export function ticketPanel(text: string) {
  return {
    embeds: [brandEmbed().setImage("attachment://ticket.png").setDescription(text).setFooter({ text: "ตอบโดยทีมงาน · เห็นเฉพาะคุณกับทีมงาน" })],
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
export function ticketHeader(
  ticket: { id: number; subject: string; openerId: string; claimedById: string; createdAt: string },
  detail: string,
  openerAvatar?: string,
) {
  const embed = new EmbedBuilder()
    .setColor(ticket.claimedById ? COLOR.ok : COLOR.brand)
    .setTitle(`🎫 Ticket #${ticket.id} · ${ticket.subject}`.slice(0, 256))
    .addFields(
      { name: "เปิดโดย", value: `<@${ticket.openerId}>`, inline: true },
      { name: "สถานะ", value: ticket.claimedById ? `🟢 <@${ticket.claimedById}> กำลังดูให้` : "🟡 รอทีมงานรับเรื่อง", inline: true },
      { name: "เปิดเมื่อ", value: when(new Date(ticket.createdAt), "t"), inline: true },
    )
    .setFooter({ text: "ทีมงานกด ✋ รับเรื่อง เมื่อเริ่มดูให้ · ปิดได้ทั้งคนเปิดและทีมงาน" });
  // The member's own words come first, quoted, so they read as the question and not as bot text.
  if (detail) embed.setDescription(detail.split("\n").map((line) => `> ${line}`).join("\n").slice(0, 4000));
  if (openerAvatar) embed.setThumbnail(openerAvatar);
  const buttons = row(
    new ButtonBuilder().setCustomId(`cm:ticket:claim:${ticket.id}`).setStyle(ButtonStyle.Success)
      .setLabel(ticket.claimedById ? "✅ รับเรื่องแล้ว" : "✋ รับเรื่อง").setDisabled(Boolean(ticket.claimedById)),
    new ButtonBuilder().setCustomId(`cm:ticket:close:${ticket.id}`).setStyle(ButtonStyle.Danger).setLabel("🔒 ปิด Ticket"),
  );
  return { embeds: [embed], components: [buttons] };
}

export function idFrom(customId: string) {
  const id = Number(customId.split(":").pop());
  return Number.isInteger(id) && id > 0 ? id : 0;
}
