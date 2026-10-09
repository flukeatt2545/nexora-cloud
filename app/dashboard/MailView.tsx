"use client";

import {
  Archive,
  ChevronLeft,
  Copy,
  Download,
  File,
  Inbox,
  KeyRound,
  Mail,
  MailPlus,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Smartphone,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { API_BASE } from "../runtime";
import { useEscape, useScrollLock } from "./useScrollLock";
import "./mail.css";

type Notice = (notice: { kind: "success" | "error"; text: string }) => void;
type Mailbox = {
  id: string;
  address: string;
  displayName: string;
  quotaBytes: number;
  usedBytes: number;
  dailySendLimit: number;
  role: string;
  unread: number;
};
type MailItem = {
  id: string;
  threadId: string;
  direction: string;
  folder: string;
  status: string;
  from: string;
  fromName: string;
  subject: string;
  preview: string;
  date: string;
  read: boolean;
  hasAttachments: boolean;
  recipients: { kind: string; address: string; name: string }[];
};
type ThreadMessage = Pick<
  Message,
  | "id"
  | "direction"
  | "folder"
  | "status"
  | "from"
  | "fromName"
  | "subject"
  | "html"
  | "text"
  | "inReplyTo"
  | "references"
  | "internetMessageId"
  | "recipients"
> & { date: string };
type Message = MailItem & {
  html: string;
  text: string;
  inReplyTo: string;
  internetMessageId?: string;
  references: string[];
  sentAt?: string;
  receivedAt?: string;
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    downloadUrl?: string;
    inBody?: boolean;
  }[];
};

// Image types the browser can show directly. SVG stays a download.
const PREVIEW_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Images inside the body point at /api/...; in development the API is on another port. */
function withApiBase(html: string) {
  return API_BASE ? html.replaceAll('src="/api/', `src="${API_BASE}/api/`) : html;
}

type ViewedImage = { src: string; name: string };

/**
 * One message body. Earlier messages quoted in a reply are hidden behind a "•••" button, as
 * Gmail does, and pictures in the body open in the image viewer instead of doing nothing.
 */
function MailBody({ html, text, onImage }: { html: string; text: string; onImage: (image: ViewedImage) => void }) {
  const [showQuotes, setShowQuotes] = useState(false);
  if (!html) {
    return (
      <div className="mail-body">
        <p>{text}</p>
      </div>
    );
  }
  const hasQuotes = html.includes("<blockquote");
  return (
    <>
      <div
        className={`mail-body${hasQuotes && !showQuotes ? " hide-quotes" : ""}`}
        dangerouslySetInnerHTML={{ __html: withApiBase(html) }}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target instanceof HTMLImageElement && target.src) {
            onImage({ src: target.src, name: target.alt || "รูปภาพ" });
          }
        }}
      />
      {hasQuotes ? (
        <button
          type="button"
          className="mail-quote-toggle"
          aria-expanded={showQuotes}
          title={showQuotes ? "ซ่อนข้อความเดิม" : "แสดงข้อความเดิม"}
          onClick={() => setShowQuotes((value) => !value)}
        >
          {showQuotes ? "ซ่อนข้อความเดิม" : "•••"}
        </button>
      ) : null}
    </>
  );
}

/** Full-size view of a mail image, with download. Closes on Escape or a click outside. */
function MailImageViewer({ image, onClose }: { image: ViewedImage | null; onClose: () => void }) {
  useScrollLock(Boolean(image));
  useEscape(Boolean(image), onClose);
  if (!image) return null;
  return (
    <div className="mail-viewer" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}>
      <div className="mail-viewer-bar" onClick={(event) => event.stopPropagation()}>
        <span>{image.name}</span>
        <a href={image.src} download={image.name} className="mail-viewer-btn">
          <Download size={16} /> ดาวน์โหลด
        </a>
        <button type="button" className="mail-viewer-btn" onClick={onClose} aria-label="ปิด">
          <X size={18} />
        </button>
      </div>
      <img src={image.src} alt={image.name} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}
type Domain = {
  id: string;
  domain: string;
  kind: string;
  status: string;
  dnsRecords: Record<string, unknown>[];
  verifiedAt?: string;
  approvedAt?: string;
  ownerUsername?: string;
  mailboxCount: number;
};
type ComposeState = {
  draftId?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html: string;
  inReplyTo: string;
  references: string[];
  attachments: { filename: string; contentType: string; content: string }[];
};
type DeviceSettings = {
  ready: boolean;
  provisionState: string;
  lastError?: string;
  address: string;
  incoming: { host: string; port: number; security: string };
  outgoing: { host: string; port: number; security: string };
  credentials: { id: string; description: string; createdAt: string }[];
};

const emptyCompose: ComposeState = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  html: "",
  inReplyTo: "",
  references: [],
  attachments: [],
};

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ทำรายการไม่สำเร็จ");
  return payload as T;
}

function addresses(value: string) {
  return value
    .split(/[;,\n]/)
    .map((address) => ({ address: address.trim() }))
    .filter((item) => item.address);
}

function bytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1024 * 1024 * 1024)
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function when(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function MailView({ notify }: { notify: Notice }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [mailboxId, setMailboxId] = useState("");
  const [folder, setFolder] = useState("inbox");
  const [items, setItems] = useState<MailItem[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [viewedImage, setViewedImage] = useState<ViewedImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [sending, setSending] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domainName, setDomainName] = useState("");
  const [newMailbox, setNewMailbox] = useState({
    domainId: "",
    localPart: "",
    displayName: "",
  });
  const [memberName, setMemberName] = useState("");
  const [aliasName, setAliasName] = useState("");
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings | null>(null);
  const [devicePassword, setDevicePassword] = useState("");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const refreshBootstrap = useCallback(async () => {
    const data = await api<{ mailboxes: Mailbox[] }>("/api/mail/bootstrap");
    setMailboxes(data.mailboxes || []);
    setMailboxId((current) => current || data.mailboxes?.[0]?.id || "");
  }, []);

  const loadMessages = useCallback(async () => {
    if (!mailboxId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api<{ items: MailItem[] }>(
        `/api/mail/messages?mailboxId=${encodeURIComponent(mailboxId)}&folder=${folder}&q=${encodeURIComponent(query)}`,
      );
      setItems(data.items || []);
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, [folder, mailboxId, notify, query]);

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        refreshBootstrap().catch((error) =>
          notify({ kind: "error", text: error.message }),
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [notify, refreshBootstrap]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadMessages(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages]);
  useEffect(() => {
    const refresh = () =>
      document.visibilityState === "visible" &&
      refreshBootstrap()
        .then(loadMessages)
        .catch(() => undefined);
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadMessages, refreshBootstrap]);

  async function openMessage(item: MailItem) {
    try {
      const [message, thread] = await Promise.all([
        api<Message>(`/api/mail/messages/${item.id}?mailboxId=${encodeURIComponent(mailboxId)}`),
        item.threadId
          ? api<{ items: ThreadMessage[] }>(
              `/api/mail/threads/${item.threadId}?mailboxId=${encodeURIComponent(mailboxId)}`,
            )
          : Promise.resolve({ items: [] }),
      ]);
      setSelected(message);
      setThreadMessages(thread.items || []);
      setItems((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, read: true } : item,
        ),
      );
      void refreshBootstrap();
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    }
  }

  async function moveMessage(target: "trash" | "inbox") {
    if (!selected) return;
    await api(`/api/mail/messages/${selected.id}?mailboxId=${encodeURIComponent(mailboxId)}`, {
      method: "PATCH",
      body: JSON.stringify({ folder: target }),
    });
    setSelected(null);
    await loadMessages();
    await refreshBootstrap();
  }

  function reply(forward = false) {
    if (!selected) return;
    const recipient = forward ? "" : selected.from;
    const prefix = forward ? "Fwd: " : "Re: ";
    setCompose({
      ...emptyCompose,
      to: recipient,
      subject: selected.subject.startsWith(prefix)
        ? selected.subject
        : prefix + selected.subject,
      inReplyTo: forward ? "" : selected.internetMessageId || "",
      references: forward
        ? []
        : [
            ...(selected.references || []),
            ...(selected.internetMessageId ? [selected.internetMessageId] : []),
          ],
      html: `<p><br></p><blockquote>${selected.html || escapeHTML(selected.text)}</blockquote>`,
    });
  }

  async function submitCompose(event: FormEvent, draft = false) {
    event.preventDefault();
    if (!compose || !mailboxId) return;
    setSending(true);
    try {
      const payload = {
        mailboxId,
        to: addresses(compose.to),
        cc: addresses(compose.cc),
        bcc: addresses(compose.bcc),
        subject: compose.subject,
        html: editorRef.current?.innerHTML || compose.html,
        inReplyTo: compose.inReplyTo,
        references: compose.references,
        attachments: compose.attachments,
      };
      await api(draft ? "/api/mail/drafts" : "/api/mail/messages/send", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: draft ? undefined : { "Idempotency-Key": crypto.randomUUID() },
      });
      if (!draft && compose.draftId) {
        await api(`/api/mail/messages/${compose.draftId}?mailboxId=${encodeURIComponent(mailboxId)}`, {
          method: "PATCH",
          body: JSON.stringify({ folder: "trash" }),
        });
      }
      notify({
        kind: "success",
        text: draft ? "บันทึกร่างแล้ว" : "เข้าคิวส่งอีเมลแล้ว",
      });
      setCompose(null);
      if (draft) setFolder("draft");
      else setFolder("sent");
      await loadMessages();
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setSending(false);
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    const currentSize =
      compose?.attachments.reduce(
        (sum, item) => sum + Math.ceil(item.content.length * 0.75),
        0,
      ) || 0;
    if (
      currentSize + files.reduce((sum, file) => sum + file.size, 0) >
      20 * 1024 * 1024
    ) {
      notify({ kind: "error", text: "ไฟล์แนบรวมต้องไม่เกิน 20 MB" });
      return;
    }
    const converted = await Promise.all(
      files.map(
        (file) =>
          new Promise<ComposeState["attachments"][number]>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                filename: file.name,
                contentType: file.type || "application/octet-stream",
                content: String(reader.result).split(",")[1] || "",
              });
            reader.readAsDataURL(file);
          }),
      ),
    );
    setCompose(
      (current) =>
        current && {
          ...current,
          attachments: [...current.attachments, ...converted],
        },
    );
    event.target.value = "";
  }

  function editDraft() {
    if (!selected) return;
    const recipients = selected.recipients || [];
    setCompose({
      ...emptyCompose,
      draftId: selected.id,
      to: recipients
        .filter((item) => item.kind === "to")
        .map((item) => item.address)
        .join(", "),
      cc: recipients
        .filter((item) => item.kind === "cc")
        .map((item) => item.address)
        .join(", "),
      bcc: recipients
        .filter((item) => item.kind === "bcc")
        .map((item) => item.address)
        .join(", "),
      subject: selected.subject,
      html: selected.html || selected.text,
      inReplyTo: selected.inReplyTo,
      references: selected.references || [],
    });
  }

  async function loadDomains() {
    const data = await api<{ items: Domain[] }>("/api/mail/domains");
    setDomains(data.items || []);
  }

  async function openManage() {
    setManageOpen(true);
    try {
      await loadDomains();
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    }
  }

  async function createDomain(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/mail/domains", {
        method: "POST",
        body: JSON.stringify({ domain: domainName, kind: "custom" }),
      });
      setDomainName("");
      await loadDomains();
      notify({
        kind: "success",
        text: "เพิ่มโดเมนแล้ว กรุณานำค่า DNS ไปตั้งค่า",
      });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    }
  }

  async function createOwnedMailbox(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/mail/mailboxes", {
        method: "POST",
        body: JSON.stringify(newMailbox),
      });
      setNewMailbox({ ...newMailbox, localPart: "", displayName: "" });
      await refreshBootstrap();
      await loadDomains();
      notify({ kind: "success", text: "สร้างกล่องอีเมลแล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    }
  }

  async function addMemberOrAlias(kind: "member" | "alias") {
    if (!mailboxId) return;
    try {
      await api(
        `/api/mail/mailboxes/${mailboxId}/${kind === "member" ? "members" : "aliases"}`,
        {
          method: "POST",
          body: JSON.stringify(
            kind === "member"
              ? { username: memberName }
              : { localPart: aliasName },
          ),
        },
      );
      if (kind === "member") setMemberName("");
      else setAliasName("");
      notify({
        kind: "success",
        text: kind === "member" ? "เพิ่มสมาชิกแล้ว" : "เพิ่ม Alias แล้ว",
      });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    }
  }

  async function loadDeviceSettings() {
    if (!mailboxId) return;
    setDeviceBusy(true);
    try {
      const settings = await api<DeviceSettings>(`/api/mail/mailboxes/${mailboxId}/device-settings`);
      setDeviceSettings(settings);
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setDeviceBusy(false);
    }
  }

  async function createDevicePassword() {
    if (!mailboxId) return;
    setDeviceBusy(true);
    try {
      const result = await api<{ password: string }>(`/api/mail/mailboxes/${mailboxId}/device-passwords`, {
        method: "POST",
        body: JSON.stringify({ description: "iPhone" }),
      });
      setDevicePassword(result.password);
      await loadDeviceSettings();
      notify({ kind: "success", text: "สร้างรหัสผ่านสำหรับ iPhone แล้ว รหัสนี้จะแสดงครั้งเดียว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setDeviceBusy(false);
    }
  }

  async function revokeDevicePassword(credentialId: string) {
    if (!mailboxId) return;
    setDeviceBusy(true);
    try {
      await api(`/api/mail/mailboxes/${mailboxId}/device-passwords/${credentialId}`, { method: "DELETE" });
      setDevicePassword("");
      await loadDeviceSettings();
      notify({ kind: "success", text: "ยกเลิกรหัสผ่านอุปกรณ์แล้ว" });
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
    } finally {
      setDeviceBusy(false);
    }
  }

  const mailbox = mailboxes.find((item) => item.id === mailboxId);
  const folders = [
    { id: "inbox", label: "กล่องขาเข้า", icon: Inbox },
    { id: "sent", label: "ส่งแล้ว", icon: Send },
    { id: "draft", label: "ฉบับร่าง", icon: File },
    { id: "trash", label: "ถังขยะ", icon: Trash2 },
  ];
  return (
    <section className="mail-page">
      <header className="mail-page-head">
        <div>
          <span>WEBMAIL</span>
          <h1>อีเมลโดเมน</h1>
          <p>ส่ง รับ และจัดการอีเมลของคุณในที่เดียว</p>
        </div>
        <div className="mail-head-actions">
          <button onClick={() => void openManage()}>
            <Settings2 size={18} />
            จัดการ
          </button>
          <button
            className="mail-primary"
            onClick={() => setCompose({ ...emptyCompose })}
            disabled={!mailboxId}
          >
            <MailPlus size={18} />
            เขียนอีเมล
          </button>
        </div>
      </header>
      {!mailboxes.length && !loading ? (
        <div className="mail-empty">
          <Mail size={38} />
          <h2>ยังไม่มีกล่องอีเมล</h2>
          <p>ให้เจ้าของโดเมนหรือแอดมินสร้างกล่องและเพิ่มบัญชีของคุณก่อน</p>
        </div>
      ) : (
        <div className={`mail-shell ${selected ? "show-message" : ""}`}>
          <aside className="mail-folders">
            <select
              value={mailboxId}
              onChange={(e) => {
                setMailboxId(e.target.value);
                setSelected(null);
              }}
              aria-label="กล่องอีเมล"
            >
              {mailboxes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.address}
                </option>
              ))}
            </select>
            {folders.map((item) => (
              <button
                key={item.id}
                className={folder === item.id ? "active" : ""}
                onClick={() => {
                  setFolder(item.id);
                  setSelected(null);
                }}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
                {item.id === "inbox" && mailbox?.unread ? (
                  <b>{mailbox.unread}</b>
                ) : null}
              </button>
            ))}
            {mailbox && (
              <div className="mail-usage">
                <span>
                  <i
                    style={{
                      width: `${Math.min(100, (mailbox.usedBytes / mailbox.quotaBytes) * 100)}%`,
                    }}
                  />
                </span>
                <small>
                  {bytes(mailbox.usedBytes)} จาก {bytes(mailbox.quotaBytes)}
                </small>
              </div>
            )}
          </aside>
          <div className="mail-list">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadMessages();
              }}
            >
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาอีเมล"
              />
              <button
                title="รีเฟรช"
                type="button"
                onClick={() => void loadMessages()}
              >
                <RefreshCw size={17} />
              </button>
            </form>
            {loading ? (
              <div className="mail-list-status">กำลังโหลด...</div>
            ) : !items.length ? (
              <div className="mail-list-status">ไม่มีอีเมลในโฟลเดอร์นี้</div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  className={`mail-row ${!item.read ? "unread" : ""} ${selected?.id === item.id ? "active" : ""}`}
                  onClick={() => void openMessage(item)}
                >
                  <span className="mail-avatar">
                    {(item.fromName || item.from || "M")[0].toUpperCase()}
                  </span>
                  <span>
                    <strong>
                      {folder === "sent"
                        ? item.recipients?.find((r) => r.kind === "to")
                            ?.address || "ผู้รับ"
                        : item.fromName || item.from}
                    </strong>
                    <b>{item.subject || "(ไม่มีหัวข้อ)"}</b>
                    <small>{item.preview}</small>
                  </span>
                  <time>{when(item.date)}</time>
                  {item.hasAttachments && <Paperclip size={14} />}
                </button>
              ))
            )}
          </div>
          <article className="mail-message">
            {selected ? (
              <>
                <header>
                  <button
                    className="mail-back"
                    onClick={() => setSelected(null)}
                  >
                    <ChevronLeft size={18} />
                    กลับ
                  </button>
                  <div>
                    <h2>{selected.subject || "(ไม่มีหัวข้อ)"}</h2>
                    <p>
                      จาก <strong>{selected.fromName || selected.from}</strong>{" "}
                      &lt;{selected.from}&gt;
                    </p>
                  </div>
                  <time>{when(selected.date || selected.receivedAt)}</time>
                </header>
                <div className="mail-message-actions">
                  {selected.folder === "draft" && (
                    <button onClick={editDraft}>แก้ไขร่าง</button>
                  )}
                  {selected.folder !== "draft" && (
                    <>
                      <button onClick={() => reply(false)}>ตอบกลับ</button>
                      <button onClick={() => reply(true)}>ส่งต่อ</button>
                    </>
                  )}
                  <button
                    onClick={() =>
                      void moveMessage(
                        selected.folder === "trash" ? "inbox" : "trash",
                      )
                    }
                  >
                    {selected.folder === "trash" ? (
                      <Archive size={16} />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    {selected.folder === "trash" ? "กู้คืน" : "ลบ"}
                  </button>
                </div>
                {threadMessages.length > 1 ? (
                  <div className="mail-thread">
                    {threadMessages.map((message) => (
                      <section key={message.id}>
                        <header>
                          <strong>
                            {message.direction === "outbound"
                              ? "ฉัน"
                              : message.fromName || message.from}
                          </strong>
                          <time>{when(message.date)}</time>
                        </header>
                        <MailBody html={message.html} text={message.text} onImage={setViewedImage} />
                      </section>
                    ))}
                  </div>
                ) : (
                  <MailBody key={selected.id} html={selected.html} text={selected.text} onImage={setViewedImage} />
                )}
                {selected.attachments?.some((file) => file.downloadUrl && !file.inBody && PREVIEW_IMAGE_TYPES.has(file.contentType.toLowerCase())) ? (
                  <div className="mail-images">
                    {selected.attachments
                      .filter((file) => file.downloadUrl && !file.inBody && PREVIEW_IMAGE_TYPES.has(file.contentType.toLowerCase()))
                      .map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          title={`ดู ${file.filename}`}
                          onClick={() => setViewedImage({ src: `${API_BASE}${file.downloadUrl}`, name: file.filename })}
                        >
                          <img src={`${API_BASE}${file.downloadUrl}`} alt={file.filename} loading="lazy" />
                        </button>
                      ))}
                  </div>
                ) : null}
                {selected.attachments?.length ? (
                  <div className="mail-attachments">
                    {selected.attachments.map((file) => (
                      <a
                        key={file.id}
                        href={file.downloadUrl ? `${API_BASE}${file.downloadUrl}` : `${API_BASE}/api/mail/attachments/${file.id}`}
                        download={file.filename}
                        title={`ดาวน์โหลด ${file.filename}`}
                      >
                        <Paperclip size={15} />
                        <span className="mail-attachment-name">{file.filename}</span>
                        <small>{bytes(file.sizeBytes)}</small>
                        <Download size={15} className="mail-attachment-get" />
                      </a>
                    ))}
                  </div>
                ) : null}
                <MailImageViewer image={viewedImage} onClose={() => setViewedImage(null)} />
              </>
            ) : (
              <div className="mail-message-placeholder">
                <Mail size={40} />
                <p>เลือกอีเมลเพื่ออ่าน</p>
              </div>
            )}
          </article>
        </div>
      )}
      {manageOpen && (
        <div
          className="mail-compose-backdrop mail-manage-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setManageOpen(false)
          }
        >
          <section className="mail-manage">
            <header>
              <div>
                <Settings2 size={20} />
                <strong>จัดการอีเมลโดเมน</strong>
              </div>
              <button onClick={() => setManageOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <div className="mail-manage-grid">
              <form className="mail-admin-card" onSubmit={createDomain}>
                <h2>
                  <Plus size={18} />
                  เพิ่มโดเมนลูกค้า
                </h2>
                <label>
                  โดเมน
                  <input
                    value={domainName}
                    onChange={(event) => setDomainName(event.target.value)}
                    placeholder="example.com"
                    required
                  />
                </label>
                <button className="mail-primary">เพิ่มโดเมน</button>
              </form>
              <form className="mail-admin-card" onSubmit={createOwnedMailbox}>
                <h2>
                  <MailPlus size={18} />
                  สร้างกล่องอีเมล
                </h2>
                <label>
                  โดเมน
                  <select
                    value={newMailbox.domainId}
                    onChange={(event) =>
                      setNewMailbox({
                        ...newMailbox,
                        domainId: event.target.value,
                      })
                    }
                    required
                  >
                    <option value="">เลือกโดเมนที่อนุมัติแล้ว</option>
                    {domains
                      .filter((item) => item.status === "active")
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          @{item.domain}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  ชื่ออีเมล
                  <input
                    value={newMailbox.localPart}
                    onChange={(event) =>
                      setNewMailbox({
                        ...newMailbox,
                        localPart: event.target.value,
                      })
                    }
                    placeholder="contact"
                    required
                  />
                </label>
                <label>
                  ชื่อแสดง
                  <input
                    value={newMailbox.displayName}
                    onChange={(event) =>
                      setNewMailbox({
                        ...newMailbox,
                        displayName: event.target.value,
                      })
                    }
                  />
                </label>
                <button className="mail-primary">สร้างกล่อง</button>
              </form>
            </div>
            {mailbox?.role === "owner" && (
              <div className="mail-admin-card mail-owner-tools">
                <h2>สมาชิก Alias และอุปกรณ์ · {mailbox.address}</h2>
                <div>
                  <label>
                    Username สมาชิก
                    <input
                      value={memberName}
                      onChange={(event) => setMemberName(event.target.value)}
                      placeholder="username"
                    />
                  </label>
                  <button
                    onClick={() => void addMemberOrAlias("member")}
                    disabled={!memberName}
                  >
                    <UserPlus size={16} />
                    เพิ่มสมาชิก
                  </button>
                  <label>
                    ชื่อ Alias
                    <input
                      value={aliasName}
                      onChange={(event) => setAliasName(event.target.value)}
                      placeholder="support"
                    />
                  </label>
                  <button
                    onClick={() => void addMemberOrAlias("alias")}
                    disabled={!aliasName}
                  >
                    <Plus size={16} />
                    เพิ่ม Alias
                  </button>
                </div>
                <section className="mail-device-setup">
                  <header>
                    <div>
                      <Smartphone size={18} />
                      <strong>ใช้งานใน iPhone Mail</strong>
                    </div>
                    <button type="button" onClick={() => void loadDeviceSettings()} disabled={deviceBusy}>
                      {deviceSettings ? "รีเฟรช" : "ดูการตั้งค่า"}
                    </button>
                  </header>
                  {deviceSettings && (
                    <>
                      <div className="mail-device-servers">
                        <span><small>ชื่อผู้ใช้</small><code>{deviceSettings.address}</code></span>
                        <span><small>IMAP ขาเข้า</small><code>{deviceSettings.incoming.host}:{deviceSettings.incoming.port} · {deviceSettings.incoming.security}</code></span>
                        <span><small>SMTP ขาออก</small><code>{deviceSettings.outgoing.host}:{deviceSettings.outgoing.port} · {deviceSettings.outgoing.security}</code></span>
                      </div>
                      {devicePassword && (
                        <div className="mail-device-password">
                          <small>รหัสผ่านอุปกรณ์ — คัดลอกตอนนี้ ระบบจะไม่แสดงอีก</small>
                          <code>{devicePassword}</code>
                          <button type="button" onClick={() => void navigator.clipboard.writeText(devicePassword)}>
                            <Copy size={15} /> คัดลอก
                          </button>
                        </div>
                      )}
                      <div className="mail-device-actions">
                        <button type="button" className="mail-primary" onClick={() => void createDevicePassword()} disabled={deviceBusy || !deviceSettings.ready}>
                          <KeyRound size={15} /> สร้างรหัสผ่าน iPhone
                        </button>
                        {deviceSettings.credentials.map((credential) => (
                          <button type="button" key={credential.id} onClick={() => void revokeDevicePassword(credential.id)} disabled={deviceBusy}>
                            ยกเลิก {credential.description}
                          </button>
                        ))}
                      </div>
                      {!deviceSettings.ready && <small className="mail-device-error">{deviceSettings.lastError || "กล่องอีเมลยังเชื่อมต่อ Stalwart ไม่สำเร็จ"}</small>}
                    </>
                  )}
                </section>
              </div>
            )}
            <div className="mail-manage-domains">
              <h2>สถานะโดเมน</h2>
              {domains.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.domain}</strong>
                    <small>{item.status.replaceAll("_", " ")}</small>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        await api(`/api/mail/domains/${item.id}/verify`, {
                          method: "POST",
                        });
                        await loadDomains();
                        notify({ kind: "success", text: "ตรวจ DNS แล้ว" });
                      } catch (error) {
                        notify({
                          kind: "error",
                          text: (error as Error).message,
                        });
                      }
                    }}
                  >
                    <RefreshCw size={15} />
                    ตรวจ DNS
                  </button>
                  {item.dnsRecords?.length ? (
                    <details>
                      <summary>ดูค่า DNS</summary>
                      <pre>{JSON.stringify(item.dnsRecords, null, 2)}</pre>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
      {compose && (
        <div
          className="mail-compose-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setCompose(null)}
        >
          <form
            className="mail-compose"
            onSubmit={(e) => void submitCompose(e)}
          >
            <header>
              <div>
                <MailPlus size={19} />
                <strong>ข้อความใหม่</strong>
              </div>
              <button type="button" onClick={() => setCompose(null)}>
                <X size={18} />
              </button>
            </header>
            <label>
              <span>ถึง</span>
              <input
                value={compose.to}
                onChange={(e) => setCompose({ ...compose, to: e.target.value })}
                placeholder="name@example.com"
                required
              />
            </label>
            <details>
              <summary>สำเนา / สำเนาลับ</summary>
              <label>
                <span>CC</span>
                <input
                  value={compose.cc}
                  onChange={(e) =>
                    setCompose({ ...compose, cc: e.target.value })
                  }
                />
              </label>
              <label>
                <span>BCC</span>
                <input
                  value={compose.bcc}
                  onChange={(e) =>
                    setCompose({ ...compose, bcc: e.target.value })
                  }
                />
              </label>
            </details>
            <input
              className="mail-subject"
              value={compose.subject}
              onChange={(e) =>
                setCompose({ ...compose, subject: e.target.value })
              }
              placeholder="หัวข้อ"
            />
            <div className="mail-editor-tools">
              <button
                type="button"
                onClick={() => document.execCommand("bold")}
              >
                <b>B</b>
              </button>
              <button
                type="button"
                onClick={() => document.execCommand("italic")}
              >
                <i>I</i>
              </button>
              <button
                type="button"
                onClick={() => document.execCommand("insertUnorderedList")}
              >
                • รายการ
              </button>
            </div>
            <div
              className="mail-editor"
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: compose.html }}
            />
            {compose.attachments.map((file, index) => (
              <span
                className="mail-file-chip"
                key={`${file.filename}-${index}`}
              >
                <Paperclip size={13} />
                {file.filename}
                <button
                  type="button"
                  onClick={() =>
                    setCompose({
                      ...compose,
                      attachments: compose.attachments.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <footer>
              <label className="mail-attach">
                <Paperclip size={17} />
                แนบไฟล์
                <input type="file" multiple onChange={(e) => void attach(e)} />
              </label>
              <span />
              <button
                type="button"
                onClick={(e) =>
                  void submitCompose(e as unknown as FormEvent, true)
                }
                disabled={sending}
              >
                บันทึกร่าง
              </button>
              <button className="mail-primary" disabled={sending}>
                <Send size={16} />
                {sending ? "กำลังส่ง..." : "ส่ง"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
