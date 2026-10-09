export function discordMention(id: string, type: "user" | "role" = "user"): string {
  return /^\d{17,20}$/.test(id) ? `<@${type === "role" ? "&" : ""}${id}>` : "ไม่พบผู้ใช้หรือยศ";
}

export function discordMentionList(ids: string[], type: "user" | "role"): string {
  const visible = ids.slice(0, 5).map(id => discordMention(id, type));
  return visible.join(", ") + (ids.length > 5 ? ` · และอีก ${ids.length - 5} รายการ (ดูรายละเอียดด้านล่าง)` : "");
}
