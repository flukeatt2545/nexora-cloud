import axios from "axios";
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { recordActivity } from "./activity-log";
import { botMemberRoleIds } from "./bot-control";
import { parseLockdownDuration } from "./lockdown";

const API_URL = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();

// /website cuts the connection to the main site and every hosted site (Caddy aborts it), while the
// API, the bots, the database portal and mail keep working. /lockdown shows a page and also closes
// the API instead.
export type SiteOfflineState = { enabled:boolean; startedAt?:string|null; expiresAt?:string|null; privateReason?:string; source?:string; actor?:string };

export const websiteCommand = new SlashCommandBuilder()
  .setName("website").setDescription("ปิดหรือเปิดเว็บไซต์ (ตัดการเชื่อมต่อ)").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub => sub.setName("status").setDescription("ดูว่าเว็บเปิดหรือปิดอยู่"))
  .addSubcommand(sub => sub.setName("close").setDescription("ปิดเว็บหลักและเว็บลูกทั้งหมด (API และบอทยังทำงาน)")
    .addStringOption(option => option.setName("duration").setDescription("เช่น 30m, 2h, 7d หรือเว้นว่างเพื่อปิดจนกว่าจะเปิดเอง").setRequired(false).setMaxLength(30))
    .addStringOption(option => option.setName("reason").setDescription("เหตุผลภายในสำหรับผู้ดูแล").setRequired(false).setMaxLength(200)))
  .addSubcommand(sub => sub.setName("open").setDescription("เปิดเว็บหลักและเว็บลูกกลับมา"));

function requestHeaders(interaction:ChatInputCommandInteraction) {
  return { "Content-Type":"application/json", "X-Bot-Internal-Secret":BOT_SECRET, "X-Bot-Actor-Discord-Id":String(interaction.user.id), "X-Bot-Actor-Discord-Roles":botMemberRoleIds(interaction).join(",") };
}

function formatDate(value?:string|null) {
  if (!value) return "จนกว่าจะเปิดเอง";
  return new Intl.DateTimeFormat("th-TH", { dateStyle:"medium",timeStyle:"medium",timeZone:"Asia/Bangkok" }).format(new Date(value));
}

export function websiteStateEmbed(state:SiteOfflineState) {
  const actor = state.actor && /^\d{17,20}$/.test(state.actor) ? `<@${state.actor}>` : state.actor || "ระบบ";
  return new EmbedBuilder().setTitle("สถานะเว็บไซต์ NEXORA").setColor(state.enabled ? 0xdc2626 : 0x16a34a)
    .addFields(
      { name:"สถานะ",value:state.enabled ? "ปิดอยู่ (ตัดการเชื่อมต่อ)" : "เปิดให้บริการตามปกติ",inline:true },
      { name:"เปิดกลับอัตโนมัติ",value:state.enabled ? formatDate(state.expiresAt) : "-",inline:true },
      { name:"เหตุผลภายใน",value:state.privateReason || "ไม่ได้ระบุ",inline:false },
      { name:"คำสั่งล่าสุด",value:actor,inline:false },
    ).setFooter({ text:"ปิดเฉพาะเว็บหลักและเว็บลูก API บอท ฐานข้อมูล และเมลยังทำงาน" }).setTimestamp();
}

export async function handleWebsiteCommand(interaction:ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "status") {
    const response = await axios.get(`${API_URL}/api/internal/bot/site-offline`, { headers:requestHeaders(interaction),timeout:10000 });
    await interaction.editReply({ embeds:[websiteStateEmbed(response.data)],content:"" });
    return;
  }
  const closing = sub === "close";
  const durationSeconds = closing ? parseLockdownDuration(interaction.options.getString("duration")) : 0;
  const reason = closing ? String(interaction.options.getString("reason") || "").trim() : "";
  const response = await axios.post(`${API_URL}/api/internal/bot/site-offline`, { enabled:closing,durationSeconds,reason }, { headers:requestHeaders(interaction),timeout:10000 });
  recordActivity(interaction, { outcome:"success",result:closing ? "ปิดเว็บหลักและเว็บลูกแล้ว" : "เปิดเว็บหลักและเว็บลูกกลับมาแล้ว",details:closing ? `เปิดกลับ: ${formatDate(response.data?.expiresAt)}\nเหตุผล: ${reason || "ไม่ได้ระบุ"}` : "" });
  await interaction.editReply({ embeds:[websiteStateEmbed(response.data)],content:"" });
}
