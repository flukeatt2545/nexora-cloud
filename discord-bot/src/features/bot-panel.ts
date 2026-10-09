import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type MessageComponentInteraction,
} from "discord.js";
import { botAccessStateEmbed, botMemberRoleIds, botSubjectLabels, canUseBotScope, commandScopeLabels, loadBotAccess, matchesBotSubjects, updateBotAccess, type LabelSource } from "./bot-control";
import { recordActivity } from "./activity-log";
import { isPanelMainMenu, panelActionMenu } from "./panel-actions";
import { discordMention } from "./discord-mentions";
import { accessPicker, accessPickerScope, consumeAccessPicker } from "./access-picker";

export const botPanelCommand = new SlashCommandBuilder()
  .setName("bot-panel")
  .setDescription("สร้างแผงควบคุมบอตในห้องนี้")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function buildBotPanelPayload() {
  const state = await loadBotAccess(true);
  const restricted = state.accessMode === "allowlist";
  const hidden = state.visibility === "hidden";
  const embed = new EmbedBuilder()
    .setTitle("แผงควบคุม NEXORA")
    .setColor(0x5865f2)
    .setDescription("เลือกเมนูเพื่อใช้งานหรือตั้งค่าบอต")
    .addFields(
      { name: "คำสั่งทั่วไป", value: restricted ? "เฉพาะผู้ใช้และยศที่อนุญาต" : "ทุกคนในเซิร์ฟเวอร์", inline: false },
      { name: "การแสดงสถานะ", value: hidden ? "ซ่อนสถานะออนไลน์" : "แสดงสถานะออนไลน์", inline: false },
      { name: "รายชื่อที่อนุญาต", value: state.users.length || state.roles.length ? `${state.users.length} ผู้ใช้ · ${state.roles.length} ยศ` : "ยังไม่ได้เพิ่มรายชื่อ", inline: false }
    )
    .setFooter({ text: "คำตอบจากเมนูจะเห็นเฉพาะคุณ" });

  return { embeds: [embed], components: [panelActionMenu()] };
}

async function pickerPayload(interaction: LabelSource, actorId: string, type: "user" | "role", state: Awaited<ReturnType<typeof loadBotAccess>>, scope="") {
  const subjects=scope ? state.commandAccess?.[scope] || {users:[],roles:[]} : state;
  const payload = accessPicker(actorId, type, type === "user" ? subjects.users : subjects.roles,scope);
  const [userLabels,roleLabels]=await Promise.all([botSubjectLabels(interaction,subjects.users,"user"),botSubjectLabels(interaction,subjects.roles,"role")]);
  const embed=scope ? new EmbedBuilder().setTitle(commandScopeLabels[scope]).setColor(0x5865f2).setDescription(scope === "bot.permissions" ? "ผู้ที่ได้รับสิทธิ์นี้เพิ่มหรือถอนสิทธิ์ทุกเมนูให้คนอื่นได้ รวมถึงตัวเอง" : "ให้สิทธิ์เฉพาะเมนูนี้ ไม่รวมเมนูอื่น").addFields(
    {name:"ผู้ใช้ที่อนุญาต",value:userLabels.join("\n").slice(0,900)||"ยังไม่มี"},
    {name:"ยศที่อนุญาต",value:roleLabels.join("\n").slice(0,900)||"ยังไม่มี"}) : await botAccessStateEmbed(state,interaction);
  if (scope === "bot.status") {
    const [generalUsers,generalRoles]=await Promise.all([botSubjectLabels(interaction,state.users,"user"),botSubjectLabels(interaction,state.roles,"role")]);
    embed.addFields({name:"สิทธิ์ดูสถานะจากรายชื่อทั่วไป",value:[...generalUsers,...generalRoles].join("\n").slice(0,900)||"ยังไม่มี"}).setDescription("ช่องติ๊กจัดการสิทธิ์เมนูโดยตรง รายชื่อทั่วไปด้านล่างมีสิทธิ์ดูสถานะด้วย หากต้องการถอนสิทธิ์ส่วนนั้น ให้แก้รายชื่อทั่วไป");
  }
  if (["db","code"].includes(scope)) {
    const [generalUsers,generalRoles]=await Promise.all([botSubjectLabels(interaction,state.users,"user"),botSubjectLabels(interaction,state.roles,"role")]);
    embed.addFields({name:"สิทธิ์จากคำสั่งทั่วไป",value:state.accessMode === "everyone" ? "ทุกคนในเซิร์ฟเวอร์" : [...generalUsers,...generalRoles].join("\n").slice(0,900)||"ยังไม่มี"}).setDescription("ช่องติ๊กให้สิทธิ์เมนูนี้เพิ่มจากสิทธิ์ทั่วไป เอาติ๊กออกไม่ถอนสิทธิ์ที่มาจากโหมดทุกคนหรือรายชื่อทั่วไป และยังต้องผ่านการตรวจเจ้าของบัญชี");
  }
  return { ...payload, content: payload.content + (!scope && state.accessMode === "everyone" ? "\nขณะนี้ทุกคนใช้คำสั่งทั่วไปได้ รายชื่อนี้ใช้จำกัดคำสั่งทั่วไปเมื่อเลือกโหมดเฉพาะรายชื่อ และอนุญาตให้ดูสถานะบอตได้" : ""), embeds: [embed] };
}

export async function handleBotPanelComponent(
  interaction: ButtonInteraction | AnySelectMenuInteraction,
  isAdmin: boolean,
  applyPresence: () => Promise<void>,
  beginReply: (interaction: MessageComponentInteraction) => Promise<void>
): Promise<boolean> {
  const values = interaction.isAnySelectMenu() ? interaction.values : [];
  const customId = isPanelMainMenu(String(interaction.customId || "")) && String(values[0] || "").startsWith("bot_panel_")
    ? values[0] : String(interaction.customId || "");
  if (!customId.startsWith("bot_panel_")) return false;
  await beginReply(interaction);
  const updateAccess = (actorId: string, body: Record<string,string>) => updateBotAccess(actorId, body, botMemberRoleIds(interaction));
  let requiredScope = customId === "bot_panel_status" ? "bot.status" : customId === "bot_panel_mode" ? "bot.mode" : customId === "bot_panel_visibility" ? "bot.visibility" : ["bot_panel_users","bot_panel_toggle_users"].includes(customId) ? "bot.users" : ["bot_panel_roles","bot_panel_toggle_roles"].includes(customId) ? "bot.roles" : "bot.permissions";
  if (customId.startsWith("bot_panel_save_")) {
    try {
      const scope = accessPickerScope(customId, interaction.user.id);
      requiredScope = scope ? "bot.permissions" : customId.startsWith("bot_panel_save_users:") ? "bot.users" : "bot.roles";
    } catch (error) { await interaction.editReply({content:(error as Error).message,components:[]}); return true; }
  }
  if (!await canUseBotScope(interaction,requiredScope,isAdmin)) {
    const payload = { content: customId === "bot_panel_status" ? "คุณไม่มีสิทธิ์ดูสถานะบอต" : "คุณไม่มีสิทธิ์ใช้เมนูนี้", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply({...payload,embeds:[],components:[]});
    else await interaction.reply(payload);
    return true;
  }

  if (customId === "bot_panel_permissions") {
    await interaction.editReply({content:"เลือกเมนูที่จะให้สิทธิ์\nแต่ละเมนูแยกสิทธิ์กัน เมนู ‘กำหนดสิทธิ์แต่ละเมนู’ ให้สิทธิ์จัดการสิทธิ์ของทุกคนด้วย",embeds:[],components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("bot_panel_scope_choose").setPlaceholder("เลือกเมนู").addOptions(Object.entries(commandScopeLabels).map(([value,label])=>({value,label}))))]});
    return true;
  }
  if (customId === "bot_panel_scope_choose") {
    const scope=String(values[0]||"");
    if (!commandScopeLabels[scope]) { await interaction.editReply({content:"เมนูไม่ถูกต้อง",components:[]}); return true; }
    await interaction.editReply({content:`กำหนดสิทธิ์: ${commandScopeLabels[scope]}\nเลือกจัดการผู้ใช้หรือยศ รายชื่อที่ติ๊กไว้คือสิทธิ์ปัจจุบัน`,embeds:[],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("bot_panel_scope_users:"+scope).setLabel("เลือกผู้ใช้").setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId("bot_panel_scope_roles:"+scope).setLabel("เลือกยศ").setStyle(ButtonStyle.Secondary))]});
    return true;
  }
  if (customId.startsWith("bot_panel_scope_users:") || customId.startsWith("bot_panel_scope_roles:")) {
    const scope=customId.split(":")[1];
    if (!commandScopeLabels[scope]) { await interaction.editReply({content:"เมนูไม่ถูกต้อง",components:[]}); return true; }
    await interaction.editReply(await pickerPayload(interaction,interaction.user.id,customId.startsWith("bot_panel_scope_users:")?"user":"role",await loadBotAccess(true),scope));
    return true;
  }

  if (customId === "bot_panel_status") {
    const state=await loadBotAccess(true);
    const embed=await botAccessStateEmbed(state,interaction);
    if (!isAdmin) {
      const available=Object.entries(commandScopeLabels).filter(([scope])=>scope==="bot.status" && matchesBotSubjects(interaction,state) || ["db","code"].includes(scope) && (state.accessMode==="everyone" || matchesBotSubjects(interaction,state)) || matchesBotSubjects(interaction,state.commandAccess?.[scope]||{users:[],roles:[]})).map(([,label])=>label);
      embed.addFields({name:"เมนูที่คุณใช้ได้",value:available.join("\n")||"ยังไม่มี"});
    }
    await interaction.editReply({ content: "", embeds: [embed], components: [] });
    return true;
  }
  if (customId === "bot_panel_users" || customId === "bot_panel_toggle_users") {
    const state = await loadBotAccess(true);
    await interaction.editReply(await pickerPayload(interaction,interaction.user.id, "user", state));
    return true;
  }
  if (customId === "bot_panel_roles" || customId === "bot_panel_toggle_roles") {
    const state = await loadBotAccess(true);
    await interaction.editReply(await pickerPayload(interaction,interaction.user.id, "role", state));
    return true;
  }
  if (customId === "bot_panel_mode") {
    const state = await loadBotAccess(true);
    await updateAccess(interaction.user.id, { action: "set_mode", value: state.accessMode === "everyone" ? "allowlist" : "everyone" });
    recordActivity(interaction, { outcome: "success", result: "เปลี่ยนว่าใครใช้คำสั่งบอตได้แล้ว", details: `ตอนนี้ใช้ได้: ${state.accessMode === "everyone" ? "เฉพาะรายชื่อที่อนุญาต" : "ทุกคนในเซิร์ฟเวอร์"}` });
    await interaction.editReply({ content: "เปลี่ยนโหมดใช้คำสั่งแล้ว", embeds: [await botAccessStateEmbed(await loadBotAccess(),interaction)], components: [] });
    return true;
  }
  if (customId === "bot_panel_visibility") {
    const state = await loadBotAccess(true);
    await updateAccess(interaction.user.id, { action: "set_visibility", value: state.visibility === "online" ? "hidden" : "online" });
    recordActivity(interaction, { outcome: "success", result: "เปลี่ยนการแสดงสถานะบอตแล้ว", details: `ตอนนี้บอต: ${state.visibility === "online" ? "ซ่อนสถานะออนไลน์" : "แสดงสถานะออนไลน์"}` });
    await applyPresence();
    await interaction.editReply({ content: "บันทึกสถานะบอตแล้ว", embeds: [await botAccessStateEmbed(await loadBotAccess(),interaction)], components: [] });
    return true;
  }
  if (customId.startsWith("bot_panel_save_users:") || customId.startsWith("bot_panel_save_roles:")) {
    const subjectType = customId.startsWith("bot_panel_save_users:") ? "user" : "role";
    let state = await loadBotAccess(true);
    let plan;
    let scope="";
    try {
      scope=accessPickerScope(customId,interaction.user.id);
      const subjects=scope ? state.commandAccess?.[scope] || {users:[],roles:[]} : state;
      plan = consumeAccessPicker(customId, interaction.user.id, values, subjectType === "user" ? subjects.users : subjects.roles);
    }
    catch (error) { await interaction.editReply({content: (error as Error).message, embeds: [await botAccessStateEmbed(state,interaction)], components: []}); return true; }
    const changes: string[] = [];
    for (const change of [...plan.remove.map(id => ({ id, action: "remove" })), ...plan.add.map(id => ({ id, action: "allow" }))]) {
      const {id, action} = change;
      state = await updateAccess(interaction.user.id, {
        action,
        subjectType,
        discordId: id,
        ...(scope ? {scope} : {}),
      });
      changes.push(`${action === "remove" ? "ยกเลิกสิทธิ์" : "อนุญาต"}: ${discordMention(id, subjectType)}`);
      recordActivity(interaction, { outcome: "success", result: "อัปเดตสิทธิ์แล้ว", details: (scope ? `เมนู: ${commandScopeLabels[scope]}\n` : "สิทธิ์ใช้บอตทั่วไป\n") + changes.join("\n") });
    }
    const payload = await pickerPayload(interaction,interaction.user.id, subjectType, state,scope);
    await interaction.editReply({ ...payload, content: `${changes.length ? "อัปเดตสิทธิ์แล้ว" : "รายชื่อเหมือนเดิม"}\n${payload.content}` });
    return true;
  }
  return false;
}
