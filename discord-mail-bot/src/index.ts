import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  type TextBasedChannel,
} from "discord.js";
import { adminPanelMessage, handleAdminComponent, handleAdminModal, handleAdminPanelButton, showAdminHome } from "./admin-panel";
import { api, apiMessage, logBotError } from "./api";
import { commands } from "./commands";
import { startBot } from "./bot-token";
import { API_URL, BOT_SECRET, CLIENT_ID, GUILD_ID, TOKEN, isMailSystemAdmin, mailAdminIds } from "./config";
import { checkPrivilegedRateLimit, checkRateLimit } from "./limits";
import { startNotifications } from "./notify";
import { errorEmbed, flash } from "./ui";
import { handlePanelButton, handleUserComponent, handleUserModal, showHome, userPanelMessage } from "./user-panel";

async function registerSlashCommands() {
  // The client id comes from .env or, with a token set on the web page, from Discord itself.
  const applicationId = CLIENT_ID || client.application?.id;
  if (!client.token || !applicationId) return;
  const rest = new REST({ version: "10" }).setToken(client.token);
  const body = commands.map((command) => command.toJSON());
  // Global only: /mail also works in DMs. A guild copy made every command show twice in that
  // server, so clear any guild copy left from earlier versions.
  await rest.put(Routes.applicationCommands(applicationId), { body });
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(applicationId, GUILD_ID), { body: [] });
  }
  console.log("[INFO] Registered mail bot slash commands");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function activityTypeFromName(value: string) {
  switch ((value || "").trim().toLowerCase()) {
    case "playing":
      return ActivityType.Playing;
    case "listening":
      return ActivityType.Listening;
    case "competing":
      return ActivityType.Competing;
    case "custom":
      return ActivityType.Custom;
    default:
      return ActivityType.Watching;
  }
}

function presenceActivity(activityType: string, activityText: string) {
  const type = activityTypeFromName(activityType);
  if (type === ActivityType.Custom) {
    return { name: "Custom Status", type, state: activityText };
  }
  return { name: activityText, type };
}

let lastPresenceKey = "";

async function syncMailBotPresence() {
  let activityType = process.env.MAIL_DISCORD_ACTIVITY_TYPE || "watching";
  let activityText = process.env.MAIL_DISCORD_ACTIVITY_TEXT || "เมลของคุณ";
  try {
    const res = await api().get("/api/internal/bot/mail/presence");
    if (res.data?.activityType) activityType = String(res.data.activityType);
    if (res.data?.activityText) activityText = String(res.data.activityText);
  } catch {
    // Keep the last known or env fallback if the API is briefly unavailable.
  }
  activityText = activityText.trim() || "เมลของคุณ";
  const key = `${activityType}:${activityText}`;
  if (key === lastPresenceKey) return;
  await client.user?.setPresence({
    status: "online",
    activities: [presenceActivity(activityType, activityText)],
  });
  lastPresenceKey = key;
}

client.once(Events.ClientReady, async (ready) => {
  console.log(`[READY] Mail bot logged in as ${ready.user.tag}`);
  console.log(`[INVITE] https://discord.com/oauth2/authorize?client_id=${ready.application.id}`);
  if (mailAdminIds().length === 0) {
    console.warn("[WARN] MAIL_DISCORD_ADMIN_IDS is empty; admin commands are disabled");
  }
  try {
    await syncMailBotPresence();
  } catch {
    console.error("[ERROR] Failed to set mail bot presence");
  }
  setInterval(() => {
    void syncMailBotPresence();
  }, 15000);
  try {
    await registerSlashCommands();
  } catch {
    console.error("[ERROR] Failed to register slash commands");
  }
  startNotifications(client);
});

/** Removes this bot's earlier panels of the same kind from the channel, so only the new one stays. */
async function removeOldPanels(channel: TextBasedChannel, panelButtonId: string) {
  if (!("messages" in channel)) return 0;
  const recent = await channel.messages.fetch({ limit: 50 });
  const old = recent.filter(
    (message) =>
      message.author.id === client.user?.id &&
      message.components.some((component) => JSON.stringify(component.toJSON()).includes(`"custom_id":"${panelButtonId}"`))
  );
  for (const message of old.values()) {
    await message.delete().catch(() => undefined);
  }
  return old.size;
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isRepliable()) return;
    const rate = checkRateLimit(interaction.user.id);
    if (!rate.allowed) {
      const payload = {
        embeds: [errorEmbed("ช้าลงนิดหนึ่ง", `รออีก ${rate.waitSeconds || 1} วินาที แล้วลองใหม่`)],
        flags: MessageFlags.Ephemeral as const,
      };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
      return;
    }

    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      const id = interaction.customId;
      if (interaction.isButton() && (id === "mail:inbox" || id === "mail:create")) {
        await handlePanelButton(interaction);
      } else if (interaction.isButton() && id.startsWith("mailadm:")) {
        await handleAdminPanelButton(interaction);
      } else if (id.startsWith("a:")) {
        await handleAdminComponent(interaction);
      } else if (id.startsWith("m:") && !interaction.isUserSelectMenu()) {
        await handleUserComponent(interaction);
      } else {
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: "เมนูนี้หมดอายุแล้ว พิมพ์ /mail เพื่อเปิดใหม่" });
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("a:")) await handleAdminModal(interaction);
      else if (interaction.customId.startsWith("m:")) await handleUserModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;

    if (name === "mail") {
      await showHome(interaction, "reply");
      return;
    }

    if (name === "setup-mail-panel" || name === "setup-mail-admin-panel") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [errorEmbed("ไม่มีสิทธิ์", "คำสั่งนี้ใช้ได้เฉพาะแอดมินของห้อง")] });
        return;
      }
      if (name === "setup-mail-admin-panel" && !isMailSystemAdmin(interaction.user.id)) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [errorEmbed("ไม่มีสิทธิ์", "ใช้ได้เฉพาะผู้ดูแลระบบเมลที่ได้รับอนุญาต")] });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const channel = interaction.channel;
      if (!channel || !("send" in channel)) {
        await interaction.editReply({ embeds: [errorEmbed("ลงแผงไม่ได้", "ใช้คำสั่งนี้ในห้องข้อความของเซิร์ฟเวอร์")] });
        return;
      }
      const userPanel = name === "setup-mail-panel";
      try {
        // Without Read Message History the old panel stays, but the new one is still posted.
        const removed = await removeOldPanels(channel, userPanel ? "mail:inbox" : "mailadm:open").catch(() => 0);
        await channel.send(userPanel ? userPanelMessage() : adminPanelMessage());
        const replaced = removed ? " และลบแผงเก่าออกแล้ว" : "";
        await flash(
          interaction,
          userPanel ? `ลงแผงเมลแล้ว${replaced}` : `ลงแผงจัดการระบบเมลแล้ว${replaced} ควรใช้ในห้องที่เห็นเฉพาะทีมแอดมิน`
        );
      } catch {
        await interaction.editReply({ embeds: [errorEmbed("ลงแผงไม่สำเร็จ", "ตรวจว่าบอทมีสิทธิ์ดูห้อง ส่งข้อความ และอ่านประวัติข้อความในห้องนี้")] });
      }
      return;
    }

    if (name === "mail-admin") {
      await showAdminHome(interaction, "reply");
      return;
    }

    if (name === "mail-bind" || name === "mail-unbind") {
      if (!isMailSystemAdmin(interaction.user.id)) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [errorEmbed("ไม่มีสิทธิ์", "คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบเมลที่ได้รับอนุญาต")] });
        return;
      }
      const privileged = checkPrivilegedRateLimit(interaction.user.id);
      if (!privileged.allowed) {
        await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [errorEmbed("ช้าลงนิดหนึ่ง", `รออีก ${privileged.waitSeconds || 30} วินาที แล้วลองใหม่`)] });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const user = interaction.options.getUser("user", true);
      const address = interaction.options.getString("address") || "";
      try {
        if (name === "mail-bind") {
          const res = await api(interaction.user.id).post("/api/internal/bot/mail/bind", {
            discordUserId: user.id,
            discordUsername: user.username,
            address,
          });
          await interaction.editReply({ content: `ผูกเมลให้แล้ว ${user} ดูกล่อง \`${res.data.address}\` ได้แล้ว` });
        } else {
          await api(interaction.user.id).delete("/api/internal/bot/mail/bind", {
            data: { discordUserId: user.id, discordUsername: user.username, address },
          });
          await interaction.editReply({
            content: address ? `ปลด ${user} จาก \`${address}\` แล้ว` : `ปลดการผูกเมลของ ${user} ทั้งหมดแล้ว`,
          });
        }
      } catch (error) {
        logBotError(name, error);
        await interaction.editReply({ embeds: [errorEmbed("ทำรายการไม่สำเร็จ", apiMessage(error, "ตรวจที่อยู่อีเมล หรือลองใหม่ภายหลัง"))] });
      }
    }
  } catch (error) {
    logBotError("interaction", error);
    if (interaction.isRepliable()) {
      const payload = { flags: MessageFlags.Ephemeral as const, embeds: [errorEmbed("เกิดข้อผิดพลาด", "ลองใหม่อีกครั้ง")] };
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: payload.embeds, components: [] });
        else await interaction.reply(payload);
      } catch {
        // The interaction may have expired; nothing else to do.
      }
    }
  }
});

void startBot({ botKey: "mail", envToken: TOKEN, apiUrl: API_URL, secret: BOT_SECRET, client });
