"use client";

import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  List,
  Lock,
  Play,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, type TouchEvent as ReactTouchEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getDocumentTitle, type SiteTitleMode } from "../../../pageTitle";
import { applyThemeColor } from "../../../themeColor";
import { API_BASE } from "../../../runtime";
import LinkGone, { SHARE_TOKEN, linkGoneKind, type LinkGoneKind } from "../../../components/LinkGone";
import "../../../dashboard/file-library-122.css";
import "../../file-category-share.css";
import SmartImage from "../../../components/SmartImage";
import PdfPreview from "../../../components/PdfPreview";

type SharedFolder = {
  id: number;
  parentId?: number | null;
  name: string;
  fileCount: number;
  subfolderCount?: number;
  passwordRequired: boolean;
  createdAt: string;
};

type SharedItem = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  folderId?: number | null;
  passwordRequired: boolean;
  createdAt: string;
};

type SharedCategory = {
  name: string;
  expiresAt?: string | null;
  fileCount: number;
  folders?: SharedFolder[];
  files: SharedItem[];
};

type PublicSettings = {
  brandName?: string;
  siteTitle?: string;
  siteTitleMode?: SiteTitleMode;
  logoUrl?: string;
  primaryColor?: string;
  themeMode?: "light" | "dark";
};

type FileKindResult = {
  label: string;
  ext: string;
  icon: typeof FileText;
  theme: string;
  kind: "image" | "video" | "audio" | "pdf" | "code" | "document" | "archive" | "spreadsheet" | "word" | "ppt" | "default";
};

type PreviewState = {
  item: SharedItem;
  url: string;
  kind: "image" | "video" | "audio" | "pdf" | "code" | "document" | "archive" | "spreadsheet" | "word" | "ppt" | "default";
  textContent?: string;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, value || 0)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function getFileExt(name: string) {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx + 1).toLowerCase();
}

function fileKind(contentType: string, name: string): FileKindResult {
  const type = (contentType || "").toLowerCase();
  const ext = getFileExt(name);
  const extUpper = ext.toUpperCase();

  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "bmp"].includes(ext)) {
    return { label: "รูปภาพ", ext: extUpper || "IMG", icon: FileImage, theme: "image", kind: "image" };
  }
  if (type.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) {
    return { label: "วิดีโอ", ext: extUpper || "VIDEO", icon: FileVideo, theme: "video", kind: "video" };
  }
  if (type.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(ext)) {
    return { label: "ไฟล์เสียง", ext: extUpper || "AUDIO", icon: FileAudio, theme: "audio", kind: "audio" };
  }
  if (type.includes("pdf") || ext === "pdf") {
    return { label: "เอกสาร PDF", ext: "PDF", icon: FileText, theme: "pdf", kind: "pdf" };
  }
  if (
    type.startsWith("text/") ||
    ["txt", "md", "json", "js", "ts", "jsx", "tsx", "html", "css", "py", "go", "php", "sql", "sh", "yml", "yaml", "xml", "env", "log"].includes(ext) ||
    type.includes("json") ||
    type.includes("javascript") ||
    type.includes("xml")
  ) {
    return { label: "ข้อความ / โค้ด", ext: extUpper || "CODE", icon: FileCode, theme: "code", kind: "code" };
  }
  if (["doc", "docx"].includes(ext) || type.includes("wordprocessingml") || type.includes("msword")) {
    return { label: "เอกสาร Word", ext: extUpper || "DOCX", icon: FileText, theme: "word", kind: "word" };
  }
  if (["xls", "xlsx", "csv"].includes(ext) || type.includes("spreadsheetml") || type.includes("excel") || type.includes("csv")) {
    return { label: "สเปรดชีต", ext: extUpper || "XLSX", icon: FileSpreadsheet, theme: "excel", kind: "spreadsheet" };
  }
  if (["ppt", "pptx"].includes(ext) || type.includes("presentationml") || type.includes("powerpoint")) {
    return { label: "งานนำเสนอ", ext: extUpper || "PPTX", icon: FileText, theme: "ppt", kind: "ppt" };
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext) || type.includes("zip") || type.includes("gzip") || type.includes("tar") || type.includes("rar") || type.includes("7z")) {
    return { label: "ไฟล์บีบอัด", ext: extUpper || "ZIP", icon: FileArchive, theme: "archive", kind: "archive" };
  }
  return { label: "เอกสาร", ext: extUpper || "FILE", icon: FileText, theme: "default", kind: "default" };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function formatExpiry(value?: string | null) {
  if (!value) return { primary: "ไม่มีวันหมดอายุ", secondary: "จนกว่าเจ้าของจะยกเลิกลิงก์", status: "permanent" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { primary: "ไม่ระบุวันหมดอายุ", secondary: "", status: "unknown" };
  const exact = date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const hours = (date.getTime() - Date.now()) / 36e5;
  if (hours <= 0) return { primary: "ลิงก์หมดอายุแล้ว", secondary: exact, status: "expired" };
  if (hours < 18) return { primary: `เหลืออีก ${Math.max(1, Math.round(hours))} ชม.`, secondary: exact, status: "soon" };
  const days = Math.max(1, Math.round(hours / 24));
  if (days < 8) return { primary: `เหลืออีก ${days} วัน`, secondary: exact, status: "active" };
  return { primary: exact, secondary: "", status: "active" };
}

function expiryLabel(expiry: ReturnType<typeof formatExpiry>) {
  if (expiry.status === "permanent") return "ลิงก์ไม่มีวันหมดอายุ";
  if (expiry.status === "expired" || expiry.status === "unknown") return expiry.primary;
  if (expiry.primary.startsWith("เหลืออีก ")) return `ลิงก์ใช้ได้อีก ${expiry.primary.replace("เหลืออีก ", "")}`;
  return `ลิงก์ใช้ได้ถึง ${expiry.primary}`;
}

const VIEW_KEY = "shared-folder-view";
// The list view shows this many files per page; the card view shows everything.
const PAGE_SIZE = 20;

// Page numbers with gaps: 1 … 4 5 6 … 12 (always the first, the last and the current ±1).
function pageList(current: number, total: number): (number | "gap")[] {
  const keep = new Set([1, total, current - 1, current, current + 1].filter((n) => n >= 1 && n <= total));
  if (current <= 3) [2, 3, 4].forEach((n) => n <= total && keep.add(n));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => n >= 1 && keep.add(n));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// The address does not change while this page is open; there is nothing to subscribe to.
const subscribeNever = () => () => {};
const readShareToken = () => window.location.pathname.split("/").filter(Boolean).at(-1) || "";

// The list/card choice is remembered in this browser; the server always renders the list.
function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function storedView(): "table" | "grid" {
  try { return window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "table"; } catch { return "table"; }
}

export default function PublicCategoryPage() {
  const [data, setData] = useState<SharedCategory | null>(null);
  const [failedKind, setErrorKind] = useState<LinkGoneKind>("gone");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const [fetching, setLoading] = useState(true);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [query, setQuery] = useState("");
  const savedView = useSyncExternalStore(subscribeStorage, storedView, () => "table" as const);
  const [pickedView, setPickedView] = useState<"table" | "grid" | null>(null);
  const viewMode = pickedView ?? savedView;
  function chooseView(mode: "table" | "grid") {
    setPickedView(mode);
    try { window.localStorage.setItem(VIEW_KEY, mode); } catch { /* storage blocked */ }
  }
  const [pickedTab, setActiveTab] = useState<"all" | "image" | "video" | "audio" | "doc" | "archive">("all");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "name_asc" | "name_desc" | "size_desc" | "size_asc">("date_desc");
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState("");
  const [batching, setBatching] = useState(false);
  const [active, setActive] = useState<SharedItem | null>(null);
  const [passwordMode, setPasswordMode] = useState<"download" | "preview">("download");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  // Folder states
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [unlockedFolders, setUnlockedFolders] = useState<Record<number, string>>({});
  const [folderUnlockTarget, setFolderUnlockTarget] = useState<SharedFolder | null>(null);
  const [folderPasswordInput, setFolderPasswordInput] = useState("");
  const [showFolderPassword, setShowFolderPassword] = useState(false);
  const [folderUnlockBusy, setFolderUnlockBusy] = useState(false);

  const inFlight = useRef(false);
  // The server renders without the address; the token is read once the page runs in the browser.
  const token = useSyncExternalStore(subscribeNever, readShareToken, () => "");
  // A token that cannot be a share link is reported at once, without asking the server.
  const tokenBroken = Boolean(token) && !SHARE_TOKEN.test(token);
  const loading = fetching && !tokenBroken;
  const errorKind: LinkGoneKind = tokenBroken ? "broken" : failedKind;

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/public`)
      .then((res) => (res.ok ? (res.json() as Promise<PublicSettings>) : null))
      .then((value) => {
        if (!value) return;
        setSettings(value);
        if (typeof document !== "undefined") {
          if (value.themeMode) document.documentElement.dataset.theme = value.themeMode;
          if (value.primaryColor) applyThemeColor(value.primaryColor);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token || tokenBroken) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/public/file-categories/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { kind: linkGoneKind(response.status) });
        }
        return payload as SharedCategory;
      })
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((error: Error & { kind?: LinkGoneKind }) => {
        if (!cancelled) {
          setData(null);
          // A network failure has no kind and only a browser message ("Failed to fetch").
          setErrorKind(error.kind ?? "offline");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, tokenBroken, attempt]);

  useEffect(() => {
    if (!settings || typeof document === "undefined") return;
    document.title = data?.name
      ? `${data.name} · ${settings.brandName || settings.siteTitle || "NEXORA CLOUD"}`
      : getDocumentTitle(settings, window.location.pathname);
  }, [data, settings]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (notice) {
          setNotice("");
        } else if (preview) {
          if (preview.url) URL.revokeObjectURL(preview.url);
          setPreview(null);
        } else if (folderUnlockTarget) {
          setFolderUnlockTarget(null);
        } else if (active) {
          closePassword();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, preview, notice, folderUnlockTarget]);

  const files = useMemo(() => data?.files ?? [], [data]);
  const folders = useMemo(() => data?.folders ?? [], [data]);

  const folderMap = useMemo(() => {
    const map = new Map<number, SharedFolder>();
    for (const f of folders) {
      map.set(f.id, f);
    }
    return map;
  }, [folders]);

  const folderBreadcrumbs = useMemo(() => {
    if (selectedFolderId === null || selectedFolderId <= 0) return [];
    const trail: SharedFolder[] = [];
    let curr: SharedFolder | undefined = folderMap.get(selectedFolderId);
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

  const getCategoryGroup = (item: SharedItem): "image" | "video" | "audio" | "doc" | "archive" => {
    const kind = fileKind(item.contentType, item.name).kind;
    if (kind === "image") return "image";
    if (kind === "video") return "video";
    if (kind === "audio") return "audio";
    if (kind === "archive") return "archive";
    return "doc";
  };

  // Files in the selected folder (or all of them); type counts and the list both start here.
  const scoped = useMemo(() => {
    if (selectedFolderId === null) return files;
    if (selectedFolderId === -1) return files.filter((item) => !item.folderId);
    return files.filter((item) => item.folderId === selectedFolderId);
  }, [files, selectedFolderId]);
  const looseCount = useMemo(() => files.filter((item) => !item.folderId).length, [files]);

  const counts = useMemo(() => {
    const res = { all: scoped.length, image: 0, video: 0, audio: 0, doc: 0, archive: 0 };
    for (const item of scoped) {
      const group = getCategoryGroup(item);
      res[group] += 1;
    }
    return res;
  }, [scoped]);
  const typeTabs = ([
    { key: "all", label: "ทั้งหมด", icon: FolderOpen, count: counts.all },
    { key: "image", label: "รูปภาพ", icon: FileImage, count: counts.image },
    { key: "video", label: "วิดีโอ", icon: FileVideo, count: counts.video },
    { key: "audio", label: "เสียง", icon: FileAudio, count: counts.audio },
    { key: "doc", label: "เอกสาร", icon: FileText, count: counts.doc },
    { key: "archive", label: "ไฟล์บีบอัด", icon: FileArchive, count: counts.archive },
  ] as const).filter((tab) => tab.key === "all" || tab.count > 0);

  // A type tab that no longer has files in the selected folder falls back to "all".
  const activeTab = pickedTab !== "all" && counts[pickedTab] === 0 ? "all" : pickedTab;

  const filtered = useMemo(() => {
    let list = scoped;
    if (activeTab !== "all") {
      list = list.filter((item) => getCategoryGroup(item) === activeTab);
    }
    const needle = query.trim().toLowerCase();
    if (needle) {
      list = list.filter((item) => item.name.toLowerCase().includes(needle));
    }
    const sorted = [...list].sort((a, b) => {
      switch (sortBy) {
        case "date_asc":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "date_desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "name_asc":
          return a.name.localeCompare(b.name, "th-TH", { sensitivity: "base" });
        case "name_desc":
          return b.name.localeCompare(a.name, "th-TH", { sensitivity: "base" });
        case "size_asc":
          return (a.size || 0) - (b.size || 0);
        case "size_desc":
          return (b.size || 0) - (a.size || 0);
        default:
          return 0;
      }
    });
    return sorted;
  }, [scoped, activeTab, query, sortBy]);
  const filtering = Boolean(query.trim() || activeTab !== "all");

  const [page, setPage] = useState(1);
  const pageCount = viewMode === "table" ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)) : 1;
  const currentPage = Math.min(page, pageCount);
  const pageItems = viewMode === "table" ? filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : filtered;
  // A new folder, filter, search or order starts again from page 1.
  const pageKey = `${selectedFolderId}|${activeTab}|${query}|${sortBy}|${viewMode}`;
  const [pageFor, setPageFor] = useState(pageKey);
  if (pageFor !== pageKey) {
    setPageFor(pageKey);
    setPage(1);
  }
  const listTopRef = useRef<HTMLDivElement>(null);
  // Preview steps through the files in the current view, skipping ones that need a password.
  const lockedFolderIds = useMemo(
    () => new Set(folders.filter((f) => f.passwordRequired && !unlockedFolders[f.id]).map((f) => f.id)),
    [folders, unlockedFolders],
  );
  const previewId = preview?.item.id;
  const previewList = useMemo(
    () => filtered.filter((item) => item.id === previewId || (!item.passwordRequired && !(item.folderId && lockedFolderIds.has(item.folderId)))),
    [filtered, lockedFolderIds, previewId],
  );
  const previewIndex = previewId ? previewList.findIndex((item) => item.id === previewId) : -1;
  const previewPrev = previewIndex > 0 ? previewList[previewIndex - 1] : null;
  const previewNext = previewIndex >= 0 && previewIndex < previewList.length - 1 ? previewList[previewIndex + 1] : null;
  const previewSwitching = Boolean(preview && previewBusyId);
  function stepPreview(target: SharedItem | null) {
    if (target && !previewBusyId) void previewItem(target, "");
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
    if (!preview || active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(el.tagName))) return;
      event.preventDefault();
      stepPreview(event.key === "ArrowRight" ? previewNext : previewPrev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function goToPage(next: number) {
    setPage(next);
    const top = listTopRef.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
  }
  const totalSize = useMemo(() => files.reduce((sum, item) => sum + (item.size || 0), 0), [files]);
  const unlocked = useMemo(() => files.filter((item) => !item.passwordRequired), [files]);
  const expiry = formatExpiry(data?.expiresAt);
  const brandName = settings?.brandName || "NEXORA CLOUD";
  const busy = busyId !== null || previewBusyId !== null || batching;

  function closePassword() {
    setActive(null);
    setPassword("");
    setShowPassword(false);
  }

  async function submitFolderUnlock(e: FormEvent) {
    e.preventDefault();
    if (!folderUnlockTarget || folderUnlockBusy) return;
    setFolderUnlockBusy(true);
    setNotice("");
    try {
      const res = await fetch(
        `${API_BASE}/api/public/file-categories/${encodeURIComponent(token)}/folders/${folderUnlockTarget.id}/unlock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: folderPasswordInput }),
        }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || "รหัสผ่านไม่ถูกต้อง");
      }
      setUnlockedFolders((prev) => ({
        ...prev,
        [folderUnlockTarget.id]: folderPasswordInput,
      }));
      setSelectedFolderId(folderUnlockTarget.id);
      setFolderUnlockTarget(null);
      setFolderPasswordInput("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "ปลดล็อกแฟ้มไม่สำเร็จ");
    } finally {
      setFolderUnlockBusy(false);
    }
  }

  function handleCopyLink() {
    if (!window.location.href) return;
    void navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  async function fetchFileBlob(item: SharedItem, previewMode: boolean, pass?: string) {
    const usePassword = pass ?? (active?.id === item.id ? password : "");
    const folderPassword = item.folderId && unlockedFolders[item.folderId] ? unlockedFolders[item.folderId] : "";
    const params = new URLSearchParams();
    if (previewMode) params.set("preview", "true");
    if (folderPassword) params.set("folderPassword", folderPassword);
    const qs = params.toString();

    const response = await fetch(
      `${API_BASE}/api/public/file-categories/${encodeURIComponent(token)}/files/${encodeURIComponent(item.id)}/download${qs ? `?${qs}` : ""}`,
      {
        method: item.passwordRequired ? "POST" : "GET",
        headers: item.passwordRequired ? { "Content-Type": "application/json" } : undefined,
        body: item.passwordRequired ? JSON.stringify({ password: usePassword, folderPassword }) : undefined,
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "โหลดไฟล์ไม่สำเร็จ");
    }
    return response.blob();
  }

  async function previewItem(item: SharedItem, overridePassword?: string) {
    if (!token || inFlight.current) return;
    const kindInfo = fileKind(item.contentType, item.name);
    const usePassword = overridePassword ?? password;
    if (item.passwordRequired && !usePassword.trim()) {
      setPasswordMode("preview");
      setActive(item);
      return;
    }
    inFlight.current = true;
    setPreviewBusyId(item.id);
    setNotice("");
    try {
      const blob = await fetchFileBlob(item, true, usePassword);
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
      });
      closePassword();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "เปิดตัวอย่างไม่สำเร็จ");
      if (item.passwordRequired) {
        setPasswordMode("preview");
        setActive(item);
      }
    } finally {
      inFlight.current = false;
      setPreviewBusyId(null);
    }
  }

  async function downloadItem(item: SharedItem, overridePassword?: string) {
    if (!token || inFlight.current) return;
    const usePassword = overridePassword ?? password;
    if (item.passwordRequired && !usePassword.trim()) {
      setPasswordMode("download");
      setActive(item);
      return;
    }
    inFlight.current = true;
    setBusyId(item.id);
    setNotice("");
    try {
      const blob = await fetchFileBlob(item, false, usePassword);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDoneId(item.id);
      window.setTimeout(() => setDoneId((current) => (current === item.id ? null : current)), 2200);
      closePassword();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "ดาวน์โหลดไม่สำเร็จ");
      if (item.passwordRequired) {
        setPasswordMode("download");
        setActive(item);
      }
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  }

  function downloadFromPreview(previewItemData: PreviewState) {
    if (previewItemData.url) {
      const anchor = document.createElement("a");
      anchor.href = previewItemData.url;
      anchor.download = previewItemData.item.name;
      anchor.click();
    } else {
      void downloadItem(previewItemData.item);
    }
  }

  async function downloadAll() {
    if (inFlight.current || batching || unlocked.length === 0) return;
    setBatching(true);
    setNotice("");
    try {
      for (let index = 0; index < unlocked.length; index += 1) {
        const item = unlocked[index];
        setBatchProgress(`กำลังดาวน์โหลด ${index + 1}/${unlocked.length}`);
        await downloadItem(item);
        if (index < unlocked.length - 1) await sleep(450);
      }
      if (files.some((item) => item.passwordRequired)) {
        setNotice("ดาวน์โหลดไฟล์ที่ไม่มีรหัสผ่านแล้ว ไฟล์ที่ล็อกยังต้องกดทีละไฟล์");
      }
    } finally {
      setBatching(false);
      setBatchProgress("");
    }
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!active) return;
    if (passwordMode === "preview") {
      void previewItem(active, password);
    } else {
      void downloadItem(active, password);
    }
  }

  return (
    <div className="fcs-page sf-page">

      <header className="fcs-top">
        <Link href="/" className="fcs-brand">
          <img src={settings?.logoUrl || "/logo-v2.png"} alt="" />
          <div className="fcs-brand-text">
            <span>{brandName}</span>
            <small>โฟลเดอร์ที่แชร์ให้ดาวน์โหลด</small>
          </div>
        </Link>
        <Link href="/" className="fcs-home">
          <ArrowLeft size={14} aria-hidden="true" />
          <span>กลับหน้าหลัก</span>
        </Link>
      </header>

      <main className="fcs-main">
        <div className="fcs-shell">
          {loading ? (
            <section className="fcs-panel sf-centred" aria-busy="true">
              <div className="fcs-wait">
                <span className="fcs-spinner" aria-hidden="true" />
                <div>
                  <strong>กำลังเปิดโฟลเดอร์</strong>
                  <small>กำลังดึงรายการไฟล์ที่แชร์ไว้</small>
                </div>
              </div>
            </section>
          ) : data ? (
            <>
              <header className="sf-head">
                <span className="sf-head-icon" aria-hidden="true"><FolderOpen size={22} /></span>
                <div className="sf-head-copy">
                  <p className="sf-kicker">โฟลเดอร์ที่แชร์ให้คุณ</p>
                  <h1>{data.name}</h1>
                  <p className="sf-head-meta">
                    <span>{files.length.toLocaleString("th-TH")} ไฟล์</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(totalSize)}</span>
                    {folders.length > 0 && <><span aria-hidden="true">·</span><span>{folders.length} แฟ้ม</span></>}
                    <span className={`sf-expiry is-${expiry.status}`} title={expiry.secondary || undefined}>
                      <Clock size={13} aria-hidden="true" />
                      {expiryLabel(expiry)}
                    </span>
                  </p>
                </div>
                {files.length > 0 && (
                  <div className="sf-head-actions">
                    <button type="button" className="sf-btn" onClick={handleCopyLink}>
                      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                      <span>{copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}</span>
                    </button>
                    <button type="button" className="sf-btn sf-btn-primary" onClick={() => void downloadAll()} disabled={busy || unlocked.length === 0}>
                      {batchProgress ? <><span className="fcs-btn-spin" aria-hidden="true" /><span>{batchProgress}</span></>
                        : <><Download size={16} aria-hidden="true" /><span>ดาวน์โหลดทั้งหมด</span></>}
                    </button>
                  </div>
                )}
              </header>

              {unlocked.length > 0 && unlocked.length < files.length && (
                <p className="sf-note"><Lock size={14} aria-hidden="true" />ดาวน์โหลดทั้งหมดจะได้ {unlocked.length} ไฟล์ที่ไม่มีรหัสผ่าน อีก {files.length - unlocked.length} ไฟล์ต้องใส่รหัสทีละไฟล์</p>
              )}

              <section className="sf-panel" aria-label="ไฟล์ในโฟลเดอร์">
                {folders.length > 0 && (
                  <nav className="sf-folders" aria-label="แฟ้มในโฟลเดอร์">
                    {selectedFolderId !== null && selectedFolderId !== -1 && (
                      <ol className="sf-crumbs">
                        <li><button type="button" onClick={() => setSelectedFolderId(null)}><ArrowLeft size={14} aria-hidden="true" />ไฟล์ทั้งหมด</button></li>
                        {folderBreadcrumbs.map((crumb, idx) => (
                          <li key={crumb.id}>
                            <ChevronRight size={14} aria-hidden="true" className="sf-crumb-sep" />
                            {idx === folderBreadcrumbs.length - 1
                              ? <strong aria-current="page">{crumb.name}</strong>
                              : <button type="button" onClick={() => setSelectedFolderId(crumb.id)}>{crumb.name}</button>}
                          </li>
                        ))}
                      </ol>
                    )}
                    {(selectedFolderId === null || selectedFolderId === -1 || currentLevelFolders.length > 0) && (
                      <div className="sf-chips">
                        {(selectedFolderId === null || selectedFolderId === -1) && (
                          <>
                            <button type="button" className={`sf-chip${selectedFolderId === null ? " is-active" : ""}`} aria-pressed={selectedFolderId === null} onClick={() => setSelectedFolderId(null)}>
                              <span>ไฟล์ทั้งหมด</span><em>{files.length}</em>
                            </button>
                            {looseCount > 0 && (
                              <button type="button" className={`sf-chip${selectedFolderId === -1 ? " is-active" : ""}`} aria-pressed={selectedFolderId === -1} onClick={() => setSelectedFolderId(-1)}>
                                <span>ไม่อยู่ในแฟ้ม</span><em>{looseCount}</em>
                              </button>
                            )}
                          </>
                        )}
                        {(selectedFolderId === -1 ? folders.filter((f) => !f.parentId) : currentLevelFolders).map((f) => {
                          const isLocked = f.passwordRequired && !unlockedFolders[f.id];
                          return (
                            <button key={f.id} type="button" className={`sf-chip sf-chip-folder${isLocked ? " is-locked" : ""}`} title={isLocked ? "ต้องใส่รหัสผ่านเพื่อเปิดแฟ้มนี้" : undefined}
                              onClick={() => {
                                if (isLocked) { setFolderUnlockTarget(f); setFolderPasswordInput(""); setShowFolderPassword(false); }
                                else setSelectedFolderId(f.id);
                              }}>
                              {isLocked ? <Lock size={14} aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />}
                              <span>{f.name}</span>
                              <em>{f.fileCount}{f.subfolderCount ? ` · ${f.subfolderCount} แฟ้มย่อย` : ""}</em>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </nav>
                )}

                {files.length > 0 && (
                  <div className="sf-toolbar">
                    <label className="sf-search">
                      <Search size={17} aria-hidden="true" />
                      <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); } }}
                        placeholder="ค้นหาชื่อไฟล์"
                        aria-label="ค้นหาชื่อไฟล์"
                      />
                      {query && <button type="button" onClick={() => setQuery("")} aria-label="ล้างคำค้นหา"><X size={15} aria-hidden="true" /></button>}
                    </label>
                    <div className="sf-tools">
                      <select className="sf-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} aria-label="จัดเรียงไฟล์">
                        <option value="date_desc">ใหม่สุดก่อน</option>
                        <option value="date_asc">เก่าสุดก่อน</option>
                        <option value="name_asc">ชื่อ ก-ฮ / A-Z</option>
                        <option value="name_desc">ชื่อ ฮ-ก / Z-A</option>
                        <option value="size_desc">ใหญ่สุดก่อน</option>
                        <option value="size_asc">เล็กสุดก่อน</option>
                      </select>
                      <div className="sf-view" role="group" aria-label="มุมมอง">
                        <button type="button" className={viewMode === "table" ? "is-active" : ""} aria-pressed={viewMode === "table"} onClick={() => chooseView("table")} aria-label="แสดงเป็นรายการ" title="รายการ"><List size={17} aria-hidden="true" /></button>
                        <button type="button" className={viewMode === "grid" ? "is-active" : ""} aria-pressed={viewMode === "grid"} onClick={() => chooseView("grid")} aria-label="แสดงเป็นการ์ด" title="การ์ด"><LayoutGrid size={17} aria-hidden="true" /></button>
                      </div>
                    </div>
                  </div>
                )}

                {typeTabs.length > 2 && (
                  <div className="sf-types" role="group" aria-label="ประเภทไฟล์">
                    {typeTabs.map((tab) => (
                      <button key={tab.key} type="button" className={activeTab === tab.key ? "is-active" : ""} aria-pressed={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}>
                        <tab.icon size={15} aria-hidden="true" />
                        <span>{tab.label}</span>
                        <em>{tab.count}</em>
                      </button>
                    ))}
                  </div>
                )}

                {files.length > 0 && (
                  <div className="sf-meta" aria-live="polite" ref={listTopRef}>
                    <span>
                      {filtering ? `พบ ${filtered.length} จาก ${scoped.length} ไฟล์` : `${scoped.length.toLocaleString("th-TH")} ไฟล์`}
                      {pageCount > 1 && <> · แสดง {((currentPage - 1) * PAGE_SIZE + 1).toLocaleString("th-TH")}–{Math.min(currentPage * PAGE_SIZE, filtered.length).toLocaleString("th-TH")}</>}
                    </span>
                    {filtering && <button type="button" onClick={() => { setQuery(""); setActiveTab("all"); }}>ล้างตัวกรอง</button>}
                  </div>
                )}

                {files.length === 0 ? (
                  <div className="sf-empty"><FolderOpen size={28} aria-hidden="true" /><strong>ยังไม่มีไฟล์ในโฟลเดอร์นี้</strong><span>เจ้าของยังไม่ได้เพิ่มไฟล์ที่เปิดให้ดาวน์โหลด</span></div>
                ) : filtered.length === 0 ? (
                  <div className="sf-empty">
                    <Search size={26} aria-hidden="true" />
                    <strong>{query.trim() ? `ไม่พบไฟล์ที่ตรงกับ “${query.trim()}”` : "ไม่มีไฟล์ในส่วนนี้"}</strong>
                    {filtering && <button type="button" className="sf-btn" onClick={() => { setQuery(""); setActiveTab("all"); }}>ล้างตัวกรอง</button>}
                  </div>
                ) : viewMode === "grid" ? (
                  <ul className="sf-grid">
                    {filtered.map((item) => {
                      const kind = fileKind(item.contentType, item.name);
                      const Icon = kind.icon;
                      const downloading = busyId === item.id;
                      const previewing = previewBusyId === item.id;
                      const done = doneId === item.id;
                      const showImg = kind.kind === "image" && !item.passwordRequired;
                      const folderPass = item.folderId && unlockedFolders[item.folderId] ? `&folderPassword=${encodeURIComponent(unlockedFolders[item.folderId])}` : "";
                      return (
                        <li key={item.id} className={`sf-card sf-kind-${kind.theme}`}>
                          <button type="button" className="sf-card-thumb" onClick={() => void previewItem(item)} disabled={busy} aria-label={`ดูตัวอย่าง ${item.name}`}>
                            {showImg ? (
                              <SmartImage src={`${API_BASE}/api/public/file-categories/${encodeURIComponent(token)}/files/${encodeURIComponent(item.id)}/download?preview=true${folderPass}`} alt="" />
                            ) : (
                              <span className="sf-card-glyph"><Icon size={34} aria-hidden="true" /><em>{kind.ext}</em></span>
                            )}
                            {item.passwordRequired && <span className="sf-lock-badge"><Lock size={12} aria-hidden="true" />มีรหัสผ่าน</span>}
                            <span className="sf-card-hover" aria-hidden="true">
                              {previewing ? <span className="fcs-btn-spin" /> : kind.kind === "video" || kind.kind === "audio" ? <Play size={15} /> : <Eye size={15} />}
                              {kind.kind === "video" ? "เล่นวิดีโอ" : kind.kind === "audio" ? "ฟังเสียง" : "ดูตัวอย่าง"}
                            </span>
                          </button>
                          <div className="sf-card-body">
                            <strong title={item.name}>{item.name}</strong>
                            <small>{formatBytes(item.size)} · {formatDate(item.createdAt)}</small>
                          </div>
                          <button type="button" className={`sf-card-dl${done ? " is-done" : ""}`} onClick={() => void downloadItem(item)} disabled={busy}>
                            {downloading ? <span className="fcs-btn-spin" aria-hidden="true" /> : done ? <CheckCircle2 size={16} aria-hidden="true" /> : item.passwordRequired ? <Lock size={15} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                            <span>{done ? "บันทึกแล้ว" : "ดาวน์โหลด"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <>
                  <ul className="sf-list">
                    {pageItems.map((item) => {
                      const kind = fileKind(item.contentType, item.name);
                      const Icon = kind.icon;
                      const downloading = busyId === item.id;
                      const previewing = previewBusyId === item.id;
                      const done = doneId === item.id;
                      return (
                        <li key={item.id} className={`sf-row sf-kind-${kind.theme}`}>
                          <button type="button" className="sf-row-open" onClick={() => void previewItem(item)} disabled={busy} title="ดูตัวอย่าง">
                            <span className="sf-file-icon" aria-hidden="true">{previewing ? <span className="fcs-btn-spin" /> : <Icon size={19} />}<em>{kind.ext}</em></span>
                            <span className="sf-row-main">
                              <strong>{item.name}</strong>
                              <small>
                                <span>{kind.label}</span>
                                <span className="sf-row-inline">{formatBytes(item.size)}</span>
                                <span className="sf-row-inline">{formatDate(item.createdAt)}</span>
                                {item.passwordRequired && <span className="sf-lock-tag"><Lock size={11} aria-hidden="true" />มีรหัสผ่าน</span>}
                              </small>
                            </span>
                          </button>
                          <span className="sf-row-size">{formatBytes(item.size)}</span>
                          <span className="sf-row-date">{formatDate(item.createdAt)}</span>
                          <div className="sf-row-actions">
                            <button type="button" className="sf-icon-btn" onClick={() => void previewItem(item)} disabled={busy} aria-label={`ดูตัวอย่าง ${item.name}`} title="ดูตัวอย่าง">
                              <Eye size={17} aria-hidden="true" />
                            </button>
                            <button type="button" className={`sf-btn sf-btn-dl${done ? " is-done" : ""}`} onClick={() => void downloadItem(item)} disabled={busy} aria-label={`ดาวน์โหลด ${item.name}`}>
                              {downloading ? <span className="fcs-btn-spin" aria-hidden="true" /> : done ? <CheckCircle2 size={16} aria-hidden="true" /> : item.passwordRequired ? <Lock size={15} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                              <span>{done ? "บันทึกแล้ว" : "ดาวน์โหลด"}</span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {pageCount > 1 && (
                    <nav className="sf-pager" aria-label="เลือกหน้า">
                      <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} aria-label="หน้าก่อนหน้า"><ChevronLeft size={18} aria-hidden="true" /></button>
                      {pageList(currentPage, pageCount).map((n, i) => n === "gap"
                        ? <span key={`gap-${i}`} className="sf-pager-gap" aria-hidden="true">…</span>
                        : <button key={n} type="button" className={n === currentPage ? "is-active" : ""} aria-current={n === currentPage ? "page" : undefined} aria-label={`หน้า ${n}`} onClick={() => goToPage(n)}>{n}</button>)}
                      <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="หน้าถัดไป"><ChevronRight size={18} aria-hidden="true" /></button>
                    </nav>
                  )}
                  </>
                )}
              </section>
            </>
          ) : (
            <section className="fcs-panel sf-centred">
              <LinkGone kind={errorKind} noun="โฟลเดอร์" onRetry={() => { setLoading(true); setAttempt((n) => n + 1); }} />
            </section>
          )}
        </div>
      </main>

      {/* Password Prompt Modal */}
      {active && (
        <div className="fcs-modal" onClick={closePassword} role="presentation">
          <form
            className="fcs-dialog fcs-password-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fcs-password-title"
            onSubmit={submitPassword}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fcs-dialog-head">
              <div className="fcs-dialog-title-group">
                <div className="fcs-dialog-badge lock" aria-hidden="true">
                  <Lock size={20} />
                </div>
                <div>
                  <strong id="fcs-password-title">ไฟล์นี้มีรหัสผ่านป้องกัน</strong>
                  <small className="fcs-dialog-subtitle">กรุณากรอกรหัสผ่านเพื่อ{passwordMode === "preview" ? "ดูตัวอย่าง" : "ดาวน์โหลด"}</small>
                </div>
              </div>
              <button
                type="button"
                className="fcs-icon-btn"
                onClick={closePassword}
                aria-label="ปิด"
                title="ปิด"
              >
                <X size={16} />
              </button>
            </div>

            {/* Target File Preview Card */}
            <div className="fcs-modal-file-card">
              <div className="fcs-modal-file-icon">
                {(() => {
                  const FIcon = fileKind(active.contentType, active.name).icon;
                  return <FIcon size={18} />;
                })()}
              </div>
              <div className="fcs-modal-file-info">
                <span className="fcs-modal-file-name" title={active.name}>{active.name}</span>
                <span className="fcs-modal-file-size">{formatBytes(active.size)}</span>
              </div>
            </div>

            <label className="fcs-label">
              <span>รหัสผ่าน</span>
              <div className="fcs-password">
                <input
                  autoFocus
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="กรอกรหัสผ่านที่ได้รับจากผู้ส่ง"
                  required
                />
                <button
                  type="button"
                  className="fcs-icon-btn"
                  onClick={() => setShowPassword((open) => !open)}
                  aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  title={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="fcs-dialog-actions">
              <button type="button" className="fcs-ghost" onClick={closePassword}>
                ยกเลิก
              </button>
              <button type="submit" className="fcs-primary" disabled={busy || !password.trim()}>
                {busyId === active.id || previewBusyId === active.id ? (
                  <>
                    <span className="fcs-btn-spin" />
                    <span>กำลังตรวจสอบ</span>
                  </>
                ) : passwordMode === "preview" ? (
                  <>
                    <Eye size={15} />
                    <span>ปลดล็อกและดูตัวอย่าง</span>
                  </>
                ) : (
                  <>
                    <Download size={15} />
                    <span>ปลดล็อกและดาวน์โหลด</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Notice / Alert Modal Popup */}
      {notice && (
        <div className="fcs-modal" onClick={() => setNotice("")} role="presentation">
          <div
            className="fcs-dialog fcs-notice-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="fcs-notice-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fcs-dialog-head">
              <div className="fcs-dialog-title-group">
                <div className="fcs-dialog-badge alert" aria-hidden="true">
                  <AlertCircle size={20} />
                </div>
                <div>
                  <strong id="fcs-notice-title">การแจ้งเตือน</strong>
                  <small className="fcs-dialog-subtitle">ข้อความจากระบบ</small>
                </div>
              </div>
              <button
                type="button"
                className="fcs-icon-btn"
                onClick={() => setNotice("")}
                aria-label="ปิด"
                title="ปิด"
              >
                <X size={16} />
              </button>
            </div>

            <div className="fcs-notice-body">
              <p>{notice}</p>
            </div>

            <div className="fcs-dialog-actions fcs-notice-actions">
              <button
                type="button"
                autoFocus
                className="fcs-primary fcs-notice-btn"
                onClick={() => setNotice("")}
              >
                <span>ตกลง</span>
              </button>
            </div>
          </div>
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
                    const KIcon = fileKind(preview.item.contentType, preview.item.name).icon;
                    return <KIcon size={20} />;
                  })()}
                </span>
                <div className="fl-preview-title-info">
                  <strong title={preview.item.name}>{preview.item.name}</strong>
                  <div className="fl-preview-submeta">
                    <span>{formatBytes(preview.item.size)}</span>
                    <span>·</span>
                    <span>{fileKind(preview.item.contentType, preview.item.name).label}</span>
                    {previewList.length > 1 && previewIndex >= 0 && (
                      <>
                        <span>·</span>
                        <span className="fl-preview-position">{previewIndex + 1} / {previewList.length}</span>
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
                >
                  <ExternalLink size={15} />
                </a>
                <button
                  type="button"
                  className="fl-preview-tool-btn primary"
                  onClick={() => downloadFromPreview(preview)}
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
                  <X size={18} />
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
            {previewSwitching && <span className="fl-preview-switching" aria-hidden="true"><span className="fcs-btn-spin" /></span>}

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
                    <FileAudio size={54} />
                  </div>
                  <strong className="fl-preview-audio-name">{preview.item.name}</strong>
                  <audio src={preview.url} controls autoPlay />
                </div>
              ) : preview.kind === "pdf" ? (
                <PdfPreview url={preview.url} title={preview.item.name} />
              ) : preview.textContent !== undefined ? (
                <div className="fl-preview-code-stage">
                  <pre className="fl-code-block">
                    <code>{preview.textContent || "(ไฟล์ว่างเปล่า)"}</code>
                  </pre>
                </div>
              ) : (
                <div className="fl-preview-fallback-stage">
                  {preview.kind === "archive" ? (
                    <FileArchive size={48} />
                  ) : (
                    <FileText size={48} />
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
                    className="fl-preview-tool-btn primary"
                    onClick={() => downloadFromPreview(preview)}
                  >
                    <Download size={15} />
                    <span>{preview.kind === "archive" ? "ดาวน์โหลดไฟล์บีบอัด" : "ดาวน์โหลดเพื่อเปิดดู"}</span>
                  </button>
                </div>
              )}
            </div>

            <footer className="fl-preview-modal-footer">
              <div className="fl-preview-footer-chips">
                <span className="fl-footer-chip">
                  <HardDrive size={13} /> {formatBytes(preview.item.size)}
                </span>
                <span className="fl-footer-chip">
                  <Calendar size={13} /> {formatDate(preview.item.createdAt)}
                </span>
                {preview.item.passwordRequired && (
                  <span className="fl-footer-chip is-locked">
                    <Lock size={13} /> ต้องใช้รหัสผ่าน
                  </span>
                )}
              </div>
            </footer>
          </section>
        </div>
      )}
      {/* Folder Password Unlock Modal */}
      {folderUnlockTarget && (
        <div className="fcs-modal" onClick={() => setFolderUnlockTarget(null)} role="presentation">
          <form
            className="fcs-dialog fcs-password-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="fcs-folder-unlock-title"
            onSubmit={submitFolderUnlock}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fcs-dialog-head">
              <div className="fcs-dialog-title-group">
                <div className="fcs-dialog-badge lock" aria-hidden="true">
                  <Lock size={20} />
                </div>
                <div>
                  <strong id="fcs-folder-unlock-title">แฟ้มนี้มีรหัสผ่านป้องกัน</strong>
                  <small className="fcs-dialog-subtitle">
                    กรุณากรอกรหัสผ่านเพื่อเข้าดูไฟล์ในแฟ้ม “{folderUnlockTarget.name}”
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="fcs-icon-btn"
                onClick={() => setFolderUnlockTarget(null)}
                aria-label="ปิด"
                title="ปิด"
              >
                <X size={16} />
              </button>
            </div>

            <div className="fcs-modal-file-card">
              <div className="fcs-modal-file-icon">
                <Folder size={20} />
              </div>
              <div className="fcs-modal-file-info">
                <span className="fcs-modal-file-name" title={folderUnlockTarget.name}>
                  {folderUnlockTarget.name}
                </span>
                <span className="fcs-modal-file-size">{folderUnlockTarget.fileCount} ไฟล์ในแฟ้ม</span>
              </div>
            </div>

            <label className="fcs-label">
              <span>รหัสผ่านแฟ้ม</span>
              <div className="fcs-password">
                <input
                  autoFocus
                  type={showFolderPassword ? "text" : "password"}
                  value={folderPasswordInput}
                  onChange={(event) => setFolderPasswordInput(event.target.value)}
                  autoComplete="current-password"
                  placeholder="กรอกรหัสผ่านของแฟ้มนี้"
                  required
                />
                <button
                  type="button"
                  className="fcs-icon-btn"
                  onClick={() => setShowFolderPassword((open) => !open)}
                  aria-label={showFolderPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  title={showFolderPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                >
                  {showFolderPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <div className="fcs-dialog-actions">
              <button
                type="button"
                className="fcs-ghost"
                onClick={() => setFolderUnlockTarget(null)}
                disabled={folderUnlockBusy}
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="fcs-primary"
                disabled={folderUnlockBusy || !folderPasswordInput.trim()}
              >
                {folderUnlockBusy ? (
                  <>
                    <span className="fcs-btn-spin" />
                    <span>กำลังตรวจสอบ</span>
                  </>
                ) : (
                  <>
                    <Lock size={15} />
                    <span>ปลดล็อกแฟ้ม</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
