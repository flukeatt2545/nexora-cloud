import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type Interaction, type MessageComponentInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { activeLocalDecisions, unbanIps } from "./crowdsec";
import { banDurationOptions, resolvePanelBanDuration } from "./ban-duration";
import { randomUUID } from "node:crypto";
import { canUseBotScope } from "./bot-control";
import { recordActivity } from "./activity-log";
import { errorCode } from "./errors";

const actions = [
  { id: "db", label: "เปิดฐานข้อมูล", command: "db", fields: ["code"] },
  { id: "code", label: "เปิดพื้นที่เขียนโค้ด", command: "code", fields: ["code"] },
  { id: "setup", label: "สร้างแผงเข้าใช้งาน", command: "setup-panel", fields: [] },
  { id: "list", label: "ดูรายการผูกรหัส", command: "admin-map", sub: "list", fields: [] },
  { id: "set", label: "ผูกรหัสกับฐานข้อมูล", command: "admin-map", sub: "set", fields: ["code", "database", "name"] },
  { id: "unbind", label: "ยกเลิกการผูกบัญชี", command: "admin-map", sub: "unbind", fields: ["code"] },
  { id: "bans", label: "ดู IP ที่ถูกบล็อก", command: "crowdsec", sub: "bans", fields: [] },
  { id: "ban", label: "บล็อก IP", command: "crowdsec", sub: "ban", fields: ["ip", "duration", "reason"] },
  { id: "unban", label: "ปลดบล็อก IP", command: "crowdsec", sub: "unban", fields: ["ip"] },
  { id: "unban-all", label: "ปลดบล็อก IP ทั้งหมด", command: "crowdsec", sub: "unban-all", fields: [] },
  { id: "lockdown-status", label: "ดูสถานะล็อกดาว", command: "lockdown", sub: "status", scope: "lockdown.status", fields: [] },
  { id: "lockdown-enable", label: "ล็อกเว็บไซต์", command: "lockdown", sub: "enable", scope: "lockdown.manage", fields: ["duration", "reason"] },
  { id: "lockdown-disable", label: "ปลดล็อกเว็บไซต์", command: "lockdown", sub: "disable", scope: "lockdown.manage", fields: [] },
  { id: "lockdown-access", label: "เปิดหน้าควบคุมฉุกเฉิน", command: "lockdown", sub: "access", scope: "lockdown.access", fields: [] },
  { id: "panel", label: "สร้างแผงควบคุมบอต", command: "bot-panel", fields: [] },
];
const labels: Record<string, string> = { code: "รหัสเข้าใช้งาน", database: "Public ID หรือชื่อฐานข้อมูล", name: "ชื่อหรือหมายเหตุ (ไม่บังคับ)", ip: "IP", duration: "ระยะเวลา เช่น 1m, 4h (ว่าง = ถาวร)", reason: "เหตุผล (ไม่บังคับ)" };

export function isPanelMainMenu(customId: string) {
  return customId === "panel_action_choose" || customId.startsWith("panel_action_choose:");
}

export async function resetPanelMainMenu(interaction: MessageComponentInteraction) {
  if (!isPanelMainMenu(String(interaction.customId || "")) || !interaction.message) return;
  // A fresh component ID clears Discord's remembered selection, including after modal cancellation.
  try { await interaction.message.edit({ components: [panelActionMenu()] }); }
  catch (error) { console.warn("[PANEL] Could not reset main menu", errorCode(error) || "unknown"); }
}

export function panelActionMenu() {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
    .setCustomId("panel_action_choose:" + randomUUID()).setPlaceholder("เลือกงานที่ต้องการ")
    .addOptions(actions.map(a => ({ label: a.label, value: a.id })))
    .addOptions([
      { label: "ดูสิทธิ์และสถานะบอต", value: "bot_panel_status" },
      { label: "สลับโหมดทุกคน / เฉพาะรายชื่อ", value: "bot_panel_mode" },
      { label: "จัดการผู้ใช้ที่อนุญาต", value: "bot_panel_users" },
      { label: "จัดการยศที่อนุญาต", value: "bot_panel_roles" },
      { label: "กำหนดสิทธิ์แต่ละเมนู", value: "bot_panel_permissions" },
      { label: "สลับแสดง / ซ่อนสถานะบอต", value: "bot_panel_visibility" }
    ]));
}

/**
 * A choice from the control panel. Returns true when it was handled here, null when it is not a panel
 * action, or a stand-in slash command that the caller runs like the real command.
 */
export async function handlePanelAction(
  interaction: Interaction,
  isAdmin: boolean,
  beginReply: (i: MessageComponentInteraction | ModalSubmitInteraction) => Promise<void>,
  showModal: (i: MessageComponentInteraction, m: ModalBuilder) => Promise<void>,
): Promise<ChatInputCommandInteraction | true | null> {
  if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return null;
  const id = String(interaction.customId || "");
  if (!id.startsWith("panel_action_")) return null;
  const picked = interaction.isAnySelectMenu() ? interaction.values : [];
  if (isPanelMainMenu(id) && String(picked[0] || "").startsWith("bot_panel_")) return null;
  const requestedId = isPanelMainMenu(id) ? picked[0] : id === "panel_action_ip" ? "unban" : id.replace(/^panel_action_(form|run)_/, "");
  const requested = actions.find(action => action.id === requestedId);
  const permitted = isAdmin || (requested && await canUseBotScope(interaction, "scope" in requested && requested.scope ? requested.scope : requested.sub ? `${requested.command}.${requested.sub}` : requested.command, false));
  if (!permitted) { await interaction.reply({ content: "คุณไม่มีสิทธิ์ใช้เมนูนี้", ephemeral: true }); return true; }
  // The main menu is a select menu, so the forms it opens can be shown from here.
  if (isPanelMainMenu(id) && interaction.isMessageComponent()) {
    if (String(picked[0] || "").startsWith("bot_panel_")) return null;
    const action = actions.find(a => a.id === picked[0]);
    if (!action) { await interaction.reply({ content: "เปิดแผงควบคุมใหม่แล้วลองอีกครั้ง", ephemeral: true }); return true; }
    if (action.id === "unban") {
      await beginReply(interaction);
      const decisions = await activeLocalDecisions(true);
      if (!decisions.length) { await interaction.editReply({ content: "ไม่มี IP ที่ถูกบล็อก", embeds: [], components: [] }); return true; }
      await interaction.editReply({ content: "เลือก IP ที่ต้องการปลดบล็อก · ติ๊กได้หลายอัน · แสดงสูงสุด 25 รายการ", embeds: [], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("panel_action_ip").setPlaceholder("แตะเพื่อเลือก IP (เลือกได้หลายอัน)").setMinValues(1).setMaxValues(Math.min(decisions.length, 25)).addOptions(decisions.slice(0,25).map(d => ({ label: String(d.value), value: String(d.value) }))))] });
      return true;
    }
    if (action.fields.length) {
      const modal = new ModalBuilder().setCustomId("panel_action_form_" + action.id).setTitle(action.label);
      for (const field of action.fields) {
        if (action.id === "ban" || action.id === "lockdown-enable") {
          if (field === "duration") {
            modal.addLabelComponents(new LabelBuilder().setLabel("ระยะเวลาบล็อก").setDescription("เดือน = 30 วัน · ปี = 365 วัน")
              .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId("duration_choice").setMinValues(1).setMaxValues(1).addOptions(banDurationOptions)));
            modal.addLabelComponents(new LabelBuilder().setLabel("เวลาเมื่อเลือก ‘กำหนดเอง’").setDescription("เช่น 45 วินาที, 2 ชั่วโมง, 2 เดือน หรือ 1 ปี")
              .setTextInputComponent(new TextInputBuilder().setCustomId("duration_custom").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50)));
          } else {
            modal.addLabelComponents(new LabelBuilder().setLabel(labels[field]).setTextInputComponent(new TextInputBuilder().setCustomId(field).setStyle(TextInputStyle.Short).setRequired(field === "ip").setMaxLength(field === "reason" ? 200 : 100)));
          }
          continue;
        }
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(field).setLabel(labels[field]).setStyle(TextInputStyle.Short).setRequired(!["name", "duration", "reason"].includes(field)).setMaxLength(field === "reason" ? 200 : 100)));
      }
      await showModal(interaction, modal);
      return true;
    }
    await beginReply(interaction);
    await interaction.editReply({ content: "", embeds: [new EmbedBuilder().setTitle(action.label).setDescription(["scan","detect"].includes(action.id) ? "บอตจะตรวจหารหัสและผูกบัญชีให้สมาชิก กดยืนยันเพื่อเริ่ม" : "กดยืนยันเพื่อเริ่ม").setColor(0x5865f2)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("panel_action_run_" + action.id).setLabel("ยืนยัน").setStyle(ButtonStyle.Primary))] });
    return true;
  }
  if (id === "panel_action_ip") {
    const ips = picked.map((v) => String(v)).filter(Boolean);
    if (!ips.length) {
      await interaction.reply({ content: "เลือก IP อย่างน้อย 1 รายการ", ephemeral: true });
      return true;
    }
    await beginReply(interaction);
    const { removed, failed } = await unbanIps(ips);
    recordActivity(interaction, {
      outcome: failed ? "unknown" : "success",
      result: `ปลดบล็อกผ่านแผงควบคุม: สำเร็จ ${removed} IP${failed ? ` · ไม่สำเร็จ ${failed} IP` : ""}`,
    });
    const doneEmbed = failed
      ? new EmbedBuilder().setTitle("ปลดบล็อกเสร็จบางส่วน").setColor(0xf59e0b).setDescription(`ปลดบล็อกสำเร็จ **${removed} IP**\nไม่สำเร็จ **${failed} IP**`).setTimestamp()
      : new EmbedBuilder().setTitle("ปลดบล็อกแล้ว").setColor(0x22c55e).setDescription(`ปลดบล็อก **${removed} IP** ที่เลือกเรียบร้อย`).setFooter({ text: "การเปลี่ยนแปลงมีผลภายในประมาณ 15 วินาที" }).setTimestamp();
    await interaction.editReply({ embeds: [doneEmbed], components: [] });
    return true;
  }

  const actionId = id === "panel_action_ip" ? "unban" : id.replace(/^panel_action_(form|run)_/, "");
  const action = actions.find(a => a.id === actionId);
  if (!action) { await interaction.reply({ content: "เมนูหมดอายุแล้ว เปิดแผงควบคุมใหม่อีกครั้ง", ephemeral: true }); return true; }
  const values: Record<string, string> = {};
  if (id === "panel_action_ip") values.ip = picked[0];
  else if (interaction.isModalSubmit()) {
    for (const field of action.fields) {
      if ((action.id === "ban" || action.id === "lockdown-enable") && field === "duration" && interaction.fields.fields.has("duration_choice")) {
        try {
          values.duration = resolvePanelBanDuration(interaction.fields.getStringSelectValues("duration_choice")[0], interaction.fields.getTextInputValue("duration_custom").trim());
        } catch (error) {
          await beginReply(interaction);
          await interaction.editReply({ content: error instanceof Error ? error.message : "ตรวจสอบระยะเวลาอีกครั้ง", embeds: [], components: [] });
          return true;
        }
      } else values[field] = interaction.fields.getTextInputValue(field).trim();
    }
  }
  return new Proxy<MessageComponentInteraction | ModalSubmitInteraction>(interaction, { get(target, prop) {
    if (prop === "commandName") return action.command;
    if (prop === "customId") return "";
    if (prop === "options") return { getSubcommand: () => action.sub, getString: (key: string) => values[key] || null, getInteger: () => null };
    if (prop === "isChatInputCommand") return () => true;
    if (["isButton", "isAnySelectMenu", "isAutocomplete", "isModalSubmit"].includes(String(prop))) return () => false;
    const value: unknown = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as unknown as ChatInputCommandInteraction;
}
