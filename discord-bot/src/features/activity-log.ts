import axios from "axios";
import { discordMention, discordMentionList } from "./discord-mentions";

const apiUrl = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const secret = (process.env.BOT_INTERNAL_SECRET || "").trim();
type ActivityResult = { outcome: "success" | "failure" | "unknown"; result: string; details?: string; target?: string };

export function observeBotActivity(original: any) {
  let result = "";
  let details = "";
  let outcome = "unknown";
  let recorded: ActivityResult | undefined;
  let finished = false;
  const interaction = new Proxy(original, { get(target, prop) {
    if (prop === "recordBotActivity") return (record: ActivityResult) => { recorded = record; };
    const value = Reflect.get(target, prop, target);
    if (["reply", "editReply"].includes(String(prop))) return async (payload: any) => {
      const response = await value.call(target, payload);
      const embed = payload?.embeds?.[0]?.data || payload?.embeds?.[0];
      result = String(embed?.title || (typeof payload === "string" ? payload : payload?.content) || "ตอบกลับแล้ว").slice(0, 300);
      // Never forward SSO links, tickets, credentials, or full response descriptions.
      result = result.replace(/https?:\/\/\S+/g, "[ลิงก์ส่วนตัว]");
      details = (embed?.fields || []).filter((field: any) => ["เหตุผล", "ระยะเวลา", "การใช้คำสั่ง", "สถานะบอต"].includes(field.name)).map((field: any) => `${field.name}: ${field.value}`).join("\n").slice(0, 1000);
      const statusText = result + " " + String(payload?.content || "");
      // Failure wins; otherwise a clearly positive reply counts as success instead of "unknown".
      outcome = /ไม่สำเร็จ|ไม่ได้|ไม่พร้อม|ไม่พบ|ไม่มีสิทธิ์|เฉพาะผู้ดูแล|ตรวจสอบ.*อีกครั้ง|ยังไม่ได้รับสิทธิ์|กรุณา|หมดอายุ|ลองอีกครั้ง|รอก่อน|ส่งถี่/.test(statusText) ? "failure"
        : /ได้แล้ว|สำเร็จ|เรียบร้อย|พร้อมใช้งาน|บันทึกแล้ว|ตรวจสอบแล้ว|เข้าใช้งาน|รายการผูกรหัส/.test(statusText) ? "success"
        : "unknown";
      return response;
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { interaction, async finish(current: any) {
    if (finished || (!result && !recorded) || original.isAutocomplete?.()) return;
    finished = true;
    const id = String(original.customId || "");
    const selected = String(original.values?.[0] || "");
    if (!recorded && id.startsWith("bot_panel_scope_")) return;
    if (id.startsWith("panel_action_choose") && !["bot_panel_mode", "bot_panel_visibility"].includes(selected)) return;
    if (id.startsWith("panel_action_") && !id.startsWith("panel_action_choose") && !id.startsWith("panel_action_form_") && !id.startsWith("panel_action_run_") && id !== "panel_action_ip") return;
    let sub = "";
    let target = "";
    try { sub = current.options?.getSubcommand?.(false) || ""; } catch {}
    try { target = current.options?.getString?.("ip") || current.options?.getString?.("value") || ""; } catch {}
    if (!target) {
      try {
        const user = current.options?.getUser?.("user");
        const role = current.options?.getRole?.("role");
        target = user ? discordMention(user.id) : role ? discordMention(role.id, "role") : "";
      } catch {}
    }
    const pickerType = id.startsWith("bot_panel_save_users:") ? "user" : id.startsWith("bot_panel_save_roles:") ? "role" : null;
    if (!recorded && pickerType) return;
    if (!target && (["bot_panel_toggle_users", "bot_panel_toggle_roles"].includes(id) || pickerType)) target = discordMentionList(original.values || [], pickerType || (id.endsWith("roles") ? "role" : "user"));
    const componentCommands: Record<string, string> = { btn_request_db: "/db", modal_student_db: "/db", btn_request_workspace: "/code", modal_student_workspace: "/code" };
    const command = current.commandName ? `/${current.commandName}${sub ? " " + sub : ""}` : pickerType ? `bot_panel_toggle_${pickerType === "user" ? "users" : "roles"}` : componentCommands[id] || (id.startsWith("panel_action_choose") ? selected : id);
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
    } catch (error: any) { console.error("[AUDIT] Activity notification failed", error?.response?.status || error?.code || "unknown"); }
  } };
}
