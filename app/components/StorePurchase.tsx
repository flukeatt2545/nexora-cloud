"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleAlert, CircleCheck, Download, ExternalLink, Link2, Loader2, LogIn, Package, ShoppingCart, X } from "lucide-react";
import SmartImage from "./SmartImage";
import NoCoverArt from "./NoCoverArt";
import { coverCropStyle, type CoverCrop } from "../lib/coverCrop";
import { API_BASE } from "../runtime";
import { sanitizeRichText } from "../lib/safeHtml";

export type PurchaseProduct = {
  id: number;
  title: string;
  description: string;
  price: number;
  stock: number;
  isSoldOut: boolean;
  coverImageUrl?: string;
  coverCrop?: CoverCrop | null;
  deliveryType?: "file" | "link";
  soldCount?: number;
};

export type OwnedPurchase = {
  id: number;
  productId: number;
  title: string;
  coverImageUrl: string;
  coverCrop?: CoverCrop | null;
  pricePaid: number;
  purchasedAt: string;
  deliveryType: "file" | "link";
};

/** Fired after a purchase so every balance on the page (header, dashboard) updates at once. */
export const POINTS_EVENT = "nexora:points";

export function broadcastPoints(points: number) {
  window.dispatchEvent(new CustomEvent<number>(POINTS_EVENT, { detail: points }));
}

export function formatPointAmount(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    return typeof payload?.error === "string" && payload.error ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

function filenameFrom(response: Response, fallback: string) {
  const header = response.headers.get("Content-Disposition") || "";
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1]); } catch { /* fall through */ }
  }
  const plain = header.match(/filename="?((?:\\"|[^";])+)"?/i);
  return plain ? plain[1].replace(/\\"/g, '"') : fallback;
}

/** Downloads a bought product. Throws an Error with a user-facing Thai message on failure. */
export async function downloadPurchase(productId: number, deliveryType: "file" | "link" | undefined, title: string) {
  const url = `${API_BASE}/api/store/purchases/${productId}/download`;
  // Open the tab before awaiting so pop-up blockers treat it as part of the click.
  const linkTab = deliveryType === "link" ? window.open("about:blank", "_blank") : null;
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    linkTab?.close();
    throw new Error(await readError(response, "ดาวน์โหลดไม่สำเร็จ กรุณาลองใหม่"));
  }
  if ((response.headers.get("Content-Type") || "").includes("application/json")) {
    const payload = await response.json();
    if (payload?.type === "link" && typeof payload.url === "string" && /^https?:\/\//i.test(payload.url)) {
      if (linkTab) {
        linkTab.opener = null;
        linkTab.location.href = payload.url;
      } else {
        window.open(payload.url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    linkTab?.close();
    throw new Error("ลิงก์ของสินค้านี้ไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ");
  }
  linkTab?.close();
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filenameFrom(response, title);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

type DialogStage =
  | { kind: "confirm" }
  | { kind: "buying" }
  | { kind: "done"; newPoints: number; fresh: boolean }
  | { kind: "error"; message: string };

export function PurchaseDialog({
  product,
  balance,
  owned,
  guest = false,
  onLogin,
  onClose,
  onPurchased,
  onNotify,
}: {
  product: PurchaseProduct;
  balance: number | null;
  owned: boolean;
  /** Not signed in: show the product details and a sign-in button instead of the balance. */
  guest?: boolean;
  onLogin?: () => void;
  onClose: () => void;
  onPurchased: (purchase: OwnedPurchase, newPoints: number) => void;
  onNotify: (kind: "success" | "error", message: string) => void;
}) {
  const [stage, setStage] = useState<DialogStage>({ kind: "confirm" });
  const [downloading, setDownloading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const description = useMemo(() => sanitizeRichText(product.description), [product.description]);
  const busy = stage.kind === "buying";
  const soldOut = product.isSoldOut || product.stock === 0;
  const known = balance !== null;
  const after = known ? balance - product.price : 0;
  const short = known && after < 0;
  const isOwned = !guest && (owned || stage.kind === "done");
  const stockText = soldOut ? "สินค้าหมด" : product.stock === -1 ? "คลังไม่จำกัด" : `เหลือ ${product.stock.toLocaleString("th-TH")} ชิ้น`;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab" && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [busy, onClose]);

  async function buy() {
    setStage({ kind: "buying" });
    try {
      const response = await fetch(`${API_BASE}/api/store/buy/${product.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload?.code === "already_owned") {
          setStage({ kind: "done", newPoints: balance ?? 0, fresh: false });
          return;
        }
        if (response.status === 401) throw new Error("กรุณาเข้าสู่ระบบก่อนซื้อสินค้า");
        if (response.status === 429) throw new Error("ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่");
        throw new Error(payload?.error || "ซื้อสินค้าไม่สำเร็จ กรุณาลองใหม่");
      }
      const newPoints = Number(payload.newPoints ?? payload.points ?? 0);
      setStage({ kind: "done", newPoints, fresh: true });
      onPurchased({
        id: payload.purchaseId,
        productId: product.id,
        title: product.title,
        coverImageUrl: product.coverImageUrl || "",
        coverCrop: product.coverCrop ?? null,
        pricePaid: Number(payload.pricePaid ?? product.price),
        purchasedAt: payload.purchasedAt || new Date().toISOString(),
        deliveryType: payload.deliveryType === "link" ? "link" : "file",
      }, newPoints);
      onNotify("success", payload.message || `ซื้อ ${product.title} สำเร็จ`);
    } catch (error) {
      setStage({ kind: "error", message: error instanceof Error ? error.message : "ซื้อสินค้าไม่สำเร็จ" });
    }
  }

  async function download() {
    setDownloading(true);
    try {
      await downloadPurchase(product.id, product.deliveryType, product.title);
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "ดาวน์โหลดไม่สำเร็จ");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="buy-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="buy-dialog" role="dialog" aria-modal="true" aria-labelledby="buy-dialog-title" ref={dialogRef}>
        <button type="button" className="buy-close" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>

        <div className="buy-media">
          {product.coverImageUrl ? (
            <>
              {/* Details show the whole picture; the blurred copy fills the sides. Card crops don't apply here. */}
              <span className="buy-media-backdrop" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={product.coverImageUrl} alt="" decoding="async" onError={(event) => { event.currentTarget.style.display = "none"; }} />
              </span>
              <SmartImage src={product.coverImageUrl} alt={product.title} />
            </>
          ) : (
            <NoCoverArt />
          )}
        </div>

        <div className="buy-head">
          <div className="buy-head-text">
            <h2 id="buy-dialog-title">{product.title}</h2>
            <p className="buy-price">{product.price > 0 ? <>{formatPointAmount(product.price)} <span>พอยท์</span></> : "ฟรี"}</p>
            <ul className="buy-facts" aria-label="ข้อมูลสินค้า">
              <li>
                {product.deliveryType === "link" ? <Link2 size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                {product.deliveryType === "link" ? "ได้รับเป็นลิงก์" : "ไฟล์ดาวน์โหลด"}
              </li>
              <li className={soldOut ? "is-out" : product.stock !== -1 && product.stock <= 5 ? "is-low" : ""}>
                <Package size={14} aria-hidden="true" />{stockText}
              </li>
              {typeof product.soldCount === "number" && (
                <li><ShoppingCart size={14} aria-hidden="true" />ขายแล้ว {product.soldCount.toLocaleString("th-TH")}</li>
              )}
            </ul>
          </div>
        </div>

        {description && <div className="buy-desc" dangerouslySetInnerHTML={{ __html: description }} />}

        {guest ? null : isOwned ? (
          <div className="buy-result is-ok" role="status">
            <CircleCheck size={18} aria-hidden="true" />
            <div>
              <strong>{stage.kind === "done" && stage.fresh ? "ซื้อสำเร็จ" : "คุณมีสินค้านี้แล้ว"}</strong>
              <span>
                {stage.kind === "done" && stage.fresh
                  ? `ยอดคงเหลือ ${formatPointAmount(stage.newPoints)} พอยท์ · ดาวน์โหลดซ้ำได้ทุกเมื่อจากแท็บ "ที่ซื้อแล้ว"`
                  : "ดาวน์โหลดซ้ำได้โดยไม่เสียพอยท์เพิ่ม"}
              </span>
            </div>
          </div>
        ) : (
          <dl className="buy-summary">
            <div><dt>พอยท์ที่มี</dt><dd>{known ? formatPointAmount(balance) : "–"}</dd></div>
            <div><dt>ราคา</dt><dd>{product.price > 0 ? `−${formatPointAmount(product.price)}` : "ฟรี"}</dd></div>
            <div className={`buy-summary-total${short ? " is-short" : ""}`}>
              <dt>{short ? "ขาดอีก" : "คงเหลือหลังซื้อ"}</dt>
              <dd>{known ? formatPointAmount(Math.abs(after)) : "–"}</dd>
            </div>
          </dl>
        )}

        {stage.kind === "error" && (
          <p className="buy-result is-error" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{stage.message}</span></p>
        )}

        <div className="buy-actions">
          {guest ? (
            soldOut ? (
              <button type="button" className="buy-btn" onClick={onClose} data-autofocus>สินค้าหมดแล้ว</button>
            ) : (
              <>
                <button type="button" className="buy-btn" onClick={onClose}>ปิด</button>
                <button type="button" className="buy-btn is-primary" onClick={onLogin} data-autofocus>
                  <LogIn size={16} aria-hidden="true" /> เข้าสู่ระบบเพื่อซื้อ
                </button>
              </>
            )
          ) : isOwned ? (
            <>
              <button type="button" className="buy-btn" onClick={onClose}>ปิด</button>
              <button type="button" className="buy-btn is-primary" onClick={download} disabled={downloading} data-autofocus>
                {downloading ? <Loader2 size={16} className="buy-spin" aria-hidden="true" /> : product.deliveryType === "link" ? <ExternalLink size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                {downloading ? "กำลังเตรียมไฟล์..." : product.deliveryType === "link" ? "เปิดลิงก์" : "ดาวน์โหลด"}
              </button>
            </>
          ) : soldOut ? (
            <button type="button" className="buy-btn" onClick={onClose} data-autofocus>สินค้าหมดแล้ว</button>
          ) : short ? (
            <>
              <button type="button" className="buy-btn" onClick={onClose}>ยกเลิก</button>
              <a className="buy-btn is-primary" href="/topups" data-autofocus>เติมพอยท์ <ArrowRight size={15} aria-hidden="true" /></a>
            </>
          ) : (
            <>
              <button type="button" className="buy-btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
              <button type="button" className="buy-btn is-primary" onClick={buy} disabled={busy || !known} data-autofocus>
                {busy && <Loader2 size={16} className="buy-spin" aria-hidden="true" />}
                {busy ? "กำลังดำเนินการ..." : product.price > 0 ? `ยืนยันซื้อ ${formatPointAmount(product.price)} พอยท์` : "รับสินค้าฟรี"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function OwnedPurchaseList({
  items,
  loading,
  onNotify,
}: {
  items: OwnedPurchase[];
  loading: boolean;
  onNotify: (kind: "success" | "error", message: string) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);

  async function download(item: OwnedPurchase) {
    setBusyId(item.productId);
    try {
      await downloadPurchase(item.productId, item.deliveryType, item.title);
    } catch (error) {
      onNotify("error", error instanceof Error ? error.message : "ดาวน์โหลดไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="owned-empty">กำลังโหลดรายการที่ซื้อแล้ว...</p>;
  if (!items.length) {
    return (
      <div className="owned-empty">
        <p>ยังไม่มีสินค้าที่ซื้อ</p>
        <span>สินค้าที่ซื้อแล้วจะอยู่ที่นี่ และดาวน์โหลดซ้ำได้ทุกเมื่อ</span>
      </div>
    );
  }
  return (
    <ul className="owned-list">
      {items.map((item) => (
        <li key={item.productId}>
          {item.coverImageUrl ? (
            <SmartImage src={item.coverImageUrl} alt="" wrapperClassName="owned-thumb" compact style={coverCropStyle(item.coverCrop)} />
          ) : (
            <span className="owned-thumb owned-thumb-empty"><NoCoverArt compact /></span>
          )}
          <div className="owned-text">
            <strong>{item.title}</strong>
            <small>
              ซื้อเมื่อ {new Date(item.purchasedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}
              {" · "}{formatPointAmount(item.pricePaid)} พอยท์
            </small>
          </div>
          <button type="button" className="buy-btn is-small" onClick={() => download(item)} disabled={busyId === item.productId}>
            {busyId === item.productId ? <Loader2 size={15} className="buy-spin" aria-hidden="true" /> : item.deliveryType === "link" ? <ExternalLink size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
            <span>{item.deliveryType === "link" ? "เปิดลิงก์" : "ดาวน์โหลด"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
