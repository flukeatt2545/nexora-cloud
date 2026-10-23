import {
  ArrowRightLeft, Check, ChevronDown, Copy, Database, ExternalLink, KeyRound, Lock,
  PauseCircle, PlayCircle, Plus, RefreshCw, Search, Trash2, X,
  Bot, Sparkles, Edit3, Users, CheckCircle2, Clock, FileCode, Unlink,
  Globe, Code2, HardDrive,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../runtime";
import { useEscape, useScrollLock } from "./useScrollLock";
import { errorText, type Ask, type Notify, type Viewer } from "./types";
import "./hosting-view.css";
import "./db-admin-view.css";

type DatabaseAdminViewProps = {
  me: Viewer;
  notify: Notify;
  ask: Ask;
};

/** A MySQL database as /api/admin/hosting/databases lists it; newPass is only known right after it was set. */
type Db = {
  id: string;
  dbName: string;
  dbUser: string;
  host: string;
  port: number;
  engine?: string;
  siteName?: string;
  siteSubdomain?: string;
  ownerUsername?: string;
  ownerName?: string;
  ownerDisplayName?: string;
  status: string;
  sizeBytes?: number;
  newPass?: string;
};

/** A student code and what it opens: a database, a site, and the Discord account that claimed it. */
type Mapping = {
  id: number;
  studentCode: string;
  studentName?: string;
  ownerName?: string;
  notes?: string;
  dbName?: string;
  dbUser?: string;
  dbPublicId?: string;
  siteId?: number;
  siteName?: string;
  siteSubdomain?: string;
  sitePublicId?: string;
  discordUserId?: string;
  discordUsername?: string;
};

type SiteOption = { id: string; name: string; subdomain: string };
type UserOption = { id: number; username: string; displayName?: string };

function formatBytes(bytes: number = 0): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function siteLabel(db: Pick<Db, "siteName" | "siteSubdomain">): string {
  if (db?.siteName && String(db.siteName).trim()) return db.siteName;
  if (db?.siteSubdomain) return `${db.siteSubdomain}.nkn02.com`;
  return "ไม่ได้ผูกกับเว็บไซต์";
}

function CustomUserSelect({ users, me, value, onChange }: { users: UserOption[]; me: Viewer; value: string; onChange: (val: string) => void }) {
  const [open, setOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedUser = users.find((u) => u.username === value) || (value === "" ? me : null);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    setOpen(!open);
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleResize() { setOpen(false); }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const filteredUsers = users.filter((u) =>
    u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
    (u.displayName && u.displayName.toLowerCase().includes(userSearch.toLowerCase()))
  );

  return (
    <div className="db-user-select">
      <div ref={triggerRef} onClick={toggleOpen} className={`db-user-select-trigger ${open ? "open" : ""}`} role="button" tabIndex={0}>
        <div className="db-user-select-current">
          <div className="db-user-avatar">{(selectedUser?.displayName || selectedUser?.username || "M")[0].toUpperCase()}</div>
          <div>
            <strong className="db-user-name">
              {selectedUser ? (selectedUser.displayName || selectedUser.username) : (me?.displayName || me?.username || "บัญชีปัจจุบัน")}
              {(selectedUser?.username === me?.username || !value) && <span className="db-user-self">(บัญชีของคุณ)</span>}
            </strong>
            <small className="db-user-handle">@{selectedUser?.username || me?.username}</small>
          </div>
        </div>
        <ChevronDown size={18} className={`db-user-chevron ${open ? "open" : ""}`} />
      </div>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={dropdownRef} className="db-user-dropdown" style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}>
          {users.length > 5 && (
            <div className="db-user-search">
              <input type="text" placeholder="ค้นหาผู้ใช้งาน..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} onClick={(e) => e.stopPropagation()} />
            </div>
          )}
          {filteredUsers.map((u) => {
            const isSelected = value === u.username || (!value && u.username === me?.username);
            return (
              <div
                key={u.id}
                onClick={() => {
                  onChange(u.username === me?.username ? "" : u.username);
                  setOpen(false);
                }}
                className={`db-user-option ${isSelected ? "selected" : ""}`}
              >
                <div className="db-user-option-main">
                  <div className="db-user-option-avatar">{(u.displayName || u.username)[0].toUpperCase()}</div>
                  <div>
                    <strong className="db-user-option-name">
                      {u.displayName || u.username} {u.username === me?.username && <span className="db-user-self">(คุณ)</span>}
                    </strong>
                    <small className="db-user-option-handle">@{u.username}</small>
                  </div>
                </div>
                {isSelected && <Check size={18} className="db-user-check" />}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function DatabaseAdminView({ me, notify, ask }: DatabaseAdminViewProps) {
  const [dbs, setDbs] = useState<Db[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selectedDb, setSelectedDb] = useState<Db | null>(null);
  // Rows ticked for a bulk suspend/restore, and rows whose status change is in flight.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const lastPickRef = useRef<number | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [transferTargetDb, setTransferTargetDb] = useState<Db | null>(null);
  const [transferUsername, setTransferUsername] = useState("");
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  // Student DB Mappings state (for Discord Bot & Fast Student Access)
  const [adminTab, setAdminTab] = useState<"databases" | "mappings">("databases");
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [mappingSearch, setMappingSearch] = useState("");
  const [mappingFilter, setMappingFilter] = useState<"all" | "bound" | "unbound">("all");
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectingSites, setAutoDetectingSites] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [mappingSubmitting, setMappingSubmitting] = useState(false);
  const [editingMapping, setEditingMapping] = useState<{
    id?: number;
    studentCode: string;
    studentName: string;
    // Public ids of the database and site ("" = not bound).
    dbPublicId: string;
    sitePublicId: string;
    notes: string;
  }>({
    studentCode: "",
    studentName: "",
    dbPublicId: "",
    sitePublicId: "",
    notes: "",
  });

  const dbRequestRef = useRef(0);
  const loadDbs = useCallback(async () => {
    const request = ++dbRequestRef.current;
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (search.trim()) q.set("q", search.trim());
      const res = await fetch(API_BASE + "/api/admin/hosting/databases?" + q.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("ไม่สามารถโหลดฐานข้อมูลได้");
      const data = await res.json();
      // A slower reply to an older search must not replace the newer list.
      if (request === dbRequestRef.current) setDbs(data.items || []);
    } catch (err) {
      if (request === dbRequestRef.current) notify({ kind: "error", text: errorText(err) });
    } finally {
      if (request === dbRequestRef.current) setLoading(false);
    }
  }, [search, notify]);

  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    try {
      const res = await fetch(API_BASE + "/api/admin/student-mappings", { credentials: "include" });
      if (!res.ok) throw new Error("ไม่สามารถโหลดรายการจับคู่ได้");
      const data = await res.json();
      setMappings(data.items || []);
    } catch (err) {
      notify({ kind: "error", text: errorText(err) });
    } finally {
      setMappingsLoading(false);
    }
  }, [notify]);

  const loadSites = useCallback(async () => {
    setSitesLoading(true);
    try {
      const res = await fetch(API_BASE + "/api/hosting/sites?limit=500", { credentials: "include" });
      if (!res.ok) throw new Error("ไม่สามารถโหลดข้อมูลเว็บไซต์ได้");
      const data = await res.json();
      setSites(data.items || []);
    } catch (err) {
      console.warn("loadSites error:", errorText(err));
    } finally {
      setSitesLoading(false);
    }
  }, []);

  // Search refetches after typing pauses; the first load (empty search) goes straight away.
  useEffect(() => {
    const timer = window.setTimeout(loadDbs, search.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [search, loadDbs]);
  // Owners to pick from when creating or moving a database.
  useEffect(() => {
    fetch(API_BASE + "/api/admin/users?limit=200", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setUsers(data.items || []); })
      .catch(() => {});
  }, []);

  // The mapping list loads each time its tab is opened.
  function showTab(tab: "databases" | "mappings") {
    if (tab === adminTab) return;
    setAdminTab(tab);
    if (tab === "mappings") {
      loadMappings();
      loadSites();
    }
  }

  const boundCount = useMemo(() => mappings.filter((m) => Boolean(m.discordUserId)).length, [mappings]);
  const unboundCount = useMemo(() => mappings.filter((m) => !m.discordUserId).length, [mappings]);
  const boundPercent = useMemo(
    () => (mappings.length > 0 ? Math.round((boundCount / mappings.length) * 100) : 0),
    [boundCount, mappings.length]
  );

  const filtered = useMemo(() => {
    if (!status) return dbs;
    if (status === "suspended") return dbs.filter((d) => d.status === "suspended");
    return dbs.filter((d) => d.status !== "suspended");
  }, [dbs, status]);

  const dbStats = useMemo(() => {
    const total = dbs.length;
    const active = dbs.filter((d) => d.status !== "suspended").length;
    const suspended = dbs.filter((d) => d.status === "suspended").length;
    const totalBytes = dbs.reduce((acc, d) => acc + (d.sizeBytes || 0), 0);
    return { total, active, suspended, totalBytes };
  }, [dbs]);

  const pickedShown = useMemo(() => filtered.filter((d) => picked.has(d.id)), [filtered, picked]);
  const pickedSuspended = pickedShown.filter((d) => d.status === "suspended");
  const pickedActive = pickedShown.filter((d) => d.status !== "suspended");
  const anyBusy = busyIds.size > 0;

  const filteredMappings = useMemo(() => {
    let list = mappings;
    if (mappingFilter === "bound") {
      list = list.filter((m) => Boolean(m.discordUserId));
    } else if (mappingFilter === "unbound") {
      list = list.filter((m) => !m.discordUserId);
    }
    if (!mappingSearch.trim()) return list;
    const q = mappingSearch.toLowerCase();
    return list.filter((m) =>
      (m.studentCode && m.studentCode.toLowerCase().includes(q)) ||
      (m.studentName && m.studentName.toLowerCase().includes(q)) ||
      (m.dbName && m.dbName.toLowerCase().includes(q)) ||
      (m.siteName && m.siteName.toLowerCase().includes(q)) ||
      (m.siteSubdomain && m.siteSubdomain.toLowerCase().includes(q)) ||
      (m.ownerName && m.ownerName.toLowerCase().includes(q)) ||
      (m.discordUsername && m.discordUsername.toLowerCase().includes(q))
    );
  }, [mappings, mappingFilter, mappingSearch]);

  const hasFilters = Boolean(search.trim() || status);

  async function submitSaveMapping(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMapping.studentCode.trim()) {
      notify({ kind: "error", text: "กรุณาระบุรหัส 3 ตัวท้าย" });
      return;
    }
    if (!editingMapping.dbPublicId && !editingMapping.sitePublicId) {
      notify({ kind: "error", text: "กรุณาเลือกฐานข้อมูลหรือเว็บไซต์ที่ต้องการผูกอย่างน้อย 1 รายการ" });
      return;
    }
    setMappingSubmitting(true);
    try {
      const payload: { studentCode: string; studentName: string; dbPublicId: string; sitePublicId: string; notes: string; id?: number } = {
        studentCode: editingMapping.studentCode.trim(),
        studentName: editingMapping.studentName.trim(),
        dbPublicId: editingMapping.dbPublicId,
        sitePublicId: editingMapping.sitePublicId,
        notes: editingMapping.notes.trim(),
      };
      if (editingMapping.id) {
        payload.id = editingMapping.id;
      }
      const res = await fetch(API_BASE + "/api/admin/student-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ไม่สามารถบันทึกได้");
      notify({ kind: "success", text: "บันทึกการผูกรหัสสำเร็จ" });
      setShowMappingModal(false);
      loadMappings();
    } catch (err) {
      notify({ kind: "error", text: errorText(err) });
    } finally {
      setMappingSubmitting(false);
    }
  }

  function handleDeleteMapping(mapping: Mapping) {
    ask({
      title: "ลบการผูกรหัส",
      message: `ต้องการลบการผูกรหัส ${mapping.studentCode} (${mapping.dbName || mapping.siteName || mapping.siteSubdomain || "รายการนี้"}) ใช่หรือไม่? (ฐานข้อมูลและเว็บไซต์จะไม่ถูกลบ)`,
      confirmLabel: "ลบรายการ",
      danger: true,
      action: async () => {
        try {
          const res = await fetch(API_BASE + "/api/admin/student-mappings/" + mapping.id, {
            method: "DELETE",
            credentials: "include",
          });
          if (!res.ok) throw new Error("ไม่สามารถลบได้");
          notify({ kind: "success", text: "ลบการผูกรหัสเรียบร้อยแล้ว" });
          loadMappings();
        } catch (err) {
          notify({ kind: "error", text: errorText(err) });
        }
      },
    });
  }

  function handleUnlinkSite(mapping: Mapping) {
    ask({
      title: "ปลดการผูกเว็บไซต์",
      message: `ต้องการปลดการผูกเว็บไซต์ (${mapping.siteName || mapping.siteSubdomain}) ออกจากรหัส ${mapping.studentCode} ใช่หรือไม่? (เว็บไซต์จะไม่ถูกลบ)`,
      confirmLabel: "ปลดการผูก",
      danger: true,
      action: async () => {
        try {
          const res = await fetch(API_BASE + "/api/admin/student-mappings/" + mapping.id + "/unlink-site", {
            method: "POST",
            credentials: "include",
          });
          if (!res.ok) throw new Error("ไม่สามารถปลดการผูกเว็บไซต์ได้");
          notify({ kind: "success", text: "ปลดการผูกเว็บไซต์เรียบร้อยแล้ว" });
          loadMappings();
        } catch (err) {
          notify({ kind: "error", text: errorText(err) });
        }
      },
    });
  }

  async function handleAutoDetectMappings() {
    setAutoDetecting(true);
    try {
      const res = await fetch(API_BASE + "/api/admin/student-mappings/auto-detect", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ไม่สามารถตรวจจับได้");
      notify({ kind: "success", text: `ตรวจจับและผูกรหัสฐานข้อมูลอัตโนมัติสำเร็จ ${data.mappedCount || 0} รายการ` });
      loadMappings();
    } catch (err) {
      notify({ kind: "error", text: errorText(err) });
    } finally {
      setAutoDetecting(false);
    }
  }

  async function handleAutoDetectSites() {
    setAutoDetectingSites(true);
    try {
      const res = await fetch(API_BASE + "/api/admin/student-mappings/auto-detect-sites", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ไม่สามารถตรวจจับเว็บไซต์ได้");
      notify({ kind: "success", text: `ตรวจจับและผูกเว็บไซต์อัตโนมัติสำเร็จ ${data.mappedCount || 0} รายการ` });
      loadMappings();
    } catch (err) {
      notify({ kind: "error", text: errorText(err) });
    } finally {
      setAutoDetectingSites(false);
    }
  }

  function copyMappingEnv(m: Mapping) {
    const envContent = [
      `# NEXORA Cloud MySQL - Student ${m.studentCode}${m.studentName ? ` (${m.studentName})` : ""}`,
      `DB_CONNECTION=mysql`,
      `DB_HOST=db.nkn02.com`,
      `DB_PORT=3306`,
      `DB_DATABASE=${m.dbName}`,
      `DB_USERNAME=${m.dbUser}`,
    ].join("\n");
    void copyText(envContent, `.env ของรหัส ${m.studentCode}`);
  }

  function handleUnbindDiscord(mapping: Mapping) {
    ask({
      title: "ปลดการผูกบัญชี Discord",
      message: `ต้องการยกเลิกสิทธิ์ Discord (${mapping.discordUsername || mapping.discordUserId || "บัญชีที่ผูก"}) ของรหัส ${mapping.studentCode} ใช่หรือไม่? บัญชีเดิมจะเข้าฐานข้อมูลไม่ได้อีก ลิงก์เก่าและรหัสผ่านเก่าจะใช้ไม่ได้ และมีแค่บัญชี Discord ใหม่เท่านั้นที่ผูกแทนได้`,
      confirmLabel: "ปลดการผูก",
      danger: true,
      action: async () => {
        try {
          const res = await fetch(API_BASE + "/api/admin/student-mappings/" + mapping.id + "/unbind-discord", {
            method: "POST",
            credentials: "include",
          });
          if (!res.ok) throw new Error("ไม่สามารถปลดการผูกได้");
          notify({ kind: "success", text: "ยกเลิกสิทธิ์และตัดการเข้าฐานข้อมูลเรียบร้อยแล้ว" });
          loadMappings();
        } catch (err) {
          notify({ kind: "error", text: errorText(err) });
        }
      },
    });
  }

  function handleUnbindAllDiscord() {
    ask({
      title: "ปลดการผูก Discord ทั้งหมด",
      message: `ต้องการปลดการผูกบัญชี Discord ทั้งหมด (${boundCount} บัญชี) ใช่หรือไม่? ลิงก์เก่าและรหัสผ่านเก่าจะใช้ไม่ได้อีก ทุกคนต้องกดเข้าใช้งานใหม่เพื่อยืนยันตัวตน`,
      confirmLabel: "ปลดผูกทั้งหมด",
      danger: true,
      action: async () => {
        try {
          const res = await fetch(API_BASE + "/api/admin/student-mappings/unbind-all", {
            method: "POST",
            credentials: "include",
          });
          if (!res.ok) throw new Error("ไม่สามารถปลดการผูกได้");
          const data = await res.json();
          notify({ kind: "success", text: `ปลดการผูกบัญชี Discord ทั้งหมดเรียบร้อยแล้ว (${data.unboundCount || 0} รายการ)` });
          loadMappings();
        } catch (err) {
          notify({ kind: "error", text: errorText(err) });
        }
      },
    });
  }

  function openDetail(db: Db) {
    setSelectedDb(db);
  }

  function closeDetail() {
    setSelectedDb(null);
  }

  async function submitCreateDatabase(e: React.FormEvent) {
    e.preventDefault();
    setCreateSubmitting(true);
    try {
      const res = await fetch(API_BASE + "/api/admin/hosting/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUsername: createUsername.trim() }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ไม่สามารถสร้างฐานข้อมูลได้");
      notify({ kind: "success", text: "สร้างฐานข้อมูลสำเร็จ" });
      setShowCreateModal(false);
      setCreateUsername("");
      await loadDbs();
      openDetail({
        id: data.id,
        dbName: data.dbName,
        dbUser: data.dbUser,
        host: data.host || "tenant-db",
        port: data.port || 3306,
        engine: data.engine || "mysql",
        siteName: "",
        siteSubdomain: "",
        ownerDisplayName: me?.displayName || me?.username,
        ownerUsername: createUsername.trim() || me?.username,
        status: "active",
        sizeBytes: 0,
        newPass: data.dbPass,
      });
    } catch (err) {
      notify({ kind: "error", text: errorText(err) });
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function submitTransferOwnership(e: React.FormEvent) {
    e.preventDefault();
    if (!transferTargetDb) return;
    const nextOwner = transferUsername.trim() || me?.username || "";
    if (!nextOwner) return;
    setTransferSubmitting(true);
    try {
      const res = await fetch(API_BASE + "/api/admin/hosting/databases/" + transferTargetDb.id + "/transfer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerUsername: nextOwner }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "ไม่สามารถย้ายเจ้าของได้");
      }
      notify({ kind: "success", text: "ย้ายเจ้าของสำเร็จ" });
      setTransferTargetDb(null);
      setTransferUsername("");
      closeDetail();
      loadDbs();
    } catch (err) {
      notify({ kind: "error", text: errorText(err) });
    } finally {
      setTransferSubmitting(false);
    }
  }

  // Shift-click ticks every row between the last ticked row and this one.
  function pickRow(index: number, on: boolean, range: boolean) {
    const last = lastPickRef.current;
    const from = range && last !== null ? Math.min(last, index) : index;
    const to = range && last !== null ? Math.max(last, index) : index;
    const ids = filtered.slice(from, to + 1).map((d) => d.id);
    lastPickRef.current = index;
    setPicked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  function nameList(list: Db[]) {
    const names = list.map((d) => d.dbName);
    return names.length > 5 ? `${names.slice(0, 5).join(", ")} และอีก ${names.length - 5} รายการ` : names.join(", ");
  }

  function markBusy(ids: string[], on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  async function changeStatus(list: Db[], suspend: boolean) {
    const ids = list.map((d) => d.id);
    const verb = suspend ? "ระงับ" : "ปลดระงับ";
    markBusy(ids, true);
    try {
      if (list.length === 1) {
        const res = await fetch(API_BASE + "/api/admin/hosting/databases/" + ids[0] + "/suspend", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suspend }),
          credentials: "include",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `${verb}ไม่สำเร็จ`);
        }
        notify({ kind: "success", text: `${verb} ${list[0].dbName} แล้ว` });
      } else {
        const res = await fetch(API_BASE + "/api/admin/hosting/databases/bulk-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, suspend }),
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `${verb}ไม่สำเร็จ`);
        const failed: string[] = data.failed || [];
        if (failed.length) notify({ kind: "error", text: `${verb}ไม่สำเร็จ ${failed.length} รายการ: ${failed.join(", ")}` });
        else notify({ kind: "success", text: `${verb} ${(data.done || []).length} ฐานข้อมูลแล้ว` });
      }
      setPicked((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      if (selectedDb && ids.includes(selectedDb.id)) closeDetail();
      await loadDbs();
    } catch (err) {
      notify({ kind: "error", text: errorText(err) });
    } finally {
      markBusy(ids, false);
    }
  }

  function confirmStatus(list: Db[], suspend: boolean) {
    if (!list.length) return;
    const many = list.length > 1;
    const subject = many ? `${list.length} ฐานข้อมูล` : list[0].dbName;
    ask({
      title: `${suspend ? "ระงับ" : "ปลดระงับ"} ${subject}?`,
      message: suspend
        ? `บัญชี MySQL ของ ${nameList(list)} จะถูกล็อกและตัดการเชื่อมต่อทันที เว็บที่ใช้${many ? "ฐานเหล่านี้" : "ฐานนี้"}จะใช้ฐานข้อมูลและเปิด phpMyAdmin ไม่ได้ จนกว่าจะปลดระงับ`
        : `บัญชี MySQL ของ ${nameList(list)} จะถูกปลดล็อก เว็บกลับมาใช้ฐานข้อมูลและเปิด phpMyAdmin ได้ตามปกติ`,
      confirmLabel: suspend ? (many ? `ระงับ ${list.length} รายการ` : "ระงับ") : (many ? `ปลดระงับ ${list.length} รายการ` : "ปลดระงับ"),
      danger: suspend,
      action: () => changeStatus(list, suspend),
    });
  }

  function handleResetPassword(db: Db) {
    ask({
      title: "เปลี่ยนรหัสผ่าน MySQL",
      message: `ระบบจะสร้างรหัสผ่านใหม่ให้ ${db.dbName} ทันที รหัสเดิมจะใช้ไม่ได้ เว็บหรือแอปที่เชื่อมต่ออยู่ต้องเปลี่ยนเป็นรหัสใหม่`,
      confirmLabel: "เปลี่ยนรหัสผ่าน",
      danger: true,
      action: async () => {
        try {
          const res = await fetch(API_BASE + "/api/admin/hosting/databases/" + db.id + "/password", {
            method: "PATCH",
            credentials: "include",
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "ไม่สามารถเปลี่ยนรหัสผ่านได้");
          notify({ kind: "success", text: "เปลี่ยนรหัสผ่านสำเร็จ" });
          setSelectedDb({ ...db, newPass: data.newPassword });
        } catch (err) {
          notify({ kind: "error", text: errorText(err) });
        }
      },
    });
  }

  function handleDelete(db: Db) {
    ask({
      title: "ลบฐานข้อมูลถาวร",
      message: `ลบ ${db.dbName} แล้วข้อมูลทั้งหมดจะหายไปและกู้คืนไม่ได้`,
      confirmLabel: "ยืนยันการลบ",
      danger: true,
      action: async () => {
        try {
          const res = await fetch(API_BASE + "/api/admin/hosting/databases/" + db.id, {
            method: "DELETE",
            credentials: "include",
          });
          if (!res.ok) throw new Error("ไม่สามารถลบฐานข้อมูลได้");
          notify({ kind: "success", text: "ลบฐานข้อมูลสำเร็จ" });
          closeDetail();
          loadDbs();
        } catch (err) {
          notify({ kind: "error", text: errorText(err) });
        }
      },
    });
  }

  async function openPhpMyAdmin(db: { id: string }) {
    try {
      const res = await fetch(API_BASE + "/api/admin/hosting/databases/" + db.id + "/phpmyadmin", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ไม่สามารถเปิด phpMyAdmin ได้");
      let pmaUrl = data.url;
      if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        if (pmaUrl.includes("localhost")) {
          pmaUrl = "https://nove666.pro/login";
        }
      }
      const form = document.createElement("form");
      form.method = "POST";
      form.action = pmaUrl;
      form.target = "pma_session";
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "ticket";
      field.value = data.ticket;
      form.appendChild(field);
      document.body.appendChild(form);
      form.submit();
      form.remove();
    } catch (err) {
      notify({ kind: "error", text: errorText(err) });
    }
  }

  const [copiedKey, setCopiedKey] = useState("");
  const copiedTimer = useRef<number | undefined>(undefined);
  function flashCopied(key: string) {
    setCopiedKey(key);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedKey(""), 1600);
  }

  // Resolves true only when the text really reached the clipboard.
  async function copyText(text: string, label: string, key?: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify({ kind: "success", text: `คัดลอก ${label} แล้ว` });
      if (key) flashCopied(key);
      return true;
    } catch {
      notify({ kind: "error", text: `คัดลอก ${label} ไม่ได้ ลองคลิกที่หน้าเว็บแล้วกดอีกครั้ง` });
      return false;
    }
  }

  function copyAllConnection(db: Db, key?: string) {
    const pass = db.newPass ? `\nPassword: ${db.newPass}` : "\nPassword: (ใช้รหัสที่สร้างไว้ก่อนหน้า)";
    void copyText(
      `Host: ${db.host}\nPort: ${db.port}\nDatabase: ${db.dbName}\nUsername: ${db.dbUser}${pass}`,
      "ข้อมูลเชื่อมต่อ",
      key,
    );
  }

  const dialogOpen = Boolean(selectedDb || showCreateModal || transferTargetDb || showMappingModal);
  useScrollLock(dialogOpen);
  useEscape(dialogOpen, () => {
    if (transferTargetDb) { if (!transferSubmitting) setTransferTargetDb(null); }
    else if (showMappingModal) { if (!mappingSubmitting) setShowMappingModal(false); }
    else if (showCreateModal) { if (!createSubmitting) setShowCreateModal(false); }
    else closeDetail();
  });

  const isMappings = adminTab === "mappings";
  const siteBoundCount = mappings.filter((m) => m.siteId || m.siteSubdomain).length;
  const mappingFiltered = Boolean(mappingSearch.trim() || mappingFilter !== "all");
  const skeleton = (
    <ul className="hv-list" aria-busy="true">
      {[0, 1, 2].map((i) => <li className="hv-row is-skeleton" key={i}><span /><span /><span /></li>)}
    </ul>
  );

  function openMappingForm(m?: Mapping) {
    setEditingMapping(m
      ? { id: m.id, studentCode: m.studentCode, studentName: m.studentName || "", dbPublicId: m.dbPublicId || "", sitePublicId: m.sitePublicId || "", notes: m.notes || "" }
      : { studentCode: "", studentName: "", dbPublicId: "", sitePublicId: "", notes: "" });
    setShowMappingModal(true);
  }

  return (
    <div className="aov hv dbv" aria-busy={isMappings ? mappingsLoading : loading}>
      <header className="aov-head">
        <div>
          <h1>ฐานข้อมูล</h1>
          <p className="aov-sub">ฐานข้อมูล MySQL ทั้งหมด และการจับคู่รหัสนักศึกษากับบอท Discord</p>
        </div>
        <div className="aov-head-actions">
          <button
            type="button"
            className="aov-btn"
            onClick={() => (isMappings ? (loadMappings(), loadSites()) : loadDbs())}
            disabled={isMappings ? mappingsLoading : loading}
            aria-label="รีเฟรชข้อมูล"
            title="รีเฟรชข้อมูล"
          >
            <RefreshCw size={16} aria-hidden="true" className={(isMappings ? mappingsLoading || sitesLoading : loading) ? "spin" : ""} />
          </button>
          {isMappings ? (
            <button type="button" className="aov-btn aov-btn-label aov-btn-primary" onClick={() => openMappingForm()}>
              <Plus size={16} aria-hidden="true" /> เพิ่มการจับคู่
            </button>
          ) : (
            <button type="button" className="aov-btn aov-btn-label aov-btn-primary" onClick={() => { setCreateUsername(""); setShowCreateModal(true); }}>
              <Plus size={16} aria-hidden="true" /> สร้างฐานข้อมูล
            </button>
          )}
        </div>
      </header>

      <nav className="hv-tabs dbv-tabs" role="tablist" aria-label="มุมมอง">
        <button type="button" role="tab" aria-selected={!isMappings} className={!isMappings ? "is-active" : ""} onClick={() => showTab("databases")}>
          <Database size={16} aria-hidden="true" /> ฐานข้อมูล <b>{dbs.length}</b>
        </button>
        <button type="button" role="tab" aria-selected={isMappings} className={isMappings ? "is-active" : ""} onClick={() => showTab("mappings")}>
          <Bot size={16} aria-hidden="true" /> จับคู่รหัส Discord {mappings.length > 0 && <b>{mappings.length}</b>}
        </button>
      </nav>

      {isMappings ? (
        <>
          <section className="aov-kpis" aria-label="สรุปการจับคู่รหัส">
            <div className="aov-kpi">
              <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Users size={16} /></span>รหัสที่จับคู่</span>
              <strong>{mappingsLoading && !mappings.length ? <i className="aov-skel" /> : mappings.length.toLocaleString("th-TH")}</strong>
              <span className="aov-kpi-note">รหัส 3 ตัวท้าย</span>
            </div>
            <div className="aov-kpi">
              <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CheckCircle2 size={16} /></span>ผูก Discord แล้ว</span>
              <strong className={boundCount ? "is-ok" : ""}>{mappingsLoading && !mappings.length ? <i className="aov-skel" /> : boundCount.toLocaleString("th-TH")}</strong>
              <span className="aov-kpi-note">{mappings.length ? `${boundPercent}% ของทั้งหมด` : "ยังไม่มีรายการ"}</span>
            </div>
            <div className="aov-kpi">
              <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Clock size={16} /></span>รอผูกบัญชี</span>
              <strong className={unboundCount ? "is-wait" : ""}>{mappingsLoading && !mappings.length ? <i className="aov-skel" /> : unboundCount.toLocaleString("th-TH")}</strong>
              <span className="aov-kpi-note">ยังไม่ได้ใช้บอท</span>
            </div>
            <div className="aov-kpi">
              <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Globe size={16} /></span>ผูกเว็บไซต์แล้ว</span>
              <strong>{mappingsLoading && !mappings.length ? <i className="aov-skel" /> : siteBoundCount.toLocaleString("th-TH")}</strong>
              <span className="aov-kpi-note">ใช้เปิด VS Code ได้</span>
            </div>
          </section>

          <section className="aov-panel">
            <div className="th-filters">
              <label className="th-search" role="search">
                <Search size={17} aria-hidden="true" />
                <input
                  value={mappingSearch}
                  onChange={(e) => setMappingSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape" && mappingSearch) { e.preventDefault(); e.stopPropagation(); setMappingSearch(""); } }}
                  placeholder="ค้นหารหัส ชื่อ ฐานข้อมูล หรือเว็บไซต์"
                  aria-label="ค้นหาการจับคู่"
                />
                {mappingSearch && <button type="button" onClick={() => setMappingSearch("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
              </label>
              <div className="th-chips" role="group" aria-label="สถานะ Discord">
                <button type="button" className={mappingFilter === "all" ? "is-active" : ""} aria-pressed={mappingFilter === "all"} onClick={() => setMappingFilter("all")}>ทั้งหมด</button>
                <button type="button" className={mappingFilter === "bound" ? "is-active" : ""} aria-pressed={mappingFilter === "bound"} onClick={() => setMappingFilter("bound")}>
                  ผูกแล้ว <span className="hv-chip-count">{boundCount}</span>
                </button>
                <button type="button" className={mappingFilter === "unbound" ? "is-active" : ""} aria-pressed={mappingFilter === "unbound"} onClick={() => setMappingFilter("unbound")}>
                  รอผูก <span className="hv-chip-count">{unboundCount}</span>
                </button>
              </div>
            </div>
            <div className="th-meta" aria-live="polite">
              <span>{mappingsLoading && !mappings.length ? "กำลังโหลด..." : filteredMappings.length === 0 ? "ไม่พบรายการ" : `${filteredMappings.length.toLocaleString("th-TH")} จาก ${mappings.length.toLocaleString("th-TH")} รายการ`}</span>
              <div className="dbv-meta-tools">
                <button type="button" onClick={handleAutoDetectMappings} disabled={autoDetecting} title="หาเลข 3 ตัวในชื่อฐานข้อมูลแล้วจับคู่ให้">
                  <Sparkles size={14} aria-hidden="true" className={autoDetecting ? "hv-spin" : ""} /> {autoDetecting ? "กำลังตรวจ..." : "จับคู่จากฐานข้อมูล"}
                </button>
                <button type="button" onClick={handleAutoDetectSites} disabled={autoDetectingSites} title="หาเลข 3 ตัวในชื่อหรือซับโดเมนของเว็บไซต์แล้วจับคู่ให้">
                  <Globe size={14} aria-hidden="true" className={autoDetectingSites ? "hv-spin" : ""} /> {autoDetectingSites ? "กำลังตรวจ..." : "จับคู่จากเว็บไซต์"}
                </button>
                {boundCount > 0 && (
                  <button type="button" className="is-danger" onClick={handleUnbindAllDiscord}>
                    <Unlink size={14} aria-hidden="true" /> ปลดผูกทั้งหมด
                  </button>
                )}
              </div>
            </div>

            {mappingsLoading && !mappings.length ? skeleton : filteredMappings.length ? (
              <ul className="hv-list">
                <li className="dbv-map dbv-map-head" aria-hidden="true">
                  <span>รหัส</span><span>ผู้ใช้</span><span>ฐานข้อมูล</span><span>เว็บไซต์</span><span>Discord</span><span />
                </li>
                {filteredMappings.map((m) => {
                  const bound = Boolean(m.discordUsername || m.discordUserId);
                  const hasSite = Boolean(m.siteName || m.siteSubdomain);
                  return (
                    <li className="dbv-map" key={m.id}>
                      <span className="dbv-code">{m.studentCode}</span>
                      <div className="dbv-cell dbv-person">
                        <strong className={m.studentName ? "" : "is-soft"}>{m.studentName || "ไม่ระบุชื่อ"}</strong>
                        <small>{[m.ownerName ? `@${m.ownerName}` : "", m.notes].filter(Boolean).join(" · ") || "—"}</small>
                      </div>
                      <div className="dbv-cell" data-label="ฐานข้อมูล">
                        {m.dbName ? (
                          <>
                            <span className="dbv-inline">
                              <strong className="dbv-mono" title={m.dbName}>{m.dbName}</strong>
                              <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => copyMappingEnv(m)} title="คัดลอก .env ของฐานข้อมูลนี้" aria-label={`คัดลอก .env ของ ${m.dbName}`}>
                                <FileCode size={14} aria-hidden="true" />
                              </button>
                            </span>
                            <small>ผู้ใช้ {m.dbUser}</small>
                          </>
                        ) : <small>ไม่ได้ผูก</small>}
                      </div>
                      <div className="dbv-cell" data-label="เว็บไซต์">
                        {hasSite ? (
                          <>
                            <span className="dbv-inline">
                              <strong title={m.siteName || m.siteSubdomain}>{m.siteName || m.siteSubdomain}</strong>
                              <a className="hv-btn hv-icon-btn is-sm" href={m.sitePublicId ? `/workspace?id=${encodeURIComponent(m.sitePublicId)}` : "/hosting"} target="_blank" rel="noreferrer" title="เปิด VS Code ของเว็บนี้" aria-label="เปิด VS Code">
                                <Code2 size={14} aria-hidden="true" />
                              </a>
                              <button type="button" className="hv-btn hv-icon-btn is-sm hv-danger-icon" onClick={() => handleUnlinkSite(m)} title="ปลดเว็บไซต์ออกจากรหัสนี้" aria-label="ปลดเว็บไซต์">
                                <Unlink size={14} aria-hidden="true" />
                              </button>
                            </span>
                            {m.siteSubdomain && <a className="dbv-link" href={`https://${m.siteSubdomain}.nkn02.com`} target="_blank" rel="noreferrer">{m.siteSubdomain}.nkn02.com</a>}
                          </>
                        ) : (
                          <button type="button" className="hv-link-btn" onClick={() => openMappingForm(m)}>+ ผูกเว็บไซต์</button>
                        )}
                      </div>
                      <div className="dbv-cell" data-label="Discord">
                        {bound ? (
                          <span className="dbv-inline">
                            <span className="hv-status is-running" title={`Discord ID: ${m.discordUserId || "—"}`}>
                              <CheckCircle2 size={13} aria-hidden="true" />{m.discordUsername ? `@${m.discordUsername}` : m.discordUserId}
                            </span>
                            <button type="button" className="hv-btn hv-icon-btn is-sm hv-danger-icon" onClick={() => handleUnbindDiscord(m)} title="ปลดบัญชี Discord (ให้ผูกใหม่ได้)" aria-label="ปลดบัญชี Discord">
                              <Unlink size={14} aria-hidden="true" />
                            </button>
                          </span>
                        ) : (
                          <span className="hv-status"><Clock size={13} aria-hidden="true" />รอผูก</span>
                        )}
                      </div>
                      <div className="hv-row-actions dbv-map-actions">
                        {m.dbPublicId ? (
                          <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => openPhpMyAdmin({ id: m.dbPublicId || "" })} title="เปิด phpMyAdmin" aria-label="เปิด phpMyAdmin">
                            <ExternalLink size={15} aria-hidden="true" />
                          </button>
                        ) : null}
                        <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => openMappingForm(m)} title="แก้ไข" aria-label={`แก้ไขรหัส ${m.studentCode}`}>
                          <Edit3 size={15} aria-hidden="true" />
                        </button>
                        <button type="button" className="hv-btn hv-icon-btn is-sm hv-danger-icon" onClick={() => handleDeleteMapping(m)} title="ลบการจับคู่" aria-label={`ลบรหัส ${m.studentCode}`}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="aov-empty hv-empty">
                <span>{mappingFiltered ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "ยังไม่มีการจับคู่รหัส"}</span>
                {mappingFiltered
                  ? <button type="button" onClick={() => { setMappingSearch(""); setMappingFilter("all"); }}>ล้างตัวกรอง</button>
                  : <button type="button" onClick={handleAutoDetectMappings} disabled={autoDetecting}>จับคู่จากชื่อฐานข้อมูลอัตโนมัติ</button>}
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="aov-kpis" aria-label="สรุปฐานข้อมูล">
            <div className="aov-kpi">
              <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Database size={16} /></span>ฐานข้อมูลทั้งหมด</span>
              <strong>{loading && !dbs.length ? <i className="aov-skel" /> : dbStats.total.toLocaleString("th-TH")}</strong>
              <span className="aov-kpi-note">{search.trim() ? "ตามคำค้นหา" : "MySQL"}</span>
            </div>
            <div className="aov-kpi">
              <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><CheckCircle2 size={16} /></span>ใช้งานได้</span>
              <strong className={dbStats.active ? "is-ok" : ""}>{loading && !dbs.length ? <i className="aov-skel" /> : dbStats.active.toLocaleString("th-TH")}</strong>
              <span className="aov-kpi-note">เชื่อมต่อได้ตามปกติ</span>
            </div>
            <div className="aov-kpi">
              <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><PauseCircle size={16} /></span>ถูกระงับ</span>
              <strong className={dbStats.suspended ? "is-wait" : ""}>{loading && !dbs.length ? <i className="aov-skel" /> : dbStats.suspended.toLocaleString("th-TH")}</strong>
              <span className="aov-kpi-note">เชื่อมต่อไม่ได้จนกว่าจะปลด</span>
            </div>
            <div className="aov-kpi">
              <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><HardDrive size={16} /></span>พื้นที่ใช้</span>
              <strong>{loading && !dbs.length ? <i className="aov-skel" /> : formatBytes(dbStats.totalBytes)}</strong>
              <span className="aov-kpi-note">รวมทุกฐานข้อมูล</span>
            </div>
          </section>

          <section className="aov-panel">
            <div className="th-filters">
              <label className="th-search" role="search">
                <Search size={17} aria-hidden="true" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape" && search) { e.preventDefault(); e.stopPropagation(); setSearch(""); } }}
                  placeholder="ค้นหาชื่อฐานข้อมูลหรือเว็บไซต์"
                  aria-label="ค้นหาฐานข้อมูล"
                />
                {search && <button type="button" onClick={() => setSearch("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
              </label>
              <div className="th-chips" role="group" aria-label="สถานะ">
                <button type="button" className={status === "" ? "is-active" : ""} aria-pressed={status === ""} onClick={() => setStatus("")}>ทั้งหมด</button>
                <button type="button" className={status === "active" ? "is-active" : ""} aria-pressed={status === "active"} onClick={() => setStatus(status === "active" ? "" : "active")}>
                  ใช้งานได้ <span className="hv-chip-count">{dbStats.active}</span>
                </button>
                <button type="button" className={status === "suspended" ? "is-active" : ""} aria-pressed={status === "suspended"} onClick={() => setStatus(status === "suspended" ? "" : "suspended")}>
                  ถูกระงับ <span className="hv-chip-count">{dbStats.suspended}</span>
                </button>
              </div>
            </div>
            <div className="th-meta" aria-live="polite">
              <span>{loading && !dbs.length ? "กำลังโหลด..." : filtered.length === 0 ? "ไม่พบฐานข้อมูล" : `${filtered.length.toLocaleString("th-TH")} จาก ${dbs.length.toLocaleString("th-TH")} ฐานข้อมูล`}</span>
              {hasFilters && <button type="button" onClick={() => { setSearch(""); setStatus(""); }}>ล้างตัวกรอง</button>}
            </div>

            {filtered.length > 0 && (
              <div className={`nx-selbar${pickedShown.length ? " is-active" : ""}`} role="toolbar" aria-label="จัดการหลายรายการ">
                <label className="nx-selall">
                  <input
                    type="checkbox"
                    className="nx-check"
                    checked={pickedShown.length === filtered.length}
                    ref={(el) => { if (el) el.indeterminate = pickedShown.length > 0 && pickedShown.length < filtered.length; }}
                    onChange={(e) => { lastPickRef.current = null; setPicked(e.target.checked ? new Set(filtered.map((d) => d.id)) : new Set()); }}
                  />
                  <span>{pickedShown.length ? `เลือก ${pickedShown.length} จาก ${filtered.length}` : "เลือกทั้งหมด"}</span>
                </label>
                {pickedShown.length ? (
                  <div className="nx-selbar-actions">
                    <button type="button" className="hv-btn nx-ok" disabled={!pickedSuspended.length || anyBusy} onClick={() => confirmStatus(pickedSuspended, false)}>
                      <PlayCircle size={15} aria-hidden="true" /> ปลดระงับ{pickedSuspended.length ? ` ${pickedSuspended.length}` : ""}
                    </button>
                    <button type="button" className="hv-btn nx-warn" disabled={!pickedActive.length || anyBusy} onClick={() => confirmStatus(pickedActive, true)}>
                      <PauseCircle size={15} aria-hidden="true" /> ระงับ{pickedActive.length ? ` ${pickedActive.length}` : ""}
                    </button>
                    <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => setPicked(new Set())} aria-label="ยกเลิกที่เลือก" title="ยกเลิกที่เลือก">
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <span className="nx-selbar-hint">ติ๊กหลายแถวเพื่อระงับหรือปลดระงับทีเดียว กด Shift ค้างเพื่อเลือกเป็นช่วง</span>
                )}
              </div>
            )}

            {loading && !dbs.length ? skeleton : filtered.length ? (
              <ul className="hv-list">
                <li className="hv-row dbv-row hv-row-head" aria-hidden="true">
                  <span /><span>ฐานข้อมูล</span><span>เจ้าของ</span><span>ขนาด</span><span>สถานะ</span><span />
                </li>
                {filtered.map((db, index) => {
                  const suspended = db.status === "suspended";
                  const busy = busyIds.has(db.id);
                  const isPicked = picked.has(db.id);
                  return (
                    <li className={`hv-row dbv-row${isPicked ? " is-picked" : ""}${busy ? " is-busy" : ""}`} key={db.id} aria-busy={busy || undefined}>
                      <label className="dbv-select">
                        <input
                          type="checkbox"
                          className="nx-check"
                          checked={isPicked}
                          onChange={() => {}}
                          onClick={(e) => pickRow(index, !isPicked, e.shiftKey)}
                          aria-label={`เลือก ${db.dbName}`}
                        />
                      </label>
                      <div className="hv-site">
                        <span className="dbv-icon" aria-hidden="true"><Database size={17} /></span>
                        <div className="hv-site-copy">
                          <button type="button" className="hv-site-name dbv-mono" onClick={() => openDetail(db)} title={db.dbName}>{db.dbName}</button>
                          <small className="hv-site-domain">{db.siteSubdomain ? `${db.siteSubdomain}.nkn02.com` : siteLabel(db)}</small>
                          <small className="hv-site-meta">@{db.ownerUsername || "system"} · {formatBytes(db.sizeBytes)}</small>
                        </div>
                      </div>
                      <span className="hv-cell hv-owner" title={db.ownerUsername || "system"}>@{db.ownerUsername || "system"}</span>
                      <span className="hv-cell dbv-num">{formatBytes(db.sizeBytes)}</span>
                      {busy ? (
                        <span className="hv-status"><span className="hv-spinner dbv-spinner" aria-hidden="true" />กำลังเปลี่ยน</span>
                      ) : (
                        <span className={`hv-status ${suspended ? "is-provisioning" : "is-running"}`}>
                          {suspended ? <Lock size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
                          {suspended ? "ถูกระงับ" : "ใช้งานได้"}
                        </span>
                      )}
                      <div className="hv-row-actions">
                        <button
                          type="button"
                          className="hv-btn hv-icon-btn"
                          onClick={() => openPhpMyAdmin(db)}
                          disabled={suspended}
                          title={suspended ? "ฐานข้อมูลถูกระงับ" : "เปิด phpMyAdmin"}
                          aria-label={`เปิด phpMyAdmin ของ ${db.dbName}`}
                        >
                          <ExternalLink size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={`hv-btn hv-icon-btn ${suspended ? "dbv-act-restore" : "dbv-act-suspend"}`}
                          onClick={() => confirmStatus([db], !suspended)}
                          disabled={busy}
                          title={suspended ? "ปลดระงับ" : "ระงับ"}
                          aria-label={`${suspended ? "ปลดระงับ" : "ระงับ"} ${db.dbName}`}
                        >
                          {suspended ? <PlayCircle size={16} aria-hidden="true" /> : <PauseCircle size={16} aria-hidden="true" />}
                        </button>
                        <button type="button" className="hv-btn" onClick={() => openDetail(db)}>จัดการ</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="aov-empty hv-empty">
                <span>{hasFilters ? "ไม่พบฐานข้อมูลที่ตรงกับตัวกรอง" : "ยังไม่มีฐานข้อมูล"}</span>
                {hasFilters
                  ? <button type="button" onClick={() => { setSearch(""); setStatus(""); }}>ล้างตัวกรอง</button>
                  : <button type="button" onClick={() => { setCreateUsername(""); setShowCreateModal(true); }}>สร้างฐานข้อมูลแรก</button>}
              </div>
            )}
          </section>
        </>
      )}

      {selectedDb && typeof document !== "undefined" && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeDetail()}>
          <section className="hv-dialog dbv-detail" role="dialog" aria-modal="true" aria-labelledby="db-detail-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <span className="dbv-icon" aria-hidden="true"><Database size={18} /></span>
                <div className="hv-dh-text">
                  <small>{siteLabel(selectedDb)}</small>
                  <div className="hv-dh-row">
                    <h2 id="db-detail-title" className="dbv-mono">{selectedDb.dbName}</h2>
                    <span className={`hv-status ${selectedDb.status === "suspended" ? "is-provisioning" : "is-running"}`}>
                      {selectedDb.status === "suspended" ? "ถูกระงับ" : "ใช้งานได้"}
                    </span>
                  </div>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={closeDetail} aria-label="ปิด"><X size={18} /></button>
            </header>

            <div className="hv-dialog-body">
              {selectedDb.newPass && (
                <div className="hv-callout dbv-pass">
                  <KeyRound size={18} aria-hidden="true" />
                  <p>
                    <strong>ได้รหัสผ่านใหม่แล้ว</strong>
                    <span>คัดลอกจากช่อง Password ด้านล่างไว้ตอนนี้ ปิดหน้าต่างนี้แล้วจะไม่แสดงอีก</span>
                  </p>
                </div>
              )}

              <div className="hv-controls">
                <button type="button" className="hv-btn hv-btn-primary" onClick={() => openPhpMyAdmin(selectedDb)} disabled={selectedDb.status === "suspended" || !selectedDb.id}>
                  <ExternalLink size={15} aria-hidden="true" /> เปิด phpMyAdmin
                </button>
              </div>

              <section className="hv-section">
                <div className="hv-section-head">
                  <h3>ข้อมูลเชื่อมต่อ</h3>
                  <button type="button" className="hv-link-btn" onClick={() => copyAllConnection(selectedDb, "all")}>
                    {copiedKey === "all" ? "คัดลอกแล้ว" : "คัดลอกทั้งหมด"}
                  </button>
                </div>
                <ul className="dbv-conn">
                  {[
                    ["Host", selectedDb.host],
                    ["Port", String(selectedDb.port)],
                    ["Database", selectedDb.dbName],
                    ["Username", selectedDb.dbUser],
                  ].map(([label, value]) => (
                    <li key={label}>
                      <span className="dbv-conn-label">{label}</span>
                      <strong className="dbv-conn-value">{value}</strong>
                      <button
                        type="button"
                        className={`dbv-copy${copiedKey === label ? " is-done" : ""}`}
                        onClick={() => void copyText(String(value), label, label)}
                        aria-label={`คัดลอก ${label}`}
                        title={`คัดลอก ${label}`}
                      >
                        {copiedKey === label ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                      </button>
                    </li>
                  ))}
                  <li>
                    <span className="dbv-conn-label">Password</span>
                    {selectedDb.newPass ? (
                      <strong className="dbv-conn-value">{selectedDb.newPass}</strong>
                    ) : (
                      <span className="dbv-conn-value is-hidden">ไม่แสดงหลังสร้าง</span>
                    )}
                    {selectedDb.newPass ? (
                      <button
                        type="button"
                        className={`dbv-copy${copiedKey === "Password" ? " is-done" : ""}`}
                        onClick={() => void copyText(selectedDb.newPass || "", "รหัสผ่าน", "Password")}
                        aria-label="คัดลอกรหัสผ่าน"
                        title="คัดลอกรหัสผ่าน"
                      >
                        {copiedKey === "Password" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                      </button>
                    ) : (
                      <button type="button" className="hv-link-btn dbv-conn-action" onClick={() => handleResetPassword(selectedDb)}>ตั้งใหม่</button>
                    )}
                  </li>
                </ul>
                <div className="dbv-meta">
                  <span><Users size={14} aria-hidden="true" />@{selectedDb.ownerUsername || "system"}</span>
                  <span><HardDrive size={14} aria-hidden="true" />{formatBytes(selectedDb.sizeBytes)}</span>
                  <span><Database size={14} aria-hidden="true" />{(selectedDb.engine || "mysql") === "mysql" ? "MySQL" : String(selectedDb.engine).toUpperCase()}</span>
                </div>
              </section>

              <section className="hv-section">
                <h3>การจัดการ</h3>
                <div className="hv-controls">
                  <button type="button" className="hv-btn" onClick={() => { setTransferTargetDb(selectedDb); setTransferUsername(""); }}>
                    <ArrowRightLeft size={15} aria-hidden="true" /> ย้ายเจ้าของ
                  </button>
                  <button
                    type="button"
                    className={`hv-btn ${selectedDb.status === "suspended" ? "nx-ok" : "nx-warn"}`}
                    disabled={busyIds.has(selectedDb.id)}
                    onClick={() => confirmStatus([selectedDb], selectedDb.status !== "suspended")}
                  >
                    {selectedDb.status === "suspended" ? <PlayCircle size={15} aria-hidden="true" /> : <PauseCircle size={15} aria-hidden="true" />}
                    {selectedDb.status === "suspended" ? "ปลดระงับ" : "ระงับ"}
                  </button>
                  <button type="button" className="hv-btn" onClick={() => handleResetPassword(selectedDb)}>
                    <KeyRound size={15} aria-hidden="true" /> เปลี่ยนรหัสผ่าน
                  </button>
                  <button type="button" className="hv-btn hv-btn-danger-ghost hv-push" onClick={() => handleDelete(selectedDb)}>
                    <Trash2 size={15} aria-hidden="true" /> ลบฐานข้อมูล
                  </button>
                </div>
              </section>
            </div>
          </section>
        </div>,
        document.body
      )}

      {showCreateModal && typeof document !== "undefined" && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !createSubmitting && setShowCreateModal(false)}>
          <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="db-create-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <Database size={20} className="hv-dh-icon" aria-hidden="true" />
                <div className="hv-dh-text">
                  <small>ชื่อและรหัสผ่านสร้างให้อัตโนมัติ</small>
                  <h2 id="db-create-title">สร้างฐานข้อมูล</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setShowCreateModal(false)} disabled={createSubmitting} aria-label="ปิด"><X size={18} /></button>
            </header>
            <form className="hv-form" onSubmit={submitCreateDatabase}>
              <div className="hv-dialog-body">
                <div className="hv-field">
                  <span>เจ้าของ</span>
                  <CustomUserSelect users={users} me={me} value={createUsername} onChange={setCreateUsername} />
                </div>
              </div>
              <footer className="hv-dialog-foot">
                <button type="button" className="hv-btn" onClick={() => setShowCreateModal(false)} disabled={createSubmitting}>ยกเลิก</button>
                <button type="submit" className="hv-btn hv-btn-primary" disabled={createSubmitting}>
                  {createSubmitting && <span className="hv-spinner" aria-hidden="true" />}
                  {createSubmitting ? "กำลังสร้าง..." : "สร้างฐานข้อมูล"}
                </button>
              </footer>
            </form>
          </section>
        </div>,
        document.body
      )}

      {transferTargetDb && typeof document !== "undefined" && createPortal(
        <div className="hv-backdrop is-top" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !transferSubmitting && setTransferTargetDb(null)}>
          <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="db-transfer-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <ArrowRightLeft size={20} className="hv-dh-icon" aria-hidden="true" />
                <div className="hv-dh-text">
                  <small className="dbv-mono">{transferTargetDb.dbName}</small>
                  <h2 id="db-transfer-title">ย้ายเจ้าของ</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setTransferTargetDb(null)} disabled={transferSubmitting} aria-label="ปิด"><X size={18} /></button>
            </header>
            <form className="hv-form" onSubmit={submitTransferOwnership}>
              <div className="hv-dialog-body">
                <div className="hv-field">
                  <span>เจ้าของคนใหม่</span>
                  <CustomUserSelect users={users} me={me} value={transferUsername} onChange={setTransferUsername} />
                  <small>ตอนนี้เป็นของ @{transferTargetDb.ownerUsername || "system"}</small>
                </div>
              </div>
              <footer className="hv-dialog-foot">
                <button type="button" className="hv-btn" onClick={() => setTransferTargetDb(null)} disabled={transferSubmitting}>ยกเลิก</button>
                <button type="submit" className="hv-btn hv-btn-primary" disabled={transferSubmitting}>
                  {transferSubmitting && <span className="hv-spinner" aria-hidden="true" />}
                  {transferSubmitting ? "กำลังย้าย..." : "ย้ายเจ้าของ"}
                </button>
              </footer>
            </form>
          </section>
        </div>,
        document.body
      )}

      {showMappingModal && typeof document !== "undefined" && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !mappingSubmitting && setShowMappingModal(false)}>
          <section className="hv-dialog dbv-form-dialog" role="dialog" aria-modal="true" aria-labelledby="db-mapping-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                <Bot size={20} className="hv-dh-icon" aria-hidden="true" />
                <div className="hv-dh-text">
                  <small>{editingMapping.id ? `รหัส ${editingMapping.studentCode}` : "ใช้กับบอท Discord และ VS Code"}</small>
                  <h2 id="db-mapping-title">{editingMapping.id ? "แก้ไขการจับคู่" : "เพิ่มการจับคู่รหัส"}</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setShowMappingModal(false)} disabled={mappingSubmitting} aria-label="ปิด"><X size={18} /></button>
            </header>
            <form className="hv-form" onSubmit={submitSaveMapping}>
              <div className="hv-dialog-body">
                <div className="dbv-field-pair">
                  <div className="hv-field">
                    <label htmlFor="dbv-code">รหัส 3 ตัวท้าย <span className="hv-req">*</span></label>
                    <input
                      id="dbv-code"
                      required
                      inputMode="numeric"
                      value={editingMapping.studentCode}
                      onChange={(e) => setEditingMapping({ ...editingMapping, studentCode: e.target.value.trim() })}
                      placeholder="เช่น 109"
                      maxLength={10}
                    />
                  </div>
                  <div className="hv-field">
                    <label htmlFor="dbv-name">ชื่อ</label>
                    <input
                      id="dbv-name"
                      value={editingMapping.studentName}
                      onChange={(e) => setEditingMapping({ ...editingMapping, studentName: e.target.value })}
                      placeholder="ไม่บังคับ"
                    />
                  </div>
                </div>
                <div className="hv-field">
                  <label htmlFor="dbv-db">ฐานข้อมูล</label>
                  <select
                    id="dbv-db"
                    className="hv-select"
                    value={editingMapping.dbPublicId}
                    onChange={(e) => setEditingMapping({ ...editingMapping, dbPublicId: e.target.value })}
                  >
                    <option value="">ไม่ผูกฐานข้อมูล</option>
                    {dbs.map((d) => (
                      <option key={d.id} value={d.id}>{d.dbName} · @{d.ownerUsername || d.ownerName || "system"}</option>
                    ))}
                  </select>
                </div>
                <div className="hv-field">
                  <label htmlFor="dbv-site">เว็บไซต์</label>
                  <select
                    id="dbv-site"
                    className="hv-select"
                    value={editingMapping.sitePublicId}
                    onChange={(e) => setEditingMapping({ ...editingMapping, sitePublicId: e.target.value })}
                  >
                    <option value="">ไม่ผูกเว็บไซต์</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} · {s.subdomain}.nkn02.com</option>
                    ))}
                  </select>
                  <small>เลือกอย่างน้อยหนึ่งอย่าง: ฐานข้อมูลหรือเว็บไซต์</small>
                </div>
                <div className="hv-field">
                  <label htmlFor="dbv-notes">หมายเหตุ</label>
                  <input
                    id="dbv-notes"
                    value={editingMapping.notes}
                    onChange={(e) => setEditingMapping({ ...editingMapping, notes: e.target.value })}
                    placeholder="เช่น ห้อง 601"
                  />
                </div>
              </div>
              <footer className="hv-dialog-foot">
                <button type="button" className="hv-btn" onClick={() => setShowMappingModal(false)} disabled={mappingSubmitting}>ยกเลิก</button>
                <button type="submit" className="hv-btn hv-btn-primary" disabled={mappingSubmitting}>
                  {mappingSubmitting && <span className="hv-spinner" aria-hidden="true" />}
                  {mappingSubmitting ? "กำลังบันทึก..." : "บันทึก"}
                </button>
              </footer>
            </form>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
