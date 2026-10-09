"use client";

import "./file-library-122.css";
import "./files-view.css";

import {
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Download, ExternalLink, Eye, EyeOff,
  FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo,
  Files, Folder, FolderArchive, FolderInput, FolderOpen, FolderPlus, KeyRound, LayoutGrid, Layers, List, Lock, MoreHorizontal,
  Pencil, Play, Plus, Search, Share2, ShieldCheck, Tag, Trash2, UploadCloud, UserRound, X,
  CheckSquare, Printer,
} from "lucide-react";
import { ChangeEvent, DragEvent, FormEvent, type TouchEvent as ReactTouchEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../runtime";
import SmartImage from "../components/SmartImage";
import PdfPreview from "../components/PdfPreview";
import ScopeShareDialog, { type ShareScope } from "./ScopeShareDialog";

type FileItem = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  ownerId?: number;
  owner?: string;
  isOwner?: boolean;
  categoryId?: number | null;
  categoryName?: string;
  folderId?: number | null;
  folderName?: string;
  isVisible: boolean;
  passwordEnabled: boolean;
  shareEnabled?: boolean;
  shareExpiresAt?: string | null;
  shareUrl?: string;
  createdAt: string;
};

type FileCategory = {
  id: number;
  ownerUserId?: number | null;
  owner?: string;
  isOwner?: boolean;
  name: string;
  isVisible: boolean;
  passwordEnabled?: boolean;
  sortOrder: number;
  fileCount?: number;
  hiddenFileCount?: number;
  folderCount?: number;
  createdAt?: string;
  updatedAt?: string;
  shareUrl?: string;
  shareExpiresAt?: string | null;
  adminShareUrl?: string;
  adminShareExpiresAt?: string | null;
};

type FileFolder = {
  id: number;
  categoryId: number;
  categoryName?: string;
  parentId?: number | null;
  ownerUserId?: number;
  name: string;
  sortOrder: number;
  isVisible: boolean;
  passwordEnabled: boolean;
  fileCount: number;
  hiddenFileCount?: number;
  subfolderCount?: number;
  createdAt: string;
  updatedAt?: string;
  shareUrl?: string;
  shareExpiresAt?: string | null;
};

type FileResponse = {
  items: FileItem[];
  usedBytes: number;
  quotaBytes?: number;
  maxFileBytes: number;
};

type PreviewState = {
  item: FileItem;
  url: string;
  kind: "image" | "video" | "audio" | "pdf" | "code" | "spreadsheet" | "document" | "archive";
  textContent?: string;
  password?: string;
};

type FileNotice = { kind: "success" | "error"; text: string };
type FileTransferState = {
  mode: "preview" | "download";
  item: FileItem;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  phase: "loading" | "processing";
};
type FileConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  action: () => void | Promise<void>;
};


type UploadItem = {
  id: string;
  file: File;
  status: "ready" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  // Rejected before sending (too big, empty): retrying would not help.
  blocked?: boolean;
};

// The API allows 120 uploads an hour per account; one batch stays well under that.
const MAX_UPLOAD_BATCH = 20;

function formatBytes(value: number) {
  if (!value || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function splitName(name: string) {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, idx), ext: name.slice(idx) };
}

function getFileExt(name: string) {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

function fileKind(item: FileItem) {
  const type = (item.contentType || "").toLowerCase();
  const ext = getFileExt(item.name);

  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "avif"].includes(ext)) {
    return { label: "รูปภาพ", icon: FileImage, kind: "image" as const, extLabel: ext.toUpperCase() || "IMG" };
  }
  if (type.startsWith("video/") || ["mp4", "webm", "mkv", "mov", "avi"].includes(ext)) {
    return { label: "วิดีโอ", icon: FileVideo, kind: "video" as const, extLabel: ext.toUpperCase() || "VID" };
  }
  if (type.startsWith("audio/") || ["mp3", "wav", "ogg", "aac", "m4a", "flac"].includes(ext)) {
    return { label: "เสียง", icon: FileAudio, kind: "audio" as const, extLabel: ext.toUpperCase() || "AUD" };
  }
  if (type.includes("zip") || type.includes("gzip") || type.includes("tar") || ["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return { label: "ไฟล์บีบอัด", icon: FileArchive, kind: "archive" as const, extLabel: ext.toUpperCase() || "ZIP" };
  }
  if (type === "application/pdf" || ext === "pdf") {
    return { label: "PDF", icon: FileText, kind: "pdf" as const, extLabel: "PDF" };
  }
  if (
    ["js", "ts", "jsx", "tsx", "json", "html", "css", "py", "go", "php", "sql", "sh", "yml", "yaml", "xml", "env"].includes(ext) ||
    type.includes("json") || type.includes("javascript") || type.includes("xml")
  ) {
    return { label: "โค้ด/ข้อมูล", icon: FileCode, kind: "code" as const, extLabel: ext.toUpperCase() || "CODE" };
  }
  if (["xlsx", "xls", "csv"].includes(ext) || type.includes("spreadsheet") || type.includes("csv")) {
    return { label: "ตารางคำนวณ", icon: FileSpreadsheet, kind: "spreadsheet" as const, extLabel: ext.toUpperCase() || "DATA" };
  }
  return { label: "เอกสาร", icon: FileText, kind: "document" as const, extLabel: ext.toUpperCase() || "DOC" };
}

function CardThumbnail({
  item,
  isSelected,
  onToggleSelect,
  onPreview,
  admin,
}: {
  item: FileItem;
  isSelected: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  admin?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const kindInfo = fileKind(item);
  const Icon = kindInfo.icon;
  const isOwner = item.isOwner ?? !admin;

  if (!item.isVisible && !isOwner && !admin) {
    return (
      <div className="fx-thumb is-locked">
        <span className="fx-thumb-icon" aria-hidden="true"><EyeOff size={26} /></span>
        <span className="fx-thumb-ext">ซ่อนโดยเจ้าของ</span>
      </div>
    );
  }

  const showImage = kindInfo.kind === "image" && !imgError && (!item.passwordEnabled || isOwner);
  const playable = kindInfo.kind === "video" || kindInfo.kind === "audio";

  return (
    <div className={`fx-thumb is-${kindInfo.kind}`} onClick={onPreview}>
      <label className={`fx-thumb-check${isSelected ? " is-on" : ""}`} onClick={(e) => e.stopPropagation()} title={isSelected ? "ยกเลิกเลือก" : "เลือกไฟล์นี้"}>
        <input type="checkbox" className="fx-check" checked={isSelected} onChange={onToggleSelect} aria-label={`เลือก ${item.name}`} />
      </label>
      {(item.shareEnabled || !item.isVisible || item.passwordEnabled) && (
        <span className="fx-thumb-flags">
          {item.shareEnabled && <span title="แชร์ลิงก์อยู่"><Share2 size={12} /> แชร์</span>}
          {!item.isVisible && <span title="ซ่อนจากคลัง"><EyeOff size={12} /> ซ่อน</span>}
          {item.passwordEnabled && <span title="มีรหัสผ่าน"><Lock size={12} /> ล็อก</span>}
        </span>
      )}
      {showImage ? (
        <SmartImage
          src={`${API_BASE}/api/files/${encodeURIComponent(item.id)}/download?preview=true`}
          alt={item.name}
          onError={() => setImgError(true)}
        />
      ) : (
        <>
          <span className="fx-thumb-icon" aria-hidden="true">
            {playable ? <Play size={22} fill="currentColor" /> : <Icon size={26} />}
          </span>
          <span className="fx-thumb-ext">{kindInfo.extLabel}</span>
        </>
      )}
    </div>
  );
}

export default function FileLibraryView({
  admin = false,
  notify,
  ask,
}: {
  admin?: boolean;
  notify?: (notice: FileNotice) => void;
  ask?: (request: FileConfirmRequest) => void;
}) {
  const [result, setResult] = useState<FileResponse | null>(null);
  const [categories, setCategories] = useState<FileCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | "visible" | "hidden">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video" | "audio" | "document" | "archive">("all");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const [showUpload, setShowUpload] = useState(false);
  const [uploadCategoryId, setUploadCategoryId] = useState("");
  const [uploadFolderId, setUploadFolderId] = useState("");
  const [uploadFoldersList, setUploadFoldersList] = useState<FileFolder[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadCancelRef = useRef(false);

  // Category management states
  const [categoryModal, setCategoryModal] = useState<{ mode: "create" | "edit"; category?: FileCategory } | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ name: string; isVisible: boolean; passwordEnabled: boolean; password: string }>({
    name: "",
    isVisible: true,
    passwordEnabled: false,
    password: "",
  });
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<FileCategory | null>(null);
  const [categoryDeleteCascade, setCategoryDeleteCascade] = useState(false);
  const [categoryBusy, setCategoryBusy] = useState(false);

  // Category password prompt (when entering another user's locked category)
  const [categoryPasswordPrompt, setCategoryPasswordPrompt] = useState<FileCategory | null>(null);
  const [categoryPasswordInput, setCategoryPasswordInput] = useState("");
  const [categoryPasswordError, setCategoryPasswordError] = useState("");
  const [categoryPasswordBusy, setCategoryPasswordBusy] = useState(false);
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<number[]>([]);

  // Folder states
  const [folders, setFolders] = useState<FileFolder[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null); // null = all in category, -1 = root only, >0 = folderId
  const [folderModal, setFolderModal] = useState<{ mode: "create" | "edit"; folder?: FileFolder; parentId?: number | null } | null>(null);
  const [folderForm, setFolderForm] = useState<{ name: string; isVisible: boolean; passwordEnabled: boolean; password: string }>({
    name: "",
    isVisible: true,
    passwordEnabled: false,
    password: "",
  });
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<FileFolder | null>(null);
  const [folderDeleteCascade, setFolderDeleteCascade] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);

  // Move file folder state
  const [moveFolderTarget, setMoveFolderTarget] = useState<FileItem | null>(null);
  const [moveFolderValue, setMoveFolderValue] = useState<string>("root"); // "root" = clear folder, or folderId

  // Batch folder state
  const [batchFolderModalOpen, setBatchFolderModalOpen] = useState(false);
  const [batchTargetFolder, setBatchTargetFolder] = useState<string>("root");

  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [fileTransfer, setFileTransfer] = useState<FileTransferState | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ item: FileItem; mode: "download" | "preview" } | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [renameBase, setRenameBase] = useState("");
  const [categoryTarget, setCategoryTarget] = useState<FileItem | null>(null);
  const [categoryValue, setCategoryValue] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<FileItem | null>(null);
  const [passwordEnable, setPasswordEnable] = useState(false);
  const [passwordNew, setPasswordNew] = useState("");

  const [shareTarget, setShareTarget] = useState<FileItem | null>(null);
  const [scopeShareOpen, setScopeShareOpen] = useState(false);
  const [shareExpiresIn, setShareExpiresIn] = useState<string>("never");
  const [shareBusy, setShareBusy] = useState<boolean>(false);

  const [actionBusy, setActionBusy] = useState(false);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  // The file menu is fixed to the viewport so table and card edges never clip it;
  // it opens from its button and is then kept inside the screen once its size is known.
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<FileNotice | null>(null);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchCategoryModalOpen, setBatchCategoryModalOpen] = useState(false);
  const [batchTargetCategory, setBatchTargetCategory] = useState<string>("none");
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  useEffect(() => {
    if (!notice) return;
    // A toast, not a dialog: it goes away by itself (errors stay a little longer to be read).
    const t = setTimeout(() => setNotice(null), notice.kind === "success" ? 3500 : 7000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotice(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [notice]);

  function flash(next: FileNotice) {
    setNotice(next);
  }

  function confirmAction(request: FileConfirmRequest) {
    if (ask) {
      ask(request);
      return;
    }
    void request.action();
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const fileTransferControllerRef = useRef<AbortController | null>(null);
  const fileTransferHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adminQuery, setAdminQuery] = useState("");

  useEffect(() => {
    if (!menuItemId) return;
    const close = () => setMenuItemId(null);
    const closeOnKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    // Scrolling inside the menu keeps it; scrolling the page moves its button away, so it closes.
    const closeOnScroll = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      close();
    };
    // Mobile browsers fire resize when the address bar slides; only a width change closes the menu.
    const startWidth = window.innerWidth;
    const closeOnResize = () => window.innerWidth !== startWidth && close();
    window.addEventListener("click", close);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [menuItemId]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menuItemId || !menuAnchor || !menu) return;
    const gap = 8;
    const viewWidth = document.documentElement.clientWidth;
    const viewHeight = window.innerHeight;
    const { width, height } = menu.getBoundingClientRect();
    const left = Math.min(Math.max(gap, menuAnchor.right - width), viewWidth - width - gap);
    let top = menuAnchor.bottom + 6;
    if (top + height > viewHeight - gap) top = menuAnchor.top - 6 - height;
    if (top < gap || top + height > viewHeight - gap) top = Math.max(gap, Math.min(top, viewHeight - height - gap));
    menu.style.left = `${Math.max(gap, left)}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";
  }, [menuItemId, menuAnchor]);

  useEffect(() => () => {
    fileTransferControllerRef.current?.abort();
    if (fileTransferHideTimerRef.current) clearTimeout(fileTransferHideTimerRef.current);
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const path = admin ? "/api/admin/user-file-categories" : "/api/files/categories";
      const response = await fetch(`${API_BASE}${path}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setCategories(payload.items || []);
    } catch {
      /* ignore */
    }
  }, [admin]);

  const loadFolders = useCallback(async (catId: number) => {
    if (!catId || catId <= 0) {
      setFolders([]);
      return;
    }
    setFolderLoading(true);
    try {
      const path = admin
        ? `/api/admin/user-file-categories/${catId}/folders`
        : `/api/files/categories/${catId}/folders`;
      const response = await fetch(`${API_BASE}${path}`, { credentials: "include", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setFolders(payload.items || []);
      else setFolders([]);
    } catch {
      setFolders([]);
    } finally {
      setFolderLoading(false);
    }
  }, [admin]);

  // Load folders when active category changes
  useEffect(() => {
    setSelectedFolderId(null);
    if (categoryFilter !== "all" && categoryFilter !== "none" && categoryFilter !== "browse_all") {
      const catId = parseInt(categoryFilter, 10);
      if (!Number.isNaN(catId) && catId > 0) {
        void loadFolders(catId);
        return;
      }
    }
    setFolders([]);
  }, [categoryFilter, loadFolders]);

  const loadUploadFolders = useCallback(
    async (catId: number) => {
      if (!catId || catId <= 0) {
        setUploadFoldersList([]);
        setUploadFolderId("");
        return;
      }
      try {
        const path = admin
          ? `/api/admin/user-file-categories/${catId}/folders`
          : `/api/files/categories/${catId}/folders`;
        const res = await fetch(`${API_BASE}${path}`, { credentials: "include", cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        setUploadFoldersList(data.items || []);
      } catch {
        setUploadFoldersList([]);
      }
    },
    [admin],
  );

  // Load folders for upload modal when uploadCategoryId changes
  useEffect(() => {
    if (!uploadCategoryId) {
      setUploadFoldersList([]);
      setUploadFolderId("");
      return;
    }
    const catId = parseInt(uploadCategoryId, 10);
    if (Number.isNaN(catId) || catId <= 0) {
      setUploadFoldersList([]);
      setUploadFolderId("");
      return;
    }
    void loadUploadFolders(catId);
  }, [loadUploadFolders, uploadCategoryId]);

  const folderMap = useMemo(() => {
    const map = new Map<number, FileFolder>();
    for (const f of folders) {
      map.set(f.id, f);
    }
    return map;
  }, [folders]);

  const folderBreadcrumbs = useMemo(() => {
    if (selectedFolderId === null || selectedFolderId <= 0) return [];
    const trail: FileFolder[] = [];
    let curr: FileFolder | undefined = folderMap.get(selectedFolderId);
    const visited = new Set<number>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      trail.unshift(curr);
      if (curr.parentId) {
        curr = folderMap.get(curr.parentId);
      } else {
        break;
      }
    }
    return trail;
  }, [selectedFolderId, folderMap]);

  const currentLevelFolders = useMemo(() => {
    if (selectedFolderId === -1) return [];
    if (selectedFolderId === null) {
      return folders.filter((f) => !f.parentId);
    }
    return folders.filter((f) => f.parentId === selectedFolderId);
  }, [folders, selectedFolderId]);

  const buildFolderTree = useCallback((folderList: FileFolder[]) => {
    const list: Array<{ id: number; name: string; depth: number; label: string; passwordEnabled: boolean }> = [];
    const childrenMap = new Map<number | null, FileFolder[]>();
    for (const f of folderList) {
      const pid = f.parentId ?? null;
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid)!.push(f);
    }
    function walk(parentId: number | null, depth: number) {
      const children = childrenMap.get(parentId) || [];
      for (const child of children) {
        const prefix = depth === 0 ? "" : `${"  ".repeat(depth)}└─ `;
        list.push({
          id: child.id,
          name: child.name,
          depth,
          label: `${prefix}${child.name}`,
          passwordEnabled: child.passwordEnabled,
        });
        walk(child.id, depth + 1);
      }
    }
    walk(null, 0);
    return list;
  }, []);

  const uploadHierarchicalFolders = useMemo(() => buildFolderTree(uploadFoldersList), [buildFolderTree, uploadFoldersList]);
  const currentHierarchicalFolders = useMemo(() => buildFolderTree(folders), [buildFolderTree, folders]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (admin) {
        const params = new URLSearchParams();
        if (adminQuery.trim()) params.set("q", adminQuery.trim());
        if (categoryFilter !== "all" && categoryFilter !== "browse_all") params.set("categoryId", categoryFilter);
        if (visibilityFilter !== "all") params.set("visibility", visibilityFilter);
        const qs = params.toString();
        const response = await fetch(`${API_BASE}/api/admin/user-files${qs ? `?${qs}` : ""}`, { credentials: "include", cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "โหลดรายการไฟล์ไม่สำเร็จ");
        setResult(payload);
      } else {
        const response = await fetch(`${API_BASE}/api/files`, { credentials: "include", cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "โหลดรายการไฟล์ไม่สำเร็จ");
        setResult(payload);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "โหลดรายการไฟล์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [admin, adminQuery, categoryFilter, visibilityFilter]);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  useEffect(() => {
    if (!admin) return;
    if (queryDebounce.current) clearTimeout(queryDebounce.current);
    queryDebounce.current = setTimeout(() => setAdminQuery(query), 280);
    return () => {
      if (queryDebounce.current) clearTimeout(queryDebounce.current);
    };
  }, [admin, query]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const modalOpen = !!(
    showUpload ||
    deleteTarget ||
    preview ||
    passwordPrompt ||
    renameTarget ||
    categoryTarget ||
    passwordTarget ||
    shareTarget ||
    batchDeleteModalOpen ||
    batchCategoryModalOpen ||
    folderModal ||
    folderDeleteTarget ||
    moveFolderTarget ||
    batchFolderModalOpen ||
    categoryModal ||
    categoryDeleteTarget ||
    categoryPasswordPrompt ||
    notice
  );
  const previewOpen = Boolean(preview);

  useEffect(() => {
    if (!modalOpen) return;

    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const originalBodyOverflow = document.body.style.overflow;
    const originalBodyPosition = document.body.style.position;
    const originalBodyTop = document.body.style.top;
    const originalBodyWidth = document.body.style.width;
    const originalHtmlOverflow = document.documentElement.style.overflow;

    // A fixed body prevents the embedded PDF viewer from receiving swipe gestures on
    // some mobile browsers. Overflow locking is sufficient while the preview is open;
    // other dialogs keep the fixed-position lock so their background never moves.
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (!previewOpen) {
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
    }
    document.documentElement.classList.add("fl-modal-locked");
    document.body.classList.add("fl-modal-locked");

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
      document.body.style.position = originalBodyPosition;
      document.body.style.top = originalBodyTop;
      document.body.style.width = originalBodyWidth;
      document.documentElement.classList.remove("fl-modal-locked");
      document.body.classList.remove("fl-modal-locked");
      window.scrollTo(0, scrollY);
    };
  }, [modalOpen, previewOpen]);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    uploadCancelRef.current = true;
    xhrRef.current?.abort();
  }, [preview]);

  const filtered = useMemo(() => {
    const items = result?.items || [];
    const term = query.trim().toLocaleLowerCase("th");
    return items.filter((item) => {
      // Category filter
      if (categoryFilter !== "all" && categoryFilter !== "browse_all") {
        if (categoryFilter === "none") {
          if (item.categoryId) return false;
        } else if (String(item.categoryId || "") !== categoryFilter) {
          return false;
        }
      }
      // Folder filter (when inside a specific category)
      if (categoryFilter !== "all" && categoryFilter !== "none" && categoryFilter !== "browse_all" && selectedFolderId !== null) {
        if (selectedFolderId === -1) {
          if (item.folderId) return false;
        } else if (item.folderId !== selectedFolderId) {
          return false;
        }
      }
      // Visibility filter
      if (visibilityFilter !== "all") {
        if (visibilityFilter === "visible" && !item.isVisible) return false;
        if (visibilityFilter === "hidden" && item.isVisible) return false;
      }
      // Type filter
      if (typeFilter !== "all") {
        const k = fileKind(item).kind;
        if (typeFilter === "document") {
          if (k !== "document" && k !== "pdf" && k !== "code" && k !== "spreadsheet") return false;
        } else if (k !== typeFilter) {
          return false;
        }
      }
      // Search term
      if (!term) return true;
      const matchName = item.name.toLocaleLowerCase("th").includes(term);
      const matchOwner = (item.owner || "").toLocaleLowerCase("th").includes(term);
      const matchCat = (item.categoryName || "").toLocaleLowerCase("th").includes(term);
      const matchFolder = (item.folderName || "").toLocaleLowerCase("th").includes(term);
      return matchName || matchOwner || matchCat || matchFolder;
    });
  }, [admin, categoryFilter, selectedFolderId, visibilityFilter, typeFilter, query, result]);

  // The category or folder the share button in the folder bar acts on.
  const selectedCategoryId = categoryFilter !== "all" && categoryFilter !== "none" && categoryFilter !== "browse_all" ? Number(categoryFilter) || 0 : 0;
  const currentShareScope = useMemo<ShareScope | null>(() => {
    if (!selectedCategoryId) return null;
    if (selectedFolderId !== null && selectedFolderId > 0) {
      const folder = folders.find((f) => f.id === selectedFolderId);
      if (!folder) return null;
      return { kind: "folder", id: folder.id, name: folder.name, shareUrl: folder.shareUrl, shareExpiresAt: folder.shareExpiresAt };
    }
    const category = categories.find((c) => c.id === selectedCategoryId);
    if (!category) return null;
    return admin
      ? { kind: "category", id: category.id, name: category.name, shareUrl: category.adminShareUrl, shareExpiresAt: category.adminShareExpiresAt }
      : { kind: "category", id: category.id, name: category.name, shareUrl: category.shareUrl, shareExpiresAt: category.shareExpiresAt };
  }, [admin, categories, folders, selectedCategoryId, selectedFolderId]);

  // Preview steps through the files in the current view, skipping ones that would ask for a password.
  const previewId = preview?.item.id;
  const previewList = useMemo(() => filtered.filter((item) => {
    if (item.id === previewId) return true;
    const isOwner = item.isOwner ?? !admin;
    if (item.passwordEnabled && !isOwner) return false;
    return item.isVisible || isOwner || admin;
  }), [filtered, previewId, admin]);
  const previewIndex = previewId ? previewList.findIndex((item) => item.id === previewId) : -1;
  const previewPrev = previewIndex > 0 ? previewList[previewIndex - 1] : null;
  const previewNext = previewIndex >= 0 && previewIndex < previewList.length - 1 ? previewList[previewIndex + 1] : null;
  const previewSwitching = Boolean(preview && fileTransfer?.mode === "preview");
  function stepPreview(target: FileItem | null) {
    if (target && !previewSwitching) void previewFile(target);
  }
  function closePreview() {
    if (previewSwitching) cancelFileTransfer();
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  function onPreviewTouchEnd(event: ReactTouchEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    stepPreview(dx < 0 ? previewNext : previewPrev);
  }
  useEffect(() => {
    if (!preview || passwordPrompt) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (notice) return; // the toast closes first
        event.preventDefault();
        closePreview();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(el.tagName))) return;
      event.preventDefault();
      stepPreview(event.key === "ArrowRight" ? previewNext : previewPrev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const stats = useMemo(() => {
    const items = result?.items || [];
    let imageCount = 0;
    let videoCount = 0;
    let audioCount = 0;
    let docCount = 0;
    let archiveCount = 0;
    let hiddenCount = 0;
    let lockedCount = 0;

    for (const it of items) {
      const k = fileKind(it).kind;
      if (k === "image") imageCount++;
      else if (k === "video") videoCount++;
      else if (k === "audio") audioCount++;
      else if (k === "archive") archiveCount++;
      else docCount++;

      if (!it.isVisible) hiddenCount++;
      if (it.passwordEnabled) lockedCount++;
    }

    return {
      total: items.length,
      usedBytes: result?.usedBytes || 0,
      quotaBytes: result?.quotaBytes || 0,
      maxFileBytes: result?.maxFileBytes || 104857600,
      imageCount,
      videoCount,
      audioCount,
      docCount,
      archiveCount,
      mediaCount: imageCount + videoCount + audioCount,
      hiddenCount,
      lockedCount,
    };
  }, [result]);

  const quotaPercent = stats.quotaBytes ? Math.min(100, (stats.usedBytes / stats.quotaBytes) * 100) : 0;
  const visibleCategories = categories.filter((c) => c.isVisible || admin || c.isOwner);

  const categoryStatsMap = useMemo(() => {
    const map = new Map<number, { fileCount: number; hiddenCount: number; totalBytes: number }>();
    const items = result?.items || [];
    for (const item of items) {
      if (item.categoryId) {
        const curr = map.get(item.categoryId) || { fileCount: 0, hiddenCount: 0, totalBytes: 0 };
        curr.fileCount += 1;
        if (!item.isVisible) curr.hiddenCount += 1;
        curr.totalBytes += item.size;
        map.set(item.categoryId, curr);
      }
    }
    for (const cat of categories) {
      const curr = map.get(cat.id);
      if (!curr) {
        map.set(cat.id, {
          fileCount: cat.fileCount || 0,
          hiddenCount: cat.hiddenFileCount || 0,
          totalBytes: 0,
        });
      } else if (cat.hiddenFileCount && cat.hiddenFileCount > curr.hiddenCount) {
        curr.hiddenCount = cat.hiddenFileCount;
      }
    }
    return map;
  }, [result, categories]);

  const folderStatsMap = useMemo(() => {
    const map = new Map<number, { fileCount: number; hiddenCount: number; totalBytes: number }>();
    const items = result?.items || [];
    for (const item of items) {
      if (item.folderId) {
        const curr = map.get(item.folderId) || { fileCount: 0, hiddenCount: 0, totalBytes: 0 };
        curr.fileCount += 1;
        if (!item.isVisible) curr.hiddenCount += 1;
        curr.totalBytes += item.size;
        map.set(item.folderId, curr);
      }
    }
    for (const f of folders) {
      const curr = map.get(f.id);
      if (!curr) {
        map.set(f.id, {
          fileCount: f.fileCount || 0,
          hiddenCount: f.hiddenFileCount || 0,
          totalBytes: 0,
        });
      } else if (f.hiddenFileCount && f.hiddenFileCount > curr.hiddenCount) {
        curr.hiddenCount = f.hiddenFileCount;
      }
    }
    return map;
  }, [result, folders]);

  const uncategorizedStats = useMemo(() => {
    const items = result?.items || [];
    let fileCount = 0;
    let hiddenCount = 0;
    let totalBytes = 0;
    for (const item of items) {
      if (!item.categoryId) {
        fileCount += 1;
        if (!item.isVisible) hiddenCount += 1;
        totalBytes += item.size;
      }
    }
    return { fileCount, hiddenCount, totalBytes };
  }, [result]);

  const currentScopeHiddenCount = useMemo(() => {
    if (selectedFolderId !== null && selectedFolderId > 0) {
      const fStat = folderStatsMap.get(selectedFolderId);
      const fromItems = (result?.items || []).filter(
        (f) => f.folderId === selectedFolderId && !f.isVisible
      ).length;
      return Math.max(fStat?.hiddenCount || 0, fromItems);
    }
    if (categoryFilter !== "all" && categoryFilter !== "browse_all" && categoryFilter !== "none") {
      const catId = Number(categoryFilter);
      const cStat = categoryStatsMap.get(catId);
      const fromItems = (result?.items || []).filter(
        (f) => String(f.categoryId) === categoryFilter && !f.isVisible
      ).length;
      return Math.max(cStat?.hiddenCount || 0, fromItems);
    }
    if (categoryFilter === "none") {
      return uncategorizedStats.hiddenCount;
    }
    return stats.hiddenCount;
  }, [selectedFolderId, folderStatsMap, categoryFilter, categoryStatsMap, uncategorizedStats, stats.hiddenCount, result]);

  const isCategoryRoot = categoryFilter === "all" && !query.trim() && typeFilter === "all" && visibilityFilter === "all";
  const hasFilters = !!(query.trim() || (categoryFilter !== "all" && categoryFilter !== "browse_all") || visibilityFilter !== "all" || typeFilter !== "all");

  const isAllSelected = filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((item) => item.id));
    }
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function shareEndpoint(id: string) {
    return admin ? `/api/admin/user-files/${encodeURIComponent(id)}/share` : `/api/files/${encodeURIComponent(id)}/share`;
  }

  async function createShareLink() {
    if (!shareTarget) return;
    setShareBusy(true);
    try {
      const response = await fetch(`${API_BASE}${shareEndpoint(shareTarget.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expiresIn: shareExpiresIn }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "สร้างลิงก์แชร์ไม่สำเร็จ");
      flash({ kind: "success", text: "สร้างลิงก์แชร์เรียบร้อยแล้ว" });
      setShareTarget(null);
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "สร้างลิงก์แชร์ไม่สำเร็จ" });
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShareLink(item: FileItem) {
    setShareBusy(true);
    try {
      const response = await fetch(`${API_BASE}${shareEndpoint(item.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ยกเลิกลิงก์แชร์ไม่สำเร็จ");
      flash({ kind: "success", text: "ยกเลิกลิงก์แชร์เรียบร้อยแล้ว" });
      setShareTarget(null);
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ยกเลิกลิงก์แชร์ไม่สำเร็จ" });
    } finally {
      setShareBusy(false);
    }
  }

  async function handleBatchDelete() {
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    try {
      const path = admin ? "/api/admin/user-files/batch-delete" : "/api/files/batch-delete";
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "ลบไฟล์ที่เลือกไม่สำเร็จ");
      }
      const data = await response.json().catch(() => ({ deletedCount: selectedIds.length }));
      flash({ kind: "success", text: `ลบไฟล์เรียบร้อยแล้ว (${data.deletedCount ?? selectedIds.length} รายการ)` });
      setSelectedIds([]);
      setBatchDeleteModalOpen(false);
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ลบไฟล์ที่เลือกไม่สำเร็จ" });
    } finally {
      setBatchBusy(false);
    }
  }

  async function handleBatchCategory() {
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    try {
      const path = admin ? "/api/admin/user-files/batch-category" : "/api/files/batch-category";
      const catId = batchTargetCategory === "none" ? null : parseInt(batchTargetCategory, 10);
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ids: selectedIds,
          categoryId: catId,
          clearCategory: batchTargetCategory === "none",
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "ย้ายหมวดหมู่ไม่สำเร็จ");
      }
      const data = await response.json().catch(() => ({ updatedCount: selectedIds.length }));
      flash({ kind: "success", text: `เปลี่ยนหมวดหมู่สำเร็จ (${data.updatedCount ?? selectedIds.length} รายการ)` });
      setSelectedIds([]);
      setBatchCategoryModalOpen(false);
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ย้ายหมวดหมู่ไม่สำเร็จ" });
    } finally {
      setBatchBusy(false);
    }
  }

  async function handleBatchVisibility(visible: boolean) {
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    try {
      if (admin) {
        const response = await fetch(`${API_BASE}/api/admin/user-files/batch-visibility`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ids: selectedIds, isVisible: visible }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "เปลี่ยนการแสดงผลไม่สำเร็จ");
        }
      } else {
        await Promise.all(
          selectedIds.map(async (id) => {
            const res = await fetch(`${API_BASE}/api/files/${encodeURIComponent(id)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ isVisible: visible }),
            });
            if (!res.ok) {
              const p = await res.json().catch(() => ({}));
              throw new Error(p.error || "เปลี่ยนการแสดงผลบางรายการไม่สำเร็จ");
            }
          })
        );
      }
      flash({
        kind: "success",
        text: `${visible ? "แสดง" : "ซ่อน"}ไฟล์สำเร็จ (${selectedIds.length} รายการ)`,
      });
      setSelectedIds([]);
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "เปลี่ยนการแสดงผลไม่สำเร็จ" });
    } finally {
      setBatchBusy(false);
    }
  }

  async function handleBatchDownload() {
    if (selectedIds.length === 0) return;
    const isItemOwner = (i: FileItem) => i.isOwner ?? !admin;
    const selectedItems = filtered.filter((i) => selectedIds.includes(i.id));
    const lockedOtherItems = selectedItems.filter((i) => i.passwordEnabled && !isItemOwner(i));
    if (lockedOtherItems.length > 0) {
      flash({
        kind: "error",
        text: `มี ${lockedOtherItems.length} ไฟล์ของผู้อื่นที่ติดรหัสผ่าน โปรดดาวน์โหลดแยกทีละไฟล์เพื่อระบุรหัสผ่าน`,
      });
    }
    const downloadableItems = selectedItems.filter((i) => !i.passwordEnabled || isItemOwner(i));
    if (downloadableItems.length === 0) return;
    flash({ kind: "success", text: `กำลังเตรียมดาวน์โหลด ${downloadableItems.length} ไฟล์...` });
    for (let i = 0; i < downloadableItems.length; i++) {
      const item = downloadableItems[i];
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = `${API_BASE}/api/files/${encodeURIComponent(item.id)}/download`;
      document.body.appendChild(iframe);
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 10000);
      if (i < downloadableItems.length - 1) {
        await new Promise((r) => setTimeout(r, 450));
      }
    }
  }

  function addUploadFiles(list?: FileList | File[] | null) {
    setNotice(null);
    const files = Array.from(list || []);
    if (!files.length) return;
    const max = result?.maxFileBytes || 50 * 1024 * 1024;
    const kept = uploadQueue.filter((item) => item.status !== "done");
    const known = new Set(kept.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`));
    const added: UploadItem[] = [];
    let overflow = 0;
    for (const file of files) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (known.has(key)) continue;
      if (kept.length + added.length >= MAX_UPLOAD_BATCH) { overflow++; continue; }
      known.add(key);
      const error = !file.size ? "ไฟล์ว่างเปล่า" : file.size > max ? `ใหญ่เกิน ${formatBytes(max)}` : undefined;
      added.push({ id: `${key}:${Math.random().toString(36).slice(2)}`, file, status: error ? "error" : "ready", progress: 0, error, blocked: !!error });
    }
    setUploadQueue([...kept, ...added]);
    // A file picked twice is simply skipped; only the batch limit is worth interrupting for.
    if (overflow) flash({ kind: "error", text: `เลือกได้ครั้งละไม่เกิน ${MAX_UPLOAD_BATCH} ไฟล์ ข้ามไป ${overflow} ไฟล์` });
  }

  function removeUploadItem(id: string) {
    setUploadQueue((queue) => queue.filter((item) => item.id !== id));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!uploading) addUploadFiles(event.dataTransfer.files);
  }

  function openUpload() {
    setShowUpload(true);
    setUploadQueue([]);
    if (categoryFilter !== "all" && categoryFilter !== "none" && categoryFilter !== "browse_all") {
      setUploadCategoryId(categoryFilter);
      if (selectedFolderId !== null && selectedFolderId > 0) {
        setUploadFolderId(String(selectedFolderId));
      } else {
        setUploadFolderId("");
      }
    } else {
      setUploadCategoryId("");
      setUploadFolderId("");
    }
    setNotice(null);
  }

  function closeUpload() {
    if (uploading) return;
    setShowUpload(false);
    setUploadQueue([]);
  }

  function patchUploadItem(id: string, patch: Partial<UploadItem>) {
    setUploadQueue((queue) => queue.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function sendUpload(item: UploadItem): Promise<{ ok: boolean; status: number; error?: string; code?: string }> {
    return new Promise((resolve) => {
      const body = new FormData();
      body.append("file", item.file);
      if (uploadCategoryId) body.append("categoryId", uploadCategoryId);
      if (uploadFolderId) body.append("folderId", uploadFolderId);
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", `${API_BASE}/api/files`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) patchUploadItem(item.id, { progress: Math.round((event.loaded / event.total) * 100) });
      };
      xhr.onload = () => {
        xhrRef.current = null;
        const payload = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
        const ok = xhr.status >= 200 && xhr.status < 300;
        resolve({ ok, status: xhr.status, error: ok ? undefined : payload.error || "อัปโหลดไม่สำเร็จ", code: payload.code });
      };
      xhr.onerror = () => { xhrRef.current = null; resolve({ ok: false, status: 0, error: "เชื่อมต่อระบบอัปโหลดไม่สำเร็จ" }); };
      xhr.onabort = () => { xhrRef.current = null; resolve({ ok: false, status: -1 }); };
      xhr.send(body);
    });
  }

  // One file at a time: keeps progress readable and stays inside the server's rate limit.
  async function uploadFiles() {
    if (uploading) return;
    const pending = uploadQueue.filter((item) => item.status === "ready" || (item.status === "error" && !item.blocked));
    if (!pending.length) return;
    uploadCancelRef.current = false;
    setUploading(true);
    setNotice(null);
    let done = 0;
    let failed = 0;
    let stopped = false;
    // Set when a specific message was already shown, so the summary does not replace it.
    let explained = false;
    for (const item of pending) {
      if (uploadCancelRef.current) { stopped = true; break; }
      patchUploadItem(item.id, { status: "uploading", progress: 0, error: undefined });
      const outcome = await sendUpload(item);
      if (outcome.status === -1) { patchUploadItem(item.id, { status: "ready", progress: 0 }); stopped = true; break; }
      if (outcome.ok) { done++; patchUploadItem(item.id, { status: "done", progress: 100 }); continue; }
      failed++;
      patchUploadItem(item.id, { status: "error", progress: 0, error: outcome.error });
      // The folder or category is wrong for every file, so don't send the rest just to hear it again.
      if (outcome.code === "invalid_folder" || outcome.code === "invalid_category" || outcome.code === "folder_category_mismatch") {
        const rest = new Set(pending.slice(pending.indexOf(item) + 1).map((next) => next.id));
        setUploadQueue((queue) => queue.map((next) => (rest.has(next.id) ? { ...next, status: "error", progress: 0, error: outcome.error } : next)));
        failed += rest.size;
        flash({ kind: "error", text: `${outcome.error} ลองเลือกหมวดหมู่หรือแฟ้มใหม่แล้วกดลองอีกครั้ง` });
        explained = true;
        stopped = true;
        break;
      }
      if (outcome.status === 429) {
        flash({ kind: "error", text: "อัปโหลดถี่เกินไป รอสักครู่แล้วกดลองอีกครั้ง" });
        explained = true;
        stopped = true;
        break;
      }
    }
    setUploading(false);
    if (done) {
      loadFiles();
      const cid = parseInt(uploadCategoryId, 10);
      if (!Number.isNaN(cid) && cid > 0) void loadFolders(cid);
    }
    const blocked = uploadQueue.filter((item) => item.blocked).length;
    if (!stopped && !failed && !blocked) {
      setShowUpload(false);
      setUploadQueue([]);
      setUploadCategoryId("");
      setUploadFolderId("");
      flash({ kind: "success", text: done === 1 ? "อัปโหลดไฟล์เรียบร้อยแล้ว" : `อัปโหลด ${done} ไฟล์เรียบร้อยแล้ว` });
    } else if ((done || failed) && !explained) {
      flash({ kind: failed ? "error" : "success", text: `อัปโหลดแล้ว ${done} ไฟล์${failed ? ` · ไม่สำเร็จ ${failed} ไฟล์` : ""}${stopped && !failed ? " · หยุดไว้ก่อน" : ""}` });
    }
  }

  function stopUpload() {
    uploadCancelRef.current = true;
    xhrRef.current?.abort();
  }

  function hideFileTransfer() {
    if (fileTransferHideTimerRef.current) {
      clearTimeout(fileTransferHideTimerRef.current);
      fileTransferHideTimerRef.current = null;
    }
    fileTransferControllerRef.current = null;
    setFileTransfer(null);
  }

  function finishFileTransfer() {
    setFileTransfer((current) => current ? {
      ...current,
      loadedBytes: current.totalBytes,
      percent: 100,
      phase: "processing",
    } : current);
    if (fileTransferHideTimerRef.current) clearTimeout(fileTransferHideTimerRef.current);
    fileTransferHideTimerRef.current = setTimeout(hideFileTransfer, 450);
  }

  function cancelFileTransfer() {
    fileTransferControllerRef.current?.abort();
    hideFileTransfer();
  }

  async function fetchFileBlob(item: FileItem, previewMode: boolean, password?: string) {
    const isOwner = item.isOwner ?? !admin;
    const needsPassword = item.passwordEnabled && !isOwner;
    const url = `${API_BASE}/api/files/${encodeURIComponent(item.id)}/download${previewMode ? "?preview=true" : ""}`;
    fileTransferControllerRef.current?.abort();
    if (fileTransferHideTimerRef.current) clearTimeout(fileTransferHideTimerRef.current);
    const controller = new AbortController();
    fileTransferControllerRef.current = controller;
    setFileTransfer({
      mode: previewMode ? "preview" : "download",
      item,
      loadedBytes: 0,
      totalBytes: Math.max(0, item.size || 0),
      percent: 0,
      phase: "loading",
    });
    const response = await fetch(url, {
      method: needsPassword || password ? "POST" : "GET",
      credentials: "include",
      headers: password || needsPassword ? { "Content-Type": "application/json" } : undefined,
      body: password || needsPassword ? JSON.stringify({ password: password || "" }) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const err = new Error(payload.error || "ดาวน์โหลดไฟล์ไม่สำเร็จ") as Error & { code?: string };
      err.code = payload.code;
      throw err;
    }

    const headerSize = Number(response.headers.get("content-length"));
    const totalBytes = Number.isFinite(headerSize) && headerSize > 0 ? headerSize : Math.max(0, item.size || 0);
    const contentType = response.headers.get("content-type") || item.contentType || "application/octet-stream";
    const reader = response.body?.getReader();
    if (!reader) {
      const blob = await response.blob();
      if (fileTransferControllerRef.current === controller) {
        setFileTransfer((current) => current ? {
          ...current,
          loadedBytes: blob.size,
          totalBytes: totalBytes || blob.size,
          percent: 100,
        } : current);
      }
      return blob;
    }

    const chunks: ArrayBuffer[] = [];
    let loadedBytes = 0;
    let lastPercent = -1;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loadedBytes += value.byteLength;
      chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
      const percent = totalBytes > 0 ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 0;
      if (fileTransferControllerRef.current === controller && percent !== lastPercent) {
        lastPercent = percent;
        setFileTransfer((current) => current ? {
          ...current,
          loadedBytes,
          totalBytes,
          percent,
        } : current);
      }
    }

    if (fileTransferControllerRef.current === controller) {
      setFileTransfer((current) => current ? {
        ...current,
        loadedBytes,
        totalBytes: totalBytes || loadedBytes,
        percent: 100,
      } : current);
    }
    return new Blob(chunks, { type: contentType });
  }

  async function downloadFile(item: FileItem, password?: string): Promise<boolean> {
    setNotice(null);
    const isOwner = item.isOwner ?? !admin;
    if (!item.isVisible && !isOwner && !admin) {
      flash({ kind: "info", text: "ไฟล์นี้ถูกซ่อนไว้โดยเจ้าของไฟล์ ไม่สามารถดาวน์โหลดได้" });
      return false;
    }
    try {
      if (item.passwordEnabled && !isOwner && !password) {
        setPasswordPrompt({ item, mode: "download" });
        setPasswordInput("");
        setPasswordError("");
        return false;
      }
      const blob = await fetchFileBlob(item, false, password);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      finishFileTransfer();
      return true;
    } catch (requestError) {
      const cancelled = requestError instanceof Error && requestError.name === "AbortError";
      hideFileTransfer();
      if (cancelled) return false;
      const code = (requestError as Error & { code?: string }).code;
      if (code === "file_password_required") {
        if (!passwordPrompt) {
          setPasswordPrompt({ item, mode: "download" });
          setPasswordInput("");
          setPasswordError("");
        }
        return false;
      }
      flash({ kind: "error", text: requestError instanceof Error ? requestError.message : "ดาวน์โหลดไฟล์ไม่สำเร็จ" });
      return false;
    }
  }

  async function previewFile(item: FileItem, password?: string): Promise<boolean> {
    const kindInfo = fileKind(item);
    const isOwner = item.isOwner ?? !admin;
    if (!item.isVisible && !isOwner && !admin) {
      flash({ kind: "info", text: "ไฟล์นี้ถูกซ่อนไว้โดยเจ้าของไฟล์ ไม่สามารถเปิดดูตัวอย่างได้" });
      return false;
    }
    try {
      if (item.passwordEnabled && !isOwner && !password) {
        setPasswordPrompt({ item, mode: "preview" });
        setPasswordInput("");
        setPasswordError("");
        return false;
      }
      const blob = await fetchFileBlob(item, true, password);
      let textContent: string | undefined = undefined;
      const ext = getFileExt(item.name);
      if (kindInfo.kind === "code" || (kindInfo.kind === "document" && ["txt", "md", "log", "env", "csv", "json"].includes(ext))) {
        try {
          const raw = await blob.text();
          textContent = raw.slice(0, 80000);
        } catch {
          /* ignore */
        }
      }
      const url = URL.createObjectURL(blob);
      if (preview?.url) URL.revokeObjectURL(preview.url);
      setPreview({
        item,
        url,
        kind: kindInfo.kind,
        textContent,
        password,
      });
      finishFileTransfer();
      return true;
    } catch (requestError) {
      const cancelled = requestError instanceof Error && requestError.name === "AbortError";
      hideFileTransfer();
      if (cancelled) return false;
      const code = (requestError as Error & { code?: string }).code;
      if (code === "file_password_required") {
        if (!passwordPrompt) {
          setPasswordPrompt({ item, mode: "preview" });
          setPasswordInput("");
          setPasswordError("");
        }
        return false;
      }
      flash({ kind: "error", text: requestError instanceof Error ? requestError.message : "เปิดตัวอย่างไม่สำเร็จ" });
      return false;
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordPrompt || passwordBusy) return;
    setPasswordBusy(true);
    setPasswordError("");
    const { item, mode } = passwordPrompt;
    try {
      const ok = mode === "preview" ? await previewFile(item, passwordInput) : await downloadFile(item, passwordInput);
      if (ok) {
        setPasswordPrompt(null);
        setPasswordInput("");
        setPasswordError("");
      } else {
        setPasswordError("รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง");
      }
    } finally {
      setPasswordBusy(false);
    }
  }

  async function deleteFile() {
    if (!deleteTarget) return;
    const item = deleteTarget;
    setDeleteTarget(null);
    try {
      await removeFile(item);
    } catch (requestError) {
      flash({ kind: "error", text: requestError instanceof Error ? requestError.message : "ลบไฟล์ไม่สำเร็จ" });
    }
  }

  async function removeFile(item: FileItem) {
    const path = admin ? `/api/admin/user-files/${encodeURIComponent(item.id)}` : `/api/files/${encodeURIComponent(item.id)}`;
    const response = await fetch(`${API_BASE}${path}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "ลบไฟล์ไม่สำเร็จ");
    }
    flash({ kind: "success", text: "ลบไฟล์เรียบร้อยแล้ว" });
    await loadFiles();
  }

  function requestDelete(item: FileItem) {
    setMenuItemId(null);
    if (ask) {
      confirmAction({
        title: "ลบไฟล์นี้?",
        message: `“${item.name}” จะถูกลบและกู้คืนไม่ได้`,
        confirmLabel: "ลบไฟล์",
        danger: true,
        action: () => removeFile(item),
      });
      return;
    }
    setDeleteTarget(item);
  }

  async function patchAdmin(id: string, body: Record<string, unknown>, successText: string) {
    setActionBusy(true);
    setNotice(null);
    try {
      const path = admin
        ? `/api/admin/user-files/${encodeURIComponent(id)}`
        : `/api/files/${encodeURIComponent(id)}`;
      const response = await fetch(`${API_BASE}${path}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "บันทึกไม่สำเร็จ");
      flash({ kind: "success", text: successText });
      await loadFiles();
      return true;
    } catch (requestError) {
      flash({ kind: "error", text: requestError instanceof Error ? requestError.message : "บันทึกไม่สำเร็จ" });
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function saveRename(event: FormEvent) {
    event.preventDefault();
    if (!renameTarget || !renameBase.trim()) return;
    const item = renameTarget;
    const nextName = `${renameBase.trim()}${splitName(item.name).ext}`;
    confirmAction({
      title: "ยืนยันเปลี่ยนชื่อ?",
      message: `เปลี่ยนชื่อเป็น “${nextName}”`,
      confirmLabel: "บันทึกชื่อ",
      action: async () => {
        const ok = await patchAdmin(item.id, { name: renameBase.trim() }, "เปลี่ยนชื่อไฟล์เรียบร้อยแล้ว");
        if (ok) setRenameTarget(null);
      },
    });
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryTarget) return;
    const item = categoryTarget;
    const body = categoryValue
      ? { categoryId: Number(categoryValue) }
      : { clearCategory: true };
    const categoryLabel = categoryValue
      ? categories.find((cat) => String(cat.id) === categoryValue)?.name || "หมวดหมู่ที่เลือก"
      : "ไม่มีหมวดหมู่";
    confirmAction({
      title: "ยืนยันตั้งหมวดหมู่?",
      message: `ตั้ง “${item.name}” ไปที่ ${categoryLabel}`,
      confirmLabel: "บันทึกหมวดหมู่",
      action: async () => {
        const ok = await patchAdmin(item.id, body, "อัปเดตหมวดหมู่เรียบร้อยแล้ว");
        if (ok) setCategoryTarget(null);
      },
    });
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!passwordTarget) return;
    const item = passwordTarget;
    const body: Record<string, unknown> = { passwordEnabled: passwordEnable };
    if (passwordEnable) {
      if (!passwordNew.trim() && !item.passwordEnabled) {
        flash({ kind: "error", text: "กรุณาระบุรหัสผ่านเมื่อเปิดการล็อกไฟล์" });
        return;
      }
      if (passwordNew.trim()) body.password = passwordNew.trim();
    }
    confirmAction({
      title: passwordEnable ? "เปิดรหัสผ่านดาวน์โหลด?" : "ปิดรหัสผ่านดาวน์โหลด?",
      message: passwordEnable
        ? `“${item.name}” จะต้องใส่รหัสก่อนดาวน์โหลดหรือดูตัวอย่าง`
        : `“${item.name}” จะดาวน์โหลดได้โดยไม่ต้องใส่รหัส`,
      confirmLabel: "บันทึก",
      danger: !passwordEnable && item.passwordEnabled,
      action: async () => {
        const ok = await patchAdmin(
          item.id,
          body,
          passwordEnable ? "ตั้งรหัสผ่านดาวน์โหลดเรียบร้อยแล้ว" : "ปิดรหัสผ่านดาวน์โหลดแล้ว",
        );
        if (ok) {
          setPasswordTarget(null);
          setPasswordNew("");
        }
      },
    });
  }

  function toggleVisibility(item: FileItem) {
    const nextVisible = !item.isVisible;
    setMenuItemId(null);
    confirmAction({
      title: nextVisible ? "แสดงไฟล์นี้?" : "ซ่อนไฟล์นี้?",
      message: nextVisible
        ? `“${item.name}” จะแสดงผ่านลิงก์แชร์หมวดหมู่ เจ้าของไฟล์ยังเป็นผู้เดียวที่เห็นไฟล์นี้ในคลังส่วนตัว`
        : `“${item.name}” จะถูกซ่อนจากลิงก์แชร์ เจ้าของและผู้ดูแลยังเห็นไฟล์พร้อมป้าย “ซ่อน”`,
      confirmLabel: nextVisible ? "แสดงไฟล์" : "ซ่อนไฟล์",
      danger: !nextVisible,
      action: async () => {
        await patchAdmin(item.id, { isVisible: nextVisible }, nextVisible ? "แสดงไฟล์แล้ว" : "ซ่อนไฟล์แล้ว");
      },
    });
  }

  function openRename(item: FileItem) {
    const { base } = splitName(item.name);
    setRenameTarget(item);
    setRenameBase(base);
    setMenuItemId(null);
  }

  function openCategory(item: FileItem) {
    setCategoryTarget(item);
    setCategoryValue(item.categoryId ? String(item.categoryId) : "");
    setMenuItemId(null);
  }

  function openPassword(item: FileItem) {
    setPasswordTarget(item);
    setPasswordEnable(item.passwordEnabled);
    setPasswordNew("");
    setMenuItemId(null);
  }

  function openShare(item: FileItem) {
    setShareTarget(item);
    setShareExpiresIn("never");
    setMenuItemId(null);
  }

  function handleOpenCreateFolder(parentIdOverride?: number | null) {
    if (categoryFilter === "all" || categoryFilter === "none") return;
    const pid =
      parentIdOverride !== undefined
        ? parentIdOverride
        : selectedFolderId !== null && selectedFolderId > 0
        ? selectedFolderId
        : null;
    setFolderForm({
      name: "",
      isVisible: true,
      passwordEnabled: false,
      password: "",
    });
    setFolderModal({ mode: "create", parentId: pid });
  }

  function handleOpenEditFolder(folder: FileFolder) {
    setFolderForm({
      name: folder.name,
      isVisible: folder.isVisible,
      passwordEnabled: folder.passwordEnabled,
      password: "",
    });
    setFolderModal({ mode: "edit", folder, parentId: folder.parentId });
  }

  async function handleSaveFolder(e: FormEvent) {
    e.preventDefault();
    if (!folderModal || !folderForm.name.trim()) return;
    const catId = parseInt(categoryFilter, 10);
    if (Number.isNaN(catId) || catId <= 0) return;
    setFolderBusy(true);
    try {
      if (folderModal.mode === "create") {
        const path = admin
          ? `/api/admin/user-file-categories/${catId}/folders`
          : `/api/files/categories/${catId}/folders`;
        const body: Record<string, unknown> = {
          name: folderForm.name.trim(),
          isVisible: folderForm.isVisible,
          passwordEnabled: folderForm.passwordEnabled,
        };
        if (folderModal.parentId) {
          body.parentId = folderModal.parentId;
        }
        if (folderForm.passwordEnabled && folderForm.password.trim()) {
          body.password = folderForm.password.trim();
        }
        const res = await fetch(`${API_BASE}${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "สร้างแฟ้มไม่สำเร็จ");
        flash({ kind: "success", text: "สร้างแฟ้มเรียบร้อยแล้ว" });
      } else if (folderModal.mode === "edit" && folderModal.folder) {
        const path = admin
          ? `/api/admin/user-file-folders/${folderModal.folder.id}`
          : `/api/files/folders/${folderModal.folder.id}`;
        const body: Record<string, unknown> = {
          name: folderForm.name.trim(),
          isVisible: folderForm.isVisible,
          passwordEnabled: folderForm.passwordEnabled,
        };
        if (folderModal.parentId !== undefined) {
          if (folderModal.parentId === null) {
            body.clearParent = true;
          } else {
            body.parentId = folderModal.parentId;
          }
        }
        if (folderForm.passwordEnabled && folderForm.password.trim()) {
          body.password = folderForm.password.trim();
        }
        const res = await fetch(`${API_BASE}${path}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "บันทึกแฟ้มไม่สำเร็จ");
        flash({ kind: "success", text: "บันทึกข้อมูลแฟ้มเรียบร้อยแล้ว" });
      }
      setFolderModal(null);
      await loadFolders(catId);
      await loadUploadFolders(catId);
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ" });
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleDeleteFolder() {
    if (!folderDeleteTarget) return;
    const catId = parseInt(categoryFilter, 10);
    setFolderBusy(true);
    try {
      const path = admin
        ? `/api/admin/user-file-folders/${folderDeleteTarget.id}?deleteFiles=${folderDeleteCascade}`
        : `/api/files/folders/${folderDeleteTarget.id}?deleteFiles=${folderDeleteCascade}`;
      const res = await fetch(`${API_BASE}${path}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "ลบแฟ้มไม่สำเร็จ");
      flash({
        kind: "success",
        text: folderDeleteCascade
          ? `ลบแฟ้มและไฟล์ภายในเรียบร้อยแล้ว (${data.deletedFiles ?? 0} ไฟล์)`
          : `ลบแฟ้มเรียบร้อยแล้ว (ย้าย ${data.unlinkedFiles ?? 0} ไฟล์มาไว้ที่หมวดหมู่หลัก)`,
      });
      if (selectedFolderId === folderDeleteTarget.id) {
        setSelectedFolderId(folderDeleteTarget.parentId ?? null);
      }
      setFolderDeleteTarget(null);
      if (!Number.isNaN(catId) && catId > 0) {
        await loadFolders(catId);
        await loadUploadFolders(catId);
      }
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ลบแฟ้มไม่สำเร็จ" });
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleMoveFileFolder(e: FormEvent) {
    e.preventDefault();
    if (!moveFolderTarget) return;
    setActionBusy(true);
    try {
      const clearFolder = moveFolderValue === "root";
      const folderId = clearFolder ? null : parseInt(moveFolderValue, 10);
      const path = admin
        ? `/api/admin/user-files/${encodeURIComponent(moveFolderTarget.id)}`
        : `/api/files/${encodeURIComponent(moveFolderTarget.id)}`;
      const body: Record<string, unknown> = clearFolder ? { clearFolder: true } : { folderId };
      const res = await fetch(`${API_BASE}${path}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "ย้ายแฟ้มไม่สำเร็จ");
      flash({ kind: "success", text: "ย้ายไฟล์เข้าแฟ้มเรียบร้อยแล้ว" });
      setMoveFolderTarget(null);
      const catId = parseInt(categoryFilter, 10);
      if (!Number.isNaN(catId) && catId > 0) {
        await loadFolders(catId);
      }
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ย้ายแฟ้มไม่สำเร็จ" });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleBatchFolder() {
    if (selectedIds.length === 0) return;
    setBatchBusy(true);
    try {
      const clearFolder = batchTargetFolder === "root";
      const folderId = clearFolder ? null : parseInt(batchTargetFolder, 10);
      const path = admin ? "/api/admin/user-files/batch-folder" : "/api/files/batch-folder";
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ids: selectedIds,
          folderId: folderId,
          clearFolder: clearFolder,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "ย้ายเข้าแฟ้มไม่สำเร็จ");
      }
      const data = await res.json().catch(() => ({ updatedCount: selectedIds.length }));
      flash({ kind: "success", text: `ย้ายเข้าแฟ้มสำเร็จ (${data.updatedCount ?? selectedIds.length} รายการ)` });
      setSelectedIds([]);
      setBatchFolderModalOpen(false);
      const catId = parseInt(categoryFilter, 10);
      if (!Number.isNaN(catId) && catId > 0) {
        await loadFolders(catId);
      }
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ย้ายเข้าแฟ้มไม่สำเร็จ" });
    } finally {
      setBatchBusy(false);
    }
  }

  function openMoveFolder(item: FileItem) {
    setMoveFolderTarget(item);
    setMoveFolderValue(item.folderId ? String(item.folderId) : "root");
    if (item.categoryId) {
      void loadFolders(item.categoryId);
    }
    setMenuItemId(null);
  }

  function enterCategory(cat: FileCategory) {
    if (cat.passwordEnabled && !cat.isOwner && !admin && !unlockedCategoryIds.includes(cat.id)) {
      setCategoryPasswordPrompt(cat);
      setCategoryPasswordInput("");
      setCategoryPasswordError("");
      return;
    }
    setCategoryFilter(String(cat.id));
    setSelectedFolderId(null);
  }

  function handleOpenCreateCategory() {
    setCategoryForm({
      name: "",
      isVisible: true,
      passwordEnabled: false,
      password: "",
    });
    setCategoryModal({ mode: "create" });
  }

  function handleOpenEditCategory(cat: FileCategory, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    setCategoryForm({
      name: cat.name,
      isVisible: cat.isVisible,
      passwordEnabled: cat.passwordEnabled,
      password: "",
    });
    setCategoryModal({ mode: "edit", category: cat });
  }

  async function handleSaveCategory(e: FormEvent) {
    e.preventDefault();
    if (!categoryModal || !categoryForm.name.trim()) return;
    setCategoryBusy(true);
    try {
      if (categoryModal.mode === "create") {
        const path = admin ? "/api/admin/user-file-categories" : "/api/files/categories";
        const body: Record<string, unknown> = {
          name: categoryForm.name.trim(),
          isVisible: categoryForm.isVisible,
          passwordEnabled: categoryForm.passwordEnabled,
        };
        if (categoryForm.passwordEnabled && categoryForm.password.trim()) {
          body.password = categoryForm.password.trim();
        }
        const res = await fetch(`${API_BASE}${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "สร้างหมวดหมู่ไม่สำเร็จ");
        flash({ kind: "success", text: "สร้างหมวดหมู่ใหม่เรียบร้อยแล้ว" });
      } else if (categoryModal.mode === "edit" && categoryModal.category) {
        const path = admin
          ? `/api/admin/user-file-categories/${categoryModal.category.id}`
          : `/api/files/categories/${categoryModal.category.id}`;
        const body: Record<string, unknown> = {
          name: categoryForm.name.trim(),
          isVisible: categoryForm.isVisible,
          passwordEnabled: categoryForm.passwordEnabled,
        };
        if (categoryForm.passwordEnabled && categoryForm.password.trim()) {
          body.password = categoryForm.password.trim();
        }
        const res = await fetch(`${API_BASE}${path}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "บันทึกหมวดหมู่ไม่สำเร็จ");
        flash({ kind: "success", text: "บันทึกหมวดหมู่เรียบร้อยแล้ว" });
      }
      setCategoryModal(null);
      await loadCategories();
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ" });
    } finally {
      setCategoryBusy(false);
    }
  }

  function handleOpenDeleteCategory(cat: FileCategory, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    setCategoryDeleteTarget(cat);
    setCategoryDeleteCascade(false);
  }

  async function handleDeleteCategory() {
    if (!categoryDeleteTarget) return;
    setCategoryBusy(true);
    try {
      const path = admin
        ? `/api/admin/user-file-categories/${categoryDeleteTarget.id}?cascade=${categoryDeleteCascade}`
        : `/api/files/categories/${categoryDeleteTarget.id}?cascade=${categoryDeleteCascade}`;
      const res = await fetch(`${API_BASE}${path}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "ลบหมวดหมู่ไม่สำเร็จ");
      flash({
        kind: "success",
        text: categoryDeleteCascade
          ? `ลบหมวดหมู่และไฟล์/แฟ้มภายในเรียบร้อยแล้ว (${data.deletedFiles ?? 0} ไฟล์)`
          : `ลบหมวดหมู่เรียบร้อยแล้ว (ไฟล์ทั้งหมดถูกย้ายเป็นไฟล์ทั่วไป)`,
      });
      if (categoryFilter === String(categoryDeleteTarget.id)) {
        setCategoryFilter("all");
        setSelectedFolderId(null);
      }
      setCategoryDeleteTarget(null);
      await loadCategories();
      await loadFiles();
    } catch (err) {
      flash({ kind: "error", text: err instanceof Error ? err.message : "ลบหมวดหมู่ไม่สำเร็จ" });
    } finally {
      setCategoryBusy(false);
    }
  }

  async function handleVerifyCategoryPassword(e: FormEvent) {
    e.preventDefault();
    if (!categoryPasswordPrompt || !categoryPasswordInput.trim()) return;
    setCategoryPasswordBusy(true);
    setCategoryPasswordError("");
    try {
      const res = await fetch(`${API_BASE}/api/files/categories/${categoryPasswordPrompt.id}/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: categoryPasswordInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "รหัสผ่านไม่ถูกต้อง");
      }
      setUnlockedCategoryIds((prev) => [...prev, categoryPasswordPrompt.id]);
      setCategoryFilter(String(categoryPasswordPrompt.id));
      setSelectedFolderId(null);
      setCategoryPasswordPrompt(null);
      setCategoryPasswordInput("");
    } catch (err) {
      setCategoryPasswordError(err instanceof Error ? err.message : "รหัสผ่านไม่ถูกต้อง");
    } finally {
      setCategoryPasswordBusy(false);
    }
  }

  const typeTabs = [
    { key: "all" as const, label: "ทั้งหมด", Icon: Files, count: stats.total },
    { key: "image" as const, label: "รูปภาพ", Icon: FileImage, count: stats.imageCount },
    { key: "video" as const, label: "วิดีโอ", Icon: FileVideo, count: stats.videoCount },
    { key: "audio" as const, label: "เสียง", Icon: FileAudio, count: stats.audioCount },
    { key: "document" as const, label: "เอกสารและโค้ด", Icon: FileText, count: stats.docCount },
    { key: "archive" as const, label: "ไฟล์บีบอัด", Icon: FileArchive, count: stats.archiveCount },
  ];
  const currentCategoryName = categories.find((c) => String(c.id) === categoryFilter)?.name;
  const resultsTitle = query.trim()
    ? `ผลการค้นหา “${query.trim()}”`
    : selectedFolderId && selectedFolderId > 0
    ? `แฟ้ม “${folderMap.get(selectedFolderId)?.name || "แฟ้มนี้"}”`
    : selectedFolderId === -1
    ? "ไฟล์ที่ไม่ใส่แฟ้ม"
    : categoryFilter === "browse_all"
    ? "ไฟล์ทั้งหมด"
    : categoryFilter === "none"
    ? "ไฟล์ไม่ใส่หมวดหมู่"
    : typeFilter !== "all"
    ? typeTabs.find((tab) => tab.key === typeFilter)?.label || "ไฟล์"
    : visibilityFilter === "hidden"
    ? "ไฟล์ที่ซ่อน"
    : visibilityFilter === "visible"
    ? "ไฟล์ที่แสดงอยู่"
    : currentCategoryName
    ? `หมวด “${currentCategoryName}”`
    : "ไฟล์ทั้งหมด";
  const hiddenByOwner = (item: FileItem) => !item.isOwner && !admin && !item.isVisible;
  const resetFilters = () => {
    setQuery("");
    setCategoryFilter("all");
    setSelectedFolderId(null);
    setTypeFilter("all");
    setVisibilityFilter("all");
  };

  const renderFileMenu = (item: FileItem) => (
    <div className="fx-more">
      <button
        type="button"
        className={`fx-icon-btn${menuItemId === item.id ? " is-open" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setMenuAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right });
          setMenuItemId((id) => (id === item.id ? null : item.id));
        }}
        title="จัดการเพิ่มเติม"
        aria-label={`จัดการ ${item.name}`}
        aria-haspopup="menu"
        aria-expanded={menuItemId === item.id}
      >
        <MoreHorizontal size={16} />
      </button>
      {menuItemId === item.id && (
        <div className="fx-menu" role="menu" ref={menuRef} style={{ visibility: "hidden" }} onClick={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => openRename(item)}><Pencil size={15} /> เปลี่ยนชื่อ</button>
          <button type="button" role="menuitem" onClick={() => openCategory(item)}><Tag size={15} /> ตั้งหมวดหมู่</button>
          <button type="button" role="menuitem" onClick={() => openMoveFolder(item)}><Folder size={15} /> ย้ายเข้าแฟ้ม</button>
          <button type="button" role="menuitem" onClick={() => openPassword(item)}><KeyRound size={15} /> รหัสผ่านดาวน์โหลด</button>
          <button type="button" role="menuitem" onClick={() => toggleVisibility(item)}>
            {item.isVisible ? <EyeOff size={15} /> : <Eye size={15} />} {item.isVisible ? "ซ่อนไฟล์นี้" : "แสดงไฟล์นี้"}
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => requestDelete(item)}><Trash2 size={15} /> ลบไฟล์</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="fl-page fx">
      <header className="fx-hero">
        <div className="fx-hero-top">
          <div className="fx-title">
            <h1>{admin ? "จัดการระบบไฟล์" : "ไฟล์ของฉัน"}</h1>
            <p>
              {admin
                ? "ค้นหา จัดหมวดหมู่ ควบคุมการแสดงผล ดูตัวอย่างไฟล์ และรหัสผ่านดาวน์โหลด"
                : "เก็บไฟล์ไว้ที่เดียว เปิดได้ทุกอุปกรณ์ และแชร์เป็นลิงก์ได้"}
            </p>
          </div>
          <div className="fx-hero-actions">
            <button type="button" className="fx-btn fx-btn-primary" onClick={openUpload}>
              <UploadCloud size={17} /> อัปโหลดไฟล์
            </button>
          </div>
        </div>
        <div className="fx-stats">
          <div className="fx-stat">
            <span className="fx-stat-label">ไฟล์ทั้งหมด</span>
            <strong className="fx-stat-value">{stats.total.toLocaleString("th-TH")}</strong>
            <span className="fx-stat-note">{hasFilters ? `แสดงอยู่ ${filtered.length.toLocaleString("th-TH")} รายการ` : `${visibleCategories.length.toLocaleString("th-TH")} หมวดหมู่`}</span>
          </div>
          <div className="fx-stat">
            <span className="fx-stat-label">พื้นที่ที่ใช้</span>
            <strong className="fx-stat-value">{formatBytes(stats.usedBytes)}</strong>
            {stats.quotaBytes > 0 ? (
              <span className="fx-stat-meter" title={`${quotaPercent.toFixed(1)}% ของ ${formatBytes(stats.quotaBytes)}`}>
                <span className="fx-meter"><span style={{ width: `${quotaPercent}%` }} /></span>
                <small>{quotaPercent.toFixed(0)}% ของ {formatBytes(stats.quotaBytes)}</small>
              </span>
            ) : (
              <span className="fx-stat-note">ไฟล์ละไม่เกิน {formatBytes(stats.maxFileBytes)}</span>
            )}
          </div>
          <div className="fx-stat">
            <span className="fx-stat-label">สื่อ</span>
            <strong className="fx-stat-value">{stats.mediaCount.toLocaleString("th-TH")}</strong>
            <span className="fx-stat-note">{stats.imageCount} รูป · {stats.videoCount} วิดีโอ · {stats.audioCount} เสียง</span>
          </div>
          <button
            type="button"
            className={`fx-stat${visibilityFilter === "hidden" ? " is-active" : ""}`}
            disabled={stats.hiddenCount === 0}
            onClick={() => {
              setVisibilityFilter(visibilityFilter === "hidden" ? "all" : "hidden");
              if (categoryFilter === "all") setCategoryFilter("browse_all");
            }}
            title={stats.hiddenCount > 0 ? "กดเพื่อดูเฉพาะไฟล์ที่ซ่อน" : undefined}
          >
            <span className="fx-stat-label">ซ่อน / ล็อก</span>
            <strong className="fx-stat-value">{stats.hiddenCount.toLocaleString("th-TH")}<small> / {stats.lockedCount.toLocaleString("th-TH")}</small></strong>
            <span className="fx-stat-note">{stats.hiddenCount > 0 ? (visibilityFilter === "hidden" ? "กำลังดูไฟล์ที่ซ่อน" : "กดเพื่อดูไฟล์ที่ซ่อน") : "ไม่มีไฟล์ซ่อน"}</span>
          </button>
        </div>
      </header>

      <section className="fx-toolbar" aria-label="ค้นหาและตัวกรอง">
        <div className="fx-toolbar-row">
          <label className="fx-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={admin ? "ค้นหาชื่อไฟล์ ผู้ใช้ หรือหมวดหมู่" : "ค้นหาชื่อไฟล์"}
              aria-label="ค้นหาไฟล์"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>
            )}
          </label>
          <select
            className="fx-select"
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setSelectedFolderId(null);
            }}
            aria-label="เลือกหมวดหมู่"
          >
            <option value="all">หมวดหมู่ทั้งหมด</option>
            <option value="browse_all">ไฟล์ทั้งหมด</option>
            <option value="none">ไฟล์ไม่ใส่หมวดหมู่</option>
            {visibleCategories.map((cat) => (
              <option key={cat.id} value={String(cat.id)}>{cat.name}</option>
            ))}
          </select>
          <select
            className="fx-select"
            value={visibilityFilter}
            onChange={(e) => {
              const val = e.target.value as "all" | "visible" | "hidden";
              setVisibilityFilter(val);
              if (val === "hidden" && categoryFilter === "all") setCategoryFilter("browse_all");
            }}
            aria-label="กรองการแสดงผล"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="visible">แสดงอยู่</option>
            <option value="hidden">ซ่อนอยู่{stats.hiddenCount > 0 ? ` (${stats.hiddenCount})` : ""}</option>
          </select>
          <div className="fx-view-switch" role="group" aria-label="มุมมอง">
            <button type="button" className={viewMode === "grid" ? "is-active" : ""} onClick={() => setViewMode("grid")} aria-pressed={viewMode === "grid"} title="การ์ด">
              <LayoutGrid size={17} />
            </button>
            <button type="button" className={viewMode === "table" ? "is-active" : ""} onClick={() => setViewMode("table")} aria-pressed={viewMode === "table"} title="รายการ">
              <List size={17} />
            </button>
          </div>
        </div>
        <div className="fx-chips" role="group" aria-label="ประเภทไฟล์">
          {typeTabs.map(({ key, label, Icon, count }) => {
            const active = key === "all" ? typeFilter === "all" && visibilityFilter !== "hidden" : typeFilter === key;
            return (
              <button
                key={key}
                type="button"
                className={`fx-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => {
                  setTypeFilter(key);
                  if (key === "all" && visibilityFilter === "hidden") setVisibilityFilter("all");
                }}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
                <b>{count}</b>
              </button>
            );
          })}
          {stats.hiddenCount > 0 && (
            <button
              type="button"
              className={`fx-chip is-warn${visibilityFilter === "hidden" ? " is-active" : ""}`}
              aria-pressed={visibilityFilter === "hidden"}
              onClick={() => {
                if (visibilityFilter === "hidden") setVisibilityFilter("all");
                else {
                  setVisibilityFilter("hidden");
                  if (categoryFilter === "all") setCategoryFilter("browse_all");
                }
              }}
            >
              <EyeOff size={15} aria-hidden="true" />
              <span>ที่ซ่อน</span>
              <b>{stats.hiddenCount}</b>
            </button>
          )}
        </div>
      </section>

      {categoryFilter !== "all" && (
        <section className="fx-place">
          <div className="fx-place-top">
            <nav className="fx-crumbs" aria-label="ตำแหน่ง">
              <button
                type="button"
                className="fx-crumb is-back"
                onClick={() => {
                  setCategoryFilter("all");
                  setSelectedFolderId(null);
                }}
              >
                <ChevronLeft size={16} /> หมวดหมู่ทั้งหมด
              </button>
              <ChevronRight size={14} className="fx-crumb-sep" aria-hidden="true" />
              {categoryFilter === "none" || categoryFilter === "browse_all" ? (
                <span className="fx-crumb is-current">
                  {categoryFilter === "none" ? "ไฟล์ไม่ใส่หมวดหมู่" : "ไฟล์ทั้งหมด"}
                  <small>{filtered.length.toLocaleString("th-TH")}</small>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className={`fx-crumb${selectedFolderId === null ? " is-current" : ""}`}
                    onClick={() => setSelectedFolderId(null)}
                  >
                    <FolderOpen size={16} /> {currentCategoryName || "หมวดหมู่นี้"}
                    {selectedFolderId === null && (() => {
                      const cHidden = categoryStatsMap.get(Number(categoryFilter))?.hiddenCount || 0;
                      return <small>{filtered.length.toLocaleString("th-TH")}{cHidden > 0 ? ` · ซ่อน ${cHidden}` : ""}</small>;
                    })()}
                  </button>
                  {selectedFolderId === -1 && (
                    <>
                      <ChevronRight size={14} className="fx-crumb-sep" aria-hidden="true" />
                      <span className="fx-crumb is-current">ไฟล์ที่ไม่ใส่แฟ้ม</span>
                    </>
                  )}
                  {selectedFolderId !== null && selectedFolderId > 0 && folderBreadcrumbs.map((crumb, idx) => {
                    const isLast = idx === folderBreadcrumbs.length - 1;
                    const fHidden = folderStatsMap.get(crumb.id)?.hiddenCount || 0;
                    return (
                      <span key={crumb.id} className="fx-crumb-step">
                        <ChevronRight size={14} className="fx-crumb-sep" aria-hidden="true" />
                        {isLast ? (
                          <span className="fx-crumb is-current">
                            <Folder size={15} /> {crumb.name}
                            {fHidden > 0 && <small>ซ่อน {fHidden}</small>}
                          </span>
                        ) : (
                          <button type="button" className="fx-crumb" onClick={() => setSelectedFolderId(crumb.id)}>
                            <Folder size={15} /> {crumb.name}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </>
              )}
            </nav>
            {categoryFilter !== "none" && categoryFilter !== "browse_all" && (
              <div className="fx-place-actions">
                {currentShareScope && (
                  <button
                    type="button"
                    className={`fx-btn fx-btn-sm${currentShareScope.shareUrl ? " is-shared" : ""}`}
                    onClick={() => setScopeShareOpen(true)}
                    title={currentShareScope.shareUrl ? "มีลิงก์แชร์อยู่ กดเพื่อคัดลอกหรือยกเลิก" : `สร้างลิงก์แชร์${currentShareScope.kind === "folder" ? "แฟ้มนี้" : "หมวดหมู่นี้"}`}
                  >
                    <Share2 size={15} /> {currentShareScope.shareUrl ? "แชร์อยู่" : currentShareScope.kind === "folder" ? "แชร์แฟ้ม" : "แชร์หมวดหมู่"}
                  </button>
                )}
                <button type="button" className="fx-btn fx-btn-sm" onClick={() => handleOpenCreateFolder()}>
                  <FolderPlus size={15} /> {selectedFolderId !== null && selectedFolderId > 0 ? "สร้างแฟ้มย่อย" : "สร้างแฟ้ม"}
                </button>
              </div>
            )}
          </div>

          {categoryFilter !== "none" && categoryFilter !== "browse_all" && (
            <>
              <div className="fx-chips is-folders" role="group" aria-label="เลือกแฟ้ม">
                <button type="button" className={`fx-chip${selectedFolderId === null ? " is-active" : ""}`} onClick={() => setSelectedFolderId(null)}>
                  <FolderOpen size={15} /> <span>ทั้งหมดในหมวด</span>
                </button>
                <button type="button" className={`fx-chip${selectedFolderId === -1 ? " is-active" : ""}`} onClick={() => setSelectedFolderId(-1)}>
                  <Folder size={15} /> <span>ไม่ใส่แฟ้ม</span>
                </button>
                {currentLevelFolders.map((f) => (
                  <button key={f.id} type="button" className={`fx-chip${selectedFolderId === f.id ? " is-active" : ""}`} onClick={() => setSelectedFolderId(f.id)}>
                    <Folder size={15} /> <span>{f.name}</span>
                    {f.passwordEnabled && <Lock size={12} aria-label="มีรหัสผ่าน" />}
                    <b>{f.fileCount}</b>
                  </button>
                ))}
              </div>

              {currentLevelFolders.length > 0 && selectedFolderId !== -1 && (
                <div className="fx-folders">
                  {currentLevelFolders.map((f) => {
                    const fHidden = folderStatsMap.get(f.id)?.hiddenCount || f.hiddenFileCount || 0;
                    return (
                      <div key={f.id} className="fx-folder">
                        <button type="button" className="fx-folder-open" onClick={() => setSelectedFolderId(f.id)}>
                          <span className="fx-folder-icon" aria-hidden="true"><Folder size={20} /></span>
                          <span className="fx-folder-copy">
                            <strong title={f.name}>{f.name}</strong>
                            <small>
                              {f.subfolderCount ? `${f.subfolderCount} แฟ้มย่อย · ` : ""}{f.fileCount} ไฟล์
                              {fHidden > 0 ? ` · ซ่อน ${fHidden}` : ""}
                            </small>
                          </span>
                          {f.passwordEnabled && <Lock size={14} className="fx-folder-flag" aria-label="มีรหัสผ่าน" />}
                          {!f.isVisible && <EyeOff size={14} className="fx-folder-flag" aria-label="ซ่อนอยู่" />}
                        </button>
                        <div className="fx-folder-actions">
                          <button type="button" className="fx-icon-btn is-sm" onClick={() => handleOpenCreateFolder(f.id)} title="สร้างแฟ้มย่อย" aria-label={`สร้างแฟ้มย่อยใน ${f.name}`}><FolderPlus size={14} /></button>
                          <button type="button" className="fx-icon-btn is-sm" onClick={() => handleOpenEditFolder(f)} title="แก้ไขแฟ้ม" aria-label={`แก้ไข ${f.name}`}><Pencil size={14} /></button>
                          <button
                            type="button"
                            className="fx-icon-btn is-sm is-danger"
                            onClick={() => {
                              setFolderDeleteTarget(f);
                              setFolderDeleteCascade(false);
                            }}
                            title="ลบแฟ้ม"
                            aria-label={`ลบ ${f.name}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {loading ? (
        <div className="fx-state" aria-busy="true">
          <span className="fsys-loader" />
          <strong>กำลังโหลดรายการไฟล์</strong>
        </div>
      ) : error ? (
        <div className="fx-state">
          <span className="fx-state-icon is-error" aria-hidden="true"><AlertCircle size={24} /></span>
          <strong>โหลดรายการไฟล์ไม่สำเร็จ</strong>
          <p>{error}</p>
          <button type="button" className="fx-btn" onClick={() => loadFiles()}>ลองใหม่</button>
        </div>
      ) : isCategoryRoot ? (
        <section className="fx-section" aria-labelledby="fx-cats-title">
          <header className="fx-section-head">
            <h2 id="fx-cats-title">หมวดหมู่ <span className="fx-count">{visibleCategories.length}</span></h2>
          </header>
          <div className="fx-cats">
            {visibleCategories.map((cat) => {
              const cStats = categoryStatsMap.get(cat.id) || { fileCount: 0, totalBytes: 0, hiddenCount: 0 };
              const isOwner = cat.isOwner;
              const isSystem = !cat.ownerUserId;
              return (
                <div key={cat.id} className={`fx-cat${cat.passwordEnabled ? " is-locked" : ""}`}>
                  <button type="button" className="fx-cat-open" onClick={() => enterCategory(cat)}>
                    <span className="fx-cat-icon" aria-hidden="true">{cat.passwordEnabled ? <Lock size={20} /> : <Layers size={20} />}</span>
                    <span className="fx-cat-copy">
                      <strong title={cat.name}>{cat.name}</strong>
                      <small>{cStats.fileCount.toLocaleString("th-TH")} ไฟล์ · {formatBytes(cStats.totalBytes)}</small>
                    </span>
                    <ChevronRight size={17} className="fx-cat-arrow" aria-hidden="true" />
                  </button>
                  <div className="fx-cat-foot">
                    <span className="fx-tags">
                      {isSystem && <span className="fx-tag">ระบบ</span>}
                      {isOwner && !isSystem && <span className="fx-tag">ส่วนตัว</span>}
                      {!isOwner && !isSystem && <span className="fx-tag is-accent">แชร์</span>}
                      {cat.passwordEnabled && <span className="fx-tag is-warn"><Lock size={11} /> ล็อก</span>}
                      {!cat.isVisible && <span className="fx-tag"><EyeOff size={11} /> ซ่อน</span>}
                      {(cStats.hiddenCount || 0) > 0 && <span className="fx-tag">ซ่อน {cStats.hiddenCount} ไฟล์</span>}
                      {admin && cat.owner && <span className="fx-tag">@{cat.owner}</span>}
                    </span>
                    {(isOwner || admin) && (
                      <span className="fx-cat-actions">
                        <button type="button" className="fx-icon-btn is-sm" onClick={(e) => handleOpenEditCategory(cat, e)} title="แก้ไขหมวดหมู่" aria-label={`แก้ไข ${cat.name}`}><Pencil size={14} /></button>
                        <button type="button" className="fx-icon-btn is-sm is-danger" onClick={(e) => handleOpenDeleteCategory(cat, e)} title="ลบหมวดหมู่" aria-label={`ลบ ${cat.name}`}><Trash2 size={14} /></button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {(uncategorizedStats.fileCount > 0 || visibleCategories.length > 0) && (
              <div className="fx-cat is-plain">
                <button
                  type="button"
                  className="fx-cat-open"
                  onClick={() => {
                    setCategoryFilter("none");
                    setSelectedFolderId(null);
                  }}
                >
                  <span className="fx-cat-icon" aria-hidden="true"><Folder size={20} /></span>
                  <span className="fx-cat-copy">
                    <strong>ไฟล์ไม่ใส่หมวดหมู่</strong>
                    <small>{uncategorizedStats.fileCount.toLocaleString("th-TH")} ไฟล์ · {formatBytes(uncategorizedStats.totalBytes)}</small>
                  </span>
                  <ChevronRight size={17} className="fx-cat-arrow" aria-hidden="true" />
                </button>
                <div className="fx-cat-foot">
                  <span className="fx-tags">
                    <span className="fx-tag">ไฟล์ทั่วไป</span>
                    {uncategorizedStats.hiddenCount > 0 && <span className="fx-tag">ซ่อน {uncategorizedStats.hiddenCount} ไฟล์</span>}
                  </span>
                </div>
              </div>
            )}

            <button type="button" className="fx-cat-new" onClick={handleOpenCreateCategory}>
              <FolderPlus size={20} aria-hidden="true" />
              <span>สร้างหมวดหมู่ใหม่</span>
            </button>
          </div>
        </section>
      ) : !filtered.length ? (
        <div className="fx-state">
          <span className={`fx-state-icon${currentScopeHiddenCount > 0 && !query.trim() ? " is-warn" : ""}`} aria-hidden="true">
            {query.trim() ? <Search size={24} /> : currentScopeHiddenCount > 0 ? <EyeOff size={24} /> : <UploadCloud size={24} />}
          </span>
          <strong>
            {query.trim()
              ? "ไม่พบไฟล์ที่ตรงกับคำค้นหา"
              : currentScopeHiddenCount > 0
              ? selectedFolderId && selectedFolderId > 0 ? "มีไฟล์ถูกซ่อนอยู่ในแฟ้มนี้" : "มีไฟล์ถูกซ่อนอยู่ในหมวดหมู่นี้"
              : selectedFolderId && selectedFolderId > 0
              ? "ยังไม่มีไฟล์ในแฟ้มนี้"
              : categoryFilter !== "all" && categoryFilter !== "browse_all"
              ? "ยังไม่มีไฟล์ในหมวดหมู่นี้"
              : hasFilters
              ? "ไม่พบไฟล์ที่ตรงเงื่อนไข"
              : "ยังไม่มีไฟล์"}
          </strong>
          <p>
            {query.trim()
              ? `ไม่พบ “${query.trim()}” ลองคำอื่น หรือล้างคำค้นหา`
              : currentScopeHiddenCount > 0
              ? `มีไฟล์ที่เจ้าของตั้งซ่อนไว้ ${currentScopeHiddenCount} ไฟล์ คนที่ไม่ใช่เจ้าของจะเปิดไม่ได้`
              : selectedFolderId && selectedFolderId > 0
              ? "อัปโหลดไฟล์เข้าแฟ้มนี้ได้เลย"
              : hasFilters
              ? "ลองเปลี่ยนคำค้นหา หมวดหมู่ หรือประเภทไฟล์"
              : "อัปโหลดไฟล์แรกเพื่อเริ่มใช้พื้นที่เก็บไฟล์"}
          </p>
          {query.trim() ? (
            <button type="button" className="fx-btn" onClick={() => setQuery("")}><X size={15} /> ล้างคำค้นหา</button>
          ) : selectedFolderId && selectedFolderId > 0 ? (
            <button type="button" className="fx-btn fx-btn-primary" onClick={openUpload}><UploadCloud size={16} /> อัปโหลดเข้าแฟ้มนี้</button>
          ) : categoryFilter !== "all" && categoryFilter !== "browse_all" ? (
            <button type="button" className="fx-btn fx-btn-primary" onClick={openUpload}><UploadCloud size={16} /> อัปโหลดเข้าหมวดนี้</button>
          ) : hasFilters ? (
            <button type="button" className="fx-btn" onClick={resetFilters}>ล้างตัวกรองทั้งหมด</button>
          ) : (
            <button type="button" className="fx-btn fx-btn-primary" onClick={openUpload}><UploadCloud size={16} /> อัปโหลดไฟล์แรก</button>
          )}
        </div>
      ) : (
        <section className="fx-section" aria-labelledby="fx-files-title">
          <header className="fx-section-head">
            <h2 id="fx-files-title">{resultsTitle} <span className="fx-count">{filtered.length.toLocaleString("th-TH")}</span></h2>
            <div className="fx-section-tools">
              {query.trim() && (
                <button type="button" className="fx-link-btn" onClick={() => setQuery("")}><X size={14} /> ล้างคำค้นหา</button>
              )}
              <label className="fx-select-all">
                <input type="checkbox" className="fx-check" checked={isAllSelected} onChange={toggleSelectAll} />
                <span>เลือกทั้งหมด</span>
              </label>
            </div>
          </header>

          {viewMode === "grid" ? (
            <div className="fx-grid">
              {filtered.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                const kindInfo = fileKind(item);
                const locked = hiddenByOwner(item);
                return (
                  <article key={item.id} className={`fx-file${!item.isVisible ? " is-dim" : ""}${isSelected ? " is-selected" : ""}`}>
                    <CardThumbnail
                      item={item}
                      isSelected={isSelected}
                      onToggleSelect={() => toggleSelect(item.id)}
                      onPreview={() => previewFile(item)}
                      admin={admin}
                    />
                    <div className="fx-file-body">
                      <button type="button" className="fx-file-name" onClick={() => (locked ? undefined : previewFile(item))} title={item.name} disabled={locked}>
                        {item.name}
                      </button>
                      <p className="fx-file-meta">
                        <span>{kindInfo.label}</span>
                        <span>{formatBytes(item.size)}</span>
                        <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString("th-TH")}>
                          {new Date(item.createdAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}
                        </time>
                      </p>
                      {(item.categoryName || item.folderName || (admin && item.owner)) && (
                        <p className="fx-file-place">
                          {admin && item.owner && <span><UserRound size={12} /> @{item.owner}</span>}
                          {item.categoryName && <span><Tag size={12} /> {item.categoryName}</span>}
                          {item.folderName && <span><Folder size={12} /> {item.folderName}</span>}
                        </p>
                      )}
                    </div>
                    <div className="fx-file-actions">
                      {locked ? (
                        <span className="fx-file-locked"><EyeOff size={14} /> ซ่อนโดยเจ้าของ</span>
                      ) : (
                        <>
                          <button type="button" className="fx-btn fx-btn-sm fx-file-preview" onClick={() => previewFile(item)}>
                            <Eye size={15} /> เปิดดู
                          </button>
                          <button type="button" className="fx-icon-btn" onClick={() => downloadFile(item)} title="ดาวน์โหลด" aria-label={`ดาวน์โหลด ${item.name}`}>
                            <Download size={16} />
                          </button>
                          <button type="button" className={`fx-icon-btn${item.shareEnabled ? " is-on" : ""}`} onClick={() => openShare(item)} title={item.shareEnabled ? "แชร์อยู่" : "แชร์ลิงก์"} aria-label={`แชร์ ${item.name}`}>
                            <Share2 size={16} />
                          </button>
                        </>
                      )}
                      {(admin || item.isOwner) && renderFileMenu(item)}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="fx-table-wrap">
              <table className="fx-table">
                <thead>
                  <tr>
                    <th className="fx-col-check"><span className="fx-sr">เลือก</span></th>
                    <th>ชื่อไฟล์</th>
                    {admin && <th>เจ้าของ</th>}
                    <th>หมวดหมู่ / แฟ้ม</th>
                    <th className="fx-col-num">ขนาด</th>
                    <th>อัปโหลดเมื่อ</th>
                    <th className="fx-col-actions"><span className="fx-sr">จัดการ</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const isSelected = selectedIds.includes(item.id);
                    const kindInfo = fileKind(item);
                    const Icon = kindInfo.icon;
                    const locked = hiddenByOwner(item);
                    return (
                      <tr key={item.id} className={`${isSelected ? "is-selected" : ""}${!item.isVisible ? " is-dim" : ""}`}>
                        <td className="fx-col-check">
                          <input type="checkbox" className="fx-check" checked={isSelected} onChange={() => toggleSelect(item.id)} aria-label={`เลือก ${item.name}`} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="fx-row-file"
                            onClick={() => {
                              if (locked) {
                                flash({ kind: "info", text: "ไฟล์นี้ถูกซ่อนไว้โดยเจ้าของไฟล์" });
                                return;
                              }
                              previewFile(item);
                            }}
                          >
                            <span className={`fx-kind is-${kindInfo.kind}`} aria-hidden="true">{locked ? <EyeOff size={17} /> : <Icon size={17} />}</span>
                            <span className="fx-row-copy">
                              <strong title={item.name}>{item.name}</strong>
                              <small>
                                {locked ? "ซ่อนโดยเจ้าของ" : kindInfo.label}
                                {!item.isVisible && !locked && " · ซ่อนอยู่"}
                                {item.passwordEnabled && " · ล็อก"}
                                {item.shareEnabled && " · แชร์อยู่"}
                              </small>
                            </span>
                          </button>
                        </td>
                        {admin && <td className="fx-col-soft">@{item.owner || "—"}</td>}
                        <td className="fx-col-soft">
                          {item.categoryName || item.folderName ? (
                            <span className="fx-row-place">
                              {item.categoryName && <span><Tag size={12} /> {item.categoryName}</span>}
                              {item.folderName && <span><Folder size={12} /> {item.folderName}</span>}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="fx-col-num">{formatBytes(item.size)}</td>
                        <td className="fx-col-soft">
                          <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString("th-TH", { dateStyle: "medium" })}</time>
                        </td>
                        <td className="fx-col-actions">
                          <span className="fx-row-actions">
                            {!locked && (
                              <>
                                <button type="button" className="fx-icon-btn" onClick={() => previewFile(item)} title="เปิดดู" aria-label={`เปิดดู ${item.name}`}><Eye size={16} /></button>
                                <button type="button" className="fx-icon-btn" onClick={() => downloadFile(item)} title="ดาวน์โหลด" aria-label={`ดาวน์โหลด ${item.name}`}><Download size={16} /></button>
                                <button type="button" className={`fx-icon-btn${item.shareEnabled ? " is-on" : ""}`} onClick={() => openShare(item)} title="แชร์ลิงก์" aria-label={`แชร์ ${item.name}`}><Share2 size={16} /></button>
                              </>
                            )}
                            {(admin || item.isOwner) && renderFileMenu(item)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Multi-Selection Batch Actions Dock */}
      {selectedIds.length > 0 && (
        <aside className="fsys-batch-dock" role="region" aria-label="จัดการไฟล์ที่เลือก">
          <div className="fsys-batch-info">
            <span className="fsys-batch-count">
              <CheckSquare size={16} />
              <span>เลือกแล้ว <strong>{selectedIds.length}</strong> รายการ</span>
            </span>
            {selectedIds.length < filtered.length && (
              <button
                type="button"
                className="fsys-batch-select-all-btn"
                onClick={() => setSelectedIds(filtered.map((i) => i.id))}
              >
                เลือกทั้งหมด ({filtered.length})
              </button>
            )}
          </div>

          <div className="fsys-batch-actions">
            {admin && (
              <>
                <button
                  type="button"
                  className="fsys-batch-btn"
                  onClick={() => setBatchCategoryModalOpen(true)}
                  disabled={batchBusy}
                  title="เปลี่ยนหมวดหมู่ให้กับไฟล์ที่เลือก"
                >
                  <FolderInput size={15} />
                  <span>ย้ายหมวดหมู่</span>
                </button>

                <button
                  type="button"
                  className="fsys-batch-btn"
                  onClick={() => {
                    setBatchTargetFolder("root");
                    setBatchFolderModalOpen(true);
                  }}
                  disabled={batchBusy}
                  title="ย้ายไฟล์ที่เลือกเข้าแฟ้ม"
                >
                  <Folder size={15} />
                  <span>ย้ายเข้าแฟ้ม</span>
                </button>

                <button
                  type="button"
                  className="fsys-batch-btn"
                  onClick={() => void handleBatchVisibility(true)}
                  disabled={batchBusy}
                  title="ตั้งค่าให้แสดงในคลัง"
                >
                  <Eye size={15} />
                  <span>แสดง</span>
                </button>

                <button
                  type="button"
                  className="fsys-batch-btn"
                  onClick={() => void handleBatchVisibility(false)}
                  disabled={batchBusy}
                  title="ตั้งค่าให้ซ่อนจากคลัง"
                >
                  <EyeOff size={15} />
                  <span>ซ่อน</span>
                </button>
              </>
            )}

            <button
              type="button"
              className="fsys-batch-btn"
              onClick={() => void handleBatchDownload()}
              disabled={batchBusy}
              title="ดาวน์โหลดไฟล์ที่เลือกทั้งหมด"
            >
              <Download size={15} />
              <span>ดาวน์โหลด</span>
            </button>

            <button
              type="button"
              className="fsys-batch-btn is-danger"
              onClick={() => setBatchDeleteModalOpen(true)}
              disabled={batchBusy}
              title="ลบไฟล์ที่เลือกทั้งหมด"
            >
              <Trash2 size={15} />
              <span>ลบ ({selectedIds.length})</span>
            </button>

            <button
              type="button"
              className="fsys-batch-close"
              onClick={clearSelection}
              title="ยกเลิกการเลือก"
              aria-label="ยกเลิกการเลือก"
            >
              <X size={16} />
            </button>
          </div>
        </aside>
      )}

      {/* File transfer progress */}
      {fileTransfer && !previewSwitching && (
        <div className="fl-transfer-backdrop" role="presentation">
          <section
            className="fl-transfer-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fl-transfer-title"
            aria-describedby="fl-transfer-detail"
          >
            <div className={`fl-transfer-icon ${fileTransfer.mode}`} aria-hidden="true">
              {fileTransfer.mode === "preview" ? <Eye size={24} /> : <Download size={24} />}
            </div>
            <div className="fl-transfer-copy">
              <span>{fileTransfer.mode === "preview" ? "กำลังเปิดตัวอย่างไฟล์" : "กำลังดาวน์โหลดไฟล์"}</span>
              <strong id="fl-transfer-title" title={fileTransfer.item.name}>{fileTransfer.item.name}</strong>
            </div>
            <div className="fl-transfer-progress-head" aria-live="polite">
              <strong>{fileTransfer.percent}%</strong>
              <span>{fileTransfer.phase === "processing" ? "กำลังเตรียมไฟล์..." : "กรุณารอสักครู่"}</span>
            </div>
            <div
              className="fl-transfer-progress-track"
              role="progressbar"
              aria-label={fileTransfer.mode === "preview" ? "ความคืบหน้าการเปิดไฟล์" : "ความคืบหน้าการดาวน์โหลด"}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fileTransfer.percent}
            >
              <i style={{ width: `${fileTransfer.percent}%` }} />
            </div>
            <div className="fl-transfer-detail" id="fl-transfer-detail">
              <span>{formatBytes(fileTransfer.loadedBytes)} / {formatBytes(fileTransfer.totalBytes)}</span>
              <span>{fileTransfer.mode === "preview" ? "โหลดเสร็จแล้วจะแสดงให้อัตโนมัติ" : "โหลดเสร็จแล้วระบบจะบันทึกไฟล์ให้อัตโนมัติ"}</span>
            </div>
            {fileTransfer.phase === "loading" && (
              <button type="button" className="fl-transfer-cancel" onClick={cancelFileTransfer} autoFocus>
                ยกเลิก
              </button>
            )}
          </section>
        </div>
      )}

      {/* Rich Multi-Format Preview Modal */}
      {preview && (
        <div
          className="fl-preview-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              if (preview.url) URL.revokeObjectURL(preview.url);
              setPreview(null);
            }
          }}
        >
          <section className="fl-preview-modal-box" role="dialog" aria-modal="true" aria-label={`ตัวอย่าง ${preview.item.name}`}>
            <header className="fl-preview-modal-header">
              <div className="fl-preview-title-wrap">
                <span className="fl-preview-type-icon">
                  {(() => {
                    const KIcon = fileKind(preview.item).icon;
                    return <KIcon size={18} />;
                  })()}
                </span>
                <div className="fl-preview-title-info">
                  <strong title={preview.item.name}>{preview.item.name}</strong>
                  <div className="fl-preview-submeta">
                    <span className="fl-preview-meta-pill">{formatBytes(preview.item.size)}</span>
                    <span className="fl-preview-meta-dot">·</span>
                    <span className="fl-preview-meta-pill">{fileKind(preview.item).label}</span>
                    {previewList.length > 1 && previewIndex >= 0 && (
                      <>
                        <span className="fl-preview-meta-dot">·</span>
                        <span className="fl-preview-meta-pill fl-preview-position">{previewIndex + 1} / {previewList.length}</span>
                      </>
                    )}
                    {preview.item.owner && (
                      <>
                        <span className="fl-preview-meta-dot">·</span>
                        <span className="fl-preview-meta-pill">@{preview.item.owner}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="fl-preview-header-actions">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fl-preview-tool-btn"
                  title="เปิดในแท็บใหม่"
                  aria-label="เปิดในแท็บใหม่"
                >
                  <ExternalLink size={15} />
                </a>
                {preview.kind === "pdf" && (
                  <button
                    type="button"
                    className="fl-preview-tool-btn"
                    onClick={() => {
                      const iframe = document.querySelector<HTMLIFrameElement>(".fl-preview-pdf-stage iframe");
                      if (iframe?.contentWindow) {
                        try {
                          iframe.contentWindow.focus();
                          iframe.contentWindow.print();
                        } catch {
                          window.open(preview.url, "_blank");
                        }
                      } else {
                        window.open(preview.url, "_blank");
                      }
                    }}
                    title="พิมพ์เอกสาร"
                    aria-label="พิมพ์เอกสาร"
                  >
                    <Printer size={15} />
                  </button>
                )}
                {(admin || preview.item.isOwner) && (
                  <button
                    type="button"
                    className={`fl-preview-tool-btn ${!preview.item.isVisible ? "is-hidden" : ""}`}
                    onClick={async () => {
                      await toggleVisibility(preview.item);
                      setPreview((prev) => prev ? { ...prev, item: { ...prev.item, isVisible: !prev.item.isVisible } } : null);
                    }}
                    title={preview.item.isVisible ? "คลิกเพื่อซ่อนไฟล์นี้" : "คลิกเพื่อแสดงไฟล์นี้"}
                    aria-label={preview.item.isVisible ? "ซ่อนไฟล์" : "แสดงไฟล์"}
                  >
                    {preview.item.isVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                    <span className="fl-preview-btn-label">{preview.item.isVisible ? "ซ่อนไฟล์" : "แสดงไฟล์"}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="fl-preview-tool-btn primary"
                  onClick={() => downloadFile(preview.item, preview.password)}
                  title="ดาวน์โหลดไฟล์"
                >
                  <Download size={15} />
                  <span className="fl-preview-btn-label">ดาวน์โหลด</span>
                </button>
                <button
                  type="button"
                  className="fl-preview-tool-btn fl-preview-close-btn"
                  onClick={() => {
                    if (preview.url) URL.revokeObjectURL(preview.url);
                    setPreview(null);
                  }}
                  title="ปิด"
                  aria-label="ปิด"
                >
                  <X size={17} />
                </button>
              </div>
            </header>

            {previewList.length > 1 && (
              <>
                <button type="button" className="fl-preview-nav is-prev" onClick={() => stepPreview(previewPrev)} disabled={!previewPrev || previewSwitching} aria-label="ไฟล์ก่อนหน้า" title="ไฟล์ก่อนหน้า (←)">
                  <ChevronLeft size={22} aria-hidden="true" />
                </button>
                <button type="button" className="fl-preview-nav is-next" onClick={() => stepPreview(previewNext)} disabled={!previewNext || previewSwitching} aria-label="ไฟล์ถัดไป" title="ไฟล์ถัดไป (→)">
                  <ChevronRight size={22} aria-hidden="true" />
                </button>
              </>
            )}
            {previewSwitching && (
              <span className="fl-preview-switching" role="status" aria-label="กำลังเปิดไฟล์ถัดไป">
                <span className="fcs-btn-spin" aria-hidden="true" />
                {fileTransfer && fileTransfer.percent > 0 && <small>{fileTransfer.percent}%</small>}
              </span>
            )}

            <div
              className="fl-preview-modal-stage"
              onTouchStart={preview.kind === "pdf" || preview.kind === "video" || preview.textContent !== undefined ? undefined : (event) => { swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
              onTouchEnd={preview.kind === "pdf" || preview.kind === "video" || preview.textContent !== undefined ? undefined : onPreviewTouchEnd}
            >
              {preview.kind === "image" ? (
                <div className="fl-preview-image-stage">
                  <img src={preview.url} alt={preview.item.name} />
                </div>
              ) : preview.kind === "video" ? (
                <div className="fl-preview-video-stage">
                  <video src={preview.url} controls autoPlay />
                </div>
              ) : preview.kind === "audio" ? (
                <div className="fl-preview-audio-stage">
                  <div className="fl-preview-audio-disc">
                    <FileAudio size={48} />
                  </div>
                  <strong className="fl-preview-audio-name">{preview.item.name}</strong>
                  <audio src={preview.url} controls autoPlay />
                </div>
              ) : preview.kind === "pdf" ? (
                <PdfPreview key={preview.url} url={preview.url} title={preview.item.name} />
              ) : preview.textContent !== undefined ? (
                <div className="fl-preview-code-stage">
                  <pre className="fl-code-block">
                    <code>{preview.textContent || "(ไฟล์ว่างเปล่า)"}</code>
                  </pre>
                </div>
              ) : (
                <div className="fl-preview-fallback-stage">
                  {preview.kind === "archive" ? (
                    <FileArchive size={46} />
                  ) : (
                    <FileText size={46} />
                  )}
                  <div className="fl-preview-fallback-text">
                    <strong className="fl-preview-fallback-title">
                      {preview.kind === "archive" ? "ไฟล์บีบอัด (Archive)" : "ไม่สามารถแสดงตัวอย่างบนเบราว์เซอร์ได้"}
                    </strong>
                    <p className="fl-preview-fallback-desc">
                      {preview.kind === "archive"
                        ? "เบราว์เซอร์ไม่สามารถเปิดดูไฟล์ภายในแพ็กเกจนี้ได้โดยตรง กรุณาดาวน์โหลดเพื่อแตกไฟล์และใช้งานบนอุปกรณ์ของคุณ"
                        : "ไฟล์ประเภทนี้จำเป็นต้องใช้โปรแกรมเฉพาะทางบนอุปกรณ์ของคุณในการเปิดอ่าน (เช่น Microsoft Office หรือโปรแกรมเฉพาะ)"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="fl-upload-btn"
                    onClick={() => downloadFile(preview.item, preview.password)}
                  >
                    <Download size={15} />
                    <span>{preview.kind === "archive" ? "ดาวน์โหลดไฟล์บีบอัด" : "ดาวน์โหลดเพื่อเปิดดู"}</span>
                  </button>
                </div>
              )}
            </div>

            <footer className="fl-preview-modal-footer">
              <div className="fl-preview-footer-chips">
                {preview.item.categoryName && (
                  <span className="fl-footer-chip">
                    <Tag size={12} />
                    <span>{preview.item.categoryName}</span>
                  </span>
                )}
                <span className="fl-footer-chip">
                  <Clock size={12} />
                  <span>{new Date(preview.item.createdAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}</span>
                </span>
                {!preview.item.isVisible && (
                  <span className="fl-footer-chip is-hidden">
                    <EyeOff size={12} />
                    <span>ซ่อนจากคลัง</span>
                  </span>
                )}
                {preview.item.passwordEnabled && (
                  <span className="fl-footer-chip is-locked">
                    <Lock size={12} />
                    <span>ล็อกรหัสผ่าน</span>
                  </span>
                )}
              </div>
            </footer>
          </section>
        </div>
      )}

      {scopeShareOpen && currentShareScope && (
        <ScopeShareDialog
          key={`${currentShareScope.kind}-${currentShareScope.id}`}
          scope={currentShareScope}
          admin={admin}
          notify={flash}
          onClose={() => setScopeShareOpen(false)}
          onChanged={() => {
            void loadCategories();
            if (selectedCategoryId) void loadFolders(selectedCategoryId);
          }}
        />
      )}

      {/* Share Link Modal */}
      {shareTarget && (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !shareBusy) setShareTarget(null); }}>
          <section className="file-modal" role="dialog" aria-modal="true" aria-labelledby="file-share-title">
            <header>
              <span><Share2 size={20} /></span>
              <div><h2 id="file-share-title">แชร์ลิงก์ดาวน์โหลด</h2><p>{shareTarget.name}</p></div>
              <button type="button" onClick={() => setShareTarget(null)} disabled={shareBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <div style={{ padding: "16px 20px" }}>
              {shareTarget.shareEnabled && shareTarget.shareUrl ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <label className="file-modal-field">
                    <span>ลิงก์สาธารณะ</span>
                    <input
                      type="text"
                      readOnly
                      value={typeof window !== "undefined" ? `${window.location.origin}${shareTarget.shareUrl}` : shareTarget.shareUrl}
                    />
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      className="fl-card-btn-primary"
                      onClick={() => {
                        const full = typeof window !== "undefined" ? `${window.location.origin}${shareTarget.shareUrl}` : shareTarget.shareUrl;
                        if (full) navigator.clipboard.writeText(full);
                        flash({ kind: "success", text: "คัดลอกลิงก์เรียบร้อยแล้ว" });
                      }}
                    >
                      <Copy size={16} /> คัดลอกลิงก์
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => revokeShareLink(shareTarget)}
                      disabled={shareBusy}
                    >
                      ยกเลิกลิงก์แชร์
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <label className="file-modal-field">
                    <span>อายุลิงก์</span>
                    <select value={shareExpiresIn} onChange={(e) => setShareExpiresIn(e.target.value)} disabled={shareBusy}>
                      <option value="1d">1 วัน</option>
                      <option value="7d">7 วัน</option>
                      <option value="30d">30 วัน</option>
                      <option value="never">ไม่มีวันหมดอายุ</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="fl-upload-btn"
                    onClick={() => {
                      if (shareTarget) {
                        void fetch(`${API_BASE}${shareEndpoint(shareTarget.id)}`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          credentials: "include",
                          body: JSON.stringify({ expiresIn: shareExpiresIn }),
                        }).then(async (res) => {
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) throw new Error(data.error || "สร้างลิงก์แชร์ไม่สำเร็จ");
                          flash({ kind: "success", text: "สร้างลิงก์แชร์เรียบร้อยแล้ว" });
                          setShareTarget(null);
                          await loadFiles();
                        }).catch((err) => {
                          flash({ kind: "error", text: err instanceof Error ? err.message : "สร้างลิงก์แชร์ไม่สำเร็จ" });
                        });
                      }
                    }}
                    disabled={shareBusy}
                  >
                    <Share2 size={16} /> {shareBusy ? "กำลังสร้าง..." : "สร้างลิงก์แชร์สาธารณะ"}
                  </button>
                </div>
              )}
            </div>
            <footer>
              <button type="button" className="secondary" onClick={() => setShareTarget(null)} disabled={shareBusy}>ปิด</button>
            </footer>
          </section>
        </div>
      )}

      {/* Batch Delete Modal */}
      {batchDeleteModalOpen && (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !batchBusy) setBatchDeleteModalOpen(false); }}>
          <section className="file-modal file-delete-modal" role="alertdialog" aria-modal="true">
            <header>
              <span className="danger"><Trash2 size={20} /></span>
              <div>
                <h2>ยืนยันลบหลายรายการ</h2>
                <p>รายการเหล่านี้จะไม่สามารถกู้คืนได้</p>
              </div>
              <button type="button" onClick={() => setBatchDeleteModalOpen(false)} disabled={batchBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <p className="file-delete-message">
              ลบไฟล์ที่เลือก <strong>{selectedIds.length} รายการ</strong> ใช่ไหม?
            </p>
            <footer>
              <button type="button" className="secondary" onClick={() => setBatchDeleteModalOpen(false)} disabled={batchBusy}>ยกเลิก</button>
              <button type="button" className="danger-button" onClick={() => void handleBatchDelete()} disabled={batchBusy}>
                <Trash2 size={17} /> {batchBusy ? "กำลังลบ..." : `ยืนยันลบ ${selectedIds.length} ไฟล์`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Batch Category Modal */}
      {batchCategoryModalOpen && (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !batchBusy) setBatchCategoryModalOpen(false); }}>
          <section className="file-modal" role="dialog" aria-modal="true" aria-labelledby="batch-cat-title">
            <header>
              <span><FolderInput size={20} /></span>
              <div>
                <h2 id="batch-cat-title">ย้ายหมวดหมู่หลายรายการ</h2>
                <p>เปลี่ยนหมวดหมู่สำหรับ {selectedIds.length} ไฟล์ที่เลือก</p>
              </div>
              <button type="button" onClick={() => setBatchCategoryModalOpen(false)} disabled={batchBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <div style={{ padding: "16px 20px" }}>
              <label className="file-modal-field">
                <span>เลือกหมวดหมู่ใหม่</span>
                <select value={batchTargetCategory} onChange={(e) => setBatchTargetCategory(e.target.value)} disabled={batchBusy}>
                  <option value="none">ไม่มีหมวดหมู่ (ล้างหมวดหมู่)</option>
                  {visibleCategories.map((cat) => <option key={cat.id} value={String(cat.id)}>{cat.name}</option>)}
                </select>
              </label>
            </div>
            <footer>
              <button type="button" className="secondary" onClick={() => setBatchCategoryModalOpen(false)} disabled={batchBusy}>ยกเลิก</button>
              <button type="button" className="primary" onClick={() => void handleBatchCategory()} disabled={batchBusy}>
                <FolderInput size={17} /> {batchBusy ? "กำลังบันทึก..." : `ย้าย ${selectedIds.length} ไฟล์`}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (() => {
        const waiting = uploadQueue.filter((item) => item.status === "ready" || (item.status === "error" && !item.blocked));
        const sent = uploadQueue.filter((item) => item.status === "done").length;
        const active = uploadQueue.filter((item) => !item.blocked);
        const totalBytes = active.reduce((sum, item) => sum + item.file.size, 0);
        const sentBytes = active.reduce((sum, item) => sum + (item.status === "done" ? item.file.size : item.status === "uploading" ? (item.file.size * item.progress) / 100 : 0), 0);
        const overall = totalBytes ? Math.round((sentBytes / totalBytes) * 100) : 0;
        const position = uploadQueue.findIndex((item) => item.status === "uploading");
        const retrying = !uploading && waiting.length > 0 && waiting.every((item) => item.status === "error");
        return (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeUpload(); }}>
          <section className="file-modal file-upload-modal" role="dialog" aria-modal="true" aria-labelledby="file-upload-title">
            <header>
              <span><UploadCloud size={20} /></span>
              <div><h2 id="file-upload-title">อัปโหลดไฟล์</h2><p>เลือกได้ครั้งละ {MAX_UPLOAD_BATCH} ไฟล์ · ไฟล์ละไม่เกิน {formatBytes(result?.maxFileBytes || 50 * 1024 * 1024)}</p></div>
              <button type="button" onClick={closeUpload} disabled={uploading} aria-label="ปิด"><X size={18} /></button>
            </header>
            <div
              className={`file-dropzone ${dragging ? "dragging" : ""} ${uploadQueue.length ? "compact" : ""}`}
              onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !uploading && inputRef.current?.click()}
              role="button"
              tabIndex={uploading ? -1 : 0}
              aria-disabled={uploading}
              onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !uploading) { e.preventDefault(); inputRef.current?.click(); } }}
            >
              <input ref={inputRef} type="file" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { addUploadFiles(e.target.files); e.target.value = ""; }} />
              {uploadQueue.length ? (
                <><span><Plus size={18} /></span><strong>เพิ่มไฟล์</strong><small>คลิกหรือลากไฟล์มาวางเพิ่ม</small></>
              ) : (
                <><span><UploadCloud size={28} /></span><strong>วางไฟล์ที่นี่</strong><small>หรือคลิกเพื่อเลือก เลือกได้หลายไฟล์พร้อมกัน</small></>
              )}
            </div>
            {uploadQueue.length > 0 && (
              <div className="file-upload-queue">
                <div className="file-upload-queue-head" aria-live="polite">
                  <span>{uploading ? `กำลังอัปโหลด ${position + 1}/${active.length}` : `${uploadQueue.length} ไฟล์ · ${formatBytes(uploadQueue.reduce((sum, item) => sum + item.file.size, 0))}`}</span>
                  {uploading ? <strong>{overall}%</strong> : sent > 0 ? <strong className="is-ok">สำเร็จ {sent}</strong> : null}
                </div>
                {uploading && <div className="file-upload-queue-bar"><i style={{ width: `${overall}%` }} /></div>}
                <ul>
                  {uploadQueue.map((item) => (
                    <li key={item.id} className={`is-${item.status}`}>
                      <span className="file-upload-queue-icon" aria-hidden="true">
                        {item.status === "done" ? <CheckCircle2 size={17} /> : item.status === "error" ? <AlertCircle size={17} /> : <FileText size={17} />}
                      </span>
                      <span className="file-upload-queue-main">
                        <strong title={item.file.name}>{item.file.name}</strong>
                        <small>{item.status === "error" ? item.error : item.status === "done" ? "อัปโหลดแล้ว" : item.status === "uploading" ? `${item.progress}% · ${formatBytes(item.file.size)}` : formatBytes(item.file.size)}</small>
                        {item.status === "uploading" && <span className="file-upload-queue-item-bar"><i style={{ width: `${item.progress}%` }} /></span>}
                      </span>
                      {!uploading && item.status !== "done" && (
                        <button type="button" onClick={() => removeUploadItem(item.id)} aria-label={`เอา ${item.file.name} ออก`} title="เอาออก"><X size={15} /></button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {visibleCategories.length > 0 && (
              <label className="file-modal-field">
                <span>หมวดหมู่ (ไม่บังคับ)</span>
                <select
                  value={uploadCategoryId}
                  onChange={(e) => {
                    setUploadCategoryId(e.target.value);
                    setUploadFolderId("");
                  }}
                  disabled={uploading}
                >
                  <option value="">ไม่ระบุหมวดหมู่</option>
                  {visibleCategories.map((cat) => (
                    <option key={cat.id} value={String(cat.id)}>{cat.name}</option>
                  ))}
                </select>
              </label>
            )}
            {uploadCategoryId && uploadHierarchicalFolders.length > 0 && (
              <label className="file-modal-field">
                <span>แฟ้มในหมวดหมู่ (ไม่บังคับ)</span>
                <select
                  value={uploadFolderId}
                  onChange={(e) => setUploadFolderId(e.target.value)}
                  disabled={uploading}
                >
                  <option value="">ไม่ใส่แฟ้ม (หน้าหลักของหมวดหมู่)</option>
                  {uploadHierarchicalFolders.map((f) => (
                    <option key={f.id} value={String(f.id)}>
                      {f.label} {f.passwordEnabled ? "(มีรหัสผ่าน)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="file-upload-policy"><ShieldCheck size={16} /><span>ระบบจะตรวจประเภทไฟล์ก่อนบันทึก</span></div>
            <footer>
              {uploading
                ? <button type="button" className="secondary" onClick={stopUpload}>หยุด</button>
                : <button type="button" className="secondary" onClick={closeUpload}>{sent > 0 ? "ปิด" : "ยกเลิก"}</button>}
              <button type="button" className="primary" onClick={() => void uploadFiles()} disabled={!waiting.length || uploading}>
                <UploadCloud size={17} /> {uploading ? `กำลังอัปโหลด ${position + 1}/${active.length}` : retrying ? `ลองอีกครั้ง ${waiting.length} ไฟล์` : waiting.length > 1 ? `อัปโหลด ${waiting.length} ไฟล์` : "อัปโหลด"}
              </button>
            </footer>
          </section>
        </div>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <section className="file-modal file-delete-modal" role="alertdialog" aria-modal="true">
            <header>
              <span className="danger"><Trash2 size={20} /></span>
              <div><h2>ลบไฟล์นี้?</h2><p>รายการนี้จะไม่สามารถกู้คืนได้</p></div>
              <button type="button" onClick={() => setDeleteTarget(null)} aria-label="ปิด"><X size={18} /></button>
            </header>
            <div className="file-delete-name">{deleteTarget.name}</div>
            <footer>
              <button type="button" className="secondary" onClick={() => setDeleteTarget(null)}>ยกเลิก</button>
              <button type="button" className="danger-button" onClick={deleteFile}><Trash2 size={17} /> ลบไฟล์</button>
            </footer>
          </section>
        </div>
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !actionBusy) setRenameTarget(null); }}>
          <form className="file-modal" role="dialog" aria-modal="true" aria-labelledby="file-rename-title" onSubmit={saveRename}>
            <header>
              <span><Pencil size={20} /></span>
              <div><h2 id="file-rename-title">เปลี่ยนชื่อไฟล์</h2><p>นามสกุลไฟล์ถูกล็อกไว้</p></div>
              <button type="button" onClick={() => setRenameTarget(null)} disabled={actionBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <label className="file-modal-field">
              <span>ชื่อไฟล์</span>
              <div className="file-rename-row">
                <input type="text" value={renameBase} onChange={(e) => setRenameBase(e.target.value)} autoFocus required />
                <span className="file-ext-lock">{splitName(renameTarget.name).ext || "—"}</span>
              </div>
            </label>
            <footer>
              <button type="button" className="secondary" onClick={() => setRenameTarget(null)} disabled={actionBusy}>ยกเลิก</button>
              <button type="submit" className="primary" disabled={actionBusy || !renameBase.trim()}>{actionBusy ? "กำลังบันทึก" : "บันทึก"}</button>
            </footer>
          </form>
        </div>
      )}

      {/* Category Modal */}
      {categoryTarget && (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !actionBusy) setCategoryTarget(null); }}>
          <form className="file-modal" role="dialog" aria-modal="true" aria-labelledby="file-category-title" onSubmit={saveCategory}>
            <header>
              <span><Tag size={20} /></span>
              <div><h2 id="file-category-title">ตั้งหมวดหมู่</h2><p>{categoryTarget.name}</p></div>
              <button type="button" onClick={() => setCategoryTarget(null)} disabled={actionBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <label className="file-modal-field">
              <span>หมวดหมู่</span>
              <select value={categoryValue} onChange={(e) => setCategoryValue(e.target.value)}>
                <option value="">ไม่มีหมวดหมู่</option>
                {categories.map((cat) => <option key={cat.id} value={String(cat.id)}>{cat.name}{!cat.isVisible ? " (ซ่อน)" : ""}</option>)}
              </select>
            </label>
            <footer>
              <button type="button" className="secondary" onClick={() => setCategoryTarget(null)} disabled={actionBusy}>ยกเลิก</button>
              <button type="submit" className="primary" disabled={actionBusy}>{actionBusy ? "กำลังบันทึก" : "บันทึก"}</button>
            </footer>
          </form>
        </div>
      )}

      {/* Password Modal */}
      {passwordTarget && (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !actionBusy) setPasswordTarget(null); }}>
          <form className="file-modal" role="dialog" aria-modal="true" aria-labelledby="file-pw-admin-title" onSubmit={savePassword} autoComplete="off">
            {/* Hidden dummy fields to intercept browser credential autofill */}
            <input
              type="text"
              name="prevent_autofill_user_file"
              tabIndex={-1}
              autoComplete="username"
              style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none", zIndex: -1 }}
              aria-hidden="true"
            />
            <input
              type="password"
              name="prevent_autofill_pass_file"
              tabIndex={-1}
              autoComplete="current-password"
              style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none", zIndex: -1 }}
              aria-hidden="true"
            />

            <header>
              <span><KeyRound size={20} /></span>
              <div><h2 id="file-pw-admin-title">รหัสผ่านดาวน์โหลด</h2><p>{passwordTarget.name}</p></div>
              <button type="button" onClick={() => setPasswordTarget(null)} disabled={actionBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <button
              type="button"
              className={`store-cat-toggle ${passwordEnable ? "on" : ""}`}
              onClick={() => setPasswordEnable(!passwordEnable)}
            >
              <div className="store-cat-toggle-left">
                <span className="store-cat-icon-badge">
                  <Lock size={16} />
                </span>
                <span className="store-cat-toggle-copy">
                  <strong>ล็อกการดาวน์โหลด</strong>
                  <small>ต้องใส่รหัสก่อนดาวน์โหลดหรือดูตัวอย่าง</small>
                </span>
              </div>
              <span className="store-cat-switch" aria-hidden="true" />
            </button>
            {passwordEnable && (
              <label className="file-modal-field">
                <span>{passwordTarget.passwordEnabled ? "รหัสผ่านใหม่ (ว่างไว้หากไม่เปลี่ยน)" : "รหัสผ่าน"}</span>
                <input
                  type="password"
                  name="file_security_password"
                  value={passwordNew}
                  onChange={(e) => setPasswordNew(e.target.value)}
                  minLength={4}
                  placeholder="อย่างน้อย 4 ตัวอักษร"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  autoFocus
                />
              </label>
            )}
            <footer>
              <button type="button" className="secondary" onClick={() => setPasswordTarget(null)} disabled={actionBusy}>ยกเลิก</button>
              <button type="submit" className="primary" disabled={actionBusy}>{actionBusy ? "กำลังบันทึก" : "บันทึก"}</button>
            </footer>
          </form>
        </div>
      )}

      {/* Password Prompt for Download/Preview */}
      {passwordPrompt && (
        <div className="file-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !passwordBusy) setPasswordPrompt(null); }}>
          <form className="file-modal" role="dialog" aria-modal="true" aria-labelledby="file-password-title" onSubmit={submitPassword} autoComplete="off">
            <header>
              <span><Lock size={20} /></span>
              <div>
                <h2 id="file-password-title">ต้องใช้รหัสผ่าน</h2>
                <p>ใส่รหัสผ่านเพื่อ{passwordPrompt.mode === "preview" ? "ดูตัวอย่าง" : "ดาวน์โหลด"}ไฟล์นี้</p>
              </div>
              <button type="button" onClick={() => setPasswordPrompt(null)} disabled={passwordBusy} aria-label="ปิด"><X size={18} /></button>
            </header>
            <div className="file-delete-name">{passwordPrompt.item.name}</div>
            <label className="file-modal-field">
              <span>รหัสผ่าน</span>
              <input
                type="password"
                name="file_verify_auth_code"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (passwordError) setPasswordError("");
                }}
                autoComplete="one-time-code"
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                autoFocus
                required
                minLength={1}
              />
            </label>
            {passwordError && (
              <div style={{ color: "#ef4444", fontSize: "13px", padding: "0 20px 8px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>{passwordError}</span>
              </div>
            )}
            <footer>
              <button type="button" className="secondary" onClick={() => setPasswordPrompt(null)} disabled={passwordBusy}>ยกเลิก</button>
              <button type="submit" className="primary" disabled={passwordBusy || !passwordInput}>{passwordBusy ? "กำลังตรวจสอบ" : "ยืนยัน"}</button>
            </footer>
          </form>
        </div>
      )}

      {/* Folder Create / Edit Modal */}
      {folderModal && (
        <div
          className="file-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !folderBusy) setFolderModal(null);
          }}
        >
          <form
            className="file-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fl-folder-modal-title"
            onSubmit={handleSaveFolder}
            autoComplete="off"
          >
            {/* Hidden dummy fields to intercept browser credential autofill */}
            <input
              type="text"
              name="prevent_autofill_user_folder"
              tabIndex={-1}
              autoComplete="username"
              style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none", zIndex: -1 }}
              aria-hidden="true"
            />
            <input
              type="password"
              name="prevent_autofill_pass_folder"
              tabIndex={-1}
              autoComplete="current-password"
              style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none", zIndex: -1 }}
              aria-hidden="true"
            />

            <header>
              <span><Folder size={20} /></span>
              <div>
                <h2 id="fl-folder-modal-title">
                  {folderModal.mode === "create"
                    ? folderModal.parentId
                      ? "สร้างแฟ้มย่อย"
                      : "สร้างแฟ้มใหม่"
                    : "แก้ไขแฟ้ม"}
                </h2>
                <p>
                  {(() => {
                    const catName = categories.find((c) => String(c.id) === categoryFilter)?.name || "หมวดหมู่นี้";
                    if (folderModal.parentId) {
                      const parentFolder = folders.find((f) => f.id === folderModal.parentId);
                      return `สร้างใน: ${catName} > ${parentFolder?.name || `แฟ้ม #${folderModal.parentId}`}`;
                    }
                    return `หมวดหมู่: ${catName}`;
                  })()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFolderModal(null)}
                disabled={folderBusy}
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </header>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <label className="file-modal-field">
                <span>ชื่อแฟ้ม</span>
                <input
                  type="text"
                  name="folder_display_title"
                  value={folderForm.name}
                  onChange={(e) => setFolderForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="เช่น เอกสารงวด 1, รูปภาพงานเลี้ยง..."
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  autoFocus
                  required
                />
              </label>

              {folderModal.mode === "edit" && (
                <label className="file-modal-field">
                  <span>ตำแหน่งแฟ้มหลัก</span>
                  <select
                    value={folderModal.parentId ? String(folderModal.parentId) : "root"}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFolderModal((prev) =>
                        prev ? { ...prev, parentId: v === "root" ? null : parseInt(v, 10) } : null,
                      );
                    }}
                  >
                    <option value="root">ไม่ใส่แฟ้มแม่ (หน้าหลักของหมวดหมู่)</option>
                    {currentHierarchicalFolders
                      .filter((hf) => hf.id !== folderModal.folder?.id)
                      .map((hf) => (
                        <option key={hf.id} value={String(hf.id)}>
                          {hf.label}
                        </option>
                      ))}
                  </select>
                </label>
              )}

              <button
                type="button"
                className={`store-cat-toggle ${folderForm.isVisible ? "on" : ""}`}
                onClick={() => setFolderForm((prev) => ({ ...prev, isVisible: !prev.isVisible }))}
              >
                <div className="store-cat-toggle-left">
                  <span className="store-cat-icon-badge">
                    {folderForm.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </span>
                  <span className="store-cat-toggle-copy">
                    <strong>แสดงแฟ้มนี้ในคลัง</strong>
                    <small>{folderForm.isVisible ? "เจ้าของและลิงก์แชร์ที่ได้รับอนุญาตจะเห็นแฟ้มนี้" : "เจ้าของและผู้ดูแลยังเห็นแฟ้มพร้อมป้ายซ่อน"}</small>
                  </span>
                </div>
                <span className="store-cat-switch" aria-hidden="true" />
              </button>

              <button
                type="button"
                className={`store-cat-toggle ${folderForm.passwordEnabled ? "on" : ""}`}
                onClick={() =>
                  setFolderForm((prev) => ({ ...prev, passwordEnabled: !prev.passwordEnabled }))
                }
              >
                <div className="store-cat-toggle-left">
                  <span className="store-cat-icon-badge">
                    <Lock size={16} />
                  </span>
                  <span className="store-cat-toggle-copy">
                    <strong>ตั้งรหัสผ่านล็อกแฟ้ม</strong>
                    <small>ต้องใส่รหัสผ่านก่อนเข้าดูไฟล์ในแฟ้มนี้</small>
                  </span>
                </div>
                <span className="store-cat-switch" aria-hidden="true" />
              </button>

              {folderForm.passwordEnabled && (
                <label className="file-modal-field">
                  <span>
                    {folderModal.mode === "edit" && folderModal.folder?.passwordEnabled
                      ? "รหัสผ่านใหม่ (ว่างไว้หากไม่เปลี่ยน)"
                      : "รหัสผ่านสำหรับปลดล็อกแฟ้ม"}
                  </span>
                  <input
                    type="password"
                    name="folder_lock_password"
                    value={folderForm.password}
                    onChange={(e) => setFolderForm((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="อย่างน้อย 4 ตัวอักษร"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    minLength={folderModal.mode === "create" ? 4 : 0}
                    required={folderModal.mode === "create"}
                  />
                </label>
              )}
            </div>

            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setFolderModal(null)}
                disabled={folderBusy}
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="primary"
                disabled={folderBusy || !folderForm.name.trim()}
              >
                <Folder size={16} />
                <span>{folderBusy ? "กำลังบันทึก..." : "บันทึกแฟ้ม"}</span>
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Folder Delete Modal */}
      {folderDeleteTarget && (
        <div
          className="file-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !folderBusy) setFolderDeleteTarget(null);
          }}
        >
          <section className="file-modal file-delete-modal" role="alertdialog" aria-modal="true">
            <header>
              <span className="danger"><Trash2 size={20} /></span>
              <div>
                <h2>ลบแฟ้ม “{folderDeleteTarget.name}”?</h2>
                <p>เลือกรูปแบบการจัดการไฟล์ที่อยู่ในแฟ้มนี้</p>
              </div>
              <button
                type="button"
                onClick={() => setFolderDeleteTarget(null)}
                disabled={folderBusy}
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </header>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <p style={{ color: "var(--theme-text-muted)", fontSize: "14px", margin: 0 }}>
                มีไฟล์อยู่ในแฟ้มนี้ทั้งหมด <strong>{folderDeleteTarget.fileCount}</strong> ไฟล์
              </p>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  className="fl-checkbox"
                  checked={folderDeleteCascade}
                  onChange={(e) => setFolderDeleteCascade(e.target.checked)}
                  style={{ marginTop: "3px" }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong style={{ color: folderDeleteCascade ? "var(--danger)" : "var(--theme-text)", fontSize: "13.5px" }}>
                    ลบไฟล์ทั้งหมดภายในแฟ้มนี้ด้วย
                  </strong>
                  <small style={{ color: "var(--theme-text-soft)", fontSize: "12px" }}>
                    {folderDeleteCascade
                      ? "ไฟล์ทั้งหมดจะถูกลบถาวรและกู้คืนไม่ได้"
                      : "หากไม่เลือก ไฟล์ทั้งหมดจะถูกย้ายออกมาอยู่ที่หน้าหลักของหมวดหมู่ (ไม่ถูกลบ)"}
                  </small>
                </div>
              </label>
            </div>

            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setFolderDeleteTarget(null)}
                disabled={folderBusy}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void handleDeleteFolder()}
                disabled={folderBusy}
              >
                <Trash2 size={16} />
                <span>{folderBusy ? "กำลังลบ..." : folderDeleteCascade ? "ลบแฟ้มและไฟล์ทั้งหมด" : "ลบเฉพาะแฟ้ม"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Move File to Folder Modal */}
      {moveFolderTarget && (
        <div
          className="file-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !actionBusy) setMoveFolderTarget(null);
          }}
        >
          <form
            className="file-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fl-move-folder-title"
            onSubmit={handleMoveFileFolder}
          >
            <header>
              <span><FolderInput size={20} /></span>
              <div>
                <h2 id="fl-move-folder-title">ย้ายเข้าแฟ้ม</h2>
                <p>{moveFolderTarget.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setMoveFolderTarget(null)}
                disabled={actionBusy}
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </header>

            <div style={{ padding: "16px 20px" }}>
              <label className="file-modal-field">
                <span>เลือกแฟ้มปลายทาง</span>
                <select
                  value={moveFolderValue}
                  onChange={(e) => setMoveFolderValue(e.target.value)}
                  disabled={actionBusy}
                >
                  <option value="root">ไม่ใส่แฟ้ม (หน้าหลักของหมวดหมู่)</option>
                  {currentHierarchicalFolders.map((f) => (
                    <option key={f.id} value={String(f.id)}>
                      {f.label} {f.passwordEnabled ? "(มีรหัสผ่าน)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setMoveFolderTarget(null)}
                disabled={actionBusy}
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="primary"
                disabled={actionBusy}
              >
                <FolderInput size={16} />
                <span>{actionBusy ? "กำลังย้าย..." : "ย้ายไฟล์"}</span>
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Batch Move to Folder Modal */}
      {batchFolderModalOpen && (
        <div
          className="file-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !batchBusy) setBatchFolderModalOpen(false);
          }}
        >
          <section className="file-modal" role="dialog" aria-modal="true" aria-labelledby="batch-folder-title">
            <header>
              <span><FolderInput size={20} /></span>
              <div>
                <h2 id="batch-folder-title">ย้ายเข้าแฟ้มหลายรายการ</h2>
                <p>เปลี่ยนแฟ้มสำหรับ {selectedIds.length} ไฟล์ที่เลือก</p>
              </div>
              <button
                type="button"
                onClick={() => setBatchFolderModalOpen(false)}
                disabled={batchBusy}
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </header>

            <div style={{ padding: "16px 20px" }}>
              <label className="file-modal-field">
                <span>เลือกแฟ้มปลายทาง</span>
                <select
                  value={batchTargetFolder}
                  onChange={(e) => setBatchTargetFolder(e.target.value)}
                  disabled={batchBusy}
                >
                  <option value="root">ไม่ใส่แฟ้ม (หน้าหลักของหมวดหมู่)</option>
                  {currentHierarchicalFolders.map((f) => (
                    <option key={f.id} value={String(f.id)}>
                      {f.label} {f.passwordEnabled ? "(มีรหัสผ่าน)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setBatchFolderModalOpen(false)}
                disabled={batchBusy}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleBatchFolder()}
                disabled={batchBusy}
              >
                <FolderInput size={17} />
                <span>{batchBusy ? "กำลังบันทึก..." : `ย้าย ${selectedIds.length} ไฟล์`}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Category Create/Edit Modal */}
      {categoryModal && (
        <div
          className="file-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !categoryBusy) setCategoryModal(null);
          }}
        >
          <form
            className="file-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fl-cat-modal-title"
            onSubmit={handleSaveCategory}
            autoComplete="off"
          >
            {/* Hidden dummy fields to intercept browser credential autofill */}
            <input
              type="text"
              name="prevent_autofill_user"
              tabIndex={-1}
              autoComplete="username"
              style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none", zIndex: -1 }}
              aria-hidden="true"
            />
            <input
              type="password"
              name="prevent_autofill_pass"
              tabIndex={-1}
              autoComplete="current-password"
              style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none", zIndex: -1 }}
              aria-hidden="true"
            />

            <header>
              <span><Layers size={20} /></span>
              <div>
                <h2 id="fl-cat-modal-title">
                  {categoryModal.mode === "create" ? "สร้างหมวดหมู่ใหม่" : "แก้ไขหมวดหมู่"}
                </h2>
                <p>
                  {categoryModal.mode === "create"
                    ? "จัดระเบียบไฟล์เอกสารในหมวดหมู่ของคุณเอง"
                    : `กำลังแก้ไข: ${categoryModal.category?.name}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCategoryModal(null)}
                disabled={categoryBusy}
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </header>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <label className="file-modal-field">
                <span>ชื่อหมวดหมู่</span>
                <input
                  type="text"
                  name="category_display_title"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="เช่น เอกสารส่วนตัว, โครงการพิเศษ, การเงิน..."
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  autoFocus
                  required
                />
              </label>

              <button
                type="button"
                className={`store-cat-toggle ${categoryForm.isVisible ? "on" : ""}`}
                onClick={() => setCategoryForm((prev) => ({ ...prev, isVisible: !prev.isVisible }))}
              >
                <div className="store-cat-toggle-left">
                  <span className="store-cat-icon-badge">
                    {categoryForm.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </span>
                  <span className="store-cat-toggle-copy">
                    <strong>แสดงหมวดหมู่นี้ในคลัง</strong>
                    <small>{categoryForm.isVisible ? "เปิดให้เห็นหมวดหมู่นี้" : "ซ่อนหมวดหมู่นี้ชั่วคราว"}</small>
                  </span>
                </div>
                <span className="store-cat-switch" aria-hidden="true" />
              </button>

              <button
                type="button"
                className={`store-cat-toggle ${categoryForm.passwordEnabled ? "on" : ""}`}
                onClick={() =>
                  setCategoryForm((prev) => ({ ...prev, passwordEnabled: !prev.passwordEnabled }))
                }
              >
                <div className="store-cat-toggle-left">
                  <span className="store-cat-icon-badge">
                    <Lock size={16} />
                  </span>
                  <span className="store-cat-toggle-copy">
                    <strong>ตั้งรหัสผ่านล็อกหมวดหมู่</strong>
                    <small>ผู้ใช้อื่นต้องใส่รหัสผ่านก่อนเข้าดูไฟล์ในหมวดนี้ (เจ้าของเข้าได้ทันที)</small>
                  </span>
                </div>
                <span className="store-cat-switch" aria-hidden="true" />
              </button>

              {categoryForm.passwordEnabled && (
                <label className="file-modal-field">
                  <span>
                    {categoryModal.mode === "edit" && categoryModal.category?.passwordEnabled
                      ? "รหัสผ่านใหม่ (ว่างไว้หากไม่เปลี่ยน)"
                      : "รหัสผ่านสำหรับล็อกหมวดหมู่"}
                  </span>
                  <input
                    type="password"
                    name="category_lock_password"
                    value={categoryForm.password}
                    onChange={(e) => setCategoryForm((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="อย่างน้อย 4 ตัวอักษร"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    minLength={categoryModal.mode === "create" ? 4 : 0}
                    required={categoryModal.mode === "create"}
                  />
                </label>
              )}
            </div>

            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setCategoryModal(null)}
                disabled={categoryBusy}
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="primary"
                disabled={categoryBusy || !categoryForm.name.trim()}
              >
                <Layers size={16} />
                <span>{categoryBusy ? "กำลังบันทึก..." : "บันทึกหมวดหมู่"}</span>
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Category Delete Modal */}
      {categoryDeleteTarget && (
        <div
          className="file-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !categoryBusy) setCategoryDeleteTarget(null);
          }}
        >
          <section className="file-modal file-delete-modal" role="alertdialog" aria-modal="true">
            <header>
              <span className="danger"><Trash2 size={20} /></span>
              <div>
                <h2>ลบหมวดหมู่ “{categoryDeleteTarget.name}”?</h2>
                <p>เลือกรูปแบบการจัดการไฟล์และแฟ้มที่อยู่ภายในหมวดหมู่นี้</p>
              </div>
              <button
                type="button"
                onClick={() => setCategoryDeleteTarget(null)}
                disabled={categoryBusy}
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </header>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <p style={{ color: "var(--theme-text-muted)", fontSize: "14px", margin: 0 }}>
                {(() => {
                  const cStats = categoryStatsMap.get(categoryDeleteTarget.id) || { fileCount: 0, totalBytes: 0 };
                  return `มีไฟล์ในหมวดนี้ทั้งหมด ${cStats.fileCount.toLocaleString("th-TH")} ไฟล์ (${formatBytes(cStats.totalBytes)})`;
                })()}
              </p>

              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "12px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  className="fl-checkbox"
                  checked={categoryDeleteCascade}
                  onChange={(e) => setCategoryDeleteCascade(e.target.checked)}
                  style={{ marginTop: "3px" }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <strong style={{ color: categoryDeleteCascade ? "var(--danger)" : "var(--theme-text)", fontSize: "13.5px" }}>
                    ลบไฟล์และแฟ้มทั้งหมดภายในหมวดหมู่นี้ด้วย (ลบถาวร)
                  </strong>
                  <small style={{ color: "var(--theme-text-soft)", fontSize: "12px" }}>
                    {categoryDeleteCascade
                      ? "ไฟล์และแฟ้มย่อยทั้งหมดในหมวดหมู่นี้จะถูกลบถาวรและกู้คืนไม่ได้"
                      : "หากไม่เลือก ไฟล์ทั้งหมดจะถูกเปลี่ยนเป็นไฟล์ไม่ใส่หมวดหมู่ (ไม่ถูกลบ)"}
                  </small>
                </div>
              </label>
            </div>

            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setCategoryDeleteTarget(null)}
                disabled={categoryBusy}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void handleDeleteCategory()}
                disabled={categoryBusy}
              >
                <Trash2 size={16} />
                <span>{categoryBusy ? "กำลังลบ..." : categoryDeleteCascade ? "ลบหมวดหมู่และไฟล์ทั้งหมด" : "ลบเฉพาะหมวดหมู่"}</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Category Password Prompt Modal */}
      {categoryPasswordPrompt && (
        <div
          className="file-modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !categoryPasswordBusy) {
              setCategoryPasswordPrompt(null);
              setCategoryPasswordInput("");
              setCategoryPasswordError("");
            }
          }}
        >
          <form
            className="file-modal file-password-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fl-cat-pwd-title"
            onSubmit={handleVerifyCategoryPassword}
            autoComplete="off"
          >
            <header>
              <span><Lock size={20} /></span>
              <div>
                <h2 id="fl-cat-pwd-title">หมวดหมู่นี้ถูกล็อก</h2>
                <p>กรุณากรอกรหัสผ่านเพื่อเข้าดู “{categoryPasswordPrompt.name}”</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCategoryPasswordPrompt(null);
                  setCategoryPasswordInput("");
                  setCategoryPasswordError("");
                }}
                disabled={categoryPasswordBusy}
                aria-label="ปิด"
              >
                <X size={18} />
              </button>
            </header>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {categoryPasswordError && (
                <div className="file-modal-error" role="alert">
                  <AlertCircle size={15} />
                  <span>{categoryPasswordError}</span>
                </div>
              )}
              <label className="file-modal-field">
                <span>รหัสผ่านหมวดหมู่</span>
                <input
                  type="password"
                  name="category_auth_password"
                  value={categoryPasswordInput}
                  onChange={(e) => {
                    setCategoryPasswordInput(e.target.value);
                    if (categoryPasswordError) setCategoryPasswordError("");
                  }}
                  placeholder="กรอกรหัสผ่าน"
                  autoComplete="one-time-code"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-form-type="other"
                  autoFocus
                  required
                />
              </label>
            </div>

            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setCategoryPasswordPrompt(null);
                  setCategoryPasswordInput("");
                  setCategoryPasswordError("");
                }}
                disabled={categoryPasswordBusy}
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="primary"
                disabled={categoryPasswordBusy || !categoryPasswordInput.trim()}
              >
                <KeyRound size={16} />
                <span>{categoryPasswordBusy ? "กำลังตรวจสอบ..." : "ปลดล็อกและเข้าดู"}</span>
              </button>
            </footer>
          </form>
        </div>
      )}

      {/* Notice toast */}
      {notice && (
        <div className={`fl-toast is-${notice.kind}`} role={notice.kind === "success" ? "status" : "alert"} aria-live={notice.kind === "success" ? "polite" : "assertive"}>
          <span className="fl-toast-icon" aria-hidden="true">
            {notice.kind === "success" ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
          </span>
          <p>{notice.text}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="ปิดการแจ้งเตือน"><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
