import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { assignable } from "./access";
import { logBotError } from "./api";
import { welcomeCard } from "./image";
import { fillTemplate, settings } from "./settings";
import { brandEmbed, errorEmbed, okEmbed } from "./ui";

const ephemeral = MessageFlags.Ephemeral as const;

// Welcome (with a picture) and verification.

export async function onMemberJoin(member: GuildMember) {
  const current = settings();
  if (!current || member.user.bot) return;
  if (current.welcomeEnabled && current.welcomeChannelId) {
    const channel = member.guild.channels.cache.get(current.welcomeChannelId);
    if (channel?.type === ChannelType.GuildText) {
      const text = fillTemplate(current.welcomeMessage, {
        user: `<@${member.id}>`, name: member.displayName, server: member.guild.name, count: member.guild.memberCount.toLocaleString("th-TH"),
      });
      const embed = brandEmbed().setDescription(text);
      if (current.verifyEnabled && current.verifyChannelId) embed.addFields({ name: "เริ่มต้น", value: `ยืนยันตัวตนที่ <#${current.verifyChannelId}>` });
      const files: AttachmentBuilder[] = [];
      if (current.welcomeImage) {
        try {
          const picture = await welcomeCard({
            name: member.displayName, username: member.user.username, server: member.guild.name, count: member.guild.memberCount,
            avatarUrl: member.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }),
          });
          files.push(new AttachmentBuilder(picture, { name: "welcome.png" }));
          embed.setImage("attachment://welcome.png");
        } catch (error) {
          // The text alone is still a welcome.
          logBotError("welcome image", error);
          embed.setThumbnail(member.displayAvatarURL({ size: 128 }));
        }
      } else {
        embed.setThumbnail(member.displayAvatarURL({ size: 128 }));
      }
      await (channel as TextChannel).send({ content: `<@${member.id}>`, embeds: [embed], files, allowedMentions: { users: [member.id] } })
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
