"use client";

import { FormEvent, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity, Boxes, Check, CircleAlert, CircleCheck, CircleX, Clock3, Code2, ExternalLink, Globe,
  Hammer, Play, Plus, RefreshCw, RotateCw, Search,
  Server, Square, Trash2, Users, X, FileArchive, UploadCloud, LayoutTemplate, Database, Hexagon,
  ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Copy,
  Folder,
} from "lucide-react";
import { API_BASE } from "../runtime";
import "./hosting-view.css";

type Notice = { kind: "success" | "error"; text: string };
type ConfirmRequest = { title: string; message: string; confirmLabel?: string; danger?: boolean; action: () => void | Promise<void> };
type Viewer = { username: string; role: "user" | "admin" | "superadmin" };
type HostingSite = {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string;
  customDomainVerified?: boolean;
  customDomainTxtName?: string;
  customDomainTxtValue?: string;
  projectType: "auto" | "static" | "php" | "node";
  detectedProjectType: string;
  packageManager: "npm" | "pnpm" | "yarn";
  status: "provisioning" | "running" | "stopped" | "error" | "expired";
  maintenanceMode: boolean;
  expiresAt?: string;
  expiryAction: string;
  ownerId: number;
  ownerUsername: string;
  accessRole: "owner" | "developer" | "viewer" | "platform_admin";
  memberCount: number;
  runtimePort?: number;
  healthStatus: "unknown" | "starting" | "healthy" | "unhealthy" | "stopped";
  healthCheckedAt?: string;
  cpuMillicores: number;
  memoryMb: number;
  processLimit: number;
  diskLimitMb: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type SiteMember = { userId: number; username: string; displayName?: string; role: "owner" | "developer" | "viewer"; createdAt?: string };
type SiteOperation = {
  operationId: string; kind: string; state: string; phase: string;
  startedAt: string; finishedAt?: string; timeoutSeconds: number;
  errorCode: string; errorMessage: string; retryable: boolean; attempt: number;
};
type SiteDetail = { site: HostingSite; members: SiteMember[]; operations: SiteOperation[] };
type RuntimeLog = { id: number; operationId?: string; stream: string; message: string; createdAt: string };
type HostingEnvironment = { name: string; value: string; isSecret: boolean; masked: boolean; updatedAt: string };
type SiteDatabase = { id: string; dbName: string; dbUser: string; dbPass?: string; status: string; host: string; port?: number; engine?: string };
type SiteForm = {
  name: string; subdomain: string; customDomain: string;
  projectType: HostingSite["projectType"]; packageManager: HostingSite["packageManager"]; ownerUsername: string;
  initialMethod: "upload" | "generate" | "empty";
};

const emptyForm: SiteForm = { name: "", subdomain: "", customDomain: "", projectType: "auto", packageManager: "npm", ownerUsername: "", initialMethod: "generate" };
const statusLabel: Record<HostingSite["status"], string> = {
  provisioning: "กำลังเตรียมระบบ", running: "กำลังทำงาน", stopped: "หยุดอยู่", error: "มีข้อผิดพลาด", expired: "หมดอายุ",
};
const roleLabel: Record<string, string> = {
  owner: "เจ้าของเว็บ", developer: "นักพัฒนา", viewer: "ผู้เข้าชม", platform_admin: "ผู้ดูแลแพลตฟอร์ม",
};
const operationLabel: Record<string, string> = {
  "site.create": "สร้างเว็บไซต์", "site.update": "แก้ไขเว็บไซต์", "site.delete": "ลบเว็บไซต์",
  "member.upsert": "เพิ่มหรือเปลี่ยนผู้ร่วมงาน", "member.remove": "นำผู้ร่วมงานออก", "owner.transfer": "โอนสิทธิ์เจ้าของเว็บ",
  "runtime.start": "เริ่มเว็บไซต์", "runtime.stop": "หยุดเว็บไซต์", "runtime.restart": "รีสตาร์ต",
  "runtime.rebuild": "สร้างระบบเว็บไซต์ใหม่", "runtime.redeploy": "ติดตั้งเว็บไซต์เวอร์ชันใหม่",
  "migration.import": "นำเข้าข้อมูลเว็บไซต์",
};
const operationStateLabel: Record<string, string> = {
  queued: "รอคิว", pending: "รอดำเนินการ", running: "กำลังทำงาน",
  succeeded: "สำเร็จ", failed: "ไม่สำเร็จ", cancelled: "ยกเลิกแล้ว",
};
const logStreamLabel: Record<string, string> = {
  system: "ระบบ", stdout: "ผลลัพธ์", stderr: "ข้อผิดพลาด", health: "ตรวจสถานะ",
};

async function hostingApi<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const isFormData = options?.body instanceof FormData;
    const headers: Record<string, string> = isFormData ? {} : { "Content-Type": "application/json" };
    Object.assign(headers, options?.headers);
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...options,
      headers,
    });
    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "ไม่สามารถดำเนินการได้");
    return payload as T;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Backend ได้ กรุณาตรวจสอบว่าระบบกำลังทำงานอยู่");
    }
    throw error;
  }
}

function mutationOptions(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

type RuntimeLine = { label: string; text: string; detail?: string; tone?: "success" | "info" | "muted" };

const friendlyRuntimeAction: Record<string, string> = {
  "runtime.start": "กำลังเปิดเว็บไซต์",
  "runtime.stop": "กำลังหยุดเว็บไซต์",
  "runtime.restart": "กำลังเริ่มเว็บไซต์ใหม่",
  "runtime.rebuild": "กำลังสร้างระบบเว็บไซต์ใหม่",
  "runtime.redeploy": "กำลังติดตั้งเว็บไซต์เวอร์ชันใหม่",
  "site.delete": "กำลังลบเว็บไซต์",
};

function formatRuntimeMessage(message: string): RuntimeLine[] {
  return message.split(/\r?\n/).map((rawLine): RuntimeLine => {
    const line = rawLine
      .trim()
      .replace(/^\d{4}-\d{2}-\d{2}T\S+\s*/, "")
      .replace(/^\[[^\]]+\]\s*/, "");

    const starting = line.match(/^เริ่มดำเนินการ\s+(.+)$/i);
    if (starting) {
      return {
        label: "กำลังทำงาน",
        text: friendlyRuntimeAction[starting[1].toLowerCase()] || "กำลังดำเนินการ",
        tone: "info",
      };
    }

    const retrying = line.match(/^ดำเนินการไม่สำเร็จ\s+ระบบจะลองใหม่\s+\((\d+)\/(\d+)\)$/i);
    if (retrying) {
      return {
        label: "กำลังลองใหม่",
        text: `ระบบยังทำรายการไม่สำเร็จ กำลังลองครั้งที่ ${retrying[1]} จาก ${retrying[2]}`,
        tone: "info",
      };
    }

    if (/^ดำเนินการสำเร็จ$/i.test(line)) {
      return { label: "สำเร็จ", text: "ดำเนินการเรียบร้อยแล้ว", tone: "success" };
    }

    const server = line.match(/^(PHP\s+\S+)\s+Development Server\s+\(([^)]+)\)\s+started$/i);
    if (server) return { label: "พร้อมใช้", text: "เว็บไซต์พร้อมรับผู้เข้าชมแล้ว", detail: server[2], tone: "success" };

    const request = line.match(/^(?:(\S+)\s+)?\[(\d{3})\]:\s+([A-Z]+)\s+(.+)$/);
    if (request) {
      const [, client, status, method, path] = request;
      return {
        label: `HTTP ${status}`,
        text: `${method} ${path}`,
        detail: client ? `จาก ${client}` : undefined,
        tone: status.startsWith("2") || status.startsWith("3") ? "success" : "info",
      };
    }

    const accepted = line.match(/^(\S+)\s+Accepted$/i);
    if (accepted) return { label: "เชื่อมต่อ", text: "รับการเชื่อมต่อใหม่", detail: accepted[1], tone: "info" };

    const closing = line.match(/^(?:(\S+)\s+)?Closing$/i);
    if (closing) return { label: "สิ้นสุด", text: "ปิดการเชื่อมต่อแล้ว", detail: closing[1], tone: "muted" };

    const friendlyLine = line
      .replace(/ไม่สามารถเตรียม Runtime เดิมได้/gi, "ไม่สามารถเตรียมระบบเว็บไซต์เดิมได้ กรุณาลองใหม่อีกครั้ง")
      .replace(/ไม่สามารถตรวจสอบ Container ได้/gi, "ไม่สามารถตรวจสอบสถานะเว็บไซต์ได้")
      .replace(/ไม่มี Port ว่างสำหรับเว็บไซต์/gi, "ระบบยังไม่มีช่องทางเชื่อมต่อว่าง กรุณาลองใหม่ภายหลัง")
      .replace(/\bRuntime\b/gi, "ระบบเว็บไซต์")
      .replace(/\bContainer\b/gi, "ระบบเว็บไซต์")
      .replace(/\bruntime\.(?:start|stop|restart|rebuild|redeploy)\b/gi, "การจัดการเว็บไซต์");

    return { label: "ข้อความ", text: friendlyLine || "ไม่มีรายละเอียด", tone: "muted" };
  }).filter((line) => line.text);
}

function getPaginationRange(currentPage: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (currentPage <= 3) {
    return [1, 2, 3, 4, "...", totalPages];
  }
  if (currentPage >= totalPages - 2) {
    return [1, "...", totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

function RoleSelect({ value, onChange }: { value: "developer" | "viewer", onChange: (v: "developer" | "viewer") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const options: { value: "developer" | "viewer"; label: string }[] = [
    { value: "developer", label: "นักพัฒนา (แก้ไขได้)" },
    { value: "viewer", label: "ผู้เข้าชม (ดูเท่านั้น)" }
  ];

  const selected = options.find(o => o.value === value) || options[0];

  return (
    <div className="custom-role-select" ref={ref} onClick={() => setOpen(!open)}>
      <div className="crs-trigger">
        <span>{selected.label}</span>
        <ChevronDown size={14} className={`crs-icon ${open ? "open" : ""}`} />
      </div>
      {open && (
        <div className="crs-dropdown">
          {options.map(opt => (
            <div 
              key={opt.value} 
              className={`crs-option ${opt.value === value ? 'selected' : ''}`}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type TransferCandidate = { username: string; displayName?: string; role?: string; source: "member" | "user" };

function OwnerPickSelect({
  candidates,
  value,
  onChange,
  placeholder = "เลือกเจ้าของคนใหม่",
}: {
  candidates: TransferCandidate[];
  value: string;
  onChange: (username: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 280 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = candidates.find((item) => item.username === value) || null;
  const filtered = candidates.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return item.username.toLowerCase().includes(q) || (item.displayName || "").toLowerCase().includes(q);
  });

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(160, Math.min(280, openUp ? spaceAbove : spaceBelow));
      setDropdownPos({
        top: openUp ? Math.max(8, rect.top - maxHeight - 6) : rect.bottom + 6,
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    }
    setOpen((current) => !current);
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onViewport = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", onViewport);
    window.addEventListener("scroll", onViewport, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", onViewport);
      window.removeEventListener("scroll", onViewport, true);
    };
  }, [open]);

  return (
    <div className="hot-pick">
      <button
        type="button"
        ref={triggerRef}
        className={`hot-pick-trigger ${open ? "open" : ""} ${selected ? "has-value" : ""}`}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <span className="hot-pick-current">
            <span className="hot-pick-avatar" aria-hidden="true">{(selected.displayName || selected.username).slice(0, 1).toUpperCase()}</span>
            <span className="hot-pick-copy">
              <strong>{selected.displayName || selected.username}</strong>
              <small>@{selected.username}{selected.role ? ` · ${roleLabel[selected.role] || selected.role}` : ""}</small>
            </span>
          </span>
        ) : (
          <span className="hot-pick-placeholder">{placeholder}</span>
        )}
        <ChevronDown size={16} className={`hot-pick-chevron ${open ? "open" : ""}`} />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          className="hot-pick-dropdown"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, maxHeight: dropdownPos.maxHeight }}
          role="listbox"
        >
          {candidates.length > 5 && (
            <label className="hot-pick-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ค้นหาชื่อหรือ @username"
                autoFocus
              />
            </label>
          )}
          <div className="hot-pick-options">
            {filtered.length === 0 ? (
              <p className="hot-pick-empty">ไม่พบผู้ใช้ที่ตรงกับคำค้นหา</p>
            ) : filtered.map((item) => {
              const active = item.username === value;
              return (
                <button
                  type="button"
                  key={`${item.source}-${item.username}`}
                  className={`hot-pick-option ${active ? "selected" : ""}`}
                  onClick={() => { onChange(item.username); setOpen(false); setSearch(""); }}
                  role="option"
                  aria-selected={active}
                >
                  <span className="hot-pick-avatar" aria-hidden="true">{(item.displayName || item.username).slice(0, 1).toUpperCase()}</span>
                  <span className="hot-pick-copy">
                    <strong>{item.displayName || item.username}</strong>
                    <small>@{item.username}{item.role ? ` · ${roleLabel[item.role] || item.role}` : ""}</small>
                  </span>
                  {active && <Check size={16} />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function HostingView({
  me, notify, ask,
}: {
  me: Viewer;
  notify: (notice: Notice) => void;
  ask: (request: ConfirmRequest) => void;
}) {
  const [sites, setSites] = useState<HostingSite[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HostingSite | null>(null);
  const [form, setForm] = useState<SiteForm>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [memberForm, setMemberForm] = useState({ username: "", role: "developer" as "developer" | "viewer" });
  const [ownerUsername, setOwnerUsername] = useState("");
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLog[]>([]);
  const [runtimeAction, setRuntimeAction] = useState("");
  const [activityRefreshing, setActivityRefreshing] = useState(false);
  const [siteDbs, setSiteDbs] = useState<SiteDatabase[] | null>(null);
  const [maxDatabases, setMaxDatabases] = useState<number>(1);
  const [dbLoading, setDbLoading] = useState(false);
  const [showDbPass, setShowDbPass] = useState(false);
  const [environmentItems, setEnvironmentItems] = useState<HostingEnvironment[]>([]);
  const [environmentCanManage, setEnvironmentCanManage] = useState(false);
  const [environmentForm, setEnvironmentForm] = useState({ name: "", value: "", isSecret: true });
  const [environmentSaving, setEnvironmentSaving] = useState(false);
  const [copiedEnvKey, setCopiedEnvKey] = useState<string | null>(null);
  const [revealedEnvKeys, setRevealedEnvKeys] = useState<Record<string, boolean>>({});
  const [systemDbExpanded, setSystemDbExpanded] = useState(false);
  const [bulkEnvModalOpen, setBulkEnvModalOpen] = useState(false);
  const [bulkEnvText, setBulkEnvText] = useState("");
  const [bulkEnvIsSecret, setBulkEnvIsSecret] = useState(true);
  const [bulkEnvImporting, setBulkEnvImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deployFile, setDeployFile] = useState<File | null>(null);
  const deployFileInputRef = useRef<HTMLInputElement>(null);
  const [adminUsers, setAdminUsers] = useState<{username: string, displayName: string}[]>([]);
  // The owner list is fetched once, the first time a dialog needs it.
  const adminUsersRequested = useRef(false);
  const detailOpenRef = useRef(false);
  const [opPage, setOpPage] = useState(1);
  const [detailTab, setDetailTab] = useState<"overview" | "env" | "database" | "members" | "history" | "logs">("overview");
  const [logPage, setLogPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const result = await hostingApi<{ items: HostingSite[] }>(`/api/hosting/sites?q=${encodeURIComponent(query)}`);
      setSites(result?.items || []);
    } catch (e) {
      notify({ kind: "error", text: (e instanceof Error && e.message) || "เกิดข้อผิดพลาดในการโหลดข้อมูลเว็บไซต์" });
    } finally {
      setLoading(false);
    }
  }, [query, notify]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  // While a dialog is open the page behind it neither scrolls nor takes clicks.
  const anyDialogOpen = formOpen || !!detail || bulkEnvModalOpen;
  useEffect(() => {
    if (!anyDialogOpen) return;
    const { body, documentElement } = document;
    const previous = { body: body.style.overflow, html: documentElement.style.overflow, pad: body.style.paddingRight };
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => {
      body.style.overflow = previous.body;
      documentElement.style.overflow = previous.html;
      body.style.paddingRight = previous.pad;
    };
  }, [anyDialogOpen]);

  const onEscape = useEffectEvent(() => {
    // A confirmation on top handles its own Esc.
    if (document.querySelector(".system-dialog-backdrop.is-confirm")) return;
    // The .env import sits on top of the site dialog, so it closes first.
    if (bulkEnvModalOpen) { if (!bulkEnvImporting) setBulkEnvModalOpen(false); }
    else if (formOpen) closeForm();
    else { detailOpenRef.current = false; setDetail(null); }
  });
  const dialogShown = formOpen || !!detail;
  useEffect(() => {
    if (!dialogShown) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [dialogShown]);

  useEffect(() => {
    const needsUsers = dialogShown && me?.role !== "user" && !adminUsersRequested.current;
    if (!needsUsers) return;
    adminUsersRequested.current = true;
    hostingApi<{ items: { username: string; displayName: string }[] }>("/api/admin/users?limit=200")
      .then((res) => setAdminUsers(res?.items || []))
      .catch(() => undefined);
  }, [dialogShown, me?.role]);

  // A new owner typed for one site is not carried over to the next.
  const detailSiteId = detail?.site.id;
  const [ownerFor, setOwnerFor] = useState(detailSiteId);
  if (ownerFor !== detailSiteId) {
    setOwnerFor(detailSiteId);
    setOwnerUsername("");
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyForm });
    setFormOpen(true);
  }

  function openEdit(site: HostingSite) {
    setEditing(site);
    setForm({
      name: site.name, subdomain: site.subdomain, customDomain: site.customDomain,
      projectType: site.projectType, packageManager: site.packageManager, ownerUsername: site.ownerUsername,
      initialMethod: emptyForm.initialMethod, // only used when creating
    });
    detailOpenRef.current = false;
    setDetail(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setDeployFile(null);
    if (deployFileInputRef.current) deployFileInputRef.current.value = "";
  }

  async function saveSite(event: FormEvent) {
    event.preventDefault();
    let finalName = form.name.trim();
    if (!finalName && form.subdomain.trim()) {
      finalName = form.subdomain.trim();
    }
    if (!finalName || !form.subdomain.trim()) {
      return notify({ kind: "error", text: "กรุณากรอกชื่อเว็บไซต์และ Subdomain" });
    }
    if (!editing && form.initialMethod === "upload" && !deployFile) {
      return notify({ kind: "error", text: "กรุณาเลือกไฟล์ .zip ที่ต้องการอัพโหลด" });
    }
    const finalForm = { ...form, name: finalName };
    setSaving(true);
    try {
      if (editing) {
        await hostingApi(`/api/hosting/sites/${editing.id}`, mutationOptions("PATCH", finalForm));
        notify({ kind: "success", text: "บันทึกข้อมูลเว็บไซต์แล้ว" });
      } else {
        const result = await hostingApi<{site: {id: string}}>("/api/hosting/sites", mutationOptions("POST", finalForm));
        const siteId = result.site.id;
        if (form.initialMethod === "upload" && deployFile) {
          const formData = new FormData();
          formData.append("file", deployFile);
          await hostingApi(`/api/hosting/sites/${siteId}/deploy`, { 
            method: "POST", 
            body: formData, 
            headers: { "Idempotency-Key": crypto.randomUUID() },
          });
        } else if (form.initialMethod === "generate") {
          await hostingApi(`/api/hosting/sites/${siteId}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          });
        }
        notify({ kind: "success", text: "สร้างเว็บไซต์แล้ว ระบบกำลังเตรียมเว็บไซต์ให้พร้อมใช้งาน" });
      }
      setFormOpen(false);
      setEditing(null);
      setDeployFile(null);
      await load();
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(siteID: string) {
    setDetailLoading(true);
    setMemberForm({ username: "", role: "developer" });
    setOwnerUsername("");
    setSiteDbs(null);
    setRuntimeLogs([]);
    setShowDbPass(false);
    setEnvironmentItems([]);
    setEnvironmentForm({ name: "", value: "", isSecret: true });
    setOpPage(1);
    setLogPage(1);
    setDetailTab("overview");
    detailOpenRef.current = true;
    try {
      const [siteDetail, logs] = await Promise.all([
        hostingApi<SiteDetail>(`/api/hosting/sites/${siteID}`),
        hostingApi<{ items: RuntimeLog[] }>(`/api/hosting/sites/${siteID}/logs`),
      ]);
      setDetail(siteDetail);
      setRuntimeLogs(logs.items);
      try {
        const environment = await hostingApi<{ items: HostingEnvironment[]; canManage: boolean }>(`/api/hosting/sites/${siteID}/environment`);
        setEnvironmentItems(environment.items || []);
        setEnvironmentCanManage(environment.canManage);
      } catch {
        setEnvironmentItems([]);
        setEnvironmentCanManage(false);
      }
      try {
        const dbInfo = await hostingApi<{ databases?: SiteDatabase[]; maxDatabases?: number }>(`/api/hosting/sites/${siteID}/database`);
        setSiteDbs(dbInfo?.databases || []);
        setMaxDatabases(dbInfo?.maxDatabases || 1);
      } catch {
        setSiteDbs(null);
      }
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setDetailLoading(false);
    }
  }

  async function verifyDomain() {
    if (!detail) return;
    try {
      await hostingApi(`/api/hosting/sites/${detail.site.id}/domain/verify`, mutationOptions("POST", {}));
      await reloadDetail(detail.site.id);
      notify({ kind: "success", text: "ยืนยัน Domain แล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    }
  }

  async function reloadDetail(siteID: string) {
    const [value, logs] = await Promise.all([
      hostingApi<SiteDetail>(`/api/hosting/sites/${siteID}`),
      hostingApi<{ items: RuntimeLog[] }>(`/api/hosting/sites/${siteID}/logs`),
    ]);
    setDetail(value);
    setRuntimeLogs(logs.items);
    await load();
  }

  async function refreshActivity() {
    if (!detail || activityRefreshing) return;
    setActivityRefreshing(true);
    try {
      await reloadDetail(detail.site.id);
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setActivityRefreshing(false);
    }
  }

  async function copyOperationID(operationID: string) {
    try {
      await navigator.clipboard.writeText(operationID);
      notify({ kind: "success", text: "คัดลอกหมายเลขรายการแล้ว" });
    } catch {
      notify({ kind: "error", text: "คัดลอกไม่สำเร็จ กรุณาลองใหม่" });
    }
  }

  function requestRuntimeOperation(action: "start" | "stop" | "restart" | "rebuild" | "redeploy") {
    if (!detail || runtimeAction) return;
    const siteName = detail.site.name;
    const prompts: Record<"start" | "stop" | "restart" | "rebuild" | "redeploy", { title: string; message: string; confirmLabel: string; danger?: boolean }> = {
      start: {
        title: "เริ่มเว็บไซต์?",
        message: `ยืนยันเริ่มการทำงานของ "${siteName}"`,
        confirmLabel: "เริ่มเว็บ",
      },
      stop: {
        title: "หยุดเว็บไซต์?",
        message: `"${siteName}" จะหยุดให้บริการชั่วคราวจนกว่าจะกดเริ่มอีกครั้ง`,
        confirmLabel: "หยุดเว็บ",
        danger: true,
      },
      restart: {
        title: "รีสตาร์ทเว็บไซต์?",
        message: `"${siteName}" จะหยุดแล้วเริ่มใหม่ อาจมีช่วง downtime สั้นๆ`,
        confirmLabel: "รีสตาร์ท",
      },
      rebuild: {
        title: "สร้างระบบใหม่?",
        message: `"${siteName}" จะถูกสร้าง runtime ใหม่จากไฟล์ปัจจุบัน เว็บจะหยุดชั่วคราว และกระบวนการนี้อาจใช้เวลานาน`,
        confirmLabel: "สร้างใหม่",
        danger: true,
      },
      redeploy: {
        title: "ใช้การเปลี่ยนแปลง?",
        message: `ระบบจะ deploy "${siteName}" ใหม่เพื่อให้ค่า Environment และการตั้งค่าล่าสุดมีผล`,
        confirmLabel: "ใช้การเปลี่ยนแปลง",
        danger: true,
      },
    };
    const prompt = prompts[action];
    ask({
      title: prompt.title,
      message: prompt.message,
      confirmLabel: prompt.confirmLabel,
      danger: prompt.danger,
      action: () => runRuntimeOperation(action),
    });
  }

  async function runRuntimeOperation(action: "start" | "stop" | "restart" | "rebuild" | "redeploy") {
    if (!detail || runtimeAction) return;
    const siteID = detail.site.id;
    setRuntimeAction(action);
    try {
      await hostingApi(`/api/hosting/sites/${siteID}/operations`, mutationOptions("POST", { action }));
      notify({ kind: "success", text: "รับคำสั่งแล้ว ระบบกำลังดำเนินการ" });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        if (!detailOpenRef.current) break;
        const value = await hostingApi<SiteDetail>(`/api/hosting/sites/${siteID}`);
        if (!detailOpenRef.current) break;
        setDetail(value);
        const latest = [...value.operations].reverse().find((item) => item.kind === `runtime.${action}`);
        if (latest && (latest.state === "succeeded" || latest.state === "failed")) break;
      }
      if (detailOpenRef.current) {
        const logs = await hostingApi<{ items: RuntimeLog[] }>(`/api/hosting/sites/${siteID}/logs`);
        setRuntimeLogs(logs.items);
      }
      await load().catch(() => {});
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setRuntimeAction("");
    }
  }

  function requestUploadDeploy() {
    if (!detail || runtimeAction) return;
    ask({
      title: "อัปโหลดโค้ด ZIP?",
      message: `ไฟล์ ZIP ที่เลือกจะถูกติดตั้งทับเวอร์ชันปัจจุบันของ "${detail.site.name}" แล้ว deploy ใหม่`,
      confirmLabel: "เลือกไฟล์ ZIP",
      danger: true,
      action: () => fileInputRef.current?.click(),
    });
  }

  async function uploadDeployFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !detail) return;
    if (file.type !== "application/zip" && !file.name.endsWith(".zip")) {
      notify({ kind: "error", text: "กรุณาอัปโหลดไฟล์ .zip เท่านั้น" });
      return;
    }
    const siteID = detail.site.id;
    const formData = new FormData();
    formData.append("file", file);
    setRuntimeAction("deploy");
    try {
      await hostingApi(`/api/hosting/sites/${siteID}/deploy`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: formData,
      });
      notify({ kind: "success", text: "อัปโหลดไฟล์สำเร็จ ระบบกำลังดำเนินการ Deploy" });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        if (!detailOpenRef.current) break;
        const value = await hostingApi<SiteDetail>(`/api/hosting/sites/${siteID}`);
        if (!detailOpenRef.current) break;
        setDetail(value);
        const latest = [...value.operations].reverse().find((item) => item.kind === "runtime.redeploy");
        if (latest && (latest.state === "succeeded" || latest.state === "failed")) break;
      }
      if (detailOpenRef.current) {
        const logs = await hostingApi<{ items: RuntimeLog[] }>(`/api/hosting/sites/${siteID}/logs`);
        setRuntimeLogs(logs.items);
      }
      await load().catch(() => {});
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setRuntimeAction("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function loadEnvironment(siteID: string) {
    const environment = await hostingApi<{ items: HostingEnvironment[]; canManage: boolean }>(`/api/hosting/sites/${siteID}/environment`);
    setEnvironmentItems(environment.items || []);
    setEnvironmentCanManage(environment.canManage);
  }

  async function saveEnvironment(event: FormEvent) {
    event.preventDefault();
    if (!detail || !environmentForm.name.trim() || environmentSaving) return;
    setEnvironmentSaving(true);
    try {
      await hostingApi(`/api/hosting/sites/${detail.site.id}/environment`, mutationOptions("PUT", environmentForm));
      setEnvironmentForm({ name: "", value: "", isSecret: true });
      await loadEnvironment(detail.site.id);
      notify({ kind: "success", text: "บันทึกตัวแปรแล้ว กด “ใช้การเปลี่ยนแปลง” เพื่ออัปเดตเว็บไซต์" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setEnvironmentSaving(false);
    }
  }

  function copyEnv(key: string, value: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
    }
    setCopiedEnvKey(key);
    setTimeout(() => setCopiedEnvKey((cur) => (cur === key ? null : cur)), 1800);
  }

  function toggleRevealEnv(key: string) {
    setRevealedEnvKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleBulkImport() {
    if (!detail || !bulkEnvText.trim() || bulkEnvImporting) return;
    const lines = bulkEnvText.split("\n");
    const parsed: { name: string; value: string; isSecret: boolean }[] = [];
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;
      const name = line.slice(0, eqIdx).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "");
      let value = line.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (name) {
        parsed.push({ name, value, isSecret: bulkEnvIsSecret });
      }
    }
    if (parsed.length === 0) {
      notify({ kind: "error", text: "ไม่พบตัวแปรในรูปแบบ KEY=VALUE ที่ถูกต้อง" });
      return;
    }
    setBulkEnvImporting(true);
    let successCount = 0;
    try {
      for (const item of parsed) {
        await hostingApi(`/api/hosting/sites/${detail.site.id}/environment`, mutationOptions("PUT", item));
        successCount++;
      }
      setBulkEnvText("");
      setBulkEnvModalOpen(false);
      await loadEnvironment(detail.site.id);
      notify({ kind: "success", text: `นำเข้า ${successCount} ตัวแปรสำเร็จแล้ว! กด “ใช้การเปลี่ยนแปลง” เพื่ออัปเดตเว็บไซต์` });
    } catch (error) {
      notify({ kind: "error", text: `นำเข้าสำเร็จ ${successCount}/${parsed.length} ตัวแปร: ${(error as Error).message}` });
      await loadEnvironment(detail.site.id);
    } finally {
      setBulkEnvImporting(false);
    }
  }

  const customEnvItems = useMemo(() => environmentItems.filter((i) => !i.name.startsWith("DB_")), [environmentItems]);
  const systemDbEnvItems = useMemo(() => environmentItems.filter((i) => i.name.startsWith("DB_")), [environmentItems]);

  function removeEnvironment(name: string) {
    if (!detail) return;
    ask({
      title: `ลบ ${name}?`,
      message: "ตัวแปรนี้จะถูกนำออกเมื่อคุณกด “ใช้การเปลี่ยนแปลง” ครั้งถัดไป",
      confirmLabel: "ลบตัวแปร",
      danger: true,
      action: async () => {
        await hostingApi(`/api/hosting/sites/${detail.site.id}/environment/${encodeURIComponent(name)}`, mutationOptions("DELETE"));
        await loadEnvironment(detail.site.id);
        notify({ kind: "success", text: "ลบตัวแปรแล้ว กด “ใช้การเปลี่ยนแปลง” เพื่ออัปเดตเว็บไซต์" });
      },
    });
  }

  async function openPhpMyAdmin(database: SiteDatabase) {
    if (!detail || dbLoading) return;
    setDbLoading(true);
    try {
      const result = await hostingApi<{ url: string; ticket: string }>(
        `/api/hosting/sites/${detail.site.id}/database/phpmyadmin`,
        mutationOptions("POST", { databaseId: database.id, dbName: database.dbName }),
      );
      if (!result.url || !/^[a-f0-9]{64}$/.test(result.ticket)) throw new Error("ไม่สามารถสร้างลิงก์ phpMyAdmin ได้");
      let pmaUrl = result.url;
      if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        if (pmaUrl.includes("localhost")) {
          pmaUrl = "https://nove666.pro/login";
        }
      }
      const form = document.createElement("form");
      form.method = "POST";
      form.action = pmaUrl;
      const ticket = document.createElement("input");
      ticket.type = "hidden";
      ticket.name = "ticket";
      ticket.value = result.ticket;
      form.appendChild(ticket);
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
      setDbLoading(false);
    }
  }

  function openFileManager() {
    if (!detail?.site) return;
    // The code-<site> host only lets in a browser carrying a launch token. /workspace asks the
    // API for one and then goes there; opening code-<site> directly always ends on its 401 page.
    window.open(`/workspace?id=${encodeURIComponent(detail.site.id)}`, "_blank", "noopener,noreferrer");
  }

  function removeSite(site: HostingSite) {
    detailOpenRef.current = false;
    setDetail(null);
    ask({
      title: "ลบเว็บไซต์นี้?",
      message: `เว็บไซต์ "${site.name}" จะถูกนำออกจากระบบ รายการ Operation และ Audit log จะยังถูกเก็บไว้`,
      confirmLabel: "ลบเว็บไซต์",
      danger: true,
      action: async () => {
        await hostingApi(`/api/hosting/sites/${site.id}`, mutationOptions("DELETE"));
        await load();
        notify({ kind: "success", text: "ลบเว็บไซต์แล้ว" });
      },
    });
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!detail || !memberForm.username.trim()) return;
    try {
      await hostingApi(`/api/hosting/sites/${detail.site.id}/members`, mutationOptions("POST", memberForm));
      setMemberForm({ username: "", role: "developer" });
      await reloadDetail(detail.site.id);
      notify({ kind: "success", text: "อัปเดตผู้ร่วมงานแล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    }
  }

  function removeMember(member: SiteMember) {
    if (!detail) return;
    const siteID = detail.site.id;
    ask({
      title: "นำผู้ร่วมงานออก?",
      message: `${member.username} จะไม่สามารถเข้าถึงเว็บไซต์นี้ได้อีก`,
      confirmLabel: "นำออก",
      danger: true,
      action: async () => {
        await hostingApi(`/api/hosting/sites/${siteID}/members/${member.userId}`, mutationOptions("DELETE"));
        await reloadDetail(siteID);
        notify({ kind: "success", text: "นำผู้ร่วมงานออกแล้ว" });
      },
    });
  }

  function transferOwner() {
    if (!detail || !ownerUsername.trim()) return;
    const siteID = detail.site.id;
    const username = ownerUsername.trim();
    const candidate = transferCandidates.find((item) => item.username === username);
    const label = candidate?.displayName ? `${candidate.displayName} (@${username})` : `@${username}`;
    ask({
      title: "โอนเจ้าของเว็บไซต์?",
      message: `${label} จะเป็นเจ้าของเว็บ และเจ้าของปัจจุบันจะถูกเปลี่ยนเป็นนักพัฒนา`,
      confirmLabel: "ยืนยันการโอน",
      danger: true,
      action: async () => {
        await hostingApi(`/api/hosting/sites/${siteID}/owner`, mutationOptions("POST", { username }));
        setOwnerUsername("");
        await reloadDetail(siteID);
        notify({ kind: "success", text: "โอนเจ้าของเว็บไซต์เรียบร้อยแล้ว" });
      },
    });
  }

  const canManageMembers = detail?.site.accessRole === "owner" || detail?.site.accessRole === "platform_admin";
  const canTransferOwner = detail?.site.accessRole === "owner" || me.role === "superadmin";

  const transferCandidates = useMemo<TransferCandidate[]>(() => {
    if (!detail) return [];
    const ownerName = (detail.site.ownerUsername || "").toLowerCase();
    const byUsername = new Map<string, TransferCandidate>();

    for (const member of detail.members) {
      if (member.role === "owner") continue;
      if (member.username.toLowerCase() === ownerName) continue;
      byUsername.set(member.username.toLowerCase(), {
        username: member.username,
        displayName: member.displayName,
        role: member.role,
        source: "member",
      });
    }

    if (me.role !== "user") {
      for (const user of adminUsers) {
        if (user.username.toLowerCase() === ownerName) continue;
        const key = user.username.toLowerCase();
        if (byUsername.has(key)) continue;
        byUsername.set(key, {
          username: user.username,
          displayName: user.displayName,
          source: "user",
        });
      }
    }

    return Array.from(byUsername.values()).sort((a, b) => a.username.localeCompare(b.username));
  }, [detail, adminUsers, me.role]);

  const hasFilters = Boolean(query.trim() || status);
  const statusCounts = useMemo(() => {
    const counts = { provisioning: 0, running: 0, stopped: 0, error: 0, expired: 0 } as Record<HostingSite["status"], number>;
    for (const site of sites) counts[site.status] = (counts[site.status] || 0) + 1;
    return counts;
  }, [sites]);
  const visibleSites = useMemo(() => (status ? sites.filter((site) => site.status === status) : sites), [sites, status]);

  async function createDatabase() {
    if (!detail) return;
    setDbLoading(true);
    try {
      const created = await hostingApi<SiteDatabase>(`/api/hosting/sites/${detail.site.id}/database`, mutationOptions("POST", {}));
      setSiteDbs((current) => [...(current || []), created]);
      notify({ kind: "success", text: "สร้างฐานข้อมูลแล้ว" });
    } catch (err) {
      notify({ kind: "error", text: (err as Error).message });
    } finally {
      setDbLoading(false);
    }
  }

  async function testDatabase() {
    if (!detail) return;
    setDbLoading(true);
    try {
      await hostingApi(`/api/hosting/sites/${detail.site.id}/database/test`, mutationOptions("POST", {}));
      setSiteDbs((current) => (current || []).map((item) => ({ ...item, status: "running" })));
      notify({ kind: "success", text: "เชื่อมต่อฐานข้อมูลได้ตามปกติ" });
    } catch (err) {
      notify({ kind: "error", text: (err as Error).message });
    } finally {
      setDbLoading(false);
    }
  }

  const hostingStats = useMemo(() => {
    const total = sites.length;
    const running = sites.filter((s) => s.status === "running").length;
    const stopped = sites.filter((s) => s.status !== "running").length;
    const totalMembers = sites.reduce((acc, s) => acc + (s.memberCount || 1), 0);
    return { total, running, stopped, totalMembers };
  }, [sites]);

  const closeDetail = () => { detailOpenRef.current = false; setDetail(null); };
  const latestOperation = detail?.operations[0];
  const detailKind = detail ? projectKind(detail.site) : "static";
  const detailTabs = detail ? ([
    { key: "overview", label: "ภาพรวม" },
    { key: "env", label: "ตัวแปร", count: customEnvItems.length },
    { key: "database", label: "ฐานข้อมูล", count: siteDbs?.length || 0 },
    { key: "members", label: "ผู้ร่วมงาน", count: detail.members.length },
    { key: "history", label: "ประวัติ", count: detail.operations.length },
    { key: "logs", label: "บันทึก", count: runtimeLogs.length },
  ] as const) : [];

  return <>
    <div className="aov hv" aria-busy={loading}>
      <header className="aov-head">
        <div>
          <h1>{me.role === "user" ? "เว็บไซต์ของฉัน" : "จัดการโฮสติ้ง"}</h1>
          <p className="aov-sub">{me.role === "user" ? "เว็บไซต์ของคุณและเว็บที่ได้รับเชิญให้ร่วมงาน" : "เว็บไซต์ทั้งหมดบน *.nkn02.com สถานะ ผู้ร่วมงาน และการตั้งค่า"}</p>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn" onClick={() => load()} disabled={loading} aria-label="รีเฟรชข้อมูล" title="รีเฟรชข้อมูล">
            <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
          </button>
          <button type="button" className="aov-btn aov-btn-label aov-btn-primary" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" /> สร้างเว็บไซต์
          </button>
        </div>
      </header>

      <section className="aov-kpis" aria-label="สรุปเว็บไซต์">
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Server size={16} /></span>เว็บไซต์ทั้งหมด</span>
          <strong>{loading && !sites.length ? <i className="aov-skel" /> : sites.length.toLocaleString("th-TH")}</strong>
          <span className="aov-kpi-note">{query.trim() ? "ตามคำค้นหา" : "ทุกซับโดเมน"}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CircleCheck size={16} /></span>กำลังทำงาน</span>
          <strong className={statusCounts.running ? "is-ok" : ""}>{loading && !sites.length ? <i className="aov-skel" /> : statusCounts.running.toLocaleString("th-TH")}</strong>
          <span className="aov-kpi-note">{statusCounts.provisioning ? `กำลังเตรียมอีก ${statusCounts.provisioning}` : "เปิดให้เข้าชมได้"}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CircleAlert size={16} /></span>มีปัญหา</span>
          <strong className={statusCounts.error + statusCounts.expired ? "is-bad" : ""}>{loading && !sites.length ? <i className="aov-skel" /> : (statusCounts.error + statusCounts.expired).toLocaleString("th-TH")}</strong>
          <span className="aov-kpi-note">{statusCounts.expired ? `หมดอายุ ${statusCounts.expired}` : statusCounts.stopped ? `หยุดอยู่อีก ${statusCounts.stopped}` : "ข้อผิดพลาดหรือหมดอายุ"}</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Users size={16} /></span>ผู้ร่วมงาน</span>
          <strong>{loading && !sites.length ? <i className="aov-skel" /> : hostingStats.totalMembers.toLocaleString("th-TH")}</strong>
          <span className="aov-kpi-note">รวมทุกเว็บไซต์</span>
        </div>
      </section>

      <section className="aov-panel">
        <div className="th-filters">
          <label className="th-search" role="search">
            <Search size={17} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); } }}
              placeholder="ค้นหาชื่อหรือซับโดเมน"
              aria-label="ค้นหาเว็บไซต์"
              maxLength={80}
            />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
          </label>
          <div className="th-chips" role="group" aria-label="สถานะ">
            <button type="button" className={status === "" ? "is-active" : ""} aria-pressed={status === ""} onClick={() => setStatus("")}>ทั้งหมด</button>
            {(Object.keys(statusLabel) as HostingSite["status"][]).filter((key) => statusCounts[key] > 0 || status === key).map((key) => (
              <button type="button" key={key} className={status === key ? "is-active" : ""} aria-pressed={status === key} onClick={() => setStatus(status === key ? "" : key)}>
                {statusLabel[key]} <span className="hv-chip-count">{statusCounts[key]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="th-meta" aria-live="polite">
          <span>{loading && !sites.length ? "กำลังโหลด..." : visibleSites.length === 0 ? "ไม่พบเว็บไซต์" : `${visibleSites.length.toLocaleString("th-TH")} จาก ${sites.length.toLocaleString("th-TH")} เว็บไซต์`}</span>
          {hasFilters && <button type="button" onClick={() => { setQuery(""); setStatus(""); }}>ล้างตัวกรอง</button>}
        </div>

        {loading && !sites.length ? (
          <ul className="hv-list" aria-busy="true">
            {[0, 1, 2].map((i) => <li className="hv-row is-skeleton" key={i}><span /><span /><span /></li>)}
          </ul>
        ) : visibleSites.length ? (
          <ul className="hv-list">
            <li className="hv-row hv-row-head" aria-hidden="true">
              <span>เว็บไซต์</span><span>ประเภท</span><span>เจ้าของ</span><span>ทีม</span><span>สถานะ</span><span />
            </li>
            {visibleSites.map((site) => {
              const kind = projectKind(site);
              const isRunning = site.status === "running";
              const url = `https://${site.subdomain}.nkn02.com`;
              return (
                <li className="hv-row" key={site.id}>
                  <div className="hv-site">
                    <span className={`hv-kind is-${kind}`} aria-hidden="true"><KindIcon kind={kind} size={17} /></span>
                    <div className="hv-site-copy">
                      <button type="button" className="hv-site-name" onClick={() => openDetail(site.id)} disabled={detailLoading} title={site.name}>{site.name}</button>
                      <small className="hv-site-domain">
                        {site.subdomain}.nkn02.com
                        {site.customDomain && site.customDomain !== site.subdomain && <> · {site.customDomain}</>}
                      </small>
                      <small className="hv-site-meta">{kindLabel[kind]} · @{site.ownerUsername || "—"} · {site.memberCount} คน</small>
                    </div>
                  </div>
                  <span className="hv-cell">{kindLabel[kind]}</span>
                  <span className="hv-cell hv-owner" title={site.ownerUsername || "—"}>@{site.ownerUsername || "—"}</span>
                  <span className="hv-cell hv-members">{site.memberCount} คน</span>
                  <span className={`hv-status is-${site.status}`}><StatusIcon status={site.status} />{statusLabel[site.status]}</span>
                  <div className="hv-row-actions">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className={`hv-btn hv-icon-btn${isRunning ? "" : " is-disabled"}`}
                      aria-disabled={!isRunning}
                      onClick={(event) => !isRunning && event.preventDefault()}
                      title={isRunning ? `เปิด ${url}` : "เว็บยังไม่ทำงาน"}
                      aria-label={`เปิด ${site.subdomain}.nkn02.com`}
                    >
                      <ExternalLink size={16} aria-hidden="true" />
                    </a>
                    <button type="button" className="hv-btn" onClick={() => openDetail(site.id)} disabled={detailLoading}>จัดการ</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="aov-empty hv-empty">
            <span>{hasFilters ? "ไม่พบเว็บไซต์ที่ตรงกับตัวกรอง" : "ยังไม่มีเว็บไซต์"}</span>
            {hasFilters
              ? <button type="button" onClick={() => { setQuery(""); setStatus(""); }}>ล้างตัวกรอง</button>
              : <button type="button" onClick={openCreate}>สร้างเว็บไซต์แรก</button>}
          </div>
        )}
      </section>
    </div>

    {formOpen && typeof document !== "undefined" && createPortal(
      <div className="hv-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeForm()}>
        <section className="hv-dialog hv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="hv-form-title">
          <header className="hv-dialog-head">
            <div className="hv-dh-main">
              <Globe size={20} className="hv-dh-icon" aria-hidden="true" />
              <div className="hv-dh-text">
                <small>{editing ? editing.name : "ซับโดเมนสร้างได้ไม่จำกัดจำนวน"}</small>
                <h2 id="hv-form-title">{editing ? "แก้ไขซับโดเมน" : "สร้างเว็บไซต์"}</h2>
              </div>
            </div>
            <button type="button" className="hv-btn hv-icon-btn" onClick={closeForm} aria-label="ปิด"><X size={18} /></button>
          </header>

          <form className="hv-form" onSubmit={saveSite}>
            <div className="hv-dialog-body">
              <div className="hv-field">
                <label htmlFor="hv-subdomain">ซับโดเมน <span className="hv-req" aria-hidden="true">*</span></label>
                <div className="hv-domain-input">
                  <input
                    id="hv-subdomain"
                    autoFocus
                    value={form.subdomain}
                    minLength={3}
                    maxLength={63}
                    pattern="[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]"
                    onChange={(event) => setForm({ ...form, subdomain: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                    placeholder="mywebsite"
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <span>.nkn02.com</span>
                </div>
                <small>ใช้ a–z, 0–9 และ - ได้ ยาว 3–63 ตัว{form.subdomain && ` · ${form.subdomain}.nkn02.com`}</small>
              </div>

              {!editing && (
                <fieldset className="hv-field">
                  <legend>เริ่มต้นด้วย</legend>
                  <div className="hv-choice-list">
                    {([
                      { value: "generate", icon: LayoutTemplate, title: "ให้ระบบสร้างหน้าเว็บให้", text: "ได้หน้าเว็บพื้นฐานพร้อมใช้ทันที" },
                      { value: "upload", icon: UploadCloud, title: "อัปโหลดไฟล์เว็บ (.zip)", text: "นำไฟล์ที่มีอยู่ขึ้นเว็บเลย" },
                      { value: "empty", icon: Boxes, title: "เว้นว่างไว้ก่อน", text: "สร้างแค่ซับโดเมน แล้วค่อยจัดการภายหลัง" },
                    ] as const).map((option) => (
                      <label key={option.value} className={`hv-choice${form.initialMethod === option.value ? " is-selected" : ""}`}>
                        <input type="radio" name="initialMethod" value={option.value} checked={form.initialMethod === option.value} onChange={() => setForm({ ...form, initialMethod: option.value })} />
                        <span className="hv-choice-icon" aria-hidden="true"><option.icon size={18} /></span>
                        <span className="hv-choice-copy"><strong>{option.title}</strong><small>{option.text}</small></span>
                      </label>
                    ))}
                  </div>

                  {form.initialMethod === "generate" && (
                    <div className="hv-segment" role="radiogroup" aria-label="ประเภทหน้าเว็บ">
                      {([
                        { value: "static", label: "Static HTML", hint: "เว็บพื้นฐาน" },
                        { value: "php", label: "PHP", hint: "ต่อฐานข้อมูลได้" },
                        { value: "node", label: "Node.js", hint: "API / แอป" },
                      ] as const).map((option) => {
                        const selected = form.projectType === option.value || (option.value === "static" && form.projectType === "auto");
                        return (
                          <label key={option.value} className={`hv-segment-item is-${option.value}${selected ? " is-selected" : ""}`}>
                            <input type="radio" name="generateTemplate" value={option.value} checked={selected} onChange={() => setForm({ ...form, projectType: option.value })} />
                            <span className={`hv-kind is-${option.value}`} aria-hidden="true"><KindIcon kind={option.value} size={16} /></span>
                            <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {form.initialMethod === "upload" && (
                    <button
                      type="button"
                      className={`hv-dropzone${deployFile ? " has-file" : ""}`}
                      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
                      onDrop={(event) => {
                        event.preventDefault(); event.stopPropagation();
                        const file = event.dataTransfer.files?.[0];
                        if (file && (file.type === "application/zip" || file.name.endsWith(".zip"))) setDeployFile(file);
                        else notify({ kind: "error", text: "กรุณาอัปโหลดไฟล์ .zip เท่านั้น" });
                      }}
                      onClick={() => deployFileInputRef.current?.click()}
                    >
                      <span className="hv-dropzone-icon" aria-hidden="true">{deployFile ? <FileArchive size={20} /> : <UploadCloud size={20} />}</span>
                      {deployFile ? (
                        <span><strong>{deployFile.name}</strong><small>{(deployFile.size / 1024 / 1024).toFixed(2)} MB · กดเพื่อเปลี่ยนไฟล์</small></span>
                      ) : (
                        <span><strong>เลือกไฟล์ .zip หรือลากมาวางที่นี่</strong><small>ไฟล์ index.html หรือ index.php ควรอยู่ชั้นบนสุด</small></span>
                      )}
                    </button>
                  )}
                  <input type="file" accept=".zip" hidden ref={deployFileInputRef} onChange={(event) => { const file = event.target.files?.[0]; if (file) setDeployFile(file); }} />
                </fieldset>
              )}

              {!editing && me?.role !== "user" && (
                <div className="hv-field">
                  <label htmlFor="hv-owner">เจ้าของเว็บไซต์</label>
                  <select id="hv-owner" className="hv-select" value={form.ownerUsername} onChange={(event) => setForm({ ...form, ownerUsername: event.target.value })}>
                    <option value="">@{me?.username || "me"} (ตัวเอง)</option>
                    {adminUsers.map((user) => (
                      <option key={user.username} value={user.username}>@{user.username}{user.displayName ? ` (${user.displayName})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <footer className="hv-dialog-foot">
              <button type="button" className="hv-btn" onClick={closeForm} disabled={saving}>ยกเลิก</button>
              <button type="submit" className="hv-btn hv-btn-primary" disabled={saving}>
                {saving ? <span className="hv-spinner" aria-hidden="true" /> : <Globe size={16} aria-hidden="true" />}
                {saving ? "กำลังดำเนินการ..." : editing ? "บันทึก" : "สร้างเว็บไซต์"}
              </button>
            </footer>
          </form>
        </section>
      </div>,
      document.body
    )}

    {detail && typeof document !== "undefined" && createPortal(
      <div className="hv-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDetail()}>
        <section className="hv-dialog hv-detail" role="dialog" aria-modal="true" aria-labelledby="hv-detail-title">
          <header className="hv-dialog-head">
            <div className="hv-dh-main">
              <span className={`hv-kind is-${detailKind}`} aria-hidden="true"><KindIcon kind={detailKind} size={20} /></span>
              <div className="hv-dh-text">
                <div className="hv-dh-row">
                  <h2 id="hv-detail-title" title={detail.site.name}>{detail.site.name}</h2>
                  <span className={`hv-status is-${detail.site.status}`}><StatusIcon status={detail.site.status} />{statusLabel[detail.site.status]}</span>
                </div>
                <a href={`https://${detail.site.subdomain}.nkn02.com`} target="_blank" rel="noreferrer" className="hv-dh-link">
                  {detail.site.subdomain}.nkn02.com <ExternalLink size={13} aria-hidden="true" />
                </a>
              </div>
            </div>
            <div className="hv-dh-actions">
              {detail.site.accessRole !== "viewer" && (
                <button type="button" className="hv-btn" onClick={() => openEdit(detail.site)}><Code2 size={15} aria-hidden="true" /><span>แก้ไข</span></button>
              )}
              {(detail.site.accessRole === "owner" || detail.site.accessRole === "platform_admin") && (
                <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={() => removeSite(detail.site)}><Trash2 size={15} aria-hidden="true" /><span>ลบ</span></button>
              )}
              <button type="button" className="hv-btn hv-icon-btn" onClick={closeDetail} aria-label="ปิด"><X size={18} /></button>
            </div>
          </header>

          <nav className="hv-tabs" role="tablist" aria-label="ส่วนของเว็บไซต์">
            {detailTabs.map((tab) => (
              <button
                type="button"
                role="tab"
                key={tab.key}
                aria-selected={detailTab === tab.key}
                className={detailTab === tab.key ? "is-active" : ""}
                onClick={() => setDetailTab(tab.key)}
              >
                {tab.label}{"count" in tab && tab.count > 0 && <b>{tab.count}</b>}
              </button>
            ))}
          </nav>

          <div className="hv-dialog-body hv-detail-body" role="tabpanel">
            {detailTab === "overview" && (
              <>
                {latestOperation?.state === "failed" && (
                  <div className="hv-callout is-error">
                    <CircleAlert size={18} aria-hidden="true" />
                    <p>
                      <strong>{operationLabel[latestOperation.kind] || latestOperation.kind} ไม่สำเร็จ</strong>
                      <span>{latestOperation.errorMessage || "ดูรายละเอียดในแท็บประวัติ"}</span>
                    </p>
                    <button type="button" onClick={() => setDetailTab("history")}>ดูประวัติ</button>
                  </div>
                )}
                {latestOperation?.state !== "failed" && (detail.site.status === "error" || detail.site.status === "expired") && (
                  <div className="hv-callout is-error">
                    <CircleAlert size={18} aria-hidden="true" />
                    <p>
                      <strong>{detail.site.status === "expired" ? "เว็บไซต์หมดอายุ" : "เว็บไซต์ทำงานผิดปกติ"}</strong>
                      <span>{detail.site.status === "expired" ? "ต่ออายุหรือติดต่อผู้ดูแลเพื่อเปิดใช้งานอีกครั้ง" : "ระบบตรวจพบว่าเว็บไม่ตอบสนอง ดูข้อความล่าสุดในแท็บบันทึก"}</span>
                    </p>
                    {detail.site.status === "error" && <button type="button" onClick={() => setDetailTab("logs")}>ดูบันทึก</button>}
                  </div>
                )}

                {detail.site.accessRole !== "viewer" && (
                  <section className="hv-section">
                    <h3>ควบคุมเว็บไซต์</h3>
                    <div className="hv-controls">
                      {detail.site.status !== "running" ? (
                        <button type="button" className="hv-btn hv-btn-primary" disabled={!!runtimeAction} onClick={() => requestRuntimeOperation("start")}>
                          <Play size={16} aria-hidden="true" /><span>เริ่มเว็บ</span>
                        </button>
                      ) : (
                        <>
                          <button type="button" className="hv-btn" disabled={!!runtimeAction} onClick={() => requestRuntimeOperation("stop")}>
                            <Square size={14} aria-hidden="true" /><span>หยุด</span>
                          </button>
                          <button type="button" className="hv-btn" disabled={!!runtimeAction} onClick={() => requestRuntimeOperation("restart")}>
                            <RotateCw size={15} aria-hidden="true" /><span>รีสตาร์ท</span>
                          </button>
                        </>
                      )}
                      <button type="button" className="hv-btn" disabled={!!runtimeAction} onClick={requestUploadDeploy}>
                        <UploadCloud size={16} aria-hidden="true" /><span>อัปโหลด ZIP</span>
                      </button>
                      <button type="button" className="hv-btn" disabled={!!runtimeAction} onClick={openFileManager} title="เปิดตัวจัดการไฟล์ในแท็บใหม่">
                        <Folder size={16} aria-hidden="true" /><span>จัดการไฟล์</span>
                      </button>
                      <button type="button" className="hv-btn hv-btn-danger-ghost hv-push" disabled={!!runtimeAction} onClick={() => requestRuntimeOperation("rebuild")}>
                        <Hammer size={15} aria-hidden="true" /><span>สร้างใหม่</span>
                      </button>
                      <input type="file" accept=".zip" ref={fileInputRef} hidden onChange={uploadDeployFile} />
                    </div>
                    {runtimeAction && <p className="hv-progress"><span className="hv-spinner" aria-hidden="true" /> {friendlyRuntimeAction[`runtime.${runtimeAction}`] || "กำลังดำเนินการ"}...</p>}
                  </section>
                )}

                <section className="hv-section">
                  <h3>ข้อมูลเว็บไซต์</h3>
                  <dl className="hv-facts">
                    <div><dt>ประเภท</dt><dd>{kindLabel[detailKind]}</dd></div>
                    <div><dt>เจ้าของ</dt><dd>@{detail.site.ownerUsername || "—"}</dd></div>
                    <div><dt>สิทธิ์ของคุณ</dt><dd>{roleLabel[detail.site.accessRole] || detail.site.accessRole}</dd></div>
                    <div><dt>สร้างเมื่อ</dt><dd>{formatDate(detail.site.createdAt)}</dd></div>
                    <div><dt>CPU / RAM</dt><dd>{detail.site.cpuMillicores ? `${(detail.site.cpuMillicores / 1000).toLocaleString("th-TH")} vCPU` : "—"} · {detail.site.memoryMb ? `${detail.site.memoryMb.toLocaleString("th-TH")} MB` : "—"}</dd></div>
                    <div><dt>พื้นที่</dt><dd>{detail.site.diskLimitMb ? `${detail.site.diskLimitMb.toLocaleString("th-TH")} MB` : "—"}</dd></div>
                    {detail.site.customDomain && detail.site.customDomain !== detail.site.subdomain && (
                      <div>
                        <dt>โดเมนเพิ่มเติม</dt>
                        <dd>
                          {detail.site.customDomain} · {detail.site.customDomainVerified ? "ยืนยันแล้ว" : "ยังไม่ได้ยืนยัน (ยังไม่เปิดให้ใช้งาน)"}
                          {!detail.site.customDomainVerified && detail.site.customDomainTxtName && detail.site.customDomainTxtValue && (
                            <>
                              <br /><small>เพิ่ม TXT record ชื่อ <code>{detail.site.customDomainTxtName}</code> ค่า <code>{detail.site.customDomainTxtValue}</code> ที่ DNS ของโดเมน แล้วกดตรวจสอบ</small>
                              <br /><button type="button" className="hv-btn" onClick={verifyDomain}>ตรวจสอบ TXT</button>
                            </>
                          )}
                        </dd>
                      </div>
                    )}
                    {detail.site.expiresAt && <div><dt>หมดอายุ</dt><dd>{formatDate(detail.site.expiresAt)}</dd></div>}
                  </dl>
                </section>
              </>
            )}

            {detailTab === "env" && (
              <section className="hv-section">
                <div className="hv-section-head">
                  <div>
                    <h3>ตัวแปร Environment</h3>
                    <p>ค่าคอนฟิกและ Secret ที่ส่งให้แอปของคุณ</p>
                  </div>
                  {environmentCanManage && (
                    <button type="button" className="hv-btn" onClick={() => setBulkEnvModalOpen(true)}>
                      <UploadCloud size={15} aria-hidden="true" /><span>นำเข้า .env</span>
                    </button>
                  )}
                </div>

                {customEnvItems.length ? (
                  <ul className="hv-env-list">
                    {customEnvItems.map((item) => {
                      const isRevealed = revealedEnvKeys[item.name];
                      const isCopied = copiedEnvKey === item.name;
                      return (
                        <li key={item.name}>
                          <code className="hv-env-key" title={item.name}>{item.name}</code>
                          {item.isSecret && <span className="hv-tag">Secret</span>}
                          <code className="hv-env-value" title={item.isSecret ? "ค่าถูกเข้ารหัส" : (isRevealed ? item.value : "")}>
                            {item.isSecret || !isRevealed ? "••••••••••" : (item.value || "(ว่าง)")}
                          </code>
                          <div className="hv-env-tools">
                            {!item.isSecret && (
                              <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => toggleRevealEnv(item.name)} aria-label={isRevealed ? "ซ่อนค่า" : "แสดงค่า"} title={isRevealed ? "ซ่อนค่า" : "แสดงค่า"}>
                                {isRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                            )}
                            <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => copyEnv(item.name, item.isSecret ? item.name : (item.value || item.name))} aria-label="คัดลอก" title={item.isSecret ? "คัดลอกชื่อตัวแปร" : "คัดลอกค่า"}>
                              {isCopied ? <Check size={15} /> : <Copy size={15} />}
                            </button>
                            {environmentCanManage && (
                              <button type="button" className="hv-btn hv-icon-btn is-sm hv-danger-icon" onClick={() => removeEnvironment(item.name)} aria-label={`ลบ ${item.name}`} title="ลบตัวแปร">
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="hv-muted-box">ยังไม่มีตัวแปรที่กำหนดเอง{environmentCanManage ? " เพิ่มด้านล่าง หรือนำเข้าจากไฟล์ .env" : ""}</p>
                )}

                {environmentCanManage && (
                  <form className="hv-env-form" autoComplete="off" onSubmit={saveEnvironment}>
                    <label className="hv-field">
                      <span>ชื่อ</span>
                      <input
                        type="text"
                        name="nexora-environment-key"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        value={environmentForm.name}
                        onChange={(event) => setEnvironmentForm({ ...environmentForm, name: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
                        placeholder="API_KEY"
                        maxLength={64}
                        required
                      />
                    </label>
                    <label className="hv-field">
                      <span>ค่า</span>
                      <input
                        name="nexora-environment-value"
                        type={environmentForm.isSecret ? "password" : "text"}
                        value={environmentForm.value}
                        onChange={(event) => setEnvironmentForm({ ...environmentForm, value: event.target.value })}
                        placeholder={environmentForm.isSecret ? "เก็บแบบเข้ารหัส" : "เช่น 3000"}
                        autoComplete="new-password"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-bwignore="true"
                      />
                    </label>
                    <label className="hv-check">
                      <input type="checkbox" checked={environmentForm.isSecret} onChange={(event) => setEnvironmentForm({ ...environmentForm, isSecret: event.target.checked })} />
                      <span>Secret</span>
                    </label>
                    <button type="submit" className="hv-btn hv-btn-primary" disabled={environmentSaving || !environmentForm.name.trim()}>
                      <Plus size={15} aria-hidden="true" /><span>{environmentSaving ? "กำลังบันทึก..." : "เพิ่ม"}</span>
                    </button>
                  </form>
                )}

                {systemDbEnvItems.length > 0 && (
                  <div className="hv-disclosure">
                    <button type="button" aria-expanded={systemDbExpanded} onClick={() => setSystemDbExpanded((value) => !value)}>
                      <Database size={15} aria-hidden="true" />
                      <span>ตัวแปรฐานข้อมูลที่ระบบสร้างให้</span>
                      <b>{systemDbEnvItems.length}</b>
                      <ChevronDown size={16} className={systemDbExpanded ? "is-open" : ""} aria-hidden="true" />
                    </button>
                    {systemDbExpanded && (
                      <ul className="hv-env-list is-system">
                        {systemDbEnvItems.map((item) => (
                          <li key={item.name}>
                            <code className="hv-env-key">{item.name}</code>
                            <code className="hv-env-value">••••••••••</code>
                            <div className="hv-env-tools">
                              <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => copyEnv(item.name, item.name)} aria-label="คัดลอกชื่อตัวแปร" title="คัดลอกชื่อตัวแปร">
                                {copiedEnvKey === item.name ? <Check size={15} /> : <Copy size={15} />}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {environmentCanManage && (
                  <div className="hv-callout">
                    <CircleAlert size={17} aria-hidden="true" />
                    <p><span>แก้ตัวแปรแล้ว ต้องติดตั้งใหม่เพื่อให้เว็บใช้ค่าล่าสุด</span></p>
                    <button type="button" disabled={!!runtimeAction} onClick={() => requestRuntimeOperation("redeploy")}>ใช้การเปลี่ยนแปลง</button>
                  </div>
                )}
              </section>
            )}

            {detailTab === "database" && (
              <section className="hv-section">
                <div className="hv-section-head">
                  <div>
                    <h3>ฐานข้อมูล</h3>
                    <p>ใช้แล้ว {siteDbs?.length || 0} จาก {maxDatabases}</p>
                  </div>
                  {detail.site.accessRole !== "viewer" && (siteDbs?.length || 0) < maxDatabases && (
                    <button type="button" className="hv-btn hv-btn-primary" onClick={() => void createDatabase()} disabled={dbLoading}>
                      <Plus size={15} aria-hidden="true" /><span>{dbLoading ? "กำลังสร้าง..." : "สร้างฐานข้อมูล"}</span>
                    </button>
                  )}
                </div>
                {siteDbs && siteDbs.length > 0 ? siteDbs.map((db) => (
                  <article className="hv-db" key={db.id || db.dbName}>
                    <dl className="hv-facts is-mono">
                      <div><dt>Host</dt><dd>{db.host}{db.port ? `:${db.port}` : ""}</dd></div>
                      <div><dt>Database</dt><dd>{db.dbName}</dd></div>
                      <div><dt>Username</dt><dd>{db.dbUser}</dd></div>
                      <div>
                        <dt>Password</dt>
                        <dd className="hv-db-pass">
                          <span>{db.dbPass ? (showDbPass ? db.dbPass : "••••••••••") : "ถูกซ่อนไว้"}</span>
                          {db.dbPass && (
                            <>
                              <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => setShowDbPass(!showDbPass)} aria-label={showDbPass ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>{showDbPass ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                              <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => { navigator.clipboard.writeText(db.dbPass!); notify({ kind: "success", text: "คัดลอกรหัสผ่านแล้ว" }); }} aria-label="คัดลอกรหัสผ่าน"><Copy size={15} /></button>
                            </>
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="hv-db-actions">
                      <button type="button" className="hv-btn" disabled={dbLoading} onClick={() => void testDatabase()}>
                        <Activity size={15} aria-hidden="true" /><span>ตรวจการเชื่อมต่อ</span>
                      </button>
                      {(db.engine === "mysql" || !db.engine) && (
                        <button type="button" className="hv-btn" disabled={dbLoading} onClick={() => openPhpMyAdmin(db)}>
                          <ExternalLink size={15} aria-hidden="true" /><span>{dbLoading ? "กำลังเปิด..." : "เปิด phpMyAdmin"}</span>
                        </button>
                      )}
                    </div>
                  </article>
                )) : (
                  <p className="hv-muted-box">ยังไม่มีฐานข้อมูลสำหรับเว็บไซต์นี้</p>
                )}
              </section>
            )}

            {detailTab === "members" && (
              <section className="hv-section">
                <div className="hv-section-head">
                  <div>
                    <h3>ผู้ร่วมงาน</h3>
                    <p>นักพัฒนาแก้ไขเว็บได้ ผู้เข้าชมดูได้อย่างเดียว</p>
                  </div>
                </div>
                <ul className="hv-members-list">
                  {detail.members.map((member) => (
                    <li key={member.userId}>
                      <span className="hv-avatar" aria-hidden="true">{(member.displayName || member.username).slice(0, 1).toUpperCase()}</span>
                      <span className="hv-member-copy"><strong>{member.displayName || member.username}</strong><small>@{member.username}</small></span>
                      <span className={`hv-tag${member.role === "owner" ? " is-owner" : ""}`}>{roleLabel[member.role] || member.role}</span>
                      {member.role !== "owner" && canManageMembers && (
                        <button type="button" className="hv-btn hv-icon-btn is-sm hv-danger-icon" onClick={() => removeMember(member)} aria-label={`นำ ${member.username} ออก`} title="นำออก"><X size={15} /></button>
                      )}
                    </li>
                  ))}
                </ul>

                {canManageMembers && (() => {
                  const inviteCandidates = me?.role === "user" ? [] : adminUsers
                    .filter((user) => user.username.toLowerCase() !== (detail.site.ownerUsername || "").toLowerCase())
                    .filter((user) => !detail.members.some((member) => member.username.toLowerCase() === user.username.toLowerCase()))
                    .map((user) => ({ username: user.username, displayName: user.displayName, source: "user" as const }));
                  return (
                    <form className="hv-invite" onSubmit={addMember}>
                      <span className="hv-label">เชิญผู้ร่วมงาน</span>
                      <div className="hv-invite-row">
                        {inviteCandidates.length > 0 ? (
                          <OwnerPickSelect candidates={inviteCandidates} value={memberForm.username} onChange={(username) => setMemberForm({ ...memberForm, username })} placeholder="เลือกผู้ใช้" />
                        ) : (
                          <input className="hv-input" value={memberForm.username} onChange={(event) => setMemberForm({ ...memberForm, username: event.target.value })} placeholder="@username" aria-label="ชื่อผู้ใช้ที่จะเชิญ" required />
                        )}
                        <RoleSelect value={memberForm.role} onChange={(value) => setMemberForm({ ...memberForm, role: value })} />
                        <button type="submit" className="hv-btn hv-btn-primary" disabled={!memberForm.username.trim()}><Plus size={15} aria-hidden="true" /><span>เชิญ</span></button>
                      </div>
                    </form>
                  );
                })()}

                {canTransferOwner && (
                  <div className="hv-transfer">
                    <span className="hv-label">โอนเจ้าของเว็บไซต์</span>
                    <p>เจ้าของปัจจุบันจะกลายเป็นนักพัฒนา</p>
                    {transferCandidates.length === 0 ? (
                      <p className="hv-muted-box">ยังไม่มีคนที่โอนให้ได้ เชิญผู้ร่วมงานก่อน</p>
                    ) : (
                      <div className="hv-invite-row">
                        <OwnerPickSelect candidates={transferCandidates} value={ownerUsername} onChange={setOwnerUsername} placeholder="เลือกเจ้าของคนใหม่" />
                        <button type="button" className="hv-btn hv-btn-danger-ghost" onClick={transferOwner} disabled={!ownerUsername.trim()}>โอนสิทธิ์</button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {detailTab === "history" && (
              <section className="hv-section">
                <div className="hv-section-head">
                  <div>
                    <h3>ประวัติการทำงาน</h3>
                    <p>คำสั่งล่าสุดและผลลัพธ์</p>
                  </div>
                </div>
                {detail.operations.length ? (
                  <ul className="hv-ops">
                    {detail.operations.slice((opPage - 1) * 6, opPage * 6).map((operation) => (
                      <li key={operation.operationId} className={`is-${operation.state}`}>
                        <span className="hv-op-icon" aria-hidden="true">
                          {operation.state === "succeeded" ? <CircleCheck size={16} /> : operation.state === "failed" ? <CircleX size={16} /> : <RefreshCw size={15} />}
                        </span>
                        <div className="hv-op-copy">
                          <strong>{operationLabel[operation.kind] || operation.kind}</strong>
                          <small>
                            {operationStateLabel[operation.state] || operation.state} · {formatDate(operation.startedAt)}
                            {operation.attempt > 1 && ` · ครั้งที่ ${operation.attempt}`}
                          </small>
                          {operation.state === "failed" && operation.errorMessage && <p className="hv-op-error">{operation.errorMessage}</p>}
                        </div>
                        <button type="button" className="hv-op-id" onClick={() => copyOperationID(operation.operationId)} title="คัดลอกหมายเลขรายการ">#{operation.operationId.slice(0, 8)}</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hv-muted-box">ยังไม่มีประวัติ รายการจะขึ้นเมื่อเริ่ม หยุด หรืออัปเดตเว็บไซต์</p>
                )}
                {detail.operations.length > 6 && (
                  <HvPager page={opPage} pages={Math.ceil(detail.operations.length / 6)} onPage={setOpPage} />
                )}
              </section>
            )}

            {detailTab === "logs" && (
              <section className="hv-section">
                <div className="hv-section-head">
                  <div>
                    <h3>บันทึกการทำงาน</h3>
                    <p>ข้อความจากระบบและแอป ใช้ดูเมื่อเว็บมีปัญหา</p>
                  </div>
                  <button type="button" className="hv-btn" onClick={refreshActivity} disabled={activityRefreshing}>
                    <RefreshCw size={15} className={activityRefreshing ? "hv-spin" : ""} aria-hidden="true" /><span>รีเฟรช</span>
                  </button>
                </div>
                {runtimeLogs.length ? (
                  <ul className="hv-logs">
                    {runtimeLogs.slice((logPage - 1) * 5, logPage * 5).map((item) => (
                      <li key={item.id}>
                        <div className="hv-log-meta">
                          <span className={`hv-tag is-${item.stream}`}>{logStreamLabel[item.stream] || item.stream}</span>
                          <time>{formatDate(item.createdAt)}</time>
                        </div>
                        {formatRuntimeMessage(item.message).map((line, index) => (
                          <p className={`hv-log-line is-${line.tone || "muted"}`} key={`${item.id}-${index}`}>
                            <span>{line.label}</span>
                            <strong>{line.text}</strong>
                            {line.detail && <small>{line.detail}</small>}
                          </p>
                        ))}
                        <details className="hv-log-raw">
                          <summary>ข้อมูลดิบ</summary>
                          <pre>{item.message}</pre>
                        </details>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hv-muted-box">ยังไม่มีบันทึก ข้อความจะขึ้นเมื่อเว็บไซต์เริ่มทำงาน</p>
                )}
                {runtimeLogs.length > 5 && (
                  <HvPager page={logPage} pages={Math.ceil(runtimeLogs.length / 5)} onPage={setLogPage} />
                )}
              </section>
            )}
          </div>
        </section>
      </div>,
      document.body
    )}

    {bulkEnvModalOpen && typeof document !== "undefined" && createPortal(
      <div className="hv-backdrop is-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !bulkEnvImporting) setBulkEnvModalOpen(false); }}>
        <section className="hv-dialog hv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="hv-bulk-title">
          <header className="hv-dialog-head">
            <div className="hv-dh-main">
              <UploadCloud size={20} className="hv-dh-icon" aria-hidden="true" />
              <div className="hv-dh-text">
                <small>{detail?.site.subdomain ? `${detail.site.subdomain}.nkn02.com` : "ตัวแปร Environment"}</small>
                <h2 id="hv-bulk-title">นำเข้าตัวแปร .env</h2>
              </div>
            </div>
            <button type="button" className="hv-btn hv-icon-btn" onClick={() => setBulkEnvModalOpen(false)} disabled={bulkEnvImporting} aria-label="ปิด"><X size={18} /></button>
          </header>
          <div className="hv-dialog-body">
            <div className="hv-field">
              <div className="hv-field-row">
                <label htmlFor="hv-bulk-text">KEY=VALUE บรรทัดละตัวแปร</label>
                {bulkEnvText && <button type="button" className="hv-link-btn" onClick={() => setBulkEnvText("")}>ล้าง</button>}
              </div>
              <textarea
                id="hv-bulk-text"
                className="hv-textarea"
                rows={8}
                value={bulkEnvText}
                onChange={(event) => setBulkEnvText(event.target.value)}
                placeholder={"API_KEY=your_secret_key\nPORT=3000\nDATABASE_URL=postgres://..."}
                spellCheck={false}
                autoFocus
              />
            </div>
            <label className="hv-check is-card">
              <input type="checkbox" checked={bulkEnvIsSecret} onChange={(event) => setBulkEnvIsSecret(event.target.checked)} />
              <span><strong>เก็บทั้งหมดเป็น Secret</strong><small>เข้ารหัสและไม่แสดงค่าอีก</small></span>
            </label>
          </div>
          <footer className="hv-dialog-foot">
            <button type="button" className="hv-btn" onClick={() => setBulkEnvModalOpen(false)} disabled={bulkEnvImporting}>ยกเลิก</button>
            <button type="button" className="hv-btn hv-btn-primary" onClick={() => void handleBulkImport()} disabled={bulkEnvImporting || !bulkEnvText.trim()}>
              <UploadCloud size={16} aria-hidden="true" /><span>{bulkEnvImporting ? "กำลังนำเข้า..." : "นำเข้า"}</span>
            </button>
          </footer>
        </section>
      </div>,
      document.body
    )}
  </>;
}

function HvPager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  return (
    <nav className="hv-pager" aria-label="เลือกหน้า">
      <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} aria-label="หน้าก่อนหน้า"><ChevronLeft size={16} /></button>
      {getPaginationRange(page, pages).map((p, index) => p === "..."
        ? <span key={`gap-${index}`} aria-hidden="true">…</span>
        : <button type="button" key={p} className={p === page ? "is-active" : ""} aria-current={p === page ? "page" : undefined} onClick={() => onPage(p as number)}>{p}</button>)}
      <button type="button" onClick={() => onPage(Math.min(pages, page + 1))} disabled={page === pages} aria-label="หน้าถัดไป"><ChevronRight size={16} /></button>
    </nav>
  );
}

function projectKind(site: HostingSite) {
  const type = (site.detectedProjectType || site.projectType || "static").toLowerCase();
  return type === "php" || type === "node" ? type : "static";
}

const kindLabel: Record<string, string> = { php: "PHP", node: "Node.js", static: "Static HTML" };

function StatusIcon({ status }: { status: HostingSite["status"] }) {
  if (status === "running") return <CircleCheck size={13} aria-hidden="true" />;
  if (status === "error") return <CircleX size={13} aria-hidden="true" />;
  if (status === "provisioning") return <RefreshCw size={12} aria-hidden="true" />;
  if (status === "expired") return <Clock3 size={13} aria-hidden="true" />;
  return <Square size={11} aria-hidden="true" />;
}

function KindIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  return kind === "php" ? <Database size={size} /> : kind === "node" ? <Hexagon size={size} /> : <Globe size={size} />;
}

