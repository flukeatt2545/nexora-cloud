import { randomUUID } from "node:crypto";
import { ActionRowBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder } from "discord.js";

type PickerSession = { actorId: string; type: "user" | "role"; scope: string; initial: string[]; editable: string[]; expiresAt: number };
const sessions = new Map<string, PickerSession>();
const sameIds = (a: string[], b: string[]) => [...a].sort().join(",") === [...b].sort().join(",");

export function accessPicker(actorId: string, type: "user" | "role", ids: string[], scope = "") {
  for (const [key, session] of sessions) if (session.expiresAt <= Date.now() || session.actorId === actorId && session.type === type) sessions.delete(key);
  if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value!);
  const key = `bot_panel_save_${type === "user" ? "users" : "roles"}:${randomUUID()}`;
  const editable = ids.slice(0, 25);
  sessions.set(key, {actorId, type, scope, initial: [...ids], editable, expiresAt: Date.now() + 15 * 60 * 1000});
  const select = type === "user"
    ? new UserSelectMenuBuilder().setDefaultUsers(editable)
    : new RoleSelectMenuBuilder().setDefaultRoles(editable);
  select.setCustomId(key).setPlaceholder(type === "user" ? "เลือกผู้ใช้ที่อนุญาต" : "เลือกยศที่อนุญาต").setMinValues(0).setMaxValues(25);
  return { content: "ติ๊กไว้ = มีสิทธิ์\nเพิ่มติ๊กเพื่อให้สิทธิ์ หรือเอาติ๊กออกเพื่อถอนสิทธิ์ บันทึกให้อัตโนมัติเมื่อเลือกเสร็จ" + (ids.length > 25 ? "\nแก้ได้ครั้งละ 25 รายชื่อ รายชื่อที่เหลือยังมีสิทธิ์เหมือนเดิม" : ""), components: [new ActionRowBuilder<any>().addComponents(select)], allowedMentions: {parse: [] as string[]} };
}

export function accessPickerScope(key: string, actorId: string): string {
  const session=sessions.get(key);
  if (!session || session.actorId!==actorId || session.expiresAt<=Date.now()) throw new Error("เมนูนี้หมดอายุแล้ว เปิดเมนูจัดการสิทธิ์ใหม่อีกครั้ง");
  return session.scope;
}

export function consumeAccessPicker(key: string, actorId: string, selected: string[], current: string[]) {
  const session = sessions.get(key);
  if (!session || session.expiresAt <= Date.now() || session.actorId !== actorId) throw new Error("เมนูนี้หมดอายุแล้ว เปิดเมนูจัดการสิทธิ์ใหม่อีกครั้ง");
  if (selected.length > 25 || new Set(selected).size !== selected.length || selected.some(id => !/^\d{17,20}$/.test(id))) throw new Error("รายชื่อไม่ถูกต้อง เปิดเมนูใหม่แล้วเลือกอีกครั้ง");
  sessions.delete(key);
  if (!sameIds(session.initial, current)) throw new Error("รายชื่อสิทธิ์เปลี่ยนไปแล้ว เปิดเมนูใหม่ก่อนแก้ไข");
  return {
    type: session.type,
    scope: session.scope,
    remove: session.editable.filter(id => !selected.includes(id)),
    add: selected.filter(id => !session.initial.includes(id)),
  };
}
