import { REST, Routes, type Client, type Guild } from "discord.js";
import { logBotError } from "./api";
import { refreshBoost } from "./boost";
import { ensureSetupChannel } from "./build";
import { commands } from "./commands";
import { homeGuild, homeGuildId, markApplied, reportGuild } from "./guild";
import { removePanel, syncPanels, textChannel } from "./panels";
import { loadSettings, panels, settings, settingsVersion, updateSettings } from "./settings";
import { updateStats } from "./stats";
import { refreshStatusPicture } from "./status";

// Applying the settings: commands in the right server, panels where they belong, stats names,
// then telling the site which version is in place and what did not work.

let registeredIn = "";
let applying: Promise<void> | null = null;

/** Commands only in the server the bot looks after; any other server it is in gets none. */
async function registerCommands(client: Client) {
  const home = homeGuildId(client);
  if (!client.application || home === registeredIn) return;
  const rest = new REST({ version: "10" }).setToken(client.token ?? "");
  for (const id of client.guilds.cache.keys()) {
    await rest.put(Routes.applicationGuildCommands(client.application.id, id), { body: id === home ? commands.map((command) => command.toJSON()) : [] })
      .catch((error) => logBotError(`register commands ${id}`, error));
  }
  registeredIn = home;
  console.log(`[INFO] Community bot commands registered in ${home || "no server"}`);
}

/** Any server other than the one it looks after: leave it. */
async function leaveOtherServers(client: Client) {
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === homeGuildId()) continue;
    console.log(`[INFO] Leaving server ${guild.id}: this bot only works in ${homeGuildId()}`);
    await guild.leave().catch((error) => logBotError(`leave ${guild.id}`, error));
  }
}

/**
 * The "pick roles" room is gone from the bot: its panel is deleted, and so is the room when the
 * panel was all that was in it. The roles themselves stay.
 */
async function removeRolesRoom(guild: Guild) {
  const current = settings();
  if (!current || !(current.rolesChannelId || current.selfRoleIds.length || panels().roles.messageId)) return;
  await removePanel(guild, "roles");
  const channel = textChannel(guild, current.rolesChannelId);
  if (channel) {
    const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    if (messages && messages.every((message) => message.author.id === guild.client.user.id)) {
      await channel.delete("เอาห้องเลือกยศออก").catch((error) => logBotError("delete roles room", error));
    }
  }
  await updateSettings("", { rolesChannelId: "", selfRoleIds: [] }).catch((error) => logBotError("clear roles settings", error));
}

export function forgetRegistration() {
  registeredIn = "";
}

async function run(client: Client, repost: boolean) {
  // The web page shows which server the bot is locked to.
  const current = settings();
  if (current && current.guildId !== homeGuildId()) {
    await updateSettings("", { guildId: homeGuildId() }).catch((error) => logBotError("save guild", error));
  }
  await leaveOtherServers(client);
  await registerCommands(client);
  const guild = homeGuild(client);
  if (!guild || !settings()) {
    markApplied();
    return;
  }
  await ensureSetupChannel(guild);
  await removeRolesRoom(guild);
  await syncPanels(guild, repost);
  await refreshBoost(client, repost).catch((error) => logBotError("boost panel", error));
  await refreshStatusPicture(client, true).catch((error) => logBotError("status picture", error));
  await updateStats(client);
  markApplied(settingsVersion());
  await reportGuild(client);
}

/** Applies the current settings; calls made while one is running wait for it, then run again. */
export async function applySettings(client: Client, repost = false) {
  while (applying) await applying;
  applying = run(client, repost).catch((error) => logBotError("apply settings", error)).finally(() => { applying = null; });
  await applying;
}

/** Every 15 seconds: new settings saved on the web page are applied. */
export function watchSettings(client: Client) {
  setInterval(async () => {
    if (await loadSettings()) {
      console.log(`[INFO] Settings changed (version ${settingsVersion()}); applying`);
      await applySettings(client);
    }
  }, 15000).unref();
}
