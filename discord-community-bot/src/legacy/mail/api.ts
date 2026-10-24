import axios from "axios";
import { API_URL, BOT_SECRET } from "./config";

export type Mailbox = { id: string; address: string; displayName: string; unread: number };

export type MailItem = {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  preview: string;
  date: string;
  read: boolean;
  hasAttachment?: boolean;
};

export type MailboxPage = {
  mailboxId: string;
  address: string;
  folder: string;
  page: number;
  hasMore: boolean;
  items: MailItem[];
  notify: boolean;
  canAppPasswords: boolean;
};

export type MailMessage = {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  text: string;
  date: string;
  folder: string;
  read: boolean;
  canManage: boolean;
  address: string;
  webmail: string;
  attachments?: MailAttachment[];
};

export type MailAttachment = { blobId: string; name: string; type: string; size: number };

export type DomainOption = { id: string; domain: string; shared: boolean };

export type CreateOptions = {
  linked: boolean;
  enabled: boolean;
  domains: DomainOption[];
  used?: number;
  limit?: number;
  quotaBytes?: number;
};

export type AppPassword = { id: string; description: string; createdAt: string };

export type MailBotSettings = {
  selfServiceEnabled: boolean;
  maxMailboxesPerUser: number;
  quotaBytes: number;
};

export function api(actorDiscordId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Bot-Internal-Secret": BOT_SECRET,
  };
  if (actorDiscordId) {
    headers["X-Bot-Actor-Discord-Id"] = actorDiscordId;
  }
  return axios.create({ baseURL: API_URL, timeout: 15000, headers });
}

export function apiStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

// The API's 4xx messages are written for members, so show them; hide anything from a 5xx.
export function apiMessage(error: unknown, fallback: string): string {
  const status = apiStatus(error);
  if (status === 403) return "คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบเมลที่ได้รับอนุญาต";
  if (status === 429) {
    const message = axios.isAxiosError(error) ? error.response?.data?.error : "";
    return typeof message === "string" && message ? message : "ส่งคำขอบ่อยเกินไป รอสักครู่แล้วลองใหม่";
  }
  if (status && status >= 400 && status < 500 && axios.isAxiosError(error)) {
    const message = error.response?.data?.error;
    if (typeof message === "string" && message.trim()) return message;
    if (status === 404) return "ไม่พบข้อมูลนี้ หรือบัญชีนี้ยังไม่มีสิทธิ์";
  }
  return fallback;
}

export function logBotError(scope: string, error: unknown) {
  const status = apiStatus(error);
  const code = axios.isAxiosError(error) ? error.response?.data?.code : undefined;
  const detail = !status && error instanceof Error ? error.message : "";
  console.error(`[ERROR] ${scope}`, status || "", code || "", detail);
}
