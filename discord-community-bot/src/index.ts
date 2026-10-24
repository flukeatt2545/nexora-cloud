import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type Guild,
  type Interaction,
} from "discord.js";
import { api, logBotError } from "./api";
import { applySettings, forgetRegistration, watchSettings } from "./apply";
import { startBot } from "./bot-token";
import { onMemberUpdate as onBoostMemberUpdate, refreshBoost, startBoost } from "./boost";
import { API_URL, BOT_SECRET, ENV_TOKEN } from "./config";
import { ensureSetupChannel } from "./build";
import { isHome, reportGuild, reportSoon } from "./guild";
import { checkRateLimit } from "./limits";
import { attachLegacy, handleLegacy, legacyOwner, startLegacy } from "./legacy";
import { communityCommandNames } from "./commands";
import { onMemberJoin, onMemberLeave, onVerify } from "./members";
import { onMessageDeleted } from "./panels";
import { onRoleCheckButton } from "./rolecheck";
import { announceRestore, onAuditLogEntry, onSecurityJoin, onSecurityMessage, startSiteSecurityFeed } from "./security";
import { loadSettings, settings, updateSettings } from "./settings";
import { onProtectCommand } from "./guard";
import { isRoomChannel } from "./legacy/voice/rooms";
import { noteChannelDeleted, onChannelRestored } from "./trust";
import { CHANNEL_KEYS, onCreateCommand, onSetupCommand, onSetupComponent, onSetupText, onWipeSubmit } from "./setup";
import { startStats, updateStats } from "./stats";
import { startStatusChecks } from "./status";
import { onChannelGone as onTempChannelGone, onVoiceState as onTempVoiceState, syncTempRooms } from "./tempvoice";
import {
  onChannelGone as onTicketChannelGone,
  onTicketButton,
  onTicketClaim,
  onTicketCloseButton,
  onTicketCloseSubmit,
  onTicketCommand,
  onTicketCreate,
  syncTickets,
} from "./tickets";
import { errorEmbed } from "./ui";

// GuildMembers (privileged): welcome new members. MessageContent (privileged): ticket
// transcripts and the spam filter. Both must be turned on for this bot on the Developer Portal's Bot page.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    // Bans and audit log entries for the security room (not a privileged intent).
    GatewayIntentBits.GuildModeration,
    // The voice-room protection logs what AutoMod stopped; the NEXORA module answers !code and
    // !db in DMs, which also needs the Channel partial.
    GatewayIntentBits.AutoModerationExecution,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// The voice-room, mail and NEXORA modules listen on this same connection.
attachLegacy(client);

// First on every channel delete (before the voice-room module and this bot's own handlers): note
// the rooms that come and go on their own, so deleting them is neither counted nor undone.
client.prependListener(Events.ChannelDelete, (channel) => {
  if (channel.isDMBased() || !isHome(channel.guild)) return;
  noteChannelDeleted(channel, isRoomChannel(channel.id));
});

// The voice-room module put a deleted channel back: whatever pointed at the old one (the welcome
// room, the ticket category, the panels) now points at the new one, and the security room is told.
onChannelRestored(async (oldId, oldName, made, deleterId) => {
  if (!isHome(made.guild)) return;
  const current = settings();
  const change: Record<string, string> = {};
  if (current) for (const key of CHANNEL_KEYS) if (current[key] === oldId) change[key] = made.id;
  if (Object.keys(change).length) {
    await updateSettings(client.user!.id, change).catch((error) => logBotError("remap restored channel", error));
    await applySettings(client);
  }
  await announceRestore(made.guild, oldName, made, deleterId);
});

const ephemeral = MessageFlags.Ephemeral as const;

let lastPresenceKey = "";

async function syncPresence() {
  let activityType = "watching";
  let activityText = "เซิร์ฟเวอร์";
  try {
    const res = await api().get("/api/internal/bot/presence/community");
    if (res.data?.activityType) activityType = String(res.data.activityType);
    if (res.data?.activityText) activityText = String(res.data.activityText);
  } catch {
    // Keep the last one if the site is briefly unavailable.
  }
  const key = `${activityType}:${activityText}`;
  if (key === lastPresenceKey) return;
  const types: Record<string, ActivityType> = {
    playing: ActivityType.Playing,
    listening: ActivityType.Listening,
    competing: ActivityType.Competing,
    custom: ActivityType.Custom,
  };
  const type = types[activityType] ?? ActivityType.Watching;
  client.user?.setPresence({
    status: "online",
    activities: [type === ActivityType.Custom ? { name: "Custom Status", type, state: activityText } : { name: activityText, type }],
  });
  lastPresenceKey = key;
}

client.once(Events.ClientReady, async (ready) => {
  console.log(`[READY] Community bot logged in as ${ready.user.tag} (${ready.guilds.cache.size} server(s))`);
  await loadSettings();
  await syncPresence();
  await applySettings(client);
  await syncTickets(client);
  await syncTempRooms(client);
  startStatusChecks(client, () => void updateStats(client));
  startStats(client);
  startBoost(client);
  startSiteSecurityFeed(client);
  watchSettings(client);
  setInterval(() => void syncPresence(), 15000).unref();
  // The channel and role lists on the web page stay fresh even without changes here.
  setInterval(() => void reportGuild(client), 60000).unref();
  // Last: the caches and loops of the voice-room, mail and NEXORA modules.
  await startLegacy();
});

// Added to a server: the one it looks after gets set up; any other is left (apply.ts).
client.on(Events.GuildCreate, (guild) => {
  console.log(`[INFO] Added to server ${guild.id}`);
  forgetRegistration();
  void applySettings(client);
});

client.on(Events.GuildDelete, () => {
  forgetRegistration();
});

client.on(Events.GuildMemberAdd, (member) => {
  if (!isHome(member.guild)) return;
  onSecurityJoin(member)
    .then((kicked) => (kicked ? undefined : onMemberJoin(member)))
    .catch((error) => logBotError("member join", error));
});

// Someone starts boosting, or the server's boost level changes: the boost panel follows.
client.on(Events.GuildMemberUpdate, (before, after) => {
  if (!isHome(after.guild)) return;
  onBoostMemberUpdate(before, after).catch((error) => logBotError("boost member", error));
});

client.on(Events.GuildUpdate, (before, after) => {
  if (!isHome(after) || (before.premiumTier === after.premiumTier && before.premiumSubscriptionCount === after.premiumSubscriptionCount)) return;
  refreshBoost(client).catch((error) => logBotError("boost panel", error));
});

client.on(Events.GuildMemberRemove, (member) => {
  if (!isHome(member.guild)) return;
  onMemberLeave(member).catch((error) => logBotError("member leave", error));
});

client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
  onAuditLogEntry(entry, guild).catch((error) => logBotError("audit log entry", error));
});

client.on(Events.MessageCreate, (message) => {
  onSecurityMessage(message).catch((error) => logBotError("spam filter", error));
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  onTempVoiceState(oldState, newState).catch((error) => logBotError("voice state", error));
});

// The last text channel deleted: make the setup room, so there is somewhere to type /setup.
let emptyCheck: NodeJS.Timeout | null = null;

client.on(Events.ChannelDelete, (channel) => {
  if (channel.isDMBased() || !isHome(channel.guild)) return;
  onTicketChannelGone(channel.id);
  onTempChannelGone(channel.id);
  reportSoon(client);
  if (emptyCheck) clearTimeout(emptyCheck);
  emptyCheck = setTimeout(() => void ensureSetupChannel(channel.guild), 5000);
});

// Channels and roles changed by hand: the web page's pickers get the new lists.
const changedHere = (guild: Guild | null) => {
  if (isHome(guild)) reportSoon(client);
};
client.on(Events.ChannelCreate, (channel) => changedHere(channel.guild));
client.on(Events.ChannelUpdate, (_old, channel) => changedHere(channel.isDMBased() ? null : channel.guild));
client.on(Events.GuildRoleCreate, (role) => changedHere(role.guild));
client.on(Events.GuildRoleUpdate, (_old, role) => changedHere(role.guild));
client.on(Events.GuildRoleDelete, (role) => changedHere(role.guild));

// One of the panels deleted: post it again.
client.on(Events.MessageDelete, (message) => {
  if (!isHome(message.guild)) return;
  void onMessageDeleted(message.id).then((wasPanel) => { if (wasPanel) void applySettings(client); });
});

async function route(interaction: Interaction) {
  // The voice-room, mail and NEXORA modules answer their own commands, buttons and forms (some
  // of them also in DMs); everything else here is the community bot's.
  const owner = legacyOwner(interaction, communityCommandNames);
  if (owner) {
    await handleLegacy(owner, interaction);
    return;
  }
  if (!interaction.inGuild() || !interaction.isRepliable()) return;
  if (!isHome(interaction.guild)) {
    await interaction.reply({ embeds: [errorEmbed("ใช้ในเซิร์ฟนี้ไม่ได้", "บอทนี้ดูแลเฉพาะเซิร์ฟที่แอดมิน NEXORA ตั้งไว้")], flags: ephemeral });
    return;
  }
  const limit = checkRateLimit(interaction.user.id);
  if (!limit.allowed) {
    await interaction.reply({ embeds: [errorEmbed("ช้าลงหน่อย", `ลองใหม่ในอีก ${limit.waitSeconds} วินาที`)], flags: ephemeral });
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "setup") await onSetupCommand(interaction);
    else if (interaction.commandName === "create") await onCreateCommand(interaction);
    else if (interaction.commandName === "protect") await onProtectCommand(interaction);
    else if (interaction.commandName === "ticket") await onTicketCommand(interaction);
    return;
  }
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    if (id === "cm:ticket:create") await onTicketCreate(interaction);
    else if (id.startsWith("cm:ticket:closing:")) await onTicketCloseSubmit(interaction);
    else if (id.startsWith("cm:text:")) await onSetupText(interaction);
    else if (id === "cm:wipe") await onWipeSubmit(interaction);
    return;
  }
  if (!interaction.isMessageComponent()) return;
  const id = interaction.customId;
  if (interaction.isButton()) {
    if (id === "cm:verify") return onVerify(interaction);
    if (id === "cm:ticket:open") return onTicketButton(interaction);
    if (id === "cm:rolecheck:me") return onRoleCheckButton(interaction);
    if (id.startsWith("cm:ticket:claim:")) return onTicketClaim(interaction);
    if (id.startsWith("cm:ticket:close:")) return onTicketCloseButton(interaction);
  }
  if (id.startsWith("cm:setup:") || id.startsWith("cm:set:") || id.startsWith("cm:clear:")) {
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
      await onSetupComponent(interaction);
    }
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  route(interaction).catch(async (error) => {
    logBotError(`interaction ${interaction.isCommand() ? interaction.commandName : "customId" in interaction ? interaction.customId : ""}`, error);
    if (!interaction.isRepliable()) return;
    const payload = { embeds: [errorEmbed("มีบางอย่างผิดพลาด", "ลองใหม่อีกครั้ง")], components: [] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => undefined);
    else await interaction.reply({ ...payload, flags: ephemeral }).catch(() => undefined);
  });
});

process.on("unhandledRejection", (error) => logBotError("unhandled", error));

void startBot({ botKey: "community", envToken: ENV_TOKEN, apiUrl: API_URL, secret: BOT_SECRET, client });
