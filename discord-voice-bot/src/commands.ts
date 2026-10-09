import {
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const roomOption = (required: boolean) => (option: import("discord.js").SlashCommandChannelOption) => option
  .setName("room")
  .setNameLocalizations({ th: "ห้อง" })
  .setDescription("ห้องเสียง")
  .addChannelTypes(ChannelType.GuildVoice)
  .setRequired(required);

export const commands = [
  new SlashCommandBuilder()
    .setName("room")
    .setNameLocalizations({ th: "ห้อง" })
    .setDescription("ห้องเสียงของบอท")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub
      .setName("create")
      .setNameLocalizations({ th: "สร้าง" })
      .setDescription("สร้างห้องที่ล็อกด้วยรหัส"))
    .addSubcommand((sub) => sub
      .setName("join")
      .setNameLocalizations({ th: "เข้า" })
      .setDescription("ใส่รหัสเพื่อเข้าห้อง")
      .addChannelOption(roomOption(true)))
    .addSubcommand((sub) => sub
      .setName("manage")
      .setNameLocalizations({ th: "จัดการ" })
      .setDescription("เปลี่ยนรหัส เตะคน หรือลบห้องของคุณ")
      .addChannelOption(roomOption(false)))
    .addSubcommand((sub) => sub
      .setName("history")
      .setNameLocalizations({ th: "ประวัติ" })
      .setDescription("ดูว่าเกิดอะไรขึ้นในห้องของคุณ ใครใส่รหัสผิด (เห็นแค่คุณ)")),

  new SlashCommandBuilder()
    .setName("setup-join-to-create")
    .setDescription("สร้างห้อง '+ คลิกเพื่อสร้างห้อง' (เข้าแล้วได้ห้องของตัวเอง)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("setup-room-log")
    .setDescription("ให้บอทส่ง log ห้องเสียงมาที่ห้องนี้")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("setup-voice-log")
    .setDescription("ให้บอทแจ้งที่ห้องนี้เมื่อมีคนออกจากห้องเสียง ว่าอยู่ห้องไหน นานเท่าไร")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("voice-history")
    .setDescription("ดูว่าอยู่ห้องเสียงไหน นานเท่าไร (เห็นแค่คุณ)")
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) => option
      .setName("member")
      .setNameLocalizations({ th: "สมาชิก" })
      .setDescription("ดูของใคร (เว้นไว้ = ของคุณเอง)")),

  new SlashCommandBuilder()
    .setName("setup-stop")
    .setDescription("ให้บอทเลิกใช้ห้องนี้ (แผง, log, + คลิกเพื่อสร้างห้อง) แล้วจะลบห้องได้โดยบอทไม่สร้างคืน")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName("setup-room-panel")
    .setDescription("ลงแผงห้องเสียงในห้องนี้")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
];
