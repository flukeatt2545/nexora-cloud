// What changed in each release, shown on /changelog.
//
// Add a release at the top of RELEASES (the page sorts by version anyway, newest first).
// Categories follow Keep a Changelog (https://keepachangelog.com):
//   added       new features
//   changed     changes to existing behaviour
//   deprecated  still works, but going away soon
//   removed     gone
//   fixed       bug fixes
//   security    fixes for vulnerabilities
// `th` is required; `en` is shown when the visitor switches to English (falls back to `th`).

export type ChangeType = "added" | "changed" | "deprecated" | "removed" | "fixed" | "security";

export type Change = { type: ChangeType; th: string; en?: string };

export type Release = {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  changes: Change[];
};

export const CHANGE_TYPES: ChangeType[] = ["added", "changed", "deprecated", "removed", "fixed", "security"];

export const RELEASES: Release[] = [
  {
    version: "1.2.10",
    date: "2026-11-01",
    changes: [
      { type: "changed", th: "ข้อความตอนปิดการเข้าด้วยรหัสผ่านมีไอคอนและกรอบ และเปลี่ยนคำเป็น ตอนนี้เข้าได้ผ่านช่องทางเหล่านี้เท่านั้น", en: "The notice shown when password sign-in is off now has an icon and a frame, with clearer wording" },
    ],
  },
  {
    version: "1.2.9",
    date: "2026-11-01",
    changes: [
      { type: "fixed", th: "ข้อความตอนปิดการเข้าด้วยรหัสผ่านยาวจนตกบรรทัด ตอนนี้สั้นลงและไม่มีไอคอนกุญแจสีเหลือง", en: "The notice shown when password sign-in is off was long enough to wrap; it is now shorter, without the yellow lock" },
    ],
  },
  {
    version: "1.2.8",
    date: "2026-11-01",
    changes: [
      { type: "changed", th: "จัดหน้าต่างเข้าสู่ระบบใหม่ คำไม่ซ้ำ ปุ่มโซเชียลกว้างเท่ากัน และเปลี่ยนไปสมัครสมาชิกจากลิงก์ด้านล่าง", en: "A simpler sign-in dialog: no repeated wording, equal-width social buttons and a link below to switch to sign-up" },
      { type: "added", th: "เตือนเมื่อ Caps Lock เปิดอยู่ตอนกรอกรหัสผ่าน และกรอกผิดแล้วเคอร์เซอร์ไปที่ช่องนั้นทันที", en: "A Caps Lock warning while typing a password, and the cursor jumps to the field with a mistake" },
      { type: "fixed", th: "ปิดรับสมัครแล้วแท็บเข้าสู่ระบบกินแค่ครึ่งแถว และกด Tab แล้วเคอร์เซอร์หลุดออกนอกหน้าต่าง", en: "With sign-ups closed the sign-in tab filled only half its row, and Tab could move focus out of the dialog" },
    ],
  },
  {
    version: "1.2.7",
    date: "2026-11-01",
    changes: [
      { type: "changed", th: "กิจกรรมล่าสุดในหน้าภาพรวมแอดมินอ่านง่ายขึ้น เวลาสั้นลง จำนวนครั้งเขียนเป็นคำ และแต่ละแถวมีไอคอนบอกประเภทแทนจุดสีเขียว รายการที่ไม่สำเร็จไอคอนและตัวหนังสือเป็นสีแดง", en: "Recent activity on the admin overview is easier to read: shorter times, counts in words and an icon for each kind of entry instead of a green dot; failed entries show in red" },
      { type: "changed", th: "นำไอคอนกลับมาในหน้าภาพรวมแอดมิน ทั้งตัวเลขสรุป หัวข้อการ์ด และสถานะระบบ", en: "Icons are back on the admin overview: figures, card headings and system status" },
    ],
  },
  {
    version: "1.2.6",
    date: "2026-11-01",
    changes: [
      { type: "changed", th: "จัดหน้าภาพรวมแอดมินใหม่ ปรับคำให้สั้นและตรงขึ้น เอาไอคอนที่ไม่จำเป็นออก และแจ้งเตือนกว้างเต็มแถว", en: "A cleaner admin overview: shorter, plainer wording, fewer decorative icons and full-width alerts" },
      { type: "changed", th: "บัญชีที่ถูกระงับไม่ขึ้นเป็นแจ้งเตือนแล้ว ดูจำนวนได้ที่ตัวเลขผู้ใช้และสถานะระบบ", en: "Suspended accounts are no longer an alert; the count stays in the user figure and system status" },
      { type: "fixed", th: "การ์ดทางลัด สถานะระบบ และกราฟยอดขายในหน้าภาพรวมแอดมินมีที่ว่างเหลือด้านล่าง ตอนนี้เนื้อหาเต็มการ์ดแล้ว", en: "The shortcuts, system status and sales cards on the admin overview left empty space at the bottom; their content now fills the card" },
      { type: "fixed", th: "แอดมินทั่วไปเห็นการ์ดทางลัดกินแค่ครึ่งแถวและมีช่องว่างข้าง ๆ ตอนนี้เต็มแถวแล้ว", en: "For regular admins the shortcuts card filled only half its row; it now spans the full width" },
    ],
  },
  {
    version: "1.2.5",
    date: "2026-11-01",
    changes: [
      { type: "changed", th: "จัดเมนูบัญชีมุมขวาบนใหม่ เล็กลง อ่านง่ายขึ้น ใช้สีหลักของเว็บ และบอกว่าตอนนี้อยู่หน้าไหน", en: "A tidier account menu: smaller, easier to read, in the site's main colour, and it shows which page you're on" },
      { type: "changed", th: "เมนูบัญชีใช้คีย์บอร์ดได้ กดลูกศรเลื่อนและกด Esc เพื่อปิด บนจอเตี้ยเลื่อนดูได้ และบนมือถือแตะง่ายขึ้น", en: "The account menu works from the keyboard (arrows to move, Esc to close), scrolls on short screens and is easier to tap on phones" },
      { type: "fixed", th: "เอาเมาส์ชี้รายการธรรมดาในเมนูบัญชีแล้วขึ้นพื้นสีแดงเหมือนปุ่มอันตราย ตอนนี้สีแดงเหลือเฉพาะออกจากระบบ", en: "Ordinary items in the account menu turned red on hover like a danger button; only Sign out is red now" },
    ],
  },
  {
    version: "1.2.4",
    date: "2026-11-01",
    changes: [
      { type: "fixed", th: "ตัวเลขอีเมลที่ยังไม่อ่านในรายการกล่องอีเมลเบี้ยวเป็นทรงเฉียง และไม่ตรงแถวกัน ตอนนี้เรียงตรงกันทุกแถวแล้ว", en: "Unread counts in the mailbox list were skewed and out of line; they now line up on every row" },
      { type: "changed", th: "ปุ่มเลือกกล่องอีเมลแสดงที่อยู่ได้ยาวขึ้น และจุดแจ้งว่ากล่องอื่นมีอีเมลใหม่ย้ายไปอยู่บนรูปกล่อง", en: "The mailbox button has more room for the address, and the dot for unread mail in other mailboxes now sits on the avatar" },
      { type: "changed", th: "ปรับคำในหน้าอีเมลให้สั้นและอ่านง่ายขึ้น", en: "Shorter, plainer wording across the mail page" },
      { type: "fixed", th: "ป้ายตัวเลขและป้าย ใหม่ บนเมนูข้างเบี้ยวเป็นทรงเฉียงตอนใช้หน้าตาแบบเหลี่ยม ตอนนี้แสดงปกติแล้ว", en: "The count and New labels in the sidebar were skewed in square mode; they now look right" },
      { type: "fixed", th: "เมนูโปรไฟล์มุมขวาบนมองทะลุเห็นเนื้อหาด้านหลัง ตอนนี้พื้นหลังทึบแล้ว และปุ่มออกจากระบบดูเรียบขึ้น", en: "The profile menu let the page show through; it now has a solid background and a quieter sign-out button" },
    ],
  },
  {
    version: "1.2.3",
    date: "2026-11-01",
    changes: [
      { type: "fixed", th: "รูปในอีเมลที่เคยขึ้นว่า [รูปภาพภายนอกถูกบล็อก] แสดงได้แล้ว โดยเซิร์ฟเวอร์ของเราเป็นคนดึงรูปให้ ผู้ส่งจึงไม่เห็น IP ของผู้อ่าน และเมื่อตอบกลับหรือส่งต่อ ผู้รับก็เห็นรูปด้วย", en: "Images in emails that showed [external image blocked] now appear. Our server fetches them, so senders don't see the reader's IP address, and they stay visible to recipients when you reply or forward" },
    ],
  },
  {
    version: "1.2.2",
    date: "2026-10-30",
    changes: [
      { type: "changed", th: "หน้าแจ้งข้อผิดพลาด เช่น ไม่พบหน้า ระบบมีปัญหา ถูกบล็อก และปิดปรับปรุง ใช้หน้าตาตามที่ตั้งไว้ในหน้าแอดมิน ถ้าตั้งเป็นแบบเหลี่ยมจะเป็นการ์ดแบบเดียวกับหน้ายืนยันตัวตน Discord และใช้โหมดสว่างหรือมืดกับสีหลักของเว็บด้วย", en: "Error pages (not found, server error, blocked, maintenance) follow the look set by the admin: in square mode they use the Discord verify page's card, along with the site's light or dark mode and main colour" },
      { type: "changed", th: "เขียนข้อความในหน้าแจ้งข้อผิดพลาดใหม่ให้สั้นและอ่านง่าย หัวข้อไม่ตัดกลางคำ มีปุ่มโหลดหน้าใหม่ตอนเว็บมีปัญหา และตอนปิดปรับปรุงจะบอกเวลาที่เปิดอีกครั้งเป็นเวลาไทย", en: "Shorter, plainer wording on error pages, titles that don't break mid-word, a reload button when the site has a problem, and the reopening time shown in Thai time during maintenance" },
      { type: "fixed", th: "ตัวหนังสือ NEXORA ด้านหลังหน้ายืนยันตัวตนและหน้าแจ้งข้อผิดพลาด บางแถวเลื่อนช้ากว่าแถวอื่นมาก ตอนนี้ทั้งสามแถวเลื่อนเร็วพอ ๆ กัน", en: "The big NEXORA rows behind the verify and error pages: one row could crawl while the others moved; all three now move at a similar speed" },
      { type: "fixed", th: "ปิด Animation effects ใน Windows แล้วตัวหนังสือและแอนิเมชันบนเว็บหยุดนิ่ง ตอนนี้แอนิเมชันทำงานเหมือนเดิมทั้งเว็บ", en: "Turning off Animation effects in Windows froze text and animations on the site; they now run as usual everywhere" },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-10-29",
    changes: [
      { type: "changed", th: "บอท Discord เลิกส่งข้อความแจ้งเว็บล่มแล้ว เหลือแค่รูปสถานะในห้อง การแจ้งล่มย้ายไปที่ตัวเช็กจาก Cloudflare ที่เดียว ข้อความเลยไม่ซ้ำกัน", en: "The Discord bot no longer posts down/back messages, only the status picture; alerts now come from the Cloudflare checker alone, so they are not doubled" },
      { type: "fixed", th: "รูปบอทในหน้าบอท Discord ไม่ขึ้นหลังเปลี่ยนรูปใน Discord ตอนนี้ดึงรูปใหม่เองทุกชั่วโมง และขึ้นไอคอนแทนถ้าโหลดไม่ได้", en: "The bot's picture on the Discord bot page broke after changing it in Discord; it is now read again every hour, with an icon if it will not load" },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-29",
    changes: [
      { type: "changed", th: "หน้าบอท Discord เลือกบอทก่อน แล้วค่อยเห็นเมนูของบอทนั้น ไม่ปนกันเป็นรายการยาว", en: "The Discord bot page: pick a bot first, then see only its tabs instead of one long menu" },
      { type: "added", th: "เช็กเว็บล่มจาก Cloudflare ทุกนาที แจ้งใน Discord ได้แม้เซิร์ฟเวอร์ดับทั้งเครื่อง", en: "An outside uptime checker on Cloudflare: checks every minute and alerts Discord even when the whole server is down" },
      { type: "added", th: "ตั้งค่าได้ในหน้าบอท Discord ว่าจะเช็กเว็บไหน พลาดกี่รอบถึงแจ้ง แท็ก role ไหน และลองส่งข้อความดูก่อนได้", en: "Settings for the outside checker on the Discord bot page: what to check, when to alert, which role to tag, and a test message" },
      { type: "added", th: "หน้าสถานะบอกว่าเว็บตอบเร็วแค่ไหน uptime 24 ชั่วโมงกับ 7 วัน และเคยล่มช่วงไหน แยกผลจาก Cloudflare กับจากบอทในเครื่อง", en: "A results page: latest status, speed, 24-hour and 7-day uptime, and outage history, marked by where each result came from" },
    ],
  },
  {
    version: "1.1.2",
    date: "2026-10-29",
    changes: [
      { type: "changed", th: "บอทแจ้งสถานะลองเรียกเว็บโดยตรงก่อนประกาศว่าเว็บล่ม ถ้าตัวเว็บยังทำงานแต่เข้าผ่านอินเทอร์เน็ตไม่ได้ จะรอประมาณ 3 นาทีก่อนแจ้ง และบอกสาเหตุให้ชัด", en: "The status bot checks the site directly before calling it down; if the site is up but unreachable from the internet, it waits about 3 minutes and says so" },
      { type: "changed", th: "บอทแจ้งสถานะบันทึกรายละเอียดทุกครั้งที่เช็กไม่ผ่าน ทั้งปลายทางที่เชื่อมต่อและเวลาที่ใช้แต่ละขั้น เพื่อหาสาเหตุได้ง่ายขึ้น", en: "The status bot logs every failed check with the address it reached and the time each step took" },
    ],
  },
  {
    version: "1.1.1",
    date: "2026-10-28",
    changes: [
      { type: "changed", th: "ลิงก์บนเมนูขึ้นว่า \"มีอัปเดตใหม่\" เมื่อมีเวอร์ชันที่ยังไม่ได้เปิดดู และไม่มีไอคอนดาวแล้ว", en: "The menu link reads \"New update\" while there is one you haven't opened, and the star icon is gone" },
      { type: "changed", th: "จัดหน้าบันทึกการอัปเดตใหม่ จอใหญ่มีคอลัมน์ข้างสำหรับค้นหา เลือกหมวด และกระโดดไปเวอร์ชันที่ต้องการ", en: "A new changelog layout: on wide screens a side column holds search, categories and a version list" },
      { type: "changed", th: "หน้าแรก หน้าบันทึกการอัปเดต และหน้าข้อกำหนดการใช้งานมีหน้าโหลดระหว่างรอข้อมูลของเว็บ", en: "The home, changelog and terms pages show a loading screen while the site settings load" },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-28",
    changes: [
      { type: "added", th: "จุดแจ้งเตือนบนเมนูเมื่อมีอัปเดตใหม่ กดเข้ามาดูได้ทันที", en: "A dot on the menu when there is a new update, linking straight here" },
      { type: "added", th: "แถบแจ้งอัปเดตใหม่บนหน้าภาพรวมของแดชบอร์ด", en: "A new-update banner on the dashboard overview" },
      { type: "added", th: "ไฮไลต์คำที่ค้นหา กด / เพื่อเริ่มค้นหา และคัดลอกลิงก์ไปยังเวอร์ชันที่ต้องการได้", en: "Search matches are highlighted, / jumps to search, and each release has a copyable link" },
      { type: "changed", th: "หน้าบันทึกการอัปเดตแบบใหม่ เรียงเป็นไทม์ไลน์ และใช้บนมือถือได้สะดวกขึ้น", en: "The changelog is now a timeline and works better on phones" },
      { type: "changed", th: "ป้าย Changed เป็นสีฟ้า ไม่ซ้ำกับป้าย Removed", en: "The Changed badge is blue, so it no longer looks like Removed" },
      { type: "fixed", th: "ปุ่มเลือกภาษาที่กดอยู่มองไม่เห็นตัวอักษร", en: "The selected language button had invisible text" },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-28",
    changes: [
      { type: "added", th: "หน้าบันทึกการอัปเดต ค้นหาและกรองตามหมวดได้", en: "A changelog page with search and category filters" },
      { type: "changed", th: "ข้อความแจ้งเตือนตอนเข้าสู่ระบบไม่สำเร็จสั้นลง และแบ่งเป็นสองบรรทัด", en: "Shorter sign-in error messages, split over two lines" },
      { type: "fixed", th: "เข้าสู่ระบบด้วย Google, Discord หรือ GitHub ไม่สำเร็จแล้วไม่มีข้อความบอก เช่น ตอนปิดรับสมัคร", en: "Failed sign-ins with Google, Discord or GitHub showed no message, e.g. while registration was closed" },
      { type: "security", th: "ข้อความแจ้งเตือนบนหน้าแรกไม่รับข้อความจากลิงก์โดยตรงแล้ว", en: "The home page no longer shows notice text taken straight from the link" },
    ],
  },
];
