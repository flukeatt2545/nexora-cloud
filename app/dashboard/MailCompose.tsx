"use client";

import { Bold, Italic, List, ListOrdered, Paperclip, RemoveFormatting, Send, Underline, X } from "lucide-react";
import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useEscape, useScrollLock } from "./useScrollLock";
import { api, bytes, type ComposeState, type Notice } from "./mailShared";

const MAX_ATTACHMENTS = 20 * 1024 * 1024;

function addresses(value: string) {
  return value.split(/[;,\n]/).map((address) => ({ address: address.trim() })).filter((item) => item.address);
}

/** Size of a base64 attachment once decoded. */
const decodedSize = (content: string) => Math.ceil(content.length * 0.75);

/**
 * The new-message window. It keeps its own fields; the parent only learns that a message was
 * sent or saved, and which folder to show next.
 */
export default function MailCompose({ start, mailboxId, from, notify, onClose, onDone }: {
  start: ComposeState;
  mailboxId: string;
  from: string;
  notify: Notice;
  onClose: () => void;
  onDone: (folder: "sent" | "draft") => void;
}) {
  const [compose, setCompose] = useState(start);
  const [showCopies, setShowCopies] = useState(Boolean(start.cc || start.bcc));
  const [sending, setSending] = useState<"" | "send" | "draft">("");
  const [confirmClose, setConfirmClose] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const initialHtml = useRef(start.html);

  const isReply = Boolean(start.inReplyTo) || /^(Re|Fwd): /.test(start.subject);
  const title = start.draftId ? "แก้ไขฉบับร่าง" : isReply ? (start.subject.startsWith("Fwd: ") ? "ส่งต่อ" : "ตอบกลับ") : "ข้อความใหม่";
  const attachedBytes = compose.attachments.reduce((sum, file) => sum + decodedSize(file.content), 0);

  useScrollLock(true);
  // A reply already has its recipient: start in the message itself, above the quoted text.
  useEffect(() => {
    const editor = editorRef.current;
    if (!start.to || !editor) return;
    editor.focus();
    const range = document.createRange();
    range.setStart(editor, 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [start.to]);
  useEscape(!sending, () => requestClose());

  function dirty() {
    const body = editorRef.current?.innerHTML ?? "";
    return compose.to !== start.to || compose.cc !== start.cc || compose.bcc !== start.bcc || compose.subject !== start.subject
      || compose.attachments.length !== start.attachments.length || body !== initialHtml.current;
  }
  function requestClose() {
    if (confirmClose) return setConfirmClose(false);
    if (dirty()) setConfirmClose(true);
    else onClose();
  }

  async function submit(event: FormEvent | null, draft = false) {
    event?.preventDefault();
    if (!mailboxId || sending) return;
    if (!draft && !addresses(compose.to).length) {
      notify({ kind: "error", text: "ใส่อีเมลผู้รับก่อนส่ง" });
      return;
    }
    setSending(draft ? "draft" : "send");
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
      notify({ kind: "success", text: draft ? "บันทึกร่างแล้ว" : "เข้าคิวส่งอีเมลแล้ว" });
      onDone(draft ? "draft" : "sent");
    } catch (error) {
      notify({ kind: "error", text: (error as Error).message });
      setSending("");
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (attachedBytes + files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENTS) {
      notify({ kind: "error", text: "ไฟล์แนบรวมต้องไม่เกิน 20 MB" });
      return;
    }
    const converted = await Promise.all(files.map((file) => new Promise<ComposeState["attachments"][number]>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ filename: file.name, contentType: file.type || "application/octet-stream", content: String(reader.result).split(",")[1] || "" });
      reader.readAsDataURL(file);
    })));
    setCompose((current) => ({ ...current, attachments: [...current.attachments, ...converted] }));
  }

  // Formatting buttons keep the caret where it was: mousedown would otherwise take the focus
  // (and the selection) out of the editor before the command runs.
  const tools = [
    { command: "bold", label: "ตัวหนา", icon: Bold },
    { command: "italic", label: "ตัวเอียง", icon: Italic },
    { command: "underline", label: "ขีดเส้นใต้", icon: Underline },
    { command: "insertUnorderedList", label: "รายการแบบจุด", icon: List },
    { command: "insertOrderedList", label: "รายการแบบตัวเลข", icon: ListOrdered },
    { command: "removeFormat", label: "ล้างรูปแบบ", icon: RemoveFormatting },
  ];

  function onKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submit(null);
    }
  }

  return (
    <div className="wm-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <form className="wm-dialog wm-compose" role="dialog" aria-modal="true" aria-labelledby="wm-compose-title" onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown}>
        <header className="wm-dialog-head">
          <h2 id="wm-compose-title">{title}</h2>
          <button type="button" className="wm-icon-btn" onClick={requestClose} aria-label="ปิด" disabled={Boolean(sending)}><X size={18} aria-hidden="true" /></button>
        </header>

        <div className="wm-compose-fields">
          <div className="wm-field-row">
            <span className="wm-field-label">จาก</span>
            <span className="wm-field-static">{from}</span>
          </div>
          <label className="wm-field-row">
            <span className="wm-field-label">ถึง</span>
            <input
              value={compose.to}
              onChange={(event) => setCompose({ ...compose, to: event.target.value })}
              placeholder="name@example.com"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={!start.to}
            />
            {!showCopies && (
              <button type="button" className="wm-text-btn" onClick={() => setShowCopies(true)}>สำเนา / สำเนาลับ</button>
            )}
          </label>
          {showCopies && (
            <>
              <label className="wm-field-row">
                <span className="wm-field-label">สำเนา</span>
                <input value={compose.cc} onChange={(event) => setCompose({ ...compose, cc: event.target.value })} inputMode="email" autoCapitalize="none" spellCheck={false} />
              </label>
              <label className="wm-field-row">
                <span className="wm-field-label">สำเนาลับ</span>
                <input value={compose.bcc} onChange={(event) => setCompose({ ...compose, bcc: event.target.value })} inputMode="email" autoCapitalize="none" spellCheck={false} />
              </label>
            </>
          )}
          <label className="wm-field-row">
            <span className="wm-field-label">หัวข้อ</span>
            <input value={compose.subject} onChange={(event) => setCompose({ ...compose, subject: event.target.value })} placeholder="ไม่มีหัวข้อ" />
          </label>
        </div>

        <div className="wm-editor-tools" role="toolbar" aria-label="จัดรูปแบบข้อความ">
          {tools.map((tool) => (
            <button key={tool.command} type="button" className="wm-icon-btn" title={tool.label} aria-label={tool.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { document.execCommand(tool.command); editorRef.current?.focus(); }}>
              <tool.icon size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div
          className="wm-editor"
          ref={editorRef}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="ข้อความ"
          data-placeholder="เขียนข้อความ"
          suppressContentEditableWarning
          dangerouslySetInnerHTML={{ __html: start.html }}
        />

        {compose.attachments.length > 0 && (
          <ul className="wm-chips" aria-label="ไฟล์แนบ">
            {compose.attachments.map((file, index) => (
              <li key={`${file.filename}-${index}`} className="wm-chip">
                <Paperclip size={14} aria-hidden="true" />
                <span className="wm-chip-name" title={file.filename}>{file.filename}</span>
                <small>{bytes(decodedSize(file.content))}</small>
                <button type="button" onClick={() => setCompose({ ...compose, attachments: compose.attachments.filter((_, i) => i !== index) })} aria-label={`เอา ${file.filename} ออก`}>
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {confirmClose ? (
          <footer className="wm-dialog-foot wm-discard" role="alert">
            <span>ปิดหน้านี้แล้วข้อความที่เขียนจะหาย</span>
            <button type="button" className="wm-btn" onClick={() => setConfirmClose(false)}>เขียนต่อ</button>
            <button type="button" className="wm-btn" onClick={() => void submit(null, true)} disabled={Boolean(sending)}>บันทึกร่าง</button>
            <button type="button" className="wm-btn wm-btn-danger" onClick={onClose}>ทิ้งข้อความ</button>
          </footer>
        ) : (
          <footer className="wm-dialog-foot">
            <label className="wm-btn wm-attach" title="แนบไฟล์ รวมไม่เกิน 20 MB">
              <Paperclip size={16} aria-hidden="true" />
              <span>แนบไฟล์</span>
              <input type="file" multiple onChange={(event) => void attach(event)} />
            </label>
            {attachedBytes > 0 && <small className="wm-attach-size">{bytes(attachedBytes)} จาก 20 MB</small>}
            <span className="wm-grow" />
            <button type="button" className="wm-btn" onClick={() => void submit(null, true)} disabled={Boolean(sending)}>
              {sending === "draft" ? "กำลังบันทึก..." : "บันทึกร่าง"}
            </button>
            <button type="submit" className="wm-btn wm-btn-primary" disabled={Boolean(sending)} title="Ctrl + Enter">
              {sending === "send" ? <span className="wm-spinner" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
              {sending === "send" ? "กำลังส่ง..." : "ส่ง"}
            </button>
          </footer>
        )}
      </form>
    </div>
  );
}
