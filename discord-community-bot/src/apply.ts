import { REST, Routes, type Client } from "discord.js";
import { logBotError } from "./api";
import { commands } from "./commands";
import { homeGuild, homeGuildId, markApplied, reportGuild } from "./guild";
import { syncPanels } from "./panels";
import { loadSettings, settings, settingsVersion, updateSettings } from "./settings";
import { updateStats } from "./stats";

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

/** A server joined later: make it the home server if none was chosen. */
export function forgetRegistration() {
  registeredIn = "";
}

async function run(client: Client, repost: boolean) {
  // No server chosen anywhere, and the bot is in exactly one: that one, saved for the web page.
  const current = settings();
  const home = homeGuild(client);
  if (current && !current.guildId && home) {
    await updateSettings("", { guildId: home.id }).catch((error) => logBotError("save guild", error));
  }
  await registerCommands(client);
  const guild = homeGuild(client);
  if (!guild || !settings()) {
    markApplied();
    return;
  }
  await syncPanels(guild, repost);
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
