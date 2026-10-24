// CrowdSec uses fixed durations: one month = 30 days, one year = 365 days.
export const banDurationOptions = [
  { label: "ถาวร", value: "permanent", default: true },
  ...[1, 5, 10, 30].map(n => ({ label: `${n} วินาที`, value: `${n}s` })),
  ...[1, 5, 15, 30].map(n => ({ label: `${n} นาที`, value: `${n}m` })),
  ...[1, 4, 6, 12].map(n => ({ label: `${n} ชั่วโมง`, value: `${n}h` })),
  ...[1, 3, 7, 14].map(n => ({ label: `${n} วัน`, value: `${n * 24}h` })),
  ...[1, 3, 6].map(n => ({ label: `${n} เดือน`, value: `${n * 720}h` })),
  ...[1, 2, 5].map(n => ({ label: `${n} ปี`, value: `${n * 8760}h` })),
  { label: "กำหนดเอง", value: "custom" },
];

export function resolvePanelBanDuration(selection: string, custom: string): string {
  if (!banDurationOptions.some(option => option.value === selection)) throw new Error("เลือกระยะเวลาจากรายการอีกครั้ง");
  if (selection !== "custom") {
    if (custom) throw new Error("หากต้องการใช้เวลาที่พิมพ์ ให้เลือก ‘กำหนดเอง’");
    return selection === "permanent" ? "" : selection;
  }
  const match = /^(\d+)\s*(mo|y|s|m|h|d|w|วินาที|นาที|ชั่วโมง|วัน|สัปดาห์|เดือน|ปี)$/i.exec(custom.trim());
  if (!match) throw new Error("ระบุเวลา เช่น 45 วินาที, 2 ชั่วโมง, 2 เดือน หรือ 1 ปี");
  const factors: Record<string, number> = { s: 1, วินาที: 1, m: 60, นาที: 60, h: 3600, ชั่วโมง: 3600, d: 86400, วัน: 86400, w: 604800, สัปดาห์: 604800, mo: 2592000, เดือน: 2592000, y: 31536000, ปี: 31536000 };
  const seconds = Number(match[1]) * factors[match[2].toLowerCase()];
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 315360000) throw new Error("กำหนดเวลาได้ตั้งแต่ 1 วินาทีถึง 10 ปี หรือเลือก ‘ถาวร’");
  return `${seconds}s`;
}
