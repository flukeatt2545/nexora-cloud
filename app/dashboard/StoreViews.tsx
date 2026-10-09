"use client";

import React, { useState, useEffect, useCallback } from "react";
import { 
  Plus, Minus, Edit2, Trash2, Search, X, 
  FolderOpen, Package, AlertCircle, Save, Check,
  Eye, EyeOff, LayoutGrid, Tag, Layers, ChevronUp, ChevronDown,
  Bold, Heading2, Link as LinkIcon, List, RemoveFormatting, Image as ImageIcon, Loader2, Upload
} from "lucide-react";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { API_BASE } from "../runtime";
import SmartImage from "../components/SmartImage";
import NoCoverArt from "../components/NoCoverArt";
import CoverCropper from "../components/CoverCropper";
import { coverCropStyle, type CoverCrop } from "../lib/coverCrop";
import { useEscape, useScrollLock } from "./useScrollLock";

async function api<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    const error = new Error(errorData?.error || "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ") as Error & { code?: string };
    error.code = errorData?.code;
    throw error;
  }
  return res.json();
}

type StoreCategory = {
  id: number;
  name: string;
  isVisible: boolean;
  sortOrder: number;
  createdAt: string;
};

type StoreProduct = {
  id: number;
  categoryId: number;
  title: string;
  description: string;
  price: number;
  stock: number;
  isRecommended: boolean;
  isPopular: boolean;
  isSoldOut: boolean;
  isVisible: boolean;
  coverImageUrl: string;
  coverCrop?: CoverCrop | null;
  fileKey: string;
  createdAt: string;
  soldCount?: number;
  revenue?: number;
};

// Only the cover is shown. The product file/link is what buyers pay for, so the store never
// reveals it as a picture; the admin card shows exactly what customers see.
export function resolveProductCover(coverImageUrl?: string): string {
  return coverImageUrl?.trim() || "";
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

// Shows Thai and other non-ASCII characters instead of %E0%B8... runs.
function readableUrl(url: string) {
  try {
    return decodeURI(url).replace(/^https?:\/\//i, "");
  } catch {
    return url.replace(/^https?:\/\//i, "");
  }
}

function LinkThumb({ url, tryImage }: { url: string; tryImage: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!tryImage || failed) {
    return <span className="spf-delivery-icon" aria-hidden="true"><LinkIcon size={15} /></span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="spf-delivery-icon spp-link-thumb" aria-hidden="true"><img src={url} alt="" loading="lazy" onError={() => setFailed(true)} /></span>;
}

const SAVED_LINKS_KEY = "store_saved_links";
const SAVED_COVER_LINKS_KEY = "store_saved_cover_links";
const SAVED_LINKS_SPLIT_KEY = "store_saved_links_split";

// A Thai key pressed while editing a link lands inside the domain (media.tenor.cเหเom). The browser
// then asks for a punycode host that does not exist (media.tenor.xn--com-6ol0gb) and the image never
// loads, so catch it here. Thai labels (ตัวอย่าง.ไทย, ร้าน24.com) are real domains and pass; registries
// do not allow Thai and Latin letters in one label, so that mix can only be a typo.
function linkProblem(value?: string): string {
  const url = (value || "").trim();
  if (!url || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return "";
  if (!/^https?:\/\//i.test(url)) return "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://";
  if (/\s/.test(url)) return "ลิงก์มีช่องว่างปนอยู่ ลบช่องว่างออกก่อน";
  const host = /^https?:\/\/(?:[^@/?#]*@)?([^/?#:]*)/i.exec(url)?.[1] || "";
  if (!host) return "ลิงก์ไม่มีชื่อเว็บไซต์";
  if (host.split(".").some((label) => /[\u0E00-\u0E7F]/.test(label) && /[a-z]/i.test(label))) {
    return `ชื่อเว็บ "${host}" มีตัวอักษรไทยปนอยู่ น่าจะพิมพ์ผิดตอนลืมเปลี่ยนภาษา`;
  }
  try { new URL(url); } catch { return "ลิงก์ไม่ถูกต้อง"; }
  return "";
}

function looksLikeImageLink(url: string) {
  return isImageLink(url) || /^https?:\/\/(media\d*\.tenor\.com|media\d*\.giphy\.com|i\.imgur\.com)\//i.test(url.trim());
}

function isImageLink(value?: string) {
  return !!value && /^https?:\/\//i.test(value.trim()) && /\.(jpe?g|gif|png|webp|avif)(\?|#|$)/i.test(value.trim());
}

// ==========================================
// RICH TEXT EDITOR
// ==========================================
function RichTextEditor({ value, onChange, placeholder, labelledBy }: { value: string, onChange: (val: string) => void, placeholder?: string, labelledBy?: string }) {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const savedRangeRef = React.useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = value || "";
    }
  }, [value]);

  const exec = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const addLink = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedRangeRef.current = selection.getRangeAt(0);
    } else {
      savedRangeRef.current = null;
    }
    setLinkUrl("https://");
    setLinkModalOpen(true);
  };

  const confirmLink = () => {
    if (savedRangeRef.current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(savedRangeRef.current);
    }
    if (linkUrl && linkUrl !== "https://" && linkUrl.trim() !== "") {
      exec('createLink', linkUrl);
    }
    setLinkModalOpen(false);
  };

  const tool = (label: string, icon: React.ReactNode, action: () => void, tone = "") => (
    <button type="button" className={`rte-tool${tone ? ` ${tone}` : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={action} title={label} aria-label={label}>{icon}</button>
  );

  return (
    <div className="rte">
      <div className="rte-toolbar" role="toolbar" aria-label="จัดรูปแบบข้อความ">
        {tool("ตัวหนา", <Bold size={15} />, () => exec("bold"))}
        {tool("หัวข้อ", <Heading2 size={15} />, () => exec("formatBlock", "H3"))}
        {tool("รายการ", <List size={15} />, () => exec("insertUnorderedList"))}
        <span className="rte-sep" aria-hidden="true" />
        {tool("แทรกลิงก์", <LinkIcon size={15} />, addLink)}
        {tool("ล้างรูปแบบ", <RemoveFormatting size={15} />, () => exec("removeFormat"), "muted")}
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        onInput={handleInput}
        onBlur={handleInput}
        data-placeholder={placeholder}
        className="rich-text-content"
      />
      {linkModalOpen && (
        <div className="system-dialog-backdrop rte-link-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setLinkModalOpen(false)}>
          <section className="rte-link-dialog" role="dialog" aria-modal="true" aria-labelledby="rte-link-title">
            <h3 id="rte-link-title">แทรกลิงก์</h3>
            <label className="spf-field">
              <span className="spf-label">ลิงก์</span>
              <input
                className="spf-input"
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmLink(); } if (e.key === "Escape") { e.stopPropagation(); setLinkModalOpen(false); } }}
              />
            </label>
            <div className="rte-link-actions">
              <button type="button" className="store-prod-btn" onClick={() => setLinkModalOpen(false)}>ยกเลิก</button>
              <button type="button" className="dash-primary" onClick={confirmLink}>แทรกลิงก์</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ==========================================
function StoreCategoryVisibilityBadge({ visible }: { visible: boolean }) {
  return (
    <span className={`store-cat-badge ${visible ? "is-visible" : "is-hidden"}`}>
      <i aria-hidden="true" />
      {visible ? "แสดงผล" : "ซ่อนอยู่"}
    </span>
  );
}

// STORE CATEGORIES VIEW
// ==========================================
export function StoreCategoriesView({ notify, ask }: { notify: any; ask: any }) {
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [productCounts, setProductCounts] = useState<Record<number, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<StoreCategory>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [autoAnimateList] = useAutoAnimate<HTMLUListElement>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, products] = await Promise.all([
        api<{ items: StoreCategory[] }>("/api/admin/store/categories"),
        api<{ items: StoreProduct[] }>("/api/admin/store/products").catch(() => null),
      ]);
      setCategories(data.items || []);
      setFailed(false);
      if (products) {
        const counts: Record<number, number> = {};
        for (const product of products.items || []) counts[product.categoryId] = (counts[product.categoryId] || 0) + 1;
        setProductCounts(counts);
      }
    } catch (e: any) {
      setFailed(true);
      notify({ kind: "error", text: e.message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const closeEditor = useCallback(() => { if (!saving) setEditingId(null); }, [saving]);

  useEscape(editingId !== null, closeEditor);
  useScrollLock(editingId !== null);

  const handleSave = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const name = (editForm.name || "").trim();
    if (!name) { setErrors({ name: "กรุณาระบุชื่อหมวดหมู่" }); return; }
    if (categories.some((c) => c.id !== editingId && c.name.trim().toLowerCase() === name.toLowerCase())) {
      setErrors({ name: "มีหมวดหมู่ชื่อนี้อยู่แล้ว" });
      return;
    }
    setErrors({});
    setSaving(true);
    const body = JSON.stringify({ name, isVisible: editForm.isVisible ?? true, sortOrder: editForm.sortOrder ?? 0 });
    try {
      if (editingId === 0) {
        await api("/api/admin/store/categories", { method: "POST", body });
        notify({ kind: "success", text: "เพิ่มหมวดหมู่เรียบร้อยแล้ว" });
      } else {
        await api(`/api/admin/store/categories/${editingId}`, { method: "PUT", body });
        notify({ kind: "success", text: "บันทึกการแก้ไขเรียบร้อยแล้ว" });
      }
      setEditingId(null);
      load();
    } catch (e: any) {
      notify({ kind: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const update = (category: StoreCategory, patch: Partial<StoreCategory>) =>
    api(`/api/admin/store/categories/${category.id}`, { method: "PUT", body: JSON.stringify({ name: category.name, isVisible: category.isVisible, sortOrder: category.sortOrder, ...patch }) });

  const toggleVisible = async (category: StoreCategory) => {
    setBusyId(category.id);
    setCategories((list) => list.map((c) => (c.id === category.id ? { ...c, isVisible: !c.isVisible } : c)));
    try {
      await update(category, { isVisible: !category.isVisible });
      notify({ kind: "success", text: category.isVisible ? `ซ่อน "${category.name}" จากหน้าร้านแล้ว` : `แสดง "${category.name}" บนหน้าร้านแล้ว` });
    } catch (e: any) {
      setCategories((list) => list.map((c) => (c.id === category.id ? { ...c, isVisible: category.isVisible } : c)));
      notify({ kind: "error", text: e.message });
    } finally {
      setBusyId(null);
    }
  };

  // Moving renumbers the whole list 0..n so the order is unambiguous even if old values repeated.
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    const renumbered = next.map((c, i) => ({ ...c, sortOrder: i }));
    const changed = renumbered.filter((c) => categories.find((old) => old.id === c.id)?.sortOrder !== c.sortOrder);
    setBusyId(categories[index].id);
    setCategories(renumbered);
    try {
      await Promise.all(changed.map((c) => update(c, { sortOrder: c.sortOrder })));
    } catch (e: any) {
      notify({ kind: "error", text: e.message });
      load();
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (category: StoreCategory) => {
    const count = productCounts?.[category.id] || 0;
    if (count > 0) {
      notify({ kind: "error", text: `ลบ "${category.name}" ไม่ได้ เพราะยังมีสินค้า ${count} รายการ ย้ายสินค้าไปหมวดอื่นก่อน` });
      return;
    }
    ask({
      title: "ลบหมวดหมู่",
      message: `ลบหมวดหมู่ "${category.name}" ใช่ไหม? ลบแล้วกู้คืนไม่ได้`,
      confirmLabel: "ลบหมวดหมู่",
      danger: true,
      action: async () => {
        try {
          await api(`/api/admin/store/categories/${category.id}`, { method: "DELETE" });
          notify({ kind: "success", text: "ลบหมวดหมู่แล้ว" });
          load();
        } catch (e: any) {
          notify({ kind: "error", text: e.message });
        }
      },
    });
  };

  const query = search.trim().toLowerCase();
  const filtered = query ? categories.filter((c) => c.name.toLowerCase().includes(query)) : categories;
  const visibleCount = categories.filter((c) => c.isVisible).length;

  function openCreate() {
    const nextOrder = categories.reduce((max, c) => Math.max(max, c.sortOrder + 1), 0);
    setEditForm({ name: "", isVisible: true, sortOrder: nextOrder });
    setErrors({});
    setEditingId(0);
  }

  function openEdit(category: StoreCategory) {
    setEditForm(category);
    setErrors({});
    setEditingId(category.id);
  }

  return (
    <div className="aov store-cats">
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">ร้านค้า</p>
          <h1>หมวดหมู่สินค้า</h1>
          <p className="aov-sub">จัดกลุ่มสินค้าและเรียงลำดับที่ลูกค้าเห็นบนหน้าร้าน</p>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn aov-btn-primary" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" /> สร้างหมวดหมู่
          </button>
        </div>
      </header>

      <section className="aov-panel">
        <div className="th-filters">
          <label className="th-search">
            <Search size={17} aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && search) { e.preventDefault(); setSearch(""); } }}
              placeholder="ค้นหาหมวดหมู่" aria-label="ค้นหาหมวดหมู่" />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
          </label>
        </div>
        <div className="th-meta" aria-live="polite">
          <span>{loading && !categories.length ? "กำลังโหลด..." : query ? `พบ ${filtered.length} จาก ${categories.length} หมวดหมู่` : `${categories.length} หมวดหมู่ · แสดงบนหน้าร้าน ${visibleCount}`}</span>
          {query ? null : categories.length > 1 && <span className="sc-hint">ใช้ลูกศรเพื่อเรียงลำดับ</span>}
        </div>

        {failed && !categories.length ? (
          <div className="aov-empty">โหลดข้อมูลไม่ได้ <button type="button" onClick={load}>ลองอีกครั้ง</button></div>
        ) : !loading && filtered.length === 0 ? (
          <div className="sc-empty">
            <Layers size={26} aria-hidden="true" />
            <strong>{query ? "ไม่พบหมวดหมู่ที่ค้นหา" : "ยังไม่มีหมวดหมู่"}</strong>
            <span>{query ? "ลองเปลี่ยนคำค้นหา" : "สร้างหมวดหมู่แรกเพื่อเริ่มจัดสินค้าบนหน้าร้าน"}</span>
            {!query && <button type="button" className="aov-btn aov-btn-primary" onClick={openCreate}><Plus size={16} aria-hidden="true" /> สร้างหมวดหมู่</button>}
          </div>
        ) : (
          <ul className="sc-list" ref={autoAnimateList}>
            {filtered.map((category) => {
              const index = categories.findIndex((c) => c.id === category.id);
              const count = productCounts ? productCounts[category.id] || 0 : undefined;
              const busy = busyId !== null;
              return (
                <li key={category.id} className={category.isVisible ? "" : "is-hidden"}>
                  {!query && (
                    <span className="sc-order" role="group" aria-label={`ลำดับของ ${category.name}`}>
                      <button type="button" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="เลื่อนขึ้น" title="เลื่อนขึ้น"><ChevronUp size={16} /></button>
                      <button type="button" onClick={() => move(index, 1)} disabled={busy || index === categories.length - 1} aria-label="เลื่อนลง" title="เลื่อนลง"><ChevronDown size={16} /></button>
                    </span>
                  )}
                  <span className="sc-icon" aria-hidden="true"><Tag size={16} /></span>
                  <span className="sc-main">
                    <strong>{category.name}</strong>
                    <small>{count === undefined ? `ลำดับ ${index + 1}` : count === 0 ? "ยังไม่มีสินค้า" : `${count} สินค้า`}{!category.isVisible && " · ซ่อนจากหน้าร้าน"}</small>
                  </span>
                  <button type="button" role="switch" aria-checked={category.isVisible} className={`sc-switch${category.isVisible ? " is-on" : ""}`}
                    onClick={() => toggleVisible(category)} disabled={busyId === category.id} aria-label={`แสดง ${category.name} บนหน้าร้าน`} title={category.isVisible ? "แสดงบนหน้าร้าน" : "ซ่อนอยู่"}>
                    <span aria-hidden="true" />
                    <em>{category.isVisible ? "แสดง" : "ซ่อน"}</em>
                  </button>
                  <span className="sc-actions">
                    <button type="button" onClick={() => openEdit(category)} aria-label={`แก้ไข ${category.name}`} title="แก้ไข"><Edit2 size={15} /></button>
                    <button type="button" className="danger" onClick={() => handleDelete(category)} aria-label={`ลบ ${category.name}`} title="ลบ"><Trash2 size={15} /></button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editingId !== null && (
        <div className="system-dialog-backdrop store-cat-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closeEditor()}>
          <form className="store-cat-dialog" role="dialog" aria-modal="true" aria-labelledby="store-cat-dialog-title" onSubmit={handleSave} noValidate>
            <header className="store-cat-dialog-header">
              <h2 id="store-cat-dialog-title">{editingId === 0 ? "สร้างหมวดหมู่ใหม่" : "แก้ไขหมวดหมู่"}</h2>
              <button type="button" className="store-cat-dialog-close" onClick={closeEditor} aria-label="ปิด" disabled={saving}>
                <X size={18} />
              </button>
            </header>

            <div className="store-cat-dialog-body">
              <div className="store-cat-field">
                <span className="store-cat-label-row">
                  <label htmlFor="store-cat-name">ชื่อหมวดหมู่</label>
                  <small aria-live="polite">{(editForm.name || "").length}/80</small>
                </span>
                <input
                  id="store-cat-name"
                  type="text"
                  className={errors.name ? "is-invalid" : undefined}
                  value={editForm.name || ""}
                  maxLength={80}
                  required
                  enterKeyHint="done"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? "store-cat-name-error" : undefined}
                  onChange={(e) => {
                    setEditForm({ ...editForm, name: e.target.value });
                    if (errors.name) setErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  placeholder="เช่น ไอเท็มในเกม, สคริปต์"
                  autoFocus
                />
                {errors.name && <small id="store-cat-name-error" className="store-cat-error" role="alert">{errors.name}</small>}
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={editForm.isVisible ?? true}
                className={`store-cat-toggle ${editForm.isVisible ?? true ? "on" : ""}`}
                onClick={() => setEditForm({ ...editForm, isVisible: !(editForm.isVisible ?? true) })}
              >
                <span className="store-cat-toggle-copy">
                  <strong>แสดงบนหน้าร้าน</strong>
                  <small>{editForm.isVisible ?? true ? "ลูกค้าเห็นหมวดนี้และสินค้าในหมวด" : "ซ่อนไว้ ลูกค้ายังไม่เห็นหมวดนี้"}</small>
                </span>
                <span className="store-cat-switch" aria-hidden="true" />
              </button>
              {editingId === 0 && <p className="store-cat-note">หมวดใหม่จะต่อท้ายรายการ เปลี่ยนลำดับได้ด้วยลูกศรในหน้ารายการ</p>}
            </div>

            <footer className="store-cat-dialog-actions">
              <button type="button" className="store-cat-btn" onClick={closeEditor} disabled={saving}>ยกเลิก</button>
              <button type="submit" className="dash-primary" disabled={saving || !(editForm.name || "").trim()}>
                {saving ? "กำลังบันทึก..." : editingId === 0 ? "สร้างหมวดหมู่" : "บันทึก"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

// ==========================================
// STORE PRODUCTS VIEW
// ==========================================
export function StoreProductsView({ notify, ask }: { notify: any; ask: any }) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [files, setFiles] = useState<{ key?: string; name?: string; size: number; url?: string }[]>([]);
  // Covers have their own library (store-covers/) so the two pickers never mix.
  const [coverFiles, setCoverFiles] = useState<{ key?: string; name?: string; size: number; url?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number | "all">("all");
  const [visibility, setVisibility] = useState<"all" | "visible" | "hidden">("all");
  const [autoAnimateProducts] = useAutoAnimate<HTMLDivElement>();
  
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<StoreProduct>>({});
  const [showFileSelect, setShowFileSelect] = useState(false);
  const [fileSelectTarget, setFileSelectTarget] = useState<'fileKey' | 'coverImageUrl'>('fileKey');
  const [fileSelectMode, setFileSelectMode] = useState<'files'|'links'>('files');
  const [fileCategoryFilter, setFileCategoryFilter] = useState('all');
  const [fileSearch, setFileSearch] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [savedLinks, setSavedLinks] = useState<{url: string, label: string}[]>([]);
  const [savedCoverLinks, setSavedCoverLinks] = useState<{url: string, label: string}[]>([]);
  const [removeLinkTarget, setRemoveLinkTarget] = useState<{ url: string; label: string } | null>(null);
  const [upload, setUpload] = useState<{ name: string; percent: number } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);
  const uploadXhrRef = React.useRef<XMLHttpRequest | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pricing, setPricing] = useState<"free" | "paid">("free");
  const [stockMode, setStockMode] = useState<"unlimited" | "limited">("unlimited");
  const [saving, setSaving] = useState(false);
  const [snapshot, setSnapshot] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);

  const formState = JSON.stringify({ editForm, pricing, stockMode });
  const dirty = editingId !== null && snapshot !== "" && formState !== snapshot;

  function openEditor(id: number, form: Partial<StoreProduct>) {
    const nextPricing = (form.price || 0) > 0 ? "paid" : "free";
    const nextStock = (form.stock ?? -1) < 0 ? "unlimited" : "limited";
    setEditForm(form);
    setPricing(nextPricing);
    setStockMode(nextStock);
    setSnapshot(JSON.stringify({ editForm: form, pricing: nextPricing, stockMode: nextStock }));
    setErrors({});
    setConfirmClose(false);
    setEditingId(id);
  }

  function closeEditor() {
    setConfirmClose(false);
    setEditingId(null);
  }

  function requestClose() {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else closeEditor();
  }

  function openPicker(target: "fileKey" | "coverImageUrl") {
    const value = ((target === "fileKey" ? editForm.fileKey : editForm.coverImageUrl) || "").trim();
    const isLibraryCover = target === "coverImageUrl" && coverFiles.some((f) => !!f.url && value.endsWith(f.url));
    setFileSelectTarget(target);
    setFileCategoryFilter("all");
    setFileSearch("");
    setUploadError("");
    setDragOver(false);
    const asLink = /^https?:\/\//i.test(value) && !isLibraryCover;
    setFileSelectMode(asLink ? "links" : "files");
    if (asLink) setNewLinkUrl(value);
    setShowFileSelect(true);
  }

  function pickFor(target: "fileKey" | "coverImageUrl", value: string) {
    if (target === "fileKey") setEditForm((prev) => ({ ...prev, fileKey: value }));
    else setEditForm((prev) => ({ ...prev, coverImageUrl: value, coverCrop: prev.coverImageUrl === value ? prev.coverCrop : null }));
    setShowFileSelect(false);
  }

  useEffect(() => {
    if (!showFileSelect) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (removeLinkTarget) setRemoveLinkTarget(null);
      else closePicker();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFileSelect, removeLinkTarget]);

  // A new file or link replaces the one the "file missing" error was about.
  useEffect(() => {
    setErrors((prev) => (prev.fileKey ? { ...prev, fileKey: "" } : prev));
  }, [editForm.fileKey]);

  useEffect(() => {
    if (editingId === null || showFileSelect) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".rte-link-dialog")) return;
      event.preventDefault();
      if (confirmClose) setConfirmClose(false);
      else requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    type SavedLink = { url: string; label: string };
    const read = (key: string): SavedLink[] => {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(value) ? value.filter((l) => l && typeof l.url === "string").map((l) => ({ url: l.url, label: String(l.label || l.url) })) : [];
      } catch {
        return [];
      }
    };
    let product = read(SAVED_LINKS_KEY);
    let cover = read(SAVED_COVER_LINKS_KEY);
    try {
      // Links used to share one list. Move the image links to the cover list once.
      if (!localStorage.getItem(SAVED_LINKS_SPLIT_KEY)) {
        const moved = product.filter((l) => looksLikeImageLink(l.url) && !cover.some((c) => c.url === l.url));
        cover = [...cover, ...moved];
        product = product.filter((l) => !looksLikeImageLink(l.url));
        localStorage.setItem(SAVED_LINKS_KEY, JSON.stringify(product));
        localStorage.setItem(SAVED_COVER_LINKS_KEY, JSON.stringify(cover));
        localStorage.setItem(SAVED_LINKS_SPLIT_KEY, "1");
      }
    } catch {}
    setSavedLinks(product);
    setSavedCoverLinks(cover);
  }, []);

  const storeSavedLinks = (forCover: boolean, links: { url: string; label: string }[]) => {
    (forCover ? setSavedCoverLinks : setSavedLinks)(links);
    try { localStorage.setItem(forCover ? SAVED_COVER_LINKS_KEY : SAVED_LINKS_KEY, JSON.stringify(links)); } catch {}
  };

  const handleSaveLink = () => {
    const url = newLinkUrl.trim();
    if (!url) return;
    const forCover = fileSelectTarget === "coverImageUrl";
    const list = forCover ? savedCoverLinks : savedLinks;
    // Saving the same link again just renames it.
    storeSavedLinks(forCover, [...list.filter((l) => l.url !== url), { url, label: newLinkLabel.trim() || url }]);
    setNewLinkUrl("");
    setNewLinkLabel("");
  };

  const handleRemoveLink = (url: string) => {
    const forCover = fileSelectTarget === "coverImageUrl";
    storeSavedLinks(forCover, (forCover ? savedCoverLinks : savedLinks).filter((l) => l.url !== url));
    setRemoveLinkTarget(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, catRes] = await Promise.all([
        api<{ items: StoreProduct[] }>("/api/admin/store/products"),
        api<{ items: StoreCategory[] }>("/api/admin/store/categories"),
      ]);
      setProducts(prodRes.items || []);
      setCategories(catRes.items || []);
    } catch (e: any) {
      notify({ kind: "error", text: e.message });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  // Uploads go straight into the store library (/api/admin/files) and the new file is
  // picked for whatever the picker was opened for.
  function uploadToLibrary(file: File) {
    if (upload) return;
    const forCover = fileSelectTarget === "coverImageUrl";
    if (forCover && !file.type.startsWith("image/")) {
      setUploadError("รูปปกต้องเป็นไฟล์รูปภาพ เช่น JPG, PNG, GIF หรือ WebP");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setUploadError(`ไฟล์ใหญ่เกิน 50MB (${formatBytes(file.size)})`);
      return;
    }
    setUploadError("");
    setUpload({ name: file.name, percent: 0 });
    const body = new FormData();
    body.append("file", file);
    const xhr = new XMLHttpRequest();
    uploadXhrRef.current = xhr;
    xhr.open("POST", `${API_BASE}/api/admin/files/upload${forCover ? "?kind=cover" : ""}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setUpload({ name: file.name, percent: Math.round((event.loaded / event.total) * 100) });
    };
    xhr.onload = () => {
      uploadXhrRef.current = null;
      setUpload(null);
      const payload = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
      if (xhr.status < 200 || xhr.status >= 300) {
        setUploadError(payload.error || "อัปโหลดไม่สำเร็จ");
        return;
      }
      void loadFiles();
      const url = String(payload.url || "");
      const value = forCover ? (url.startsWith("http") ? url : `${API_BASE || ""}${url}`) : String(payload.filename || "");
      if (value) pickFor(fileSelectTarget, value);
      notify({ kind: "success", text: `อัปโหลด ${payload.filename || file.name} แล้ว` });
    };
    xhr.onerror = () => {
      uploadXhrRef.current = null;
      setUpload(null);
      setUploadError("เชื่อมต่อระบบอัปโหลดไม่สำเร็จ");
    };
    xhr.send(body);
  }

  function cancelUpload() {
    uploadXhrRef.current?.abort();
    uploadXhrRef.current = null;
    setUpload(null);
  }

  function closePicker() {
    cancelUpload();
    setShowFileSelect(false);
  }

  const loadFiles = async () => {
    try {
      const [productRes, coverRes] = await Promise.all([
        api<{ items: any[] }>("/api/admin/files"),
        api<{ items: any[] }>("/api/admin/files?kind=cover"),
      ]);
      setFiles(productRes.items || []);
      setCoverFiles(coverRes.items || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    load();
    loadFiles();
  }, [load]);

  const handleSave = async () => {
    if (saving) return;
    const price = pricing === "free" ? 0 : Number(editForm.price);
    const stock = stockMode === "unlimited" ? -1 : Number(editForm.stock);
    const newErrors: Record<string, string> = {};
    if (!editForm.title || !editForm.title.trim()) newErrors.title = "กรุณาระบุชื่อสินค้า";
    if (!editForm.categoryId || editForm.categoryId <= 0) newErrors.categoryId = "กรุณาเลือกหมวดหมู่";
    if (!editForm.fileKey || !editForm.fileKey.trim()) newErrors.fileKey = "เลือกไฟล์หรือลิงก์ที่จะส่งให้ลูกค้า";
    else if (linkProblem(editForm.fileKey)) newErrors.fileKey = linkProblem(editForm.fileKey);
    if (linkProblem(editForm.coverImageUrl)) newErrors.coverImageUrl = linkProblem(editForm.coverImageUrl);
    if (pricing === "paid" && !(price > 0)) newErrors.price = "ใส่ราคามากกว่า 0 หรือเลือก \"ฟรี\"";
    if (stockMode === "limited" && !(Number.isInteger(stock) && stock >= 0)) newErrors.stock = "ใส่จำนวนตั้งแต่ 0 ขึ้นไป";

    setConfirmClose(false);
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>(".spf [aria-invalid='true'], .spf .spf-delivery.is-invalid .spf-btn");
        first?.scrollIntoView({ behavior: "smooth", block: "center" });
        first?.focus({ preventScroll: true });
      });
      return;
    }
    setErrors({});
    const payload = { ...editForm, title: editForm.title?.trim(), price, stock };
    setSaving(true);
    try {
      if (editingId === 0) {
        await api("/api/admin/store/products", { method: "POST", body: JSON.stringify(payload) });
        notify({ kind: "success", text: "เพิ่มสินค้าเรียบร้อยแล้ว" });
      } else {
        await api(`/api/admin/store/products/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
        notify({ kind: "success", text: "บันทึกข้อมูลสินค้าแล้ว" });
      }
      closeEditor();
      load();
    } catch (e: any) {
      if (e?.code === "product_file_missing") {
        // Point at the field: the file sold with this product is gone from the library.
        const text = `ไม่พบไฟล์ "${(editForm.fileKey || "").trim()}" ในคลังไฟล์แล้ว กด "เปลี่ยน" เพื่อเลือกไฟล์หรือลิงก์ใหม่`;
        setErrors((prev) => ({ ...prev, fileKey: text }));
        document.querySelector(".store-file-field")?.scrollIntoView({ behavior: "smooth", block: "center" });
        notify({ kind: "error", text: "ไฟล์ที่ขายของสินค้านี้หายไปจากคลังไฟล์ กรุณาเลือกไฟล์ใหม่" });
        return;
      }
      notify({ kind: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: number, title: string) => {
    ask({
      title: "ยืนยันการลบสินค้า",
      message: `คุณต้องการลบสินค้า "${title}" หรือไม่? ถ้ามีคนซื้อไปแล้วจะลบไม่ได้ ให้ปิด "แสดงหน้าร้าน" แทน เพื่อให้ผู้ซื้อยังดาวน์โหลดได้`,
      confirmLabel: "ลบสินค้า",
      danger: true,
      action: async () => {
        try {
          await api(`/api/admin/store/products/${id}`, { method: "DELETE" });
          notify({ kind: "success", text: "ลบสินค้าสำเร็จแล้ว" });
          load();
        } catch (e: any) {
          notify({ kind: "error", text: e.message });
        }
      },
    });
  };

  const getCategoryName = (id: number) => categories.find((c) => c.id === id)?.name || "ไม่ทราบหมวดหมู่";

  const searchText = search.trim().toLowerCase();
  const filtering = Boolean(searchText || categoryFilter !== "all" || visibility !== "all");
  const filtered = products.filter((p) => {
    const matchSearch = !searchText || p.title.toLowerCase().includes(searchText);
    const matchCat = categoryFilter === "all" || p.categoryId === categoryFilter;
    const matchVisible = visibility === "all" || (visibility === "visible" ? p.isVisible : !p.isVisible);
    return matchSearch && matchCat && matchVisible;
  });

  function openCreateProduct() {
    openEditor(0, {
      categoryId: categories.length > 0 ? categories[0].id : 0,
      title: "", description: "", price: 0, stock: -1,
      isRecommended: false, isPopular: false, isSoldOut: false, isVisible: true,
      coverImageUrl: "", coverCrop: null, fileKey: "",
    });
  }

  function fileLabel(value?: string) {
    if (!value) return "ยังไม่ได้ผูกไฟล์";
    if (value.startsWith("http")) return "ลิงก์ภายนอก";
    return value.length > 28 ? `${value.slice(0, 14)}…${value.slice(-10)}` : value;
  }

  return (
    <div className="aov store-prods">
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">ร้านค้า</p>
          <h1>คลังสินค้า</h1>
          <p className="aov-sub">จัดการสินค้าดิจิทัล ราคา และไฟล์ที่ส่งให้ลูกค้า</p>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn aov-btn-primary" onClick={openCreateProduct}>
            <Plus size={16} aria-hidden="true" /> สร้างสินค้า
          </button>
        </div>
      </header>

      <section className="aov-panel">
        <div className="th-filters">
          <label className="th-search">
            <Search size={17} aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && search) { e.preventDefault(); setSearch(""); } }}
              placeholder="ค้นหาชื่อสินค้า" aria-label="ค้นหาชื่อสินค้า" />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
          </label>
          <div className="th-chips" role="group" aria-label="การแสดงผล">
            {([["all", "ทั้งหมด"], ["visible", "แสดงอยู่"], ["hidden", "ซ่อนอยู่"]] as const).map(([value, label]) => (
              <button key={value} type="button" className={visibility === value ? "is-active" : ""} aria-pressed={visibility === value} onClick={() => setVisibility(value)}>{label}</button>
            ))}
          </div>
          {categories.length > 1 && (
            <div className="th-chips sp-cats" role="group" aria-label="หมวดหมู่">
              <button type="button" className={categoryFilter === "all" ? "is-active" : ""} aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>ทุกหมวด</button>
              {categories.map((c) => (
                <button key={c.id} type="button" className={categoryFilter === c.id ? "is-active" : ""} aria-pressed={categoryFilter === c.id} onClick={() => setCategoryFilter(c.id)}>
                  {c.name}<span className="sp-count">{products.filter((p) => p.categoryId === c.id).length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="th-meta" aria-live="polite">
          <span>{loading && !products.length ? "กำลังโหลด..." : filtering ? `พบ ${filtered.length} จาก ${products.length} สินค้า` : `${products.length} สินค้า · แสดงบนหน้าร้าน ${products.filter((p) => p.isVisible).length}`}</span>
          {filtering && <button type="button" onClick={() => { setSearch(""); setCategoryFilter("all"); setVisibility("all"); }}>ล้างตัวกรอง</button>}
        </div>

        {loading && !products.length && <div className="store-prod-empty">กำลังโหลดสินค้า...</div>}

        {!loading && filtered.length === 0 && (
          <div className="sc-empty">
            <Package size={26} aria-hidden="true" />
            <strong>{filtering ? "ไม่พบสินค้าที่ตรงเงื่อนไข" : "ยังไม่มีสินค้า"}</strong>
            <span>{filtering ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง" : "สร้างสินค้าชิ้นแรกเพื่อเปิดขาย"}</span>
            {!filtering && <button type="button" className="aov-btn aov-btn-primary" onClick={openCreateProduct}><Plus size={16} aria-hidden="true" /> สร้างสินค้า</button>}
          </div>
        )}

        {filtered.length > 0 && (
          <div ref={autoAnimateProducts} className="store-prod-grid">
            {filtered.map((product) => {
              const cover = resolveProductCover(product.coverImageUrl);
              return (
                <article key={product.id} className={`store-prod-card${product.isVisible ? "" : " is-hidden"}`}>
                  <div className="store-prod-cover">
                    {cover ? (
                      <SmartImage src={cover} alt="" style={coverCropStyle(product.coverCrop)} />
                    ) : (
                      <NoCoverArt />
                    )}
                    <div className="store-prod-flags">
                      {product.isRecommended && <span className="flag recommend">แนะนำ</span>}
                      {product.isPopular && <span className="flag popular">ยอดนิยม</span>}
                      {product.isSoldOut && <span className="flag soldout">สินค้าหมด</span>}
                    </div>
                  </div>

                  <div className="store-prod-body">
                    <div className="store-prod-title-row">
                      <div className="store-prod-title">
                        <small>{getCategoryName(product.categoryId)}</small>
                        <strong>{product.title}</strong>
                      </div>
                      <span className="store-prod-price">
                        {product.price > 0 ? <>{product.price.toLocaleString("th-TH")}<small> พอยท์</small></> : "ฟรี"}
                      </span>
                    </div>

                    <div className="store-prod-meta">
                      <span><FolderOpen size={15} aria-hidden="true" /> {fileLabel(product.fileKey)}</span>
                      <span><Package size={15} aria-hidden="true" /> {product.stock === -1 ? "สต็อกไม่จำกัด" : product.stock === 0 ? "สต็อกหมด" : `เหลือ ${product.stock} ชิ้น`}</span>
                    </div>

                    <div className="store-prod-footer">
                      <span className={`store-prod-badge ${product.isVisible ? "is-visible" : "is-hidden"}`}>
                        <i aria-hidden="true" />
                        {product.isVisible ? "แสดงหน้าร้าน" : "ซ่อนอยู่"}
                      </span>
                      <div className="store-prod-actions">
                        <button type="button" className="store-prod-btn" onClick={() => openEditor(product.id, product)}>
                          <Edit2 size={14} aria-hidden="true" /> แก้ไข
                        </button>
                        <button type="button" className="store-prod-btn danger" onClick={() => handleDelete(product.id, product.title)} aria-label={`ลบ ${product.title}`} title="ลบ">
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {editingId !== null && (
        <div className="system-dialog-backdrop store-prod-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
          <section
            className="store-prod-dialog spf"
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-prod-dialog-title"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void handleSave(); }
            }}
          >
            <header className="store-prod-dialog-header">
              <div>
                {editingId !== 0 && <p>สินค้า #{editingId}</p>}
                <h2 id="store-prod-dialog-title">{editingId === 0 ? "เพิ่มสินค้าใหม่" : "แก้ไขสินค้า"}</h2>
              </div>
              <button type="button" className="store-prod-dialog-close" onClick={requestClose} aria-label="ปิด"><X size={18} /></button>
            </header>

            <div className="store-prod-dialog-body spf-body">
              <div className="spf-main">
                <section className="spf-section" aria-labelledby="spf-info">
                  <h3 id="spf-info" className="spf-section-title">ข้อมูลสินค้า</h3>
                  <div className="spf-grid-2">
                    <label className="spf-field">
                      <span className="spf-label">ชื่อสินค้า <b aria-hidden="true">*</b></span>
                      <input
                        className="spf-input"
                        type="text"
                        value={editForm.title || ""}
                        maxLength={200}
                        aria-invalid={!!errors.title}
                        onChange={(e) => { setEditForm({ ...editForm, title: e.target.value }); if (errors.title) setErrors((prev) => ({ ...prev, title: "" })); }}
                        placeholder="เช่น สคริปต์ VIP"
                      />
                      {errors.title && <small className="spf-error">{errors.title}</small>}
                    </label>
                    <label className="spf-field">
                      <span className="spf-label">หมวดหมู่ <b aria-hidden="true">*</b></span>
                      <select
                        className="spf-input spf-select"
                        value={editForm.categoryId || ""}
                        aria-invalid={!!errors.categoryId}
                        onChange={(e) => { setEditForm({ ...editForm, categoryId: parseInt(e.target.value, 10) }); if (errors.categoryId) setErrors((prev) => ({ ...prev, categoryId: "" })); }}
                      >
                        <option value="" disabled>เลือกหมวดหมู่</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      {errors.categoryId && <small className="spf-error">{errors.categoryId}</small>}
                    </label>
                  </div>
                  <div className="spf-field">
                    <span className="spf-label" id="spf-desc-label">รายละเอียด</span>
                    <RichTextEditor
                      value={editForm.description || ""}
                      onChange={(val) => setEditForm((prev) => ({ ...prev, description: val }))}
                      placeholder="คุณสมบัติ วิธีใช้ หรือสิ่งที่ลูกค้าจะได้รับ"
                      labelledBy="spf-desc-label"
                    />
                  </div>
                </section>

                <section className="spf-section store-file-field" aria-labelledby="spf-delivery">
                  <h3 id="spf-delivery" className="spf-section-title">สิ่งที่ลูกค้าได้รับ <b aria-hidden="true">*</b><small>ส่งให้ทันทีหลังซื้อ</small></h3>
                  {editForm.fileKey ? (
                    <div className={`spf-delivery${errors.fileKey ? " is-invalid" : ""}`}>
                      <span className="spf-delivery-icon" aria-hidden="true">
                        {editForm.fileKey.startsWith("http") ? <LinkIcon size={18} /> : <FolderOpen size={18} />}
                      </span>
                      <span className="spf-delivery-text">
                        <strong title={editForm.fileKey}>{editForm.fileKey}</strong>
                        <small>{editForm.fileKey.startsWith("http") ? "ลิงก์ภายนอก" : "ไฟล์ในคลัง"}</small>
                      </span>
                      <button type="button" className="spf-btn" onClick={() => openPicker("fileKey")}>เปลี่ยน</button>
                    </div>
                  ) : (
                    <button type="button" className="spf-dropzone" aria-invalid={!!errors.fileKey} onClick={() => openPicker("fileKey")}>
                      <FolderOpen size={20} aria-hidden="true" />
                      <span><strong>เลือกไฟล์หรือใส่ลิงก์</strong><small>จากคลังไฟล์ หรือลิงก์ดาวน์โหลดภายนอก</small></span>
                    </button>
                  )}
                  {errors.fileKey && <small className="spf-error">{errors.fileKey}</small>}
                </section>

                <section className="spf-section" aria-labelledby="spf-pricing">
                  <h3 id="spf-pricing" className="spf-section-title">ราคาและสต็อก</h3>
                  <div className="spf-grid-2">
                    <div className="spf-field">
                      <span className="spf-label" id="spf-price-label">ราคา</span>
                      <div className="spf-segment" role="radiogroup" aria-labelledby="spf-price-label">
                        <button type="button" role="radio" aria-checked={pricing === "free"} onClick={() => { setPricing("free"); setErrors((prev) => ({ ...prev, price: "" })); }}>ฟรี</button>
                        <button type="button" role="radio" aria-checked={pricing === "paid"} onClick={() => { setPricing("paid"); if (!editForm.price) setEditForm({ ...editForm, price: 10 }); }}>กำหนดราคา</button>
                      </div>
                      {pricing === "paid" && (
                        <div className={`spf-number${errors.price ? " is-invalid" : ""}`}>
                          <button type="button" onClick={() => setEditForm({ ...editForm, price: Math.max(1, (editForm.price || 0) - 10) })} aria-label="ลดราคา 10 พอยท์"><Minus size={15} /></button>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={1}
                            step="any"
                            value={Number.isFinite(editForm.price) ? editForm.price : ""}
                            aria-labelledby="spf-price-label"
                            aria-invalid={!!errors.price}
                            onChange={(e) => { setEditForm({ ...editForm, price: e.target.value === "" ? NaN : parseFloat(e.target.value) }); if (errors.price) setErrors((prev) => ({ ...prev, price: "" })); }}
                          />
                          <span className="spf-unit">พอยท์</span>
                          <button type="button" onClick={() => setEditForm({ ...editForm, price: (Number.isFinite(editForm.price) ? editForm.price || 0 : 0) + 10 })} aria-label="เพิ่มราคา 10 พอยท์"><Plus size={15} /></button>
                        </div>
                      )}
                      {errors.price && <small className="spf-error">{errors.price}</small>}
                    </div>
                    <div className="spf-field">
                      <span className="spf-label" id="spf-stock-label">สต็อก</span>
                      <div className="spf-segment" role="radiogroup" aria-labelledby="spf-stock-label">
                        <button type="button" role="radio" aria-checked={stockMode === "unlimited"} onClick={() => { setStockMode("unlimited"); setErrors((prev) => ({ ...prev, stock: "" })); }}>ไม่จำกัด</button>
                        <button type="button" role="radio" aria-checked={stockMode === "limited"} onClick={() => { setStockMode("limited"); if ((editForm.stock ?? -1) < 0) setEditForm({ ...editForm, stock: 1 }); }}>ระบุจำนวน</button>
                      </div>
                      {stockMode === "limited" && (
                        <div className={`spf-number${errors.stock ? " is-invalid" : ""}`}>
                          <button type="button" onClick={() => setEditForm({ ...editForm, stock: Math.max(0, (editForm.stock ?? 1) - 1) })} aria-label="ลดสต็อก"><Minus size={15} /></button>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            step={1}
                            value={Number.isFinite(editForm.stock) && (editForm.stock ?? -1) >= 0 ? editForm.stock : ""}
                            aria-labelledby="spf-stock-label"
                            aria-invalid={!!errors.stock}
                            onChange={(e) => { setEditForm({ ...editForm, stock: e.target.value === "" ? NaN : Math.max(0, parseInt(e.target.value, 10)) }); if (errors.stock) setErrors((prev) => ({ ...prev, stock: "" })); }}
                          />
                          <span className="spf-unit">ชิ้น</span>
                          <button type="button" onClick={() => setEditForm({ ...editForm, stock: Math.max(0, Number.isFinite(editForm.stock) ? editForm.stock ?? 0 : 0) + 1 })} aria-label="เพิ่มสต็อก"><Plus size={15} /></button>
                        </div>
                      )}
                      {errors.stock && <small className="spf-error">{errors.stock}</small>}
                    </div>
                  </div>
                </section>
                <section className="spf-section" aria-labelledby="spf-display">
                  <h3 id="spf-display" className="spf-section-title">การแสดงผล</h3>
                  <div className="spf-switches">
                    {([
                      ["isVisible", "แสดงหน้าร้าน", "ปิดไว้ถ้ายังไม่พร้อมขาย", true],
                      ["isRecommended", "สินค้าแนะนำ", "ติดป้าย \"แนะนำ\" บนการ์ด", false],
                      ["isPopular", "สินค้ายอดนิยม", "ติดป้าย \"ยอดนิยม\" บนการ์ด", false],
                      ["isSoldOut", "สินค้าหมด", "ลูกค้ายังเห็น แต่ซื้อไม่ได้", false],
                    ] as const).map(([key, label, hint, fallback]) => {
                      const on = editForm[key] ?? fallback;
                      return (
                        <button key={key} type="button" role="switch" aria-checked={on} className="spf-switch-row" onClick={() => setEditForm({ ...editForm, [key]: !on })}>
                          <span><strong>{label}</strong><small>{hint}</small></span>
                          <i className="spf-switch" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>

              <aside className="spf-aside">
                <section className="spf-section" aria-labelledby="spf-cover">
                  <h3 id="spf-cover" className="spf-section-title">รูปปก<small>ไม่บังคับ</small></h3>
                  {editForm.coverImageUrl?.trim() ? (
                    <CoverCropper
                      key={editForm.coverImageUrl.trim()}
                      src={editForm.coverImageUrl.trim()}
                      value={editForm.coverCrop}
                      onChange={(coverCrop) => setEditForm((prev) => ({ ...prev, coverCrop }))}
                      onRemove={() => setEditForm((prev) => ({ ...prev, coverImageUrl: "", coverCrop: null }))}
                    />
                  ) : (
                    <button type="button" className="spf-cover-empty" onClick={() => openPicker("coverImageUrl")}>
                      <ImageIcon size={22} aria-hidden="true" />
                      <strong>เลือกรูปจากคลังไฟล์</strong>
                      <small>รูปสี่เหลี่ยมจัตุรัสแสดงได้ครบที่สุด</small>
                    </button>
                  )}
                  <label className="spf-field">
                    <span className="spf-label">{editForm.coverImageUrl?.trim() ? "ลิงก์รูป" : "หรือวางลิงก์รูป"}</span>
                    <span className="spf-input-row">
                      <input
                        className="spf-input"
                        type="url"
                        inputMode="url"
                        value={editForm.coverImageUrl || ""}
                        onChange={(e) => {
                          setEditForm({ ...editForm, coverImageUrl: e.target.value, coverCrop: null });
                          if (errors.coverImageUrl) setErrors((prev) => ({ ...prev, coverImageUrl: "" }));
                        }}
                        placeholder="https://"
                        aria-invalid={!!linkProblem(editForm.coverImageUrl)}
                      />
                      {editForm.coverImageUrl?.trim() && (
                        <button type="button" className="spf-btn" onClick={() => openPicker("coverImageUrl")} aria-label="เลือกรูปปกจากคลังไฟล์" title="เลือกจากคลังไฟล์"><FolderOpen size={16} /></button>
                      )}
                    </span>
                    {linkProblem(editForm.coverImageUrl) && <small className="spf-error" role="alert">{linkProblem(editForm.coverImageUrl)}</small>}
                  </label>
                  {!editForm.coverImageUrl?.trim() && (
                    <small className="spf-note">
                      ถ้าไม่ใส่ หน้าร้านจะแสดงภาพ &quot;ยังไม่มีรูปปก&quot; ระบบไม่ใช้ไฟล์ที่ขายเป็นรูปปกให้เอง เพื่อไม่ให้ลูกค้าได้ของก่อนซื้อ
                      {isImageLink(editForm.fileKey) && (
                        <button type="button" onClick={() => setEditForm({ ...editForm, coverImageUrl: (editForm.fileKey || "").trim(), coverCrop: null })}>
                          ใช้ลิงก์สินค้าเป็นรูปปก
                        </button>
                      )}
                    </small>
                  )}
                </section>

              </aside>
            </div>

            <footer className="store-prod-dialog-actions spf-actions">
              {confirmClose ? (
                <>
                  <span className="spf-actions-note" role="alert">ยังไม่ได้บันทึกการแก้ไข</span>
                  <button type="button" className="store-prod-btn" onClick={() => setConfirmClose(false)} autoFocus>แก้ต่อ</button>
                  <button type="button" className="store-prod-btn danger" onClick={closeEditor}>ทิ้งการแก้ไข</button>
                </>
              ) : (
                <>
                  <span className="spf-actions-note">{dirty ? "มีการแก้ไขที่ยังไม่บันทึก" : ""}</span>
                  <button type="button" className="store-prod-btn" onClick={requestClose}>ยกเลิก</button>
                  <button type="button" className="dash-primary" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? <><Loader2 size={15} className="spin" aria-hidden="true" /> กำลังบันทึก</> : editingId === 0 ? "เพิ่มสินค้า" : "บันทึก"}
                  </button>
                </>
              )}
            </footer>
          </section>
        </div>
      )}

      {showFileSelect && (() => {
        const forCover = fileSelectTarget === "coverImageUrl";
        const current = (forCover ? editForm.coverImageUrl : editForm.fileKey) || "";
        const query = fileSearch.trim().toLowerCase();
        const library = forCover ? coverFiles : files;
        const links = forCover ? savedCoverLinks : savedLinks;
        const visibleFiles = library.filter((f) => {
          const name = f.name || f.key || "";
          if (query && !name.toLowerCase().includes(query)) return false;
          const ext = name.split(".").pop()?.toLowerCase() || "";
          if (fileCategoryFilter === "image") return ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext);
          if (fileCategoryFilter === "document") return ["pdf", "doc", "docx", "txt", "xlsx", "csv", "md"].includes(ext);
          if (fileCategoryFilter === "archive") return ["zip", "rar", "7z", "gz", "tar"].includes(ext);
          if (fileCategoryFilter === "code") return ["js", "ts", "json", "html", "css", "py", "rs", "go", "lua"].includes(ext);
          return true;
        });
        const linkError = linkProblem(newLinkUrl) || (newLinkUrl.trim() && !/^https?:\/\//i.test(newLinkUrl.trim()) ? "ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://" : "");
        const linkValid = !!newLinkUrl.trim() && !linkError;
        const filtered = !!query || fileCategoryFilter !== "all";
        return (
          <div className="system-dialog-backdrop store-prod-backdrop spp-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && closePicker()}>
            <section className="spp" role="dialog" aria-modal="true" aria-labelledby="spp-title">
              <header className="spp-header">
                <div>
                  <h2 id="spp-title">{forCover ? "เลือกรูปปก" : "เลือกสิ่งที่ลูกค้าได้รับ"}</h2>
                  <p>{forCover ? "คลังรูปปก แยกจากไฟล์ที่ขาย ลูกค้าเห็นรูปนี้บนการ์ดสินค้า" : "คลังไฟล์สินค้า แยกจากรูปปก ส่งให้ลูกค้าหลังซื้อ"}</p>
                </div>
                <button type="button" className="store-prod-dialog-close" onClick={closePicker} aria-label="ปิด"><X size={18} /></button>
              </header>

              <div className="spp-tabs">
                <div className="spf-segment" role="tablist" aria-label="แหล่งที่มา">
                  <button type="button" role="tab" aria-selected={fileSelectMode === "files"} onClick={() => setFileSelectMode("files")}>
                    <FolderOpen size={14} aria-hidden="true" /> {forCover ? "คลังรูปปก" : "คลังไฟล์สินค้า"}
                  </button>
                  <button type="button" role="tab" aria-selected={fileSelectMode === "links"} onClick={() => setFileSelectMode("links")}>
                    <LinkIcon size={14} aria-hidden="true" /> ลิงก์
                  </button>
                </div>
              </div>

              {fileSelectMode === "files" ? (
                <>
                  <div className="spp-toolbar">
                    <div className="spp-search-row">
                      <label className="spp-search">
                        <Search size={15} aria-hidden="true" />
                        <input type="search" placeholder="ค้นหาชื่อไฟล์" value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} aria-label="ค้นหาชื่อไฟล์" autoFocus />
                      </label>
                      <button type="button" className="spf-btn spp-upload-btn" onClick={() => uploadInputRef.current?.click()} disabled={!!upload}>
                        <Upload size={15} aria-hidden="true" /> <span>อัปโหลด</span>
                      </button>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        hidden
                        accept={forCover ? "image/*" : undefined}
                        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) uploadToLibrary(file); }}
                      />
                    </div>
                    {upload && (
                      <div className="spp-upload-status" role="status">
                        <Loader2 size={14} className="spin" aria-hidden="true" />
                        <span className="spp-upload-name">กำลังอัปโหลด <strong>{upload.name}</strong></span>
                        <span className="spp-upload-bar" aria-hidden="true"><i style={{ width: `${upload.percent}%` }} /></span>
                        <b>{upload.percent}%</b>
                        <button type="button" onClick={cancelUpload}>ยกเลิก</button>
                      </div>
                    )}
                    {uploadError && <small className="spf-error" role="alert">{uploadError}</small>}
                    {!forCover && <div className="spp-chips" role="group" aria-label="ประเภทไฟล์">
                      {[
                        { id: "all", label: "ทั้งหมด" },
                        { id: "image", label: "รูปภาพ" },
                        { id: "archive", label: "ไฟล์บีบอัด" },
                        { id: "document", label: "เอกสาร" },
                        { id: "code", label: "โค้ด" },
                      ].map((cat) => (
                        <button key={cat.id} type="button" aria-pressed={fileCategoryFilter === cat.id} onClick={() => setFileCategoryFilter(cat.id)}>{cat.label}</button>
                      ))}
                    </div>}
                  </div>
                  <div
                    className={`spp-body${dragOver ? " is-dragover" : ""}`}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files?.[0]; if (file) uploadToLibrary(file); }}
                  >
                    {dragOver && <div className="spp-drop-hint" aria-hidden="true"><Upload size={22} /> ปล่อยไฟล์เพื่ออัปโหลด</div>}
                    {visibleFiles.length === 0 ? (
                      library.length > 0 && filtered ? (
                        <div className="spp-empty">
                          <FolderOpen size={26} aria-hidden="true" />
                          <strong>ไม่พบไฟล์ที่ตรงกับตัวกรอง</strong>
                          <span>ลองเปลี่ยนคำค้นหาหรือประเภทไฟล์ หรืออัปโหลดไฟล์ใหม่</span>
                          <div className="spp-empty-actions">
                            <button type="button" className="spf-btn" onClick={() => { setFileSearch(""); setFileCategoryFilter("all"); }}>ล้างตัวกรอง</button>
                            <button type="button" className="spf-btn" onClick={() => uploadInputRef.current?.click()} disabled={!!upload}><Upload size={15} aria-hidden="true" /> อัปโหลด</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="spp-empty spp-upload-zone" onClick={() => uploadInputRef.current?.click()} disabled={!!upload}>
                          <Upload size={26} aria-hidden="true" />
                          <strong>{forCover ? "อัปโหลดรูปปก" : "ยังไม่มีไฟล์ในคลัง อัปโหลดไฟล์แรกได้เลย"}</strong>
                          <span>ลากไฟล์มาวางตรงนี้ หรือกดเพื่อเลือกไฟล์ (สูงสุด 50MB)</span>
                        </button>
                      )
                    ) : (
                      <div className="spp-grid">
                        {visibleFiles.map((f) => {
                          const name = f.name || f.key || "";
                          const isImage = /\.(jpe?g|gif|png|webp|svg|avif)$/i.test(name);
                          const fileUrl = f.url?.startsWith("http") ? f.url : `${API_BASE || ""}${f.url || ""}`;
                          const value = forCover ? fileUrl : name;
                          const selected = current === value;
                          const ext = name.includes(".") ? name.split(".").pop()!.toUpperCase().slice(0, 4) : "FILE";
                          return (
                            <button key={f.key || name} type="button" className="spp-tile" aria-pressed={selected} onClick={() => pickFor(fileSelectTarget, value)} title={name}>
                              <span className="spp-thumb">
                                {isImage ? <SmartImage src={fileUrl} alt="" compact /> : <span className="spp-ext">{ext}</span>}
                                {selected && <span className="spp-check" aria-hidden="true"><Check size={13} /></span>}
                              </span>
                              <span className="spp-name">{name}</span>
                              <span className="spp-size">{formatBytes(f.size)}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <footer className="spp-footer">
                    <span>{visibleFiles.length.toLocaleString("th-TH")} ไฟล์{filtered ? ` จาก ${library.length.toLocaleString("th-TH")}` : ""}</span>
                    <span className="spp-footer-hint">ลากไฟล์มาวางเพื่ออัปโหลดได้</span>
                  </footer>
                </>
              ) : (
                <div className="spp-body spp-links">
                  <form className="spp-link-form" onSubmit={(e) => { e.preventDefault(); if (linkValid) pickFor(fileSelectTarget, newLinkUrl.trim()); }}>
                    <label className="spf-field">
                      <span className="spf-label">{forCover ? "ลิงก์รูป" : "ลิงก์ดาวน์โหลด"}</span>
                      <input className="spf-input" type="url" inputMode="url" placeholder={forCover ? "https://.../cover.jpg" : "https://drive.google.com/..."} value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} autoFocus aria-invalid={!!newLinkUrl.trim() && !linkValid} />
                      {!!newLinkUrl.trim() && linkError && <small className="spf-error" role="alert">{linkError}</small>}
                    </label>
                    <label className="spf-field">
                      <span className="spf-label">ชื่อเรียก <small>(ไม่บังคับ ใช้ตอนบันทึกเก็บไว้)</small></span>
                      <input className="spf-input" type="text" placeholder="เช่น ไฟล์ติดตั้ง v2" value={newLinkLabel} onChange={(e) => setNewLinkLabel(e.target.value)} />
                    </label>
                    <div className="spp-link-actions">
                      <button type="button" className="spf-btn" onClick={handleSaveLink} disabled={!linkValid}>บันทึกเก็บไว้</button>
                      <button type="submit" className="dash-primary" disabled={!linkValid}>ใช้ลิงก์นี้</button>
                    </div>
                  </form>

                  <div className="spp-saved">
                    <h3>{forCover ? "ลิงก์รูปที่บันทึกไว้" : "ลิงก์ที่บันทึกไว้"} <small>{links.length}</small></h3>
                    {links.length === 0 ? (
                      <p className="spp-saved-empty">ยังไม่มีลิงก์ที่บันทึกไว้ ลิงก์ที่บันทึกจะเก็บไว้ในเบราว์เซอร์นี้</p>
                    ) : (
                      <ul>
                        {links.map((link) => (
                          <li key={link.url} className={current === link.url ? "is-selected" : ""}>
                            <button type="button" className="spp-saved-pick" onClick={() => pickFor(fileSelectTarget, link.url)}>
                              <LinkThumb url={link.url} tryImage={forCover || isImageLink(link.url)} />
                              <span className="spf-delivery-text"><strong title={link.label}>{link.label}</strong><small title={link.url}>{readableUrl(link.url)}</small></span>
                              {current === link.url && <Check size={15} className="spp-saved-check" aria-label="เลือกอยู่" />}
                            </button>
                            <button type="button" className="spp-saved-remove" onClick={() => setRemoveLinkTarget(link)} aria-label={`ลบลิงก์ ${link.label}`} title="ลบ"><Trash2 size={15} /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {removeLinkTarget && (
                <div className="spp-confirm-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setRemoveLinkTarget(null)}>
                  <section className="spp-confirm" role="alertdialog" aria-modal="true" aria-labelledby="spp-confirm-title" aria-describedby="spp-confirm-desc">
                    <span className="spp-confirm-icon" aria-hidden="true"><Trash2 size={18} /></span>
                    <h3 id="spp-confirm-title">ลบลิงก์ที่บันทึกไว้?</h3>
                    <p id="spp-confirm-desc">
                      <strong>{removeLinkTarget.label}</strong>
                      <span>{readableUrl(removeLinkTarget.url)}</span>
                      ลบแค่ออกจากรายการที่บันทึกไว้ สินค้าที่ใช้ลิงก์นี้อยู่จะไม่ได้รับผลกระทบ
                    </p>
                    <div className="spp-confirm-actions">
                      <button type="button" className="store-prod-btn" onClick={() => setRemoveLinkTarget(null)} autoFocus>ยกเลิก</button>
                      <button type="button" className="spp-confirm-danger" onClick={() => handleRemoveLink(removeLinkTarget.url)}>ลบลิงก์</button>
                    </div>
                  </section>
                </div>
              )}
            </section>
          </div>
        );
      })()}
    </div>
  );
}
