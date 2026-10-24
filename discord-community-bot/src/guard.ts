import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { apiMessage, logBotError } from "./api";
import { protectSettings } from "./legacy/voice/protect";
import { settings, updateSettings, type Settings } from "./settings";
import { mayWipe } from "./setup";
import { COLOR, errorEmbed } from "./ui";

const ephemeral = MessageFlags.Ephemeral as const;

// /protect: see the server protection at a glance, choose who may delete channels without being
// stopped, and how many channels someone may delete first. The same settings are on the web page.

function list(ids: string[], mention: (id: string) => string) {
  return ids.length ? ids.map(mention).join(" ") : "ยังไม่มี";
}

function statusEmbed(current: Settings, note?: string) {
  const restoring = protectSettings().protectChannels;
  return new EmbedBuilder().setColor(COLOR.brand).setTitle("🛡️ ป้องกันเซิร์ฟเวอร์").setDescription([
    note ?? "",
    `**ลบห้อง:** ${current.antiNukeEnabled ? `คนทั่วไปลบครบ **${current.nukeChannelLimit} ห้อง** ใน 1 นาที ถูกถอดยศและพักการพิมพ์ 1 ชั่วโมง` : "Anti-nuke ปิดอยู่ ไม่ลงโทษ"}`,
    `**ห้องที่ถูกลบ:** ${restoring ? "บอทสร้างคืนทันที (ชื่อ หมวด ตำแหน่ง สิทธิ์เดิม) · ข้อความในห้องกู้คืนไม่ได้" : "ไม่สร้างคืน (ปิด \"ป้องกันการลบห้อง\" ในหน้าเว็บ)"}`,
    "",
    `**ลบห้องได้ ไม่ถูกลงโทษ ไม่ถูกสร้างคืน**`,
    `เจ้าของเซิร์ฟ · บอท · แอดมินของบอท`,
    `คน: ${list(current.nukeTrustedUserIds ?? [], (id) => `<@${id}>`)}`,
    `ยศ: ${list(current.nukeTrustedRoleIds ?? [], (id) => `<@&${id}>`)}`,
    "",
    "`/protect trust` เพิ่ม · `/protect untrust` เอาออก · `/protect limit` เปลี่ยนจำนวนห้อง",
  ].filter((line, index) => line || index > 0).join("\n"));
}

export async function onProtectCommand(interaction: ChatInputCommandInteraction) {
  const current = settings();
  if (!current) {
    await interaction.reply({ embeds: [errorEmbed("ยังโหลดการตั้งค่าไม่ได้", "ติดต่อเว็บไม่ได้ ลองใหม่อีกครั้งในอีกสักครู่")], flags: ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();
  if (sub === "status") {
    await interaction.reply({ embeds: [statusEmbed(current)], flags: ephemeral });
    return;
  }
  // Letting someone delete channels freely is the owner's call, like moving the bot to another server.
  if (!mayWipe(interaction.member as GuildMember)) {
    await interaction.reply({ embeds: [errorEmbed("ใช้ไม่ได้", "เปลี่ยนการป้องกันได้เฉพาะเจ้าของเซิร์ฟและคนที่มีสิทธิ์ Administrator")], flags: ephemeral });
    return;
  }
  const member = interaction.options.getUser("member");
  const role = interaction.options.getRole("role");
  const users = new Set(current.nukeTrustedUserIds ?? []);
  const roles = new Set(current.nukeTrustedRoleIds ?? []);
  let change: Partial<Settings>;
  let note: string;
  if (sub === "limit") {
    const count = interaction.options.getInteger("count", true);
    change = { nukeChannelLimit: count };
    note = `ตั้งแล้ว: ลบ ${count} ห้องใน 1 นาทีถูกลงโทษ`;
  } else {
    if (!member && !role) {
      await interaction.reply({ embeds: [errorEmbed("ยังไม่ได้เลือก", "เลือกสมาชิก (member) หรือยศ (role) อย่างน้อยหนึ่งอย่าง")], flags: ephemeral });
      return;
    }
    const add = sub === "trust";
    const notes: string[] = [];
    if (member) {
      if (add) users.add(member.id);
      else users.delete(member.id);
      notes.push(`<@${member.id}>`);
    }
    if (role) {
      if (add) roles.add(role.id);
      else roles.delete(role.id);
      notes.push(`<@&${role.id}>`);
    }
    change = { nukeTrustedUserIds: [...users], nukeTrustedRoleIds: [...roles] };
    note = add ? `ให้ลบห้องได้แล้ว: ${notes.join(" ")}` : `เอาออกจากคนที่ลบห้องได้แล้ว: ${notes.join(" ")}`;
  }
  await interaction.deferReply({ flags: ephemeral });
  try {
    const next = await updateSettings(interaction.user, change);
    await interaction.editReply({ embeds: [statusEmbed(next, `✅ ${note}`)], allowedMentions: { parse: [] } });
  } catch (error) {
    logBotError("protect", error);
    await interaction.editReply({ embeds: [errorEmbed("บันทึกไม่ได้", apiMessage(error, "ติดต่อเว็บไม่ได้ ลองใหม่อีกครั้ง"))] });
  }
}
