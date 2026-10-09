"use client";

import { Store } from "lucide-react";
import type { ReactNode } from "react";
import "./store-closed.css";

export const STORE_CLOSED_TITLE = "ร้านค้าปิดให้บริการชั่วคราว";
export const STORE_CLOSED_DETAIL = "ซื้อสินค้าและเติมเงินไม่ได้ในขณะนี้";
const DEFAULT_DETAIL = STORE_CLOSED_DETAIL;

/** Public settings fields that drive the store switch. A missing value means open. */
export type StoreSwitch = { storeEnabled?: boolean; storeClosedMessage?: string };

export function storeIsOpen(settings?: StoreSwitch | null) {
  return settings?.storeEnabled !== false;
}

type Props = {
  /** Message set by the admin in system settings. */
  message?: string;
  /** "banner": a strip at the top of a page. "page": replaces the store page. */
  variant?: "banner" | "page";
  /** Extra line under the message, e.g. what still works. */
  note?: string;
  children?: ReactNode;
};

/** Tells people the store is closed and that buying and top-ups are paused. */
export default function StoreClosedNotice({ message, variant = "banner", note, children }: Props) {
  const detail = message?.trim() || DEFAULT_DETAIL;
  if (variant === "page") {
    return (
      <section className="scn-page" role="status">
        <span className="scn-icon" aria-hidden="true"><Store size={24} /></span>
        <h1>{STORE_CLOSED_TITLE}</h1>
        <p>{detail}</p>
        {note && <p className="scn-note">{note}</p>}
        {children && <div className="scn-actions">{children}</div>}
      </section>
    );
  }
  return (
    <div className="scn-banner" role="status">
      <Store size={18} className="scn-banner-icon" aria-hidden="true" />
      <div className="scn-banner-copy">
        <strong>{STORE_CLOSED_TITLE}</strong>
        <p>{detail}{note && <span> · {note}</span>}</p>
      </div>
      {children && <div className="scn-banner-actions">{children}</div>}
    </div>
  );
}
