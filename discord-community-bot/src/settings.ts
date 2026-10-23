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
  welcomeEnabled: boolean;
  welcomeChannelId: string;
  welcomeMessage: string;
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
};

export type Panel = { channelId: string; messageId: string };
export type Panels = { verify: Panel; roles: Panel; ticket: Panel };
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

export function panels(): Panels {
  return snapshot?.panels ?? { verify: { channelId: "", messageId: "" }, roles: { channelId: "", messageId: "" }, ticket: { channelId: "", messageId: "" } };
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

export async function savePanel(key: PanelKey, panel: Panel) {
  const next = { ...panels(), [key]: panel };
  if (snapshot) remember({ ...snapshot, panels: next });
  await api().post("/api/internal/bot/community/panels", next).catch((error) => logBotError("save panel", error));
}

/** {user}, {name}, {server} and {count} in the texts set on the web page. */
export function fillTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}
