import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  PermissionFlagsBits,
  type AutoModerationActionExecution,
  type AutoModerationRuleCreateOptions,
  type Client,
  type Guild,
  type Message,
} from "discord.js";
import { api, logBotError } from "./api";

// Server protection, quietly, in every server the bot is in. Links, invites, spam, mass mentions
// and blocked words are stopped by Discord's own AutoMod with rules the bot keeps in line with the
// web page: the sender sees a short note, nobody else sees anything. Message floods are caught by
// the bot (timeout and the burst removed, the sender told by DM). Everything stopped is logged on
// the site for admins only. Deleted channels are put back by places.ts.

export type ProtectSettings = {
  protectChannels: boolean;
  blockLinks: boolean;
  allowedDomains: string[];
  blockInvites: boolean;
  blockSpam: boolean;
  mentionLimit: number;
  blockedWords: string[];
  floodEnabled: boolean;
  floodMessages: number;
  floodSeconds: number;
  floodTimeoutMinutes: number;
  version: number;
};

// Until the site answers: channels are protected, nothing else is switched on.
let settings: ProtectSettings = {
  protectChannels: true, blockLinks: false, allowedDomains: [], blockInvites: false, blockSpam: false, mentionLimit: 0,
  blockedWords: [], floodEnabled: false, floodMessages: 6, floodSeconds: 5, floodTimeoutMinutes: 5, version: 0,
};

export function protectSettings() {
  return settings;
}

type RuleKind = "link" | "invite" | "spam" | "mention" | "word";

// The bot's rules are told apart from an admin's own by these names (not by who made them: the
// voice module used to be a bot of its own, and its rules were made by that bot).
const RULE_NAMES: Record<RuleKind, string> = {
  link: "NEXORA · ลิงก์",
  invite: "NEXORA · ลิงก์เชิญ",
  spam: "NEXORA · สแปม",
  mention: "NEXORA · แท็กหลายคน",
  word: "NEXORA · คำต้องห้าม",
};

// What the sender sees when a message is blocked (Discord allows 150 characters).
const NOTES: Record<RuleKind, string> = {
  link: "ส่งลิงก์นี้ในเซิร์ฟนี้ไม่ได้ ใช้ได้เฉพาะเว็บที่แอดมินอนุญาต",
  invite: "ส่งลิงก์เชิญเซิร์ฟอื่นในนี้ไม่ได้นะ",
  spam: "ข้อความนี้ดูเหมือนสแปม เลยส่งไม่ได้",
  mention: "แท็กคนเยอะเกินไปในข้อความเดียว",
  word: "ข้อความนี้มีคำที่เซิร์ฟนี้ไม่อนุญาต",
};

// Kinds of rule a server can have only one of.
const ONE_PER_SERVER = new Set<AutoModerationRuleTriggerType>([AutoModerationRuleTriggerType.Spam, AutoModerationRuleTriggerType.MentionSpam]);

const THAI = /[฀-๿]/;

function block(kind: RuleKind) {
  return { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: NOTES[kind] } };
}

/** Each rule as it should be now, or null when it should not exist. */
function wantedRules(canTimeout: boolean): [RuleKind, AutoModerationRuleCreateOptions | null][] {
  const base = { eventType: AutoModerationRuleEventType.MessageSend, enabled: true };
  return [
    ["link", settings.blockLinks ? {
      ...base, name: RULE_NAMES.link, triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: {
        regexPatterns: ["https?://\\S+", "(?:^|\\s)www\\.\\S+"],
        // Allowed sites (and their subdomains) do not trigger the rule.
        allowList: settings.allowedDomains.slice(0, 100).map((domain) => `*${domain}*`),
      },
      actions: [block("link")],
    } : null],
    ["invite", settings.blockInvites ? {
      ...base, name: RULE_NAMES.invite, triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: ["(?:discord\\.gg|discord(?:app)?\\.com/invite|dsc\\.gg)/\\S+"] },
      actions: [block("invite")],
    } : null],
    ["spam", settings.blockSpam ? {
      ...base, name: RULE_NAMES.spam, triggerType: AutoModerationRuleTriggerType.Spam, actions: [block("spam")],
    } : null],
    ["mention", settings.mentionLimit > 0 ? {
      ...base, name: RULE_NAMES.mention, triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: settings.mentionLimit, mentionRaidProtectionEnabled: true },
      // A 10 minute timeout too, when the bot may give one (Discord refuses the rule otherwise).
      actions: canTimeout
        ? [block("mention"), { type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 600 } }]
        : [block("mention")],
    } : null],
    ["word", settings.blockedWords.length ? {
      ...base, name: RULE_NAMES.word, triggerType: AutoModerationRuleTriggerType.Keyword,
      // Thai has no spaces between words, so Thai words match anywhere in a message.
      triggerMetadata: { keywordFilter: settings.blockedWords.slice(0, 1000).map((word) => (THAI.test(word) ? `*${word}*` : word)) },
      actions: [block("word")],
    } : null],
  ];
}

// Rule id → kind, for logging what AutoMod stopped.
const ruleKinds = new Map<string, RuleKind>();
const appliedAt = new Map<string, { version: number; at: number }>();

const PERMISSIONS: [bigint, string, () => boolean][] = [
  [PermissionFlagsBits.ManageGuild, "จัดการเซิร์ฟเวอร์ (ตั้งกฎกันลิงก์ สแปม และคำต้องห้าม)", () => true],
  [PermissionFlagsBits.ManageChannels, "จัดการช่อง (สร้างห้องที่ถูกลบคืน)", () => settings.protectChannels],
  [PermissionFlagsBits.ViewAuditLog, "ดูบันทึกการตรวจสอบ (รู้ว่าใครลบห้อง)", () => settings.protectChannels],
  [PermissionFlagsBits.ModerateMembers, "หมดเวลาสมาชิก (พักคนที่พิมพ์รัวหรือแท็กเยอะ)", () => settings.floodEnabled || settings.mentionLimit > 0],
  [PermissionFlagsBits.ManageMessages, "จัดการข้อความ (ลบข้อความที่พิมพ์รัว)", () => settings.floodEnabled],
];

/** Brings one server's AutoMod rules in line with the settings, and tells the site how it went. */
export async function applyProtection(guild: Guild) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return;
  const problems = PERMISSIONS.filter(([flag, , needed]) => needed() && !me.permissions.has(flag)).map(([, text]) => `บอทยังไม่มีสิทธิ์ ${text}`);
  if (me.permissions.has(PermissionFlagsBits.ManageGuild)) {
    try {
      const rules = await guild.autoModerationRules.fetch();
      for (const [kind, wanted] of wantedRules(me.permissions.has(PermissionFlagsBits.ModerateMembers))) {
        const mine = rules.find((rule) => rule.name === RULE_NAMES[kind]);
        try {
          if (!wanted) {
            if (mine) await mine.delete("ปิดใน ระบบป้องกันเซิร์ฟเวอร์");
            continue;
          }
          if (mine) {
            const { triggerType: _type, ...changes } = wanted;
            void _type;
            await mine.edit(changes);
            ruleKinds.set(mine.id, kind);
          } else if (ONE_PER_SERVER.has(wanted.triggerType) && rules.some((rule) => rule.triggerType === wanted.triggerType)) {
            // Discord allows one rule of this kind and the server's own is already there: leave it be.
            problems.push(`ตั้งกฎ "${RULE_NAMES[kind].replace("NEXORA · ", "")}" ไม่ได้ เพราะเซิร์ฟมีกฎแบบนี้อยู่แล้ว (ไม่ใช่ของบอท บอทเลยไม่แตะ)`);
          } else {
            const made = await guild.autoModerationRules.create(wanted);
            ruleKinds.set(made.id, kind);
          }
        } catch (error) {
          // Usually the server already has its own rule of a kind it can have only one of.
          const reason = (error as { message?: string })?.message ?? "";
          problems.push(`ตั้งกฎ "${RULE_NAMES[kind].replace("NEXORA · ", "")}" ไม่ได้${/limit|maximum/i.test(reason) ? " เพราะเซิร์ฟมีกฎแบบนี้อยู่แล้ว" : ""}`);
          logBotError(`automod ${kind}`, error);
        }
      }
    } catch (error) {
      logBotError("automod rules", error);
      problems.push("อ่านกฎ AutoMod ของเซิร์ฟไม่ได้");
    }
  }
  appliedAt.set(guild.id, { version: settings.version, at: Date.now() });
  await api().post("/api/internal/bot/protect/status", { guildId: guild.id, guildName: guild.name, version: settings.version, problems })
    .catch((error) => logBotError("protect status", error));
}

/**
 * Loads the settings and applies them where they changed. Every 10 minutes each server is checked
 * again anyway, so a permission given to the bot since shows up on the web page.
 */
export async function syncProtection(client: Client) {
  try {
    const res = await api().get<ProtectSettings>("/api/internal/bot/protect/settings");
    if (res.data && typeof res.data.version === "number") settings = res.data;
  } catch (error) {
    logBotError("protect settings", error);
    return;
  }
  for (const guild of client.guilds.cache.values()) {
    const last = appliedAt.get(guild.id);
    if (last && last.version === settings.version && Date.now() - last.at < 10 * 60000) continue;
    await applyProtection(guild).catch((error) => logBotError("apply protection", error));
  }
}

// Reports to the site, at most one per member and kind a minute (with how many times since).
const reported = new Map<string, { at: number; extra: number }>();

type Report = {
  kind: string; guild: Guild; userId?: string; userName?: string; channelId?: string; channelName?: string; detail?: string; restored?: boolean;
};

function send(report: Report, count: number) {
  return api().post("/api/internal/bot/protect/event", {
    kind: report.kind, guildId: report.guild.id, guildName: report.guild.name, userId: report.userId ?? "", userName: report.userName ?? "",
    channelId: report.channelId ?? "", channelName: report.channelName ?? "", detail: report.detail ?? "", count, restored: report.restored ?? false,
  }).catch((error) => logBotError("protect event", error));
}

export function reportProtection(report: Report) {
  const key = `${report.guild.id}:${report.userId ?? ""}:${report.kind}`;
  const seen = reported.get(key);
  if (seen && Date.now() - seen.at < 60000) {
    seen.extra++;
    return;
  }
  const entry = { at: Date.now(), extra: 0 };
  reported.set(key, entry);
  void send(report, 1);
  // Anything more in the next minute is summed up in one more line.
  setTimeout(() => {
    if (entry.extra > 0) void send(report, entry.extra);
    if (reported.get(key) === entry) reported.delete(key);
  }, 60000).unref();
}

/** AutoMod stopped a message with one of the bot's rules: log it for admins. */
export function onAutoModeration(execution: AutoModerationActionExecution) {
  if (execution.action.type !== AutoModerationActionType.BlockMessage) return;
  const kind = ruleKinds.get(execution.ruleId);
  if (!kind) return;
  const channel = execution.channelId ? execution.guild.channels.cache.get(execution.channelId) : undefined;
  reportProtection({
    kind,
    guild: execution.guild,
    userId: execution.userId,
    userName: execution.user?.username ?? execution.member?.user.username ?? "",
    channelId: execution.channelId ?? "",
    channelName: channel?.name ?? "",
    detail: kind === "word" ? (execution.matchedKeyword ?? "").replace(/\*/g, "") : "",
  });
}

// Message floods: the last few messages of each member, per server.
const recent = new Map<string, { id: string; channelId: string; at: number }[]>();
const resting = new Map<string, number>();

setInterval(() => {
  const now = Date.now();
  for (const [key, list] of recent) if (!list.length || now - list[list.length - 1].at > 60000) recent.delete(key);
  for (const [key, until] of resting) if (until < now) resting.delete(key);
}, 60000).unref();

export async function onMessageFlood(message: Message) {
  if (!settings.floodEnabled || !message.inGuild() || message.author.bot || message.system || !message.member) return;
  const member = message.member;
  // Staff are not slowed down.
  if (member.id === message.guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  const key = `${message.guild.id}:${member.id}`;
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((item) => now - item.at < settings.floodSeconds * 1000);
  list.push({ id: message.id, channelId: message.channelId, at: now });
  recent.set(key, list);
  if (list.length < settings.floodMessages || (resting.get(key) ?? 0) > now) return;

  const minutes = settings.floodTimeoutMinutes;
  resting.set(key, now + minutes * 60000);
  recent.delete(key);
  await member.timeout(minutes * 60000, "ส่งข้อความรัวเกินไป").catch((error) => logBotError("flood timeout", error));
  // Remove the burst, channel by channel.
  const byChannel = new Map<string, string[]>();
  for (const item of list) byChannel.set(item.channelId, [...(byChannel.get(item.channelId) ?? []), item.id]);
  for (const [channelId, ids] of byChannel) {
    const channel = message.guild.channels.cache.get(channelId);
    if (channel?.isTextBased() && "bulkDelete" in channel) await channel.bulkDelete(ids, true).catch(() => undefined);
  }
  await member.send(`คุณส่งข้อความเร็วเกินไปในเซิร์ฟ **${message.guild.name}** เลยถูกพักการพิมพ์ ${minutes} นาทีนะ`).catch(() => undefined);
  const channel = message.channel;
  reportProtection({
    kind: "flood", guild: message.guild, userId: member.id, userName: member.user.username, channelId: channel.id,
    channelName: "name" in channel ? channel.name : "", detail: `${list.length} ข้อความใน ${settings.floodSeconds} วินาที พัก ${minutes} นาที`,
  });
}
