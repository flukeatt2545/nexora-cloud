"use client";

// What the admin bot pages (/admin/bots, /admin/bots/list, /admin/bots/quotas, /admin/bots/activity)
// share: loading the fleet, wording, the small tab bar on top and the checks that decide what
// "needs attention" means. Nothing here is used by the pages people see for their own bots.
import { Activity, Gauge, LayoutGrid, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { botApi, botIsUp, botSend, botStatusView, errorMessage, type Bot, type StatusTone } from "./botsShared";

export type Owner = { id: number; username: string; limit: number | null; bots: number };

export type BotOperation = {
  id: number;
  kind: string;
  state: "queued" | "running" | "succeeded" | "failed";
  phase: string;
  error: string;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  bot: { id: string; name: string };
  owner: string;
  actor: string;
};

export type BotEvent = {
  id: number;
  actor: string;
  actorRole: string;
  action: string;
  targetId: string;
  targetName: string;
  outcome: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export const memoryOptions = [128, 256, 384, 512, 768, 1024, 1536, 2048];
export const cpuOptions = [100, 250, 500, 750, 1000, 1500, 2000];
export const diskOptions = [256, 512, 1024, 2048, 4096];

export const megabytes = (value: number) => (value >= 1024 ? `${(value / 1024).toLocaleString("th-TH", { maximumFractionDigits: 2 })} GB` : `${value.toLocaleString("th-TH")} MB`);
export const cores = (millicores: number) => (millicores / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 });
export const clock = (date: Date) => date.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const count = (value: number) => value.toLocaleString("th-TH");

/** "5 นาทีที่แล้ว" — the admin cares how fresh something is more than the exact time. */
export function ago(value: string | null | undefined, now = Date.now()) {
  if (!value) return "–";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "–";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 45) return "เมื่อครู่";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} วันที่แล้ว`;
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(new Date(time));
}

export function fullDate(value: string | null | undefined) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export const diskPercent = (bot: Bot) => {
  const used = bot.resources.diskUsedMb;
  return used === null ? null : Math.min(100, (used / Math.max(1, bot.resources.diskLimitMb)) * 100);
};

/** Short names for the runtime jobs and the audit trail, in the words an admin would say. */
export const actionLabel: Record<string, string> = {
  "bot.start": "เปิดบอท",
  "bot.stop": "ปิดบอท",
  "bot.restart": "รีสตาร์ตบอท",
  "bot.deploy": "ติดตั้งโค้ดใหม่",
  "bot.delete": "ลบบอท",
  "bot.created": "สร้างบอท",
  "bot.deleted": "ลบบอท",
  "bot.resources.updated": "ปรับทรัพยากร",
  "bot.limit.updated": "ตั้งโควตา",
  "bot.source.github": "ดึงโค้ดจาก GitHub",
  "bot.source.uploaded": "อัปโหลดโค้ด",
  "bot.token.updated": "เปลี่ยนโทเคน",
  "bot.environment.updated": "แก้ตัวแปรลับ",
  "bot.environment.deleted": "ลบตัวแปรลับ",
};

export const toneLabel: Record<StatusTone, string> = { online: "ออนไลน์", busy: "กำลังทำงาน", bad: "มีปัญหา", off: "ปิดอยู่" };

export type Issue = {
  id: string;
  level: "bad" | "wait";
  title: string;
  detail: string;
  bot?: Bot;
  owner?: Owner;
  /** What the row offers: look at the bot, restart it, or go set a quota. */
  kind: "bot" | "quota";
};

/** Everything an admin should look at, worst first. One bot can raise more than one. */
export function findIssues(bots: Bot[], owners: Owner[], defaultLimit: number): Issue[] {
  const issues: Issue[] = [];
  for (const bot of bots) {
    const view = botStatusView(bot);
    if (view.tone === "bad") {
      issues.push({ id: `bad-${bot.id}`, level: "bad", kind: "bot", bot, title: `${bot.name} ${view.label}`, detail: bot.statusMessage || (bot.lastExitCode !== null ? `โปรแกรมจบด้วยรหัส ${bot.lastExitCode}` : `เจ้าของ @${bot.owner?.username || "-"}`) });
      continue;
    }
    if (bot.restartCount >= 3 && botIsUp(bot)) {
      issues.push({ id: `loop-${bot.id}`, level: "wait", kind: "bot", bot, title: `${bot.name} รีสตาร์ตเองบ่อย`, detail: `รีสตาร์ตเองแล้ว ${bot.restartCount} ครั้ง น่าจะมีโค้ดที่ล้มซ้ำ` });
    }
    const disk = diskPercent(bot);
    if (disk !== null && disk >= 90) {
      issues.push({ id: `disk-${bot.id}`, level: disk >= 98 ? "bad" : "wait", kind: "bot", bot, title: `${bot.name} ดิสก์เกือบเต็ม`, detail: `ใช้ไป ${Math.round(disk)}% ของ ${megabytes(bot.resources.diskLimitMb)}` });
    }
  }
  for (const owner of owners) {
    const allowed = owner.limit ?? defaultLimit;
    if (owner.bots > allowed) issues.push({ id: `quota-${owner.id}`, level: "wait", kind: "quota", owner, title: `@${owner.username} มีบอทเกินโควตา`, detail: `มี ${owner.bots} ตัว โควตา ${allowed} ตัว` });
  }
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));
}

/**
 * Loads every bot with its owner and the quota table, then again every ten seconds while the
 * tab is visible. A failed refresh keeps what was already on screen and says so.
 */
export function useFleet() {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(2);
  const [failed, setFailed] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await botApi<{ items: Bot[]; owners: Owner[]; defaultLimit: number }>("/api/admin/bots");
      setBots(data.items);
      setOwners(data.owners);
      setDefaultLimit(data.defaultLimit);
      setLoadedAt(new Date());
      setFailed("");
    } catch (error) {
      setFailed(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 10000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { bots, owners, defaultLimit, failed, loadedAt, refreshing, load, refresh };
}

export type BotAction = "start" | "stop" | "restart";

export const actionVerb: Record<BotAction, string> = { start: "เปิด", stop: "ปิด", restart: "รีสตาร์ต" };

export function sendBotAction(bot: Bot, action: BotAction) {
  return botApi(`/api/bots/${encodeURIComponent(bot.id)}/operations`, botSend("POST", { action }));
}

export function deleteBot(bot: Bot) {
  return botApi(`/api/bots/${encodeURIComponent(bot.id)}`, botSend("DELETE"));
}

/** Which of start / restart / stop make sense for the bot as it is now. */
export function allowedActions(bot: Bot): Record<BotAction, boolean> {
  const busy = Boolean(bot.pending);
  const up = botIsUp(bot);
  return { start: !busy && !up, restart: !busy && bot.status === "running", stop: !busy && up };
}

const tabs = [
  { href: "/admin/bots", key: "overview", label: "ภาพรวม", icon: Gauge },
  { href: "/admin/bots/list", key: "list", label: "บอททั้งหมด", icon: LayoutGrid },
  { href: "/admin/bots/quotas", key: "quotas", label: "โควตา", icon: Users },
  { href: "/admin/bots/activity", key: "activity", label: "คิวงานและประวัติ", icon: Activity },
] as const;

/**
 * A link to another admin page. These pages are separate routes, so it is a normal link (a full
 * page load), the same as the sidebar; the href comes in as a value so the router rule stays quiet.
 */
export function PageLink({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} {...props} />;
}

export type AdminBotsTab = (typeof tabs)[number]["key"];

/** The page head: the title, a line saying what the page is for, the tab bar, and the page's buttons. */
export function AdminBotsHead({ tab, title, sub, children }: { tab: AdminBotsTab; title: string; sub: string; children?: React.ReactNode }) {
  return (
    <header className="abx-head">
      <div className="abx-head-top">
        <div className="abx-head-copy">
          <p className="abx-eyebrow">บอทของผู้ใช้</p>
          <h1>{title}</h1>
          <p className="abx-sub">{sub}</p>
        </div>
        {children && <div className="abx-head-actions">{children}</div>}
      </div>
      <nav className="abx-tabs" aria-label="หมวดของบอทผู้ใช้">
        {tabs.map((item) => (
          <PageLink key={item.key} href={item.href} className={item.key === tab ? "is-active" : ""} aria-current={item.key === tab ? "page" : undefined}>
            <item.icon size={16} aria-hidden="true" />{item.label}
          </PageLink>
        ))}
      </nav>
    </header>
  );
}
