import axios from "axios";
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const API_URL = (process.env.NEXORA_API_URL || "http://localhost:8080").replace(/\/+$/, "");
const BOT_SECRET = (process.env.BOT_INTERNAL_SECRET || "").trim();

type AccessState = {
  botKey: string;
  accessMode: "everyone" | "allowlist";
  visibility: "online" | "hidden";
  users: string[];
  roles: string[];
  commandAccess?: Record<string, {users: string[]; roles: string[]}>;
};

export const commandScopeLabels: Record<string,string> = {
  "db":"เปิดฐานข้อมูล", "code":"เปิดพื้นที่เขียนโค้ด", "setup-panel":"สร้างแผงเข้าใช้งาน",
  "admin-map.list":"ดูรายการผูกรหัส", "admin-map.set":"ผูกรหัสกับฐานข้อมูล", "admin-map.unbind":"ยกเลิกการผูกบัญชี",
  "crowdsec.bans":"ดูรายการ IP ที่ถูกบล็อก", "crowdsec.ban":"บล็อก IP", "crowdsec.unban":"ปลดบล็อก IP",
  "bot.status":"ดูสิทธิ์และสถานะบอต", "bot.mode":"เปลี่ยนโหมดใช้คำสั่ง", "bot.users":"จัดการผู้ใช้ที่อนุญาต",
  "bot.roles":"จัดการยศที่อนุญาต", "bot.permissions":"กำหนดสิทธิ์แต่ละเมนู", "bot.visibility":"แสดงหรือซ่อนสถานะบอต",
  "bot-panel":"สร้างแผงควบคุมบอต",
  "lockdown.status":"ดูสถานะล็อกดาว", "lockdown.manage":"ล็อกหรือปลดเว็บไซต์", "lockdown.access":"เข้าหน้าควบคุมฉุกเฉิน",
};

export function botMemberRoleIds(interaction: any): string[] {
  const roles = interaction.member?.roles;
  return (Array.isArray(roles) ? roles : [...(roles?.cache?.keys() || [])]).filter((id: string) => /^\d{17,20}$/.test(id));
}

export function botControlScope(sub: string): string {
  return sub.endsWith("user") ? "bot.users" : sub.endsWith("role") ? "bot.roles" : `bot.${sub}`;
}

export function matchesBotSubjects(interaction: any, subjects: {users: string[]; roles: string[]}) {
  if (subjects.users.includes(String(interaction.user?.id || ""))) return true;
  const roles = interaction.member?.roles;
  return subjects.roles.some(id => Array.isArray(roles) ? roles.includes(id) : Boolean(roles?.cache?.has(id)));
}

export async function canUseBotScope(interaction: any, scope: string, isAdmin: boolean): Promise<boolean> {
  // Bulk / multi unblock shares the single-unblock permission.
  if (scope === "crowdsec.unban-all" || scope === "crowdsec.unban-select") scope = "crowdsec.unban";
  if (!commandScopeLabels[scope]) return false;
  if (isAdmin) return true;
  try {
    const state = await loadBotAccess(true);
    // General allowlisted subjects can view status, but never gain mutation privileges.
    if (scope === "bot.status" && matchesBotSubjects(interaction,state)) return true;
    if ((scope === "db" || scope === "code") && (state.accessMode === "everyone" || matchesBotSubjects(interaction,state))) return true;
    return matchesBotSubjects(interaction,state.commandAccess?.[scope] || {users:[],roles:[]});
  } catch { return false; }
}

let cache: { expiresAt: number; state: AccessState } = {
  expiresAt: 0,
  state: { botKey: "nexora", accessMode: "everyone", visibility: "online", users: [], roles: [] },
};

export const botControlCommand = new SlashCommandBuilder()
  .setName("bot-control")
  .setDescription("กำหนดสิทธิ์และการแสดงสถานะของบอต")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName("status").setDescription("ดูการตั้งค่าปัจจุบัน"))
  .addSubcommand((sub) =>
    sub.setName("mode").setDescription("กำหนดผู้ที่ใช้คำสั่งได้").addStringOption((opt) =>
      opt.setName("value").setDescription("โหมดการเข้าถึง").setRequired(true).addChoices(
        { name: "ทุกคน", value: "everyone" },
        { name: "เฉพาะรายชื่อที่อนุญาต", value: "allowlist" }
      )
    )
  )
  .addSubcommand((sub) =>
    sub.setName("allow-user").setDescription("อนุญาตผู้ใช้").addUserOption((opt) => opt.setName("user").setDescription("ผู้ใช้ที่อนุญาต").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("remove-user").setDescription("นำผู้ใช้ออกจากรายชื่อ").addUserOption((opt) => opt.setName("user").setDescription("ผู้ใช้ที่นำออก").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("allow-role").setDescription("อนุญาตสมาชิกตามยศ").addRoleOption((opt) => opt.setName("role").setDescription("ยศที่อนุญาต").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("remove-role").setDescription("นำยศออกจากรายชื่อ").addRoleOption((opt) => opt.setName("role").setDescription("ยศที่นำออก").setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName("visibility").setDescription("แสดงหรือซ่อนสถานะบอต").addStringOption((opt) =>
      opt.setName("value").setDescription("สถานะของบอต").setRequired(true).addChoices(
        { name: "แสดงออนไลน์", value: "online" },
        { name: "ซ่อนเป็นออฟไลน์", value: "hidden" }
      )
    )
  );

function headers(actorId?: string) {
  return {
    "Content-Type": "application/json",
    "X-Bot-Internal-Secret": BOT_SECRET,
    ...(actorId ? { "X-Bot-Actor-Discord-Id": actorId } : {}),
  };
}

export async function loadBotAccess(force = false): Promise<AccessState> {
  if (!force && Date.now() < cache.expiresAt) return cache.state;
  const response = await axios.get(`${API_URL}/api/internal/bot/access/nexora`, { headers: headers(), timeout: 10000 });
  cache = { expiresAt: Date.now() + 15000, state: response.data as AccessState };
  return cache.state;
}

export async function updateBotAccess(actorId: string, body: Record<string, string>, roleIds: string[] = []): Promise<AccessState> {
  const response = await axios.post(`${API_URL}/api/internal/bot/access/nexora`, body, {
    headers: { ...headers(actorId), "X-Bot-Actor-Discord-Roles": roleIds.join(",") },
    timeout: 10000,
  });
  cache = { expiresAt: Date.now() + 15000, state: response.data as AccessState };
  return cache.state;
}

export async function canUseBotCommands(interaction: any, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  try {
    const state = await loadBotAccess();
    if (state.accessMode === "everyone") return true;
    return matchesBotSubjects(interaction,state);
  } catch (error: any) {
    console.error("[ERROR] Bot access check:", error?.message || error);
    return false;
  }
}

function safeDiscordLabel(value: string) {
	return value.replace(/[\\*_~`|>]/g, (character) => "\\" + character).replace(/@/g, "＠").trim();
}

export async function botSubjectLabels(interaction: any, ids: string[], type: "user" | "role") {
	return Promise.all(ids.map(async (id) => {
		try {
			if (type === "role") {
				const role = interaction.guild?.roles?.cache?.get(id) || await interaction.guild?.roles?.fetch(id);
				return role?.name ? `@${safeDiscordLabel(role.name)}` : "ยศที่ไม่พบ";
			}
			const member = interaction.guild?.members?.cache?.get(id) || await interaction.guild?.members?.fetch(id).catch(() => null);
			const user = member?.user || interaction.client?.users?.cache?.get(id) || await interaction.client?.users?.fetch(id).catch(() => null);
			const name = member?.displayName || user?.globalName || user?.username;
			return name ? `@${safeDiscordLabel(name)}` : "ผู้ใช้ที่ไม่พบ";
		} catch {
			return type === "role" ? "ยศที่ไม่พบ" : "ผู้ใช้ที่ไม่พบ";
		}
	}));
}

export async function botAccessStateEmbed(state: AccessState, interaction: any) {
	const users = await botSubjectLabels(interaction, state.users, "user");
	const roles = await botSubjectLabels(interaction, state.roles, "role");
	const userList = users.length ? users.join("\n") : "ยังไม่มี";
	const roleList = roles.length ? roles.join("\n") : "ยังไม่มี";
  return new EmbedBuilder()
    .setTitle("สิทธิ์และสถานะบอต")
    .setColor(0x5865f2)
    .addFields(
      { name: "คำสั่งทั่วไป", value: state.accessMode === "everyone" ? "ทุกคน" : "เฉพาะรายชื่อที่อนุญาต", inline: true },
      { name: "สถานะบอต", value: state.visibility === "hidden" ? "ซ่อนเป็นออฟไลน์" : "แสดงออนไลน์", inline: true },
      { name: "ผู้ใช้ที่อนุญาต", value: userList.length > 1000 ? userList.slice(0, 950).replace(/\n[^\n]*$/, "") + "\nแสดงบางส่วน" : userList, inline: false },
      { name: "ยศที่อนุญาต", value: roleList.length > 1000 ? roleList.slice(0, 950).replace(/\n[^\n]*$/, "") + "\nแสดงบางส่วน" : roleList, inline: false }
    )
    .setFooter({ text: "เจ้าของเซิร์ฟเวอร์และผู้ดูแลหลักยังใช้ได้ทุกเมนู" })
    .setTimestamp();
}

export async function handleBotControlCommand(interaction: any, applyPresence: () => Promise<void>): Promise<void> {
  const sub = interaction.options.getSubcommand();
  let state: AccessState;
  if (sub === "status") {
    state = await loadBotAccess(true);
  } else if (sub === "mode") {
    state = await updateBotAccess(interaction.user.id, { action: "set_mode", value: interaction.options.getString("value", true) }, botMemberRoleIds(interaction));
  } else if (sub === "visibility") {
    state = await updateBotAccess(interaction.user.id, { action: "set_visibility", value: interaction.options.getString("value", true) }, botMemberRoleIds(interaction));
    await applyPresence();
  } else {
    const isRole = sub.endsWith("role");
    const subject = isRole ? interaction.options.getRole("role", true) : interaction.options.getUser("user", true);
    state = await updateBotAccess(interaction.user.id, {
      action: sub.startsWith("allow") ? "allow" : "remove",
      subjectType: isRole ? "role" : "user",
      discordId: subject.id,
    }, botMemberRoleIds(interaction));
  }
  interaction.recordBotActivity?.({ outcome: "success", result: sub === "status" ? "อ่านการตั้งค่าปัจจุบันแล้ว ไม่มีการเปลี่ยนสิทธิ์" : "บันทึกการตั้งค่าบอตแล้ว", details: `ใครใช้คำสั่งได้: ${state.accessMode === "everyone" ? "ทุกคนในเซิร์ฟเวอร์" : "เฉพาะรายชื่อที่อนุญาต"}\nสถานะบอตในรายชื่อสมาชิก: ${state.visibility === "hidden" ? "ซ่อน" : "แสดง"}\nรายชื่อที่อนุญาต: ${state.users.length} ผู้ใช้ · ${state.roles.length} ยศ` });
	await interaction.editReply({ embeds: [await botAccessStateEmbed(state, interaction)] });
}
