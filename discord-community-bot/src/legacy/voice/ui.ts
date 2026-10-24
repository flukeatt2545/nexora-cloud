import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { VoiceRoom } from "./api";

export function channelUrl(guildId: string, channelId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export const COLOR = { brand: 0x2e7eff, ok: 0x18b77a, warn: 0xe3aa52, danger: 0xf43f5e };

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

export function errorEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(COLOR.danger).setTitle(title).setDescription(description);
}

export function okEmbed(title: string, description: string) {
  return new EmbedBuilder().setColor(COLOR.ok).setTitle(title).setDescription(description);
}

export function linkRow(guildId: string, channelId: string, label = "ไปที่ห้อง"): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(channelUrl(guildId, channelId)),
  );
}

/** The message posted in the room's own chat: whose room it is, and the owner's button. */
export function roomPanel(roomId: number, name: string, ownerId: string) {
  const embed = new EmbedBuilder()
    .setColor(COLOR.brand)
    .setTitle(`🔊 ${name}`.slice(0, 256))
    .setDescription([
      `**เจ้าของห้อง** <@${ownerId}>`,
      "",
      "เจ้าของกด **จัดการห้อง** เพื่อตั้งรหัส ล็อก เปิดให้ทุกคนเข้า หรือเตะคนออก",
    ].join("\n"));
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`vr:manage:${roomId}`).setStyle(ButtonStyle.Primary).setLabel("⚙️ จัดการห้อง"),
  );
  return { embeds: [embed], components: [row] };
}

/** The buttons under the panel message (its title, text and picture: see messages.ts). */
export function panelButtons(): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId("vr:create").setStyle(ButtonStyle.Primary).setLabel("สร้างห้อง"),
    new ButtonBuilder().setCustomId("vr:find").setStyle(ButtonStyle.Secondary).setLabel("เข้าห้องที่ล็อก"),
    new ButtonBuilder().setCustomId("vr:mine").setStyle(ButtonStyle.Secondary).setLabel("ห้องของฉัน"),
  );
}

function input(id: string, label: string, style: TextInputStyle, options: { min?: number; max: number; required: boolean; value?: string; placeholder?: string }) {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(options.max).setRequired(options.required);
  if (options.min) field.setMinLength(options.min);
  if (options.value) field.setValue(options.value);
  if (options.placeholder) field.setPlaceholder(options.placeholder);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
}

/** The locked rooms someone can pick from to enter a password (Discord shows at most 25). */
export function lockedRoomPicker(rooms: { channelId: string; name: string; ownerName: string; people: number }[]) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("vr:pick")
    .setPlaceholder("เลือกห้อง")
    .addOptions(rooms.slice(0, 25).map((room) => ({
      label: room.name.slice(0, 100),
      value: room.channelId,
      description: `${room.ownerName ? `${room.ownerName} · ` : ""}${room.people ? `${room.people} คนในห้อง` : "ห้องว่าง"}`.slice(0, 100),
    })));
  return {
    embeds: [new EmbedBuilder().setColor(COLOR.brand).setTitle("เข้าห้องที่ล็อก").setDescription("เลือกห้องที่อยากเข้า แล้วใส่รหัส")],
    components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)],
  };
}

export function createModal() {
  return new ModalBuilder().setCustomId("vr:create").setTitle("สร้างห้อง").addComponents(
    input("name", "ชื่อห้อง", TextInputStyle.Short, { max: 100, required: true }),
    input("password", "รหัส (4–32 ตัว)", TextInputStyle.Short, { min: 4, max: 32, required: true }),
    input("limit", "รับได้กี่คน (เว้นว่าง = ไม่จำกัด)", TextInputStyle.Short, { max: 2, required: false, placeholder: "เช่น 5" }),
  );
}

/**
 * Asks for a room's password. Discord closes the form on submit and cannot show an error in it,
 * so after a wrong try the next form says so in the empty field instead.
 */
export function passwordModal(roomId: number, name: string, hint?: string) {
  return new ModalBuilder().setCustomId(`vr:pw:${roomId}`).setTitle(`เข้าห้อง ${name}`.slice(0, 45)).addComponents(
    input("password", "รหัส", TextInputStyle.Short, { max: 32, required: true, placeholder: hint?.slice(0, 100) }),
  );
}

/** One click back to the password form after a wrong try. */
export function retryRow(roomId: number): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`vr:join:${roomId}`).setStyle(ButtonStyle.Primary).setLabel("ใส่รหัสอีกครั้ง"),
  );
}

export function newPasswordModal(roomId: number, mode: "change" | "lock" = "change") {
  const id = mode === "lock" ? `vr:lockpw:${roomId}` : `vr:newpw:${roomId}`;
  return new ModalBuilder().setCustomId(id).setTitle(mode === "lock" ? "ตั้งรหัสแล้วล็อก" : "เปลี่ยนรหัส").addComponents(
    input("password", "รหัสใหม่ (4–32 ตัว)", TextInputStyle.Short, { min: 4, max: 32, required: true }),
  );
}

export function editModal(room: VoiceRoom) {
  return new ModalBuilder().setCustomId(`vr:edit:${room.id}`).setTitle("แก้ชื่อและจำนวนคน").addComponents(
    input("name", "ชื่อห้อง", TextInputStyle.Short, { max: 100, required: true, value: room.name }),
    input("limit", "รับได้กี่คน (เว้นว่าง = ไม่จำกัด)", TextInputStyle.Short, { max: 2, required: false, value: room.userLimit ? String(room.userLimit) : "" }),
  );
}

/** The owner's private controls for one room. */
export function managePanel(room: VoiceRoom, emptyMinutes: number) {
  // One line for the state, then three short facts side by side (long values wrap badly in columns).
  const status = !room.locked
    ? "🌐 **เปิด** · ใครก็เข้าได้"
    : room.hasPassword
      ? "🔐 **ล็อก** · ต้องใส่รหัสก่อนเข้า"
      : "🔒 **ปิด** · ตอนนี้เข้าได้แค่คุณ";
  const embed = new EmbedBuilder()
    .setColor(!room.locked ? COLOR.ok : room.hasPassword ? COLOR.brand : COLOR.warn)
    .setTitle(`🔊 ${room.name}`.slice(0, 256))
    .setDescription(status)
    .addFields(
      { name: "🔑 รหัส", value: room.hasPassword ? "ตั้งแล้ว" : "ยังไม่ตั้ง", inline: true },
      { name: "👥 ใส่รหัสแล้ว", value: `${room.accessCount} คน`, inline: true },
      { name: "🎚️ รับได้", value: room.userLimit ? `${room.userLimit} คน` : "ไม่จำกัด", inline: true },
    )
    .setFooter({ text: `ห้องว่าง ${emptyMinutes} นาที จะหายไปเอง` });
  const actions = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    room.hasPassword
      ? new ButtonBuilder().setCustomId(`vr:newpw:${room.id}`).setStyle(ButtonStyle.Secondary).setLabel("🔑 เปลี่ยนรหัส")
      : new ButtonBuilder().setCustomId(`vr:lockpw:${room.id}`).setStyle(ButtonStyle.Primary).setLabel("🔑 ตั้งรหัส"),
    new ButtonBuilder()
      .setCustomId(`vr:lock:${room.id}`)
      .setStyle(room.locked ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setLabel(room.locked ? "🌐 เปิดให้ทุกคน" : room.hasPassword ? "🔐 ล็อกห้อง" : "🔒 ปิดห้อง"),
    new ButtonBuilder().setCustomId(`vr:edit:${room.id}`).setStyle(ButtonStyle.Secondary).setLabel("✏️ แก้ไข"),
    new ButtonBuilder().setCustomId(`vr:del:${room.id}`).setStyle(ButtonStyle.Danger).setLabel("🗑️ ลบห้อง"),
  );
  const kick = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId(`vr:kick:${room.id}`).setPlaceholder("👢 เลือกคนที่จะเตะออกจากห้อง").setMinValues(1).setMaxValues(5),
  );
  return { embeds: [embed], components: [actions, kick] };
}

export function confirmDeleteRow(roomId: number): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`vr:delok:${roomId}`).setStyle(ButtonStyle.Danger).setLabel("ลบเลย"),
    new ButtonBuilder().setCustomId(`vr:manage:${roomId}`).setStyle(ButtonStyle.Secondary).setLabel("ไม่ลบ"),
  );
}

export function purgeRow(roomId: number): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`vr:purge:${roomId}`).setStyle(ButtonStyle.Danger).setLabel("เตะคนในห้องออก ให้ใส่รหัสใหม่"),
  );
}
