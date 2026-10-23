import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type GuildMember,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { assignable } from "./access";
import { logBotError } from "./api";
import { fillTemplate, settings } from "./settings";
import { COLOR, errorEmbed, okEmbed, row } from "./ui";

const ephemeral = MessageFlags.Ephemeral as const;

// Welcome, verification and the roles members pick for themselves.

export async function onMemberJoin(member: GuildMember) {
  const current = settings();
  if (!current || member.user.bot) return;
  if (current.welcomeEnabled && current.welcomeChannelId) {
    const channel = member.guild.channels.cache.get(current.welcomeChannelId);
    if (channel?.type === ChannelType.GuildText) {
      const text = fillTemplate(current.welcomeMessage, {
        user: `<@${member.id}>`, name: member.displayName, server: member.guild.name, count: member.guild.memberCount.toLocaleString("th-TH"),
      });
      const embed = new EmbedBuilder().setColor(COLOR.brand).setDescription(text).setThumbnail(member.displayAvatarURL({ size: 128 }));
      if (current.verifyEnabled && current.verifyChannelId) embed.addFields({ name: "เริ่มต้น", value: `ยืนยันตัวตนที่ <#${current.verifyChannelId}>` });
      await (channel as TextChannel).send({ content: `<@${member.id}>`, embeds: [embed], allowedMentions: { users: [member.id] } })
        .catch((error) => logBotError("welcome", error));
    }
  }
  // No verification step: members get the member role straight away.
  if (!current.verifyEnabled && current.memberRoleId && assignable(member.guild, current.memberRoleId)) {
    await member.roles.add(current.memberRoleId, "สมาชิกใหม่").catch((error) => logBotError("member role", error));
  }
}

export async function onVerify(interaction: ButtonInteraction) {
  const current = settings();
  const member = interaction.member as GuildMember;
  const roleId = current?.memberRoleId ?? "";
  if (!current?.verifyEnabled || !roleId) {
    await interaction.reply({ embeds: [errorEmbed("ยังยืนยันไม่ได้", "แอดมินยังไม่ได้ตั้งยศสมาชิก ลองบอกทีมงานดูนะ")], flags: ephemeral });
    return;
  }
  if (member.roles.cache.has(roleId)) {
    await interaction.reply({ embeds: [okEmbed("ยืนยันแล้ว", "คุณยืนยันตัวตนไว้แล้ว เห็นห้องอื่น ๆ ได้เลย")], flags: ephemeral });
    return;
  }
  if (!assignable(member.guild, roleId)) {
    await interaction.reply({ embeds: [errorEmbed("ยังยืนยันไม่ได้", "บอทให้ยศสมาชิกไม่ได้ (ยศอยู่สูงกว่ายศของบอท) ลองบอกทีมงานดูนะ")], flags: ephemeral });
    return;
  }
  try {
    await member.roles.add(roleId, "กดยืนยันตัวตน");
  } catch (error) {
    logBotError("verify", error);
    await interaction.reply({ embeds: [errorEmbed("ยืนยันไม่สำเร็จ", "ลองใหม่อีกครั้ง")], flags: ephemeral });
    return;
  }
  const next = current.rolesChannelId && current.selfRoleIds.length ? `\nเลือกยศเพิ่มได้ที่ <#${current.rolesChannelId}>` : "";
  await interaction.reply({ embeds: [okEmbed("ยืนยันแล้ว ยินดีต้อนรับ!", `ตอนนี้คุณเห็นห้องอื่น ๆ ในเซิร์ฟแล้ว${next}`)], flags: ephemeral });
}

function pickableRoles(member: GuildMember) {
  return (settings()?.selfRoleIds ?? []).filter((id) => assignable(member.guild, id));
}

/** The "pick roles" button: a menu (only this member sees it) with their current roles ticked. */
export async function onRolesOpen(interaction: ButtonInteraction) {
  const member = interaction.member as GuildMember;
  const ids = pickableRoles(member);
  if (!ids.length) {
    await interaction.reply({ embeds: [errorEmbed("ยังไม่มียศให้เลือก", "แอดมินยังไม่ได้ตั้งยศให้เลือก")], flags: ephemeral });
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("cm:roles:set")
    .setPlaceholder("เลือกยศที่อยากได้ (เอาติ๊กออก = เอายศออก)")
    .setMinValues(0)
    .setMaxValues(ids.length)
    .addOptions(ids.map((id) => ({
      label: (member.guild.roles.cache.get(id)?.name ?? id).slice(0, 100),
      value: id,
      default: member.roles.cache.has(id),
    })));
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLOR.brand).setTitle("เลือกยศ").setDescription("ติ๊กยศที่อยากได้ เอาติ๊กออกเพื่อเอายศออก")],
    components: [row(menu)],
    flags: ephemeral,
  });
}

export async function onRolesSet(interaction: StringSelectMenuInteraction) {
  const member = interaction.member as GuildMember;
  const allowed = pickableRoles(member);
  const picked = interaction.values.filter((id) => allowed.includes(id));
  const add = picked.filter((id) => !member.roles.cache.has(id));
  const remove = allowed.filter((id) => !picked.includes(id) && member.roles.cache.has(id));
  try {
    if (add.length) await member.roles.add(add, "เลือกยศเอง");
    if (remove.length) await member.roles.remove(remove, "เลือกยศเอง");
  } catch (error) {
    logBotError("self roles", error);
    await interaction.update({ embeds: [errorEmbed("เปลี่ยนยศไม่สำเร็จ", "ลองใหม่อีกครั้ง")], components: [] });
    return;
  }
  const names = (ids: string[]) => ids.map((id) => `<@&${id}>`).join(" ");
  const lines = [add.length ? `ได้ยศ ${names(add)}` : "", remove.length ? `เอายศ ${names(remove)} ออกแล้ว` : ""].filter(Boolean);
  await interaction.update({ embeds: [okEmbed("เรียบร้อย", lines.join("\n") || "ไม่มีอะไรเปลี่ยน")], components: [] });
}

