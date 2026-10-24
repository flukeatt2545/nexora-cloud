import fs from "fs";
import os from "os";
import path from "path";
import { api, logBotError, type Actor } from "./api";
import type { NameStyle } from "./style";

// The bot's settings live on the site (admin Discord bot page, or /setup here). The last copy is
// kept in memory and on disk, so the bot keeps working (and can say the site is down) while the
// API is not answering.

export type Settings = {
  guildId: string;
  nameStyle: NameStyle;
  nameEmoji: boolean;
  welcomeEnabled: boolean;
  welcomeChannelId: string;
  welcomeMessage: string;
  welcomeImage: boolean;
  roleCheckEnabled: boolean;
  roleCheckChannelId: string;
  leaveEnabled: boolean;
  leaveChannelId: string;
  leaveMessage: string;
  leaveImage: boolean;
  verifyEnabled: boolean;
  verifyChannelId: string;
  verifyMessage: string;
  memberRoleId: string;
  rolesChannelId: string;
  rolesMessage: string;
  selfRoleIds: string[];
  managerRoleIds: string[];
  staffRoleIds: string[];
  usageRoleIds: string[];
  ticketsEnabled: boolean;
  ticketChannelId: string;
  ticketCategoryId: string;
  ticketLogChannelId: string;
  ticketMessage: string;
  ticketMaxOpen: number;
  tempVoiceEnabled: boolean;
  tempHubChannelId: string;
  tempNameTemplate: string;
  statsEnabled: boolean;
  statsCategoryId: string;
  statsMembersChannelId: string;
  statsOnlineChannelId: string;
  statsSiteChannelId: string;
  statusEnabled: boolean;
  statusChannelId: string;
  statusMentionRoleId: string;
  statusImage: boolean;
  boostEnabled: boolean;
  boostChannelId: string;
  boostLoungeChannelId: string;
  boostPerks: string;
  securityEnabled: boolean;
  securityChannelId: string;
  securitySiteEvents: boolean;
  antiNukeEnabled: boolean;
  antiSpamEnabled: boolean;
  newAccountDays: number;
};

export type Panel = { channelId: string; messageId: string };
export type Panels = { verify: Panel; roles: Panel; ticket: Panel; status: Panel; boost: Panel; roleCheck: Panel };
export type PanelKey = keyof Panels;

type Snapshot = { settings: Settings; panels: Panels; version: number };

const CACHE_FILE = path.join(os.tmpdir(), "nexora-community-settings.json");

let snapshot: Snapshot | null = null;

try {
  snapshot = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Snapshot;
} catch {
  // First start, or the container was recreated.
}

function remember(next: Snapshot) {
  snapshot = next;
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(next));
  } catch {
    // Only a convenience.
  }
}

/** The settings the bot is using now (null until the site has answered once). */
export function settings(): Settings | null {
  return snapshot?.settings ?? null;
}

/** The name style to use (the default until the site has answered). */
export function nameStyle(): NameStyle {
  return snapshot?.settings.nameStyle ?? "frame";
}

/** Whether names get an emoji (on until the site says otherwise). */
export function nameEmoji(): boolean {
  return snapshot?.settings.nameEmoji ?? true;
}

export function panels(): Panels {
  const none = { channelId: "", messageId: "" };
  return { verify: none, roles: none, ticket: none, status: none, boost: none, roleCheck: none, ...snapshot?.panels };
}

export function settingsVersion() {
  return snapshot?.version ?? 0;
}

/** Asks the site for the latest settings. Returns true when they changed. */
export async function loadSettings() {
  try {
    const res = await api().get<Snapshot>("/api/internal/bot/community/settings");
    const changed = res.data.version !== snapshot?.version;
    remember({ ...res.data, panels: res.data.panels ?? panels() });
    return changed;
  } catch (error) {
    logBotError("load settings", error);
    return false;
  }
}

/** Saves a change made in Discord (/setup). Throws with the site's message when it is refused. */
export async function updateSettings(actor: Actor, change: Partial<Settings>) {
  const res = await api(actor).patch<Snapshot>("/api/internal/bot/community/settings", change);
  remember({ ...res.data, panels: res.data.panels ?? panels() });
  return res.data.settings;
}

// Panels are posted at the same time now; the saves to the site go one after another, each
// sending the latest of all of them, so a late one can never bring back an old state.
let panelSaves: Promise<unknown> = Promise.resolve();

export async function savePanel(key: PanelKey, panel: Panel) {
  const next = { ...panels(), [key]: panel };
  if (snapshot) remember({ ...snapshot, panels: next });
  panelSaves = panelSaves.then(() => api().post("/api/internal/bot/community/panels", panels()).catch((error) => logBotError("save panel", error)));
  await panelSaves;
}

/** {user}, {name}, {server} and {count} in the texts set on the web page. */
export function fillTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
