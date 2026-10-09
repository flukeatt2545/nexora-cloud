import { EmbedBuilder, MessageFlags, type Client, type Guild, type GuildBasedChannel, type GuildMember, type VoiceState } from "discord.js";
import { api, logBotError } from "./api";
import { isHub } from "./rooms";
import { COLOR } from "./ui";

// Who is in which voice channel and for how long, in every server the bot is in. The site keeps
// the times; the bot tells it about joins, leaves and moves, and posts ended sessions to the
// server's join/leave log channel (/setup-voice-log).

export type VoiceSession = {
  id: number;
  guildId: string;
  channelId: string;
  channelName: string;
  discordId: string;
  username: string;
  displayName: string;
  joinedAt: string;
  leftAt: string | null;
  seconds: number;
};

// One request at a time per member, so a quick leave-and-join reaches the site in order.
const queues = new Map<string, Promise<unknown>>();

function enqueue(key: string, task: () => Promise<unknown>) {
  const next = (queues.get(key) ?? Promise.resolve()).then(task, task).catch((error) => logBotError("voice session", error));
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}

/** The channel to count: a voice or stage channel, but not a Join to Create hub (members only pass through). */
function counted(channel: VoiceState["channel"]) {
  return channel && !isHub(channel.id) ? channel : null;
}

function who(member: GuildMember) {
  return { discordId: member.id, username: member.user.username, displayName: member.displayName };
}

export function onSessionVoiceState(oldState: VoiceState, newState: VoiceState) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  const before = counted(oldState.channel);
  const after = counted(newState.channel);
  if (before?.id === after?.id) return;
  const guild = newState.guild;
  enqueue(`${guild.id}:${member.id}`, () => api().post("/api/internal/bot/voice/sessions/move", {
    guildId: guild.id,
    guildName: guild.name,
    ...who(member),
    channelId: after?.id ?? "",
    channelName: after?.name ?? "",
  }));
}

/** When the bot starts or joins a server: who is in voice there now. */
export async function syncSessions(guild: Guild) {
  const present = guild.voiceStates.cache
    .filter((state) => state.member && !state.member.user.bot && counted(state.channel))
    .map((state) => ({ ...who(state.member!), channelId: state.channelId!, channelName: state.channel!.name }));
  await api().post("/api/internal/bot/voice/sessions/sync", { guildId: guild.id, guildName: guild.name, present });
}

export async function syncAllSessions(client: Client) {
  for (const guild of client.guilds.cache.values()) await syncSessions(guild).catch((error) => logBotError("sync sessions", error));
}

/** 3725 seconds → "1 ชั่วโมง 2 นาที 5 วินาที". */
export function duration(total: number) {
  let left = Math.max(0, Math.round(total));
  const parts: string[] = [];
  for (const [size, unit] of [[86400, "วัน"], [3600, "ชั่วโมง"], [60, "นาที"], [1, "วินาที"]] as const) {
    const count = Math.floor(left / size);
    left -= count * size;
    if (count) parts.push(`${count} ${unit}`);
  }
  return parts.length ? parts.join(" ") : "0 วินาที";
}

function unix(value: string) {
  return Math.floor(new Date(value).getTime() / 1000);
}

/**
 * One stay: which channel, how long, and when they came and went. Times show in each reader's
 * own time zone; a stay over a day long shows dates too.
 */
export function sessionLine(session: VoiceSession, withMember = true) {
  const who = withMember ? `<@${session.discordId}> ` : "";
  const style = session.seconds >= 72000 ? "f" : "t";
  const times = session.leftAt
    ? `เข้า <t:${unix(session.joinedAt)}:${style}> · ออก <t:${unix(session.leftAt)}:${style}>`
    : `เข้า <t:${unix(session.joinedAt)}:${style}> · ตอนนี้ยังอยู่`;
  return `${who}อยู่ <#${session.channelId}> ไป **${duration(session.seconds)}**\n${times}`;
}

/** Posts ended sessions to each server's join/leave log channel. */
export async function postSessionFeed(logs: Map<string, GuildBasedChannel>) {
  const res = await api().get<{ sessions: VoiceSession[] }>("/api/internal/bot/voice/sessions/feed");
  const sessions = res.data?.sessions ?? [];
  if (!sessions.length) return;
  const posted: number[] = [];
  for (const [guildId, channel] of logs) {
    const mine = sessions.filter((session) => session.guildId === guildId);
    if (!mine.length || !channel.isTextBased()) continue;
    // Discord takes at most 10 embeds per message.
    for (let i = 0; i < mine.length; i += 10) {
      const batch = mine.slice(i, i + 10);
      try {
        await channel.send({
          embeds: batch.map((session) => new EmbedBuilder()
            .setColor(COLOR.brand)
            .setTitle("ออกจากห้องแล้ว")
            .setDescription(sessionLine(session))
            // The channel may be gone later; its name at the time stays readable here.
            .setFooter({ text: session.channelName || "ห้องเสียง" })),
          allowedMentions: { parse: [] },
          flags: MessageFlags.SuppressNotifications,
        });
        posted.push(...batch.map((session) => session.id));
      } catch (error) {
        logBotError("post voice log", error);
        break;
      }
    }
  }
  // Sessions of servers without a usable log channel are not returned by the site, so nothing
  // is lost by acknowledging only what was posted.
  if (posted.length) await api().post("/api/internal/bot/voice/sessions/ack", { ids: posted });
}

/** The private reply to /voice-history. */
export function voiceHistoryEmbed(memberName: string, data: { sessions: VoiceSession[]; weekSeconds: number; monthSeconds: number }) {
  const embed = new EmbedBuilder().setColor(COLOR.brand).setTitle(`${memberName} อยู่ห้องเสียงไปเท่าไร`.slice(0, 256));
  embed.addFields(
    { name: "7 วันนี้", value: duration(data.weekSeconds), inline: true },
    { name: "30 วันนี้", value: duration(data.monthSeconds), inline: true },
  );
  if (!data.sessions.length) return embed.setDescription("ยังไม่เคยเข้าห้องเสียงในเซิร์ฟนี้เลย");
  const lines: string[] = [];
  let length = 0;
  for (const session of data.sessions) {
    const line = sessionLine(session, false);
    if (length + line.length + 2 > 3900) break;
    lines.push(line);
    length += line.length + 2;
  }
  return embed.setDescription(lines.join("\n\n")).setFooter({ text: "15 ครั้งล่าสุดในเซิร์ฟนี้ · เก็บไว้ 90 วัน" });
}
