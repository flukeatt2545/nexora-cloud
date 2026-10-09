"use client";

import {
  Activity, ArrowRight, Ban, Bell, Calendar, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock, Cloud, Database, FileImage, Folder, KeyRound, LayoutDashboard,
  Info, LogOut, Megaphone, Menu, Moon, Pencil, Save, Search, Send, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, Sun, Trash2, User, TriangleAlert, Star, Heart, Gift,
  UserCog, Users, UserPlus, X, Monitor, Smartphone, Globe, Copy, Upload, Maximize2, LayoutGrid, List, UploadCloud, FolderOpen, RefreshCw, FileText, Code, Download, Eye, Check, CheckCircle, CheckCircle2, Store, Package, PlayCircle, StopCircle, Zap, Plus, WalletCards, ReceiptText, TrendingUp, Share2, Server, ListChecks, CheckCheck, Link2, Mail, Bot, EyeOff, PauseCircle, Minus
} from "lucide-react";
import { FormEvent, Fragment, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { createPortal } from "react-dom";
import { useEscape, useScrollLock } from "./useScrollLock";
import "./profile-view.css";
import { getCroppedImg } from "./cropImage";
import { applyThemeColor } from "../themeColor";
import HostingView from "./HostingView";
import DatabaseAdminView from "./DatabaseAdminView";
import FileUpload from "../components/FileUpload";
import { StoreCategoriesView, StoreProductsView } from "./StoreViews";
import { asciiInputProps, filterAsciiInput, filterLatinAlphanumeric, hasNonAscii, latinAlphanumericInputProps } from "../lib/asciiInput";
import { TopupOverviewView, TopupSettingsView, TopupTransactionsView, StoreOrdersView, StoreSalesView } from "./TopupAdminViews";
import FileLibraryView from "./FileLibraryView";
import AdminOverview from "./AdminOverview";
import { UserFileCategoriesView } from "./UserFileViews";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { API_BASE } from "../runtime";
import SocialOAuthButton, { type SocialProvider, useSocialAvailability } from "../SocialOAuthButton";
import AdminMailView from "./AdminMailView";
import DiscordBotView from "./DiscordBotView";
import MailSettingsPanel from "./MailSettingsPanel";
import SmartImage from "../components/SmartImage";
import StoreClosedNotice from "../components/StoreClosedNotice";
import Link from "next/link";

// Admin pages about selling: they show a notice while the store is switched off.
const STORE_VIEWS = new Set<string>(["store-categories", "store-products", "store-orders", "store-sales", "topups", "topup-transactions", "topup-settings"]);

export type DashboardView = "profile" | "hosting" | "databases" | "mail" | "discord-bot" | "overview" | "users" | "access" | "logs" | "announcements" | "settings" | "homepage-settings" | "files" | "file-system" | "file-categories" | "store-categories" | "store-products" | "store-orders" | "store-sales" | "topups" | "topup-transactions" | "topup-settings";
type Role = "user" | "admin" | "superadmin";
type AuthUser = { id: number; username: string; displayName: string; email: string; avatarUrl: string; role: Role; status: string; passwordEnabled?: boolean; permissions: string[] };
type Session = { id: number; ipAddress: string; userAgent: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean };
type LogItem = { id: number; actorUsername: string; actorRole: string; category: string; action: string; targetType: string; targetId: string; targetName?: string; outcome: string; ipAddress: string; userAgent: string; metadata: unknown; createdAt: string };
type ManagedUser = AuthUser & { createdAt: string; lastLoginAt?: string; activeSessions: number };
type SettingsData = {
  brandName: string; siteTitle: string; siteTitleMode: "page" | "custom"; siteDescription: string; primaryColor: string;
  ogTitle?: string; ogDescription?: string; ogImageUrl?: string; ogCardType?: "summary_large_image" | "summary"; ogColor?: string;
  themeMode: "light" | "dark";
  logoUrl: string; faviconUrl: string; authBackgroundUrl: string; authBackgroundTintEnabled: boolean;
  loginTitle: string; loginSubtitle: string; registerTitle: string; registerSubtitle: string;
  localLoginEnabled: boolean; registrationEnabled: boolean; discordEnabled: boolean;
  storeSectionEnabled: boolean;
  storeEnabled: boolean; storeClosedMessage: string;
  quickActionsEnabled: boolean;
  footerEnabled: boolean;
  googleEnabled: boolean; githubEnabled: boolean; sessionTtlMinutes: number;
  discordConfigured: boolean; googleConfigured: boolean; githubConfigured: boolean;
  discordClientId?: string; googleClientId?: string; githubClientId?: string;
  discordClientSecret?: string; googleClientSecret?: string; githubClientSecret?: string;
  clearDiscordOAuth?: boolean; clearGoogleOAuth?: boolean; clearGitHubOAuth?: boolean;
  webhookEnabled: boolean; webhookEvents: string[]; webhookConfigured: boolean;
  discordWebhookUrl?: string; clearDiscordWebhook?: boolean;
};
type LockdownState = { enabled:boolean; startedAt?:string|null; expiresAt?:string|null; privateReason?:string; source?:string; actor?:string };
type ConfirmRequest = { title: string; message: string; confirmLabel?: string; danger?: boolean; action: () => void | Promise<void> };
/** How a marquee looks (colours, icon, direction, speed); stored with the announcement as is. */
type MarqueeMeta = Record<string, string | number | boolean | undefined> & {
  icon?: string; iconColor?: string; textColor?: string; borderColor?: string; backgroundColor?: string;
  borderColorEnabled?: boolean; backgroundColorEnabled?: boolean; direction?: string; repeatCount?: number; speed?: number;
};
type Announcement = {
  id: number; title: string; message: string; imageUrl?: string; customColor?: string; kind: "banner" | "popup" | "marquee";
    meta?: MarqueeMeta;
  placement: "homepage" | "login" | "both"; severity: "info" | "success" | "warning" | "error";
  buttonLabel: string; buttonUrl: string; active: boolean; startsAt?: string; endsAt?: string;
  createdAt: string; updatedAt: string;
};

const roleLabel: Record<Role, string> = { user: "ผู้ใช้ทั่วไป", admin: "ผู้ดูแลระบบ", superadmin: "ผู้ดูแลระบบสูงสุด" };
const statusLabel: Record<string, string> = { active: "ใช้งาน", suspended: "ระงับชั่วคราว", banned: "ถูกแบน" };
const targetTypeLabel: Record<string, string> = {
  "hosting_database": "ฐานข้อมูล",
  "hosting_site": "เว็บไซต์",
  "site": "เว็บไซต์",
  "user": "บัญชีผู้ใช้",
  "session": "เซสชัน",
  "system": "ระบบ",
  "oauth": "บัญชี Social",
  "ip": "IP Address",
  "asset": "ไฟล์สื่อ",
  "announcement": "ประกาศข่าวสาร",
  "settings": "การตั้งค่าระบบ",
  "topup": "รายการเติมเงิน",
  "topup_settings": "ตั้งค่าการเติมเงิน",
  "user_file": "ไฟล์",
  "user_files": "ระบบไฟล์",
  "user_file_category": "หมวดหมู่ไฟล์",
  "user_file_folder": "แฟ้ม",
  "file": "ไฟล์",
  "mail_domain": "โดเมนอีเมล",
  "mail_settings": "การเชื่อมต่ออีเมล",
  "mailbox": "กล่องอีเมล",
  "product": "สินค้า",
  "category": "หมวดหมู่สินค้า",
  "purchase": "คำสั่งซื้อ",
  "discord_bot": "บอท Discord",
  "voice_room": "ห้องเสียง",
  "voice_room_hub": "ห้อง Join to Create",
  "voice_bot_place": "ช่องที่บอทห้องเสียงใช้",
  "voice_bot_message": "ข้อความของบอทห้องเสียง",
  "discord_channel": "ห้องใน Discord",
  "discord_protect_settings": "ระบบป้องกันเซิร์ฟเวอร์",
  "voice_room_settings": "กติกาห้องเสียง",
  "mail_log_settings": "ตั้งค่า Log อีเมล",
  "mail_bot_settings": "การสร้างเมลผ่านบอท",
};

function formatLogTarget(log: LogItem): string {
  if (!log.targetType) return "—";
  const typeName = targetTypeLabel[log.targetType] || log.targetType;
  const meta = logMeta(log);
  // A bulk action names many targets; show how many instead of a long list.
  if (meta && Number(meta.count) > 1) return `${typeName} ${Number(meta.count).toLocaleString("th-TH")} รายการ`;
  let name = "";
  if (meta) {
    const value = meta.db_name || meta.dbName || meta.site_name || meta.siteName || meta.username || meta.title || meta.name || meta.address || "";
    name = typeof value === "string" ? value : String(value);
  }
  // The API looks the name up by id when the entry did not store it (still there if not deleted).
  if (!name && log.targetName) name = log.targetName;
  // Storage keys look like "library/2026/abc/photo.png": the file name is the useful part.
  if (!name && log.targetId.includes("/")) name = log.targetId.split("/").filter(Boolean).pop() || "";
  if (!name && log.targetType === "discord_bot") name = ({ nexora: "บอท NEXORA", mail: "บอทเมล", voice: "บอทห้องเสียง" } as Record<string, string>)[log.targetId] || "";
  if (name) {
    return `${typeName} "${name}"`;
  }
  if (log.targetId) {
    const shortId = log.targetId.length > 12 ? `${log.targetId.slice(0, 8)}...` : log.targetId;
    return `${typeName} (${shortId})`;
  }
  return typeName;
}
const categoryLabel: Record<string, string> = {
  auth: "เข้าสู่ระบบ",
  security: "ความปลอดภัย",
  admin: "งานแอดมิน",
  hosting: "เว็บไซต์และฐานข้อมูล",
  mail: "อีเมล",
  files: "ไฟล์",
  store: "ร้านค้าและเติมเงิน",
  settings: "ตั้งค่าระบบ",
  content: "ประกาศ",
  profile: "โปรไฟล์",
  discord: "Discord",
  workspace: "VS Code",
};

const actionLabel: Record<string, string> = {
  // ===== ยืนยันตัวตน (Auth) =====
  "auth.login": "เข้าสู่ระบบ", "auth.logout": "ออกจากระบบ", "auth.register": "สมัครสมาชิก",
  "auth.oauth": "เข้าสู่ระบบ Social",

  // ===== โปรไฟล์ & ความปลอดภัยส่วนตัว =====
  "profile.updated": "แก้ไขโปรไฟล์", "profile.avatar_updated": "เปลี่ยนรูปโปรไฟล์",
  "password.changed": "เปลี่ยนรหัสผ่าน",
  "session.revoked": "ยกเลิก Session", "sessions.revoked_all": "ยกเลิก Session ทั้งหมด",
  "sessions.revoked_for_user": "นำผู้ใช้ออกจากระบบทุกอุปกรณ์",
  "social.connected": "เชื่อมต่อ Social", "social.disconnected": "ยกเลิกเชื่อมต่อ Social",

  // ===== จัดการผู้ใช้ (Admin) =====
  "user.updated": "แก้ไขข้อมูลผู้ใช้", "user.deleted": "ลบผู้ใช้",
  "user.status_changed": "เปลี่ยนสถานะผู้ใช้", "user.role_changed": "เปลี่ยนสิทธิ์ผู้ใช้",

  // ===== ตั้งค่าระบบ =====
  "settings.updated": "แก้ไขตั้งค่าระบบ",
  "asset.uploaded": "อัปโหลดไฟล์สื่อระบบ",
  "webhook.tested": "ทดสอบ Webhook",
  "topup.settings_updated": "แก้ไขตั้งค่าการเติมเงิน",
  "topup.slip": "เติมเงินด้วยสลิปสำเร็จ",
  "topup.slip_rejected": "ตรวจสลิปไม่ผ่าน",
  "user_file.uploaded": "อัปโหลดไฟล์ส่วนตัว",
  "user_file.deleted": "ลบไฟล์ส่วนตัว",

  // ===== ประกาศข่าวสาร =====
  "announcement.created": "สร้างประกาศ", "announcement.updated": "แก้ไขประกาศ",
  "announcement.deleted": "ลบประกาศ",

  // ===== IP & Security =====
  "ip.banned": "แบน IP Address", "ip.unbanned": "ยกเลิกการแบน IP",

  // ===== เว็บไซต์ (Hosting) =====
  "hosting.site.created": "สร้างเว็บไซต์", "hosting.site.updated": "แก้ไขเว็บไซต์",
  "hosting.site.deleted": "ลบเว็บไซต์",
  "hosting.member.upserted": "เพิ่มหรือเปลี่ยนผู้ร่วมงาน",
  "hosting.member.removed": "นำผู้ร่วมงานออก", "hosting.owner.transferred": "โอนเจ้าของเว็บไซต์",

  // ===== Runtime =====
  "runtime.start.requested": "ร้องขอเริ่มต้นเว็บไซต์",
  "runtime.stop.requested": "ร้องขอหยุดเว็บไซต์",
  "runtime.restart.requested": "ร้องขอรีสตาร์ทเว็บไซต์",
  "runtime.rebuild.requested": "ร้องขอ Rebuild เว็บไซต์",
  "runtime.redeploy.requested": "ร้องขอ Redeploy เว็บไซต์",
  "runtime.redeploy": "สั่ง Redeploy เว็บไซต์",

  // ===== ไฟล์ (Hosting Files) =====
  "hosting.file.saved": "บันทึกไฟล์", "hosting.file.uploaded": "อัปโหลดไฟล์",
  "hosting.folder.created": "สร้างโฟลเดอร์", "hosting.file.moved": "ย้ายหรือเปลี่ยนชื่อไฟล์",
  "hosting.files.archived": "บีบอัดไฟล์ (Zip)", "hosting.files.extracted": "แตกไฟล์ (Unzip)",
  "hosting.file.deleted": "ลบไฟล์",

  // ===== ตัวแปรสภาพแวดล้อม (.env) =====
  "hosting.environment.updated": "แก้ไขตัวแปรสภาพแวดล้อม (.env)",
  "hosting.environment.deleted": "ลบตัวแปรสภาพแวดล้อม (.env)",

  // ===== ฐานข้อมูล (Database) =====
  "hosting.database.created": "สร้างฐานข้อมูลใหม่",
  "hosting.database.suspended": "ระงับการใช้งานฐานข้อมูล",
  "hosting.database.unsuspended": "ปลดระงับฐานข้อมูล",
  "hosting.database.password_reset": "รีเซ็ตรหัสผ่านฐานข้อมูล",
  "hosting.database.transferred": "โอนย้ายเจ้าของฐานข้อมูล",
  "hosting.database.deleted": "ลบฐานข้อมูล",
  "hosting.database_provisioned": "สร้างฐานข้อมูลอัตโนมัติสำหรับเว็บไซต์",

  // ===== phpMyAdmin =====
  "hosting.database.phpmyadmin_opened": "เข้าใช้งาน phpMyAdmin",
  "hosting.database.phpmyadmin_ticket_created": "สร้างโทเค็นเข้า phpMyAdmin",
  "admin.database.phpmyadmin_ticket_created": "สร้างโทเค็นเข้า phpMyAdmin (แอดมิน)",

  // ===== กิจกรรมใน phpMyAdmin (Database Operations) =====
  "hosting.database.rows_viewed": "ดูข้อมูลในตาราง",
  "hosting.database.schema_viewed": "ดูโครงสร้างตาราง",
  "hosting.database.row_insert": "เพิ่มข้อมูลในตาราง",
  "hosting.database.row_update": "แก้ไขข้อมูลในตาราง",
  "hosting.database.row_delete": "ลบข้อมูลในตาราง",
  "hosting.database.table_created": "สร้างตารางใหม่",
  "hosting.database.table_dropped": "ลบตาราง",
  "hosting.database.table_altered": "แก้ไขโครงสร้างตาราง",
  "hosting.database.query_executed": "รันคำสั่ง SQL",
  "hosting.database.exported": "ส่งออกข้อมูล (Export)",
  "hosting.database.imported": "นำเข้าข้อมูล (Import)",

  // ===== เทมเพลต =====
  "hosting.generate_starter": "สร้างโปรเจกต์เริ่มต้น",

  // ===== ร้านค้า =====
  "category.created": "สร้างหมวดหมู่สินค้า",
  "product.created": "เพิ่มสินค้า", "product.updated": "แก้ไขสินค้า", "product.deleted": "ลบสินค้า",
  "product.purchased": "ซื้อสินค้า", "product.downloaded": "ดาวน์โหลดสินค้า",
  "order.refunded": "คืนพอยท์คำสั่งซื้อ",
  "settings.store_closed": "ปิดร้านค้า", "settings.store_opened": "เปิดร้านค้า",

  // ===== ไฟล์ =====
  "file.uploaded": "อัปโหลดไฟล์", "file.deleted": "ลบไฟล์",

  // ===== อีเมล =====
  "mail.domain.created": "เพิ่มโดเมนอีเมล",
  "mail.domain.dns_auto_configured": "ตั้งค่า DNS อีเมลอัตโนมัติ",
  "mail.resend_settings.updated": "แก้ไขการเชื่อมต่อ Resend",
  "mail.discord.bind": "ผูกกล่องอีเมลกับ Discord", "mail.discord.unbind": "ยกเลิกผูกกล่องอีเมลกับ Discord",
  "mail.access.webmail": "เปิดกล่องเมลบนเว็บ", "mail.access.bot": "เปิดกล่องเมลผ่านบอท",
  "mail.message.sent": "ส่งอีเมล", "mail.message.received": "ได้รับอีเมล", "mail.message.moved": "ย้ายอีเมล",
  "mail.mailbox.created": "สร้างกล่องอีเมล", "mail.mailbox.member_added": "เพิ่มสมาชิกในกล่องอีเมล",
  "mail.alias.created": "เพิ่มชื่อแฝงอีเมล", "mail.domain.status": "เปลี่ยนสถานะโดเมนอีเมล",
  "mail.app_password.created": "สร้างรหัสผ่านแอปอีเมล", "mail.app_password.revoked": "ยกเลิกรหัสผ่านแอปอีเมล",
  "mail.log_settings.updated": "แก้ไขการตั้งค่า Log อีเมล", "mail.log_settings.tested": "ทดสอบ Log อีเมล",
  "mail.bot_settings_updated": "แก้ไขการสร้างเมลผ่านบอท",
  "mail.discord.mailbox_created": "สร้างกล่องอีเมลผ่านบอท", "mail.discord.message_moved": "ย้ายอีเมลผ่านบอท",
  "mail.discord.app_password_created": "สร้างรหัสผ่านแอปผ่านบอท", "mail.discord.app_password_revoked": "ยกเลิกรหัสผ่านแอปผ่านบอท",
  "mail.discord.settings_updated": "แก้ไขการสร้างเมลผ่านบอท (แอดมิน)", "mail.discord.admin_domain_status": "เปลี่ยนสถานะโดเมนผ่านบอท",

  // ===== ผู้ใช้ / ความปลอดภัย / Discord =====
  "user.created": "สร้างบัญชีผู้ใช้", "user.password_reset": "รีเซ็ตรหัสผ่านผู้ใช้",
  "lockdown.enabled": "ล็อกเว็บไซต์", "lockdown.disabled": "ปลดล็อกเว็บไซต์",
  "lockdown.state_read_failed": "อ่านสถานะล็อกเว็บไซต์ไม่สำเร็จ",
  "discord.bot.activity": "กิจกรรมบอท Discord", "discord.presence.updated": "เปลี่ยนสถานะบอท Discord",
  "discord.bot_token.updated": "เปลี่ยน token บอท Discord", "discord.bot_token.removed": "ลบ token บอท Discord",

  // ===== ห้องเสียง Discord =====
  "discord.voice.room_created": "สร้างห้องเสียง", "discord.voice.room_deleted": "ลบห้องเสียง",
  "discord.voice.room_updated": "แก้ชื่อหรือจำนวนคนในห้องเสียง", "discord.voice.delete_requested": "สั่งลบห้องเสียงจากเว็บ",
  "discord.voice.password_changed": "ตั้งหรือเปลี่ยนรหัสห้องเสียง", "discord.voice.locked": "ล็อกห้องเสียง", "discord.voice.unlocked": "ปลดล็อกห้องเสียง",
  "discord.voice.access_granted": "ใส่รหัสห้องเสียงถูก", "discord.voice.locked_out": "ใส่รหัสห้องเสียงผิดจนถูกห้าม",
  "discord.voice.entry_denied": "บอทเตะคนที่ไม่มีรหัสห้อง", "discord.voice.member_kicked": "เจ้าของห้องเตะคนออก",
  "discord.voice.owner_transferred": "โอนเจ้าของห้องเสียง", "discord.voice.settings_updated": "แก้กติกาห้องเสียง",
  "discord.voice.hub_created": "สร้างห้อง Join to Create", "discord.voice.hub_removed": "ลบห้อง Join to Create",
  "discord.voice.place_added": "บอทห้องเสียงเริ่มใช้ช่องใหม่", "discord.voice.place_removed": "บอทห้องเสียงเลิกใช้ช่อง",
  "discord.voice.message_updated": "แก้ข้อความที่บอทห้องเสียงลงไว้",
  "discord.voice.place_deleted": "มีคนลบห้องของบอทห้องเสียง",
  "discord.protect.link_blocked": "บล็อกลิงก์ที่ไม่อนุญาต", "discord.protect.invite_blocked": "บล็อกลิงก์เชิญเซิร์ฟอื่น",
  "discord.protect.word_blocked": "บล็อกคำต้องห้าม", "discord.protect.spam_blocked": "บล็อกข้อความสแปม",
  "discord.protect.mention_blocked": "บล็อกการแท็กหลายคน", "discord.protect.flood_timeout": "พักการพิมพ์คนที่ส่งข้อความรัว",
  "discord.protect.channel_restored": "สร้างห้องที่ถูกลบคืน", "discord.protect.settings_updated": "แก้ระบบป้องกันเซิร์ฟเวอร์",

  // ===== ไฟล์ แฟ้ม และหมวดหมู่ =====
  "user_file.updated": "แก้ไขไฟล์", "user_file.shared": "แชร์ไฟล์", "user_file.share_revoked": "ยกเลิกการแชร์ไฟล์",
  "user_file.batch_deleted": "ลบไฟล์หลายไฟล์", "user_file.batch_folder_updated": "ย้ายไฟล์หลายไฟล์ไปแฟ้มอื่น",
  "user_file.batch_category_updated": "เปลี่ยนหมวดหมู่ไฟล์หลายไฟล์", "user_file.batch_visibility_updated": "เปลี่ยนการมองเห็นไฟล์หลายไฟล์",
  "user_file_category.created": "สร้างหมวดหมู่ไฟล์", "user_file_category.updated": "แก้ไขหมวดหมู่ไฟล์", "user_file_category.deleted": "ลบหมวดหมู่ไฟล์",
  "user_file_category.shared": "แชร์หมวดหมู่ไฟล์", "user_file_category.share_revoked": "ยกเลิกการแชร์หมวดหมู่ไฟล์",
  "user_file_category.shares_revoked": "ยกเลิกการแชร์หมวดหมู่ไฟล์ทั้งหมด",
  "user_file_folder.created": "สร้างแฟ้ม", "user_file_folder.updated": "แก้ไขแฟ้ม", "user_file_folder.deleted": "ลบแฟ้ม",
  "user_file_folder.shared": "แชร์แฟ้ม", "user_file_folder.share_revoked": "ยกเลิกการแชร์แฟ้ม",

  // ===== อื่นๆ ที่ยังไม่มีชื่อ =====
  "asset.deleted": "ลบรูปแบรนด์",
  "hosting.database.connection_tested": "ทดสอบการเชื่อมต่อฐานข้อมูล",
  "hosting.runtime.start.requested": "สั่งเปิดเว็บไซต์", "hosting.runtime.stop.requested": "สั่งหยุดเว็บไซต์",
  "hosting.runtime.restart.requested": "สั่งรีสตาร์ตเว็บไซต์", "hosting.runtime.rebuild.requested": "สั่ง build เว็บไซต์ใหม่",
  "hosting.runtime.redeploy.requested": "สั่ง deploy เว็บไซต์ใหม่",
  "ip.banned_access": "IP ที่ถูกแบนพยายามเข้าเว็บ", "lockdown.expired": "ปลดล็อกเว็บไซต์เองเมื่อครบเวลา",
  "mail.discord.admin_mailbox_created": "สร้างกล่องอีเมลผ่านบอท (แอดมิน)", "mail.discord.admin_mailbox_deleted": "ลบกล่องอีเมลผ่านบอท (แอดมิน)",
  "mail.discord.admin_mailbox_suspended": "ระงับกล่องอีเมลผ่านบอท", "mail.discord.admin_mailbox_resumed": "เปิดกล่องอีเมลอีกครั้งผ่านบอท",
  "mail.discord.presence.updated": "เปลี่ยนสถานะบอทเมล",
  "quick_pin.set": "ตั้ง PIN เข้าด่วน", "quick_pin.cleared": "ลบ PIN เข้าด่วน",
  "social.disconnect_requested": "ขอถอดบัญชีภายนอก", "social.disconnect_cancelled": "ยกเลิกการถอดบัญชีภายนอก",
  "vps_uptime.access_issued": "เปิดหน้าสถานะเซิร์ฟเวอร์ (VPS)",
  "workspace.security_alert": "เว็บโฮสติ้งบล็อกคำขอน่าสงสัย", "workspace.sso_login": "นักศึกษาเข้า Workspace ผ่านบอท",
};

// Words for a readable name when an action has no label yet (a new event added to the API
// before this list): "user_file_folder.share_revoked" reads as "ยกเลิกการแชร์ · แฟ้ม".
const actionVerbs: Record<string, string> = {
  created: "สร้าง", updated: "แก้ไข", deleted: "ลบ", removed: "ลบ", added: "เพิ่ม", shared: "แชร์", share_revoked: "ยกเลิกการแชร์",
  shares_revoked: "ยกเลิกการแชร์ทั้งหมด", uploaded: "อัปโหลด", moved: "ย้าย", saved: "บันทึก", enabled: "เปิด", disabled: "ปิด",
  requested: "ส่งคำขอ", revoked: "ยกเลิก", tested: "ทดสอบ", changed: "เปลี่ยน", opened: "เปิด", closed: "ปิด", set: "ตั้ง", cleared: "ล้าง",
  suspended: "ระงับ", resumed: "เปิดใช้อีกครั้ง", login: "เข้าสู่ระบบ", purchased: "ซื้อ", refunded: "คืนเงิน", approved: "อนุมัติ", rejected: "ปฏิเสธ",
};
const actionNouns: Record<string, string> = {
  user: "บัญชีผู้ใช้", user_file: "ไฟล์", user_file_category: "หมวดหมู่ไฟล์", user_file_folder: "แฟ้ม", file: "ไฟล์", files: "ไฟล์",
  folder: "แฟ้ม", hosting: "เว็บโฮสติ้ง", site: "เว็บไซต์", database: "ฐานข้อมูล", mail: "อีเมล", mailbox: "กล่องอีเมล", domain: "โดเมน",
  product: "สินค้า", category: "หมวดหมู่", announcement: "ประกาศ", settings: "การตั้งค่า", session: "เซสชัน", discord: "Discord",
  voice: "ห้องเสียง", bot: "บอท", topup: "เติมเงิน", store: "ร้านค้า", workspace: "Workspace", lockdown: "ล็อกเว็บไซต์", ip: "IP",
};

/** The Thai name of a log action; unknown ones are built from their parts instead of showing the code. */
function actionText(action: string) {
  if (actionLabel[action]) return actionLabel[action];
  const parts = action.split(".");
  const verb = [parts.slice(-2).join("_"), parts[parts.length - 1]].map((key) => actionVerbs[key]).find(Boolean);
  const noun = parts.slice(0, -1).map((part) => actionNouns[part]).filter(Boolean).pop();
  return verb && noun ? `${verb}${noun}` : verb || noun ? `${verb || ""}${noun || ""} (${action})` : action;
}
const webhookCategories = [
  {
    id: "security",
    title: "การเข้าสู่ระบบ",
    description: "ล็อกอิน สมัครสมาชิก รหัสผ่าน และเซสชัน",
    icon: <ShieldCheck size={18} />,
    events: [
      { key: "auth.login", label: "เข้าสู่ระบบ", desc: "เข้าได้ ใส่รหัสผิด หรือมีคนสุ่มรหัส" },
      { key: "auth.register", label: "สมัครสมาชิกใหม่", desc: "มีคนสมัครใหม่" },
      { key: "auth.oauth", label: "เข้าสู่ระบบผ่าน Social Login", desc: "เข้าด้วย Discord, Google หรือ GitHub" },
      { key: "social.connected", label: "เชื่อมบัญชีภายนอก", desc: "ผูก Discord, Google หรือ GitHub กับบัญชี" },
      { key: "auth.logout", label: "ออกจากระบบ", desc: "กดออกจากระบบ" },
      { key: "password.changed", label: "เปลี่ยนรหัสผ่าน", desc: "เปลี่ยนรหัสผ่านของตัวเอง" },
      { key: "session.revoked", label: "ยกเลิกเซสชัน", desc: "ให้เครื่องใดเครื่องหนึ่งออกจากระบบ" },
      { key: "sessions.revoked_for_user", label: "บังคับผู้ใช้ออกจากระบบ", desc: "แอดมินให้บัญชีหนึ่งออกทุกเครื่อง" },
      { key: "sessions.revoked_all", label: "บังคับทุกคนออกจากระบบ", desc: "แอดมินให้ทุกคนออกจากระบบ" },
    ],
  },
  {
    id: "protection",
    title: "การป้องกันและล็อกเว็บไซต์",
    description: "IP ที่ถูกแบน การล็อกเว็บ และไฟร์วอลล์ของเว็บโฮสติ้ง",
    icon: <ShieldAlert size={18} />,
    events: [
      { key: "ip.banned_access", label: "IP ที่ถูกแบนพยายามเข้าเว็บ", desc: "แจ้งไม่เกินทุก 10 นาทีต่อ IP" },
      { key: "ip.banned", label: "แบน IP", desc: "เพิ่ม IP ในรายการแบน" },
      { key: "ip.unbanned", label: "ปลดแบน IP", desc: "เอา IP ออกจากรายการแบน" },
      { key: "lockdown.enabled", label: "ล็อกเว็บไซต์", desc: "ล็อกจากหน้าเว็บหรือบอท Discord" },
      { key: "lockdown.disabled", label: "ปลดล็อกเว็บไซต์", desc: "ปลดล็อกแล้ว" },
      { key: "workspace.security_alert", label: "เว็บโฮสติ้งบล็อกคำขอน่าสงสัย", desc: "ไฟร์วอลล์ของเว็บลูกค้าบล็อกการโจมตี" },
    ],
  },
  {
    id: "users",
    title: "จัดการผู้ใช้",
    description: "สิ่งที่แอดมินทำกับบัญชีของผู้ใช้",
    icon: <UserCog size={18} />,
    events: [
      { key: "user.created", label: "สร้างบัญชีผู้ใช้", desc: "แอดมินสร้างบัญชีให้" },
      { key: "user.status_changed", label: "ปรับสถานะผู้ใช้", desc: "ระงับ แบน หรือเปิดใช้อีกครั้ง" },
      { key: "user.role_changed", label: "เปลี่ยนระดับ", desc: "เปลี่ยนระดับของบัญชี" },
      { key: "user.updated", label: "แก้ไขข้อมูลผู้ใช้", desc: "แก้ชื่อหรืออีเมลของบัญชี" },
      { key: "user.password_reset", label: "รีเซ็ตรหัสผ่านผู้ใช้", desc: "แอดมินตั้งรหัสผ่านใหม่ให้" },
      { key: "user.deleted", label: "ลบบัญชีผู้ใช้", desc: "ลบบัญชีถาวร" },
    ],
  },
  {
    id: "system",
    title: "ตั้งค่าระบบและบอท",
    description: "การตั้งค่าหลัก ระบบเติมเงิน และบอท Discord",
    icon: <SlidersHorizontal size={18} />,
    events: [
      { key: "settings.updated", label: "แก้ตั้งค่าทั่วไป", desc: "บันทึกหน้าตั้งค่านี้" },
      { key: "topup.settings_updated", label: "แก้ตั้งค่าเติมเงิน", desc: "แก้บัญชีธนาคารหรือคีย์ตรวจสลิป" },
      { key: "discord.bot.activity", label: "กิจกรรมบอท Discord", desc: "มีคนใช้คำสั่งหรือกดปุ่มของบอท" },
      { key: "discord.bot_token.updated", label: "เปลี่ยน token บอท Discord", desc: "ใส่ token ใหม่ในหน้าบอท Discord" },
      { key: "discord.bot_token.removed", label: "ลบ token บอท Discord", desc: "บอทตัวนั้นจะออฟไลน์" },
    ],
  },
  {
    id: "voice",
    title: "ห้องเสียง Discord",
    description: "ห้องที่ต้องใส่รหัสของบอทห้องเสียง",
    icon: <KeyRound size={18} />,
    events: [
      { key: "discord.voice.locked_out", label: "ใส่รหัสผิดจนถูกห้าม", desc: "มีคนใส่รหัสห้องผิดครบกำหนด" },
      { key: "discord.voice.entry_denied", label: "บอทเตะคนที่ไม่มีรหัส", desc: "มีคนเข้าห้องที่ล็อกโดยไม่ได้ใส่รหัส" },
    ],
  },
  {
    id: "content",
    title: "ประกาศ",
    description: "ประกาศที่แสดงบนหน้าเว็บ",
    icon: <Megaphone size={18} />,
    events: [
      { key: "announcement.created", label: "สร้างประกาศ", desc: "โพสต์ประกาศใหม่" },
      { key: "announcement.updated", label: "แก้ประกาศ", desc: "แก้ประกาศ" },
      { key: "announcement.deleted", label: "ลบประกาศ", desc: "ลบประกาศ" },
    ],
  },
  {
    id: "hosting",
    title: "เว็บโฮสติ้งและฐานข้อมูล",
    description: "เว็บไซต์ของลูกค้าและฐานข้อมูล MySQL",
    icon: <Server size={18} />,
    events: [
      { key: "hosting.site.created", label: "สร้างเว็บไซต์", desc: "สร้างเว็บไซต์ใหม่" },
      { key: "hosting.site.updated", label: "แก้เว็บไซต์", desc: "แก้การตั้งค่าเว็บไซต์" },
      { key: "hosting.site.deleted", label: "ลบเว็บไซต์", desc: "ลบเว็บไซต์" },
      { key: "hosting.database.created", label: "สร้างฐานข้อมูล", desc: "สร้างฐานข้อมูล" },
      { key: "hosting.database.deleted", label: "ลบฐานข้อมูล", desc: "ลบฐานข้อมูล" },
      { key: "hosting.database.suspended", label: "ระงับฐานข้อมูล", desc: "เว็บที่ใช้ฐานข้อมูลนี้จะเชื่อมต่อไม่ได้" },
      { key: "hosting.database.unsuspended", label: "ปลดระงับฐานข้อมูล", desc: "เว็บกลับมาเชื่อมต่อได้" },
    ],
  },
];

const webhookEventKeys = webhookCategories.flatMap((category) => category.events.map((event) => event.key));

const viewNavGroup: Partial<Record<DashboardView, string>> = {
  profile: "account",
  hosting: "hosting",
  databases: "hosting",
  mail: "hosting",
  "discord-bot": "hosting",
  announcements: "content",
  "file-system": "content",
  "file-categories": "content",
  users: "users",
  access: "users",
  logs: "records",
  settings: "system",
  "homepage-settings": "system",
  "store-categories": "store",
  "store-products": "store",
  "store-orders": "store",
  "store-sales": "store",
  topups: "finance",
  "topup-transactions": "finance",
  "topup-settings": "system",
};

const viewLoadingMeta: Record<DashboardView, { page: string; system: string }> = {
  overview: { page: "แดชบอร์ด", system: "ภาพรวมระบบ" },
  profile: { page: "โปรไฟล์ของฉัน", system: "บัญชีผู้ใช้" },
  hosting: { page: "จัดการเว็บไซต์", system: "เว็บไซต์" },
  databases: { page: "ฐานข้อมูล", system: "เว็บไซต์" },
  mail: { page: "ระบบอีเมล", system: "อีเมลโดเมน" },
  "discord-bot": { page: "บอท Discord", system: "เว็บไซต์" },
  users: { page: "จัดการผู้ใช้", system: "ผู้ใช้และสิทธิ์" },
  access: { page: "สิทธิ์การเข้าถึง", system: "ผู้ใช้และสิทธิ์" },
  logs: { page: "บันทึกกิจกรรม", system: "บันทึกระบบ" },
  announcements: { page: "ประกาศ", system: "จัดการเนื้อหา" },
  settings: { page: "การตั้งค่าระบบ", system: "ตั้งค่าระบบ" },
  "homepage-settings": { page: "ตั้งค่าหน้าแรก", system: "ตั้งค่าระบบ" },
  files: { page: "ไฟล์", system: "จัดการเนื้อหา" },
  "file-system": { page: "จัดการไฟล์", system: "ระบบไฟล์" },
  "file-categories": { page: "หมวดหมู่ไฟล์", system: "ระบบไฟล์" },
  "store-categories": { page: "หมวดหมู่สินค้า", system: "ร้านค้า" },
  "store-products": { page: "จัดการสินค้า", system: "ร้านค้า" },
  "store-orders": { page: "คำสั่งซื้อ", system: "ร้านค้า" },
  "store-sales": { page: "ยอดขาย", system: "ร้านค้า" },
  topups: { page: "ภาพรวมการเติมเงิน", system: "การเงิน" },
  "topup-transactions": { page: "ประวัติการเติมเงิน", system: "การเงิน" },
  "topup-settings": { page: "ระบบเติมเงิน", system: "ตั้งค่าระบบ" },
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options?.headers },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ระบบไม่สามารถดำเนินการได้");
  return payload as T;
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function roleBadge(role: Role) {
  return <span className={`role-badge ${role}`}>{roleLabel[role]}</span>;
}

export function normalizeAssetUrl(urlStr?: string): string {
  if (!urlStr) return "";
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    if (urlStr.startsWith("http://localhost:8088/")) {
      return urlStr.replace(/^http:\/\/localhost:8088/, window.location.origin);
    }
    if (urlStr.startsWith("http://") && !urlStr.includes("localhost") && !urlStr.includes("127.0.0.1")) {
      return urlStr.replace(/^http:\/\//, "https://");
    }
  }
  return urlStr;
}


export default function DashboardApp({ view: initialView }: { view: DashboardView }) {
  const view = initialView;
  const [me, setMe] = useState<AuthUser | null>(null);
  const [brandSettings, setBrandSettings] = useState({ brandName: "NEXORA CLOUD", logoUrl: "", faviconUrl: "", authBackgroundUrl: "" });
  const [storeState, setStoreState] = useState<{ open: boolean; message: string }>({ open: true, message: "" });
  const [loading, setLoading] = useState(true);
  const [authSlow, setAuthSlow] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [navOpen, setNavOpen] = useState<Record<string, boolean>>(() => {
    const activeGroup = viewNavGroup[view];
    return {
      account: activeGroup === "account",
      hosting: activeGroup === "hosting",
      content: activeGroup === "content",
      users: activeGroup === "users",
      records: activeGroup === "records",
      system: activeGroup === "system",
      store: activeGroup === "store",
      finance: activeGroup === "finance",
      infrastructure: activeGroup === "infrastructure",
    };
  });

  // Opens the store from the closed-store banner: same save as the switch in system settings.
  const askOpenStore = () => setConfirmRequest({
    title: "เปิดร้านค้า",
    message: "ลูกค้าจะเห็นร้านค้าและซื้อสินค้า เติมเงินได้ทันที",
    confirmLabel: "เปิดร้านค้า",
    action: async () => {
      const current = await api<SettingsData>("/api/admin/settings");
      const saved = await api<SettingsData>("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ ...current, storeEnabled: true }) });
      window.dispatchEvent(new CustomEvent("nexora:settings-updated", { detail: saved }));
      setNotice({ kind: "success", text: "เปิดร้านค้าแล้ว" });
    },
  });

  useEffect(() => {
    const applySystemSettings = (settings: Partial<SettingsData>) => {
      document.documentElement.dataset.theme = settings.themeMode || "dark";
      applyThemeColor(settings.primaryColor);
      document.documentElement.style.setProperty("--auth-background-image", settings.authBackgroundUrl ? `url("${settings.authBackgroundUrl}")` : "none");
      if (typeof settings.storeEnabled === "boolean") setStoreState({ open: settings.storeEnabled, message: settings.storeClosedMessage || "" });
      setBrandSettings({
        brandName: settings.brandName?.trim() || "NEXORA CLOUD",
        logoUrl: settings.logoUrl || "",
        faviconUrl: settings.faviconUrl || "",
        authBackgroundUrl: settings.authBackgroundUrl || "",
      });
      const icon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (icon) icon.href = settings.faviconUrl || "/logo-v2.png?v=3";
    };
    const handleSettingsUpdated = (event: Event) => applySystemSettings((event as CustomEvent<Partial<SettingsData>>).detail || {});
    api<Partial<SettingsData>>("/api/settings/public").then(applySystemSettings).catch(() => undefined);
    window.addEventListener("nexora:settings-updated", handleSettingsUpdated);
    return () => window.removeEventListener("nexora:settings-updated", handleSettingsUpdated);
  }, []);

  useEffect(() => {
    let active = true;
    const slowTimer = window.setTimeout(() => setAuthSlow(true), 6000);
    async function refreshSession(initial = false) {
      try {
        const result = await api<{ authenticated: boolean; user: AuthUser | null }>("/api/auth/me");
        if (!active) return;
        if (!result.authenticated || !result.user) {
          window.location.href = "/";
          return;
        }
        if (view !== "profile" && view !== "hosting" && result.user.role === "user") {
          window.location.href = "/dashboard";
          return;
        }
        // Only restrict truly superadmin-only views; allow admins to manage announcements
        if ((view === "settings" || view === "logs" || view === "access" || view === "topup-settings") && result.user.role !== "superadmin") {
          window.location.href = "/admin";
          return;
        }
        if (window.sessionStorage.getItem("nexora_vps_uptime_return") === "1") {
          window.sessionStorage.removeItem("nexora_vps_uptime_return");
          window.location.href = "/api/vps-uptime/start";
          return;
        }
        setMe(result.user);
        setAuthError(false);
      } catch {
        if (initial && active) {
          setAuthError(true);
          setAuthSlow(true);
        }
      } finally {
        if (initial && active) {
          window.clearTimeout(slowTimer);
          setLoading(false);
        }
      }
    }
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    const refreshCurrentSession = () => void refreshSession();
    void refreshSession(true);
    const interval = window.setInterval(refreshCurrentSession, 30_000);
    window.addEventListener("focus", refreshCurrentSession);
    window.addEventListener("pageshow", refreshCurrentSession);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      active = false;
      window.clearTimeout(slowTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshCurrentSession);
      window.removeEventListener("pageshow", refreshCurrentSession);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [view]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!menuOpen || !window.matchMedia("(max-width: 980px)").matches) return;

    const scrollY = window.scrollY;
    const previousBodyStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const desktopQuery = window.matchMedia("(min-width: 981px)");
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };

    document.documentElement.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    desktopQuery.addEventListener("change", closeOnDesktop);

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      Object.assign(document.body.style, previousBodyStyle);
      window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", closeOnEscape);
      desktopQuery.removeEventListener("change", closeOnDesktop);
    };
  }, [menuOpen]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/";
  }

  if (loading || !me) {
    const authState = authError ? "error" : authSlow ? "slow" : "loading";
    const destination = viewLoadingMeta[view] || { page: "แดชบอร์ด", system: "ระบบ" };
    const title = authError
      ? "เข้าสู่ระบบไม่สำเร็จ"
      : authSlow
        ? "ใช้เวลานานกว่าปกติ"
        : `กำลังเข้าสู่${destination.page}`;
    const description = authError
      ? "ยังยืนยันบัญชีของคุณไม่ได้ ลองใหม่อีกครั้ง หรือกลับไปเข้าสู่ระบบ"
      : authSlow
        ? `ระบบตอบสนองช้าขณะเปิด${destination.page} คุณสามารถรอต่อ หรือลองโหลดใหม่ได้`
        : `กำลังตรวจสอบสิทธิ์สำหรับ${destination.system}`;
    return (
      <div className={`dashboard-loading auth-${authState}`} role={authState === "loading" ? "status" : "alert"} aria-live="polite">
        <section className="auth-check-card">
          <header className="auth-check-brand">
            <img src={brandSettings.logoUrl || "/logo-v2.png"} alt="" />
            <div>
              <strong>{brandSettings.brandName}</strong>
              <small>{destination.system}</small>
            </div>
          </header>

          <div className={`auth-check-status ${authState}`} aria-hidden="true">
            {authState === "loading" ? <span className="auth-check-spinner" /> : <CircleAlert size={22} />}
          </div>

          <h1>{title}</h1>
          <p>{description}</p>

          {authState === "loading" ? (
            <div className="auth-check-progress" aria-hidden="true"><i /></div>
          ) : (
            <div className="auth-check-actions">
              <button type="button" className="btn-auth-retry" onClick={() => window.location.reload()}>ลองใหม่</button>
              <Link href="/" className="btn-auth-secondary">กลับหน้าหลัก</Link>
            </div>
          )}

          <small className="auth-check-note">
            {authState === "error"
              ? "หากยังไม่ได้ ให้เข้าสู่ระบบใหม่อีกครั้ง"
              : authState === "slow"
                ? "กำลังรอการตอบกลับจากเซิร์ฟเวอร์"
                : `เตรียม${destination.page}ให้พร้อมใช้งาน`}
          </small>
        </section>
      </div>
    );
  }

  const queryTab = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") || "general" : "general";

  const navGroups = [
    { key: "finance", label: "การเงิน", icon: WalletCards, show: me.role !== "user", links: [
      { href: "/admin/topups", label: "ภาพรวมการเติมเงิน", icon: WalletCards, key: "topups", show: true },
      { href: "/admin/topups/transactions", label: "ประวัติการเติมเงิน", icon: ReceiptText, key: "topup-transactions", show: true },
    ] },
    { key: "store", label: "ร้านค้า", icon: Store, show: me.role !== "user", links: [
      { href: "/admin/store/categories", label: "หมวดหมู่สินค้า", icon: Folder, key: "store-categories", show: true },
      { href: "/admin/store/products", label: "จัดการสินค้า", icon: Package, key: "store-products", show: true },
      { href: "/admin/store/sales", label: "ยอดขาย", icon: TrendingUp, key: "store-sales", show: true },
      { href: "/admin/store/orders", label: "คำสั่งซื้อ", icon: ReceiptText, key: "store-orders", show: true }
    ] },
    { key: "hosting", label: "เว็บไซต์", icon: Cloud, show: true, links: [
      { href: "/admin/hosting", label: "จัดการเว็บไซต์", icon: Cloud, key: "hosting", show: true },
      { href: "/admin/databases", label: "ฐานข้อมูล", icon: Database, key: "databases", show: true },
      { href: "/admin/mail", label: "อีเมลโดเมน", icon: Mail, key: "mail", show: me.role !== "user" },
      { href: "/admin/discord-bot", label: "บอท Discord", icon: Bot, key: "discord-bot", show: me.role !== "user" }
    ] },

    { key: "account", label: "บัญชีผู้ใช้", icon: User, show: true, links: [{ href: "/admin/profile", label: "โปรไฟล์ของฉัน", icon: User, key: "profile", show: true }] },
    { key: "content", label: "จัดการเนื้อหา", icon: Folder, show: me.role !== "user", links: [
      { href: "/admin/announcements", label: "ประกาศ", icon: Megaphone, key: "announcements", show: true },
      { href: "/admin/file-system", label: "ระบบไฟล์", icon: FolderOpen, key: "file-system", show: true },
      { href: "/admin/file-categories", label: "หมวดหมู่ไฟล์", icon: Folder, key: "file-categories", show: true },
    ] },
    { key: "users", label: "ผู้ใช้และสิทธิ์", icon: Users, show: me.role !== "user", links: [
      { href: "/admin/users", label: "จัดการผู้ใช้", icon: Users, key: "users", show: true },
      { href: "/admin/access", label: "สิทธิ์การเข้าถึง", icon: ShieldCheck, key: "access", show: me.role === "superadmin" },
    ] },
    { key: "records", label: "บันทึกระบบ", icon: Activity, show: me.role === "superadmin", links: [{ href: "/admin/logs", label: "บันทึกกิจกรรม", icon: Activity, key: "logs", show: true }] },
    { key: "system", label: "ตั้งค่าระบบ", icon: Settings, show: me.role === "superadmin", links: [
      { href: "/admin/settings?tab=general", label: "ทั่วไป", icon: SlidersHorizontal, key: "settings-general", show: true },
      { href: "/admin/settings/homepage", label: "หน้าแรก", icon: Monitor, key: "homepage-settings", show: true },
      { href: "/admin/settings?tab=auth", label: "เข้าสู่ระบบ", icon: User, key: "settings-auth", show: true },
      { href: "/admin/settings?tab=social", label: "Social Login", icon: Users, key: "settings-social", show: true },
      { href: "/admin/settings?tab=notifications", label: "การแจ้งเตือน", icon: Bell, key: "settings-notifications", show: true },
      { href: "/admin/settings?tab=mail", label: "ระบบอีเมล", icon: Mail, key: "settings-mail", show: true },
      { href: "/admin/topups/settings", label: "ระบบเติมเงิน", icon: WalletCards, key: "topup-settings", show: true },
      { href: "/admin/settings?tab=danger", label: "ขั้นสูง", icon: ShieldCheck, key: "settings-danger", show: true },
    ] },
  ];

  return (
    <main className="dashboard-root">
      <aside className={`dashboard-sidebar ${menuOpen ? "open" : ""}`}>
        <div className="dashboard-brand"><img src={brandSettings.logoUrl || "/logo-v2.png"} alt="" /><div><strong>{brandSettings.brandName}</strong><span>CONTROL PANEL</span></div><button onClick={() => setMenuOpen(false)} aria-label="ปิดเมนู"><X /></button></div>
        <nav aria-label="เมนูแดชบอร์ด">
          {me.role !== "user" && <Link href="/admin" className={`sidebar-dashboard-link ${view === "overview" ? "active" : ""}`}><LayoutDashboard size={18} /><span>แดชบอร์ด</span><ChevronRight size={15} /></Link>}
          {navGroups.filter((group) => group.show).map((group) => <section className={`sidebar-group ${navOpen[group.key] ? "open" : ""} ${viewNavGroup[view] === group.key ? "current" : ""}`} key={group.key}>
            <button type="button" onClick={() => setNavOpen({ ...navOpen, [group.key]: !navOpen[group.key] })} aria-expanded={navOpen[group.key]}><group.icon size={18} /><span>{group.label}</span><ChevronDown size={15} /></button>
            {navOpen[group.key] && <div>{group.links.filter((item) => item.show !== false).map((item) => {
              const isActive = view === "settings" && item.key.startsWith("settings-")
                ? item.key === `settings-${queryTab}`
                : view === item.key;
              return <a key={item.key} href={item.href} className={isActive ? "active" : ""} aria-current={isActive ? "page" : undefined}><item.icon size={17} /><span>{item.label}</span></a>;
            })}</div>}
          </section>)}
        </nav>
        <div className="sidebar-account">
          <span className="sidebar-avatar">{me.avatarUrl ? <SmartImage src={me.avatarUrl} alt="" compact fallback={<>{me.username.slice(0, 1).toUpperCase()}</>} /> : me.username.slice(0, 1).toUpperCase()}</span>
          <div><strong>{me.displayName || me.username}</strong>{roleBadge(me.role)}</div>
          <button onClick={logout} aria-label="ออกจากระบบ"><LogOut size={18} /></button>
        </div>
      </aside>
      <section className="dashboard-main">
        <header className="dashboard-mobile-header">
          <a className="dashboard-mobile-brand" href={me.role === "user" ? "/dashboard" : "/admin"} aria-label="Nexora Cloud">
            <img src={brandSettings.logoUrl || "/logo-v2.png"} alt="" />
            <span>{brandSettings.brandName}</span>
          </a>
          <button className="dashboard-menu" onClick={() => setMenuOpen(true)} aria-label="เปิดเมนู" aria-expanded={menuOpen}><Menu size={21} /></button>
        </header>
        <div className="dashboard-content">
          {!storeState.open && STORE_VIEWS.has(view) && (
            <div className="dashboard-store-closed">
              <StoreClosedNotice message={storeState.message} note="ลูกค้ามองไม่เห็นร้านค้า แอดมินยังจัดการข้อมูลได้ตามปกติ">
                {me.role === "superadmin" && (
                  <>
                    <Link href="/admin/settings?tab=general#store-switch">ตั้งค่า</Link>
                    <button type="button" className="is-primary" onClick={askOpenStore}>เปิดร้านค้า</button>
                  </>
                )}
              </StoreClosedNotice>
            </div>
          )}
          {view === "profile" && <ProfileView me={me} setMe={setMe} notify={setNotice} ask={setConfirmRequest} />}
          {view === "hosting" && <HostingView me={me} notify={setNotice} ask={setConfirmRequest} />}
          {view === "overview" && <AdminOverview role={me.role} name={me.displayName || me.username} actionText={actionText} storeOpen={storeState.open} />}
          {view === "databases" && <DatabaseAdminView me={me} notify={setNotice} ask={setConfirmRequest} />}
          {view === "mail" && <AdminMailView notify={setNotice} isSuperadmin={me.role === "superadmin"} />}
          {view === "discord-bot" && <DiscordBotView notify={setNotice} isSuperadmin={me.role === "superadmin"} />}
          {view === "users" && <UsersView me={me} notify={setNotice} ask={setConfirmRequest} />}
          {view === "access" && <AccessView me={me} notify={setNotice} ask={setConfirmRequest} />}
          {view === "logs" && <LogsView />}
          {view === "announcements" && <AnnouncementsView notify={setNotice} ask={setConfirmRequest} />}
          {view === "settings" && <SettingsView notify={setNotice} ask={setConfirmRequest} />}
          {view === "homepage-settings" && <HomepageSettingsView notify={setNotice} />}
          {view === "files" && <FilesView />}
          {view === "file-system" && <FileLibraryView admin ask={setConfirmRequest} />}
          {view === "file-categories" && <UserFileCategoriesView notify={setNotice} ask={setConfirmRequest} />}
          {view === "store-categories" && <StoreCategoriesView notify={setNotice} ask={setConfirmRequest} />}
          {view === "store-products" && <StoreProductsView notify={setNotice} ask={setConfirmRequest} />}
          {view === "store-orders" && <StoreOrdersView notify={setNotice} />}
          {view === "store-sales" && <StoreSalesView notify={setNotice} />}
          {view === "topups" && <TopupOverviewView notify={setNotice} canConfigure={me.role === "superadmin"} />}
          {view === "topup-transactions" && <TopupTransactionsView notify={setNotice} />}
          {view === "topup-settings" && <TopupSettingsView notify={setNotice} />}
        </div>
      </section>
      {notice && <FeedbackToast notice={notice} onClose={() => setNotice(null)} />}
      {confirmRequest && <ConfirmDialog request={confirmRequest} busy={confirmBusy} onClose={() => setConfirmRequest(null)} onConfirm={async () => {
        setConfirmBusy(true);
        try { await confirmRequest.action(); setConfirmRequest(null); }
        catch (error) { setConfirmRequest(null); setNotice({ kind: "error", text: (error as Error).message || "ทำรายการไม่สำเร็จ" }); }
        finally { setConfirmBusy(false); }
      }} />}
      {menuOpen && <button className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="ปิดเมนู" />}
    </main>
  );
}

export function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="dash-heading"><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>;
}

function FeedbackToast({ notice, onClose }: { notice: { kind: "success" | "error"; text: string }; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  useEffect(() => {
    const timer = window.setTimeout(onClose, notice.kind === "success" ? 3200 : 5200);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      <div className={`toast ${notice.kind}`}>
        {notice.kind === "success" ? <CircleCheck size={20} aria-hidden="true" /> : <CircleAlert size={20} aria-hidden="true" />}
        <span>{notice.text}</span>
        <button type="button" className="toast-close" onClick={onClose} aria-label="ปิด"><X size={16} /></button>
      </div>
    </div>
  );
}

function ConfirmDialog({ request, busy, onClose, onConfirm }: { request: ConfirmRequest; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose(); window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [busy, onClose]);
  // Rendered on <body> so it stacks above page dialogs, which are also portalled there.
  return createPortal(<div className="system-dialog-backdrop is-confirm cfm-backdrop" role="presentation" onMouseDown={(event) => !busy && event.target === event.currentTarget && onClose()}>
    <section className={`cfm${request.danger ? " is-danger" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <div className="cfm-body">
        <span className="cfm-icon" aria-hidden="true">{request.danger ? <TriangleAlert size={20} /> : <CircleAlert size={20} />}</span>
        <div className="cfm-copy">
          <h2 id="confirm-title">{request.title}</h2>
          <p id="confirm-message">{request.message}</p>
        </div>
      </div>
      <footer className="cfm-actions">
        <button type="button" className="cfm-btn" onClick={onClose} disabled={busy} autoFocus>ยกเลิก</button>
        <button type="button" className={`cfm-btn ${request.danger ? "is-danger" : "is-primary"}`} onClick={onConfirm} disabled={busy}>
          {busy && <span className="cfm-spinner" aria-hidden="true" />}
          {busy ? "กำลังทำรายการ..." : request.confirmLabel || "ยืนยัน"}
        </button>
      </footer>
    </section>
  </div>, document.body);
}

function parseUserAgent(ua: string) {
  if (!ua) return { browser: "Unknown Browser", os: "Unknown OS", icon: Globe };
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  let Icon = Globe;

  // iPhone and iPad agents also say "Mac OS X", and Android ones say "Linux", so phones go first.
  if (ua.includes("iPhone") || ua.includes("iPad")) { os = "iOS"; Icon = Smartphone; }
  else if (ua.includes("Android")) { os = "Android"; Icon = Smartphone; }
  else if (ua.includes("Win")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";

  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome/") || ua.includes("CriOS/")) browser = "Chrome";
  else if (ua.includes("Firefox/") || ua.includes("FxiOS/")) browser = "Firefox";
  else if (ua.includes("Safari/") && !ua.includes("Chrome/") && !ua.includes("CriOS/")) browser = "Safari";
  
  if (os === "Windows" || os === "macOS" || os === "Linux") Icon = Monitor;

  return { browser, os, icon: Icon };
}

const ACTIVITY_PAGE = 10;

// Page numbers for a pager: the first, the last and the ones around the current page, with 0
// marking a gap. 1 2 3 4 5 for few pages; 1 … 6 7 8 … 20 for many.
function pageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => keep.add(n));
  const list = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: number[] = [];
  list.forEach((n, i) => {
    const skipped = i > 0 ? n - list[i - 1] - 1 : 0;
    if (skipped === 1) out.push(n - 1); // a "…" standing for one page is just that page
    else if (skipped > 1) out.push(0);
    out.push(n);
  });
  return out;
}

// Numbered pager: < 1 2 3 … 12 >. On narrow screens the numbers fold into "3 / 12".
function Pager({ page, pages, onPage, busy = false, label }: { page: number; pages: number; onPage: (page: number) => void; busy?: boolean; label: string }) {
  if (pages <= 1) return null;
  return (
    <nav className="nx-pages" aria-label={label}>
      <button type="button" className="nx-page-step" onClick={() => onPage(page - 1)} disabled={page <= 1 || busy} aria-label="หน้าก่อนหน้า">
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      {pageNumbers(page, pages).map((item, index) => item === 0
        ? <span className="nx-page-gap" key={`gap-${index}`} aria-hidden="true">…</span>
        : (
          <button
            type="button"
            key={item}
            className={`nx-page-num${item === page ? " is-current" : ""}`}
            aria-current={item === page ? "page" : undefined}
            aria-label={`หน้า ${item}`}
            onClick={() => item !== page && onPage(item)}
            disabled={busy && item !== page}
          >
            {item}
          </button>
        ))}
      <span className="nx-page-now">{page.toLocaleString("th-TH")} / {pages.toLocaleString("th-TH")}</span>
      <button type="button" className="nx-page-step" onClick={() => onPage(page + 1)} disabled={page >= pages || busy} aria-label="หน้าถัดไป">
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
}

// Activity reads better in day groups: วันนี้, เมื่อวาน, then the date.
function groupByDay(items: LogItem[]) {
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const groups: { key: string; label: string; items: LogItem[] }[] = [];
  const newestFirst = [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const item of newestFirst) {
    const date = new Date(item.createdAt);
    const key = dayKey(date);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label = key === dayKey(today) ? "วันนี้" : key === dayKey(yesterday) ? "เมื่อวาน" : new Intl.DateTimeFormat("th-TH", { dateStyle: "long" }).format(date);
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
function formatTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function ProfileView({ me, setMe, notify, ask }: { me: AuthUser; setMe: (user: AuthUser) => void; notify: (notice: { kind: "success" | "error"; text: string }) => void; ask: (request: ConfirmRequest) => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionPage, setSessionPage] = useState(1);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const activityRef = useRef<HTMLElement>(null);
  const logPages = Math.max(1, Math.ceil(logTotal / ACTIVITY_PAGE));
  const [social, setSocial] = useState<{ provider: string; email: string; connectedAt: string }[]>([]);
  const [form, setForm] = useState({ displayName: me.displayName || "", email: me.email || "" });
  
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [cropping, setCropping] = useState(false);
  
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const load = useCallback(() => Promise.all([
    api<{ items: Session[] }>("/api/profile/sessions").then((x) => setSessions(x.items)),
    api<{ items: LogItem[]; total?: number }>(`/api/profile/activity?limit=${ACTIVITY_PAGE}&page=1`).then((x) => { setLogs(x.items); setLogTotal(x.total || x.items.length); setLogPage(1); }),
    api<{ items: { provider: string; email: string; connectedAt: string }[] }>("/api/profile/social").then((x) => setSocial(x.items)),
  ]), []);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { load().catch(() => undefined).finally(() => setLoaded(true)); }, [load]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    // Both fields are optional: an empty name shows the username, an empty email clears it.
    const email = form.email.trim();
    if (email && (!email.includes("@") || /\s/.test(email))) return notify({ kind: "error", text: "รูปแบบอีเมลไม่ถูกต้อง" });
    try {
      const result = await api<{ user: AuthUser }>("/api/profile/", { method: "PATCH", body: JSON.stringify(form) });
      setMe(result.user); notify({ kind: "success", text: "บันทึกโปรไฟล์แล้ว" });
      setShowProfileModal(false);
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = data.get("currentPassword") as string;
    const newPassword = data.get("newPassword") as string;
    if (!currentPassword) return notify({ kind: "error", text: "โปรดกรอกรหัสผ่านปัจจุบัน" });
    if (!newPassword) return notify({ kind: "error", text: "โปรดกรอกรหัสผ่านใหม่" });
    if (hasNonAscii(newPassword)) return notify({ kind: "error", text: "รหัสผ่านใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และสัญลักษณ์" });
    if (Array.from(newPassword).length < 8) return notify({ kind: "error", text: "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร" });
    try {
      await api("/api/profile/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      setShowPasswordModal(false);
      notify({ kind: "success", text: "เปลี่ยนรหัสผ่านแล้ว" });
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
  }
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCropImage(URL.createObjectURL(file));
    event.target.value = "";
  }

  async function uploadAvatar() {
    if (!cropImage || !croppedAreaPixels) return;
    setCropping(true);
    try {
      const croppedFile = await getCroppedImg(cropImage, croppedAreaPixels);
      const body = new FormData(); body.append("file", croppedFile);
      const result = await api<{ url: string }>("/api/profile/avatar", { method: "POST", body });
      setMe({ ...me, avatarUrl: result.url }); notify({ kind: "success", text: "อัปเดตรูปโปรไฟล์แล้ว" });
      setCropImage(null);
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
    setCropping(false);
  }
  async function goToLogPage(page: number) {
    if (page < 1 || page > logPages || page === logPage || loadingLogs) return;
    setLoadingLogs(true);
    try {
      const result = await api<{ items: LogItem[]; total?: number }>(`/api/profile/activity?limit=${ACTIVITY_PAGE}&page=${page}`);
      setLogs(result.items);
      if (typeof result.total === "number") setLogTotal(result.total);
      setLogPage(page);
      // Keep the list's top in view when the pager is clicked far down the page.
      const top = activityRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) activityRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
    finally { setLoadingLogs(false); }
  }
  async function revokeSession(id: number) {
    try { await api(`/api/profile/sessions/${id}`, { method: "DELETE" }); await load(); notify({ kind: "success", text: "ยกเลิก Session แล้ว" }); }
    catch (error) { notify({ kind: "error", text: (error as Error).message }); }
  }

  const [copiedIp, setCopiedIp] = useState(false);
  const dialogOpen = Boolean(showProfileModal || showPasswordModal || selectedSession || cropImage);
  useScrollLock(dialogOpen);
  useEscape(dialogOpen, () => {
    if (cropImage) { if (!cropping) setCropImage(null); }
    else if (selectedSession) setSelectedSession(null);
    else if (showPasswordModal) setShowPasswordModal(false);
    else setShowProfileModal(false);
  });

  const socialAvailable = useSocialAvailability();
  const providers: { key: SocialProvider; name: string; icon: string }[] = [
    { key: "discord", name: "Discord", icon: "/brands/discord-symbol.svg" },
    { key: "google", name: "Google", icon: "/brands/google-g.png" },
    { key: "github", name: "GitHub", icon: "/brands/github-mark.png" },
  ];
  const sessionPages = Math.max(1, Math.ceil(sessions.length / 5));
  const pageSessions = sessions.slice((sessionPage - 1) * 5, sessionPage * 5);
  const initial = (me.displayName || me.username || "?")[0].toUpperCase();

  function openProfileEdit() {
    setForm({ displayName: me.displayName || "", email: me.email || "" });
    setShowProfileModal(true);
  }
  function askSignOut(session: Session) {
    ask({
      title: session.current ? "ออกจากระบบเครื่องนี้?" : "ออกจากระบบอุปกรณ์นี้?",
      message: session.current ? "คุณจะต้องเข้าสู่ระบบใหม่บนเครื่องนี้" : "อุปกรณ์นี้จะต้องเข้าสู่ระบบใหม่จึงจะใช้งานต่อได้",
      confirmLabel: "ออกจากระบบ",
      danger: true,
      action: async () => { setSelectedSession(null); await revokeSession(session.id); },
    });
  }
  async function copyIp(ip: string) {
    try {
      await navigator.clipboard.writeText(ip);
      setCopiedIp(true);
      window.setTimeout(() => setCopiedIp(false), 1600);
    } catch {
      notify({ kind: "error", text: "คัดลอกไม่ได้ ลองอีกครั้ง" });
    }
  }

  return <div className="aov hv pfv">
    <header className="aov-head">
      <div>
        <p className="aov-eyebrow">บัญชีของฉัน</p>
        <h1>โปรไฟล์ของฉัน</h1>
        <p className="aov-sub">ข้อมูลบัญชี การเข้าสู่ระบบ และอุปกรณ์ที่ใช้อยู่</p>
      </div>
    </header>

    <section className="aov-panel pfv-id">
      <label className="pfv-avatar" title="เปลี่ยนรูปโปรไฟล์">
        {me.avatarUrl ? <SmartImage src={me.avatarUrl} alt="" compact fallback={<>{initial}</>} /> : <span>{initial}</span>}
        <i aria-hidden="true"><FileImage size={14} /></i>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} aria-label="เปลี่ยนรูปโปรไฟล์" />
      </label>
      <div className="pfv-id-copy">
        <div className="pfv-id-name"><h2>{me.displayName || me.username}</h2>{roleBadge(me.role)}</div>
        <p>@{me.username}{me.email ? <> · {me.email}</> : null}</p>
      </div>
      <div className="pfv-id-actions">
        <button type="button" className="hv-btn" onClick={openProfileEdit}><Pencil size={15} aria-hidden="true" /> แก้ไขข้อมูล</button>
      </div>
    </section>

    <div className="pfv-grid">
      <section className="aov-panel">
        <header><h2><ShieldCheck size={17} className="aov-h-icon" aria-hidden="true" />การเข้าสู่ระบบ</h2></header>
        <ul className="pfv-rows">
          <li>
            <span className="pfv-row-icon" aria-hidden="true"><KeyRound size={17} /></span>
            <span className="pfv-row-copy"><strong>รหัสผ่าน</strong><small>ใช้คู่กับชื่อผู้ใช้ @{me.username}</small></span>
            <button type="button" className="hv-btn" onClick={() => setShowPasswordModal(true)}>เปลี่ยน</button>
          </li>
          {providers.map((provider) => {
            const connected = social.find((item) => item.provider === provider.key);
            // Switched off in Social Login settings: connecting would fail, so say so instead.
            const providerOff = socialAvailable[provider.key] === false;
            return (
              <li key={provider.key}>
                <span className={`pfv-row-icon is-brand is-${provider.key}`} aria-hidden="true"><img src={provider.icon} alt="" /></span>
                <span className="pfv-row-copy">
                  <strong>{provider.name}</strong>
                  <small className={connected ? "is-on" : ""}>{connected ? connected.email || "เชื่อมแล้ว" : providerOff ? "ระบบยังไม่เปิดให้เชื่อม" : "ยังไม่ได้เชื่อม"}</small>
                </span>
                {connected ? (
                  <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => ask({ title: `ยกเลิกการเชื่อม ${provider.name}?`, message: `หลังยกเลิก คุณจะเข้าสู่ระบบด้วย ${provider.name} ไม่ได้จนกว่าจะเชื่อมใหม่`, confirmLabel: "ยกเลิกการเชื่อม", danger: true, action: async () => { await api(`/api/profile/social/${provider.key}`, { method: "DELETE" }); await load(); notify({ kind: "success", text: `ยกเลิกการเชื่อม ${provider.name} แล้ว` }); } })}>ยกเลิก</button>
                ) : providerOff ? (
                  me.role === "superadmin"
                    ? <Link className="hv-btn" href="/admin/settings?tab=social" title={`เปิดการเข้าสู่ระบบด้วย ${provider.name}`}>เปิดในตั้งค่า</Link>
                    : <button type="button" className="hv-btn" disabled title={`ผู้ดูแลยังไม่เปิดการเชื่อมด้วย ${provider.name}`}>ยังไม่เปิดใช้</button>
                ) : (
                  <SocialOAuthButton className="hv-btn" provider={provider.key} mode="connect" ariaLabel={`เชื่อม ${provider.name}`}>เชื่อม</SocialOAuthButton>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="aov-panel">
        <header><h2><Monitor size={17} className="aov-h-icon" aria-hidden="true" />อุปกรณ์ที่เข้าสู่ระบบ {sessions.length > 0 && <span>{sessions.length} เครื่อง</span>}</h2></header>
        {sessions.length ? (
          <ul className="pfv-rows">
            {pageSessions.map((session) => {
              const ua = parseUserAgent(session.userAgent);
              const Icon = ua.icon;
              return (
                <li key={session.id} className={session.current ? "is-current" : ""}>
                  <span className="pfv-row-icon" aria-hidden="true"><Icon size={17} /></span>
                  <button type="button" className="pfv-row-copy pfv-row-link" onClick={() => setSelectedSession(session)}>
                    <strong>{ua.browser} บน {ua.os} {session.current && <em>เครื่องนี้</em>}</strong>
                    <small>{session.ipAddress ? `${session.ipAddress} · ` : ""}ใช้ล่าสุด {formatDate(session.lastSeenAt)}</small>
                  </button>
                  <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => setSelectedSession(session)} aria-label="รายละเอียด" title="รายละเอียด"><Info size={16} aria-hidden="true" /></button>
                  <button type="button" className="hv-btn hv-icon-btn is-sm hv-danger-icon" onClick={() => askSignOut(session)} aria-label="ออกจากระบบอุปกรณ์นี้" title="ออกจากระบบ"><LogOut size={16} aria-hidden="true" /></button>
                </li>
              );
            })}
          </ul>
        ) : <div className="aov-empty">{loaded ? "ไม่พบอุปกรณ์" : "กำลังโหลด..."}</div>}
        {sessionPages > 1 && (
          <div className="pfv-pager">
            <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => setSessionPage((p) => Math.max(1, p - 1))} disabled={sessionPage === 1} aria-label="หน้าก่อนหน้า"><ChevronLeft size={16} /></button>
            <span>{sessionPage} / {sessionPages}</span>
            <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => setSessionPage((p) => Math.min(sessionPages, p + 1))} disabled={sessionPage === sessionPages} aria-label="หน้าถัดไป"><ChevronRight size={16} /></button>
          </div>
        )}
        <p className="pfv-tip">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>เห็นอุปกรณ์ที่ไม่รู้จัก? กดออกจากระบบอุปกรณ์นั้น แล้ว<button type="button" onClick={() => setShowPasswordModal(true)}>เปลี่ยนรหัสผ่าน</button>ทันที</span>
        </p>
      </section>
    </div>

    <section className="aov-panel pfv-activity-panel" ref={activityRef}>
      <header><h2><Activity size={17} className="aov-h-icon" aria-hidden="true" />กิจกรรมล่าสุด</h2></header>
      {logs.length ? (
        <>
          <div className={`pfv-activity-list${loadingLogs ? " is-loading" : ""}`} aria-busy={loadingLogs || undefined}>
          {groupByDay(logs).map((group) => (
            <div className="pfv-day" key={group.key}>
              <h3>{group.label}</h3>
              <ul className="pfv-activity">
                {group.items.map((log) => (
                  <li key={log.id}>
                    <span className={`pfv-row-icon log-category-icon ${log.category || "system"}`} aria-hidden="true">{logIcon(log)}</span>
                    <span className="pfv-row-copy">
                      <strong>{actionText(log.action)}</strong>
                      <small>{categoryLabel[log.category] || log.category}{log.targetType ? <> · {formatLogTarget(log)}</> : null}</small>
                    </span>
                    <span className={`hv-status ${log.outcome === "success" ? "is-running" : "is-error"}`}>{log.outcome === "success" ? "สำเร็จ" : "ล้มเหลว"}</span>
                    <span className="pfv-when"><time dateTime={log.createdAt}>{formatTime(log.createdAt)}</time><small>{log.ipAddress || ""}</small></span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          </div>
          <footer className="pfv-more">
            <span className="pfv-range">
              {logPages > 1
                ? `${((logPage - 1) * ACTIVITY_PAGE + 1).toLocaleString("th-TH")}–${Math.min(logPage * ACTIVITY_PAGE, logTotal).toLocaleString("th-TH")} จาก ${logTotal.toLocaleString("th-TH")} รายการ`
                : `${logTotal.toLocaleString("th-TH")} รายการ`}
            </span>
            <Pager page={logPage} pages={logPages} onPage={(page) => void goToLogPage(page)} busy={loadingLogs} label="หน้ากิจกรรม" />
          </footer>
        </>
      ) : <div className="aov-empty">{loaded ? "ยังไม่มีกิจกรรม" : "กำลังโหลด..."}</div>}
    </section>

    {showProfileModal && createPortal(
      <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setShowProfileModal(false)}>
        <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="pfv-edit-title">
          <header className="hv-dialog-head">
            <div className="hv-dh-main">
              <User size={20} className="hv-dh-icon" aria-hidden="true" />
              <div className="hv-dh-text"><small>@{me.username}</small><h2 id="pfv-edit-title">แก้ไขข้อมูล</h2></div>
            </div>
            <button type="button" className="hv-btn hv-icon-btn" onClick={() => setShowProfileModal(false)} aria-label="ปิด"><X size={18} /></button>
          </header>
          <form className="hv-form" onSubmit={saveProfile} noValidate>
            <div className="hv-dialog-body">
              <div className="hv-field">
                <label htmlFor="pfv-name">ชื่อที่แสดง</label>
                <input id="pfv-name" value={form.displayName} maxLength={80} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder={me.username} autoFocus />
                <small>เว้นว่างไว้ จะแสดงเป็น @{me.username}</small>
              </div>
              <div className="hv-field">
                <label htmlFor="pfv-email">อีเมล <span className="pfv-optional">ไม่บังคับ</span></label>
                <input id="pfv-email" type="email" value={form.email} maxLength={254} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" autoCapitalize="none" spellCheck={false} />
              </div>
            </div>
            <footer className="hv-dialog-foot">
              <button type="button" className="hv-btn" onClick={() => setShowProfileModal(false)}>ยกเลิก</button>
              <button type="submit" className="hv-btn hv-btn-primary">บันทึก</button>
            </footer>
          </form>
        </section>
      </div>,
      document.body,
    )}

    {showPasswordModal && createPortal(
      <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setShowPasswordModal(false)}>
        <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="pfv-pass-title">
          <header className="hv-dialog-head">
            <div className="hv-dh-main">
              <KeyRound size={20} className="hv-dh-icon" aria-hidden="true" />
              <div className="hv-dh-text"><small>@{me.username}</small><h2 id="pfv-pass-title">เปลี่ยนรหัสผ่าน</h2></div>
            </div>
            <button type="button" className="hv-btn hv-icon-btn" onClick={() => setShowPasswordModal(false)} aria-label="ปิด"><X size={18} /></button>
          </header>
          <form className="hv-form" onSubmit={changePassword} noValidate>
            <div className="hv-dialog-body">
              <div className="hv-field">
                <label htmlFor="pfv-current">รหัสผ่านปัจจุบัน</label>
                <input id="pfv-current" name="currentPassword" type="password" autoComplete="current-password" required autoFocus {...asciiInputProps()} />
              </div>
              <div className="hv-field">
                <label htmlFor="pfv-new">รหัสผ่านใหม่</label>
                <input id="pfv-new" name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required {...asciiInputProps()} />
                <small>อย่างน้อย 8 ตัว ใช้ตัวอักษรภาษาอังกฤษ ตัวเลข และสัญลักษณ์ได้</small>
              </div>
            </div>
            <footer className="hv-dialog-foot">
              <button type="button" className="hv-btn" onClick={() => setShowPasswordModal(false)}>ยกเลิก</button>
              <button type="submit" className="hv-btn hv-btn-primary">เปลี่ยนรหัสผ่าน</button>
            </footer>
          </form>
        </section>
      </div>,
      document.body,
    )}

    {selectedSession && createPortal(
      <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setSelectedSession(null)}>
        <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="pfv-session-title">
          {(() => {
            const ua = parseUserAgent(selectedSession.userAgent);
            const UaIcon = ua.icon;
            return (
              <header className="hv-dialog-head">
                <div className="hv-dh-main">
                  <UaIcon size={20} className="hv-dh-icon" aria-hidden="true" />
                  <div className="hv-dh-text">
                    <small>{selectedSession.current ? "เครื่องที่ใช้อยู่ตอนนี้" : "อุปกรณ์ที่เข้าสู่ระบบ"}</small>
                    <h2 id="pfv-session-title">{ua.browser} บน {ua.os}</h2>
                  </div>
                </div>
                <button type="button" className="hv-btn hv-icon-btn" onClick={() => setSelectedSession(null)} aria-label="ปิด"><X size={18} /></button>
              </header>
            );
          })()}
          <div className="hv-dialog-body">
            <ul className="dbv-conn">
              <li>
                <span className="dbv-conn-label">IP</span>
                <strong className="dbv-conn-value">{selectedSession.ipAddress || "—"}</strong>
                {selectedSession.ipAddress ? (
                  <button type="button" className={`dbv-copy${copiedIp ? " is-done" : ""}`} onClick={() => void copyIp(selectedSession.ipAddress)} aria-label="คัดลอก IP" title="คัดลอก">
                    {copiedIp ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  </button>
                ) : <span />}
              </li>
              <li><span className="dbv-conn-label">เข้าสู่ระบบ</span><strong className="dbv-conn-value">{formatDate(selectedSession.createdAt)}</strong><span /></li>
              <li><span className="dbv-conn-label">ใช้ล่าสุด</span><strong className="dbv-conn-value">{formatDate(selectedSession.lastSeenAt)}</strong><span /></li>
              <li><span className="dbv-conn-label">หมดอายุ</span><strong className="dbv-conn-value">{formatDate(selectedSession.expiresAt)}</strong><span /></li>
            </ul>
            <details className="pfv-ua">
              <summary>ข้อมูลเบราว์เซอร์ (User Agent)</summary>
              <p>{selectedSession.userAgent || "—"}</p>
            </details>
          </div>
          <footer className="hv-dialog-foot">
            <button type="button" className="hv-btn hv-btn-danger-ghost pfv-foot-left" onClick={() => askSignOut(selectedSession)}><LogOut size={15} aria-hidden="true" /> ออกจากระบบอุปกรณ์นี้</button>
            <button type="button" className="hv-btn" onClick={() => setSelectedSession(null)}>ปิด</button>
          </footer>
        </section>
      </div>,
      document.body,
    )}

    {cropImage && createPortal(
      <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !cropping && setCropImage(null)}>
        <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="pfv-crop-title">
          <header className="hv-dialog-head">
            <div className="hv-dh-main">
              <FileImage size={20} className="hv-dh-icon" aria-hidden="true" />
              <div className="hv-dh-text"><small>ลากเพื่อจัดตำแหน่ง</small><h2 id="pfv-crop-title">รูปโปรไฟล์</h2></div>
            </div>
            <button type="button" className="hv-btn hv-icon-btn" onClick={() => setCropImage(null)} disabled={cropping} aria-label="ปิด"><X size={18} /></button>
          </header>
          <div className="hv-dialog-body">
            <div className="pfv-crop">
              <Cropper
                image={cropImage}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, croppedAreaPixels) => setCroppedAreaPixels(croppedAreaPixels)}
              />
            </div>
            <label className="pfv-zoom">
              <span>ซูม</span>
              <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            </label>
          </div>
          <footer className="hv-dialog-foot">
            <button type="button" className="hv-btn" onClick={() => setCropImage(null)} disabled={cropping}>ยกเลิก</button>
            <button type="button" className="hv-btn hv-btn-primary" onClick={uploadAvatar} disabled={cropping}>
              {cropping && <span className="hv-spinner" aria-hidden="true" />}
              {cropping ? "กำลังบันทึก..." : "ใช้รูปนี้"}
            </button>
          </footer>
        </section>
      </div>,
      document.body,
    )}
  </div>;
}

function canManageUser(actor: AuthUser, user: ManagedUser) {
  if (user.username === actor.username) return false; // /api/auth/me has no id, so match on the unique username
  if (user.role === "superadmin") return false;
  if (actor.role === "superadmin") return true;
  return user.role === "user";
}

const USER_PAGE_SIZES = [10, 25, 50, 100];
const USER_SORTS = [
  { value: "newest", label: "ใหม่สุด" },
  { value: "oldest", label: "เก่าสุด" },
  { value: "name", label: "ชื่อ A–Z" },
  { value: "lastLogin", label: "เข้าใช้ล่าสุด" },
];

// Filters, sort and page come from the address bar, so a refresh or a shared link opens the same list.
function initialUserFilters() {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const pick = (value: string | null, allowed: string[], fallback: string) => (value && allowed.includes(value) ? value : fallback);
  const perPage = Number(params.get("per"));
  return {
    q: (params.get("q") || "").slice(0, 80),
    status: pick(params.get("status"), ["active", "suspended", "banned"], ""),
    role: pick(params.get("role"), ["user", "admin", "superadmin"], ""),
    sort: pick(params.get("sort"), USER_SORTS.map((s) => s.value), "newest"),
    perPage: USER_PAGE_SIZES.includes(perPage) ? perPage : USER_PAGE_SIZES[0],
    page: Math.max(1, Math.floor(Number(params.get("page"))) || 1),
  };
}

// A random password with letters, digits and a symbol, for creating users or resetting.
function generatePassword(length = 14) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*-_"];
  const all = sets.join("");
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  const chars = Array.from(values, (v, i) => (i < sets.length ? sets[i] : all)[v % (i < sets.length ? sets[i].length : all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = values[i] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

function UserAvatar({ user, size = 36 }: { user: Pick<ManagedUser, "avatarUrl" | "displayName" | "username">; size?: number }) {
  const letter = (user.displayName || user.username || "?").trim().charAt(0).toUpperCase();
  return user.avatarUrl
    ? <SmartImage src={user.avatarUrl} alt="" compact wrapperClassName="usv-avatar" wrapperStyle={{ width: size, height: size }} style={{ width: size, height: size, objectFit: "cover" }} />
    : <span className="usv-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">{letter}</span>;
}

const userStatusTone: Record<string, string> = { active: "is-running", suspended: "is-provisioning", banned: "is-error" };

function UsersView({ me, notify, ask }: { me: AuthUser; notify: (notice: { kind: "success" | "error"; text: string }) => void; ask: (request: ConfirmRequest) => void }) {
  const [initial] = useState(initialUserFilters);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{ totalUsers: number; activeUsers: number; suspendedUsers: number; activeSessions: number } | null>(null);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState(initial.status);
  const [role, setRole] = useState(initial.role);
  const [sort, setSort] = useState(initial.sort);
  const [perPage, setPerPage] = useState(initial.perPage);
  const [page, setPage] = useState(initial.page);
  const listTopRef = useRef<HTMLElement>(null);
  const usersRequestRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [actionUser, setActionUser] = useState<ManagedUser | null>(null);
  const [userEditForm, setUserEditForm] = useState({ displayName: "", email: "" });
  const [savingUser, setSavingUser] = useState(false);

  const [creatingUser, setCreatingUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({ username: "", password: "", displayName: "", email: "", role: "user" });
  const [createErrors, setCreateErrors] = useState<{ username?: string; password?: string; email?: string }>({});
  const [createBusy, setCreateBusy] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [resetPasswordUser, setResetPasswordUser] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [resetPasswordBusy, setResetPasswordBusy] = useState(false);

  // Admins may only create regular users; the API refuses anything else from them.
  const roleOptions = me.role === "superadmin" ? [
    { value: "user", label: "ผู้ใช้ทั่วไป", hint: "ใช้บริการได้อย่างเดียว" },
    { value: "admin", label: "ผู้ดูแลระบบ", hint: "ดูแลผู้ใช้ทั่วไปและเนื้อหา" },
    { value: "superadmin", label: "ผู้ดูแลสูงสุด", hint: "ทำได้ทุกอย่าง รวมถึงดูแลแอดมิน" },
  ] : [{ value: "user", label: "ผู้ใช้ทั่วไป", hint: "ใช้บริการได้อย่างเดียว" }];

  const search = q.trim();
  const query = `q=${encodeURIComponent(search)}&status=${status}&role=${role}&sort=${sort}&limit=${perPage}&page=${page}`;
  const load = useCallback(async () => {
    const request = ++usersRequestRef.current;
    setLoading(true);
    try {
      const [list, stats] = await Promise.all([
        api<{ items: ManagedUser[]; total: number }>(`/api/admin/users?${query}`),
        api<{ totalUsers: number; activeUsers: number; suspendedUsers: number; activeSessions: number }>("/api/admin/summary").catch(() => null),
      ]);
      if (request !== usersRequestRef.current) return; // a newer page or filter already took over
      const count = Number(list.total) || 0; // an older API without totals counts as empty, not a crash
      const lastPage = Math.max(1, Math.ceil(count / perPage));
      // Past the end (rows were deleted, or an old link): jump to the last page that has rows.
      if (!list.items.length && count > 0 && page > lastPage) { setPage(lastPage); return; }
      setUsers(list.items);
      setTotal(count);
      if (stats) setSummary(stats);
      // Keep an open dialog showing the fresh copy of its user.
      setActionUser((current) => (current ? list.items.find((u) => u.id === current.id) || null : null));
    } catch (error) {
      if (request === usersRequestRef.current) notify({ kind: "error", text: (error as Error).message });
    } finally {
      if (request === usersRequestRef.current) setLoading(false);
    }
  }, [query, perPage, page, notify]);

  // Typing waits a moment before searching; paging and the other filters load at once.
  const typedRef = useRef(search);
  useEffect(() => {
    const typed = typedRef.current !== search;
    typedRef.current = search;
    const timer = window.setTimeout(() => void load(), typed ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);
  const selectionKey = `${search}|${status}|${role}|${sort}|${perPage}|${page}`;
  const [selectionFor, setSelectionFor] = useState(selectionKey);
  if (selectionFor !== selectionKey) {
    setSelectionFor(selectionKey);
    setSelectedIds([]);
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (status) params.set("status", status);
    if (role) params.set("role", role);
    if (sort !== "newest") params.set("sort", sort);
    if (perPage !== USER_PAGE_SIZES[0]) params.set("per", String(perPage));
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [search, status, role, sort, perPage, page]);

  const pages = Math.max(1, Math.ceil(total / perPage));
  const rangeFrom = total ? (page - 1) * perPage + 1 : 0;
  const rangeTo = Math.min(total, page * perPage);
  function goToPage(next: number) {
    setPage(Math.min(Math.max(1, next), pages));
    // Start the new page from its first row, not wherever the old one was scrolled to.
    const top = listTopRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function clearFilters() { setQ(""); setStatus(""); setRole(""); setPage(1); }

  const dialogOpen = Boolean(actionUser || creatingUser || resetPasswordUser);
  useScrollLock(dialogOpen);
  useEscape(dialogOpen, () => {
    if (resetPasswordUser) { if (!resetPasswordBusy) setResetPasswordUser(null); }
    else if (creatingUser) { if (!createBusy) setCreatingUser(false); }
    else if (!savingUser) setActionUser(null);
  });

  const selectableUsers = useMemo(() => users.filter((user) => canManageUser(me, user)), [users, me]);
  const selectedUsers = useMemo(() => users.filter((user) => selectedIds.includes(user.id)), [users, selectedIds]);
  const allSelectableSelected = selectableUsers.length > 0 && selectableUsers.every((user) => selectedIds.includes(user.id));
  const someSelectableSelected = selectableUsers.some((user) => selectedIds.includes(user.id));
  const hasFilters = Boolean(q.trim() || status || role);
  const blocked = summary ? Math.max(0, summary.totalUsers - summary.activeUsers) : 0;

  function toggleAllUsers() {
    setSelectedIds(allSelectableSelected ? [] : selectableUsers.map((user) => user.id));
  }

  function toggleUserSelection(userId: number) {
    setSelectedIds((current) => current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]);
  }

  async function runBulkAction(label: string, action: (user: ManagedUser) => Promise<unknown>) {
    if (selectedUsers.length === 0 || bulkBusy) return;
    const targets = [...selectedUsers];
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(targets.map((user) => action(user)));
      const failed = targets.filter((_, index) => results[index].status === "rejected");
      const messages = results.flatMap((result, index) => result.status === "rejected" ? [`@${targets[index].username}: ${(result.reason as Error)?.message || "ทำไม่สำเร็จ"}`] : []);
      await load();
      setSelectedIds(failed.map((user) => user.id));
      const done = targets.length - failed.length;
      if (!failed.length) notify({ kind: "success", text: `${label} ${done} บัญชีแล้ว` });
      else notify({ kind: "error", text: `${label}${done ? `สำเร็จ ${done} บัญชี ไม่สำเร็จ ${failed.length} บัญชี` : "ไม่สำเร็จ"}: ${messages.slice(0, 3).join(" · ")}${messages.length > 3 ? ` และอีก ${messages.length - 3}` : ""}` });
    } finally {
      setBulkBusy(false);
    }
  }

  function bulk(options: { title: string; message: string; confirmLabel: string; danger?: boolean; label: string; action: (user: ManagedUser) => Promise<unknown> }) {
    if (!selectedUsers.length) return;
    ask({ title: options.title, message: options.message, confirmLabel: options.confirmLabel, danger: options.danger, action: () => runBulkAction(options.label, options.action) });
  }

  const setUserStatus = (user: ManagedUser, next: string) => api(`/api/admin/users/${user.id}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) });

  function openUser(user: ManagedUser) {
    setActionUser(user);
    setUserEditForm({ displayName: user.displayName || "", email: user.email || "" });
  }

  function confirmStatus(user: ManagedUser, next: "active" | "suspended" | "banned") {
    const copy = {
      active: { title: user.status === "banned" ? `ยกเลิกการแบน @${user.username}?` : `เปิดใช้ @${user.username}?`, message: "เข้าสู่ระบบได้ตามเดิม", label: user.status === "banned" ? "ยกเลิกการแบน" : "เปิดใช้บัญชี", danger: false },
      suspended: { title: `ระงับ @${user.username} ชั่วคราว?`, message: "จะหลุดจากระบบทันที และเข้าไม่ได้จนกว่าจะเปิดใช้", label: "ระงับชั่วคราว", danger: true },
      banned: { title: `แบน @${user.username}?`, message: "จะหลุดจากระบบทันที และเข้าไม่ได้จนกว่าจะยกเลิกแบน", label: "แบนบัญชี", danger: true },
    }[next];
    ask({
      title: copy.title, message: copy.message, confirmLabel: copy.label, danger: copy.danger,
      action: async () => {
        await setUserStatus(user, next);
        await load();
        notify({ kind: "success", text: `${copy.label} @${user.username} แล้ว` });
      },
    });
  }

  function confirmSignOut(user: ManagedUser) {
    ask({
      title: `ให้ @${user.username} ออกจากระบบทุกอุปกรณ์?`,
      message: `${user.activeSessions} เครื่องที่เข้าอยู่ต้องเข้าสู่ระบบใหม่ บัญชียังใช้ได้`,
      confirmLabel: "ออกจากระบบทุกอุปกรณ์",
      danger: true,
      action: async () => {
        await api(`/api/admin/users/${user.id}/sessions`, { method: "DELETE" });
        await load();
        notify({ kind: "success", text: `@${user.username} ออกจากระบบทุกอุปกรณ์แล้ว` });
      },
    });
  }

  function confirmDelete(user: ManagedUser) {
    ask({
      title: `ลบบัญชี @${user.username} ถาวร?`,
      message: "ลบแล้วกู้คืนไม่ได้ ถ้ายังเป็นเจ้าของเว็บไซต์อยู่ ต้องย้ายเจ้าของก่อน",
      confirmLabel: "ลบบัญชีถาวร",
      danger: true,
      action: async () => {
        await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
        setActionUser(null);
        await load();
        notify({ kind: "success", text: `ลบบัญชี @${user.username} แล้ว` });
      },
    });
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    if (!actionUser) return;
    const email = userEditForm.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return notify({ kind: "error", text: "รูปแบบอีเมลไม่ถูกต้อง" });
    setSavingUser(true);
    try {
      await api(`/api/admin/users/${actionUser.id}`, { method: "PATCH", body: JSON.stringify({ displayName: userEditForm.displayName.trim(), email }) });
      await load();
      notify({ kind: "success", text: `บันทึกข้อมูล @${actionUser.username} แล้ว` });
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
    finally { setSavingUser(false); }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    const errs: { username?: string; password?: string; email?: string } = {};
    const username = newUserForm.username.trim();
    if (!username) errs.username = "ยังไม่ได้ใส่ชื่อผู้ใช้";
    else if (username.length < 4 || username.length > 30) errs.username = "ต้องยาว 4–30 ตัว";
    if (!newUserForm.password) errs.password = "ยังไม่ได้ใส่รหัสผ่าน";
    else if (Array.from(newUserForm.password).length < 8) errs.password = "อย่างน้อย 8 ตัว";
    else if (hasNonAscii(newUserForm.password)) errs.password = "ใช้ได้แค่ภาษาอังกฤษ ตัวเลข และสัญลักษณ์";
    if (newUserForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUserForm.email)) errs.email = "รูปแบบอีเมลไม่ถูกต้อง";
    setCreateErrors(errs);
    if (Object.keys(errs).length) return;
    setCreateBusy(true);
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify({ ...newUserForm, username: newUserForm.username.trim(), email: newUserForm.email.trim() }) });
      setCreatingUser(false);
      notify({ kind: "success", text: `เพิ่มผู้ใช้ @${newUserForm.username.trim()} แล้ว` });
      setNewUserForm({ username: "", password: "", displayName: "", email: "", role: "user" });
      await load();
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
    finally { setCreateBusy(false); }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!resetPasswordUser) return;
    if (Array.from(newPassword).length < 8) return setResetPasswordError("อย่างน้อย 8 ตัว");
    if (hasNonAscii(newPassword)) return setResetPasswordError("ใช้ได้แค่ภาษาอังกฤษ ตัวเลข และสัญลักษณ์");
    setResetPasswordBusy(true);
    try {
      await api(`/api/admin/users/${resetPasswordUser.id}/password`, { method: "PATCH", body: JSON.stringify({ newPassword }) });
      notify({ kind: "success", text: `ตั้งรหัสผ่านใหม่ให้ @${resetPasswordUser.username} แล้ว` });
      setResetPasswordUser(null);
      await load();
    } catch (error) { setResetPasswordError((error as Error).message || "เปลี่ยนรหัสผ่านไม่ได้"); }
    finally { setResetPasswordBusy(false); }
  }

  async function copyText(value: string, label: string) {
    const ok = await navigator.clipboard.writeText(value).then(() => true, () => false);
    notify(ok ? { kind: "success", text: `คัดลอก${label}แล้ว` } : { kind: "error", text: "คัดลอกไม่ได้ เลือกข้อความแล้วคัดลอกเอง" });
  }

  const canManageActionUser = actionUser ? canManageUser(me, actionUser) : false;
  const canResetActionUser = actionUser ? actionUser.role !== "superadmin" && (me.role === "superadmin" || actionUser.role === "user") : false;

  return (
    <div className="aov hv usv" aria-busy={loading}>
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">ผู้ใช้และสิทธิ์</p>
          <h1>ผู้ใช้</h1>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn" onClick={() => void load()} disabled={loading} aria-label="รีเฟรช" title="รีเฟรช">
            <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
          </button>
          <button type="button" className="aov-btn aov-btn-label aov-btn-primary" onClick={() => { setCreateErrors({}); setShowNewPassword(false); setCreatingUser(true); }}>
            <UserPlus size={16} aria-hidden="true" /> เพิ่มผู้ใช้
          </button>
        </div>
      </header>

      <section className="aov-kpis" aria-label="สรุปผู้ใช้">
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Users size={16} /></span>ผู้ใช้ทั้งหมด</span>
          <strong>{summary ? summary.totalUsers.toLocaleString("th-TH") : <i className="aov-skel" />}</strong>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CheckCircle2 size={16} /></span>ใช้งานได้</span>
          <strong>{summary ? summary.activeUsers.toLocaleString("th-TH") : <i className="aov-skel" />}</strong>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Ban size={16} /></span>ระงับหรือแบน</span>
          <strong className={blocked ? "is-wait" : ""}>{summary ? blocked.toLocaleString("th-TH") : <i className="aov-skel" />}</strong>
          <span className="aov-kpi-note">{summary ? `ระงับ ${summary.suspendedUsers} · แบน ${Math.max(0, blocked - summary.suspendedUsers)}` : ""}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Monitor size={16} /></span>อุปกรณ์ที่เข้าระบบอยู่</span>
          <strong>{summary ? summary.activeSessions.toLocaleString("th-TH") : <i className="aov-skel" />}</strong>
        </div>
      </section>

      <section className="aov-panel" ref={listTopRef}>
        <div className="th-filters">
          <label className="th-search" role="search">
            <Search size={17} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); setQ(""); setPage(1); } }}
              placeholder="ค้นหาชื่อ ชื่อผู้ใช้ หรืออีเมล"
              aria-label="ค้นหาผู้ใช้"
            />
            {q && <button type="button" onClick={() => { setQ(""); setPage(1); }} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
          </label>
          <div className="th-chips" role="group" aria-label="สถานะ">
            {[["", "ทั้งหมด"], ["active", "ใช้งาน"], ["suspended", "ระงับ"], ["banned", "แบน"]].map(([value, label]) => (
              <button type="button" key={value || "all"} className={status === value ? "is-active" : ""} aria-pressed={status === value} onClick={() => { setStatus(status === value ? "" : value); setPage(1); }}>{label}</button>
            ))}
          </div>
          <select className="hv-select usv-role-filter" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="สิทธิ์">
            <option value="">ทุกสิทธิ์</option>
            <option value="user">ผู้ใช้ทั่วไป</option>
            <option value="admin">ผู้ดูแลระบบ</option>
            {me.role === "superadmin" && <option value="superadmin">ผู้ดูแลสูงสุด</option>}
          </select>
        </div>
        <div className="th-meta" aria-live="polite">
          <span className="usv-count">
            {loading && !users.length ? "กำลังโหลด..." : total === 0 ? "ไม่พบผู้ใช้" : `${hasFilters ? "พบ " : ""}${total.toLocaleString("th-TH")} บัญชี`}
            {hasFilters && <button type="button" onClick={clearFilters}>ล้างตัวกรอง</button>}
          </span>
          <label className="usv-sort">
            <span>เรียงตาม</span>
            <select className="nx-inline-select" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
              {USER_SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>

        {selectableUsers.length > 0 && (
          <div className={`nx-selbar${selectedUsers.length ? " is-active" : " usv-selbar-idle"}`} role="toolbar" aria-label="จัดการหลายบัญชี">
            <label className="nx-selall">
              <input
                type="checkbox"
                className="nx-check"
                checked={allSelectableSelected}
                ref={(el) => { if (el) el.indeterminate = someSelectableSelected && !allSelectableSelected; }}
                onChange={toggleAllUsers}
                disabled={bulkBusy}
              />
              <span>{selectedUsers.length ? `เลือก ${selectedUsers.length} บัญชี` : pages > 1 ? "เลือกทั้งหน้า" : "เลือกทั้งหมด"}</span>
            </label>
            {selectedUsers.length ? (
              <div className="nx-selbar-actions">
                <button type="button" className="hv-btn nx-ok" disabled={bulkBusy} onClick={() => bulk({ title: `เปิดใช้ ${selectedUsers.length} บัญชี?`, message: "บัญชีที่ระงับหรือแบนอยู่จะเข้าสู่ระบบได้อีกครั้ง", confirmLabel: "เปิดใช้", label: "เปิดใช้", action: (u) => setUserStatus(u, "active") })}>
                  <CheckCircle2 size={15} aria-hidden="true" /> เปิดใช้
                </button>
                <button type="button" className="hv-btn nx-warn" disabled={bulkBusy} onClick={() => bulk({ title: `ระงับ ${selectedUsers.length} บัญชีชั่วคราว?`, message: "จะหลุดจากระบบทันที และเข้าไม่ได้จนกว่าจะเปิดใช้", confirmLabel: "ระงับชั่วคราว", danger: true, label: "ระงับ", action: (u) => setUserStatus(u, "suspended") })}>
                  <PauseCircle size={15} aria-hidden="true" /> ระงับ
                </button>
                <button type="button" className="hv-btn hv-btn-danger-ghost" disabled={bulkBusy} onClick={() => bulk({ title: `แบน ${selectedUsers.length} บัญชี?`, message: "จะหลุดจากระบบทันที และเข้าไม่ได้จนกว่าจะยกเลิกแบน", confirmLabel: "แบนบัญชี", danger: true, label: "แบน", action: (u) => setUserStatus(u, "banned") })}>
                  <Ban size={15} aria-hidden="true" /> แบน
                </button>
                <button type="button" className="hv-btn" disabled={bulkBusy} onClick={() => bulk({ title: `ให้ ${selectedUsers.length} บัญชีออกจากระบบ?`, message: "ทุกเครื่องต้องเข้าสู่ระบบใหม่ บัญชียังใช้ได้", confirmLabel: "ออกจากระบบทุกอุปกรณ์", danger: true, label: "ออกจากระบบ", action: (u) => api(`/api/admin/users/${u.id}/sessions`, { method: "DELETE" }) })}>
                  <LogOut size={15} aria-hidden="true" /> ออกจากระบบ
                </button>
                <button type="button" className="hv-btn hv-btn-danger-ghost" disabled={bulkBusy} onClick={() => bulk({ title: `ลบ ${selectedUsers.length} บัญชีถาวร?`, message: "ลบแล้วกู้คืนไม่ได้ บัญชีที่ยังเป็นเจ้าของเว็บไซต์จะถูกข้ามไป", confirmLabel: "ลบบัญชีถาวร", danger: true, label: "ลบ", action: (u) => api(`/api/admin/users/${u.id}`, { method: "DELETE" }) })}>
                  <Trash2 size={15} aria-hidden="true" /> ลบ
                </button>
                <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => setSelectedIds([])} disabled={bulkBusy} aria-label="ยกเลิกที่เลือก" title="ยกเลิกที่เลือก"><X size={16} /></button>
              </div>
            ) : null}
          </div>
        )}

        {loading && !users.length ? (
          <ul className="hv-list" aria-hidden="true">{[0, 1, 2, 3].map((i) => <li className="hv-row is-skeleton" key={i}><span /><span /><span /></li>)}</ul>
        ) : users.length ? (
          <ul className={`hv-list${loading ? " usv-refreshing" : ""}`}>
            <li className="hv-row usv-row hv-row-head">
              <label className="usv-select">
                {selectableUsers.length > 0 && (
                  <input
                    type="checkbox"
                    className="nx-check"
                    checked={allSelectableSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelectableSelected && !allSelectableSelected; }}
                    onChange={toggleAllUsers}
                    disabled={bulkBusy}
                    aria-label={pages > 1 ? "เลือกทั้งหน้า" : "เลือกทั้งหมด"}
                  />
                )}
              </label>
              <span>ผู้ใช้</span><span>สิทธิ์</span><span>สถานะ</span><span>อุปกรณ์</span><span>เข้าใช้ล่าสุด</span><span />
            </li>
            {users.map((user) => {
              const selectable = canManageUser(me, user);
              const picked = selectedIds.includes(user.id);
              return (
                <li className={`hv-row usv-row${picked ? " is-picked" : ""}`} key={user.id}>
                  <label className="usv-select">
                    {selectable
                      ? <input type="checkbox" className="nx-check" checked={picked} onChange={() => toggleUserSelection(user.id)} disabled={bulkBusy} aria-label={`เลือก @${user.username}`} />
                      : <span className="usv-select-none" title={user.username === me.username ? "บัญชีของคุณ" : "แก้บัญชีผู้ดูแลสูงสุดไม่ได้"} aria-hidden="true" />}
                  </label>
                  <div className="hv-site">
                    <UserAvatar user={user} />
                    <div className="hv-site-copy">
                      <button type="button" className="hv-site-name" onClick={() => openUser(user)} title={user.displayName || user.username}>
                        {user.displayName || user.username}{user.username === me.username && <span className="usv-you">คุณ</span>}
                      </button>
                      <small className="hv-site-domain">@{user.username}{user.email ? ` · ${user.email}` : ""}</small>
                      <small className="hv-site-meta usv-meta"><span className="usv-meta-role">{roleLabel[user.role]} · </span>{user.activeSessions} อุปกรณ์ · {user.lastLoginAt ? `เข้าล่าสุด ${formatDate(user.lastLoginAt)}` : "ยังไม่เคยเข้า"}</small>
                    </div>
                  </div>
                  <span className={`hv-cell usv-role is-${user.role}`}>{roleLabel[user.role]}</span>
                  <span className={`hv-status ${userStatusTone[user.status] || ""}`}>{statusLabel[user.status] || user.status}</span>
                  <span className="hv-cell usv-num">{user.activeSessions > 0 ? <><i className="usv-online" aria-hidden="true" />{user.activeSessions}</> : <span className="usv-none">—</span>}</span>
                  <span className="hv-cell usv-when">{user.lastLoginAt ? formatDate(user.lastLoginAt) : <span className="usv-none">ยังไม่เคยเข้า</span>}</span>
                  <div className="hv-row-actions">
                    <button type="button" className="hv-btn" onClick={() => openUser(user)}>จัดการ</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="aov-empty hv-empty">
            <span>{hasFilters ? "ไม่พบผู้ใช้ที่ตรงกับตัวกรอง" : "ยังไม่มีผู้ใช้"}</span>
            {hasFilters
              ? <button type="button" onClick={clearFilters}>ล้างตัวกรอง</button>
              : <button type="button" onClick={() => setCreatingUser(true)}>เพิ่มผู้ใช้คนแรก</button>}
          </div>
        )}
        {total > 0 && (
          <footer className="nx-listfoot">
            <span>{rangeFrom.toLocaleString("th-TH")}–{rangeTo.toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")}</span>
            <label className="nx-perpage">
              หน้าละ
              <select className="nx-inline-select" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
                {USER_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <Pager page={page} pages={pages} onPage={goToPage} busy={loading} label="หน้ารายชื่อผู้ใช้" />
          </footer>
        )}
      </section>

      {actionUser && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !savingUser && setActionUser(null)}>
          <section className="hv-dialog usv-dialog" role="dialog" aria-modal="true" aria-labelledby="usv-user-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <UserAvatar user={actionUser} size={44} />
                <div className="hv-dh-text">
                  <small>@{actionUser.username}{actionUser.username === me.username ? " · บัญชีของคุณ" : ""}</small>
                  <h2 id="usv-user-title">{actionUser.displayName || actionUser.username}</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setActionUser(null)} disabled={savingUser} aria-label="ปิด"><X size={18} /></button>
            </header>
            <div className="hv-dialog-body">
              <ul className="usv-facts">
                <li><span>สิทธิ์</span><b className={`usv-role is-${actionUser.role}`}>{roleLabel[actionUser.role]}</b></li>
                <li><span>สถานะ</span><b className={`hv-status ${userStatusTone[actionUser.status] || ""}`}>{statusLabel[actionUser.status] || actionUser.status}</b></li>
                <li><span>เข้าระบบอยู่</span><b>{actionUser.activeSessions} เครื่อง</b></li>
                <li><span>เข้าใช้ล่าสุด</span><b>{actionUser.lastLoginAt ? formatDate(actionUser.lastLoginAt) : "ยังไม่เคยเข้า"}</b></li>
                <li><span>สมัครเมื่อ</span><b>{formatDate(actionUser.createdAt)}</b></li>
              </ul>

              <form className="hv-section usv-edit" onSubmit={saveUser}>
                <h3>ข้อมูลบัญชี</h3>
                <div className="usv-edit-grid">
                  <div className="hv-field">
                    <label htmlFor="usv-display">ชื่อที่แสดง</label>
                    <input id="usv-display" value={userEditForm.displayName} maxLength={80} onChange={(e) => setUserEditForm({ ...userEditForm, displayName: e.target.value })} placeholder={actionUser.username} disabled={savingUser} />
                  </div>
                  <div className="hv-field">
                    <label htmlFor="usv-email">อีเมล</label>
                    <input id="usv-email" type="email" value={userEditForm.email} maxLength={254} onChange={(e) => setUserEditForm({ ...userEditForm, email: e.target.value })} placeholder="ยังไม่มีอีเมล" disabled={savingUser} />
                  </div>
                </div>
                {(userEditForm.displayName !== (actionUser.displayName || "") || userEditForm.email !== (actionUser.email || "")) && (
                  <div className="usv-edit-actions">
                    <button type="submit" className="hv-btn hv-btn-primary" disabled={savingUser}>{savingUser && <span className="hv-spinner" aria-hidden="true" />}{savingUser ? "กำลังบันทึก..." : "บันทึก"}</button>
                  </div>
                )}
              </form>

              <section className="hv-section">
                <h3>การเข้าสู่ระบบ</h3>
                <div className="hv-controls">
                  {canResetActionUser && (
                    <button type="button" className="hv-btn" onClick={() => { setResetPasswordUser(actionUser); setNewPassword(""); setShowResetPassword(false); setResetPasswordError(""); }}>
                      <KeyRound size={15} aria-hidden="true" /> ตั้งรหัสผ่านใหม่
                    </button>
                  )}
                  <button type="button" className="hv-btn" onClick={() => confirmSignOut(actionUser)} disabled={actionUser.activeSessions === 0}>
                    <LogOut size={15} aria-hidden="true" /> ออกจากระบบทุกอุปกรณ์
                  </button>
                </div>
              </section>

              {canManageActionUser ? (
                <section className="hv-section">
                  <h3>สถานะบัญชี</h3>
                  <div className="hv-controls">
                    {actionUser.status !== "active" && (
                      <button type="button" className="hv-btn nx-ok" onClick={() => confirmStatus(actionUser, "active")}>
                        <CheckCircle2 size={15} aria-hidden="true" /> {actionUser.status === "banned" ? "ยกเลิกการแบน" : "เปิดใช้บัญชี"}
                      </button>
                    )}
                    {actionUser.status === "active" && (
                      <button type="button" className="hv-btn nx-warn" onClick={() => confirmStatus(actionUser, "suspended")}>
                        <PauseCircle size={15} aria-hidden="true" /> ระงับชั่วคราว
                      </button>
                    )}
                    {actionUser.status !== "banned" && (
                      <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => confirmStatus(actionUser, "banned")}>
                        <Ban size={15} aria-hidden="true" /> แบน
                      </button>
                    )}
                    <button type="button" className="hv-btn hv-btn-danger-ghost hv-push" onClick={() => confirmDelete(actionUser)}>
                      <Trash2 size={15} aria-hidden="true" /> ลบบัญชี
                    </button>
                  </div>
                </section>
              ) : (
                <p className="usv-note">
                  <ShieldCheck size={15} aria-hidden="true" />
                  {actionUser.username === me.username ? "เปลี่ยนสถานะบัญชีตัวเองไม่ได้" : "บัญชีแอดมิน ผู้ดูแลสูงสุดเท่านั้นที่เปลี่ยนสถานะได้"}
                </p>
              )}
            </div>
          </section>
        </div>,
        document.body,
      )}

      {creatingUser && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !createBusy && setCreatingUser(false)}>
          <section className="hv-dialog usv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="usv-create-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <UserPlus size={20} className="hv-dh-icon" aria-hidden="true" />
                <div className="hv-dh-text">
                  <h2 id="usv-create-title">เพิ่มผู้ใช้</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setCreatingUser(false)} disabled={createBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <form className="hv-form" onSubmit={createUser} noValidate autoComplete="off">
              <div className="hv-dialog-body">
                <div className="usv-edit-grid">
                  <div className="hv-field">
                    <label htmlFor="usv-new-username">ชื่อผู้ใช้ <span className="hv-req">*</span></label>
                    <input id="usv-new-username" autoFocus value={newUserForm.username} maxLength={30} autoComplete="off" {...latinAlphanumericInputProps()}
                      className={createErrors.username ? "is-invalid" : undefined} aria-invalid={Boolean(createErrors.username)}
                      onChange={(e) => { setNewUserForm({ ...newUserForm, username: filterLatinAlphanumeric(e.target.value).toLowerCase() }); if (createErrors.username) setCreateErrors((p) => ({ ...p, username: undefined })); }}
                      placeholder="เช่น somchai01" disabled={createBusy} />
                    {createErrors.username ? <small className="usv-error">{createErrors.username}</small> : <small>a–z และ 0–9 ยาว 4–30 ตัว</small>}
                  </div>
                  <div className="hv-field">
                    <label htmlFor="usv-new-display">ชื่อที่แสดง</label>
                    <input id="usv-new-display" value={newUserForm.displayName} maxLength={80} onChange={(e) => setNewUserForm({ ...newUserForm, displayName: e.target.value })} placeholder="ไม่ใส่ก็ได้" disabled={createBusy} />
                  </div>
                </div>
                <div className="hv-field">
                  <div className="hv-field-row">
                    <label htmlFor="usv-new-password">รหัสผ่าน <span className="hv-req">*</span></label>
                    <button type="button" className="hv-link-btn" onClick={() => { const p = generatePassword(); setNewUserForm({ ...newUserForm, password: p }); setShowNewPassword(true); setCreateErrors((e) => ({ ...e, password: undefined })); }} disabled={createBusy}>สุ่มรหัสผ่าน</button>
                  </div>
                  <div className={`usv-secret${createErrors.password ? " is-invalid" : ""}`}>
                    <input id="usv-new-password" type={showNewPassword ? "text" : "password"} value={newUserForm.password} autoComplete="new-password" {...asciiInputProps()}
                      aria-invalid={Boolean(createErrors.password)}
                      onChange={(e) => { setNewUserForm({ ...newUserForm, password: filterAsciiInput(e.target.value) }); if (createErrors.password) setCreateErrors((p) => ({ ...p, password: undefined })); }}
                      placeholder="อย่างน้อย 8 ตัว" disabled={createBusy} />
                    {newUserForm.password && <button type="button" onClick={() => void copyText(newUserForm.password, "รหัสผ่าน")} aria-label="คัดลอกรหัสผ่าน" title="คัดลอก"><Copy size={15} /></button>}
                    <button type="button" onClick={() => setShowNewPassword((v) => !v)} aria-label={showNewPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} title={showNewPassword ? "ซ่อน" : "แสดง"}>{showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  </div>
                  {createErrors.password && <small className="usv-error">{createErrors.password}</small>}
                </div>
                <div className="hv-field">
                  <label htmlFor="usv-new-email">อีเมล</label>
                  <input id="usv-new-email" type="email" value={newUserForm.email} maxLength={254}
                    className={createErrors.email ? "is-invalid" : undefined} aria-invalid={Boolean(createErrors.email)}
                    onChange={(e) => { setNewUserForm({ ...newUserForm, email: e.target.value }); if (createErrors.email) setCreateErrors((p) => ({ ...p, email: undefined })); }}
                    placeholder="ไม่ใส่ก็ได้" disabled={createBusy} />
                  {createErrors.email && <small className="usv-error">{createErrors.email}</small>}
                </div>
                {roleOptions.length > 1 && <fieldset className="hv-field">
                  <legend>สิทธิ์</legend>
                  <div className="usv-roles">
                    {roleOptions.map((option) => (
                      <label key={option.value} className={`hv-choice${newUserForm.role === option.value ? " is-selected" : ""}`}>
                        <input type="radio" name="usv-new-role" checked={newUserForm.role === option.value} onChange={() => setNewUserForm({ ...newUserForm, role: option.value })} disabled={createBusy} />
                        <span className="hv-choice-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
                      </label>
                    ))}
                  </div>
                </fieldset>}
              </div>
              <footer className="hv-dialog-foot">
                <button type="button" className="hv-btn" onClick={() => setCreatingUser(false)} disabled={createBusy}>ยกเลิก</button>
                <button type="submit" className="hv-btn hv-btn-primary" disabled={createBusy}>{createBusy && <span className="hv-spinner" aria-hidden="true" />}{createBusy ? "กำลังเพิ่ม..." : "เพิ่มผู้ใช้"}</button>
              </footer>
            </form>
          </section>
        </div>,
        document.body,
      )}

      {resetPasswordUser && createPortal(
        <div className="hv-backdrop is-top" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !resetPasswordBusy && setResetPasswordUser(null)}>
          <section className="hv-dialog usv-form-dialog is-narrow" role="dialog" aria-modal="true" aria-labelledby="usv-reset-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <KeyRound size={20} className="hv-dh-icon" aria-hidden="true" />
                <div className="hv-dh-text">
                  <small>@{resetPasswordUser.username}</small>
                  <h2 id="usv-reset-title">ตั้งรหัสผ่านใหม่</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setResetPasswordUser(null)} disabled={resetPasswordBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <form className="hv-form" onSubmit={resetPassword} noValidate>
              <div className="hv-dialog-body">
                <div className="hv-field">
                  <div className="hv-field-row">
                    <label htmlFor="usv-reset-password">รหัสผ่านใหม่</label>
                    <button type="button" className="hv-link-btn" onClick={() => { setNewPassword(generatePassword()); setShowResetPassword(true); setResetPasswordError(""); }} disabled={resetPasswordBusy}>สุ่มรหัสผ่าน</button>
                  </div>
                  <div className={`usv-secret${resetPasswordError ? " is-invalid" : ""}`}>
                    <input id="usv-reset-password" autoFocus type={showResetPassword ? "text" : "password"} value={newPassword} maxLength={128} autoComplete="new-password" {...asciiInputProps()}
                      aria-invalid={Boolean(resetPasswordError)}
                      onChange={(e) => { setNewPassword(filterAsciiInput(e.target.value)); if (resetPasswordError) setResetPasswordError(""); }}
                      placeholder="อย่างน้อย 8 ตัว" disabled={resetPasswordBusy} />
                    {newPassword && <button type="button" onClick={() => void copyText(newPassword, "รหัสผ่าน")} aria-label="คัดลอกรหัสผ่าน" title="คัดลอก"><Copy size={15} /></button>}
                    <button type="button" onClick={() => setShowResetPassword((v) => !v)} aria-label={showResetPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} title={showResetPassword ? "ซ่อน" : "แสดง"}>{showResetPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  </div>
                  {resetPasswordError ? <small className="usv-error">{resetPasswordError}</small> : <small>ตั้งแล้วผู้ใช้จะหลุดจากระบบทุกเครื่อง</small>}
                </div>
              </div>
              <footer className="hv-dialog-foot">
                <button type="button" className="hv-btn" onClick={() => setResetPasswordUser(null)} disabled={resetPasswordBusy}>ยกเลิก</button>
                <button type="submit" className="hv-btn hv-btn-primary" disabled={resetPasswordBusy}>{resetPasswordBusy && <span className="hv-spinner" aria-hidden="true" />}{resetPasswordBusy ? "กำลังบันทึก..." : "บันทึกรหัสผ่าน"}</button>
              </footer>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}


// Categories the API writes (backend audit calls), in the order the filter lists them.
const LOG_CATEGORIES = ["auth", "security", "admin", "hosting", "mail", "files", "store", "settings", "content", "profile", "discord", "workspace"];
const LOG_PAGE_SIZES = [10, 25, 50, 100];

function logIcon(log: Pick<LogItem, "action" | "category">, size = 16) {
  if (log.action.includes("database") || log.action.includes("phpmyadmin")) return <Database size={size} />;
  switch (log.category) {
    case "auth": return <KeyRound size={size} />;
    case "security": return <ShieldAlert size={size} />;
    case "admin": return <UserCog size={size} />;
    case "hosting": return <Server size={size} />;
    case "mail": return <Mail size={size} />;
    case "files": return <Folder size={size} />;
    case "store": return <Store size={size} />;
    case "settings": return <SlidersHorizontal size={size} />;
    case "content": return <Megaphone size={size} />;
    case "profile": return <User size={size} />;
    case "discord": return <Bot size={size} />;
    case "workspace": return <Code size={size} />;
    default: return <Activity size={size} />;
  }
}

// Why a sign-in or sign-up failed, in plain words.
const logReasonLabel: Record<string, string> = {
  invalid_credentials: "รหัสผ่านผิด",
  ip_locked_out: "IP นี้ใส่รหัสผิดเกินกำหนด ถูกพักชั่วคราว",
  bruteforce_limit_reached: "ใส่รหัสผิดถึงเกณฑ์ ถูกพักชั่วคราว",
  account_targeted: "บัญชีนี้ถูกลองรหัสผิดหลายครั้ง",
  account_suspended: "บัญชีถูกระงับ",
  ip_blacklisted: "IP นี้ถูกแบน",
  registration_disabled: "ปิดรับสมัครอยู่",
  account_exists: "ชื่อผู้ใช้นี้มีคนใช้แล้ว",
  // Why a voice room was deleted.
  owner: "เจ้าของห้องลบเอง",
  empty: "ห้องว่างนานเกินเวลาที่ตั้งไว้",
  missing: "ห้องถูกลบใน Discord",
  admin: "แอดมินสั่งลบจากเว็บ",
};

const discordBotNames: Record<string, string> = { nexora: "บอท NEXORA", mail: "บอทเมล", voice: "บอทห้องเสียง" };

// Readable details for Discord bot events: names instead of ids where the bot sent them.
function discordLogFacts(log: LogItem, meta: Record<string, unknown> | null): [string, string][] {
  if (!meta || !log.action.startsWith("discord.")) return [];
  const text = (key: string) => (typeof meta[key] === "string" ? String(meta[key]) : "");
  const who = (name: string, id: string) => (name ? `@${name}` : id ? `Discord ${id}` : "");
  const facts: [string, string][] = [];
  if (log.targetType === "voice_room" && text("name")) facts.push(["ห้อง", text("name")]);
  if (log.targetType === "discord_bot") facts.push(["บอท", discordBotNames[log.targetId] || log.targetId]);
  if (text("botUsername")) facts.push(["ชื่อบอทใน Discord", text("botUsername")]);
  if (text("kind")) facts.push(["สร้างจาก", text("kind") === "join" ? "Join to Create" : "คำสั่ง /room"]);
  if (log.action.startsWith("discord.protect.") && log.action !== "discord.protect.settings_updated") {
    if (text("guildName")) facts.push(["เซิร์ฟเวอร์", text("guildName")]);
    const person = who(text("userName"), text("userId"));
    if (person) facts.push([log.action === "discord.protect.channel_restored" ? "คนที่ลบ" : "คนที่ทำ", person]);
    if (text("detail")) facts.push(["รายละเอียด", text("detail")]);
    if (meta.times !== undefined) facts.push(["จำนวนครั้ง", `${meta.times} ครั้งในช่วงสั้นๆ`]);
    if (log.action === "discord.protect.channel_restored") facts.push(["สร้างคืน", meta.restored ? "สร้างคืนแล้ว" : "สร้างคืนไม่ได้"]);
  }
  if (log.action === "discord.voice.place_deleted") {
    facts.push(["คนที่ลบ", who(text("deleterName"), text("deleterId")) || "ไม่ทราบ (บอทไม่มีสิทธิ์ดูบันทึกการตรวจสอบ)"]);
    facts.push(["สร้างคืน", meta.recreated ? "สร้างคืนแล้ว" : "สร้างคืนไม่ได้"]);
  }
  if (text("place")) facts.push(["ใช้เป็น", ({ hub: "ห้องคลิกเพื่อสร้างห้อง", panel: "แผงปุ่ม", log: "ห้อง log", voicelog: "ห้องประวัติเข้าออก", category: "หมวดที่เก็บห้อง" } as Record<string, string>)[text("place")] || text("place")]);
  const member = who(text("memberName"), text("memberId"));
  if (member) facts.push([log.action === "discord.voice.entry_denied" ? "คนที่ถูกให้ออก" : "คนที่ถูกเตะ", member]);
  if (text("to")) facts.push(["โอนจาก → ให้", `${who(text("fromName"), text("from"))} → ${who(text("toName"), text("to"))}`]);
  if (meta.failures !== undefined) facts.push(["ใส่ผิด", `${meta.failures} ครั้ง · ห้ามลอง ${meta.lockoutMinutes} นาที`]);
  if (meta.revoked !== undefined) facts.push(["ต้องใส่รหัสใหม่", `${meta.revoked} คน`]);
  if (text("newName")) facts.push(["ชื่อใหม่", text("newName")]);
  if (meta.userLimit !== undefined) facts.push(["จำนวนคนสูงสุด", Number(meta.userLimit) ? `${meta.userLimit} คน` : "ไม่จำกัด"]);
  if (log.action === "discord.voice.room_deleted" && text("ownerName")) facts.push(["เจ้าของห้อง", `@${text("ownerName")}`]);
  return facts;
}

function logMeta(log: LogItem): Record<string, unknown> | null {
  let meta = log.metadata;
  if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch { return null; } }
  return meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : null;
}

function logDayLabel(value: string) {
  const day = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return "วันนี้";
  if (day.toDateString() === yesterday.toDateString()) return "เมื่อวาน";
  return new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(day);
}

// Who did it: an account, a Discord member acting through a bot, someone not signed in (a request
// with an IP or browser), or the system itself.
function logActor(log: LogItem) {
  if (log.actorUsername) return `@${log.actorUsername}`;
  if (log.action.startsWith("discord.")) {
    const meta = logMeta(log);
    if (typeof meta?.actorName === "string" && meta.actorName) return `@${meta.actorName} (Discord)`;
    if (typeof meta?.discordActor === "string" && meta.discordActor) return `Discord ${meta.discordActor}`;
    return "บอท Discord";
  }
  return log.ipAddress || log.userAgent ? "ไม่ได้เข้าสู่ระบบ" : "ระบบ";
}

// The API stores a readable device ("Chrome บน Windows"); older entries only have the raw user agent.
function logDevice(log: LogItem, meta: Record<string, unknown> | null) {
  if (typeof meta?.device === "string" && meta.device) return meta.device;
  if (!log.userAgent) return "";
  const parsed = parseUserAgent(log.userAgent);
  return parsed.browser === "Unknown Browser" ? "" : `${parsed.browser} บน ${parsed.os}`;
}

const logTime = (value: string) => new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));

// A date field that looks like the other filter controls: the native date input sits on top,
// invisible, so a tap or click still opens the system date picker.
function DateField({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (value: string) => void }) {
  const text = value ? new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "ทุกวัน";
  return (
    <div className={`lgv-date${value ? " has-value" : ""}`}>
      <span className="lgv-date-label">{label}</span>
      <div className="lgv-date-box">
        <Calendar size={16} aria-hidden="true" />
        <span className="lgv-date-text">{text}</span>
        <input
          type="date"
          className="lgv-date-native"
          value={value}
          min={min || undefined}
          max={max || undefined}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* the browser opens its own picker */ } }}
          aria-label={label}
        />
        {value && <button type="button" className="lgv-date-clear" onClick={() => onChange("")} aria-label={`ล้าง${label}`}><X size={14} /></button>}
      </div>
    </div>
  );
}

function initialLogFilters() {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const pick = (value: string | null, allowed: string[]) => (value && allowed.includes(value) ? value : "");
  const date = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");
  const perPage = Number(params.get("per"));
  return {
    q: (params.get("q") || "").slice(0, 80),
    category: pick(params.get("category"), LOG_CATEGORIES),
    outcome: pick(params.get("outcome"), ["success", "failure"]),
    action: pick(params.get("action"), Object.keys(actionLabel)),
    dateFrom: date(params.get("from")),
    dateTo: date(params.get("to")),
    perPage: LOG_PAGE_SIZES.includes(perPage) ? perPage : LOG_PAGE_SIZES[0],
    page: Math.max(1, Math.floor(Number(params.get("page"))) || 1),
  };
}

function LogsView() {
  const [initial] = useState(initialLogFilters);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState(initial.q);
  const [category, setCategory] = useState(initial.category);
  const [outcome, setOutcome] = useState(initial.outcome);
  const [action, setAction] = useState(initial.action);
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [perPage, setPerPage] = useState(initial.perPage);
  const [page, setPage] = useState(initial.page);
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const requestRef = useRef(0);
  const listRef = useRef<HTMLElement>(null);
  const search = q.trim();

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    const params = new URLSearchParams({ q: search, category, outcome, action, dateFrom, dateTo, limit: String(perPage), page: String(page) });
    try {
      const result = await api<{ items: LogItem[]; total: number }>(`/api/admin/logs?${params}`);
      if (request !== requestRef.current) return;
      const count = Number(result.total) || 0; // an older API without totals counts as empty, not a crash
      const lastPage = Math.max(1, Math.ceil(count / perPage));
      if (!result.items.length && count > 0 && page > lastPage) { setPage(lastPage); return; }
      setLogs(result.items);
      setTotal(count);
      setFailed(false);
    } catch {
      if (request === requestRef.current) setFailed(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [search, category, outcome, action, dateFrom, dateTo, perPage, page]);

  // Typing waits a moment before searching; everything else loads at once.
  const typedRef = useRef(search);
  useEffect(() => {
    const typed = typedRef.current !== search;
    typedRef.current = search;
    const timer = window.setTimeout(() => void load(), typed ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (category) params.set("category", category);
    if (outcome) params.set("outcome", outcome);
    if (action) params.set("action", action);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (perPage !== LOG_PAGE_SIZES[0]) params.set("per", String(perPage));
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [search, category, outcome, action, dateFrom, dateTo, perPage, page]);

  useScrollLock(Boolean(selectedLog));
  useEscape(Boolean(selectedLog), () => setSelectedLog(null));

  const pages = Math.max(1, Math.ceil(total / perPage));
  const hasFilters = Boolean(search || category || outcome || action || dateFrom || dateTo);
  function clearFilters() { setQ(""); setCategory(""); setOutcome(""); setAction(""); setDateFrom(""); setDateTo(""); setPage(1); }
  function goToPage(next: number) {
    setPage(Math.min(Math.max(1, next), pages));
    const top = listRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function searchFor(value: string) { setSelectedLog(null); setQ(value); setPage(1); }

  // Day headings between rows: the list is newest first, so a heading starts each new day.
  const dayHeadings = logs.map((log, index) => {
    const day = logDayLabel(log.createdAt);
    return index === 0 || day !== logDayLabel(logs[index - 1].createdAt) ? day : "";
  });

  const meta = selectedLog ? logMeta(selectedLog) : null;
  const geo = meta?.geo as { city?: string; country?: string; isp?: string } | undefined;
  const device = selectedLog ? logDevice(selectedLog, meta) : "";
  const localNetwork = geo?.country === "เครือข่ายภายใน";
  const reason = meta?.reason ? logReasonLabel[String(meta.reason)] || String(meta.reason) : "";
  const attempts = Number(meta?.attempt_count) || 0;

  return (
    <div className="aov hv lgv" aria-busy={loading}>
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">บันทึกระบบ</p>
          <h1>บันทึกกิจกรรม</h1>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn" onClick={() => void load()} disabled={loading} aria-label="รีเฟรช" title="รีเฟรช">
            <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>

      <section className="aov-panel" ref={listRef}>
        <div className="th-filters">
          <label className="th-search" role="search">
            <Search size={17} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); setQ(""); setPage(1); } }}
              placeholder="ค้นหาชื่อผู้ใช้ กิจกรรม หรือ IP"
              aria-label="ค้นหาบันทึก"
            />
            {q && <button type="button" onClick={() => { setQ(""); setPage(1); }} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
          </label>
          <div className="th-chips" role="group" aria-label="ผล">
            {[["", "ทั้งหมด"], ["success", "สำเร็จ"], ["failure", "ไม่สำเร็จ"]].map(([value, label]) => (
              <button type="button" key={value || "all"} className={outcome === value ? "is-active" : ""} aria-pressed={outcome === value} onClick={() => { setOutcome(value); setPage(1); }}>{label}</button>
            ))}
          </div>
        </div>
        <div className="th-filters lgv-filters">
          <select className="hv-select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="หมวด">
            <option value="">ทุกหมวด</option>
            {LOG_CATEGORIES.map((value) => <option key={value} value={value}>{categoryLabel[value] || value}</option>)}
          </select>
          <select className="hv-select" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="กิจกรรม">
            <option value="">ทุกกิจกรรม</option>
            {Object.entries(actionLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <div className="lgv-dates">
            <DateField label="ตั้งแต่" value={dateFrom} max={dateTo} onChange={(value) => { setDateFrom(value); setPage(1); }} />
            <DateField label="ถึง" value={dateTo} min={dateFrom} onChange={(value) => { setDateTo(value); setPage(1); }} />
          </div>
        </div>
        <div className="th-meta" aria-live="polite">
          <span>{loading && !logs.length ? "กำลังโหลด..." : total === 0 ? "ไม่พบบันทึก" : `${hasFilters ? "พบ " : ""}${total.toLocaleString("th-TH")} รายการ`}</span>
          {hasFilters && <button type="button" onClick={clearFilters}>ล้างตัวกรอง</button>}
        </div>

        {failed && !logs.length ? (
          <div className="aov-empty hv-empty">
            <span>โหลดบันทึกไม่ได้</span>
            <button type="button" onClick={() => void load()}>ลองอีกครั้ง</button>
          </div>
        ) : loading && !logs.length ? (
          <ul className="hv-list" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <li className="hv-row is-skeleton" key={i}><span /><span /><span /></li>)}</ul>
        ) : logs.length ? (
          <ul className={`hv-list${loading ? " usv-refreshing" : ""}`}>
            <li className="hv-row lgv-row hv-row-head" aria-hidden="true">
              <span>กิจกรรม</span><span>ผู้ทำ</span><span>ผล</span><span>IP</span><span>เวลา</span>
            </li>
            {logs.map((log, index) => {
              const heading = dayHeadings[index];
              const target = log.targetType ? formatLogTarget(log) : "";
              return (
                <Fragment key={log.id}>
                  {heading && <li className="lgv-day" aria-hidden="true">{heading}</li>}
                  <li>
                    <button type="button" className={`hv-row lgv-row${log.outcome === "success" ? "" : " is-failed"}`} onClick={() => setSelectedLog(log)}>
                      <span className="hv-site">
                        <span className={`lgv-icon is-${log.category || "system"}`} aria-hidden="true">{logIcon(log)}</span>
                        <span className="hv-site-copy">
                          <strong className="lgv-title">{actionText(log.action)}</strong>
                          <small className="hv-site-domain">{categoryLabel[log.category] || log.category}{target ? ` · ${target}` : ""}</small>
                          <small className="hv-site-meta">{logActor(log)} · {logTime(log.createdAt)}{log.ipAddress ? ` · ${log.ipAddress}` : ""}</small>
                        </span>
                      </span>
                      <span className="hv-cell lgv-actor">
                        <strong>{log.actorUsername || logActor(log)}</strong>
                        {log.actorRole && <small>{roleLabel[log.actorRole as Role] || log.actorRole}</small>}
                      </span>
                      <span className={`hv-status ${log.outcome === "success" ? "is-running" : "is-error"}`}>{log.outcome === "success" ? "สำเร็จ" : "ไม่สำเร็จ"}</span>
                      <span className="hv-cell lgv-ip">{log.ipAddress || <span className="usv-none">—</span>}</span>
                      <span className="hv-cell lgv-time">{logTime(log.createdAt)}</span>
                    </button>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        ) : (
          <div className="aov-empty hv-empty">
            <span>{hasFilters ? "ไม่พบบันทึกที่ตรงกับตัวกรอง" : "ยังไม่มีบันทึก"}</span>
            {hasFilters && <button type="button" onClick={clearFilters}>ล้างตัวกรอง</button>}
          </div>
        )}
        {total > 0 && (
          <footer className="nx-listfoot">
            <span>{((page - 1) * perPage + 1).toLocaleString("th-TH")}–{Math.min(total, page * perPage).toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")}</span>
            <label className="nx-perpage">
              หน้าละ
              <select className="nx-inline-select" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
                {LOG_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <Pager page={page} pages={pages} onPage={goToPage} busy={loading} label="หน้าบันทึก" />
          </footer>
        )}
      </section>

      {selectedLog && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setSelectedLog(null)}>
          <section className="hv-dialog lgv-dialog" role="dialog" aria-modal="true" aria-labelledby="lgv-detail-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <span className={`lgv-icon is-lg is-${selectedLog.category || "system"}`} aria-hidden="true">{logIcon(selectedLog, 20)}</span>
                <div className="hv-dh-text">
                  <small>{categoryLabel[selectedLog.category] || selectedLog.category} · {formatDate(selectedLog.createdAt)}</small>
                  <h2 id="lgv-detail-title">{actionText(selectedLog.action)}</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setSelectedLog(null)} aria-label="ปิด"><X size={18} /></button>
            </header>
            <div className="hv-dialog-body">
              {(reason || selectedLog.outcome !== "success") && (
                <p className={`lgv-reason${selectedLog.outcome === "success" ? "" : " is-failed"}`}>
                  {selectedLog.outcome === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
                  <span>{reason || "ไม่สำเร็จ"}{attempts > 0 ? ` · ผิดครั้งที่ ${attempts.toLocaleString("th-TH")}` : ""}</span>
                </p>
              )}
              <ul className="usv-facts">
                <li><span>ผล</span><b className={`hv-status ${selectedLog.outcome === "success" ? "is-running" : "is-error"}`}>{selectedLog.outcome === "success" ? "สำเร็จ" : "ไม่สำเร็จ"}</b></li>
                <li><span>ผู้ทำ</span><b>{logActor(selectedLog)}{selectedLog.actorRole ? ` · ${roleLabel[selectedLog.actorRole as Role] || selectedLog.actorRole}` : ""}</b></li>
                {selectedLog.targetType && <li><span>เป้าหมาย</span><b title={formatLogTarget(selectedLog)}>{formatLogTarget(selectedLog)}</b></li>}
                <li><span>IP</span><b>{selectedLog.ipAddress || "—"}</b></li>
                {geo && (geo.isp || geo.country) && <li><span>เครือข่าย</span><b title={[geo.isp, geo.country].filter(Boolean).join(" · ")}>{[geo.isp, geo.country].filter(Boolean).join(" · ")}</b></li>}
                {device && <li><span>อุปกรณ์</span><b title={device}>{device}</b></li>}
                {discordLogFacts(selectedLog, meta).map(([label, value]) => <li key={label}><span>{label}</span><b title={value}>{value}</b></li>)}
              </ul>
              {geo?.city && !localNetwork && <p className="lgv-note">พื้นที่ที่จด IP: {geo.city} (ไม่ใช่ตำแหน่งจริงของผู้ใช้)</p>}
              <div className="lgv-jump">
                {selectedLog.actorUsername && <button type="button" className="hv-btn" onClick={() => searchFor(selectedLog.actorUsername)}><User size={15} aria-hidden="true" /> ดูทั้งหมดของ @{selectedLog.actorUsername}</button>}
                {selectedLog.ipAddress && <button type="button" className="hv-btn" onClick={() => searchFor(selectedLog.ipAddress)}><Globe size={15} aria-hidden="true" /> ดูทั้งหมดจาก IP นี้</button>}
              </div>
              <details className="lgv-raw">
                <summary>ข้อมูลดิบ</summary>
                <dl>
                  <dt>action</dt><dd>{selectedLog.action}</dd>
                  {selectedLog.userAgent && <><dt>user agent</dt><dd>{selectedLog.userAgent}</dd></>}
                </dl>
                {meta && Object.keys(meta).length > 0 && <pre>{JSON.stringify(meta, null, 2)}</pre>}
              </details>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}

// What each role can actually do, matching the role checks on the API routes.
const ACCESS_ROWS: { label: string; roles: Role[] }[] = [
  { label: "ใช้เว็บไซต์ ฐานข้อมูล อีเมล และไฟล์ของตัวเอง", roles: ["user", "admin", "superadmin"] },
  { label: "เติมเงินและซื้อสินค้า", roles: ["user", "admin", "superadmin"] },
  { label: "เข้าหน้าผู้ดูแล", roles: ["admin", "superadmin"] },
  { label: "ดูแลผู้ใช้ทั่วไป: เพิ่ม ระงับ แบน ตั้งรหัสใหม่ ลบ", roles: ["admin", "superadmin"] },
  { label: "จัดการเว็บไซต์และฐานข้อมูลของทุกคน", roles: ["admin", "superadmin"] },
  { label: "ไฟล์ ประกาศ ร้านค้า คำสั่งซื้อ และการคืนเงิน", roles: ["admin", "superadmin"] },
  { label: "ดูรายการเติมเงิน และแบน IP", roles: ["admin", "superadmin"] },
  { label: "ดูแลบัญชีแอดมินคนอื่น", roles: ["superadmin"] },
  { label: "ตั้งค่าระบบ การแจ้งเตือน เมลเซิร์ฟเวอร์ และการเติมเงิน", roles: ["superadmin"] },
  { label: "ดูบันทึกระบบ และปิดระบบชั่วคราว", roles: ["superadmin"] },
  { label: "เปลี่ยนระดับของบัญชี (หน้านี้)", roles: ["superadmin"] },
];
const ACCESS_ROLES: Role[] = ["user", "admin", "superadmin"];
const roleShort: Record<Role, string> = { user: "ทั่วไป", admin: "แอดมิน", superadmin: "สูงสุด" };
const ACCESS_PAGE = 10;

// True on phone widths, where the role select uses the short names so they fit in a card.
const narrowQuery = "(max-width: 760px)";
function useNarrowScreen() {
  return useSyncExternalStore(
    (onChange) => { const mq = window.matchMedia(narrowQuery); mq.addEventListener("change", onChange); return () => mq.removeEventListener("change", onChange); },
    () => window.matchMedia(narrowQuery).matches,
    () => false,
  );
}

function initialAccessFilters() {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const role = params.get("role") || "";
  return {
    q: (params.get("q") || "").slice(0, 80),
    role: (ACCESS_ROLES as string[]).includes(role) ? role : "",
    page: Math.max(1, Math.floor(Number(params.get("page"))) || 1),
  };
}

function AccessView({ me, notify, ask }: { me: AuthUser; notify: (notice: { kind: "success" | "error"; text: string }) => void; ask: (request: ConfirmRequest) => void }) {
  const [initial] = useState(initialAccessFilters);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<Role, number> | null>(null);
  const [q, setQ] = useState(initial.q);
  const [role, setRole] = useState(initial.role);
  const [page, setPage] = useState(initial.page);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const requestRef = useRef(0);
  const listRef = useRef<HTMLElement>(null);
  const narrow = useNarrowScreen();
  const search = q.trim();

  const loadCounts = useCallback(async () => {
    const totals = await Promise.all(ACCESS_ROLES.map((r) => api<{ total: number }>(`/api/admin/users?page=1&limit=1&role=${r}`).then((x) => x.total)));
    setCounts({ user: totals[0], admin: totals[1], superadmin: totals[2] });
  }, []);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const list = await api<{ items: ManagedUser[]; total: number }>(`/api/admin/users?q=${encodeURIComponent(search)}&role=${role}&sort=name&limit=${ACCESS_PAGE}&page=${page}`);
      if (request !== requestRef.current) return;
      const count = Number(list.total) || 0; // an older API without totals counts as empty, not a crash
      const lastPage = Math.max(1, Math.ceil(count / ACCESS_PAGE));
      if (!list.items.length && count > 0 && page > lastPage) { setPage(lastPage); return; }
      setUsers(list.items);
      setTotal(count);
      setFailed(false);
    } catch (error) {
      if (request !== requestRef.current) return;
      setFailed(true);
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [search, role, page, notify]);

  // Typing waits a moment before searching; paging and the role chips load at once.
  const typedRef = useRef(search);
  useEffect(() => {
    const typed = typedRef.current !== search;
    typedRef.current = search;
    const timer = window.setTimeout(() => void load(), typed ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);
  useEffect(() => {
    const timer = window.setTimeout(() => { loadCounts().catch(() => undefined); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCounts]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (role) params.set("role", role);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [search, role, page]);

  const pages = Math.max(1, Math.ceil(total / ACCESS_PAGE));
  const hasFilters = Boolean(search || role);
  function clearFilters() { setQ(""); setRole(""); setPage(1); }
  function goToPage(next: number) {
    setPage(Math.min(Math.max(1, next), pages));
    const top = listRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function confirmRole(user: ManagedUser, next: Role) {
    if (next === user.role) return;
    const name = `@${user.username}`;
    const effect = {
      user: `${name} จะเข้าหน้าผู้ดูแลไม่ได้อีก ใช้ได้แค่บริการของตัวเอง`,
      admin: user.role === "superadmin"
        ? `${name} จะตั้งค่าระบบ ดูบันทึก และเปลี่ยนระดับคนอื่นไม่ได้อีก แต่ยังดูแลผู้ใช้ทั่วไปได้`
        : `${name} จะดูแลผู้ใช้ทั่วไป เว็บไซต์ ฐานข้อมูล ไฟล์ และร้านค้าได้`,
      superadmin: `${name} จะทำได้ทุกอย่าง รวมถึงตั้งค่าระบบและเปลี่ยนระดับคนอื่น`,
    }[next];
    ask({
      title: `เปลี่ยน ${name} เป็น${roleLabel[next]}?`,
      message: `${effect} และต้องเข้าสู่ระบบใหม่ทุกเครื่อง`,
      confirmLabel: "เปลี่ยนระดับ",
      danger: next === "superadmin",
      action: async () => {
        setBusyId(user.id);
        try {
          await api(`/api/admin/access/${user.id}/role`, { method: "PATCH", body: JSON.stringify({ role: next }) });
          notify({ kind: "success", text: `${name} เป็น${roleLabel[next]}แล้ว` });
          await Promise.all([load(), loadCounts().catch(() => undefined)]);
        } catch (error) {
          notify({ kind: "error", text: (error as Error).message });
        } finally {
          setBusyId(null);
        }
      },
    });
  }

  return (
    <div className="aov hv acv" aria-busy={loading}>
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">ผู้ใช้และสิทธิ์</p>
          <h1>สิทธิ์การเข้าถึง</h1>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn" onClick={() => { void load(); loadCounts().catch(() => undefined); }} disabled={loading} aria-label="รีเฟรช" title="รีเฟรช">
            <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
          </button>
        </div>
      </header>

      <section className="aov-panel" aria-labelledby="acv-matrix-title">
        <div className="acv-panel-head">
          <h2 id="acv-matrix-title">แต่ละระดับทำอะไรได้</h2>
        </div>
        <div className="acv-matrix" role="table" aria-label="สิทธิ์ของแต่ละระดับ">
          <div className="acv-mrow acv-mhead" role="row">
            <span role="columnheader" className="acv-mlabel">สิทธิ์</span>
            {ACCESS_ROLES.map((r) => (
              <span role="columnheader" key={r} className={`acv-mrole is-${r}`}>
                <strong><span className="acv-long">{roleLabel[r]}</span><span className="acv-short">{roleShort[r]}</span></strong>
                <small>{counts ? `${counts[r].toLocaleString("th-TH")} บัญชี` : " "}</small>
              </span>
            ))}
          </div>
          {ACCESS_ROWS.map((row) => (
            <div className="acv-mrow" role="row" key={row.label}>
              <span role="rowheader" className="acv-mlabel">{row.label}</span>
              {ACCESS_ROLES.map((r) => {
                const yes = row.roles.includes(r);
                return (
                  <span role="cell" key={r} className={`acv-mcell${yes ? " is-yes" : ""}`} aria-label={yes ? "ได้" : "ไม่ได้"}>
                    {yes ? <Check size={16} strokeWidth={2.5} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="aov-panel" ref={listRef} aria-labelledby="acv-list-title">
        <div className="acv-panel-head">
          <h2 id="acv-list-title">เปลี่ยนระดับบัญชี</h2>
          <p>เปลี่ยนแล้วบัญชีนั้นต้องเข้าสู่ระบบใหม่ทุกเครื่อง</p>
        </div>
        <div className="th-filters">
          <label className="th-search" role="search">
            <Search size={17} aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); e.stopPropagation(); setQ(""); setPage(1); } }}
              placeholder="ค้นหาชื่อ ชื่อผู้ใช้ หรืออีเมล"
              aria-label="ค้นหาบัญชี"
            />
            {q && <button type="button" onClick={() => { setQ(""); setPage(1); }} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
          </label>
          <div className="th-chips" role="group" aria-label="ระดับ">
            {[["", "ทั้งหมด"], ...ACCESS_ROLES.map((r) => [r, roleShort[r]])].map(([value, label]) => (
              <button type="button" key={value || "all"} className={role === value ? "is-active" : ""} aria-pressed={role === value} onClick={() => { setRole(value); setPage(1); }}>{label}</button>
            ))}
          </div>
        </div>
        <div className="th-meta" aria-live="polite">
          <span>{loading && !users.length ? "กำลังโหลด..." : total === 0 ? "ไม่พบบัญชี" : `${hasFilters ? "พบ " : ""}${total.toLocaleString("th-TH")} บัญชี`}</span>
          {hasFilters && <button type="button" onClick={clearFilters}>ล้างตัวกรอง</button>}
        </div>

        {failed && !users.length ? (
          <div className="aov-empty hv-empty">
            <span>โหลดรายชื่อไม่ได้</span>
            <button type="button" onClick={() => void load()}>ลองอีกครั้ง</button>
          </div>
        ) : loading && !users.length ? (
          <ul className="hv-list" aria-hidden="true">{[0, 1, 2, 3].map((i) => <li className="hv-row is-skeleton" key={i}><span /><span /><span /></li>)}</ul>
        ) : users.length ? (
          <ul className={`hv-list${loading ? " usv-refreshing" : ""}`}>
            <li className="hv-row acv-row hv-row-head" aria-hidden="true">
              <span>บัญชี</span><span>สถานะ</span><span>เข้าใช้ล่าสุด</span><span>ระดับ</span>
            </li>
            {users.map((user) => {
              const self = user.username === me.username;
              const busy = busyId === user.id;
              return (
                <li className={`hv-row acv-row${busy ? " is-busy" : ""}`} key={user.id}>
                  <div className="hv-site">
                    <UserAvatar user={user} />
                    <div className="hv-site-copy">
                      <span className="hv-site-name acv-name">{user.displayName || user.username}{self && <span className="usv-you">คุณ</span>}</span>
                      <small className="hv-site-domain">@{user.username}{user.email ? ` · ${user.email}` : ""}</small>
                    </div>
                  </div>
                  <span className={`hv-status ${userStatusTone[user.status] || ""}`}>{statusLabel[user.status] || user.status}</span>
                  <span className="hv-cell usv-when">{user.lastLoginAt ? formatDate(user.lastLoginAt) : <span className="usv-none">ยังไม่เคยเข้า</span>}</span>
                  <div className="hv-row-actions acv-role">
                    {self ? (
                      <span className="acv-self" title="เปลี่ยนระดับบัญชีตัวเองไม่ได้"><span className={`usv-role is-${user.role}`}>{roleLabel[user.role]}</span></span>
                    ) : (
                      <>
                        {busy && <span className="hv-spinner" aria-hidden="true" />}
                        <select
                          className={`hv-select acv-select is-${user.role}`}
                          value={user.role}
                          onChange={(e) => confirmRole(user, e.target.value as Role)}
                          disabled={busy}
                          aria-label={`ระดับของ @${user.username}`}
                        >
                          {ACCESS_ROLES.map((r) => <option key={r} value={r}>{narrow ? roleShort[r] : roleLabel[r]}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="aov-empty hv-empty">
            <span>{hasFilters ? "ไม่พบบัญชีที่ตรงกับตัวกรอง" : "ยังไม่มีบัญชี"}</span>
            {hasFilters && <button type="button" onClick={clearFilters}>ล้างตัวกรอง</button>}
          </div>
        )}
        {total > ACCESS_PAGE && (
          <footer className="nx-listfoot">
            <span>{((page - 1) * ACCESS_PAGE + 1).toLocaleString("th-TH")}–{Math.min(total, page * ACCESS_PAGE).toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")}</span>
            <Pager page={page} pages={pages} onPage={goToPage} busy={loading} label="หน้ารายชื่อบัญชี" />
          </footer>
        )}
      </section>
    </div>
  );
}

type AnnouncementForm = Omit<Announcement, "id" | "createdAt" | "updatedAt" | "startsAt" | "endsAt"> & { startsAt: string; endsAt: string };
const emptyAnnouncement: AnnouncementForm = {
  title: "", message: "", imageUrl: "", customColor: "", kind: "banner", placement: "homepage",
  severity: "info", buttonLabel: "", buttonUrl: "", active: true, startsAt: "", endsAt: "", meta: {},
};

const MARQUEE_PALETTE_KEY = "nexora-marquee-palette";
const DEFAULT_MARQUEE_PALETTE = {
  iconColor: "#16a34a",
  textColor: "#f4f5f7",
  borderColor: "#ff1018",
  backgroundColor: "#12141d",
  borderColorEnabled: true,
  backgroundColorEnabled: true,
};

function loadMarqueePalette(): Record<string, string | boolean> {
  if (typeof window === "undefined") return { ...DEFAULT_MARQUEE_PALETTE };
  try {
    const saved = JSON.parse(window.localStorage.getItem(MARQUEE_PALETTE_KEY) || "{}");
    return { ...DEFAULT_MARQUEE_PALETTE, ...saved };
  } catch {
    return { ...DEFAULT_MARQUEE_PALETTE };
  }
}

function hasRememberedMarqueePalette() {
  return typeof window !== "undefined" && window.localStorage.getItem(MARQUEE_PALETTE_KEY) !== null;
}

function rememberMarqueePalette(meta: MarqueeMeta) {
  if (typeof window === "undefined") return;
  const current = loadMarqueePalette();
  const next = { ...current };
  // Only the palette is remembered: colours (strings) and the two on/off switches.
  for (const key of Object.keys(DEFAULT_MARQUEE_PALETTE)) {
    if (meta[key] !== undefined) next[key] = meta[key] as string | boolean;
  }
  window.localStorage.setItem(MARQUEE_PALETTE_KEY, JSON.stringify(next));
}

function localDateInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatThaiFullDate(isoString?: string) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date) + " น.";
}

function formatThaiDateTimeInput(value?: string) {
  if (!value) return "";
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return "";
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year + 543} ${timePart.slice(0, 5)} น.`;
}

const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const THAI_DAYS_SHORT = ["อา","จ","อ","พ","พฤ","ศ","ส"];

function ThaiDateTimePicker({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const parsed = value ? new Date(value) : null;
  const today = new Date();

  const [viewYear, setViewYear] = useState(parsed ? parsed.getFullYear() : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed ? parsed.getMonth() : today.getMonth());
  const [hour, setHour] = useState(parsed ? parsed.getHours() : 0);
  const [minute, setMinute] = useState(parsed ? parsed.getMinutes() : 0);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
  }
  function getFirstDayOfMonth(year: number, month: number) {
    return new Date(year, month, 1).getDay();
  }

  function selectDay(day: number) {
    const d = new Date(viewYear, viewMonth, day, hour, minute);
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
    onChange(iso);
    setOpen(false);
  }

  function updateTime(h: number, m: number) {
    setHour(h); setMinute(m);
    if (!value) return;
    const d = parsed || new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    onChange(iso);
  }

  function clear() { onChange(""); setOpen(false); }
  function goToday() {
    const now = new Date();
    setViewYear(now.getFullYear()); setViewMonth(now.getMonth());
    const iso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
    onChange(iso); setOpen(false);
  }

  const days = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const selectedDay = parsed ? parsed.getDate() : null;
  const isCurrentMonth = parsed && parsed.getFullYear() === viewYear && parsed.getMonth() === viewMonth;
  const todayDay = today.getDate();
  const isViewingCurrentMonth = today.getFullYear() === viewYear && today.getMonth() === viewMonth;

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({length: days}, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="th-dtp-wrap" ref={ref}>
      <button type="button" className="premium-input th-dtp-trigger" onClick={() => setOpen(v => !v)} aria-label={label}>
        <span className={value ? "" : "placeholder"}>
          {formatThaiDateTimeInput(value) || label}
        </span>
        <Calendar size={16} aria-hidden="true" />
      </button>

      {open && (
        <div className="th-dtp-popup">
          {/* Month Nav */}
          <div className="th-dtp-nav">
            <button type="button" disabled={viewYear === today.getFullYear() && viewMonth === today.getMonth()} onClick={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); } else setViewMonth(m => m-1); }}>
              <ChevronLeft size={16} />
            </button>
            <span className="th-dtp-month-label">
              {THAI_MONTHS[viewMonth]} {viewYear + 543}
            </span>
            <button type="button" onClick={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); } else setViewMonth(m => m+1); }}>
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day Headers */}
          <div className="th-dtp-grid">
            {THAI_DAYS_SHORT.map(d => <div key={d} className="th-dtp-day-head">{d}</div>)}
            {cells.map((day, i) => {
              const isPast = day ? new Date(viewYear, viewMonth, day + 1) < new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1) : false;
              return (
              <button
                key={i} type="button"
                className={`th-dtp-cell ${!day ? "empty" : ""} ${isPast ? "past" : ""} ${day && isCurrentMonth && day === selectedDay ? "selected" : ""} ${day && isViewingCurrentMonth && day === todayDay ? "today" : ""}`}
                disabled={!day || isPast}
                onClick={() => day && !isPast && selectDay(day)}
              >
                {day || ""}
              </button>
              );
            })}
          </div>

          {/* Time */}
          <div className="th-dtp-time">
            <Clock size={14} />
            <span>เวลา</span>
            <select value={hour} onChange={e => updateTime(Number(e.target.value), minute)} className="th-dtp-select">
              {Array.from({length: 24}, (_, i) => <option key={i} value={i}>{String(i).padStart(2,"0")}</option>)}
            </select>
            <span>:</span>
            <select value={minute} onChange={e => updateTime(hour, Number(e.target.value))} className="th-dtp-select">
              {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => <option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}
            </select>
            <span className="th-dtp-ampm">{hour < 12 ? "ช่วงเช้า" : "ช่วงบ่าย"}</span>
          </div>

          {/* Footer */}
          <div className="th-dtp-footer">
            <button type="button" className="th-dtp-action-btn clear" onClick={clear}>ล้างค่า</button>
            <button type="button" className="th-dtp-action-btn today" onClick={goToday}>วันนี้</button>
          </div>
        </div>
      )}
    </div>
  );
}

const MARQUEE_ICONS = [
  { id: "", icon: Ban, label: "(ไม่มีไอคอน)" },
  { id: "Megaphone", icon: Megaphone, label: "โทรโข่ง (Megaphone)" },
  { id: "Bell", icon: Bell, label: "กระดิ่ง (Bell)" },
  { id: "TriangleAlert", icon: TriangleAlert, label: "แจ้งเตือน (Alert)" },
  { id: "Info", icon: Info, label: "ข้อมูล (Info)" },
  { id: "Zap", icon: Zap, label: "สายฟ้า (Lightning)" },
  { id: "Star", icon: Star, label: "ดาว (Star)" },
  { id: "Heart", icon: Heart, label: "หัวใจ (Heart)" },
  { id: "ShieldCheck", icon: ShieldCheck, label: "โล่ (Shield)" },
  { id: "CheckCircle", icon: CheckCircle, label: "เครื่องหมายถูก (Check)" },
  { id: "Gift", icon: Gift, label: "ของขวัญ (Gift)" }
];

function IconSelectDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = MARQUEE_ICONS.find(i => i.id === value) || MARQUEE_ICONS[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="custom-icon-select" ref={ref}>
      <button type="button" className="premium-input select-trigger" onClick={() => setOpen(o => !o)}>
        <span className="selected-item">
          <selected.icon size={16} />
          {selected.label}
        </span>
        <ChevronDown size={16} className="select-arrow" />
      </button>
      {open && (
        <div className="select-options-popup">
          {MARQUEE_ICONS.map(item => (
            <button
              key={item.id}
              type="button"
              className={`select-option ${value === item.id ? "active" : ""}`}
              onClick={() => { onChange(item.id); setOpen(false); }}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementsView({ notify, ask }: { notify: (notice: { kind: "success" | "error"; text: string }) => void; ask: (request: ConfirmRequest) => void }) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | Announcement["kind"]>("all");
  const [form, setForm] = useState<AnnouncementForm>({ ...emptyAnnouncement });
  const [editing, setEditing] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [cropImageSource, setCropImageSource] = useState<string | null>(null);
  const [announcementCrop, setAnnouncementCrop] = useState({ x: 0, y: 0 });
  const [announcementZoom, setAnnouncementZoom] = useState(1);
  const [announcementCropPixels, setAnnouncementCropPixels] = useState<Area | null>(null);
  const [announcementCropAspect, setAnnouncementCropAspect] = useState(32 / 9);
  const modalDialogRef = useRef<HTMLDivElement>(null);
  const imagePreviewDialogRef = useRef<HTMLElement>(null);
  const imagePreviewTriggerRef = useRef<HTMLButtonElement>(null);
  const imagePreviewOpenRef = useRef(false);
  const cropDialogRef = useRef<HTMLElement>(null);
  const cropTriggerRef = useRef<HTMLLabelElement>(null);
  const cropOpenRef = useRef(false);
  const cropUploadingRef = useRef(false);
  const cropObjectUrlRef = useRef<string | null>(null);

  const load = useCallback(() => api<{ items: Announcement[] }>("/api/admin/announcements").then((value) => {
    const parsedItems = value.items.map(item => {
      let legacyMeta: Record<string, unknown> = {};
      if (item.message && item.message.includes("<!--MARQUEE::")) {
        item.kind = "marquee";
        const parts = item.message.split("<!--MARQUEE::");
        item.message = parts[0];
        try { legacyMeta = JSON.parse(parts[1].replace("-->", "")); } catch {}
      } else if (item.customColor && item.customColor.startsWith("MARQUEE::")) {
        item.kind = "marquee";
        try { legacyMeta = JSON.parse(item.customColor.replace("MARQUEE::", "")); } catch {}
      }
      item.meta = { ...legacyMeta, ...(item.meta || {}) } as MarqueeMeta;
      return item;
    });
    setItems(parsedItems);
    if (!hasRememberedMarqueePalette()) {
      const latestMarquee = parsedItems
        .filter((item) => item.kind === "marquee")
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
      if (latestMarquee?.meta) rememberMarqueePalette(latestMarquee.meta);
    }
  }), []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const onEditorEscape = useEffectEvent(() => {
    if (cropOpenRef.current) {
      if (cropUploadingRef.current) return;
      closeAnnouncementCrop();
    }
    else if (imagePreviewOpenRef.current) closeImagePreview();
    else closeEditor();
  });

  useEffect(() => {
    if (!modalOpen) return;

    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPosition = body.style.position;
    const previousBodyTop = body.style.top;
    const previousBodyWidth = body.style.width;
    const previousBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    if (scrollbarWidth) body.style.paddingRight = `${scrollbarWidth}px`;

    const focusFrame = window.requestAnimationFrame(() => modalDialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEditorEscape();
        return;
      }
      const focusRoot = cropOpenRef.current ? cropDialogRef.current : imagePreviewOpenRef.current ? imagePreviewDialogRef.current : modalDialogRef.current;
      if (event.key !== "Tab" || !focusRoot) return;

      const focusable = Array.from(focusRoot.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) {
        event.preventDefault();
        focusRoot.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.position = previousBodyPosition;
      body.style.top = previousBodyTop;
      body.style.width = previousBodyWidth;
      body.style.paddingRight = previousBodyPaddingRight;
      const previousScrollBehavior = html.style.scrollBehavior;
      html.style.scrollBehavior = "auto";
      window.scrollTo(0, scrollY);
      html.style.scrollBehavior = previousScrollBehavior;
      previousFocus?.focus();
    };
  }, [modalOpen]);

  useEffect(() => () => {
    if (cropObjectUrlRef.current) URL.revokeObjectURL(cropObjectUrlRef.current);
  }, []);

  const setField = (key: keyof typeof form, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  function selectAnnouncementKind(kind: AnnouncementForm["kind"]) {
    if (kind !== "marquee") {
      setField("kind", kind);
      return;
    }
    setForm((current) => ({
      ...current,
      kind,
      meta: { ...loadMarqueePalette(), ...current.meta },
    }));
  }

  function updateMarqueePalette(patch: Record<string, string | boolean>) {
    setForm((current) => {
      const meta = { ...current.meta, ...patch };
      rememberMarqueePalette(meta);
      return { ...current, meta };
    });
  }

  function handleImageUpload(file?: File) {
    if (!file) return;
    if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(file.type)) {
      return notify({ kind: "error", text: "รองรับเฉพาะไฟล์ PNG, JPG และ WebP" });
    }
    if (file.size > 10 * 1024 * 1024) {
      return notify({ kind: "error", text: "ขนาดไฟล์ต้องไม่เกิน 10MB" });
    }

    if (cropObjectUrlRef.current) URL.revokeObjectURL(cropObjectUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    cropObjectUrlRef.current = objectUrl;
    cropOpenRef.current = true;
    setCropImageSource(objectUrl);
    setAnnouncementCrop({ x: 0, y: 0 });
    setAnnouncementZoom(1);
    setAnnouncementCropPixels(null);
    setAnnouncementCropAspect(form.kind === "banner" ? 32 / 9 : 4 / 5);
    window.requestAnimationFrame(() => cropDialogRef.current?.focus());
  }

  function closeAnnouncementCrop(restoreFocus = true) {
    cropOpenRef.current = false;
    setCropImageSource(null);
    setAnnouncementCropPixels(null);
    if (cropObjectUrlRef.current) {
      URL.revokeObjectURL(cropObjectUrlRef.current);
      cropObjectUrlRef.current = null;
    }
    if (restoreFocus) window.requestAnimationFrame(() => cropTriggerRef.current?.focus());
  }

  async function uploadCroppedAnnouncement() {
    if (!cropImageSource || !announcementCropPixels) return;
    cropUploadingRef.current = true;
    setUploadingImage(true);
    try {
      const croppedFile = await getCroppedImg(cropImageSource, announcementCropPixels, {
        fileName: "announcement.webp",
        mimeType: "image/webp",
        quality: 0.92,
        maxWidth: form.kind === "banner" ? 1920 : 1600,
        maxHeight: form.kind === "banner" ? 540 : 1600,
      });
      const body = new FormData();
      body.append("file", croppedFile);
      const result = await api<{ url: string }>("/api/admin/assets/announcement", {
        method: "POST",
        body,
      });
      setField("imageUrl", result.url);
      closeAnnouncementCrop(false);
      notify({ kind: "success", text: "อัปโหลดรูปภาพเรียบร้อยแล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      cropUploadingRef.current = false;
      setUploadingImage(false);
    }
  }

  function createNew() {
    closeAnnouncementCrop(false);
    imagePreviewOpenRef.current = false;
    setImagePreviewOpen(false);
    setEditing(null);
    setForm({ ...emptyAnnouncement });
    setModalOpen(true);
  }

  function edit(item: Announcement) {
    closeAnnouncementCrop(false);
    imagePreviewOpenRef.current = false;
    setImagePreviewOpen(false);
    setEditing(item.id);
    setForm({
      title: item.title || "", message: item.message || "", imageUrl: item.imageUrl || "", customColor: item.customColor || "",
      kind: item.kind, placement: item.placement, severity: item.severity,
      buttonLabel: item.buttonLabel || "", buttonUrl: item.buttonUrl || "",
      active: item.active, startsAt: localDateInput(item.startsAt), endsAt: localDateInput(item.endsAt), meta: item.meta || {},
      customColor: item.customColor && item.customColor.startsWith("MARQUEE::") ? "" : (item.customColor || "")
    });
    setModalOpen(true);
  }

  function openImagePreview() {
    imagePreviewOpenRef.current = true;
    setImagePreviewOpen(true);
  }

  function closeImagePreview(restoreFocus = true) {
    imagePreviewOpenRef.current = false;
    setImagePreviewOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => imagePreviewTriggerRef.current?.focus());
  }

  function closeEditor() {
    closeAnnouncementCrop(false);
    imagePreviewOpenRef.current = false;
    setImagePreviewOpen(false);
    setModalOpen(false);
  }

  async function saveAnnouncement(event: FormEvent) {
    event.preventDefault();
    if (!form.title && !form.message && !form.imageUrl) {
      return notify({ kind: "error", text: "โปรดกรอกหัวข้อ ข้อความ หรือรูปภาพอย่างน้อย 1 รายการ" });
    }
    const body = {
      ...form,
      message: form.message,
      kind: form.kind,
      customColor: form.kind === "marquee" ? "" : form.customColor,
      meta: form.kind === "marquee" ? (form.meta || {}) : {},
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
    };
    if (form.kind === "marquee") rememberMarqueePalette(form.meta || {});
    try {
      await api(editing ? `/api/admin/announcements/${editing}` : "/api/admin/announcements", {
        method: editing ? "PATCH" : "POST", body: JSON.stringify(body),
      });
      closeEditor();
      setEditing(null);
      setForm({ ...emptyAnnouncement });
      await load();
      notify({ kind: "success", text: editing ? "บันทึกประกาศแล้ว" : "สร้างประกาศแล้ว" });
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
  }

  async function remove(id: number) {
    try { await api(`/api/admin/announcements/${id}`, { method: "DELETE" }); await load(); notify({ kind: "success", text: "ลบประกาศแล้ว" }); }
    catch (error) { notify({ kind: "error", text: (error as Error).message }); }
  }

  function stateOf(item: Announcement) {
    const now = Date.now();
    if (!item.active) return "ปิดใช้งาน";
    if (item.startsAt && new Date(item.startsAt).getTime() > now) return "รอเผยแพร่";
    if (item.endsAt && new Date(item.endsAt).getTime() <= now) return "หมดเวลา";
    return "กำลังแสดง";
  }

  function kindLabel(kind: Announcement["kind"]) {
    if (kind === "popup") return "ป๊อปอัป";
    if (kind === "marquee") return "แถบวิ่ง";
    return "แบนเนอร์";
  }

  function placementLabel(placement: Announcement["placement"]) {
    if (placement === "homepage") return "หน้าแรก";
    if (placement === "login") return "หน้าเข้าสู่ระบบ";
    return "ทุกหน้า";
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const kindText = { banner: "แบนเนอร์", popup: "ป๊อปอัป", marquee: "แถบวิ่ง" } as const;
    const placeText = { homepage: "หน้าแรก", login: "หน้าเข้าสู่ระบบ", both: "ทุกหน้า" } as const;
    return items.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.message.toLowerCase().includes(q) ||
        kindText[item.kind].includes(q) ||
        placeText[item.placement].includes(q)
      );
    });
  }, [items, search, kindFilter]);

  const hasFilters = Boolean(search.trim() || kindFilter !== "all");

  return (
    <div className="ann-page">
      <div className="dash-heading">
        <p>จัดการเนื้อหา</p>
        <h1>จัดการประกาศ</h1>
        <span>สร้างแบนเนอร์ ป๊อปอัป หรือแถบวิ่ง แล้วกำหนดช่วงเวลาแสดงผล</span>
      </div>

      <section className="dash-card ann-panel">
        <div className="ann-toolbar">
          <div className="ann-summary">
            <span className="ann-summary-icon" aria-hidden="true"><Megaphone size={17} /></span>
            <div>
              <strong>ประกาศทั้งหมด</strong>
              <small>{items.length} รายการ{hasFilters ? ` · แสดง ${filteredItems.length}` : ""}</small>
            </div>
          </div>
          <div className="ann-tools">
            <label className="ann-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาหัวข้อหรือข้อความ"
                aria-label="ค้นหาประกาศ"
              />
            </label>
            <select
              className="ann-select"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as "all" | Announcement["kind"])}
              aria-label="กรองรูปแบบ"
            >
              <option value="all">ทุกรูปแบบ</option>
              <option value="banner">แบนเนอร์</option>
              <option value="popup">ป๊อปอัป</option>
              <option value="marquee">แถบวิ่ง</option>
            </select>
            <button type="button" className="dash-secondary ann-refresh" onClick={() => load().catch(() => undefined)} aria-label="โหลดข้อมูลใหม่">
              <RefreshCw size={16} aria-hidden="true" />
              <span>โหลดใหม่</span>
            </button>
            <button type="button" className="dash-primary ann-create" onClick={createNew}>
              <Plus size={16} aria-hidden="true" />
              <span>สร้างประกาศ</span>
            </button>
          </div>
        </div>

        {filteredItems.length ? (
          <div className="ann-grid">
            {filteredItems.map((item) => {
              const st = stateOf(item);
              const stateClass = st === "กำลังแสดง" ? "live" : st === "รอเผยแพร่" ? "pending" : "off";
              return (
                <article className="ann-card" key={item.id}>
                  <div className="ann-card-top">
                    <span className="ann-card-icon" aria-hidden="true"><Megaphone size={16} /></span>
                    <span className={`ann-state ${stateClass}`}>{st}</span>
                  </div>

                  {item.imageUrl ? (
                    <div className="ann-card-cover">
                      <SmartImage src={item.imageUrl} alt="" />
                    </div>
                  ) : null}

                  <div className="ann-card-copy">
                    <div className="ann-card-tags">
                      <span>{kindLabel(item.kind)}</span>
                      <span>{placementLabel(item.placement)}</span>
                    </div>
                    <h2>
                      {item.title
                        || (item.kind === "marquee" && item.message)
                        || (item.message ? item.message : null)
                        || (item.imageUrl ? "แบนเนอร์รูปภาพ" : kindLabel(item.kind))}
                    </h2>
                    {item.title && item.message ? <p>{item.message}</p> : null}
                  </div>

                  <div className="ann-card-meta">
                    <span><Clock size={13} aria-hidden="true" /> {item.startsAt ? formatDate(item.startsAt) : "เริ่มทันที"}</span>
                    <span><ArrowRight size={12} aria-hidden="true" /> {item.endsAt ? formatDate(item.endsAt) : "ไม่หมดอายุ"}</span>
                  </div>

                  <div className="ann-card-actions">
                    <button type="button" className="ann-btn" onClick={() => edit(item)}>
                      <Pencil size={14} aria-hidden="true" /> แก้ไข
                    </button>
                    <button
                      type="button"
                      className="ann-btn danger"
                      onClick={() =>
                        ask({
                          title: "ลบประกาศนี้?",
                          message: `ประกาศ “${item.title || "นี้"}” จะถูกลบถาวร`,
                          confirmLabel: "ลบประกาศ",
                          danger: true,
                          action: () => remove(item.id),
                        })
                      }
                      aria-label={`ลบประกาศ ${item.title || item.id}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="ann-empty soft">
            <Megaphone size={28} aria-hidden="true" />
            <strong>{hasFilters ? "ไม่พบประกาศที่ตรงเงื่อนไข" : "ยังไม่มีประกาศ"}</strong>
            <span>{hasFilters ? "ลองเปลี่ยนคำค้นหาหรือรูปแบบ" : "สร้างประกาศแรกเพื่อแจ้งข้อมูลให้ผู้ใช้"}</span>
            {!hasFilters && (
              <button type="button" className="dash-primary" onClick={createNew}>
                <Plus size={16} aria-hidden="true" /> สร้างประกาศ
              </button>
            )}
          </div>
        )}
      </section>

      {/* Editor Modal Popup Overlay */}
      {modalOpen && (
        <div
          className="announcement-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => e.target === e.currentTarget && closeEditor()}
        >
          <div
            ref={modalDialogRef}
            className="announcement-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="announcement-editor-title"
            tabIndex={-1}
          >
            <form className="premium-settings-card announcement-editor-card" onSubmit={saveAnnouncement} noValidate>
              <div className="settings-card-header popup-header">
                <div className="sch-icon login">
                  <Megaphone size={20} />
                </div>
                <div>
                  <h3 id="announcement-editor-title">{editing ? "แก้ไขข้อมูลประกาศ" : "สร้างประกาศใหม่"}</h3>
                  <p>กำหนดข้อความ รูปภาพ หรือสีของประกาศได้ตามต้องการ (เลือกใส่เฉพาะบางรายการได้)</p>
                </div>
                <button type="button" className="modal-close-btn" onClick={closeEditor} aria-label="ปิด">
                  <X size={18} />
                </button>
              </div>

              <div className="announcement-form-body">
                {/* 1. รูปแบบการแสดงผล (Kind Selector) */}
                <div className="input-group span-two">
                  <label>รูปแบบการแสดงผล</label>
                  <div className="kind-selector-grid">
                    <button type="button" className={`kind-card ${form.kind === "banner" ? "selected" : ""}`} onClick={() => selectAnnouncementKind("banner")}>
                      <span className="kc-icon"><Megaphone size={24} /></span>
                      {form.kind === "banner" && <CheckCircle2 size={20} className="kc-check" />}
                      <div className="kc-text">
                        <strong>แบนเนอร์รูปภาพ</strong>
                        <span>ภาพแนวนอนบนหน้าแรก</span>
                      </div>
                    </button>
                    <button type="button" className={`kind-card ${form.kind === "popup" ? "selected" : ""}`} onClick={() => selectAnnouncementKind("popup")}>
                      <span className="kc-icon"><Monitor size={24} /></span>
                      {form.kind === "popup" && <CheckCircle2 size={20} className="kc-check" />}
                      <div className="kc-text">
                        <strong>ป๊อปอัป</strong>
                        <span>เด้งขึ้นกลางหน้าจอ</span>
                      </div>
                    </button>
                    <button type="button" className={`kind-card ${form.kind === "marquee" ? "selected" : ""}`} onClick={() => selectAnnouncementKind("marquee")}>
                      <span className="kc-icon"><ArrowRight size={24} /></span>
                      {form.kind === "marquee" && <CheckCircle2 size={20} className="kc-check" />}
                      <div className="kc-text">
                        <strong>แถบวิ่ง (Marquee)</strong>
                        <span>ข้อความเลื่อนผ่านด้านบน</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="form-section-header"><FileText size={18} /> ข้อความที่จะแสดง</div>

                <div className="form-row-grid">
                  {/* หัวข้อ - ไม่จำเป็นสำหรับแถบวิ่งมากนัก แต่ให้มีไว้ก็ดี */}
                  {form.kind !== "marquee" && (
                    <div className="input-group span-two">
                      <label>หัวข้อประกาศ <small className="form-label-hint">(ไม่บังคับ)</small></label>
                      <input
                        className="premium-input"
                        maxLength={120}
                        value={form.title}
                        onChange={(e) => setField("title", e.target.value)}
                        placeholder="เช่น ปิดปรับปรุงระบบชั่วคราววันที่ 30 ก.ค. (ปล่อยว่างได้)"
                      />
                    </div>
                  )}

                  <div className="input-group span-two">
                    <label>{form.kind === "marquee" ? "ข้อความที่ต้องการแสดง" : "รายละเอียดข้อความ"} <small className="form-label-hint">(ไม่บังคับ)</small></label>
                    <textarea
                      className="premium-input"
                      rows={form.kind === "marquee" ? 2 : 3}
                      maxLength={2000}
                      value={form.message}
                      onChange={(e) => setField("message", e.target.value)}
                      placeholder={form.kind === "marquee" ? "ระบุข้อความที่จะให้วิ่งผ่านหน้าจอ" : "ระบุข้อความรายละเอียดของประกาศ... (ปล่อยว่างได้ หากใส่รูปอย่างเดียว)"}
                    />
                  </div>

                  {(form.kind === "popup" || form.kind === "banner") && (
                    <div className="input-group span-two">
                      <label>
                        รูปภาพประกาศ
                        <small className="form-label-hint">
                          {form.kind === "banner" ? "(แนะนำ 1920 x 540 px · PNG, JPG หรือ WebP)" : "(อัปโหลดไฟล์จากเครื่อง หรือวางลิงก์ URL ได้)"}
                        </small>
                      </label>
                      <div className="input-with-upload-row">
                        <input
                          className="premium-input"
                          value={form.imageUrl || ""}
                          onChange={(e) => setField("imageUrl", e.target.value)}
                          placeholder="เลือกไฟล์จากเครื่อง หรือวางลิงก์ https://..."
                        />
                        <label
                          ref={cropTriggerRef}
                          className={`premium-btn secondary upload-btn ${uploadingImage ? "uploading" : ""}`}
                          tabIndex={uploadingImage ? -1 : 0}
                          aria-disabled={uploadingImage}
                          onKeyDown={(event) => {
                            if (!uploadingImage && (event.key === "Enter" || event.key === " ")) {
                              event.preventDefault();
                              event.currentTarget.querySelector("input")?.click();
                            }
                          }}
                        >
                          {uploadingImage ? <RefreshCw className="upload-spinner" size={16} /> : <Upload size={16} />}
                          <span>{uploadingImage ? "กำลังอัปโหลด" : "เลือกรูป"}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => {
                              handleImageUpload(e.target.files?.[0]);
                              e.currentTarget.value = "";
                            }}
                            disabled={uploadingImage}
                            hidden
                          />
                        </label>
                      </div>
                      {form.imageUrl && (
                        <div className={`form-image-preview ${form.kind === "banner" ? "banner-preview" : ""}`}>
                          <button
                            ref={imagePreviewTriggerRef}
                            type="button"
                            className="preview-open-btn"
                            onClick={openImagePreview}
                            title="ดูรูปขนาดเต็ม"
                            aria-label="ดูรูปประกาศขนาดเต็ม"
                          >
                            <SmartImage src={form.imageUrl} alt="ตัวอย่างรูปภาพ" />
                            <span className="preview-open-icon" aria-hidden="true"><Maximize2 size={17} /></span>
                          </button>
                          <button
                            type="button"
                            className="preview-remove-btn"
                            onClick={() => {
                              closeImagePreview(false);
                              setField("imageUrl", "");
                            }}
                            title="ลบรูปภาพ"
                          >
                            <X size={14} /> ลบรูปภาพ
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="form-section-header"><Settings size={18} /> ปรับแต่งหน้าตาประกาศ</div>
                
                <div className="form-row-grid marquee-settings-grid">
                  {form.kind === "marquee" && (
                    <>
                      <div className="input-group span-two">
                        <label>ไอคอนแถบวิ่ง</label>
                        <IconSelectDropdown value={form.meta?.icon || ""} onChange={(v) => setForm(c => ({ ...c, meta: { ...c.meta, icon: v } }))} />
                      </div>
                      <div className="input-group marquee-color-field">
                        <label>สีไอคอน</label>
                        <div className="color-picker-row">
                          <input type="color" className="color-swatch-input" value={form.meta?.iconColor || DEFAULT_MARQUEE_PALETTE.iconColor} onChange={(e) => updateMarqueePalette({ iconColor: e.target.value })} />
                          <input className="premium-input color-hex-input" value={form.meta?.iconColor || DEFAULT_MARQUEE_PALETTE.iconColor} onChange={(e) => updateMarqueePalette({ iconColor: e.target.value })} placeholder={DEFAULT_MARQUEE_PALETTE.iconColor} />
                        </div>
                      </div>
                      <div className="input-group marquee-color-field">
                        <label>สีข้อความ</label>
                        <div className="color-picker-row">
                          <input type="color" className="color-swatch-input" value={form.meta?.textColor || DEFAULT_MARQUEE_PALETTE.textColor} onChange={(e) => updateMarqueePalette({ textColor: e.target.value })} />
                          <input className="premium-input color-hex-input" value={form.meta?.textColor || DEFAULT_MARQUEE_PALETTE.textColor} onChange={(e) => updateMarqueePalette({ textColor: e.target.value })} placeholder={DEFAULT_MARQUEE_PALETTE.textColor} />
                        </div>
                      </div>
                      <div className="input-group marquee-color-field">
                        <label>สีกรอบ (Border)</label>
                        <div className={`color-picker-row color-optional-row ${form.meta?.borderColorEnabled === false ? "disabled" : ""}`}>
                          <input type="color" className="color-swatch-input" disabled={form.meta?.borderColorEnabled === false} value={form.meta?.borderColor || DEFAULT_MARQUEE_PALETTE.borderColor} onChange={(e) => updateMarqueePalette({ borderColor: e.target.value })} />
                          <input className="premium-input color-hex-input" disabled={form.meta?.borderColorEnabled === false} value={form.meta?.borderColor || DEFAULT_MARQUEE_PALETTE.borderColor} onChange={(e) => updateMarqueePalette({ borderColor: e.target.value })} placeholder={DEFAULT_MARQUEE_PALETTE.borderColor} />
                          <button type="button" className={`color-optional-toggle ${form.meta?.borderColorEnabled === false ? "active" : ""}`} onClick={() => updateMarqueePalette({ borderColorEnabled: form.meta?.borderColorEnabled === false })}>
                            <Ban size={14} /> {form.meta?.borderColorEnabled === false ? "เปิดใช้สี" : "ไม่ใช้สี"}
                          </button>
                        </div>
                      </div>
                      <div className="input-group marquee-color-field">
                        <label>สีพื้นหลัง (Background)</label>
                        <div className={`color-picker-row color-optional-row ${form.meta?.backgroundColorEnabled === false ? "disabled" : ""}`}>
                          <input type="color" className="color-swatch-input" disabled={form.meta?.backgroundColorEnabled === false} value={form.meta?.backgroundColor || DEFAULT_MARQUEE_PALETTE.backgroundColor} onChange={(e) => updateMarqueePalette({ backgroundColor: e.target.value })} />
                          <input className="premium-input color-hex-input" disabled={form.meta?.backgroundColorEnabled === false} value={form.meta?.backgroundColor || DEFAULT_MARQUEE_PALETTE.backgroundColor} onChange={(e) => updateMarqueePalette({ backgroundColor: e.target.value })} placeholder={DEFAULT_MARQUEE_PALETTE.backgroundColor} />
                          <button type="button" className={`color-optional-toggle ${form.meta?.backgroundColorEnabled === false ? "active" : ""}`} onClick={() => updateMarqueePalette({ backgroundColorEnabled: form.meta?.backgroundColorEnabled === false })}>
                            <Ban size={14} /> {form.meta?.backgroundColorEnabled === false ? "เปิดใช้สี" : "ไม่ใช้สี"}
                          </button>
                        </div>
                      </div>
                      <div className="input-group">
                        <label>ทิศทางการวิ่ง</label>
                        <div className="custom-select-wrap">
                          <select className="premium-input" value={form.meta?.direction || "left"} onChange={(e) => setForm((c) => ({ ...c, meta: { ...c.meta, direction: e.target.value } }))}>
                            <option value="left">เลื่อนไปซ้าย (จากขวาไปซ้าย)</option>
                            <option value="right">เลื่อนไปขวา (จากซ้ายไปขวา)</option>
                          </select>
                          <ChevronDown size={16} className="select-arrow" />
                        </div>
                      </div>
                      <div className="input-group">
                        <label>จำนวนการแสดงข้อความซ้ำ</label>
                        <div className="custom-select-wrap">
                          <select className="premium-input" value={form.meta?.repeatCount || 1} onChange={(e) => setForm((c) => ({ ...c, meta: { ...c.meta, repeatCount: parseInt(e.target.value) || 1 } }))}>
                            <option value="1">1 ชุดข้อความ (แสดงครั้งเดียว)</option>
                            <option value="2">2 ชุดข้อความ</option>
                            <option value="3">3 ชุดข้อความ</option>
                            <option value="5">5 ชุดข้อความ</option>
                            <option value="10">10 ชุดข้อความ (ข้อความเรียงต่อกัน)</option>
                          </select>
                          <ChevronDown size={16} className="select-arrow" />
                        </div>
                      </div>
                      <div className="input-group">
                        <label>ความเร็ว (ระยะเวลาต่อ 1 รอบ)</label>
                        <div className="custom-select-wrap">
                          <select className="premium-input" value={form.meta?.speed || 15} onChange={(e) => setForm((c) => ({ ...c, meta: { ...c.meta, speed: parseInt(e.target.value) || 15 } }))}>
                            <option value="5">เร็วมาก (5 วินาที)</option>
                            <option value="10">เร็ว (10 วินาที)</option>
                            <option value="15">ปกติ (15 วินาที)</option>
                            <option value="20">ช้า (20 วินาที)</option>
                            <option value="30">ช้ามาก (30 วินาที)</option>
                            <option value="45">ช้าสุดๆ (45 วินาที)</option>
                            <option value="60">หอยทาก (1 นาที)</option>
                            <option value="120">เดินชมวิว (2 นาที)</option>
                            <option value="300">เต่าคลาน (5 นาที)</option>
                          </select>
                          <ChevronDown size={16} className="select-arrow" />
                        </div>
                      </div>
                    </>
                  )}

                  {form.kind !== "marquee" && (
                    <>
                      <div className="input-group span-two">
                        <label>สีประจำประกาศ <small className="form-label-hint">(กำหนดสีธีมของประกาศได้ตามใจ)</small></label>
                        <div className="color-picker-only-row">
                          <input
                            type="color"
                            className="color-swatch-input"
                            value={form.customColor || "#38bdf8"}
                            onChange={(e) => setField("customColor", e.target.value)}
                          />
                          <span className="color-value-badge" style={{ background: form.customColor || "#38bdf8" }}>
                            {(form.customColor || "#38bdf8").toUpperCase()}
                          </span>
                        </div>
                      </div>

                      <div className="input-group span-two">
                        <label>ระดับความสำคัญ</label>
                        <div className="severity-pill-grid">
                          {[
                            { id: "info", label: "ข้อมูลทั่วไป", icon: Info, class: "sev-info" },
                            { id: "success", label: "แจ้งเตือนสำเร็จ", icon: CircleCheck, class: "sev-success" },
                            { id: "warning", label: "ข้อควรระวัง", icon: CircleAlert, class: "sev-warning" },
                            { id: "error", label: "สำคัญมาก", icon: Ban, class: "sev-error" },
                          ].map((item) => {
                            const SevIcon = item.icon;
                            const selected = form.severity === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className={`sev-pill ${item.class} ${selected ? "selected" : ""}`}
                                onClick={() => setField("severity", item.id)}
                              >
                                <SevIcon size={15} />
                                <span>{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      
                      <div className="input-group">
                        <label>ข้อความบนปุ่ม (ถ้ามี)</label>
                        <input
                          className="premium-input"
                          maxLength={50}
                          value={form.buttonLabel}
                          onChange={(e) => setField("buttonLabel", e.target.value)}
                          placeholder="เช่น ดูรายละเอียดเพิ่มเติม"
                        />
                      </div>

                      <div className="input-group">
                        <label>ลิงก์ปลายทางเมื่อกดปุ่ม</label>
                        <input
                          className="premium-input"
                          maxLength={500}
                          value={form.buttonUrl}
                          onChange={(e) => setField("buttonUrl", e.target.value)}
                          placeholder="เช่น /status หรือ https://..."
                        />
                      </div>
                    </>
                  )}
                  
                  <div className="input-group span-two">
                    <label>ตำแหน่งที่แสดงผล</label>
                    <div className="custom-select-wrap">
                      <select className="premium-input" value={form.placement} onChange={(e) => setField("placement", e.target.value)}>
                        <option value="homepage">เฉพาะหน้าแรก</option>
                        <option value="login">เฉพาะหน้าเข้าสู่ระบบ</option>
                        <option value="both">แสดงทุกหน้า</option>
                      </select>
                      <ChevronDown size={16} className="select-arrow" />
                    </div>
                  </div>
                </div>

                <div className="form-section-header"><Clock size={18} /> ระยะเวลาแสดงผล</div>

                <div className="date-range-card">
                  <div className="date-range-slot">
                    <div className="date-slot-label">
                      <PlayCircle size={14} />
                      เริ่มแสดง
                    </div>
                    <ThaiDateTimePicker
                      value={form.startsAt}
                      onChange={(value) => setField("startsAt", value)}
                      label="เลือกวันที่และเวลา"
                    />
                    {form.startsAt && (
                      <small className="thai-date-hint">
                        {formatThaiFullDate(form.startsAt)}
                      </small>
                    )}
                  </div>

                  <div className="date-range-sep">
                    <div className="date-sep-line" />
                    <ArrowRight size={16} />
                    <div className="date-sep-line" />
                  </div>

                  <div className="date-range-slot">
                    <div className="date-slot-label">
                      <StopCircle size={14} />
                      สิ้นสุด
                    </div>
                    <ThaiDateTimePicker
                      value={form.endsAt}
                      onChange={(value) => setField("endsAt", value)}
                      label="ว่าง = แสดงตลอดไป"
                    />
                    {form.endsAt && (
                      <small className="thai-date-hint">
                        {formatThaiFullDate(form.endsAt)}
                      </small>
                    )}
                  </div>
                </div>
              </div>
              <div className="settings-card-footer popup-footer">
                <div className="settings-card-actions">
                  <button type="button" className="premium-btn secondary" onClick={closeEditor}>
                    ยกเลิก
                  </button>
                  <button type="submit" className="premium-btn primary-filled">
                    <Save size={16} />
                    {editing ? "บันทึกการแก้ไข" : "สร้างประกาศ"}
                  </button>
                </div>
              </div>
</form>
          </div>
          {imagePreviewOpen && form.imageUrl && (
            <div
              className="announcement-image-lightbox"
              role="presentation"
              onMouseDown={(event) => event.target === event.currentTarget && closeImagePreview()}
            >
              <section
                ref={imagePreviewDialogRef}
                className="announcement-image-lightbox-dialog"
                role="dialog"
                aria-modal="true"
                aria-label="รูปประกาศขนาดเต็ม"
                tabIndex={-1}
                onMouseDown={(event) => event.target === event.currentTarget && closeImagePreview()}
              >
                <SmartImage src={form.imageUrl} alt="รูปประกาศขนาดเต็ม" loading="eager" />
                <button type="button" onClick={() => closeImagePreview()} aria-label="ปิดรูปขนาดเต็ม" title="ปิด" autoFocus>
                  <X size={20} />
                </button>
              </section>
            </div>
          )}
          {cropImageSource && (
            <div
              className="announcement-crop-backdrop"
              role="presentation"
              onMouseDown={(event) => event.target === event.currentTarget && !uploadingImage && closeAnnouncementCrop()}
            >
              <section
                ref={cropDialogRef}
                className="announcement-crop-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="announcement-crop-title"
                tabIndex={-1}
              >
                <header>
                  <div>
                    <FileImage size={20} />
                    <div>
                      <h3 id="announcement-crop-title">ครอปรูปก่อนอัปโหลด</h3>
                      <p>ลากภาพเพื่อจัดตำแหน่ง แล้วปรับขนาดด้วยแถบซูม</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => closeAnnouncementCrop()} disabled={uploadingImage} aria-label="ปิดหน้าครอปรูป">
                    <X size={19} />
                  </button>
                </header>

                <div className={`announcement-crop-stage ${form.kind === "banner" ? "banner" : "popup"}`}>
                  <Cropper
                    image={cropImageSource}
                    crop={announcementCrop}
                    zoom={announcementZoom}
                    aspect={announcementCropAspect}
                    showGrid
                    onCropChange={setAnnouncementCrop}
                    onZoomChange={setAnnouncementZoom}
                    onCropComplete={(_, croppedPixels) => setAnnouncementCropPixels(croppedPixels)}
                  />
                </div>

                <div className="announcement-crop-controls">
                  <div className="announcement-crop-ratio">
                    <span>สัดส่วนภาพ</span>
                    {form.kind === "banner" ? (
                      <strong>32:9 · แบนเนอร์หน้าแรก</strong>
                    ) : (
                      <div className="announcement-ratio-options" role="group" aria-label="เลือกสัดส่วนภาพ">
                        {[
                          { label: "1:1", value: 1 },
                          { label: "4:5", value: 4 / 5 },
                          { label: "16:9", value: 16 / 9 },
                        ].map((option) => (
                          <button
                            type="button"
                            className={Math.abs(announcementCropAspect - option.value) < 0.001 ? "active" : ""}
                            onClick={() => {
                              setAnnouncementCropAspect(option.value);
                              setAnnouncementCrop({ x: 0, y: 0 });
                              setAnnouncementZoom(1);
                            }}
                            key={option.label}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <label className="announcement-zoom-control">
                    <span>ซูม</span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.05}
                      value={announcementZoom}
                      onChange={(event) => setAnnouncementZoom(Number(event.target.value))}
                    />
                    <output>{Math.round(announcementZoom * 100)}%</output>
                  </label>
                </div>

                <footer>
                  <button type="button" className="premium-btn secondary" onClick={() => closeAnnouncementCrop()} disabled={uploadingImage}>
                    ยกเลิก
                  </button>
                  <button type="button" className="premium-btn primary-filled" onClick={uploadCroppedAnnouncement} disabled={uploadingImage || !announcementCropPixels}>
                    {uploadingImage ? <RefreshCw className="upload-spinner" size={16} /> : <Upload size={16} />}
                    {uploadingImage ? "กำลังอัปโหลด" : "ครอปและอัปโหลด"}
                  </button>
                </footer>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingRow({ title, description, children, column = false, fieldId }: { title: string; description: React.ReactNode; children: React.ReactNode; column?: boolean; fieldId?: string }) {
  return <div className={`premium-setting-row ${column ? "column-layout" : ""}`}>
    <div className="psr-info">
      <h3>{fieldId ? <label htmlFor={fieldId}>{title}</label> : title}</h3>
      <p>{description}</p>
    </div>
    <div className="psr-control">{children}</div>
  </div>;
}

function parseLockdownDuration(value:string):number {
  const raw = value.trim().toLowerCase();
  if (!raw || raw === "ถาวร" || raw === "permanent") return 0;
  const match = /^(\d+)\s*(s|m|h|d|w|mo|y|วินาที|นาที|ชั่วโมง|วัน|สัปดาห์|เดือน|ปี)$/.exec(raw);
  if (!match) throw new Error("ระบุเวลา เช่น 30s, 15m, 2h, 7d, 1mo หรือ 1y");
  const factors:Record<string,number> = { s:1,วินาที:1,m:60,นาที:60,h:3600,ชั่วโมง:3600,d:86400,วัน:86400,w:604800,สัปดาห์:604800,mo:2592000,เดือน:2592000,y:31536000,ปี:31536000 };
  const seconds = Number(match[1]) * factors[match[2]];
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 157680000) throw new Error("ระยะเวลาต้องอยู่ระหว่าง 1 วินาทีถึง 5 ปี");
  return seconds;
}

function SettingsView({ notify, ask }: { notify: (notice: { kind: "success" | "error"; text: string }) => void; ask: (request: ConfirmRequest) => void }) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  // Read once: the sidebar's settings links each load the page with their own ?tab=.
  const [activeTab] = useState(() => (typeof window === "undefined" ? "general" : new URLSearchParams(window.location.search).get("tab") || "general"));
  const [assetPreview, setAssetPreview] = useState<{ src: string; label: string } | null>(null);
  const [ogPreviewTab, setOgPreviewTab] = useState<"discord" | "facebook" | "x" | "line">("discord");
  const [savedSettings, setSavedSettings] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lockdown, setLockdown] = useState<LockdownState | null>(null);
  const [lockdownDuration, setLockdownDuration] = useState("");
  const [lockdownReason, setLockdownReason] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploading, setUploading] = useState("");
  // The theme and colour last saved, to restore when leaving with unsaved previews.
  const savedLook = useRef<{ themeMode?: string; primaryColor?: string }>({});
  
  useEffect(() => {
    if (activeTab !== "danger") return;
    api<LockdownState>("/api/admin/lockdown").then(setLockdown).catch(() => undefined);
  }, [activeTab]);

  const fetchSettings = useCallback(() => api<SettingsData>("/api/admin/settings").then((value) => {
    savedLook.current = { themeMode: value.themeMode, primaryColor: value.primaryColor };
    setSettings(value);
    setSavedSettings(JSON.stringify(value));
  }).catch(() => setLoadFailed(true)), []);
  useEffect(() => { void fetchSettings(); }, [fetchSettings]);
  // Links such as "#store-switch" land on that setting once the form has loaded.
  const settingsLoaded = Boolean(settings);
  useEffect(() => {
    if (!settingsLoaded || !window.location.hash) return;
    const target = document.getElementById(window.location.hash.slice(1));
    if (!target) return;
    // Jump once the form has settled (a smooth scroll gets cancelled while it lays out), leaving room for the header and section title.
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 140, behavior: "instant" });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [settingsLoaded, activeTab]);
  // Show the theme and colour while editing, without caching them for the next page load
  // (that only happens on save). Leaving the page puts the saved look back.
  useEffect(() => {
    if (settings?.themeMode) document.documentElement.dataset.theme = settings.themeMode;
    applyThemeColor(settings?.primaryColor, false);
  }, [settings?.themeMode, settings?.primaryColor]);
  useEffect(() => {
    const look = savedLook;
    return () => {
      if (look.current.themeMode) document.documentElement.dataset.theme = look.current.themeMode;
      if (look.current.primaryColor) applyThemeColor(look.current.primaryColor, false);
    };
  }, []);
  useScrollLock(Boolean(assetPreview));
  useEscape(Boolean(assetPreview), () => setAssetPreview(null));
  async function save(event: FormEvent) {
    event.preventDefault(); if (!settings) return;
    setSaveState("saving");
    try {
      const value = await api<SettingsData>("/api/admin/settings", { method: "PATCH", body: JSON.stringify(settings) });
      savedLook.current = { themeMode: value.themeMode, primaryColor: value.primaryColor };
      try { window.localStorage.setItem("nexora-theme", value.themeMode); } catch { /* storage may be blocked */ }
      applyThemeColor(value.primaryColor);
      setSettings(value);
      setSavedSettings(JSON.stringify(value));
      window.dispatchEvent(new CustomEvent("nexora:settings-updated", { detail: value }));
      setSaveState("saved");
      window.setTimeout(() => setSaveState((state) => state === "saved" ? "idle" : state), 2500);
      notify({ kind: "success", text: "บันทึกแล้ว" });
    } catch (error) {
      setSaveState("error");
      notify({ kind: "error", text: (error as Error).message });
    }
  }
  async function upload(kind: string, file?: File) {
    if (!file || !settings) return; const body = new FormData(); body.append("file", file);
    setUploading(kind);
    try {
      const result = await api<{ url: string }>(`/api/admin/assets/${kind}`, { method: "POST", body });
      const key = kind === "logo" ? "logoUrl" : kind === "favicon" ? "faviconUrl" : kind === "og-image" ? "ogImageUrl" : "authBackgroundUrl";
      const nextSettings = { ...settings, [key]: result.url };
      setSettings(nextSettings);
      setSavedSettings((previous) => {
        try { return JSON.stringify({ ...JSON.parse(previous), [key]: result.url }); }
        catch { return previous; }
      });
      window.dispatchEvent(new CustomEvent("nexora:settings-updated", { detail: nextSettings }));
      notify({ kind: "success", text: "เปลี่ยนรูปแล้ว" });
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
    finally { setUploading(""); }
  }
  function removeAsset(kind: string, label: string) {
    if (!settings) return;
    const key = kind === "logo" ? "logoUrl" : kind === "favicon" ? "faviconUrl" : kind === "og-image" ? "ogImageUrl" : "authBackgroundUrl";
    const fallbackMessage = kind === "auth-background"
      ? "หน้าเข้าสู่ระบบจะกลับไปใช้พื้นหลังสีเรียบ"
      : kind === "og-image"
        ? "ตอนแชร์ลิงก์จะใช้โลโก้แทน"
        : "จะกลับไปใช้รูปเริ่มต้นของระบบ";
    ask({
      title: `ลบ${label}?`,
      message: fallbackMessage,
      confirmLabel: "ลบรูป",
      danger: true,
      action: async () => {
        await api(`/api/admin/assets/${kind}`, { method: "DELETE" });
        const nextSettings = { ...settings, [key]: "" };
        setSettings(nextSettings);
        setSavedSettings((previous) => {
          try { return JSON.stringify({ ...JSON.parse(previous), [key]: "" }); }
          catch { return previous; }
        });
        window.dispatchEvent(new CustomEvent("nexora:settings-updated", { detail: nextSettings }));
        setAssetPreview(null);
        notify({ kind: "success", text: `ลบ${label}แล้ว` });
      },
    });
  }
  async function testWebhook() {
    if (!settings) return;
    try {
      await api("/api/admin/settings/test-webhook", {
        method: "POST",
        body: JSON.stringify({ webhookUrl: settings.discordWebhookUrl || "" }),
      });
      notify({ kind: "success", text: "ส่งข้อความทดสอบแล้ว ลองดูในห้อง Discord" });
    } catch (error) { notify({ kind: "error", text: (error as Error).message }); }
  }
  const isDirty = Boolean(settings && JSON.stringify(settings) !== savedSettings);
  const saveStatus = saveState === "saving"
    ? { className: "saving pulse", text: "กำลังบันทึก..." }
    : saveState === "error"
      ? { className: "error", text: "บันทึกไม่สำเร็จ ลองอีกครั้ง" }
      : isDirty
        ? { className: "dirty pulse", text: "ยังไม่ได้บันทึก" }
        : saveState === "saved"
          ? { className: "saved", text: "บันทึกแล้ว" }
          : { className: "idle", text: "ไม่มีอะไรเปลี่ยน" };
  // Sidebar links load a new page, so the browser's own "leave this page?" prompt covers them.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  if (!settings) {
    return loadFailed ? (
      <div className="aov-empty hv-empty gst-failed">
        <span>โหลดการตั้งค่าไม่ได้</span>
        <button type="button" onClick={() => { setLoadFailed(false); void fetchSettings(); }}>ลองอีกครั้ง</button>
      </div>
    ) : <div className="dashboard-loading inline"><span /></div>;
  }
  const set = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => setSettings({ ...settings, [key]: value });
  
  const oauthProviders = [
    { key: "discord", name: "Discord", description: "เข้าสู่ระบบด้วยบัญชี Discord", icon: "/brands/discord-symbol.svg", id: "discordClientId" as const, secret: "discordClientSecret" as const, enabled: "discordEnabled" as const, configured: "discordConfigured" as const, clear: "clearDiscordOAuth" as const },
    { key: "google", name: "Google", description: "เข้าสู่ระบบด้วยบัญชี Google", icon: "/brands/google-g.png", id: "googleClientId" as const, secret: "googleClientSecret" as const, enabled: "googleEnabled" as const, configured: "googleConfigured" as const, clear: "clearGoogleOAuth" as const },
    { key: "github", name: "GitHub", description: "เข้าสู่ระบบด้วยบัญชี GitHub", icon: "/brands/github-mark.png", id: "githubClientId" as const, secret: "githubClientSecret" as const, enabled: "githubEnabled" as const, configured: "githubConfigured" as const, clear: "clearGitHubOAuth" as const },
  ];

  // One heading for the page: the tab's name, with the settings area as the small label above.
  const tabHeading: Record<string, [string, string]> = {
    general: ["ทั่วไป", "ชื่อเว็บไซต์ หน้าตา ร้านค้า และรูปแบรนด์"],
    auth: ["การเข้าสู่ระบบ", "ข้อความและนโยบายการเข้าสู่ระบบและสมัครสมาชิก"],
    social: ["Social Login", "เข้าสู่ระบบด้วย Discord, Google หรือ GitHub"],
    notifications: ["การแจ้งเตือน", "ส่งเหตุการณ์สำคัญเข้า Discord"],
    danger: ["ขั้นสูง", "สิ่งที่กระทบผู้ใช้ทั้งระบบ"],
    mail: ["ระบบอีเมล", "การเชื่อมต่อสำหรับส่งและรับอีเมลของทุกโดเมน"],
  };
  const [tabTitle, tabDescription] = tabHeading[activeTab] || tabHeading.general;

  return (
    <>
      <header className="aov-head gst-head">
        <div>
          <p className="aov-eyebrow">ตั้งค่าระบบ</p>
          <h1>{tabTitle}</h1>
          <p className="aov-sub">{tabDescription}</p>
        </div>
      </header>

      <div className="premium-settings-container">
        {activeTab === "mail" ? (
          <div className="premium-settings-content">
            <div className="psc-body"><MailSettingsPanel notify={notify} /></div>
          </div>
        ) : (
        <form onSubmit={save} className={`premium-settings-content${activeTab === "general" ? " general-settings-form" : ""}`}>

          <div className="psc-body">
            {activeTab === "general" && (() => {
              const tabPreview = settings.siteTitleMode === "page" ? `ตั้งค่าระบบ · ${settings.siteTitle || "ชื่อเว็บไซต์"}` : settings.siteTitle || "ชื่อเว็บไซต์";
              const tabIcon = normalizeAssetUrl(settings.faviconUrl) || normalizeAssetUrl(settings.logoUrl) || "/logo-v2.png";
              const ogTitle = settings.ogTitle || settings.siteTitle || settings.brandName || "NEXORA CLOUD";
              const ogDesc = settings.ogDescription || settings.siteDescription || "ศูนย์รวมร้านค้า สินค้าเกม และไอเท็มชิ้นโปรดของคุณ";
              const ogImg = normalizeAssetUrl(settings.ogImageUrl) || normalizeAssetUrl(settings.logoUrl) || "/logo-v2.png";
              const ogIcon = tabIcon;
              const ogDomain = typeof window !== "undefined" ? window.location.hostname : "nkn02.com";
              const ogUrl = typeof window !== "undefined" ? window.location.origin : "https://nkn02.com";
              const isLarge = (settings.ogCardType || "summary_large_image") === "summary_large_image";
              const assets = [
                { kind: "logo", label: "โลโก้", value: settings.logoUrl, hint: "PNG หรือ WebP พื้นใส", accept: "image/png,image/webp,image/jpeg" },
                { kind: "favicon", label: "ไอคอนแท็บ (Favicon)", value: settings.faviconUrl, hint: "512 × 512 px", accept: "image/png,image/webp,image/x-icon" },
                { kind: "auth-background", label: "พื้นหลังหน้าเข้าสู่ระบบ", value: settings.authBackgroundUrl, hint: "1920 × 1080 px", accept: "image/png,image/jpeg,image/webp" },
              ];
              return (
                <div className="gst">
                  <section className="msp-card">
                    <header className="msp-head">
                      <span className="msp-mark"><Globe size={18} /></span>
                      <div>
                        <h3>ข้อมูลเว็บไซต์</h3>
                        <p>ชื่อและคำอธิบายของเว็บ</p>
                      </div>
                    </header>
                    <div className="msp-rows">
                      <div className="msp-row">
                        <label className="msp-label" htmlFor="brand-name">
                          <strong>ชื่อแบรนด์</strong>
                          <span>ขึ้นบนแถบเมนู</span>
                        </label>
                        <div className="gst-field">
                          <input id="brand-name" className="msp-input" maxLength={50} autoComplete="organization" value={settings.brandName} onChange={(e) => set("brandName", e.target.value)} />
                          <small className="gst-count">{settings.brandName.length}/50</small>
                        </div>
                      </div>
                      <div className="msp-row is-top">
                        <label className="msp-label" htmlFor="site-title">
                          <strong>ชื่อบนแท็บเบราว์เซอร์</strong>
                          <span>ต่อท้ายชื่อหน้า หรือใช้ชื่อเดียวทุกหน้า</span>
                        </label>
                        <div className="gst-field">
                          <div className="gst-seg" role="radiogroup" aria-label="รูปแบบชื่อบนแท็บ">
                            <button type="button" role="radio" aria-checked={settings.siteTitleMode === "page"} className={settings.siteTitleMode === "page" ? "is-active" : ""} onClick={() => set("siteTitleMode", "page")}>ต่อท้ายชื่อหน้า</button>
                            <button type="button" role="radio" aria-checked={settings.siteTitleMode === "custom"} className={settings.siteTitleMode === "custom" ? "is-active" : ""} onClick={() => set("siteTitleMode", "custom")}>ชื่อเดียวทุกหน้า</button>
                          </div>
                          <input id="site-title" className="msp-input" maxLength={80} value={settings.siteTitle} onChange={(e) => set("siteTitle", e.target.value)} />
                          <div className="gst-tab" aria-label={`ตัวอย่างบนแท็บ: ${tabPreview}`}>
                            <span className="gst-tab-chip">
                              <img src={tabIcon} alt="" />
                              <span>{tabPreview}</span>
                              <X size={12} aria-hidden="true" />
                            </span>
                          </div>
                          <small className="gst-count">{settings.siteTitle.length}/80</small>
                        </div>
                      </div>
                      <div className="msp-row is-top">
                        <label className="msp-label" htmlFor="site-description">
                          <strong>คำอธิบายเว็บไซต์</strong>
                          <span>ขึ้นใน Google และตอนแชร์ลิงก์</span>
                        </label>
                        <div className="gst-field">
                          <textarea id="site-description" className="msp-input gst-textarea" rows={3} maxLength={180} value={settings.siteDescription} onChange={(e) => set("siteDescription", e.target.value)} />
                          <small className="gst-count">{settings.siteDescription.length}/180</small>
                        </div>
                      </div>
                    </div>
                  </section>

                  <div className="gst-stack">
                  <section className="msp-card">
                    <header className="msp-head">
                      <span className="msp-mark"><SlidersHorizontal size={18} /></span>
                      <div>
                        <h3>หน้าตา</h3>
                        <p>หน้านี้เปลี่ยนให้ดูก่อน คนอื่นเห็นหลังกดบันทึก</p>
                      </div>
                    </header>
                    <div className="msp-rows">
                      <div className="msp-row is-inline">
                        <label className="msp-label" htmlFor="primary-color-hex">
                          <strong>สีหลัก</strong>
                          <span>สีปุ่มและลิงก์</span>
                        </label>
                        <div className="gst-color">
                          <label className="gst-swatch" style={{ background: settings.primaryColor }} title="เลือกสี">
                            <input type="color" aria-label="เลือกสีหลัก" value={settings.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
                          </label>
                          <input
                            id="primary-color-hex"
                            key={settings.primaryColor}
                            className="msp-input gst-hex"
                            defaultValue={settings.primaryColor.toUpperCase()}
                            maxLength={7}
                            spellCheck={false}
                            autoComplete="off"
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
                            onBlur={(e) => {
                              const raw = e.currentTarget.value.trim().replace(/^#?/, "#");
                              if (/^#[0-9a-f]{6}$/i.test(raw)) set("primaryColor", raw.toLowerCase());
                              else e.currentTarget.value = settings.primaryColor.toUpperCase();
                            }}
                          />
                        </div>
                      </div>
                      <div className="msp-row is-inline">
                        <div className="msp-label">
                          <strong>ธีม</strong>
                          <span>ทุกคนเห็นเหมือนกัน</span>
                        </div>
                        <div className="gst-seg" role="radiogroup" aria-label="ธีม">
                          <button type="button" role="radio" aria-checked={settings.themeMode === "light"} className={settings.themeMode === "light" ? "is-active" : ""} onClick={() => set("themeMode", "light")}><Sun size={15} aria-hidden="true" /> สว่าง</button>
                          <button type="button" role="radio" aria-checked={settings.themeMode === "dark"} className={settings.themeMode === "dark" ? "is-active" : ""} onClick={() => set("themeMode", "dark")}><Moon size={15} aria-hidden="true" /> มืด</button>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="msp-card" id="store-switch">
                    <header className="msp-head">
                      <span className="msp-mark"><Store size={18} /></span>
                      <div>
                        <h3>ร้านค้าและการเติมเงิน</h3>
                        <p>ปิดได้ถ้าจะหยุดขายชั่วคราว</p>
                      </div>
                      <span className={`msp-state ${settings.storeEnabled ? "is-ok" : "is-wait"}`}><i />{settings.storeEnabled ? "เปิดอยู่" : "ปิดอยู่"}</span>
                    </header>
                    <div className="msp-rows">
                      <div className="msp-row is-switch">
                        <div className="msp-label">
                          <strong>เปิดร้านค้า</strong>
                          <span>{settings.storeEnabled ? "ซื้อของและเติมเงินได้ตามปกติ" : "ซื้อและเติมเงินไม่ได้ เมนูร้านค้าถูกซ่อน ของที่ซื้อแล้วยังโหลดได้"}</span>
                        </div>
                        <div><Toggle label={settings.storeEnabled ? "เปิด" : "ปิด"} checked={settings.storeEnabled} onChange={(value) => set("storeEnabled", value)} /></div>
                      </div>
                      {!settings.storeEnabled && (
                        <div className="msp-row">
                          <label className="msp-label" htmlFor="store-closed-message">
                            <strong>ข้อความแจ้งลูกค้า</strong>
                            <span>ขึ้นในหน้าร้านค้า เว้นว่างได้</span>
                          </label>
                          <div className="gst-field">
                            <input id="store-closed-message" className="msp-input" maxLength={200} value={settings.storeClosedMessage || ""} onChange={(e) => set("storeClosedMessage", e.target.value)} placeholder="ซื้อสินค้าและเติมเงินไม่ได้ในขณะนี้" />
                            <small className="gst-count">{(settings.storeClosedMessage || "").length}/200</small>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  </div>

                  <section className="msp-card gst-wide">
                    <header className="msp-head">
                      <span className="msp-mark"><FileImage size={18} /></span>
                      <div>
                        <h3>รูปแบรนด์</h3>
                        <p>ไม่เกิน 5MB อัปโหลดหรือลบแล้วใช้ทันที</p>
                      </div>
                    </header>
                    <div className="gst-assets">
                      {assets.map((asset) => {
                        const src = asset.value ? normalizeAssetUrl(asset.value) : "";
                        const busy = uploading === asset.kind;
                        return (
                          <div className="gst-asset" key={asset.kind}>
                            <div className={`gst-asset-preview is-${asset.kind}${asset.kind === "auth-background" && settings.authBackgroundTintEnabled ? " is-tinted" : ""}`}>
                              {src ? (
                                <button type="button" className="gst-asset-view" onClick={() => setAssetPreview({ src, label: asset.label })} aria-label={`ดู${asset.label}ขนาดเต็ม`}>
                                  <SmartImage src={src} alt="" />
                                </button>
                              ) : (
                                <span className="gst-asset-empty"><FileImage size={22} aria-hidden="true" />ยังไม่มีรูป</span>
                              )}
                            </div>
                            <div className="gst-asset-copy">
                              <strong>{asset.label}</strong>
                              <small>{asset.hint}</small>
                            </div>
                            {asset.kind === "auth-background" && (
                              <div className="gst-asset-tint">
                                <span>ย้อมสีตามสีหลัก</span>
                                <Toggle label={settings.authBackgroundTintEnabled ? "เปิด" : "ปิด"} checked={settings.authBackgroundTintEnabled} onChange={(value) => set("authBackgroundTintEnabled", value)} />
                              </div>
                            )}
                            <div className="gst-asset-actions">
                              <label className={`hv-btn gst-upload${busy ? " is-busy" : ""}`}>
                                {busy ? <span className="hv-spinner" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
                                {busy ? "กำลังอัปโหลด..." : src ? "เปลี่ยนรูป" : "อัปโหลด"}
                                <input type="file" accept={asset.accept} disabled={Boolean(uploading)} onChange={(e) => {
                                  const input = e.currentTarget;
                                  void upload(asset.kind, input.files?.[0]).finally(() => { input.value = ""; });
                                }} hidden />
                              </label>
                              {src && (
                                <button type="button" className="hv-btn hv-icon-btn hv-btn-danger-ghost" onClick={() => removeAsset(asset.kind, asset.label)} disabled={Boolean(uploading)} aria-label={`ลบ${asset.label}`} title="ลบรูป">
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="msp-card gst-wide">
                    <header className="msp-head">
                      <span className="msp-mark"><Share2 size={18} /></span>
                      <div>
                        <h3>การ์ดตอนแชร์ลิงก์</h3>
                        <p>ตอนแชร์ลิงก์ใน Discord, Facebook, X และ LINE เว้นว่างไว้จะใช้ชื่อและคำอธิบายเว็บ</p>
                      </div>
                    </header>
                    <div className="gst-og">
                      <div className="gst-og-controls">
                        <div className="gst-og-field">
                          <span className="gst-og-label">ขนาดรูปในการ์ด</span>
                          <div className="gst-seg" role="radiogroup" aria-label="ขนาดรูปในการ์ด">
                            <button type="button" role="radio" aria-checked={isLarge} className={isLarge ? "is-active" : ""} onClick={() => set("ogCardType", "summary_large_image")}><LayoutGrid size={15} aria-hidden="true" /> รูปใหญ่</button>
                            <button type="button" role="radio" aria-checked={!isLarge} className={!isLarge ? "is-active" : ""} onClick={() => set("ogCardType", "summary")}><List size={15} aria-hidden="true" /> รูปเล็ก</button>
                          </div>
                        </div>
                        <div className="gst-og-field">
                          <label className="gst-og-label" htmlFor="og-title">หัวข้อ</label>
                          <input id="og-title" className="msp-input" maxLength={150} value={settings.ogTitle || ""} onChange={(e) => set("ogTitle", e.target.value)} placeholder={settings.siteTitle || settings.brandName || "NEXORA CLOUD"} />
                          <small className="gst-count">{(settings.ogTitle || "").length}/150</small>
                        </div>
                        <div className="gst-og-field">
                          <label className="gst-og-label" htmlFor="og-description">คำอธิบาย</label>
                          <textarea id="og-description" className="msp-input gst-textarea" rows={3} maxLength={300} value={settings.ogDescription || ""} onChange={(e) => set("ogDescription", e.target.value)} placeholder={settings.siteDescription || "ศูนย์รวมร้านค้า สินค้าเกม และไอเท็มชิ้นโปรดของคุณ"} />
                          <small className="gst-count">{(settings.ogDescription || "").length}/300</small>
                        </div>
                        <div className="gst-og-field is-inline">
                          <span className="gst-og-label">สีแถบข้างการ์ด (Discord)</span>
                          <div className="gst-color">
                            <label className="gst-swatch" style={{ background: settings.ogColor || "#5e5ee6" }} title="เลือกสี">
                              <input type="color" aria-label="เลือกสีแถบข้างการ์ด" value={settings.ogColor || "#5e5ee6"} onChange={(e) => set("ogColor", e.target.value)} />
                            </label>
                            <span className="gst-hex-text">{(settings.ogColor || "#5e5ee6").toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="gst-og-field">
                          <span className="gst-og-label">รูปปก <small>1200 × 630 px ไม่ใส่จะใช้โลโก้</small></span>
                          <div className="gst-og-image">
                            {settings.ogImageUrl ? <img src={normalizeAssetUrl(settings.ogImageUrl)} alt="" /> : <span className="gst-og-image-empty"><FileImage size={18} aria-hidden="true" /></span>}
                            <div>
                              <div className="gst-asset-actions">
                                <label className={`hv-btn gst-upload${uploading === "og-image" ? " is-busy" : ""}`}>
                                  {uploading === "og-image" ? <span className="hv-spinner" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
                                  {uploading === "og-image" ? "กำลังอัปโหลด..." : settings.ogImageUrl ? "เปลี่ยนรูป" : "อัปโหลด"}
                                  <input type="file" accept="image/png,image/jpeg,image/webp" disabled={Boolean(uploading)} onChange={(e) => { const input = e.currentTarget; void upload("og-image", input.files?.[0]).finally(() => { input.value = ""; }); }} hidden />
                                </label>
                                {settings.ogImageUrl && (
                                  <button type="button" className="hv-btn hv-icon-btn hv-btn-danger-ghost" onClick={() => removeAsset("og-image", "รูปปกแชร์ลิงก์")} disabled={Boolean(uploading)} aria-label="ลบรูปปก" title="ลบรูป">
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="og-preview-col">
                          <div className="og-preview-sticky">
                            <div className="og-preview-tabs" role="tablist">
                              {(["discord", "facebook", "x", "line"] as const).map((p) => (
                                <button key={p} type="button" role="tab" className={`og-tab${(ogPreviewTab || "discord") === p ? " active" : ""}`} onClick={() => setOgPreviewTab(p)}>
                                  {p === "discord" ? "Discord" : p === "facebook" ? "Facebook" : p === "x" ? "X (Twitter)" : "LINE"}
                                </button>
                              ))}
                            </div>

                            {/* Discord Preview */}
                            {(ogPreviewTab || "discord") === "discord" && (
                              <div className="og-preview-pane og-discord">
                                <div className="dsc-msg">
                                  <div className="dsc-avatar"><img src={ogIcon} alt="" /></div>
                                  <div className="dsc-body">
                                    <div className="dsc-meta">
                                      <span className="dsc-name">{settings.brandName || "NEXORA"}</span>
                                      <span className="dsc-badge">BOT</span>
                                      <span className="dsc-time">วันนี้ เวลา {new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
                                    </div>
                                    <span className="dsc-link">{ogUrl}</span>
                                    <div className="dsc-embed" style={{ borderLeftColor: settings.ogColor || "#5e5ee6" }}>
                                      <span className="dsc-provider">{settings.brandName || "NEXORA CLOUD"}</span>
                                      {isLarge ? (
                                        <>
                                          <span className="dsc-title">{ogTitle}</span>
                                          <p className="dsc-desc">{ogDesc}</p>
                                          <div className="dsc-banner"><img src={ogImg} alt="" /></div>
                                        </>
                                      ) : (
                                        <div className="dsc-compact">
                                          <div className="dsc-text-col">
                                            <span className="dsc-title">{ogTitle}</span>
                                            <p className="dsc-desc">{ogDesc}</p>
                                          </div>
                                          <div className="dsc-thumb"><img src={ogImg} alt="" /></div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Facebook Preview */}
                            {ogPreviewTab === "facebook" && (
                              <div className="og-preview-pane og-facebook">
                                <div className="fb-card">
                                  <div className="fb-header">
                                    <div className="fb-avatar"><img src={ogIcon} alt="" /></div>
                                    <div className="fb-meta">
                                      <strong>{settings.brandName || "NEXORA"}</strong>
                                      <span>แชร์ลิงก์ · เมื่อสักครู่</span>
                                    </div>
                                  </div>
                                  <div className="fb-embed">
                                    {isLarge && <div className="fb-banner"><img src={ogImg} alt="" /></div>}
                                    <div className="fb-info">
                                      <span className="fb-domain">{ogDomain.toUpperCase()}</span>
                                      <strong className="fb-title">{ogTitle}</strong>
                                      <p className="fb-desc">{ogDesc}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* X (Twitter) Preview */}
                            {ogPreviewTab === "x" && (
                              <div className="og-preview-pane og-twitter">
                                <div className="tw-card">
                                  {isLarge ? (
                                    <>
                                      <div className="tw-banner"><img src={ogImg} alt="" /></div>
                                      <div className="tw-info">
                                        <strong className="tw-title">{ogTitle}</strong>
                                        <p className="tw-desc">{ogDesc}</p>
                                        <span className="tw-domain"><Link2 size={12} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />{ogDomain}</span>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="tw-compact">
                                      <div className="tw-thumb"><img src={ogImg} alt="" /></div>
                                      <div className="tw-info">
                                        <strong className="tw-title">{ogTitle}</strong>
                                        <p className="tw-desc">{ogDesc}</p>
                                        <span className="tw-domain"><Link2 size={12} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />{ogDomain}</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* LINE Preview */}
                            {ogPreviewTab === "line" && (
                              <div className="og-preview-pane og-line">
                                <div className="line-bubble">
                                  <div className="line-card">
                                    <div className="line-banner"><img src={ogImg} alt="" /></div>
                                    <div className="line-info">
                                      <strong className="line-title">{ogTitle}</strong>
                                      <p className="line-desc">{ogDesc}</p>
                                      <span className="line-domain">{ogDomain}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                    </div>
                  </section>
                </div>
              );
            })()}

            {activeTab === "auth" && (
              <div style={{ display: 'grid', gap: '24px' }}>
                {/* Section 1: การเข้าสู่ระบบ (Login Settings) */}
                <div className="premium-settings-card">
                  <div className="settings-card-header">
                    <div className="sch-icon login">
                      <KeyRound size={20} />
                    </div>
                    <div>
                      <h3>หน้าเข้าสู่ระบบ</h3>
                      <p>ข้อความบนหน้า และระยะเวลาที่อยู่ในระบบได้</p>
                    </div>
                  </div>

                  <SettingRow title="หัวข้อ" description="บรรทัดแรกบนหน้าเข้าสู่ระบบ">
                    <input
                      className="premium-input"
                      value={settings.loginTitle}
                      onChange={(e) => set("loginTitle", e.target.value)}
                      placeholder="ยินดีต้อนรับกลับมา"
                    />
                  </SettingRow>

                  <SettingRow title="คำอธิบาย" description="บรรทัดที่สองใต้หัวข้อ">
                    <input
                      className="premium-input"
                      value={settings.loginSubtitle}
                      onChange={(e) => set("loginSubtitle", e.target.value)}
                      placeholder="ลงชื่อเข้าใช้ NEXORA CLOUD"
                    />
                  </SettingRow>

                  <SettingRow title="เข้าสู่ระบบด้วยรหัสผ่าน" description="ปิดแล้วเข้าได้เฉพาะ Discord, Google หรือ GitHub">
                    <Toggle
                      label={settings.localLoginEnabled ? "เปิด" : "ปิด"}
                      checked={settings.localLoginEnabled}
                      onChange={(value) => set("localLoginEnabled", value)}
                    />
                  </SettingRow>

                  <SettingRow
                    title="อยู่ในระบบได้นานแค่ไหน"
                    description="ไม่ได้ใช้งานเกินนี้ต้องเข้าสู่ระบบใหม่ มีผลกับการเข้าสู่ระบบครั้งถัดไป"
                  >
                    <div style={{ display: 'grid', gap: '10px', width: '100%', maxWidth: '420px' }}>
                      <div className="session-ttl-input-wrap">
                        <input
                          type="number"
                          className="premium-input"
                          min={15}
                          max={43200}
                          value={settings.sessionTtlMinutes}
                          onChange={(e) => set("sessionTtlMinutes", Number(e.target.value))}
                        />
                        <span className="ttl-unit-tag">นาที</span>
                      </div>
                      <div className="ttl-preset-pills">
                        <span className="ttl-hint-text" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          เท่ากับ <strong>{settings.sessionTtlMinutes >= 1440 ? `${Number((settings.sessionTtlMinutes / 1440).toFixed(1)).toLocaleString("th-TH")} วัน` : `${Number((settings.sessionTtlMinutes / 60).toFixed(1)).toLocaleString("th-TH")} ชั่วโมง`}</strong>
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {[
                            { label: "1 วัน", mins: 1440 },
                            { label: "7 วัน", mins: 10080 },
                            { label: "30 วัน", mins: 43200 }
                          ].map(preset => (
                            <button
                              key={preset.mins}
                              type="button"
                              className={`ttl-preset-btn ${settings.sessionTtlMinutes === preset.mins ? 'active' : ''}`}
                              onClick={() => set("sessionTtlMinutes", preset.mins)}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </SettingRow>
                </div>

                {/* Section 2: การสมัครสมาชิก (Registration Settings) */}
                <div className="premium-settings-card">
                  <div className="settings-card-header">
                    <div className="sch-icon register">
                      <User size={20} />
                    </div>
                    <div>
                      <h3>หน้าสมัครสมาชิก</h3>
                      <p>ข้อความบนหน้า และเปิดหรือปิดรับสมัคร</p>
                    </div>
                  </div>

                  <SettingRow title="หัวข้อ" description="บรรทัดแรกบนหน้าสมัครสมาชิก">
                    <input
                      className="premium-input"
                      value={settings.registerTitle}
                      onChange={(e) => set("registerTitle", e.target.value)}
                      placeholder="เริ่มต้นกับ NEXORA"
                    />
                  </SettingRow>

                  <SettingRow title="คำอธิบาย" description="บรรทัดที่สองใต้หัวข้อ">
                    <input
                      className="premium-input"
                      value={settings.registerSubtitle}
                      onChange={(e) => set("registerSubtitle", e.target.value)}
                      placeholder="สร้างบัญชีเพื่อเริ่มใช้งาน Cloud"
                    />
                  </SettingRow>

                  <SettingRow
                    title="รับสมัครสมาชิก"
                    description="ปิดแล้วสมัครใหม่ไม่ได้ทุกช่องทาง แอดมินยังเพิ่มผู้ใช้เองได้"
                  >
                    <Toggle
                      label={settings.registrationEnabled ? "เปิด" : "ปิด"}
                      checked={settings.registrationEnabled}
                      onChange={(value) => set("registrationEnabled", value)}
                    />
                  </SettingRow>
                </div>
              </div>
            )}

            {activeTab === "social" && (
              <div className="oauth-settings-panel">
                <div className="premium-alert info">
                  <Info size={18} />
                  <div>
                    <strong>Callback URL ที่ต้องใส่ในหน้าตั้งค่าแอปของแต่ละเจ้า</strong>
                    <code>{typeof window !== "undefined" ? `${window.location.origin}/api/auth/oauth/[provider]/callback` : "/api/auth/oauth/[provider]/callback"}</code>
                  </div>
                </div>

                <div className="oauth-settings-grid">
                  {oauthProviders.map((provider) => (
                    <article className={`oauth-provider-card oauth-provider-${provider.key}`} key={provider.key}>
                      <header className="oauth-provider-header">
                        <span className="oauth-provider-icon" aria-hidden="true">
                          <img src={provider.icon} alt="" />
                        </span>
                        <div className="oauth-provider-copy">
                          <h3>{provider.name}</h3>
                          <p>{provider.description}</p>
                        </div>
                        <Toggle
                          label={settings[provider.enabled] ? "เปิด" : "ปิด"}
                          checked={settings[provider.enabled]}
                          onChange={(value) => set(provider.enabled, value)}
                        />
                      </header>

                      <div className="oauth-provider-state">
                        {settings[provider.configured]
                          ? <span className="badge success">ใส่คีย์แล้ว</span>
                          : <span className="badge warning">ยังไม่ได้ใส่คีย์</span>}
                      </div>

                      <div className="oauth-provider-fields">
                        <div className="input-group">
                          <div className="oauth-field-label">
                            <label htmlFor={`${provider.key}-client-id`}>Client ID</label>
                            {settings[provider.configured] && <span>บันทึกไว้แล้ว</span>}
                          </div>
                          <input
                            id={`${provider.key}-client-id`}
                            className="premium-input"
                            autoComplete="off"
                            value={settings[provider.id] || ""}
                            onChange={(e) => set(provider.id, e.target.value)}
                            placeholder={settings[provider.configured] ? "ใส่เมื่อจะเปลี่ยน" : `Client ID ของ ${provider.name}`}
                          />
                        </div>
                        <div className="input-group">
                          <div className="oauth-field-label">
                            <label htmlFor={`${provider.key}-client-secret`}>Client Secret</label>
                            {settings[provider.configured] && <span>บันทึกไว้แล้ว</span>}
                          </div>
                          <input
                            id={`${provider.key}-client-secret`}
                            className="premium-input"
                            type="password"
                            autoComplete="new-password"
                            value={settings[provider.secret] || ""}
                            onChange={(e) => set(provider.secret, e.target.value)}
                            placeholder={settings[provider.configured] ? "ใส่เมื่อจะเปลี่ยน" : "Client Secret"}
                          />
                        </div>
                      </div>

                      {settings[provider.configured] && (
                        <button
                          type="button"
                          className="oauth-remove-credential"
                          onClick={() => ask({
                            title: `ลบข้อมูล ${provider.name}?`,
                            message: `ปิดการเข้าสู่ระบบด้วย ${provider.name} และลบ Client ID กับ Client Secret เมื่อกดบันทึก`,
                            confirmLabel: "ลบข้อมูล",
                            danger: true,
                            action: () => setSettings((current) => current ? {
                              ...current,
                              [provider.clear]: true,
                              [provider.enabled]: false,
                              [provider.id]: "",
                              [provider.secret]: "",
                            } : current),
                          })}
                        >
                          ลบข้อมูล
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "notifications" && (() => {
              const chosen = settings.webhookEvents || [];
              const selectedCount = webhookEventKeys.filter((key) => chosen.includes(key)).length;
              const saved = settings.webhookConfigured && !settings.clearDiscordWebhook;
              const typed = Boolean(settings.discordWebhookUrl?.trim());
              const hasWebhook = saved || typed;
              const state = !hasWebhook
                ? { className: "is-bad", text: "ยังไม่มี URL" }
                : !settings.webhookEnabled
                  ? { className: "is-wait", text: "ปิดอยู่" }
                  : typed
                    ? { className: "is-wait", text: "รอบันทึก" }
                    : { className: "is-ok", text: "กำลังส่ง" };
              const setEvents = (keys: string[], on: boolean) => set("webhookEvents", on
                ? Array.from(new Set([...chosen, ...keys]))
                : chosen.filter((key) => !keys.includes(key)));
              return (
                <div className="ntf">
                  <section className="msp-card">
                    <header className="msp-head">
                      <span className="msp-mark"><Send size={18} /></span>
                      <div>
                        <h3>ส่งเข้า Discord <small>NEXORA Security</small></h3>
                        <p>โพสต์เข้าห้อง Discord ทันทีที่เกิดเหตุการณ์ที่เลือกไว้ด้านล่าง</p>
                      </div>
                      <span className={`msp-state ${state.className}`}><i />{state.text}</span>
                    </header>
                    <div className="msp-rows">
                      <div className="msp-row">
                        <label className="msp-label" htmlFor="security-webhook-url">
                          <strong>Webhook URL</strong>
                          <span>ใน Discord: ตั้งค่าห้อง → Integrations → Webhooks → คัดลอก URL</span>
                        </label>
                        <div className="ntf-field">
                          <div className="ntf-url">
                            <Link2 size={16} aria-hidden="true" />
                            <input id="security-webhook-url" type="password" autoComplete="off" spellCheck={false}
                              value={settings.discordWebhookUrl || ""}
                              onChange={(e) => set("discordWebhookUrl", e.target.value)}
                              placeholder={saved ? "บันทึกไว้แล้ว · วาง URL ใหม่ถ้าจะเปลี่ยนห้อง" : "https://discord.com/api/webhooks/…"} />
                            <button type="button" className="ntf-btn is-sm" onClick={testWebhook} disabled={!hasWebhook}>
                              <Send size={14} /> ส่งทดสอบ
                            </button>
                          </div>
                          <div className="ntf-field-note">
                            {settings.clearDiscordWebhook ? (
                              <>
                                <span>จะลบ URL ที่บันทึกไว้เมื่อกดบันทึก</span>
                                <button type="button" className="ntf-btn is-ghost is-xs" onClick={() => setSettings({ ...settings, clearDiscordWebhook: false })}>ยกเลิก</button>
                              </>
                            ) : saved ? (
                              <>
                                <span><Check size={13} /> บันทึก URL ไว้แล้ว ไม่แสดงเต็มเพื่อกันคนอื่นเห็น</span>
                                <button type="button" className="ntf-btn is-ghost is-danger is-xs" onClick={() => setSettings({ ...settings, clearDiscordWebhook: true, webhookEnabled: false, discordWebhookUrl: "" })}>
                                  <Trash2 size={13} /> ลบ URL
                                </button>
                              </>
                            ) : (
                              <span>ส่งทดสอบก่อนบันทึกได้ ดูว่าเข้าห้องถูกไหม</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="msp-row is-switch">
                        <div className="msp-label">
                          <strong>ส่งแจ้งเตือน</strong>
                          <span>{settings.webhookEnabled ? "เปิดอยู่ โพสต์ทุกครั้งที่เกิดเหตุการณ์ที่เลือก" : "ปิดอยู่ URL และเหตุการณ์ที่เลือกยังเก็บไว้"}</span>
                        </div>
                        <div>
                          <Toggle label={settings.webhookEnabled ? "เปิด" : "ปิด"} checked={settings.webhookEnabled} disabled={!hasWebhook} onChange={(value) => set("webhookEnabled", value)} />
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="msp-card">
                    <header className="msp-head ntf-events-head">
                      <span className="msp-mark"><ListChecks size={18} /></span>
                      <div>
                        <h3>เหตุการณ์ที่จะแจ้ง</h3>
                        <p>เรื่องอีเมลตั้งแยกที่แท็บระบบอีเมล</p>
                      </div>
                      <div className="ntf-tools">
                        <div className="ntf-meter" aria-label={`เลือก ${selectedCount} จาก ${webhookEventKeys.length} เหตุการณ์`}>
                          <span><b>{selectedCount}</b> / {webhookEventKeys.length}</span>
                          <i><em style={{ width: `${(selectedCount / webhookEventKeys.length) * 100}%` }} /></i>
                        </div>
                        <div className="ntf-seg" role="group" aria-label="เลือกเหตุการณ์ทั้งหมด">
                          <button type="button" className="ntf-btn" onClick={() => setEvents(webhookEventKeys, true)} disabled={selectedCount === webhookEventKeys.length}><CheckCheck size={14} /> เลือกทั้งหมด</button>
                          <button type="button" className="ntf-btn" onClick={() => setEvents(webhookEventKeys, false)} disabled={selectedCount === 0}><X size={14} /> ล้าง</button>
                        </div>
                      </div>
                    </header>
                    {webhookCategories.map((category) => {
                      const keys = category.events.map((event) => event.key);
                      const count = keys.filter((key) => chosen.includes(key)).length;
                      return (
                        <div key={category.id} className="ntf-group" role="group" aria-labelledby={`ntf-group-${category.id}`}>
                          <div className="ntf-group-head">
                            <label className="ntf-group-check">
                              <input type="checkbox" className="nx-check" checked={count === keys.length}
                                ref={(el) => { if (el) el.indeterminate = count > 0 && count < keys.length; }}
                                onChange={(e) => setEvents(keys, e.target.checked)} />
                              <span className="ntf-group-icon">{category.icon}</span>
                              <span>
                                <strong id={`ntf-group-${category.id}`}>{category.title}</strong>
                                <small>{category.description}</small>
                              </span>
                            </label>
                            <span className={`ntf-count${count === keys.length ? " is-all" : count === 0 ? " is-none" : ""}`}>{count}/{keys.length}</span>
                          </div>
                          <div className="ntf-events">
                            {category.events.map((event) => {
                              const on = chosen.includes(event.key);
                              return (
                                <label key={event.key} className={`ntf-event${on ? " is-on" : ""}`}>
                                  <input type="checkbox" className="nx-check" checked={on} onChange={(e) => setEvents([event.key], e.target.checked)} />
                                  <span>
                                    <strong>{event.label}</strong>
                                    <small>{event.desc}</small>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                </div>
              );
            })()}

            {activeTab === "danger" && (
              <div className="premium-settings-card danger-card">
                <div className="danger-header">
                  <ShieldCheck size={24} />
                  <div>
                    <h3>ระวัง กระทบทุกคน</h3>
                    <p>กดแล้วมีผลทันที</p>
                  </div>
                </div>

                <SettingRow title="ล็อกเว็บไซต์" description="ปิด nkn02.com และ API ทุกบัญชี ส่วนเว็บลูกค้า ฐานข้อมูล และเมลยังทำงาน">
                  <div className="lockdown-settings-control">
                    <strong>{lockdown?.enabled ? "ล็อกอยู่" : "เปิดอยู่"}</strong>
                    <input className="premium-input" value={lockdownDuration} onChange={(event) => setLockdownDuration(event.target.value)} placeholder="นานเท่าไร เช่น 30m, 2h ว่างไว้ = จนกว่าจะปลด" aria-label="ระยะเวลาล็อก" />
                    <input className="premium-input" value={lockdownReason} onChange={(event) => setLockdownReason(event.target.value)} maxLength={200} placeholder="เหตุผล (ไม่ใส่ก็ได้)" aria-label="เหตุผลที่ล็อก" />
                    <button type="button" className="premium-btn danger-filled" onClick={() => {
                      let durationSeconds = 0;
                      try { durationSeconds = parseLockdownDuration(lockdownDuration); }
                      catch (error) { notify({ kind:"error",text:(error as Error).message }); return; }
                      ask({ title:"ล็อกเว็บไซต์ตอนนี้?",message:"ทุกบัญชีจะเข้าเว็บหลักและ API ไม่ได้ ปลดได้ทาง Discord หรือ lock.nove666.pro เท่านั้น",confirmLabel:"ล็อกเว็บไซต์",danger:true,action:async() => {
                        const value = await api<LockdownState>("/api/admin/lockdown", { method:"PATCH",body:JSON.stringify({ enabled:true,durationSeconds,reason:lockdownReason }) });
                        setLockdown(value);
                        window.location.href = "/";
                      }});
                    }}>ล็อกเว็บไซต์</button>
                  </div>
                </SettingRow>
                
                <SettingRow title="ให้ทุกคนออกจากระบบ" description="ทุกบัญชีรวมถึงของคุณต้องเข้าสู่ระบบใหม่">
                  <button type="button" className="premium-btn danger-filled" onClick={() => ask({ title: "ให้ทุกคนออกจากระบบ?", message: "ทุกบัญชีหลุดทันที รวมถึงของคุณ", confirmLabel: "ออกจากระบบทั้งหมด", danger: true, action: async () => { await api("/api/admin/settings/revoke-all-sessions", { method: "POST" }); window.location.href = "/"; } })}>
                    ออกจากระบบทั้งหมด
                  </button>
                </SettingRow>
              </div>
            )}
          </div>

          <div className={`premium-save-bar ${isDirty ? "has-changes" : ""}${saveStatus.className === "idle" ? " is-idle" : ""}`} aria-hidden={saveStatus.className === "idle" || undefined}>
            <div className="psb-status" role="status" aria-live="polite">
              <span className={`psb-dot ${saveStatus.className}`} />
              <span>{saveStatus.text}</span>
            </div>
            <button className="premium-btn primary-filled" disabled={!isDirty || saveState === "saving"}>
              <Save size={16} /> {saveState === "saving" ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </form>
        )}
      </div>
      {assetPreview && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAssetPreview(null)}>
          <section className="hv-dialog gst-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-preview-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <div className="hv-dh-text">
                  <small>ขนาดเต็ม</small>
                  <h2 id="asset-preview-title">{assetPreview.label}</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setAssetPreview(null)} aria-label="ปิด" autoFocus><X size={18} /></button>
            </header>
            <div className="gst-preview-stage">
              <img src={assetPreview.src} alt={assetPreview.label} />
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

type HomepageFlags = Pick<SettingsData, "storeSectionEnabled" | "quickActionsEnabled" | "footerEnabled">;

const homepageFlags = (value: SettingsData): HomepageFlags => ({
  storeSectionEnabled: value.storeSectionEnabled,
  quickActionsEnabled: value.quickActionsEnabled,
  footerEnabled: value.footerEnabled,
});

function HomepageSettingsView({ notify }: { notify: (notice: { kind: "success" | "error"; text: string }) => void }) {
  const [flags, setFlags] = useState<HomepageFlags | null>(null);
  const [savedFlags, setSavedFlags] = useState<HomepageFlags | null>(null);
  const [storeOpen, setStoreOpen] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const load = useCallback(() => api<SettingsData>("/api/admin/settings").then((value) => {
    setFlags(homepageFlags(value));
    setSavedFlags(homepageFlags(value));
    setStoreOpen(value.storeEnabled !== false);
    setLoadError("");
  }).catch((error) => setLoadError((error as Error).message || "โหลดไม่ได้")), []);
  useEffect(() => { void load(); }, [load]);

  const isDirty = Boolean(flags && savedFlags) && JSON.stringify(flags) !== JSON.stringify(savedFlags);
  // Sidebar links load a new page, so the browser's own "leave this page?" prompt covers them.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  if (!flags) {
    return loadError ? (
      <div className="aov-empty hv-empty gst-failed">
        <span>โหลดการตั้งค่าไม่ได้</span>
        <button type="button" onClick={() => { setLoadError(""); void load(); }}>ลองอีกครั้ง</button>
      </div>
    ) : <div className="dashboard-loading inline"><span /></div>;
  }

  const sections: Array<{ key: keyof HomepageFlags; title: string; on: string; off: string; icon: typeof Package }> = [
    {
      key: "quickActionsEnabled",
      title: "เมนูลัด",
      on: "ปุ่มไปซื้อของ เติมเงิน โฮสติ้ง และไฟล์ คนที่ยังไม่ล็อกอินจะเห็นปุ่มเข้าสู่ระบบกับสมัครสมาชิกแทน",
      off: "ไม่มีปุ่มลัดบนหน้าแรก",
      icon: Zap,
    },
    {
      key: "storeSectionEnabled",
      title: "สินค้า",
      on: "ช่องค้นหา หมวดหมู่ และการ์ดสินค้า",
      off: "ลิงก์ร้านค้าในแถบเมนูกับปุ่มซื้อของในเมนูลัดจะหายไปด้วย คนที่มีลิงก์ยังเปิดหน้าร้านค้าได้",
      icon: Package,
    },
    {
      key: "footerEnabled",
      title: "ส่วนท้าย",
      on: "โลโก้ ลิขสิทธิ์ และลิงก์ด้านล่างสุด ขึ้นทั้งหน้าแรกและหน้าร้านค้า",
      off: "ไม่มีส่วนท้ายทั้งในหน้าแรกและหน้าร้านค้า",
      icon: LayoutGrid,
    },
  ];
  const visibleCount = sections.filter((section) => flags[section.key]).length;
  // What a visitor actually gets: the store section also needs the store to be open.
  const shows = (key: keyof HomepageFlags) => flags[key] && (key !== "storeSectionEnabled" || storeOpen);
  const saveStatus = saveState === "saving"
    ? { className: "saving pulse", text: "กำลังบันทึก..." }
    : saveState === "error"
      ? { className: "error", text: "บันทึกไม่สำเร็จ ลองอีกครั้ง" }
      : isDirty
        ? { className: "dirty pulse", text: "ยังไม่ได้บันทึก" }
        : saveState === "saved"
          ? { className: "saved", text: "บันทึกแล้ว" }
          : { className: "idle", text: "ไม่มีอะไรเปลี่ยน" };

  const toggle = (key: keyof HomepageFlags, value: boolean) => {
    setFlags((current) => current ? { ...current, [key]: value } : current);
    setSaveState("idle");
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!isDirty || !flags || saveState === "saving") return;
    setSaveState("saving");
    try {
      // The API replaces every setting at once, so start from what is saved now rather than
      // from when this page was opened; changes made on the other settings tabs are kept.
      const latest = await api<SettingsData>("/api/admin/settings");
      const value = await api<SettingsData>("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ ...latest, ...flags }) });
      setFlags(homepageFlags(value));
      setSavedFlags(homepageFlags(value));
      setStoreOpen(value.storeEnabled !== false);
      setSaveState("saved");
      window.setTimeout(() => setSaveState((state) => state === "saved" ? "idle" : state), 2500);
      notify({ kind: "success", text: "บันทึกแล้ว" });
    } catch (error) {
      setSaveState("error");
      notify({ kind: "error", text: (error as Error).message });
    }
  }

  return (
    <div className="hpv">
      <header className="aov-head gst-head">
        <div>
          <p className="aov-eyebrow">ตั้งค่าระบบ</p>
          <h1>หน้าแรก</h1>
          <p className="aov-sub">เลือกว่าหน้าแรกจะมีส่วนไหนบ้าง</p>
        </div>
        <div className="aov-head-actions">
          <a className="aov-btn aov-btn-label" href="/" target="_blank" rel="noreferrer"><Eye size={16} aria-hidden="true" /> เปิดหน้าแรก</a>
        </div>
      </header>

      <form className="hpv-grid" onSubmit={save}>
        <section className="msp-card">
          <header className="msp-head">
            <span className="msp-mark"><LayoutGrid size={18} /></span>
            <div>
              <h3>ส่วนที่เปิดได้</h3>
              <p>เปิดอยู่ {visibleCount} จาก {sections.length} ส่วน เปลี่ยนแล้วกดบันทึกถึงจะมีผลกับทุกคน</p>
            </div>
          </header>
          <div className="msp-rows">
            {sections.map((section) => {
              const enabled = flags[section.key];
              const Icon = section.icon;
              const blocked = section.key === "storeSectionEnabled" && enabled && !storeOpen;
              return (
                <div className="msp-row is-switch hpv-row" key={section.key}>
                  <div className="msp-label">
                    <strong><Icon size={16} aria-hidden="true" /> {section.title}</strong>
                    <span>{enabled ? section.on : section.off}</span>
                    {blocked && (
                      <span className="hpv-note">
                        <CircleAlert size={14} aria-hidden="true" />
                        <span>ร้านค้าปิดอยู่ ส่วนนี้จะยังไม่ขึ้นจนกว่าจะเปิดร้าน <Link href="/admin/settings?tab=general#store-switch">ไปเปิดร้านค้า</Link></span>
                      </span>
                    )}
                  </div>
                  <div><Toggle label={enabled ? "แสดง" : "ซ่อน"} checked={enabled} onChange={(value) => toggle(section.key, value)} /></div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="msp-card hpv-map" aria-label="ลำดับบนหน้าแรก">
          <header className="msp-head">
            <span className="msp-mark"><Monitor size={18} /></span>
            <div>
              <h3>ลำดับบนหน้าแรก</h3>
              <p>ส่วนที่ซ่อนจะเป็นกรอบเส้นประ กดที่กรอบเพื่อสลับได้</p>
            </div>
          </header>
          <ol className="hpv-blocks">
            <li className="hpv-block is-fixed is-nav">
              <span>แถบเมนู</span>
              <small>{shows("storeSectionEnabled") ? "มีลิงก์ร้านค้า" : "ไม่มีลิงก์ร้านค้า"}</small>
            </li>
            <li className="hpv-block is-fixed is-banner">
              <span>ประกาศและแบนเนอร์</span>
              <small>ขึ้นเมื่อมีประกาศ</small>
            </li>
            {(["quickActionsEnabled", "storeSectionEnabled", "footerEnabled"] as const).map((key) => {
              const section = sections.find((item) => item.key === key)!;
              const visible = shows(key);
              return (
                <li key={key} className={`hpv-block is-${key === "quickActionsEnabled" ? "quick" : key === "storeSectionEnabled" ? "store" : "footer"}${visible ? "" : " is-off"}`}>
                  <button type="button" onClick={() => toggle(key, !flags[key])} aria-pressed={flags[key]} aria-label={`${flags[key] ? "ซ่อน" : "แสดง"}${section.title}`}>
                    <span>{section.title}</span>
                    <small>{visible ? "แสดง" : flags[key] ? "ร้านค้าปิดอยู่" : "ซ่อน"}</small>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <div className={`premium-save-bar ${isDirty ? "has-changes" : ""}${saveStatus.className === "idle" ? " is-idle" : ""}`} aria-hidden={saveStatus.className === "idle" || undefined}>
          <div className="psb-status" role="status" aria-live="polite">
            <span className={`psb-dot ${saveStatus.className}`} />
            <span>{saveStatus.text}</span>
          </div>
          <button className="premium-btn primary-filled" disabled={!isDirty || saveState === "saving"}>
            <Save size={16} /> {saveState === "saving" ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`modern-toggle-switch ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}`}>
      <span className="mts-label">{label}</span>
      <div className="mts-track">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="mts-thumb" />
      </div>
    </label>
  );
}

function CustomCategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: Array<{ id: number; name: string }>;
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedCat = categories.find((c) => String(c.id) === value);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          height: "44px",
          padding: "0 14px",
          borderRadius: "10px",
          border: `1.5px solid ${open ? "var(--primary)" : "var(--control-line)"}`,
          background: "var(--theme-input)",
          color: "var(--theme-text-strong)",
          fontSize: "13px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          transition: "border-color 0.15s, box-shadow 0.15s",
          outline: "none",
          boxShadow: open ? "0 0 0 3px rgb(var(--primary-rgb) / .15)" : "none",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: selectedCat ? "var(--primary)" : "var(--control-muted)", flexShrink: 0 }} />
          <span style={{ color: selectedCat ? "var(--theme-text-strong)" : "var(--control-muted)" }}>
            {selectedCat ? selectedCat.name : "— ไม่ระบุหมวดหมู่ —"}
          </span>
        </span>
        <ChevronDown size={15} style={{ transition: "transform 0.2s ease", transform: open ? "rotate(180deg)" : "rotate(0deg)", color: "var(--control-muted)", flexShrink: 0 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 10001,
            background: "var(--theme-elevated)",
            border: "1px solid var(--control-line)",
            borderRadius: "12px",
            boxShadow: "0 16px 36px rgba(0, 0, 0, 0.22)",
            padding: "6px",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          <div
            onClick={() => { onChange(""); setOpen(false); }}
            style={{
              padding: "9px 12px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: value === "" ? 600 : 400,
              color: value === "" ? "var(--primary)" : "var(--theme-text-strong)",
              background: value === "" ? "var(--primary-soft)" : "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              transition: "background 0.12s",
              marginBottom: "2px",
            }}
            onMouseEnter={e => { if (value !== "") e.currentTarget.style.background = "var(--theme-hover)"; }}
            onMouseLeave={e => { if (value !== "") e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--control-muted)" }} />
              ไม่ระบุหมวดหมู่
            </span>
            {value === "" && <CheckCircle size={14} style={{ color: "var(--primary)" }} />}
          </div>

          {categories.map((c) => {
            const isSelected = value === String(c.id);
            return (
              <div
                key={c.id}
                onClick={() => { onChange(String(c.id)); setOpen(false); }}
                style={{
                  padding: "9px 12px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? "var(--primary)" : "var(--theme-text-strong)",
                  background: isSelected ? "var(--primary-soft)" : "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justify: "space-between",
                  transition: "background 0.12s",
                  marginBottom: "2px",
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--theme-hover)"; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: isSelected ? "var(--primary)" : "var(--control-muted)" }} />
                  {c.name}
                </span>
                {isSelected && <CheckCircle size={14} style={{ color: "var(--primary)" }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilesView() {
  const [files, setFiles] = useState<Array<{ name: string; url: string; size: number; createdAt: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: number; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"grid"|"list">("list");
  const [autoAnimateRef] = useAutoAnimate<HTMLDivElement>();
  const [uploadCategory, setUploadCategory] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string; size: number; createdAt: string } | null>(null);
  // The blob made for the file being previewed; it is only shown while that file is open.
  const [previewBlob, setPreviewBlob] = useState<{ src: string; url: string | null } | null>(null);

  // Edit file details state
  const [editFile, setEditFile] = useState<{ name: string; url: string; size: number; createdAt: string } | null>(null);
  const [editDisplayName, setEditDisplayName] = useState<string>("");
  const [editCategory, setEditCategory] = useState<string>("");
  const [editSaved, setEditSaved] = useState<boolean>(false);

  const API = API_BASE;

  const previewSrc = previewFile ? (previewFile.url.startsWith("http") ? previewFile.url : `${API}${previewFile.url}`) : "";
  const previewLoading = Boolean(previewSrc) && previewBlob?.src !== previewSrc;
  const previewBlobUrl = previewBlob?.src === previewSrc ? previewBlob.url : null;
  useEffect(() => {
    if (!previewSrc) return;
    let live = true;
    let made: string | null = null;
    fetch(previewSrc).then(r => r.blob())
      .then(blob => {
        made = URL.createObjectURL(blob);
        if (live) setPreviewBlob({ src: previewSrc, url: made });
        else URL.revokeObjectURL(made);
      })
      .catch(() => { if (live) setPreviewBlob({ src: previewSrc, url: null }); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [previewSrc]);

  const fetchFiles = useCallback(() => Promise.all([
    fetch(`${API}/api/admin/files`, { credentials: "include" }),
    fetch(`${API}/api/admin/store/categories`, { credentials: "include" }),
  ]).then(async ([filesRes, catsRes]) => {
    if (filesRes.ok) { const d = await filesRes.json(); setFiles(d.items || []); }
    if (catsRes.ok) { const d = await catsRes.json(); setCategories(d.items || d.categories || []); }
  }).catch((err) => { console.error("fetch failed", err); })
    .finally(() => setLoading(false)), [API]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);
  // Reloads after a change show the spinner again; the first load starts with it on.
  const reloadFiles = useCallback(() => {
    setLoading(true);
    return fetchFiles();
  }, [fetchFiles]);

  const handleCopy = (url: string) => {
    const base = API_BASE || window.location.origin;
    const full = url.startsWith("http") ? url : `${base}${url}`;
    navigator.clipboard.writeText(full);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  // Delete confirmation state
  const [deleteTargetFile, setDeleteTargetFile] = useState<string | null>(null);

  const handleDelete = (filename: string) => {
    setDeleteTargetFile(filename);
  };

  const confirmDeleteFile = async () => {
    if (!deleteTargetFile) return;
    const filename = deleteTargetFile;
    setDeleteTargetFile(null);
    try {
      const res = await fetch(`${API}/api/admin/files?filename=${encodeURIComponent(filename)}`, { method: "DELETE", credentials: "include" });
      if (res.ok) reloadFiles();
    } catch (err) { console.error("delete failed", err); }
  };

  const handleOpenEdit = (file: { name: string; url: string; size: number; createdAt: string }) => {
    setEditFile(file);
    setEditDisplayName(file.name);
    setEditCategory("");
    setEditSaved(false);
  };

  const handleSaveEdit = () => {
    setEditSaved(true);
    setTimeout(() => {
      setEditSaved(false);
      setEditFile(null);
    }, 1200);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFileType = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["jpg","jpeg","png","gif","webp","svg","bmp","avif"].includes(ext)) return { label: "รูปภาพ", id: "image", color: "#3b82f6", bg: "rgba(59,130,246,0.1)" };
    if (["pdf","doc","docx","txt","xlsx","csv"].includes(ext)) return { label: "เอกสาร", id: "document", color: "#ef4444", bg: "rgba(239,68,68,0.1)" };
    if (["zip","rar","7z","tar","gz"].includes(ext)) return { label: "ไฟล์บีบอัด", id: "archive", color: "#f59e0b", bg: "rgba(245,158,11,0.1)" };
    if (["mp4","webm","mov","avi"].includes(ext)) return { label: "วิดีโอ", id: "video", color: "#8b5cf6", bg: "rgba(139,92,246,0.1)" };
    if (["mp3","wav","ogg","flac"].includes(ext)) return { label: "เสียง", id: "audio", color: "#ec4899", bg: "rgba(236,72,153,0.1)" };
    return { label: "ทั่วไป", id: "other", color: "var(--control-muted)", bg: "var(--theme-hover)" };
  };

  const isImage = (name: string) => /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/i.test(name);

  const filteredFiles = files.filter(f => {
    if (!f.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (typeFilter !== "all" && getFileType(f.name).id !== typeFilter) return false;
    return true;
  });

  const typeFilters = [
    { id: "all", label: "ทั้งหมด" },
    { id: "image", label: "รูปภาพ" },
    { id: "document", label: "เอกสาร" },
    { id: "video", label: "วิดีโอ" },
    { id: "archive", label: "ไฟล์บีบอัด" },
  ];

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <>
      {/* Header with Title + Upload Button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div className="dash-heading" style={{ margin: 0 }}>
          <p>ระบบ</p>
          <h1>คลังไฟล์</h1>
          <span>จัดเก็บ อัพโหลด และจัดการไฟล์ทั้งหมดในระบบ</span>
        </div>

        <button
          onClick={() => setShowUploadModal(true)}
          style={{
            height: "44px", padding: "0 20px", borderRadius: "10px", background: "var(--primary)",
            color: "#fff", fontWeight: 600, fontSize: "14px", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
            transition: "transform 0.1s, opacity 0.15s"
          }}
        >
          <UploadCloud size={18} />
          อัพโหลดไฟล์
        </button>
      </div>

      {/* Main File Browser Card (Full Width) */}
      <div className="dash-card" style={{ padding: "24px" }}>
        {/* Top Bar: Search, Stats, Filters, View Modes */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <div className="search" style={{ flex: 1, minWidth: "220px" }}>
            <Search size={14} />
            <input type="text" placeholder="ค้นหาชื่อไฟล์..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>

          <div style={{ display: "flex", gap: "16px", alignItems: "center", padding: "0 12px", fontSize: "12px", color: "var(--control-muted)" }}>
            <span>ไฟล์ทั้งหมด: <strong style={{ color: "var(--theme-text-strong)" }}>{files.length}</strong></span>
            <span>พื้นที่ใช้งาน: <strong style={{ color: "var(--theme-text-strong)" }}>{formatSize(totalBytes)}</strong></span>
          </div>

          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={() => reloadFiles()}
              style={{ height: "42px", padding: "0 12px", borderRadius: "9px", border: "1px solid var(--control-line)", background: "transparent", color: "var(--theme-text-strong)", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontSize: "13px" }}
              title="รีเฟรช"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
              style={{ height: "42px", padding: "0 12px", borderRadius: "9px", border: "1px solid var(--control-line)", background: "transparent", color: "var(--theme-text-strong)", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontSize: "13px" }}
              title={viewMode === "list" ? "มุมมองกริด" : "มุมมองตาราง"}
            >
              {viewMode === "list" ? <LayoutGrid size={15} /> : <List size={15} />}
            </button>
          </div>
        </div>

        {/* Type Filter Chips */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap" }}>
          {typeFilters.map(f => (
            <button
              key={f.id}
              onClick={() => setTypeFilter(f.id)}
              style={{
                padding: "5px 14px", borderRadius: "20px", fontSize: "12px", cursor: "pointer",
                border: `1px solid ${typeFilter === f.id ? "var(--primary)" : "var(--control-line)"}`,
                background: typeFilter === f.id ? "var(--primary)" : "transparent",
                color: typeFilter === f.id ? "#fff" : "var(--control-muted)",
                fontWeight: typeFilter === f.id ? 600 : 400,
                transition: "all 0.15s",
              }}
            >
              {f.label}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: "12px", color: "var(--control-muted)", alignSelf: "center" }}>
            {filteredFiles.length} / {files.length} รายการ
          </span>
        </div>

        {/* File List/Grid */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--control-muted)" }}>
            <RefreshCw size={24} style={{ margin: "0 auto 10px", opacity: 0.4 }} className="animate-spin" />
            <p style={{ fontSize: "14px" }}>กำลังโหลดไฟล์...</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px", border: "1px dashed var(--control-line)", borderRadius: "12px", color: "var(--control-muted)" }}>
            <FolderOpen size={36} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
            <p style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px", color: "var(--theme-text-strong)" }}>ไม่พบไฟล์</p>
            <p style={{ fontSize: "12px", marginBottom: "16px" }}>ยังไม่มีไฟล์ในระบบ หรือลองค้นหาใหม่</p>
            <button
              onClick={() => setShowUploadModal(true)}
              style={{ padding: "8px 16px", borderRadius: "8px", background: "var(--primary)", color: "#fff", fontSize: "13px", fontWeight: 600, border: "none", cursor: "pointer" }}
            >
              อัพโหลดไฟล์แรก
            </button>
          </div>
        ) : viewMode === "grid" ? (
          // Grid View
          <div ref={autoAnimateRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "14px" }}>
            {filteredFiles.map(file => {
              const ft = getFileType(file.name);
              const fileUrl = file.url.startsWith("http") ? file.url : `${API}${file.url}`;
              return (
                <div
                  key={file.name}
                  style={{ borderRadius: "12px", border: "1px solid var(--control-line)", overflow: "hidden", background: "var(--theme-hover)", cursor: "pointer", transition: "border-color 0.15s, transform 0.15s" }}
                  onClick={() => setPreviewFile(file)}
                >
                  <div style={{ width: "100%", aspectRatio: "1.2", background: "var(--theme-input)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    {isImage(file.name)
                      ? <SmartImage src={fileUrl} alt={file.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ fontSize: "28px", fontWeight: 700, color: ft.color, opacity: 0.7, fontFamily: "monospace" }}>.{file.name.split(".").pop()}</span>
                    }
                  </div>
                  <div style={{ padding: "10px 12px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--theme-text-strong)", marginBottom: "3px" }} title={file.name}>{file.name}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", color: "var(--control-muted)" }}>{formatSize(file.size)}</span>
                      <span style={{ fontSize: "10px", fontWeight: 600, color: ft.color }}>{ft.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // List View
          <div ref={autoAnimateRef} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 90px 140px 140px", gap: "12px", padding: "8px 14px", fontSize: "11px", fontWeight: 700, color: "var(--control-muted)", letterSpacing: "0.04em", borderBottom: "1px solid var(--control-line)", marginBottom: "6px" }}>
              <span>ชื่อไฟล์</span>
              <span>ประเภท</span>
              <span>ขนาด</span>
              <span>วันที่อัพโหลด</span>
              <span style={{ textAlign: "right" }}>การจัดการ</span>
            </div>
            {filteredFiles.map(file => {
              const ft = getFileType(file.name);
              const fileUrl = file.url.startsWith("http") ? file.url : `${API}${file.url}`;
              return (
                <div
                  key={file.name}
                  style={{ display: "grid", gridTemplateColumns: "1fr 100px 90px 140px 140px", gap: "12px", padding: "10px 14px", borderRadius: "10px", alignItems: "center", transition: "background 0.12s", cursor: "default" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "var(--theme-hover)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  {/* Name + Thumb */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                    <div style={{ width: "40px", height: "40px", borderRadius: "8px", overflow: "hidden", flexShrink: 0, background: ft.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isImage(file.name)
                        ? <SmartImage src={fileUrl} alt="" compact style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ fontSize: "10px", fontWeight: 700, color: ft.color, textTransform: "uppercase" }}>.{file.name.split(".").pop()}</span>
                      }
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--theme-text-strong)" }} title={file.name}>{file.name}</span>
                  </div>

                  {/* Type badge */}
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: ft.bg, color: ft.color, width: "fit-content" }}>
                    {ft.label}
                  </span>

                  {/* Size */}
                  <span style={{ fontSize: "12px", color: "var(--control-muted)" }}>{formatSize(file.size)}</span>

                  {/* Date */}
                  <span style={{ fontSize: "12px", color: "var(--control-muted)" }}>{new Date(file.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</span>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => handleCopy(file.url)}
                      title="คัดลอกลิงก์"
                      style={{ width: "32px", height: "32px", borderRadius: "7px", border: "1px solid var(--control-line)", background: "transparent", color: copiedUrl === file.url ? "var(--success)" : "var(--control-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      {copiedUrl === file.url ? <CheckCircle size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={() => handleOpenEdit(file)}
                      title="แก้ไขรายละเอียดไฟล์"
                      style={{ width: "32px", height: "32px", borderRadius: "7px", border: "1px solid var(--control-line)", background: "transparent", color: "var(--control-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => setPreviewFile(file)}
                      title="ดูตัวอย่าง"
                      style={{ width: "32px", height: "32px", borderRadius: "7px", border: "1px solid var(--control-line)", background: "transparent", color: "var(--control-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(file.name)}
                      title="ลบไฟล์"
                      style={{ width: "32px", height: "32px", borderRadius: "7px", border: "1px solid rgba(255,85,91,0.3)", background: "rgba(255,85,91,0.06)", color: "#ff555b", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

            {/* ─── Edit File Details Modal ─── */}
      {editFile && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
          onClick={() => setEditFile(null)}
        >
          <div
            style={{ width: "100%", maxWidth: "500px", borderRadius: "20px", background: "var(--theme-elevated)", boxShadow: "0 25px 70px rgba(0,0,0,0.35)", padding: "24px", position: "relative" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "var(--primary-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)" }}>
                  <Pencil size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--theme-text-strong)" }}>แก้ไขรายละเอียดไฟล์</h2>
                  <p style={{ fontSize: "12px", color: "var(--control-muted)", margin: 0 }}>ปรับแต่งชื่อและผูกหมวดหมู่สินค้า</p>
                </div>
              </div>
              <button
                onClick={() => setEditFile(null)}
                style={{ width: "32px", height: "32px", borderRadius: "8px", border: "1px solid var(--control-line)", background: "var(--theme-hover)", color: "var(--control-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <X size={15} />
              </button>
            </div>

            {/* File Info Summary */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", borderRadius: "12px", background: "var(--theme-hover)", border: "1px solid var(--control-line)", marginBottom: "18px" }}>
              <div style={{ width: "44px", height: "44px", borderRadius: "8px", overflow: "hidden", flexShrink: 0, background: getFileType(editFile.name).bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isImage(editFile.name)
                  ? <img src={editFile.url.startsWith("http") ? editFile.url : `${API}${editFile.url}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: "11px", fontWeight: 700, color: getFileType(editFile.name).color, textTransform: "uppercase" }}>.{editFile.name.split(".").pop()}</span>
                }
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--theme-text-strong)" }}>{editFile.name}</div>
                <div style={{ fontSize: "11px", color: "var(--control-muted)", marginTop: "2px" }}>
                  {formatSize(editFile.size)} · {getFileType(editFile.name).label}
                </div>
              </div>
            </div>

            {/* Form Fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "20px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--theme-text-strong)", display: "block", marginBottom: "6px" }}>
                  ชื่อแสดงไฟล์ (File Name)
                </label>
                <div className="input-wrap" style={{ background: "var(--theme-input)", border: "1px solid var(--control-line)", borderRadius: "10px" }}>
                  <input
                    type="text"
                    value={editDisplayName}
                    onChange={e => setEditDisplayName(e.target.value)}
                    style={{ width: "100%", height: "42px", padding: "0 12px", background: "transparent", border: "none", color: "var(--theme-text-strong)", fontSize: "13px", outline: "none" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--theme-text-strong)", display: "block", marginBottom: "6px" }}>
                  หมวดหมู่สินค้าที่ผูกไว้ (Category)
                </label>
                <CustomCategorySelect
                  categories={categories}
                  value={editCategory}
                  onChange={setEditCategory}
                />
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={() => handleCopy(editFile.url)}
                style={{ height: "42px", padding: "0 16px", borderRadius: "10px", border: "1px solid var(--control-line)", background: "var(--theme-hover)", color: copiedUrl === editFile.url ? "var(--success)" : "var(--theme-text-strong)", fontWeight: 600, fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
              >
                {copiedUrl === editFile.url ? <CheckCircle size={15} /> : <Copy size={15} />}
                {copiedUrl === editFile.url ? "คัดลอกแล้ว" : "คัดลอก URL"}
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                style={{ flex: 1, height: "42px", padding: "0 16px", borderRadius: "10px", background: editSaved ? "var(--success)" : "var(--primary)", color: "#fff", fontWeight: 600, fontSize: "13px", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", transition: "background 0.2s" }}
              >
                {editSaved ? <CheckCircle size={16} /> : <Save size={16} />}
                {editSaved ? "บันทึกเรียบร้อย!" : "บันทึกการแก้ไข"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Upload Modal ─── */}
      {showUploadModal && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowUploadModal(false)}
        >
          <div
            style={{ width: "100%", maxWidth: "480px", borderRadius: "20px", background: "var(--theme-elevated)", boxShadow: "0 25px 70px rgba(0,0,0,0.35)", padding: "24px", position: "relative" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "var(--primary-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--primary)" }}>
                  <UploadCloud size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0, color: "var(--theme-text-strong)" }}>อัพโหลดไฟล์ใหม่</h2>
                  <p style={{ fontSize: "12px", color: "var(--control-muted)", margin: 0 }}>ลากไฟล์มาวาง หรือคลิกเพื่อเลือก</p>
                </div>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                style={{ width: "32px", height: "32px", borderRadius: "8px", border: "1px solid var(--control-line)", background: "var(--theme-hover)", color: "var(--control-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Category Picker */}
            <div style={{ marginBottom: "18px" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--theme-text-strong)", display: "block", marginBottom: "6px" }}>
                หมวดหมู่สินค้าที่เกี่ยวข้อง <span style={{ color: "var(--control-muted)", fontWeight: 400 }}>(ตัวเลือก)</span>
              </label>
              <CustomCategorySelect
                categories={categories}
                value={uploadCategory}
                onChange={setUploadCategory}
              />
            </div>

            {/* Dropzone */}
            <FileUpload
              maxSizeMB={50}
              category={uploadCategory}
              onUploadSuccess={() => {
                reloadFiles();
              }}
            />
          </div>
        </div>
      )}

      {/* ─── File Preview Modal ─── */}
      {previewFile && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backgroundColor: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
          onClick={() => setPreviewFile(null)}
        >
          <div
            style={{ width: "100%", maxWidth: "660px", borderRadius: "20px", overflow: "hidden", background: "var(--theme-elevated)", boxShadow: "0 30px 80px rgba(0,0,0,0.4)" }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid var(--control-line)" }}>
              <div style={{ minWidth: 0, flex: 1, paddingRight: "12px" }}>
                <p style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--theme-text-strong)" }}>{previewFile.name}</p>
                <p style={{ fontSize: "12px", color: "var(--control-muted)", margin: 0 }}>
                  {formatSize(previewFile.size)} · {new Date(previewFile.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
              <button onClick={() => setPreviewFile(null)} style={{ width: "32px", height: "32px", borderRadius: "8px", border: "1px solid var(--control-line)", background: "var(--theme-hover)", color: "var(--control-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <X size={15} />
              </button>
            </div>

            {/* Preview Area */}
            <div style={{ minHeight: "280px", maxHeight: "55dvh", background: "var(--theme-bg)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {(() => {
                const fullUrl = previewFile.url.startsWith("http") ? previewFile.url : `${API}${previewFile.url}`;
                const ext = previewFile.name.split(".").pop()?.toLowerCase() || "";
                if (["jpg","jpeg","png","gif","webp","svg","bmp","avif"].includes(ext)) {
                  return previewLoading
                    ? <div style={{ color: "var(--control-muted)", opacity: 0.5 }}><RefreshCw size={24} /></div>
                    : <img src={previewBlobUrl || fullUrl} alt={previewFile.name} style={{ maxHeight: "55dvh", maxWidth: "100%", objectFit: "contain", padding: "16px" }} />;
                } else if (["mp4","webm","ogg","mov"].includes(ext)) {
                  return <video src={previewBlobUrl || fullUrl} controls style={{ maxHeight: "55dvh", maxWidth: "100%", padding: "12px" }} />;
                } else if (["mp3","wav","ogg","flac"].includes(ext)) {
                  return <div style={{ padding: "24px", width: "100%" }}><audio src={previewBlobUrl || fullUrl} controls style={{ width: "100%" }} /></div>;
                } else {
                  return (
                    <div style={{ textAlign: "center", padding: "48px", color: "var(--control-muted)" }}>
                      <FolderOpen size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
                      <p style={{ fontSize: "13px" }}>ไม่สามารถแสดงตัวอย่างไฟล์ประเภทนี้</p>
                    </div>
                  );
                }
              })()}
            </div>

            {/* Footer */}
            <div style={{ display: "flex", gap: "10px", padding: "14px 20px", borderTop: "1px solid var(--control-line)" }}>
              <button
                onClick={() => handleCopy(previewFile.url)}
                style={{ flex: 1, height: "40px", borderRadius: "9px", border: "1px solid var(--control-line)", background: "var(--theme-hover)", color: copiedUrl === previewFile.url ? "var(--success)" : "var(--theme-text-strong)", fontWeight: 600, fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
              >
                {copiedUrl === previewFile.url ? <><CheckCircle size={14} /> คัดลอกแล้ว</> : <><Copy size={14} /> คัดลอกลิงก์</>}
              </button>
              <a
                href={previewFile.url.startsWith("http") ? previewFile.url : `${API}${previewFile.url}`}
                download={previewFile.name}
                style={{ flex: 1, height: "40px", borderRadius: "9px", background: "var(--primary)", color: "#fff", fontWeight: 600, fontSize: "13px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", textDecoration: "none" }}
              >
                <Download size={14} /> ดาวน์โหลด
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ─── Custom Delete Confirm Modal ─── */}
      {deleteTargetFile && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backgroundColor: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
          onClick={() => setDeleteTargetFile(null)}
        >
          <div
            style={{ width: "100%", maxWidth: "420px", borderRadius: "20px", background: "var(--theme-elevated)", boxShadow: "0 25px 70px rgba(0,0,0,0.4)", padding: "24px", textAlign: "center" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "rgba(255, 85, 91, 0.12)", color: "#ff555b", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <Trash2 size={26} />
            </div>
            <h3 style={{ fontSize: "17px", fontWeight: 700, color: "var(--theme-text-strong)", margin: "0 0 8px" }}>ยืนยันการลบไฟล์</h3>
            <p style={{ fontSize: "13px", color: "var(--control-muted)", margin: "0 0 24px", lineHeight: "1.5" }}>
              คุณต้องการลบไฟล์ <strong style={{ color: "var(--theme-text-strong)" }}>&quot;{deleteTargetFile}&quot;</strong> ออกจากระบบใช่หรือไม่? <br />
              <span style={{ fontSize: "12px", color: "#ff555b" }}>การดำเนินการนี้จะไม่สามารถกู้คืนได้</span>
            </p>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setDeleteTargetFile(null)}
                style={{ flex: 1, height: "42px", borderRadius: "10px", border: "1px solid var(--control-line)", background: "var(--theme-hover)", color: "var(--theme-text-strong)", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmDeleteFile}
                style={{ flex: 1, height: "42px", borderRadius: "10px", background: "#ff555b", color: "#fff", fontWeight: 600, fontSize: "13px", border: "none", cursor: "pointer", boxShadow: "0 4px 14px rgba(255,85,91,0.3)" }}
              >
                ลบไฟล์ถาวร
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
