import type { Client, Interaction } from "discord.js";
import { logBotError } from "../api";
import type { LegacyBot } from "./host";
import { commands as mailCommands } from "./mail/commands";
import { mailBot } from "./mail/index";
import { commands as nexoraCommands } from "./nexora/commands";
import { nexoraBot } from "./nexora/index";
import { commands as voiceCommands } from "./voice/commands";
import { voiceBot } from "./voice/index";

// The three bots that were folded into this one: voice rooms, mail and NEXORA (student
// databases, uploads, security panel). The host decides which of them owns an interaction.

export const legacyBots: LegacyBot[] = [voiceBot, mailBot, nexoraBot];

/** Commands registered in the server (everything but mail, which also works in DMs). */
export const legacyGuildCommands = [...voiceCommands, ...nexoraCommands];
/** Mail's commands are global, so /mail works in DMs too, as it did. */
export const legacyGlobalCommands = mailCommands;

const names = (list: { name: string }[]) => new Set(list.map((command) => command.name));
const owners: { bot: LegacyBot; commands: Set<string>; prefixes: string[] }[] = [
  { bot: voiceBot, commands: names(voiceCommands), prefixes: ["vr:"] },
  { bot: mailBot, commands: names(mailCommands), prefixes: ["mail:", "mailadm:", "a:", "m:"] },
];
const nexoraNames = names(nexoraCommands);

/** Command names, so the registration can tell if two modules picked the same one. */
export function duplicateCommandNames(communityNames: string[]) {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const name of [...communityNames, ...legacyGuildCommands.map((c) => c.name), ...legacyGlobalCommands.map((c) => c.name)]) {
    if (seen.has(name)) duplicates.push(name);
    seen.add(name);
  }
  return duplicates;
}

/**
 * The module that owns an interaction, or null when it is this bot's own ("cm:" buttons and
 * the community commands, which the caller passes in). Anything that is not claimed by name
 * or prefix goes to the NEXORA module, which has always answered the rest.
 */
export function legacyOwner(interaction: Interaction, communityNames: Set<string>): LegacyBot | null {
  if (interaction.isCommand() || interaction.isAutocomplete()) {
    const name = interaction.commandName;
    if (communityNames.has(name)) return null;
    return owners.find((owner) => owner.commands.has(name))?.bot ?? (nexoraNames.has(name) ? nexoraBot : null);
  }
  const id = "customId" in interaction ? interaction.customId : "";
  if (id.startsWith("cm:")) return null;
  const owner = owners.find((item) => item.prefixes.some((prefix) => id.startsWith(prefix)));
  return owner?.bot ?? nexoraBot;
}

export function attachLegacy(client: Client) {
  for (const bot of legacyBots) bot.attach(client);
}

/** After login: what each module wanted done at startup (caches, sync loops, notifications). */
export async function startLegacy() {
  for (const bot of legacyBots) await bot.start().catch((error) => logBotError(`${bot.name} start`, error));
}

export async function handleLegacy(bot: LegacyBot, interaction: Interaction) {
  if (!bot.interaction) return;
  await bot.interaction(interaction);
}
