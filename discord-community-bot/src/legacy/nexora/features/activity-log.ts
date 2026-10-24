import axios from "axios";
import type { APIEmbed, APIEmbedField, Interaction } from "discord.js";
import { discordMention, discordMentionList } from "./discord-mentions";
import { errorCode, errorStatus } from "./errors";

const apiUrl = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const secret = (process.env.BOT_INTERNAL_SECRET || "").trim();
export type ActivityResult = { outcome: "success" | "failure" | "unknown"; result: string; details?: string; target?: string };

/** Interactions wrapped by observeBotActivity can be told what the command did. */
type Recordable = { recordBotActivity?: (record: ActivityResult) => void };

/** Tells the activity log what a command did; does nothing for an interaction that is not being observed. */
export function recordActivity(interaction: object, record: ActivityResult) {
  (interaction as Recordable).recordBotActivity?.(record);
}

type ReplyPayload = string | { content?: string | null; embeds?: readonly unknown[] } | null | undefined;

/** The first embed of a reply, whether it was sent as an EmbedBuilder or as plain data. */
function firstEmbed(payload: ReplyPayload): APIEmbed | undefined {
  if (!payload || typeof payload === "string") return undefined;
  const embed = payload.embeds?.[0] as (APIEmbed & { data?: APIEmbed }) | undefined;
  return embed?.data || embed;
}

export function observeBotActivity<T extends Interaction>(original: T) {
  let result = "";
  let details = "";
  let outcome: ActivityResult["outcome"] = "unknown";
  let recorded: ActivityResult | undefined;
  let finished = false;
  const interaction = new Proxy(original, { get(target, prop) {
    if (prop === "recordBotActivity") return (record: ActivityResult) => { recorded = record; };
    const value: unknown = Reflect.get(target, prop, target);
    if (["reply", "editReply"].includes(String(prop))) return async (payload: ReplyPayload) => {
      const response: unknown = await (value as (payload: ReplyPayload) => Promise<unknown>).call(target, payload);
      const embed = firstEmbed(payload);
      const content = typeof payload === "string" ? payload : payload?.content;
      result = String(embed?.title || content || "ตอบกลับแล้ว").slice(0, 300);
      // Never forward SSO links, tickets, credentials, or full response descriptions.
      result = result.replace(/https?:\/\/\S+/g, "[ลิงก์ส่วนตัว]");
      details = (embed?.fields || []).filter((field: APIEmbedField) => ["เหตุผล", "ระยะเวลา", "การใช้คำสั่ง", "สถานะบอต"].includes(field.name)).map((field: APIEmbedField) => `${field.name}: ${field.value}`).join("\n").slice(0, 1000);
      const statusText = result + " " + String((typeof payload === "object" && payload?.content) || "");
      // Failure wins; otherwise a clearly positive reply counts as success instead of "unknown".
      outcome = /ไม่สำเร็จ|ไม่ได้|ไม่พร้อม|ไม่พบ|ไม่มีสิทธิ์|เฉพาะผู้ดูแล|ตรวจสอบ.*อีกครั้ง|ยังไม่ได้รับสิทธิ์|กรุณา|หมดอายุ|ลองอีกครั้ง|รอก่อน|ส่งถี่/.test(statusText) ? "failure"
        : /ได้แล้ว|สำเร็จ|เรียบร้อย|พร้อมใช้งาน|บันทึกแล้ว|ตรวจสอบแล้ว|เข้าใช้งาน|รายการผูกรหัส/.test(statusText) ? "success"
        : "unknown";
      return response;
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { interaction, async finish(current: Interaction) {
    if (finished || (!result && !recorded) || original.isAutocomplete()) return;
    finished = true;
    const id = String((original as { customId?: string }).customId || "");
    const values = original.isAnySelectMenu() ? original.values : [];
    const selected = String(values[0] || "");
    if (!recorded && id.startsWith("bot_panel_scope_")) return;
    if (id.startsWith("panel_action_choose") && !["bot_panel_mode", "bot_panel_visibility"].includes(selected)) return;
    if (id.startsWith("panel_action_") && !id.startsWith("panel_action_choose") && !id.startsWith("panel_action_form_") && !id.startsWith("panel_action_run_") && id !== "panel_action_ip") return;
    // Panel actions arrive as a stand-in for a slash command (see handlePanelAction): read what it reports.
    const options = current.isChatInputCommand() ? current.options : undefined;
    let sub = "";
    let target = "";
    try { sub = options?.getSubcommand(false) || ""; } catch {}
    try { target = options?.getString("ip") || options?.getString("value") || ""; } catch {}
    if (!target) {
      try {
        const user = options?.getUser("user");
        const role = options?.getRole("role");
        target = user ? discordMention(user.id) : role ? discordMention(role.id, "role") : "";
      } catch {}
    }
    const pickerType = id.startsWith("bot_panel_save_users:") ? "user" : id.startsWith("bot_panel_save_roles:") ? "role" : null;
    if (!recorded && pickerType) return;
    if (!target && (["bot_panel_toggle_users", "bot_panel_toggle_roles"].includes(id) || pickerType)) target = discordMentionList(values, pickerType || (id.endsWith("roles") ? "role" : "user"));
    const componentCommands: Record<string, string> = { btn_request_db: "/db", modal_student_db: "/db", btn_request_workspace: "/code", modal_student_workspace: "/code" };
    const commandName = (current as { commandName?: string }).commandName;
    const command = commandName ? `/${commandName}${sub ? " " + sub : ""}` : pickerType ? `bot_panel_toggle_${pickerType === "user" ? "users" : "roles"}` : componentCommands[id] || (id.startsWith("panel_action_choose") ? selected : id);
    if (recorded) {
      result = recorded.result;
      outcome = recorded.outcome;
      details = recorded.details || details;
      target = recorded.target || target;
    }
    target = ({ everyone: "ทุกคนในเซิร์ฟเวอร์", allowlist: "เฉพาะรายชื่อที่อนุญาต", online: "แสดงสถานะออนไลน์", hidden: "ซ่อนสถานะออนไลน์" } as Record<string,string>)[target] || target;
    try {
      await axios.post(`${apiUrl}/api/internal/bot/activity`, {
        actorId: original.user.id, actorName: String(original.user.username || "").slice(0,100),
        command: command.slice(0,100), result: result.replace(/https?:\/\/\S+/g, "[ลิงก์ส่วนตัว]").slice(0,300), target: target.slice(0,200), details: details.slice(0,1000), outcome,
      }, { headers: { "X-Bot-Internal-Secret": secret }, timeout: 10000 });
    } catch (error) { console.error("[AUDIT] Activity notification failed", errorStatus(error) || errorCode(error) || "unknown"); }
  } };
}
