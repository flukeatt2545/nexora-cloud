import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type GuildMember,
  type PartialGuildMember,
  type TextChannel,
} from "discord.js";
import { assignable } from "./access";
import { api, apiMessage, logBotError } from "./api";
import { welcomeCard } from "./image";
import { fillTemplate, settings } from "./settings";
import { brandEmbed, COLOR, errorEmbed, linkButton, okEmbed, row, when } from "./ui";

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

/** A member left: say goodbye in the leave room, with a card when it is turned on. */
export async function onMemberLeave(member: GuildMember | PartialGuildMember) {
  const current = settings();
  const user = member.user;
  if (!current?.leaveEnabled || !current.leaveChannelId || !user || user.bot) return;
  const channel = member.guild.channels.cache.get(current.leaveChannelId);
  if (channel?.type !== ChannelType.GuildText && channel?.type !== ChannelType.GuildAnnouncement) return;
  const name = member.displayName || user.globalName || user.username;
  const text = fillTemplate(current.leaveMessage, { user: `**${name}**`, name, server: member.guild.name, count: member.guild.memberCount.toLocaleString("th-TH") });
  const embed = brandEmbed(COLOR.warn).setDescription(text).setTimestamp(new Date());
  const files: AttachmentBuilder[] = [];
  if (current.leaveImage) {
    try {
      const days = member.joinedTimestamp ? Math.max(0, Math.floor((Date.now() - member.joinedTimestamp) / 86400000)) : null;
      const picture = await welcomeCard({
        name, username: user.username, server: member.guild.name, count: member.guild.memberCount, leaving: { days },
        avatarUrl: user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }),
      });
      files.push(new AttachmentBuilder(picture, { name: "leave.png" }));
      embed.setImage("attachment://leave.png");
    } catch (error) {
      logBotError("leave image", error);
    }
  }
  await (channel as TextChannel).send({ embeds: [embed], files }).catch((error) => logBotError("leave message", error));
}

// The private message with the link is short-lived: it goes after ten seconds (the link itself
// lasts ten minutes, backend/discord_verify.go), and asking again removes the earlier one at once.
export const VERIFY_MESSAGE_MS = 10 * 1000;
const openLinks = new Map<string, ButtonInteraction>();

/** The private message with the link: the steps on the site, then how long the link and the message last. */
export function verifyLinkMessage(url: string, expiresInSeconds = 600, now = new Date()) {
  const linkEnds = new Date(now.getTime() + Math.max(60, expiresInSeconds) * 1000);
  const messageEnds = new Date(now.getTime() + VERIFY_MESSAGE_MS);
  const embed = brandEmbed()
    .setTitle("🔐 ยืนยันตัวตนผ่านเว็บ")
    .setDescription("ใช้เวลาไม่ถึงนาที ทำครั้งเดียวก็เห็นทุกห้องในเซิร์ฟ")
    .addFields(
      {
        name: "ขั้นตอน",
        value: [
          "**1.** กดปุ่ม **เปิดหน้ายืนยัน** ด้านล่าง",
          "**2.** เข้าสู่ระบบด้วย Discord บัญชีนี้ แล้วติ๊กช่องยืนยันว่าเป็นคน",
          "**3.** กลับมาที่ Discord ยศสมาชิกจะขึ้นให้เอง",
        ].join("\n"),
      },
      { name: "ลิงก์", value: `ใช้ได้ครั้งเดียว\nหมดอายุ ${when(linkEnds, "R")}`, inline: true },
      { name: "ข้อความนี้", value: `หายไปเอง ${when(messageEnds, "R")}`, inline: true },
    )
    .setFooter({ text: "ลิงก์เป็นของคุณคนเดียว อย่าส่งให้คนอื่น · ขอลิงก์ใหม่ได้ด้วยการกดยืนยันตัวตนอีกครั้ง" });
  return { embeds: [embed], components: [row(linkButton(url, "เปิดหน้ายืนยัน").setEmoji("🌐"))] };
}

/** Verify on the website: the member gets a one-time link in a private message. */
async function sendVerifyLink(interaction: ButtonInteraction) {
  try {
    const res = await api(interaction.user).post<{ url: string; expiresIn?: number }>("/api/internal/bot/community/verify/start", {
      userId: interaction.user.id, username: interaction.user.username,
    });
    await interaction.reply({ ...verifyLinkMessage(res.data.url, res.data.expiresIn), flags: ephemeral });
    // Only one message per member: the earlier one (if it is still there) goes now.
    const earlier = openLinks.get(interaction.user.id);
    openLinks.set(interaction.user.id, interaction);
    earlier?.deleteReply().catch(() => undefined);
    setTimeout(() => {
      interaction.deleteReply().catch(() => undefined);
      if (openLinks.get(interaction.user.id) === interaction) openLinks.delete(interaction.user.id);
    }, VERIFY_MESSAGE_MS).unref();
  } catch (error) {
    logBotError("verify link", error);
    await interaction.reply({ embeds: [errorEmbed("ยังยืนยันไม่ได้", apiMessage(error, "ขอลิงก์ยืนยันไม่สำเร็จ ลองใหม่อีกครั้ง"))], flags: ephemeral });
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
  if (current.verifyLevel && current.verifyLevel !== "button") return sendVerifyLink(interaction);
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
