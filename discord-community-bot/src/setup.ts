import {
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type OverwriteResolvable,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { isManager } from "./access";
import { api, apiMessage, logBotError } from "./api";
import { applySettings } from "./apply";
import { buildMissing, decorateAll, deleteAllChannels, ensureSetupChannel, hideFromUnverified } from "./build";
import { isBotAdmin, SETTINGS_URL } from "./config";
import { reportSoon } from "./guild";
import { nameStyle, savePanel, settings, updateSettings, type PanelKey, type Settings } from "./settings";
import { restyle, restyleRole, STYLE_LABELS, type NameStyle } from "./style";
import { COLOR, errorEmbed, okEmbed, row } from "./ui";

const ephemeral = MessageFlags.Ephemeral as const;

// /setup: the same settings as the admin web page, inside Discord (only the person who ran it
// sees the panel). /create: make a channel, category or role.

type Slot = {
  key: keyof Settings;
  label: string;
  kind: "text" | "voice" | "category" | "role" | "roles";
  max?: number;
};

const SLOTS: Slot[] = [
  { key: "welcomeChannelId", label: "ห้องต้อนรับ", kind: "text" },
  { key: "verifyChannelId", label: "ห้องยืนยันตัวตน", kind: "text" },
  { key: "memberRoleId", label: "ยศสมาชิก (ได้ตอนยืนยัน)", kind: "role" },
  { key: "ticketChannelId", label: "ห้องปุ่มเปิด Ticket", kind: "text" },
  { key: "ticketCategoryId", label: "หมวดที่สร้างห้อง Ticket", kind: "category" },
  { key: "ticketLogChannelId", label: "ห้อง log Ticket", kind: "text" },
  { key: "staffRoleIds", label: "ยศทีมงาน (ตอบ Ticket)", kind: "roles", max: 10 },
  { key: "managerRoleIds", label: "ยศผู้ดูแลบอท (/setup, /create)", kind: "roles", max: 10 },
  { key: "usageRoleIds", label: "ยศที่ใช้ Ticket/ห้องเสียงได้", kind: "roles", max: 10 },
  { key: "tempHubChannelId", label: "ห้อง ➕ สร้างห้องเสียง", kind: "voice" },
  { key: "statusChannelId", label: "ห้องแจ้งเว็บล่ม", kind: "text" },
  { key: "statusMentionRoleId", label: "ยศที่แท็กตอนเว็บล่ม", kind: "role" },
  { key: "statsCategoryId", label: "หมวดสถิติ", kind: "category" },
  { key: "statsMembersChannelId", label: "ห้องสถิติ: สมาชิก", kind: "voice" },
  { key: "statsOnlineChannelId", label: "ห้องสถิติ: ออนไลน์", kind: "voice" },
  { key: "statsSiteChannelId", label: "ห้องสถิติ: สถานะเว็บ", kind: "voice" },
  { key: "securityChannelId", label: "ห้องแจ้งเตือนความปลอดภัย", kind: "text" },
  { key: "boostChannelId", label: "ห้องบูสต์ (แผงความคืบหน้า)", kind: "text" },
  { key: "boostLoungeChannelId", label: "ห้องบูสเตอร์ (เฉพาะคนบูสต์)", kind: "text" },
];

const FEATURES: { key: keyof Settings; label: string; description: string }[] = [
  { key: "nameEmoji", label: "อีโมจิในชื่อห้องและยศ", description: "『👋』ยินดีต้อนรับ (ปิด = กรอบกับอักษรพิเศษอย่างเดียว)" },
  { key: "welcomeEnabled", label: "ต้อนรับสมาชิกใหม่", description: "ส่งข้อความต้อนรับในห้องต้อนรับ" },
  { key: "welcomeImage", label: "ภาพต้อนรับ", description: "แนบภาพการ์ดต้อนรับพร้อมรูปโปรไฟล์และชื่อ" },
  { key: "verifyEnabled", label: "ยืนยันตัวตน", description: "กดปุ่มแล้วได้ยศสมาชิก" },
  { key: "ticketsEnabled", label: "Ticket", description: "ปุ่มเปิดห้องคุยส่วนตัวกับทีมงาน" },
  { key: "tempVoiceEnabled", label: "ห้องเสียงชั่วคราว", description: "เข้าห้อง ➕ แล้วได้ห้องเสียงของตัวเอง" },
  { key: "statsEnabled", label: "ห้องสถิติ", description: "ชื่อห้องบอกจำนวนสมาชิก คนออนไลน์ สถานะเว็บ" },
  { key: "statusEnabled", label: "แจ้งเว็บล่ม", description: "แจ้งเมื่อเว็บหรือ API ล่มและกลับมา" },
  { key: "statusImage", label: "ภาพสถานะระบบ", description: "ภาพสถานะเว็บ API บอท อัปเดตเองในห้องแจ้งสถานะ" },
  { key: "boostEnabled", label: "ห้องบูสต์", description: "แถบความคืบหน้าบูสต์ สิทธิประโยชน์ และรายชื่อบูสเตอร์" },
  { key: "securityEnabled", label: "แจ้งเตือนความปลอดภัย", description: "เตะ แบน ลบห้อง/ยศ ให้ยศสิทธิ์สูง บอทใหม่ บัญชีเพิ่งสร้าง" },
  { key: "securitySiteEvents", label: "เหตุการณ์ความปลอดภัยของเว็บ", description: "ส่งเหตุการณ์ NEXORA Security เข้าห้องแจ้งเตือน" },
  { key: "antiNukeEnabled", label: "Anti-nuke", description: "ลบห้อง/ยศ หรือแบนรัว ๆ ถูกถอดยศและพักการพิมพ์" },
  { key: "antiSpamEnabled", label: "กันสแปมและคนเข้ารัว", description: "ลิงก์เชิญ แท็กเยอะ พิมพ์รัว และโหมดกัน raid" },
];

const TEXTS: { key: keyof Settings; label: string; hint: string; max: number; long: boolean }[] = [
  { key: "welcomeMessage", label: "ข้อความต้อนรับ", hint: "{user} = แท็กคนเข้า, {name} = ชื่อ, {server} = ชื่อเซิร์ฟ, {count} = ลำดับสมาชิก", max: 1500, long: true },
  { key: "verifyMessage", label: "ข้อความแผงยืนยันตัวตน", hint: "", max: 1500, long: true },
  { key: "boostPerks", label: "สิทธิประโยชน์ของบูสเตอร์", hint: "เขียนเป็นบรรทัด ๆ แสดงในแผงบูสต์", max: 1000, long: true },
  { key: "ticketMessage", label: "ข้อความแผง Ticket", hint: "", max: 1500, long: true },
  { key: "tempNameTemplate", label: "ชื่อห้องเสียงชั่วคราว", hint: "{user} = ชื่อเจ้าของห้อง", max: 60, long: false },
  { key: "ticketMaxOpen", label: "Ticket ที่เปิดค้างได้ต่อคน (1–5)", hint: "", max: 1, long: false },
  { key: "newAccountDays", label: "บัญชีอายุน้อยกว่า (วัน) ถือว่าใหม่ 0–30", hint: "0 = ไม่เช็ก", max: 2, long: false },
];

function on(value: boolean) {
  return value ? "🟢 เปิด" : "⚪ ปิด";
}

function mention(kind: Slot["kind"], value: string | string[]) {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  if (!ids.length) return "—";
  return ids.map((id) => (kind === "role" || kind === "roles" ? `<@&${id}>` : `<#${id}>`)).join(" ");
}

function slotText(current: Settings, key: keyof Settings) {
  const slot = SLOTS.find((item) => item.key === key)!;
  return mention(slot.kind, current[key] as string | string[]);
}

function homePage(current: Settings) {
  const embed = new EmbedBuilder()
    .setColor(COLOR.brand)
    .setTitle("ตั้งค่าบอทดูแลเซิร์ฟ")
    .setDescription([
      `ตั้งที่นี่หรือที่[หน้าเว็บแอดมิน](${SETTINGS_URL})ก็ได้ ค่าเดียวกัน`,
      "**🛠️ สร้างที่ขาดให้** สร้างยศ หมวด และห้องที่ยังไม่มี (ชื่อตามสไตล์ที่เลือก) · **🎨 แต่งชื่อ** เปลี่ยนชื่อห้องและยศที่มีอยู่เป็นสไตล์นี้ (ตามสไตล์และตัวเลือกอีโมจิ)",
      `สไตล์ชื่อตอนนี้: ${STYLE_LABELS[current.nameStyle] ?? STYLE_LABELS.frame} · อีโมจิ ${on(current.nameEmoji)}`,
    ].join("\n"))
    .addFields(
      { name: `ต้อนรับ ${on(current.welcomeEnabled)} · ภาพ ${on(current.welcomeImage)} · ยืนยันตัวตน ${on(current.verifyEnabled)}`,
        value: `ห้องต้อนรับ ${slotText(current, "welcomeChannelId")}\nห้องยืนยัน ${slotText(current, "verifyChannelId")} · ยศสมาชิก ${slotText(current, "memberRoleId")}` },
      { name: `Ticket ${on(current.ticketsEnabled)}`,
        value: `ปุ่ม ${slotText(current, "ticketChannelId")} · หมวด ${slotText(current, "ticketCategoryId")} · log ${slotText(current, "ticketLogChannelId")}\nทีมงาน ${slotText(current, "staffRoleIds")}` },
      { name: `ห้องเสียงชั่วคราว ${on(current.tempVoiceEnabled)}`, value: `ห้อง ${slotText(current, "tempHubChannelId")}`, inline: true },
      { name: `ห้องสถิติ ${on(current.statsEnabled)}`, value: `หมวด ${slotText(current, "statsCategoryId")}`, inline: true },
      { name: `แจ้งเว็บล่ม ${on(current.statusEnabled)}`, value: `ห้อง ${slotText(current, "statusChannelId")} · ภาพ ${on(current.statusImage)}`, inline: true },
      { name: `บูสต์ ${on(current.boostEnabled)}`, value: `แผง ${slotText(current, "boostChannelId")} · ห้องบูสเตอร์ ${slotText(current, "boostLoungeChannelId")}`, inline: true },
      { name: `ความปลอดภัย ${on(current.securityEnabled)}`,
        value: `ห้อง ${slotText(current, "securityChannelId")} · Anti-nuke ${on(current.antiNukeEnabled)} · กันสแปม ${on(current.antiSpamEnabled)}` },
      { name: "สิทธิ์", value: `ผู้ดูแลบอท ${slotText(current, "managerRoleIds")}\nใช้ Ticket/ห้องเสียงได้ ${current.usageRoleIds.length ? slotText(current, "usageRoleIds") : "ทุกคน"}` },
    );
  const features = new StringSelectMenuBuilder()
    .setCustomId("cm:setup:features")
    .setPlaceholder("เปิด/ปิดฟีเจอร์")
    .setMinValues(0)
    .setMaxValues(FEATURES.length)
    .addOptions(FEATURES.map((feature) => ({ label: feature.label, description: feature.description, value: feature.key, default: Boolean(current[feature.key]) })));
  const pick = new StringSelectMenuBuilder()
    .setCustomId("cm:setup:pick")
    .setPlaceholder("เลือกห้องหรือยศที่จะตั้ง")
    .addOptions(SLOTS.map((slot) => ({ label: slot.label, value: slot.key })));
  const text = new StringSelectMenuBuilder()
    .setCustomId("cm:setup:text")
    .setPlaceholder("แก้ข้อความ")
    .addOptions(TEXTS.map((item) => ({ label: item.label, value: item.key })));
  const style = new StringSelectMenuBuilder()
    .setCustomId("cm:setup:style")
    .setPlaceholder("สไตล์ชื่อห้องและยศ")
    .addOptions((Object.keys(STYLE_LABELS) as NameStyle[]).map((value) => ({ label: STYLE_LABELS[value], value, default: value === current.nameStyle })));
  const buttons = row(
    new ButtonBuilder().setCustomId("cm:setup:build").setStyle(ButtonStyle.Primary).setLabel("สร้างที่ขาดให้").setEmoji("🛠️"),
    new ButtonBuilder().setCustomId("cm:setup:decorate").setStyle(ButtonStyle.Secondary).setLabel("แต่งชื่อ").setEmoji("🎨"),
    new ButtonBuilder().setCustomId("cm:setup:hide").setStyle(ButtonStyle.Secondary).setLabel("ซ่อนห้อง").setEmoji("🔒"),
    new ButtonBuilder().setCustomId("cm:setup:repost").setStyle(ButtonStyle.Secondary).setLabel("ลงแผงใหม่").setEmoji("🔁"),
    new ButtonBuilder().setCustomId("cm:setup:wipe").setStyle(ButtonStyle.Danger).setLabel("ลบห้องทั้งหมด").setEmoji("🗑️"),
  );
  return { embeds: [embed], components: [row(features), row(pick), row(text), row(style), buttons] };
}

function pickerPage(current: Settings, slot: Slot) {
  const value = current[slot.key] as string | string[];
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  let menu: ChannelSelectMenuBuilder | RoleSelectMenuBuilder;
  if (slot.kind === "role" || slot.kind === "roles") {
    menu = new RoleSelectMenuBuilder().setCustomId(`cm:set:${slot.key}`).setMinValues(slot.kind === "roles" ? 0 : 1).setMaxValues(slot.max ?? 1);
    if (ids.length) menu.setDefaultRoles(...ids);
  } else {
    const types = { text: [ChannelType.GuildText, ChannelType.GuildAnnouncement], voice: [ChannelType.GuildVoice], category: [ChannelType.GuildCategory] }[slot.kind];
    menu = new ChannelSelectMenuBuilder().setCustomId(`cm:set:${slot.key}`).setChannelTypes(...types).setMinValues(1).setMaxValues(1);
    if (ids.length) menu.setDefaultChannels(...ids);
  }
  menu.setPlaceholder(slot.label);
  const embed = new EmbedBuilder().setColor(COLOR.brand).setTitle(slot.label).setDescription(`ตอนนี้: ${mention(slot.kind, value)}\nเลือกใหม่จากเมนูด้านล่าง`);
  return {
    embeds: [embed],
    components: [
      row(menu),
      row(
        new ButtonBuilder().setCustomId("cm:setup:home").setStyle(ButtonStyle.Secondary).setLabel("กลับ"),
        new ButtonBuilder().setCustomId(`cm:clear:${slot.key}`).setStyle(ButtonStyle.Danger).setLabel("ล้างค่า").setDisabled(ids.length === 0),
      ),
    ],
  };
}

async function denyUnlessManager(interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | ModalSubmitInteraction) {
  if (isManager(interaction.member as GuildMember)) return false;
  const payload = { embeds: [errorEmbed("ใช้ไม่ได้", "คำสั่งนี้สำหรับแอดมินและยศผู้ดูแลบอท")], components: [] };
  if (interaction.isMessageComponent()) await interaction.update(payload);
  else await interaction.reply({ ...payload, flags: ephemeral });
  return true;
}

export async function onSetupCommand(interaction: ChatInputCommandInteraction) {
  if (await denyUnlessManager(interaction)) return;
  const current = settings();
  if (!current) {
    await interaction.reply({ embeds: [errorEmbed("ยังโหลดการตั้งค่าไม่ได้", "ติดต่อเว็บไม่ได้ ลองใหม่อีกครั้งในอีกสักครู่")], flags: ephemeral });
    return;
  }
  await interaction.reply({ ...homePage(current), flags: ephemeral });
}

/** Saves a change and shows the panel again (or the error the site gave). */
async function save(interaction: StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction,
  change: Partial<Settings>) {
  if (!interaction.deferred && !interaction.replied) {
    if (interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage())) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: ephemeral });
  }
  try {
    const next = await updateSettings(interaction.user, change);
    await interaction.editReply(homePage(next));
    void applySettings(interaction.client);
  } catch (error) {
    logBotError("save settings", error);
    await interaction.editReply({ embeds: [errorEmbed("บันทึกไม่ได้", apiMessage(error, "ติดต่อเว็บไม่ได้ ลองใหม่อีกครั้ง"))], components: [row(
      new ButtonBuilder().setCustomId("cm:setup:home").setStyle(ButtonStyle.Secondary).setLabel("กลับ"),
    )] });
  }
}

export async function onSetupComponent(interaction: ButtonInteraction | StringSelectMenuInteraction | ChannelSelectMenuInteraction | RoleSelectMenuInteraction) {
  if (await denyUnlessManager(interaction)) return;
  const current = settings();
  if (!current) {
    await interaction.update({ embeds: [errorEmbed("ยังโหลดการตั้งค่าไม่ได้", "ลองใหม่อีกครั้งในอีกสักครู่")], components: [] });
    return;
  }
  const id = interaction.customId;

  if (id === "cm:setup:open") {
    // The button in the setup room: a fresh panel only this admin sees.
    await interaction.reply({ ...homePage(current), flags: ephemeral });
  } else if (id === "cm:setup:home") {
    await interaction.update(homePage(current));
  } else if (id === "cm:setup:style" && interaction.isStringSelectMenu()) {
    await save(interaction, { nameStyle: interaction.values[0] as NameStyle });
  } else if (id === "cm:setup:decorate") {
    await interaction.deferUpdate();
    const result = await decorateAll(interaction.guild!);
    reportSoon(interaction.client);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(result.failed ? COLOR.warn : COLOR.ok).setTitle("แต่งชื่อแล้ว").setDescription(
        `เปลี่ยนชื่อ ${result.changed} ห้อง/หมวด/ยศ เป็นสไตล์ ${STYLE_LABELS[nameStyle()]}` +
        (result.failed ? `\nเปลี่ยนไม่ได้ ${result.failed} ห้อง (บอทไม่มีสิทธิ์จัดการห้องนั้น หรือ Discord จำกัดการเปลี่ยนชื่อถี่ ๆ ลองใหม่ใน 10 นาที)` : ""))],
      components: [row(new ButtonBuilder().setCustomId("cm:setup:home").setStyle(ButtonStyle.Secondary).setLabel("กลับไปหน้าตั้งค่า"))],
    });
  } else if (id === "cm:setup:wipe") {
    if (!mayWipe(interaction.member as GuildMember)) {
      await interaction.update({ embeds: [errorEmbed("ลบไม่ได้", "ลบห้องทั้งหมดได้เฉพาะเจ้าของเซิร์ฟและคนที่มีสิทธิ์ Administrator")],
        components: [row(new ButtonBuilder().setCustomId("cm:setup:home").setStyle(ButtonStyle.Secondary).setLabel("กลับ"))] });
      return;
    }
    const guild = interaction.guild!;
    const count = guild.channels.cache.filter((channel) => !channel.isThread()).size;
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(COLOR.danger).setTitle("⚠️ ลบห้องและหมวดทั้งหมด?").setDescription([
        `บอทจะลบห้องและหมวด **ทั้งหมด ${count} อัน** ในเซิร์ฟ **${guild.name}** รวมข้อความในห้องเหล่านั้น **กู้คืนไม่ได้**`,
        "ยศและสมาชิกไม่ถูกแตะ เสร็จแล้วบอทจะสร้างห้อง ⚙️ ตั้งค่าบอท ไว้ 1 ห้องให้ตั้งต่อ",
        "",
        "กด **ยืนยัน** แล้วพิมพ์ชื่อเซิร์ฟให้ตรงเพื่อลบ",
      ].join("\n"))],
      components: [row(
        new ButtonBuilder().setCustomId("cm:setup:wipe:yes").setStyle(ButtonStyle.Danger).setLabel("ยืนยัน"),
        new ButtonBuilder().setCustomId("cm:setup:home").setStyle(ButtonStyle.Secondary).setLabel("ยกเลิก"),
      )],
    });
  } else if (id === "cm:setup:wipe:yes") {
    if (!mayWipe(interaction.member as GuildMember)) return;
    await interaction.showModal(new ModalBuilder().setCustomId("cm:wipe").setTitle("ลบห้องและหมวดทั้งหมด").addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("name").setLabel("พิมพ์ชื่อเซิร์ฟเพื่อยืนยัน")
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder(interaction.guild!.name.slice(0, 100)))));
  } else if (id === "cm:setup:features" && interaction.isStringSelectMenu()) {
    const change: Partial<Settings> = {};
    for (const feature of FEATURES) (change as Record<string, boolean>)[feature.key] = interaction.values.includes(feature.key);
    await save(interaction, change);
  } else if (id === "cm:setup:pick" && interaction.isStringSelectMenu()) {
    const slot = SLOTS.find((item) => item.key === interaction.values[0]);
    if (slot) await interaction.update(pickerPage(current, slot));
  } else if (id === "cm:setup:text" && interaction.isStringSelectMenu()) {
    const item = TEXTS.find((text) => text.key === interaction.values[0]);
    if (!item) return;
    const field = new TextInputBuilder().setCustomId("value").setLabel(item.label.slice(0, 45))
      .setStyle(item.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(item.max).setRequired(true)
      .setValue(String(current[item.key]));
    if (item.hint) field.setPlaceholder(item.hint.slice(0, 100));
    await interaction.showModal(new ModalBuilder().setCustomId(`cm:text:${item.key}`).setTitle(item.label.slice(0, 45))
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(field)));
  } else if (id.startsWith("cm:set:")) {
    const slot = SLOTS.find((item) => item.key === id.slice("cm:set:".length));
    if (!slot || !(interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu())) return;
    const values = interaction.values;
    await save(interaction, { [slot.key]: slot.kind === "roles" ? values : values[0] ?? "" });
  } else if (id.startsWith("cm:clear:")) {
    const slot = SLOTS.find((item) => item.key === id.slice("cm:clear:".length));
    if (slot) await save(interaction, { [slot.key]: slot.kind === "roles" ? [] : "" });
  } else if (id === "cm:setup:build") {
    await interaction.deferUpdate();
    const guild = interaction.guild!;
    const result = await buildMissing(guild);
    if (Object.keys(result.change).length) {
      try {
        await updateSettings(interaction.user, result.change);
      } catch (error) {
        logBotError("save built settings", error);
        result.problems.push("สร้างแล้ว แต่บันทึกการตั้งค่าไม่ได้ (เว็บไม่ตอบ) กดสร้างที่ขาดให้อีกครั้งภายหลัง");
      }
    }
    await api(interaction.user).post("/api/internal/bot/community/event", { kind: "setup", guildId: guild.id, name: guild.name, created: result.created })
      .catch((error) => logBotError("log setup", error));
    await applySettings(interaction.client);
    const lines = [
      result.created.length ? `**สร้างใหม่ ${result.created.length} อย่าง**\n${result.created.map((name) => `• ${name}`).join("\n")}` : "ไม่มีอะไรขาด ทุกอย่างมีครบแล้ว",
      ...(result.problems.length ? [`**ทำไม่ได้**\n${result.problems.map((p) => `• ${p}`).join("\n")}`] : []),
    ];
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(result.problems.length ? COLOR.warn : COLOR.ok).setTitle("สร้างที่ขาดให้แล้ว").setDescription(lines.join("\n\n").slice(0, 4000))],
      components: [row(new ButtonBuilder().setCustomId("cm:setup:home").setStyle(ButtonStyle.Secondary).setLabel("กลับไปหน้าตั้งค่า"))],
    });
  } else if (id === "cm:setup:hide") {
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(COLOR.warn).setTitle("ซ่อนห้องจากคนที่ยังไม่ยืนยัน?").setDescription(
        `ห้องและหมวดที่ทุกคนเห็นอยู่ตอนนี้ จะเห็นได้เฉพาะคนที่มียศ ${slotText(current, "memberRoleId")}\n` +
        "เว้นห้องต้อนรับ ห้องยืนยันตัวตน และหมวดของสองห้องนี้ ส่วนห้องที่เป็นส่วนตัวอยู่แล้วไม่ถูกแตะ")],
      components: [row(
        new ButtonBuilder().setCustomId("cm:setup:hide:yes").setStyle(ButtonStyle.Danger).setLabel("ซ่อนเลย").setDisabled(!current.memberRoleId),
        new ButtonBuilder().setCustomId("cm:setup:home").setStyle(ButtonStyle.Secondary).setLabel("ยกเลิก"),
      )],
    });
  } else if (id === "cm:setup:hide:yes") {
    await interaction.deferUpdate();
    const result = await hideFromUnverified(interaction.guild!);
    const text = result.missingRole ? "ยังไม่ได้ตั้งยศสมาชิก" :
      `ซ่อนแล้ว ${result.changed} ห้อง/หมวด${result.failed ? ` · ทำไม่ได้ ${result.failed} ห้อง (บอทไม่มีสิทธิ์จัดการห้องนั้น)` : ""}`;
    reportSoon(interaction.client);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(result.failed || result.missingRole ? COLOR.warn : COLOR.ok).setTitle("ซ่อนห้อง").setDescription(text)],
      components: [row(new ButtonBuilder().setCustomId("cm:setup:home").setStyle(ButtonStyle.Secondary).setLabel("กลับไปหน้าตั้งค่า"))],
    });
  } else if (id === "cm:setup:repost") {
    await interaction.deferUpdate();
    await applySettings(interaction.client, true);
    await interaction.editReply(homePage(settings() ?? current));
    await interaction.followUp({ embeds: [okEmbed("ลงแผงใหม่แล้ว", "แผงยืนยันตัวตน Ticket และบูสต์ ถูกลงใหม่ที่ท้ายห้องของมัน")], flags: ephemeral });
  }
}

export async function onSetupText(interaction: ModalSubmitInteraction) {
  if (await denyUnlessManager(interaction)) return;
  const key = interaction.customId.slice("cm:text:".length) as keyof Settings;
  const item = TEXTS.find((text) => text.key === key);
  if (!item) return;
  const raw = interaction.fields.getTextInputValue("value").trim();
  if (key === "ticketMaxOpen" || key === "newAccountDays") {
    const value = Number(raw);
    const [min, max] = key === "ticketMaxOpen" ? [1, 5] : [0, 30];
    if (!Number.isInteger(value) || value < min || value > max) {
      await interaction.reply({ embeds: [errorEmbed("ตัวเลขไม่ถูก", `ใส่เลข ${min}–${max}`)], flags: ephemeral });
      return;
    }
    await save(interaction, { [key]: value });
    return;
  }
  await save(interaction, { [key]: raw });
}

/** Deleting every channel is for the server owner and Administrators only, not manager roles. */
function mayWipe(member: GuildMember) {
  return member.id === member.guild.ownerId || isBotAdmin(member.id) || member.permissions.has(PermissionFlagsBits.Administrator);
}

const CHANNEL_KEYS: (keyof Settings)[] = ["welcomeChannelId", "verifyChannelId", "rolesChannelId", "boostChannelId", "boostLoungeChannelId", "ticketChannelId", "ticketCategoryId",
  "ticketLogChannelId", "tempHubChannelId", "statsCategoryId", "statsMembersChannelId", "statsOnlineChannelId", "statsSiteChannelId", "statusChannelId", "securityChannelId"];

export async function onWipeSubmit(interaction: ModalSubmitInteraction) {
  const member = interaction.member as GuildMember;
  const guild = interaction.guild!;
  if (!mayWipe(member)) {
    await interaction.reply({ embeds: [errorEmbed("ลบไม่ได้", "ลบห้องทั้งหมดได้เฉพาะเจ้าของเซิร์ฟและคนที่มีสิทธิ์ Administrator")], flags: ephemeral });
    return;
  }
  if (interaction.fields.getTextInputValue("name").trim() !== guild.name.trim()) {
    await interaction.reply({ embeds: [errorEmbed("ชื่อเซิร์ฟไม่ตรง", "ไม่ได้ลบอะไร พิมพ์ชื่อเซิร์ฟให้ตรงทุกตัวอักษรแล้วลองใหม่")], flags: ephemeral });
    return;
  }
  await interaction.deferReply({ flags: ephemeral });
  console.log(`[INFO] ${interaction.user.username} is deleting every channel in ${guild.id}`);
  const result = await deleteAllChannels(guild);
  // The settings pointed at channels that are gone now.
  const cleared: Partial<Settings> = {};
  for (const key of CHANNEL_KEYS) (cleared as Record<string, string>)[key] = "";
  await updateSettings(interaction.user, cleared).catch((error) => logBotError("clear channel settings", error));
  for (const key of ["verify", "roles", "ticket", "status", "boost"] as PanelKey[]) await savePanel(key, { channelId: "", messageId: "" });
  await api(interaction.user).post("/api/internal/bot/community/event", {
    kind: "wipe", guildId: guild.id, name: guild.name, created: [`ลบ ${result.deleted} ห้อง/หมวด`, ...result.failed.map((name) => `ลบไม่ได้: ${name}`)],
  }).catch((error) => logBotError("log wipe", error));
  const note = [
    `<@${member.id}> ลบห้องและหมวดทั้งหมดแล้ว (${result.deleted} อัน)`,
    result.failed.length ? `ลบไม่ได้ ${result.failed.length} ห้อง: ${result.failed.join(", ")} (ห้องกฎ/ประกาศของเซิร์ฟ Community ต้องปิด Community ก่อน)` : "",
  ].filter(Boolean).join("\n");
  const room = await ensureSetupChannel(guild, note);
  await interaction.editReply({ embeds: [okEmbed("ลบเสร็จแล้ว", room ? `ไปตั้งค่าต่อที่ ${room}` : note)] }).catch(() => undefined);
  reportSoon(interaction.client);
}

// /create

function onlyRole(guild: GuildMember["guild"], roleId: string, readOnly: boolean): OverwriteResolvable[] {
  const bot = { id: guild.client.user.id, type: OverwriteType.Member, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect] };
  if (!roleId) return readOnly ? [{ id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.SendMessages] }, bot] : [];
  return [
    { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: roleId, type: OverwriteType.Role, allow: [PermissionFlagsBits.ViewChannel], deny: readOnly ? [PermissionFlagsBits.SendMessages] : [] },
    bot,
  ];
}

export async function onCreateCommand(interaction: ChatInputCommandInteraction) {
  if (await denyUnlessManager(interaction)) return;
  const guild = interaction.guild!;
  const sub = interaction.options.getSubcommand();
  const typed = interaction.options.getString("name", true).trim();
  // Decorated in the server's name style unless asked not to; an emoji typed here is kept.
  const plain = interaction.options.getBoolean("plain") ?? false;
  const emoji = interaction.options.getString("emoji")?.trim() ?? "";
  const styled = (type: ChannelType) => (plain ? typed : restyle(nameStyle(), type, `${emoji} ${typed}`) || typed);
  await interaction.deferReply({ flags: ephemeral });
  try {
    if (sub === "role") {
      const colorText = interaction.options.getString("color")?.trim() ?? "";
      if (colorText && !/^#?[0-9a-f]{6}$/i.test(colorText)) {
        await interaction.editReply({ embeds: [errorEmbed("สีไม่ถูก", "ใส่สีแบบ #2e7eff หรือเว้นไว้")] });
        return;
      }
      const role = await guild.roles.create({
        name: plain ? typed : restyleRole(nameStyle(), `${emoji} ${typed}`) || typed, color: colorText ? parseInt(colorText.replace("#", ""), 16) : undefined,
        hoist: interaction.options.getBoolean("separate") ?? false, mentionable: interaction.options.getBoolean("mentionable") ?? false,
        reason: `/create โดย ${interaction.user.username}`,
      });
      await api(interaction.user).post("/api/internal/bot/community/event", { kind: "role", guildId: guild.id, name: role.name, id: role.id }).catch(() => undefined);
      await interaction.editReply({ embeds: [okEmbed("สร้างยศแล้ว", `${role} (ลากตำแหน่งยศได้ในตั้งค่าเซิร์ฟ)`)] });
      return;
    }
    const roleId = interaction.options.getRole("only")?.id ?? "";
    if (sub === "category") {
      const category = await guild.channels.create({ name: styled(ChannelType.GuildCategory), type: ChannelType.GuildCategory, permissionOverwrites: onlyRole(guild, roleId, false), reason: `/create โดย ${interaction.user.username}` });
      await api(interaction.user).post("/api/internal/bot/community/event", { kind: "category", guildId: guild.id, name: category.name, id: category.id }).catch(() => undefined);
      await interaction.editReply({ embeds: [okEmbed("สร้างหมวดแล้ว", `**${category.name}**${roleId ? ` เห็นเฉพาะ <@&${roleId}>` : ""}`)] });
      return;
    }
    const type = { voice: ChannelType.GuildVoice, announcement: ChannelType.GuildAnnouncement }[interaction.options.getString("type") ?? ""] ?? ChannelType.GuildText;
    const parent = interaction.options.getChannel("category");
    const readOnly = interaction.options.getBoolean("read_only") ?? false;
    const custom = Boolean(roleId) || readOnly;
    const channel = await guild.channels.create({
      name: styled(type), type: type as ChannelType.GuildText,
      parent: parent?.id,
      // Without a role or read-only it simply follows its category's permissions.
      permissionOverwrites: custom ? onlyRole(guild, roleId, readOnly && type !== ChannelType.GuildVoice) : undefined,
      reason: `/create โดย ${interaction.user.username}`,
    });
    await api(interaction.user).post("/api/internal/bot/community/event", { kind: "channel", guildId: guild.id, name: channel.name, id: channel.id }).catch(() => undefined);
    await interaction.editReply({ embeds: [okEmbed("สร้างห้องแล้ว", `${channel}${roleId ? ` เห็นเฉพาะ <@&${roleId}>` : ""}${readOnly ? " · อ่านอย่างเดียว" : ""}`)] });
  } catch (error) {
    logBotError(`create ${sub}`, error);
    await interaction.editReply({ embeds: [errorEmbed("สร้างไม่ได้", "บอทอาจไม่มีสิทธิ์ Manage Channels / Manage Roles หรือชื่อไม่ถูกต้อง")] });
  }
}
