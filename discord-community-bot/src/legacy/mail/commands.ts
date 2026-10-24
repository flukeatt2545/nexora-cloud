import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

const guildOnly = {
  integrationTypes: [ApplicationIntegrationType.GuildInstall],
  contexts: [InteractionContextType.Guild],
};

const everywhere = {
  integrationTypes: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
  contexts: [
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  ],
};

export const commands = [
  new SlashCommandBuilder()
    .setName("mail")
    .setDescription("ดูเมล สร้างเมลใหม่ และตั้งแจ้งเตือน (เห็นเฉพาะคุณ)")
    .setIntegrationTypes(everywhere.integrationTypes)
    .setContexts(everywhere.contexts),

  new SlashCommandBuilder()
    .setName("setup-mail-panel")
    .setDescription("ลงแผงดูเมลในห้องนี้")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setIntegrationTypes(guildOnly.integrationTypes)
    .setContexts(guildOnly.contexts),

  new SlashCommandBuilder()
    .setName("setup-mail-admin-panel")
    .setDescription("ลงแผงแอดมินระบบเมลในห้องนี้ (ควรเป็นห้องของทีมแอดมิน)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setIntegrationTypes(guildOnly.integrationTypes)
    .setContexts(guildOnly.contexts),

  new SlashCommandBuilder()
    .setName("mail-admin")
    .setDescription("เปิดแผงจัดการระบบเมล")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setIntegrationTypes(guildOnly.integrationTypes)
    .setContexts(guildOnly.contexts),

  new SlashCommandBuilder()
    .setName("mail-bind")
    .setDescription("ผูกบัญชี Discord กับกล่องเมล")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setIntegrationTypes(guildOnly.integrationTypes)
    .setContexts(guildOnly.contexts)
    .addUserOption((option) =>
      option.setName("user").setDescription("สมาชิกที่ต้องการให้ดูเมล").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("address").setDescription("ที่อยู่อีเมล เช่น name@nkn02.com").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("mail-unbind")
    .setDescription("ปลดการผูกบัญชี Discord กับกล่องเมล")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setIntegrationTypes(guildOnly.integrationTypes)
    .setContexts(guildOnly.contexts)
    .addUserOption((option) =>
      option.setName("user").setDescription("สมาชิกที่ต้องการปลด").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("address").setDescription("ปลดเฉพาะกล่องนี้ หรือเว้นว่างเพื่อปลดทุกกล่อง").setRequired(false)
    ),
];
