"use client";

import {
  ArrowDown, ArrowUp, Edit3, Eye, EyeOff, FolderTree, Link2, Minus, Plus, RefreshCw, Search, Share2, Tag, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { API_BASE } from "../runtime";
import { useEscape, useScrollLock } from "./useScrollLock";
import { errorText, type Ask, type Notify } from "./types";
import "./hosting-view.css";

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
    throw new Error(errorData?.error || "เชื่อมต่อระบบไม่สำเร็จ");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export type UserFileCategory = {
  id: number;
  name: string;
  isVisible: boolean;
  sortOrder: number;
  activeShareCount?: number;
  createdAt: string;
  updatedAt?: string;
};

type Draft = { name: string; isVisible: boolean; sortOrder: number };
type VisibilityFilter = "" | "visible" | "hidden";

// /admin/file-categories: the categories users can filter the file library by.
export function UserFileCategoriesView({ notify, ask }: { notify: Notify; ask: Ask }) {
  const [categories, setCategories] = useState<UserFileCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("");
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set());

  // null = closed, 0 = creating, otherwise the id being edited.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", isVisible: true, sortOrder: 0 });
  const [nameError, setNameError] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const fetchCategories = useCallback(() => api<{ items: UserFileCategory[] }>("/api/admin/user-file-categories")
    .then((data) => setCategories(data.items || []))
    .catch((e) => setLoadError((e instanceof Error && e.message) || "โหลดหมวดหมู่ไม่สำเร็จ"))
    .finally(() => setLoading(false)), []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  // After a change, or "ลองใหม่": show loading and fetch again.
  const load = useCallback(() => {
    setLoading(true);
    setLoadError("");
    return fetchCategories();
  }, [fetchCategories]);

  const ordered = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "th")),
    [categories],
  );

  const stats = useMemo(() => {
    const visible = categories.filter((c) => c.isVisible).length;
    const links = categories.reduce((sum, c) => sum + (c.activeShareCount || 0), 0);
    return { total: categories.length, visible, hidden: categories.length - visible, links };
  }, [categories]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("th");
    return ordered.filter((c) =>
      (!term || c.name.toLocaleLowerCase("th").includes(term)) &&
      (visibility === "" || (visibility === "visible") === c.isVisible));
  }, [ordered, search, visibility]);

  const hasFilters = Boolean(search.trim() || visibility);
  const dialogOpen = editingId !== null;
  useScrollLock(dialogOpen);
  useEscape(dialogOpen, () => { if (!saving) setEditingId(null); });

  useEffect(() => {
    if (dialogOpen) window.setTimeout(() => nameRef.current?.focus(), 30);
  }, [dialogOpen]);

  function markBusy(id: number, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  function openCreate() {
    const last = ordered[ordered.length - 1];
    setDraft({ name: "", isVisible: true, sortOrder: last ? last.sortOrder + 1 : 0 });
    setNameError("");
    setEditingId(0);
  }

  function openEdit(category: UserFileCategory) {
    setDraft({ name: category.name, isVisible: category.isVisible, sortOrder: category.sortOrder });
    setNameError("");
    setEditingId(category.id);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      setNameError("ตั้งชื่อหมวดหมู่ก่อน");
      nameRef.current?.focus();
      return;
    }
    const duplicate = categories.find((c) => c.id !== editingId && c.name.trim().toLocaleLowerCase("th") === name.toLocaleLowerCase("th"));
    if (duplicate) {
      setNameError("มีหมวดหมู่ชื่อนี้อยู่แล้ว");
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const payload = { name, isVisible: draft.isVisible, sortOrder: Math.max(0, draft.sortOrder) };
      if (editingId === 0) {
        await api("/api/admin/user-file-categories", { method: "POST", body: JSON.stringify(payload) });
        notify({ kind: "success", text: `สร้างหมวด “${name}” แล้ว` });
      } else {
        await api(`/api/admin/user-file-categories/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
        notify({ kind: "success", text: `บันทึก “${name}” แล้ว` });
      }
      setEditingId(null);
      await load();
    } catch (e) {
      notify({ kind: "error", text: errorText(e) || "บันทึกไม่สำเร็จ" });
    } finally {
      setSaving(false);
    }
  }

  async function update(category: UserFileCategory, patch: Partial<Draft>) {
    const next = { name: category.name, isVisible: category.isVisible, sortOrder: category.sortOrder, ...patch };
    await api(`/api/admin/user-file-categories/${category.id}`, { method: "PUT", body: JSON.stringify(next) });
    setCategories((prev) => prev.map((item) => (item.id === category.id ? { ...item, ...next } : item)));
  }

  async function toggleVisibility(category: UserFileCategory) {
    markBusy(category.id, true);
    try {
      await update(category, { isVisible: !category.isVisible });
      notify({ kind: "success", text: category.isVisible ? `ซ่อน “${category.name}” แล้ว` : `แสดง “${category.name}” แล้ว` });
    } catch (e) {
      notify({ kind: "error", text: errorText(e) || "เปลี่ยนสถานะไม่สำเร็จ" });
    } finally {
      markBusy(category.id, false);
    }
  }

  // Swap places with the neighbour in the full ordered list (not the filtered one).
  async function move(category: UserFileCategory, step: -1 | 1) {
    const index = ordered.findIndex((c) => c.id === category.id);
    const other = ordered[index + step];
    if (!other) return;
    const mine = category.sortOrder === other.sortOrder ? other.sortOrder + step : other.sortOrder;
    const theirs = category.sortOrder;
    markBusy(category.id, true);
    markBusy(other.id, true);
    try {
      await update(category, { sortOrder: mine });
      await update(other, { sortOrder: theirs });
    } catch (e) {
      notify({ kind: "error", text: errorText(e) || "ย้ายลำดับไม่สำเร็จ" });
      await load();
    } finally {
      markBusy(category.id, false);
      markBusy(other.id, false);
    }
  }

  function remove(category: UserFileCategory) {
    ask({
      title: `ลบหมวด “${category.name}”?`,
      message: "ไฟล์ในหมวดนี้ไม่ถูกลบ แค่จะไม่มีหมวดหมู่" + (category.activeShareCount ? ` และลิงก์แชร์ทั้งหมวด ${category.activeShareCount} ลิงก์จะใช้ไม่ได้` : ""),
      confirmLabel: "ลบหมวดหมู่",
      danger: true,
      action: async () => {
        await api(`/api/admin/user-file-categories/${category.id}`, { method: "DELETE" });
        notify({ kind: "success", text: `ลบหมวด “${category.name}” แล้ว` });
        await load();
      },
    });
  }

  function revokeShares(category: UserFileCategory) {
    if (!category.activeShareCount) return;
    ask({
      title: `ยกเลิกลิงก์แชร์ของ “${category.name}”?`,
      message: `ลิงก์แชร์ทั้งหมวดที่ยังใช้ได้ ${category.activeShareCount} ลิงก์จะเปิดไม่ได้ทันที คนที่ได้ลิงก์ไปแล้วจะเห็นว่าลิงก์หมดอายุ`,
      confirmLabel: "ยกเลิกลิงก์",
      danger: true,
      action: async () => {
        const response = await api<{ revoked: number }>(`/api/admin/user-file-categories/${category.id}/shares`, { method: "DELETE" });
        notify({ kind: "success", text: `ยกเลิกลิงก์ ${response.revoked} ลิงก์แล้ว` });
        await load();
      },
    });
  }

  async function shareAll(category: UserFileCategory) {
    markBusy(category.id, true);
    try {
      const r = await api<{ shareUrl: string }>(`/api/admin/user-file-categories/${category.id}/share`, { method: "POST", body: JSON.stringify({ expiresIn: "7d" }) });
      const copied = await navigator.clipboard.writeText(`${window.location.origin}${r.shareUrl}`).then(() => true, () => false);
      notify({ kind: "success", text: copied ? `คัดลอกลิงก์แชร์ “${category.name}” แล้ว ใช้ได้ 7 วัน` : `สร้างลิงก์แชร์ “${category.name}” แล้ว แต่คัดลอกไม่ได้` });
      setCategories((prev) => prev.map((item) => (item.id === category.id ? { ...item, activeShareCount: (item.activeShareCount || 0) + 1 } : item)));
    } catch (e) {
      notify({ kind: "error", text: errorText(e) || "สร้างลิงก์ไม่สำเร็จ" });
    } finally {
      markBusy(category.id, false);
    }
  }

  const skeleton = (
    <ul className="hv-list" aria-hidden="true">
      {[0, 1, 2].map((i) => <li className="hv-row is-skeleton" key={i}><span /><span /><span /></li>)}
    </ul>
  );

  return (
    <div className="aov hv fcv" aria-busy={loading}>
      <header className="aov-head">
        <div>
          <p className="aov-eyebrow">ระบบไฟล์</p>
          <h1>หมวดหมู่ไฟล์</h1>
          <p className="aov-sub">หมวดที่ผู้ใช้เลือกกรองไฟล์ได้ในคลังไฟล์ เรียงตามลำดับที่ตั้งไว้</p>
        </div>
        <div className="aov-head-actions">
          <button type="button" className="aov-btn" onClick={load} disabled={loading} aria-label="รีเฟรช" title="รีเฟรช">
            <RefreshCw size={16} aria-hidden="true" className={loading ? "spin" : ""} />
          </button>
          <button type="button" className="aov-btn aov-btn-label aov-btn-primary" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" /> สร้างหมวดหมู่
          </button>
        </div>
      </header>

      <section className="aov-kpis" aria-label="สรุปหมวดหมู่">
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><FolderTree size={16} /></span>หมวดหมู่ทั้งหมด</span>
          <strong>{loading && !categories.length ? <i className="aov-skel" /> : stats.total.toLocaleString("th-TH")}</strong>
          <span className="aov-kpi-note">ในคลังไฟล์</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Eye size={16} /></span>ผู้ใช้เห็น</span>
          <strong>{loading && !categories.length ? <i className="aov-skel" /> : stats.visible.toLocaleString("th-TH")}</strong>
          <span className="aov-kpi-note">แสดงในตัวกรอง</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><EyeOff size={16} /></span>ซ่อนอยู่</span>
          <strong className={stats.hidden ? "is-wait" : ""}>{loading && !categories.length ? <i className="aov-skel" /> : stats.hidden.toLocaleString("th-TH")}</strong>
          <span className="aov-kpi-note">เห็นเฉพาะแอดมิน</span>
        </div>
        <div className="aov-kpi">
          <span className="aov-kpi-label"><span className="aov-kpi-icon" aria-hidden="true"><Link2 size={16} /></span>ลิงก์แชร์ที่ใช้ได้</span>
          <strong>{loading && !categories.length ? <i className="aov-skel" /> : stats.links.toLocaleString("th-TH")}</strong>
          <span className="aov-kpi-note">แชร์ทั้งหมวด</span>
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
              placeholder="ค้นหาชื่อหมวดหมู่"
              aria-label="ค้นหาหมวดหมู่"
            />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="ล้างคำค้นหา"><X size={15} /></button>}
          </label>
          <div className="th-chips" role="group" aria-label="การมองเห็น">
            <button type="button" className={visibility === "" ? "is-active" : ""} aria-pressed={visibility === ""} onClick={() => setVisibility("")}>ทั้งหมด</button>
            <button type="button" className={visibility === "visible" ? "is-active" : ""} aria-pressed={visibility === "visible"} onClick={() => setVisibility(visibility === "visible" ? "" : "visible")}>
              ผู้ใช้เห็น <span className="hv-chip-count">{stats.visible}</span>
            </button>
            <button type="button" className={visibility === "hidden" ? "is-active" : ""} aria-pressed={visibility === "hidden"} onClick={() => setVisibility(visibility === "hidden" ? "" : "hidden")}>
              ซ่อนอยู่ <span className="hv-chip-count">{stats.hidden}</span>
            </button>
          </div>
        </div>
        <div className="th-meta" aria-live="polite">
          <span>{loading && !categories.length ? "กำลังโหลด..." : filtered.length === 0 ? "ไม่พบหมวดหมู่" : `${filtered.length.toLocaleString("th-TH")} จาก ${categories.length.toLocaleString("th-TH")} หมวด`}</span>
          {hasFilters && <button type="button" onClick={() => { setSearch(""); setVisibility(""); }}>ล้างตัวกรอง</button>}
        </div>

        {loadError && !categories.length ? (
          <div className="aov-empty hv-empty">
            <span>โหลดหมวดหมู่ไม่สำเร็จ: {loadError}</span>
            <button type="button" onClick={load}>ลองอีกครั้ง</button>
          </div>
        ) : loading && !categories.length ? skeleton : filtered.length ? (
          <ul className="hv-list">
            <li className="hv-row fcv-row hv-row-head" aria-hidden="true">
              <span>ลำดับ</span><span>หมวดหมู่</span><span>ลิงก์แชร์</span><span>ผู้ใช้เห็นไหม</span><span />
            </li>
            {filtered.map((category) => {
              const busy = busyIds.has(category.id);
              const position = ordered.findIndex((c) => c.id === category.id);
              const links = category.activeShareCount || 0;
              return (
                <li className={`hv-row fcv-row${busy ? " is-busy" : ""}`} key={category.id} aria-busy={busy || undefined}>
                  <div className="fcv-order">
                    <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => void move(category, -1)} disabled={busy || position <= 0 || hasFilters} title={hasFilters ? "ล้างตัวกรองก่อนเรียงลำดับ" : "เลื่อนขึ้น"} aria-label={`เลื่อน ${category.name} ขึ้น`}>
                      <ArrowUp size={15} aria-hidden="true" />
                    </button>
                    <span className="fcv-pos">{position + 1}</span>
                    <button type="button" className="hv-btn hv-icon-btn is-sm" onClick={() => void move(category, 1)} disabled={busy || position >= ordered.length - 1 || hasFilters} title={hasFilters ? "ล้างตัวกรองก่อนเรียงลำดับ" : "เลื่อนลง"} aria-label={`เลื่อน ${category.name} ลง`}>
                      <ArrowDown size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="hv-site">
                    <span className="fcv-icon" aria-hidden="true"><Tag size={16} /></span>
                    <div className="hv-site-copy">
                      <button type="button" className="hv-site-name" onClick={() => openEdit(category)} title={category.name}>{category.name}</button>
                      <small className="hv-site-meta">{links ? `ลิงก์แชร์ ${links} ลิงก์` : "ยังไม่มีลิงก์แชร์"}</small>
                    </div>
                  </div>
                  <span className="hv-cell fcv-links">
                    {links ? (
                      <>
                        <b>{links.toLocaleString("th-TH")} ลิงก์</b>
                        <button type="button" className="hv-link-btn fcv-revoke" onClick={() => revokeShares(category)} disabled={busy}>ยกเลิก</button>
                      </>
                    ) : <span className="fcv-none">—</span>}
                  </span>
                  <button
                    type="button"
                    className={`fcv-vis ${category.isVisible ? "is-on" : "is-off"}`}
                    role="switch"
                    aria-checked={category.isVisible}
                    onClick={() => void toggleVisibility(category)}
                    disabled={busy}
                    title={category.isVisible ? "กดเพื่อซ่อนจากผู้ใช้" : "กดเพื่อให้ผู้ใช้เห็น"}
                  >
                    <span className="fcv-switch" aria-hidden="true" />
                    {category.isVisible ? "เห็น" : "ซ่อน"}
                  </button>
                  <div className="hv-row-actions">
                    <button type="button" className="hv-btn hv-icon-btn" onClick={() => void shareAll(category)} disabled={busy} title="คัดลอกลิงก์แชร์ทั้งหมด (7 วัน)" aria-label={`คัดลอกลิงก์แชร์ ${category.name}`}>
                      <Share2 size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="hv-btn hv-icon-btn" onClick={() => openEdit(category)} title="แก้ไข" aria-label={`แก้ไข ${category.name}`}>
                      <Edit3 size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="hv-btn hv-icon-btn hv-danger-icon" onClick={() => remove(category)} disabled={busy} title="ลบ" aria-label={`ลบ ${category.name}`}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="aov-empty hv-empty">
            <span>{hasFilters ? "ไม่พบหมวดหมู่ที่ตรงกับตัวกรอง" : "ยังไม่มีหมวดหมู่ ผู้ใช้จะเห็นไฟล์ทั้งหมดรวมกัน"}</span>
            {hasFilters
              ? <button type="button" onClick={() => { setSearch(""); setVisibility(""); }}>ล้างตัวกรอง</button>
              : <button type="button" onClick={openCreate}>สร้างหมวดหมู่แรก</button>}
          </div>
        )}
      </section>

      {dialogOpen && typeof document !== "undefined" && createPortal(
        <div className="hv-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !saving && setEditingId(null)}>
          <section className="hv-dialog fcv-dialog" role="dialog" aria-modal="true" aria-labelledby="fcv-dialog-title">
            <header className="hv-dialog-head">
              <div className="hv-dh-main">
                {editingId === 0 ? <Plus size={20} className="hv-dh-icon" aria-hidden="true" /> : <Edit3 size={20} className="hv-dh-icon" aria-hidden="true" />}
                <div className="hv-dh-text">
                  <small>หมวดหมู่ไฟล์</small>
                  <h2 id="fcv-dialog-title">{editingId === 0 ? "สร้างหมวดหมู่" : "แก้ไขหมวดหมู่"}</h2>
                </div>
              </div>
              <button type="button" className="hv-btn hv-icon-btn" onClick={() => setEditingId(null)} disabled={saving} aria-label="ปิด"><X size={18} /></button>
            </header>
            <form className="hv-form" onSubmit={save} noValidate>
              <div className="hv-dialog-body">
                <div className="hv-field">
                  <label htmlFor="fcv-name">ชื่อหมวดหมู่ <span className="hv-req">*</span></label>
                  <input
                    id="fcv-name"
                    ref={nameRef}
                    className={nameError ? "is-invalid" : undefined}
                    value={draft.name}
                    maxLength={80}
                    onChange={(e) => { setDraft({ ...draft, name: e.target.value }); if (nameError) setNameError(""); }}
                    placeholder="เช่น เอกสาร, รูปภาพ, งานนำเสนอ"
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? "fcv-name-error" : undefined}
                    disabled={saving}
                  />
                  {nameError && <small id="fcv-name-error" className="fcv-error">{nameError}</small>}
                </div>

                <div className="hv-field">
                  <label htmlFor="fcv-order">ลำดับ</label>
                  <div className="fcv-stepper">
                    <button type="button" onClick={() => setDraft({ ...draft, sortOrder: Math.max(0, draft.sortOrder - 1) })} disabled={saving || draft.sortOrder <= 0} aria-label="ลดลำดับ"><Minus size={16} /></button>
                    <input
                      id="fcv-order"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={draft.sortOrder}
                      onChange={(e) => setDraft({ ...draft, sortOrder: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                      disabled={saving}
                    />
                    <button type="button" onClick={() => setDraft({ ...draft, sortOrder: draft.sortOrder + 1 })} disabled={saving} aria-label="เพิ่มลำดับ"><Plus size={16} /></button>
                  </div>
                  <small>เลขน้อยขึ้นก่อนในตัวกรองของคลังไฟล์ ปรับทีหลังด้วยปุ่มลูกศรในรายการก็ได้</small>
                </div>

                <fieldset className="hv-field">
                  <legend>ผู้ใช้เห็นหมวดนี้ไหม</legend>
                  <div className="fcv-choices">
                    <label className={`hv-choice${draft.isVisible ? " is-selected" : ""}`}>
                      <input type="radio" name="fcv-visible" checked={draft.isVisible} onChange={() => setDraft({ ...draft, isVisible: true })} disabled={saving} />
                      <Eye size={18} aria-hidden="true" />
                      <span className="hv-choice-copy"><strong>แสดง</strong><small>มีในตัวกรองคลังไฟล์</small></span>
                    </label>
                    <label className={`hv-choice${!draft.isVisible ? " is-selected" : ""}`}>
                      <input type="radio" name="fcv-visible" checked={!draft.isVisible} onChange={() => setDraft({ ...draft, isVisible: false })} disabled={saving} />
                      <EyeOff size={18} aria-hidden="true" />
                      <span className="hv-choice-copy"><strong>ซ่อน</strong><small>เห็นเฉพาะแอดมิน</small></span>
                    </label>
                  </div>
                </fieldset>
              </div>
              <footer className="hv-dialog-foot">
                <button type="button" className="hv-btn" onClick={() => setEditingId(null)} disabled={saving}>ยกเลิก</button>
                <button type="submit" className="hv-btn hv-btn-primary" disabled={saving}>
                  {saving && <span className="hv-spinner" aria-hidden="true" />}
                  {saving ? "กำลังบันทึก..." : editingId === 0 ? "สร้างหมวดหมู่" : "บันทึก"}
                </button>
              </footer>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
