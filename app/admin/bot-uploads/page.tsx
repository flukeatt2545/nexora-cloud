"use client";

import { useCallback, useEffect, useState } from "react";
import "./bot-uploads.css";

type Item = {
  id: number;
  guild_id: string;
  discord_user_id: string;
  discord_username: string;
  url: string;
  filename: string;
  size: number;
  content_type: string;
  created_at: string;
};

const PAGE_SIZE = 50;

function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}

function shortGuild(id: string): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export default function AdminBotUploadsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("");
  const [applied, setApplied] = useState({ q: "", guild_id: "" });
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setLoadError(false);
      setForbidden(false);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (applied.q) params.set("q", applied.q);
        if (applied.guild_id) params.set("guild_id", applied.guild_id);
        const res = await fetch(`/api/admin/bot-uploads?${params.toString()}`, { credentials: "include" });
        if (res.status === 401 || res.status === 403) {
          setForbidden(true);
          setItems([]);
          setTotal(0);
          return;
        }
        if (!res.ok) throw new Error("load failed");
        const data = await res.json();
        const next: Item[] = Array.isArray(data.items) ? data.items : [];
        setItems((prev) => (append ? [...prev, ...next] : next));
        setTotal(typeof data.total === "number" ? data.total : next.length);
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [applied]
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  const applyFilters = () => {
    setConfirmId(null);
    setApplied({ q: search.trim(), guild_id: guild.trim() });
  };

  const resetFilters = () => {
    setSearch("");
    setGuild("");
    setApplied({ q: "", guild_id: "" });
  };

  const deleteItem = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/bot-uploads/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("delete failed");
      setItems((prev) => prev.filter((it) => it.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      setNotice("ลบรูปเรียบร้อยแล้ว");
      window.setTimeout(() => setNotice(""), 3000);
    } catch {
      setNotice("ลบไม่สำเร็จ ลองใหม่อีกครั้ง");
      window.setTimeout(() => setNotice(""), 3000);
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  const hasMore = items.length < total;

  return (
    <main className="abu">
      <header className="abu-head">
        <div>
          <h1 className="abu-title">รูปที่อัปโหลดผ่านบอท</h1>
          <p className="abu-sub">
            {loading ? "กำลังโหลด…" : `ทั้งหมด ${total.toLocaleString("th-TH")} รูป · ทุกผู้ใช้ ทุกเซิร์ฟเวอร์`}
          </p>
        </div>
      </header>

      <form
        className="abu-filters"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters();
        }}
      >
        <label className="abu-field abu-field-grow">
          <span className="abu-label">ค้นหา</span>
          <input
            className="abu-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ชื่อผู้ใช้ หรือชื่อไฟล์"
          />
        </label>
        <label className="abu-field">
          <span className="abu-label">Guild ID</span>
          <input
            className="abu-input"
            type="text"
            value={guild}
            onChange={(e) => setGuild(e.target.value)}
            placeholder="ทั้งหมด"
            inputMode="numeric"
          />
        </label>
        <button className="abu-btn abu-btn-primary" type="submit">
          ค้นหา
        </button>
        <button className="abu-btn" type="button" onClick={resetFilters}>
          ล้างตัวกรอง
        </button>
      </form>

      {notice ? <p className="abu-notice" role="status">{notice}</p> : null}

      {forbidden ? (
        <div className="abu-empty">
          <p className="abu-empty-title">หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
          <p className="abu-empty-sub">กรุณาเข้าสู่ระบบด้วยบัญชีแอดมิน</p>
        </div>
      ) : loadError ? (
        <div className="abu-empty">
          <p className="abu-empty-title">โหลดข้อมูลไม่สำเร็จ</p>
          <button className="abu-btn abu-btn-primary" type="button" onClick={() => void load(0, false)}>
            ลองอีกครั้ง
          </button>
        </div>
      ) : loading ? (
        <div className="abu-grid" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div className="abu-card abu-skeleton" key={i}>
              <div className="abu-thumb" />
              <div className="abu-meta">
                <div className="abu-line abu-line-long" />
                <div className="abu-line" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="abu-empty">
          <p className="abu-empty-title">ยังไม่มีรูปที่อัปโหลดผ่านบอท</p>
          <p className="abu-empty-sub">เมื่อมีผู้ใช้อัปโหลดรูปผ่านคำสั่ง /upload รูปจะแสดงที่นี่</p>
        </div>
      ) : (
        <>
          <div className="abu-grid">
            {items.map((item) => (
              <article className="abu-card" key={item.id}>
                <a className="abu-thumb" href={item.url} target="_blank" rel="noreferrer" title="เปิดรูปเต็ม">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt={item.filename || "รูปที่อัปโหลด"} loading="lazy" />
                </a>
                <div className="abu-meta">
                  <p className="abu-filename" title={item.filename}>
                    {item.filename || "ไฟล์รูป"}
                  </p>
                  <p className="abu-user" title={item.discord_user_id}>
                    {item.discord_username || "ไม่ทราบชื่อ"}
                  </p>
                  <p className="abu-detail">
                    Guild {shortGuild(item.guild_id)} · {fmtSize(item.size)}
                  </p>
                  <p className="abu-detail">{fmtDate(item.created_at)}</p>
                </div>
                <div className="abu-actions">
                  {confirmId === item.id ? (
                    <>
                      <button
                        className="abu-btn abu-btn-danger"
                        type="button"
                        disabled={deletingId === item.id}
                        onClick={() => void deleteItem(item.id)}
                      >
                        {deletingId === item.id ? "กำลังลบ…" : "ยืนยันลบ"}
                      </button>
                      <button className="abu-btn" type="button" onClick={() => setConfirmId(null)}>
                        ยกเลิก
                      </button>
                    </>
                  ) : (
                    <button
                      className="abu-btn abu-btn-danger-outline"
                      type="button"
                      onClick={() => setConfirmId(item.id)}
                      aria-label={`ลบรูป ${item.filename}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      </svg>
                      ลบรูป
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {hasMore ? (
            <div className="abu-more">
              <button
                className="abu-btn abu-btn-primary"
                type="button"
                disabled={loadingMore}
                onClick={() => void load(items.length, true)}
              >
                {loadingMore ? "กำลังโหลด…" : `โหลดเพิ่ม (เหลือ ${total - items.length} รูป)`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
