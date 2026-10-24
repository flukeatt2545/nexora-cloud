export type SiteTitleMode = "page" | "custom";

type TitleSettings = {
  brandName?: string;
  siteTitle?: string;
  siteTitleMode?: SiteTitleMode;
};

const routeTitles: Array<[string, string]> = [
  ["/admin/settings/homepage", "ตั้งค่าหน้าแรก"],
  ["/admin/store/categories", "หมวดหมู่สินค้า"],
  ["/admin/store/products", "จัดการสินค้า"],
  ["/admin/store/orders", "คำสั่งซื้อ"],
  ["/admin/store/sales", "ยอดขาย"],
  ["/admin/topups/transactions", "รายการเติมเงิน"],
  ["/admin/topups/settings", "ตั้งค่าการเติมเงิน"],
  ["/admin/file-categories", "หมวดหมู่ไฟล์"],
  ["/admin/announcements", "ประกาศ"],
  ["/admin/file-system", "ระบบไฟล์"],
  ["/admin/databases", "จัดการฐานข้อมูล"],
  ["/admin/settings", "ตั้งค่าระบบ"],
  ["/admin/hosting", "จัดการเว็บไซต์"],
  ["/admin/bots/list", "บอททั้งหมด"],
  ["/admin/bots/quotas", "โควตาบอท"],
  ["/admin/bots/activity", "คิวงานและประวัติบอท"],
  ["/admin/bots", "ภาพรวมบอทของผู้ใช้"],
  ["/admin/topups", "จัดการเติมเงิน"],
  ["/admin/profile", "โปรไฟล์ผู้ดูแล"],
  ["/admin/access", "สิทธิ์การใช้งาน"],
  ["/admin/users", "จัดการผู้ใช้"],
  ["/admin/files", "จัดการไฟล์"],
  ["/admin/logs", "บันทึกระบบ"],
  ["/admin", "แดชบอร์ดผู้ดูแล"],
  ["/dashboard", "แดชบอร์ด"],
  ["/profile", "โปรไฟล์"],
  ["/hosting", "เว็บไซต์ของฉัน"],
  ["/bots", "บอท Discord"],
  ["/files/d/", "ดาวน์โหลดไฟล์"],
  ["/files/c/", "แชร์โฟลเดอร์"],
  ["/files", "ไฟล์ของฉัน"],
  ["/topups", "ประวัติพอยท์"],
  ["/store", "ร้านค้า"],
  ["/terms", "ข้อกำหนดการใช้งาน"],
  ["/share", "ไฟล์ของฉัน"],
  ["/c/", "เข้าสู่ระบบ"],
  ["/", "หน้าหลัก"],
];

export function getPageLabel(pathname: string): string {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const match = routeTitles.find(([route]) => route === "/" ? normalized === "/" : normalized === route || normalized.startsWith(route.endsWith("/") ? route : `${route}/`));
  return match?.[1] || "NEXORA CLOUD";
}

export function getDocumentTitle(settings: TitleSettings, pathname: string): string {
  const siteTitle = settings.siteTitle?.trim() || settings.brandName?.trim() || "NEXORA CLOUD";
  if (settings.siteTitleMode === "custom") return siteTitle;
  return `${getPageLabel(pathname)} · ${siteTitle}`;
}
