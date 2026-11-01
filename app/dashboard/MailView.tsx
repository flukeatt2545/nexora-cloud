"use client";

import {
  ArchiveRestore, ChevronLeft, CircleAlert, Download, File, Forward, Inbox, Mail, MailOpen, MailPlus,
  Paperclip, RefreshCw, Reply, ReplyAll, Search, Send, Settings2, SquarePen, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../runtime";
import { useEscape, useScrollLock } from "./useScrollLock";
import MailCompose from "./MailCompose";
import MailboxPicker from "./MailboxPicker";
import MailManage from "./MailManage";
import {
  api, bytes, CopyButton, emptyCompose, escapeHTML, fullDate, initial, localPart, shortDate,
  type ComposeState, type MailItem, type Mailbox, type Message, type Notice, type Recipient, type ThreadMessage,
} from "./mailShared";
import "./webmail.css";

// Image types the browser can show directly. SVG stays a download.
const PREVIEW_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const FOLDERS = [
  { id: "inbox", label: "กล่องขาเข้า", icon: Inbox, empty: "ยังไม่มีอีเมล" },
  { id: "sent", label: "ส่งแล้ว", icon: Send, empty: "ยังไม่ได้ส่งอีเมล" },
  { id: "draft", label: "ฉบับร่าง", icon: File, empty: "ไม่มีฉบับร่าง" },
  { id: "trash", label: "ถังขยะ", icon: Trash2, empty: "ถังขยะว่าง" },
] as const;
type Folder = (typeof FOLDERS)[number]["id"];

/** Images inside the body point at /api/...; in development the API is on another port. */
function withApiBase(html: string) {
  return API_BASE ? html.replaceAll('src="/api/', `src="${API_BASE}/api/`) : html;
}

/**
 * Mail that sets its own colours (newsletters, receipts) was designed for white paper and goes
 * unreadable on a dark page, so it gets a light sheet. Plain mail follows the site's theme.
 */
const paintsItself = (html: string) => /bgcolor=|(?:^|[\s;"'])(?:background(?:-color)?|color)\s*:/i.test(html);

type ViewedImage = { src: string; name: string };

/**
 * One message body. Earlier messages quoted in a reply hide behind a button, as Gmail does,
 * and pictures in the body open in the image viewer.
 */
function MailBody({ html, text, onImage }: { html: string; text: string; onImage: (image: ViewedImage) => void }) {
  const [showQuotes, setShowQuotes] = useState(false);
  if (!html) return <div className="wm-body is-plain">{text}</div>;
  const hasQuotes = html.includes("<blockquote");
  return (
    <>
      <div
        className={`wm-body${paintsItself(html) ? " is-paper" : ""}${hasQuotes && !showQuotes ? " hide-quotes" : ""}`}
        dangerouslySetInnerHTML={{ __html: withApiBase(html) }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target instanceof HTMLImageElement && target.src) onImage({ src: target.src, name: target.alt || "รูปภาพ" });
        }}
      />
      {hasQuotes && (
        <button type="button" className="wm-quote-toggle" aria-expanded={showQuotes} onClick={() => setShowQuotes((value) => !value)}>
          {showQuotes ? "ซ่อนข้อความเดิม" : "แสดงข้อความเดิม"}
        </button>
      )}
    </>
  );
}

/** Full-size view of a mail image, with download. Closes on Escape or a click outside. */
function MailImageViewer({ image, onClose }: { image: ViewedImage | null; onClose: () => void }) {
  useScrollLock(Boolean(image));
  useEscape(Boolean(image), onClose);
  if (!image) return null;
  return (
    <div className="wm-viewer" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}>
      <div className="wm-viewer-bar" onClick={(event) => event.stopPropagation()}>
        <span>{image.name}</span>
        <a href={image.src} download={image.name} className="wm-btn"><Download size={16} aria-hidden="true" /> ดาวน์โหลด</a>
        <button type="button" className="wm-icon-btn" onClick={onClose} aria-label="ปิด"><X size={18} aria-hidden="true" /></button>
      </div>
      <img src={image.src} alt={image.name} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * Previews are the first bytes of the mail as sent: some carry HTML tags, line breaks and
 * non-breaking spaces, and the API's byte cut can split a Thai character and leave a
 * replacement character (U+FFFD) at the end; drop the broken tail and mark the cut.
 */
const BROKEN_TAIL = new RegExp(`${String.fromCharCode(0xfffd)}+$`);
const cleanPreview = (value: string) => {
  const cut = BROKEN_TAIL.test(value);
  const text = value
    .replace(BROKEN_TAIL, "")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] || " ")
    .replace(/[\s\p{Cf}]+/gu, " ")
    .trim();
  return cut ? `${text}…` : text;
};

const people = (list: Recipient[] | undefined, kind: string) => (list || []).filter((item) => item.kind === kind);
const personLabel = (item: Recipient) => item.name ? `${item.name} <${item.address}>` : item.address;

export default function MailView({ notify }: { notify: Notice }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  // A failed load is shown in the page, not as a toast, and never as "no mailboxes".
  const [loadError, setLoadError] = useState("");
  const [listError, setListError] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [items, setItems] = useState<MailItem[]>([]);
  const [nextCursor, setNextCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<Message | null>(null);
  const [opening, setOpening] = useState("");
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewedImage, setViewedImage] = useState<ViewedImage | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const readerRef = useRef<HTMLElement>(null);
  const linkedMailbox = useRef(typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("mailbox") || "");
  const copyFailed = useCallback(() => notify({ kind: "error", text: "คัดลอกไม่ได้ ลองคลิกที่หน้าเว็บแล้วกดอีกครั้ง" }), [notify]);

  const refreshBootstrap = useCallback(async () => {
    const data = await api<{ mailboxes: Mailbox[] }>("/api/mail/bootstrap");
    setLoadError("");
    const list = data.mailboxes || [];
    // /mail?mailbox=<id> (the admin mail page links here) opens that mailbox first.
    const wanted = linkedMailbox.current;
    linkedMailbox.current = "";
    if (wanted && !list.some((item) => item.id === wanted)) {
      notify({ kind: "error", text: "บัญชีนี้ไม่มีสิทธิ์เปิดกล่องนั้น" });
    }
    setMailboxes(list);
    setMailboxId((current) => {
      const pick = wanted && list.some((item) => item.id === wanted) ? wanted : current;
      return list.some((item) => item.id === pick) ? pick : list[0]?.id || "";
    });
  }, [notify]);

  const messagesUrl = useCallback((cursor = 0) =>
    `/api/mail/messages?mailboxId=${encodeURIComponent(mailboxId)}&folder=${folder}&q=${encodeURIComponent(search)}${cursor ? `&cursor=${cursor}` : ""}`,
  [folder, mailboxId, search]);

  const loadMessages = useCallback(async () => {
    if (!mailboxId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api<{ items: MailItem[]; nextCursor?: number }>(messagesUrl());
      setItems(data.items || []);
      setNextCursor(data.nextCursor || 0);
      setNow(Date.now());
      setListError("");
    } catch (error) {
      setListError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mailboxId, messagesUrl]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api<{ items: MailItem[]; nextCursor?: number }>(messagesUrl(nextCursor));
      setItems((current) => [...current, ...(data.items || []).filter((item) => !current.some((have) => have.id === item.id))]);
      setNextCursor(data.nextCursor || 0);
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => refreshBootstrap().catch((error) => setLoadError((error as Error).message)), 0);
    return () => window.clearTimeout(timer);
  }, [notify, refreshBootstrap]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadMessages(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages]);
  // Search as people type, once they pause.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const refresh = () => document.visibilityState === "visible" && refreshBootstrap().then(loadMessages).catch(() => undefined);
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadMessages, refreshBootstrap]);

  const mailbox = mailboxes?.find((item) => item.id === mailboxId);
  const me = (mailbox?.address || "").toLowerCase();

  function closeMessage() {
    setSelected(null);
    setThreadMessages([]);
  }
  function chooseFolder(id: Folder) {
    setFolder(id);
    closeMessage();
  }
  function chooseMailbox(id: string) {
    setMailboxId(id);
    // Keep the open mailbox in the address, so a reload or a shared link comes back to it.
    window.history.replaceState(null, "", `${window.location.pathname}?mailbox=${encodeURIComponent(id)}`);
    setItems([]);
    closeMessage();
  }

  async function openMessage(item: MailItem) {
    setOpening(item.id);
    try {
      const [message, thread] = await Promise.all([
        api<Message>(`/api/mail/messages/${item.id}?mailboxId=${encodeURIComponent(mailboxId)}`),
        item.threadId
          ? api<{ items: ThreadMessage[] }>(`/api/mail/threads/${item.threadId}?mailboxId=${encodeURIComponent(mailboxId)}`)
          : Promise.resolve({ items: [] as ThreadMessage[] }),
      ]);
      const threadItems = thread.items || [];
      setSelected(message);
      setThreadMessages(threadItems);
      // In a conversation only the newest message starts open; older ones show one line each.
      setExpanded(new Set([threadItems[threadItems.length - 1]?.id || message.id]));
      setItems((current) => current.map((row) => (row.id === message.id ? { ...row, read: true } : row)));
      void refreshBootstrap();
      requestAnimationFrame(() => {
        const reader = readerRef.current;
        if (!reader) return;
        reader.scrollTop = 0;
        if (window.matchMedia("(max-width: 760px)").matches) reader.scrollIntoView({ block: "start" });
      });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setOpening("");
    }
  }

  async function patchSelected(body: Record<string, unknown>, done: string) {
    if (!selected) return;
    try {
      await api(`/api/mail/messages/${selected.id}?mailboxId=${encodeURIComponent(mailboxId)}`, { method: "PATCH", body: JSON.stringify(body) });
      closeMessage();
      notify({ kind: "success", text: done });
      await Promise.all([loadMessages(), refreshBootstrap()]);
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    }
  }
  const moveSelected = (target: "trash" | "inbox") =>
    patchSelected({ folder: target }, target === "trash" ? "ย้ายไปถังขยะแล้ว" : "ย้ายกลับไปกล่องขาเข้าแล้ว");
  const markUnread = () => patchSelected({ read: false }, "ทำเป็นยังไม่อ่านแล้ว");

  function reply(mode: "reply" | "all" | "forward") {
    if (!selected) return;
    const forward = mode === "forward";
    const prefix = forward ? "Fwd: " : "Re: ";
    const outbound = selected.direction === "outbound";
    // Replying to my own sent mail goes to the people I wrote to, not back to me.
    const firstTo = outbound ? people(selected.recipients, "to").map((item) => item.address) : [selected.from];
    const others = mode === "all"
      ? [...people(selected.recipients, "to"), ...people(selected.recipients, "cc")].map((item) => item.address)
      : [];
    const unique = (list: string[]) => [...new Set(list.filter((address) => address && address.toLowerCase() !== me))];
    const to = forward ? [] : unique(firstTo);
    const cc = mode === "all" ? unique(others).filter((address) => !to.includes(address)) : [];
    const quoted = `<p>เมื่อ ${escapeHTML(fullDate(selected.date || selected.receivedAt))} ${escapeHTML(selected.fromName || selected.from)} เขียนว่า</p>`;
    setCompose({
      ...emptyCompose,
      to: to.join(", "),
      cc: cc.join(", "),
      subject: selected.subject.startsWith(prefix) ? selected.subject : prefix + (selected.subject || ""),
      inReplyTo: forward ? "" : selected.internetMessageId || "",
      references: forward ? [] : [...(selected.references || []), ...(selected.internetMessageId ? [selected.internetMessageId] : [])],
      html: `<p><br></p>${quoted}<blockquote>${selected.html || escapeHTML(selected.text)}</blockquote>`,
    });
  }

  function editDraft() {
    if (!selected) return;
    const list = (kind: string) => people(selected.recipients, kind).map((item) => item.address).join(", ");
    setCompose({
      ...emptyCompose,
      draftId: selected.id,
      to: list("to"),
      cc: list("cc"),
      bcc: list("bcc"),
      subject: selected.subject,
      html: selected.html || escapeHTML(selected.text),
      inReplyTo: selected.inReplyTo,
      references: selected.references || [],
    });
  }

  function toggleThread(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const currentFolder = FOLDERS.find((item) => item.id === folder) || FOLDERS[0];
  const usage = mailbox && mailbox.quotaBytes ? Math.min(100, (mailbox.usedBytes / mailbox.quotaBytes) * 100) : 0;
  const multipleRecipients = selected ? [...people(selected.recipients, "to"), ...people(selected.recipients, "cc")].filter((item) => item.address.toLowerCase() !== me).length > 1 : false;
  const otherParty = selected
    ? selected.direction === "outbound" ? people(selected.recipients, "to")[0]?.address || "" : selected.from
    : "";

  const header = (
    <header className="wm-head">
      <div className="wm-head-text">
        <h1>อีเมล</h1>
        <p>ทุกกล่องของคุณอยู่ที่นี่</p>
      </div>
      <div className="wm-head-actions">
        <button type="button" className="wm-btn" onClick={() => setManageOpen(true)}>
          <Settings2 size={16} aria-hidden="true" /> จัดการ
        </button>
        <button type="button" className="wm-btn wm-btn-primary" onClick={() => setCompose({ ...emptyCompose })} disabled={!mailboxId}>
          <SquarePen size={16} aria-hidden="true" /> เขียนอีเมล
        </button>
      </div>
    </header>
  );

  const dialogs = (
    <>
      {manageOpen && <MailManage mailbox={mailbox} notify={notify} onChanged={refreshBootstrap} onClose={() => setManageOpen(false)} />}
      {compose && mailbox && (
        <MailCompose
          start={compose}
          mailboxId={mailbox.id}
          from={mailbox.displayName ? `${mailbox.displayName} <${mailbox.address}>` : mailbox.address}
          notify={notify}
          onClose={() => setCompose(null)}
          onDone={(next) => {
            setCompose(null);
            if (folder === next) void loadMessages();
            else chooseFolder(next);
          }}
        />
      )}
      <MailImageViewer image={viewedImage} onClose={() => setViewedImage(null)} />
    </>
  );

  if (loadError && !mailboxes) {
    return (
      <section className="wm">
        {header}
        <div className="wm-start is-error" role="alert">
          <span className="wm-start-icon" aria-hidden="true"><CircleAlert size={24} /></span>
          <h2>โหลดอีเมลไม่สำเร็จ</h2>
          <p>{loadError}</p>
          <button type="button" className="wm-btn" onClick={() => { setLoadError(""); refreshBootstrap().catch((error) => setLoadError((error as Error).message)); }}>
            <RefreshCw size={16} aria-hidden="true" /> ลองใหม่
          </button>
        </div>
      </section>
    );
  }

  if (mailboxes && !mailboxes.length) {
    return (
      <section className="wm">
        {header}
        <div className="wm-start">
          <span className="wm-start-icon" aria-hidden="true"><Mail size={24} /></span>
          <h2>ยังไม่มีกล่องอีเมล</h2>
          <p>มีโดเมนอยู่แล้วก็เพิ่มแล้วสร้างกล่องได้เลย ถ้าจะใช้กล่องของทีม บอกเจ้าของกล่องให้เพิ่มชื่อผู้ใช้ของคุณ</p>
          <button type="button" className="wm-btn wm-btn-primary" onClick={() => setManageOpen(true)}><MailPlus size={16} aria-hidden="true" /> สร้างกล่องอีเมล</button>
        </div>
        {dialogs}
      </section>
    );
  }

  return (
    <section className="wm">
      {header}
      <div className={`wm-shell${selected ? " is-reading" : ""}`}>
        <nav className="wm-nav" aria-label="กล่องอีเมลและโฟลเดอร์">
          <div className="wm-box">
            {mailbox && mailboxes ? (
              <>
                <MailboxPicker mailboxes={mailboxes} current={mailbox} onChoose={chooseMailbox} />
                <CopyButton value={mailbox.address} onError={copyFailed} />
              </>
            ) : (
              <span className="wm-skeleton-line" aria-hidden="true" />
            )}
          </div>
          <ul className="wm-folders">
            {FOLDERS.map((item) => (
              <li key={item.id}>
                <button type="button" className={folder === item.id ? "is-active" : ""} aria-current={folder === item.id ? "page" : undefined} onClick={() => chooseFolder(item.id)}>
                  <item.icon size={17} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.id === "inbox" && mailbox?.unread ? <b aria-label={`ยังไม่อ่าน ${mailbox.unread} ฉบับ`}>{mailbox.unread > 99 ? "99+" : mailbox.unread}</b> : null}
                </button>
              </li>
            ))}
          </ul>
          {mailbox && mailbox.quotaBytes > 0 && (
            <div className="wm-usage" title={`ใช้ไป ${usage.toFixed(1)}%`}>
              <span className="wm-usage-bar"><i className={usage > 90 ? "is-full" : ""} style={{ width: `${usage}%` }} /></span>
              <small>ใช้ไป {bytes(mailbox.usedBytes)} จาก {bytes(mailbox.quotaBytes)}</small>
            </div>
          )}
        </nav>

        <section className="wm-list" aria-label={currentFolder.label} aria-busy={loading}>
          <form className="wm-list-tools" role="search" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
            <label className="wm-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); setSearch(""); } }}
                placeholder={`ค้นหาใน${currentFolder.label}`}
                aria-label={`ค้นหาใน${currentFolder.label}`}
              />
              {query && <button type="button" className="wm-icon-btn" onClick={() => { setQuery(""); setSearch(""); }} aria-label="ล้างคำค้นหา"><X size={15} aria-hidden="true" /></button>}
            </label>
            <button type="button" className="wm-icon-btn" onClick={() => void loadMessages()} aria-label="โหลดอีเมลใหม่" title="โหลดอีเมลใหม่" disabled={loading}>
              <RefreshCw size={16} aria-hidden="true" className={loading && items.length ? "wm-spin" : ""} />
            </button>
          </form>

          <div className="wm-rows">
            {loading && !items.length ? (
              <ul className="wm-skeleton" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((index) => <li key={index}><span /><span /><span /></li>)}
              </ul>
            ) : listError && !items.length ? (
              <div className="wm-list-empty is-error" role="alert">
                <CircleAlert size={28} aria-hidden="true" />
                <p>โหลดอีเมลไม่สำเร็จ: {listError}</p>
                <button type="button" className="wm-link" onClick={() => void loadMessages()}>ลองใหม่</button>
              </div>
            ) : !items.length ? (
              <div className="wm-list-empty">
                <currentFolder.icon size={28} aria-hidden="true" />
                {search ? (
                  <>
                    <p>ไม่พบอีเมลที่ตรงกับ “{search}”</p>
                    <button type="button" className="wm-link" onClick={() => { setQuery(""); setSearch(""); }}>ล้างคำค้นหา</button>
                  </>
                ) : (
                  <>
                    <p>{currentFolder.empty}</p>
                    {folder === "inbox" && mailbox && (
                      <span className="wm-list-empty-hint">
                        ที่อยู่ของกล่องนี้คือ <b>{mailbox.address}</b>
                        <CopyButton value={mailbox.address} withText onError={copyFailed} />
                      </span>
                    )}
                  </>
                )}
              </div>
            ) : (
              <ul className="wm-items">
                {items.map((item) => {
                  const outbound = folder === "sent" || folder === "draft";
                  const to = people(item.recipients, "to");
                  const name = outbound
                    ? to.length ? `ถึง ${to.map((person) => person.name || person.address).join(", ")}` : "ยังไม่ใส่ผู้รับ"
                    : item.fromName || item.from;
                  const active = selected?.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`wm-row${!item.read && !outbound ? " is-unread" : ""}${active ? " is-active" : ""}${opening === item.id ? " is-opening" : ""}`}
                        aria-current={active ? "true" : undefined}
                        onClick={() => void openMessage(item)}
                      >
                        <span className="wm-avatar" aria-hidden="true">{initial(outbound ? to[0]?.name || to[0]?.address || "?" : item.fromName || item.from)}</span>
                        <span className="wm-row-main">
                          <span className="wm-row-top">
                            <strong title={outbound ? to.map(personLabel).join(", ") : item.from}>{name}</strong>
                            <time dateTime={item.date} title={fullDate(item.date)}>{shortDate(item.date, now)}</time>
                          </span>
                          <span className="wm-row-subject">
                            <span>{item.subject || "(ไม่มีหัวข้อ)"}</span>
                            {item.hasAttachments && <Paperclip size={14} aria-label="มีไฟล์แนบ" />}
                          </span>
                          {item.preview && <span className="wm-row-preview">{cleanPreview(item.preview)}</span>}
                        </span>
                        {!item.read && !outbound && <span className="wm-sr">ยังไม่อ่าน</span>}
                      </button>
                    </li>
                  );
                })}
                {nextCursor > 0 && (
                  <li className="wm-more">
                    <button type="button" className="wm-btn" onClick={() => void loadMore()} disabled={loadingMore}>
                      {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่ม"}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>

        <article className="wm-read" ref={readerRef} aria-label={selected ? selected.subject || "อีเมล" : "อ่านอีเมล"}>
          {selected ? (
            <>
              <div className="wm-read-bar">
                <button type="button" className="wm-btn wm-back" onClick={closeMessage}>
                  <ChevronLeft size={17} aria-hidden="true" /> {currentFolder.label}
                </button>
                <div className="wm-read-actions">
                  {selected.folder === "draft" ? (
                    <button type="button" className="wm-btn wm-btn-primary" onClick={editDraft}><SquarePen size={16} aria-hidden="true" /> แก้ไขร่าง</button>
                  ) : (
                    <>
                      <button type="button" className="wm-btn" onClick={() => reply("reply")}><Reply size={16} aria-hidden="true" /> <span>ตอบกลับ</span></button>
                      {multipleRecipients && <button type="button" className="wm-btn" onClick={() => reply("all")}><ReplyAll size={16} aria-hidden="true" /> <span>ตอบทุกคน</span></button>}
                      <button type="button" className="wm-btn" onClick={() => reply("forward")}><Forward size={16} aria-hidden="true" /> <span>ส่งต่อ</span></button>
                    </>
                  )}
                  {selected.folder === "inbox" && (
                    <button type="button" className="wm-icon-btn" onClick={() => void markUnread()} aria-label="ทำเป็นยังไม่อ่าน" title="ทำเป็นยังไม่อ่าน"><MailOpen size={17} aria-hidden="true" /></button>
                  )}
                  {selected.folder === "trash" ? (
                    <button type="button" className="wm-icon-btn" onClick={() => void moveSelected("inbox")} aria-label="ย้ายกลับไปกล่องขาเข้า" title="ย้ายกลับไปกล่องขาเข้า"><ArchiveRestore size={17} aria-hidden="true" /></button>
                  ) : (
                    <button type="button" className="wm-icon-btn wm-icon-danger" onClick={() => void moveSelected("trash")} aria-label="ย้ายไปถังขยะ" title="ย้ายไปถังขยะ"><Trash2 size={17} aria-hidden="true" /></button>
                  )}
                </div>
              </div>

              <header className="wm-read-head">
                <h2>{selected.subject || "(ไม่มีหัวข้อ)"}</h2>
                {threadMessages.length > 1 && <span className="wm-thread-count">{threadMessages.length} ฉบับในเรื่องนี้</span>}
              </header>

              {threadMessages.length > 1 ? (
                <ol className="wm-thread">
                  {threadMessages.map((message) => {
                    const open = expanded.has(message.id);
                    const mine = message.direction === "outbound";
                    return (
                      <li key={message.id} className={open ? "is-open" : ""}>
                        <button type="button" className="wm-thread-head" aria-expanded={open} onClick={() => toggleThread(message.id)}>
                          <span className="wm-avatar" aria-hidden="true">{initial(mine ? mailbox?.displayName || me : message.fromName || message.from)}</span>
                          <span className="wm-thread-who">
                            <strong>{mine ? "ฉัน" : message.fromName || message.from}</strong>
                            {!open && <span className="wm-thread-snippet">{message.text}</span>}
                          </span>
                          <time dateTime={message.date} title={fullDate(message.date)}>{shortDate(message.date, now)}</time>
                        </button>
                        {open && (
                          <div className="wm-thread-body">
                            <p className="wm-meta">
                              {mine ? <>จาก {message.from}</> : <>จาก <span className="wm-addr">{message.from}</span> <CopyButton value={message.from} onError={copyFailed} /></>}
                              {people(message.recipients, "to").length > 0 && <> · ถึง {people(message.recipients, "to").map(personLabel).join(", ")}</>}
                            </p>
                            <MailBody html={message.html} text={message.text} onImage={setViewedImage} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <>
                  <div className="wm-sender">
                    <span className="wm-avatar" aria-hidden="true">{initial(selected.fromName || selected.from)}</span>
                    <div className="wm-sender-text">
                      <p className="wm-sender-line">
                        <strong>{selected.direction === "outbound" ? "ฉัน" : selected.fromName || localPart(selected.from)}</strong>
                        <span className="wm-addr">{selected.from}</span>
                        {selected.direction !== "outbound" && <CopyButton value={selected.from} onError={copyFailed} />}
                      </p>
                      <dl className="wm-people">
                        {(["to", "cc", "bcc"] as const).map((kind) => {
                          const list = people(selected.recipients, kind);
                          if (!list.length) return null;
                          return (
                            <div key={kind}>
                              <dt>{kind === "to" ? "ถึง" : kind === "cc" ? "สำเนา" : "สำเนาลับ"}</dt>
                              <dd>
                                {list.map((person) => (
                                  <span key={person.address} className="wm-person">
                                    {person.name ? <>{person.name} <span className="wm-addr">{person.address}</span></> : person.address}
                                    {selected.direction === "outbound" && person.address === otherParty && <CopyButton value={person.address} onError={copyFailed} />}
                                  </span>
                                ))}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </div>
                    <time className="wm-sender-date" dateTime={selected.date}>{fullDate(selected.date || selected.receivedAt)}</time>
                  </div>
                  <MailBody key={selected.id} html={selected.html} text={selected.text} onImage={setViewedImage} />
                </>
              )}

              {selected.attachments?.some((file) => file.downloadUrl && !file.inBody && PREVIEW_IMAGE_TYPES.has(file.contentType.toLowerCase())) && (
                <div className="wm-images">
                  {selected.attachments
                    .filter((file) => file.downloadUrl && !file.inBody && PREVIEW_IMAGE_TYPES.has(file.contentType.toLowerCase()))
                    .map((file) => (
                      <button key={file.id} type="button" title={`ดู ${file.filename}`} onClick={() => setViewedImage({ src: `${API_BASE}${file.downloadUrl}`, name: file.filename })}>
                        <img src={`${API_BASE}${file.downloadUrl}`} alt={file.filename} loading="lazy" />
                      </button>
                    ))}
                </div>
              )}
              {selected.attachments?.length ? (
                <section className="wm-files" aria-label="ไฟล์แนบ">
                  <h3>ไฟล์แนบ {selected.attachments.length} ไฟล์</h3>
                  <ul>
                    {selected.attachments.map((file) => (
                      <li key={file.id}>
                        <a href={file.downloadUrl ? `${API_BASE}${file.downloadUrl}` : `${API_BASE}/api/mail/attachments/${file.id}`} download={file.filename} title={`ดาวน์โหลด ${file.filename}`}>
                          <Paperclip size={16} aria-hidden="true" />
                          <span className="wm-file-name">{file.filename}</span>
                          <small>{bytes(file.sizeBytes)}</small>
                          <Download size={16} aria-hidden="true" className="wm-file-get" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {selected.folder !== "draft" && (
                <div className="wm-read-foot">
                  <button type="button" className="wm-btn" onClick={() => reply("reply")}><Reply size={16} aria-hidden="true" /> ตอบกลับ</button>
                  <button type="button" className="wm-btn" onClick={() => reply("forward")}><Forward size={16} aria-hidden="true" /> ส่งต่อ</button>
                </div>
              )}
            </>
          ) : (
            <div className="wm-read-empty">
              <Mail size={32} aria-hidden="true" />
              <p>เลือกอีเมลที่จะอ่าน</p>
            </div>
          )}
        </article>
      </div>
      {dialogs}
    </section>
  );
}
