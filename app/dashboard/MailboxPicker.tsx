"use client";

// Which mailbox the webmail shows. A list grouped by domain with unread counts, in place of the
// browser's own select, which could not show either and looked different on every system.
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { initial, localPart, type Mailbox } from "./mailShared";

export default function MailboxPicker({ mailboxes, current, onChoose }: { mailboxes: Mailbox[]; current: Mailbox; onChoose: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const listId = useId();
  const many = mailboxes.length > 1;
  const otherUnread = mailboxes.reduce((sum, item) => sum + (item.id === current.id ? 0 : item.unread || 0), 0);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !pop.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // The list is drawn on the page body (the mail panes clip what overflows them), under the
  // button, and follows it when the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const box = root.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(Math.max(box.width, 300), window.innerWidth - 16);
      const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
      const below = window.innerHeight - box.bottom - 12;
      setPlace({ top: box.bottom + 6, left, width, maxHeight: Math.max(220, Math.min(420, below)) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, Mailbox[]>();
    for (const item of mailboxes) {
      if (needle && !item.address.toLowerCase().includes(needle) && !(item.displayName || "").toLowerCase().includes(needle)) continue;
      const domain = item.address.split("@")[1] || "";
      map.set(domain, [...(map.get(domain) || []), item]);
    }
    return [...map.entries()];
  }, [mailboxes, query]);

  function toggle() {
    if (!many) return;
    setQuery("");
    setOpen((value) => !value);
  }

  function choose(id: string) {
    setOpen(false);
    if (id !== current.id) onChoose(id);
  }

  // Up and down move between mailboxes; Escape closes and gives focus back to the button.
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".wm-picker-button")?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = [...(pop.current?.querySelectorAll<HTMLButtonElement>(".wm-picker-option") || [])];
    if (!options.length) return;
    event.preventDefault();
    const at = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % options.length : (at <= 0 ? options.length : at) - 1;
    options[next].focus();
  }

  return (
    <div className={`wm-picker${open ? " is-open" : ""}`} ref={root} onKeyDown={onKey}>
      <button
        type="button"
        className="wm-picker-button"
        onClick={toggle}
        aria-haspopup={many ? "listbox" : undefined}
        aria-expanded={many ? open : undefined}
        aria-controls={many ? listId : undefined}
        title={many ? `${current.address} (กดเพื่อเปลี่ยนกล่อง)` : current.address}
        disabled={!many}
      >
        <span className="wm-picker-face">
          <span className="wm-avatar wm-box-avatar" aria-hidden="true">{initial(current.displayName || current.address)}</span>
          {many && otherUnread > 0 && <b className="wm-picker-dot" aria-label={`กล่องอื่นมีอีเมลยังไม่อ่าน ${otherUnread} ฉบับ`} />}
        </span>
        <span className="wm-box-text">
          <strong>{current.displayName || localPart(current.address)}</strong>
          <span className="wm-addr">{current.address}</span>
        </span>
        {many && <span className="wm-picker-end"><ChevronDown size={16} aria-hidden="true" /></span>}
      </button>

      {open && createPortal(
        <div className="wm-picker-pop" id={listId} ref={pop} style={place}>
          {mailboxes.length > 6 && (
            <label className="wm-picker-search">
              <Search size={15} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหากล่อง" aria-label="ค้นหากล่องอีเมล" autoFocus />
            </label>
          )}
          <div className="wm-picker-scroll" role="listbox" aria-label="กล่องอีเมล">
            {groups.length === 0 && <p className="wm-picker-none">ไม่พบกล่องนี้</p>}
            {groups.map(([domain, items]) => (
              <div key={domain} className="wm-picker-group" role="group" aria-label={domain}>
                <p className="wm-picker-domain">@{domain}</p>
                {items.map((item, index) => {
                  const active = item.id === current.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`wm-picker-option${active ? " is-active" : ""}`}
                      onClick={() => choose(item.id)}
                      autoFocus={mailboxes.length <= 6 && (active || (!mailboxes.some((box) => box.id === current.id) && index === 0))}
                    >
                      <span className="wm-avatar" aria-hidden="true">{initial(item.displayName || item.address)}</span>
                      <span className="wm-picker-text">
                        <b>{localPart(item.address)}</b>
                        {item.displayName && item.displayName.toLowerCase() !== localPart(item.address).toLowerCase() && <small>{item.displayName}</small>}
                      </span>
                      {item.unread > 0 && <span className="wm-picker-count" aria-label={`ยังไม่อ่าน ${item.unread} ฉบับ`}>{item.unread > 99 ? "99+" : item.unread}</span>}
                      {active && <Check size={16} className="wm-picker-check" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
