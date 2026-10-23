import axios from "axios";
import { ChannelType, EmbedBuilder, type Client, type Message, type TextChannel } from "discord.js";
import { api, logBotError } from "./api";
import { STATUS_API_URL, STATUS_WEB_URL } from "./config";
import { homeGuild } from "./guild";
import { settings } from "./settings";
import { COLOR, minutesText, when } from "./ui";

// Checks the website and the API every minute. Two failed checks in a row (about two minutes
// down) post an alert in the status room; the next good check posts that it is back, how long
// it was down, and records it on the site.

type Target = "web" | "api";

type State = { up: boolean; failures: number; downSince: Date | null; detail: string; alert: Message | null };

const targets: { key: Target; name: string; url: string }[] = [
  { key: "web", name: "เว็บไซต์", url: STATUS_WEB_URL },
  { key: "api", name: "API", url: STATUS_API_URL },
];

const state: Record<Target, State> = {
  web: { up: true, failures: 0, downSince: null, detail: "", alert: null },
  api: { up: true, failures: 0, downSince: null, detail: "", alert: null },
};

const FAILURES_FOR_DOWN = 2;

let onChange: () => void = () => undefined;

/** Whether the website and the API answered at the last check, for the stats channel. */
export function siteUp() {
  return state.web.up && state.api.up;
}

async function check(url: string): Promise<string> {
  try {
    const res = await axios.get(url, { timeout: 10000, maxRedirects: 3, validateStatus: () => true, headers: { "User-Agent": "NexoraStatusBot/1.0" } });
    // A 4xx still means the site is up and answering (a login page, the lockdown page).
    return res.status >= 500 ? `HTTP ${res.status}` : "";
  } catch (error) {
    if (axios.isAxiosError(error)) return error.code === "ECONNABORTED" || error.code === "ETIMEDOUT" ? "ไม่ตอบภายใน 10 วินาที" : `เชื่อมต่อไม่ได้ (${error.code ?? "network"})`;
    return "เชื่อมต่อไม่ได้";
  }
}

function statusChannel(client: Client) {
  const current = settings();
  if (!current?.statusEnabled || !current.statusChannelId) return undefined;
  const channel = homeGuild(client)?.channels.cache.get(current.statusChannelId);
  return channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) ? (channel as TextChannel) : undefined;
}

async function wentDown(client: Client, target: (typeof targets)[number], s: State) {
  const channel = statusChannel(client);
  if (!channel) return;
  const role = settings()?.statusMentionRoleId;
  const embed = new EmbedBuilder()
    .setColor(COLOR.danger)
    .setTitle(`🔴 ${target.name}ล่ม`)
    .setDescription(`ใช้งาน${target.name}ไม่ได้ตั้งแต่ ${when(s.downSince!, "t")} (${when(s.downSince!, "R")})\nสาเหตุ: ${s.detail}`)
    .setFooter({ text: "บอทจะแจ้งอีกครั้งเมื่อกลับมาใช้ได้" });
  s.alert = await channel.send({ content: role ? `<@&${role}>` : undefined, embeds: [embed], allowedMentions: { roles: role ? [role] : [] } })
    .catch((error) => { logBotError("status alert", error); return null; });
}

async function cameBack(client: Client, target: (typeof targets)[number], s: State, since: Date) {
  const now = new Date();
  const down = minutesText(now.getTime() - since.getTime());
  await api().post("/api/internal/bot/community/incidents", { target: target.key, startedAt: since.toISOString(), endedAt: now.toISOString(), detail: s.detail })
    .catch((error) => logBotError("record incident", error));
  const channel = statusChannel(client);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(COLOR.ok)
    .setTitle(`🟢 ${target.name}กลับมาใช้ได้แล้ว`)
    .setDescription(`ล่มไป ${down} (${when(since, "t")} – ${when(now, "t")})`);
  if (s.alert) {
    await s.alert.edit({ embeds: [EmbedBuilder.from(s.alert.embeds[0]).setColor(COLOR.warn).setFooter({ text: `กลับมาแล้ว · ล่มไป ${down}` })] }).catch(() => undefined);
    await s.alert.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch((error) => logBotError("status back", error));
  } else {
    await channel.send({ embeds: [embed] }).catch((error) => logBotError("status back", error));
  }
  s.alert = null;
}

async function checkAll(client: Client) {
  for (const target of targets) {
    const s = state[target.key];
    const problem = await check(target.url);
    if (problem) {
      s.failures += 1;
      s.detail = problem;
      s.downSince ||= new Date();
      if (s.up && s.failures >= FAILURES_FOR_DOWN) {
        s.up = false;
        console.warn(`[WARN] ${target.key} is down: ${problem}`);
        await wentDown(client, target, s);
        onChange();
      }
    } else {
      const since = s.downSince;
      const wasDown = !s.up;
      s.failures = 0;
      s.downSince = null;
      s.up = true;
      if (wasDown && since) {
        console.log(`[INFO] ${target.key} is back`);
        await cameBack(client, target, s, since);
        onChange();
      }
    }
  }
}

export function startStatusChecks(client: Client, changed: () => void) {
  onChange = changed;
  void checkAll(client);
  setInterval(() => void checkAll(client).catch((error) => logBotError("status check", error)), 60000).unref();
}
