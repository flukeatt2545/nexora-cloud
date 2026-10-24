import { ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type Client, type GuildMember } from "discord.js";
import { logBotError } from "./api";
import { homeGuild } from "./guild";
import { bannerFile } from "./image";
import { postPanel, removePanel } from "./panels";
import { settings } from "./settings";
import { brandEmbed, COLOR, row, when } from "./ui";

const ephemeral = MessageFlags.Ephemeral as const;

// The role-check room: one panel with a button. A member presses it and sees their own roles
// (only they see the answer); nobody can look up someone else's.

export async function refreshRoleCheck(client: Client, repost = false) {
  const guild = homeGuild(client);
  const current = settings();
  if (!guild) return;
  if (!current?.roleCheckEnabled || !current.roleCheckChannelId) {
    await removePanel(guild, "roleCheck").catch(() => undefined);
    return;
  }
  const embed = brandEmbed()
    .setImage("attachment://roles.png")
    .setDescription("กดปุ่มด้านล่างเพื่อดูยศทั้งหมดของคุณ\nคนอื่นไม่เห็นคำตอบ มีแค่คุณที่เห็น");
  await postPanel(guild, "roleCheck", current.roleCheckChannelId, {
    embeds: [embed],
    components: [row(new ButtonBuilder().setCustomId("cm:rolecheck:me").setStyle(ButtonStyle.Primary).setLabel("เช็คยศของฉัน").setEmoji("🏷️"))],
    files: [await bannerFile("roles")],
  }, repost);
}

export async function onRoleCheckButton(interaction: ButtonInteraction) {
  const member = interaction.member as GuildMember;
  const roles = [...member.roles.cache.values()].filter((role) => role.id !== member.guild.id).sort((a, b) => b.position - a.position);
  const highest = roles[0];
  const embed = brandEmbed(highest?.color ? highest.color : COLOR.brand)
    .setTitle("ยศของคุณ")
    .setThumbnail(member.displayAvatarURL({ size: 128 }))
    .setDescription(roles.length ? roles.map((role) => `${role}`).join(" ") : "_ยังไม่มียศ_")
    .addFields({ name: "ยศสูงสุด", value: highest ? `${highest}` : "—", inline: true });
  if (member.joinedAt) embed.addFields({ name: "เข้าเซิร์ฟ", value: `${when(member.joinedAt, "D")} (${when(member.joinedAt, "R")})`, inline: true });
  if (member.premiumSince) embed.addFields({ name: "บูสต์เซิร์ฟ", value: `ตั้งแต่ ${when(member.premiumSince, "D")}`, inline: true });
  await interaction.reply({ embeds: [embed], flags: ephemeral }).catch((error) => logBotError("role check", error));
}
