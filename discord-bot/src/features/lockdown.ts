import axios from "axios";
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { recordActivity } from "./activity-log";
import { botMemberRoleIds } from "./bot-control";

const API_URL = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();

export type LockdownState = { enabled:boolean; startedAt?:string|null; expiresAt?:string|null; privateReason?:string; source?:string; actor?:string };

export const lockdownCommand = new SlashCommandBuilder()
  .setName("lockdown").setDescription("ควบคุมการปิดเว็บไซต์ฉุกเฉิน").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub => sub.setName("status").setDescription("ดูสถานะล็อกดาวปัจจุบัน"))
  .addSubcommand(sub => sub.setName("enable").setDescription("ล็อกเว็บไซต์หลักและ API")
    .addStringOption(option => option.setName("duration").setDescription("เช่น 30s, 15m, 2h, 7d, 1mo, 1y หรือเว้นว่างเพื่อถาวร").setRequired(false).setMaxLength(30))
    .addStringOption(option => option.setName("reason").setDescription("เหตุผลภายในสำหรับผู้ดูแล").setRequired(false).setMaxLength(200)))
  .addSubcommand(sub => sub.setName("disable").setDescription("ปลดล็อกเว็บไซต์"))
  .addSubcommand(sub => sub.setName("access").setDescription("รับลิงก์เข้าหน้าควบคุมฉุกเฉิน"));

function requestHeaders(interaction:ChatInputCommandInteraction) {
  const isAdmin = interaction.guild?.ownerId === interaction.user.id || Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator));
  return { "Content-Type":"application/json", "X-Bot-Internal-Secret":BOT_SECRET, "X-Bot-Actor-Discord-Id":String(interaction.user.id), "X-Bot-Actor-Discord-Roles":botMemberRoleIds(interaction).join(","), "X-Bot-Actor-Is-Admin":isAdmin ? "true" : "false" };
}

export function parseLockdownDuration(raw?:string|null):number {
  const value = String(raw || "").trim().toLowerCase();
  if (!value || value === "permanent" || value === "ถาวร") return 0;
  const match = /^(\d+)\s*(s|m|h|d|w|mo|y|วินาที|นาที|ชั่วโมง|วัน|สัปดาห์|เดือน|ปี)$/.exec(value);
  if (!match) throw new Error("ระบุเวลา เช่น 30s, 15m, 2h, 7d, 1mo หรือ 1y");
  const factors:Record<string,number> = { s:1,วินาที:1,m:60,นาที:60,h:3600,ชั่วโมง:3600,d:86400,วัน:86400,w:604800,สัปดาห์:604800,mo:2592000,เดือน:2592000,y:31536000,ปี:31536000 };
  const seconds = Number(match[1]) * factors[match[2]];
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 157680000) throw new Error("ระยะเวลาต้องอยู่ระหว่าง 1 วินาทีถึง 5 ปี");
  return seconds;
}

function describeDuration(seconds:number):string {
  if (!seconds) return "ไม่กำหนด (จนกว่าจะปลดเอง)";
  const units:[number,string][] = [[31536000,"ปี"],[2592000,"เดือน"],[604800,"สัปดาห์"],[86400,"วัน"],[3600,"ชั่วโมง"],[60,"นาที"],[1,"วินาที"]];
  for (const [size,label] of units) if (seconds >= size && seconds % size === 0) return `${seconds / size} ${label}`;
  return `${seconds} วินาที`;
}

function formatDate(value?:string|null) {
  if (!value) return "จนกว่าจะปลดเอง";
  return new Intl.DateTimeFormat("th-TH", { dateStyle:"medium",timeStyle:"medium",timeZone:"Asia/Bangkok" }).format(new Date(value));
}

export function lockdownStateEmbed(state:LockdownState) {
  const actor = state.actor && /^\d{17,20}$/.test(state.actor) ? `<@${state.actor}>` : state.actor || "ระบบ";
  return new EmbedBuilder().setTitle("สถานะเว็บไซต์ NEXORA").setColor(state.enabled ? 0xdc2626 : 0x16a34a)
    .addFields(
      { name:"สถานะ",value:state.enabled ? "ล็อกเว็บไซต์อยู่" : "เปิดให้บริการตามปกติ",inline:true },
      { name:"กำหนดปลด",value:state.enabled ? formatDate(state.expiresAt) : "-",inline:true },
      { name:"เหตุผลภายใน",value:state.privateReason || "ไม่ได้ระบุ",inline:false },
      { name:"คำสั่งล่าสุด",value:actor,inline:false },
    ).setFooter({ text:"เว็บลูกค้า ฐานข้อมูล และเมลไม่อยู่ในขอบเขตล็อกดาว" }).setTimestamp();
}

export async function handleLockdownCommand(interaction:ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "access") {
    const response = await axios.post(`${API_URL}/api/internal/bot/lockdown/access`, {}, { headers:requestHeaders(interaction),timeout:10000 });
    await interaction.editReply({ content:`ลิงก์ควบคุมฉุกเฉิน ใช้ได้ครั้งเดียวภายใน 5 นาที\n${response.data.url}` });
    return;
  }
  if (sub === "status") {
    const response = await axios.get(`${API_URL}/api/internal/bot/lockdown`, { headers:requestHeaders(interaction),timeout:10000 });
    await interaction.editReply({ embeds:[lockdownStateEmbed(response.data)],content:"" });
    return;
  }
  const durationSeconds = sub === "enable" ? parseLockdownDuration(interaction.options.getString("duration")) : 0;
  const reason = sub === "enable" ? String(interaction.options.getString("reason") || "").trim() : "";
  const response = await axios.post(`${API_URL}/api/internal/bot/lockdown`, { enabled:sub === "enable",durationSeconds,reason }, { headers:requestHeaders(interaction),timeout:10000 });
  recordActivity(interaction, { outcome:"success",result:sub === "enable" ? "ปิดเว็บไซต์ชั่วคราวแล้ว ผู้ใช้ทั่วไปจะเข้าเว็บและ API ไม่ได้" : "เปิดเว็บไซต์กลับมาใช้งานได้แล้ว",details:sub === "enable" ? `ปิดนาน: ${describeDuration(durationSeconds)}\nเหตุผล: ${reason || "ไม่ได้ระบุ"}` : "" });
  await interaction.editReply({ embeds:[lockdownStateEmbed(response.data)],content:"" });
}
