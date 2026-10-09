"use client";

import {
  AlertCircle, Check, CheckCircle2, Clock, Copy, Download, ExternalLink, Eye, EyeOff, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Lock, QrCode, ShieldCheck, Smartphone, X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getDocumentTitle, type SiteTitleMode } from "../../../pageTitle";
import { applyThemeColor } from "../../../themeColor";
import { API_BASE } from "../../../runtime";
import LinkGone, { SHARE_TOKEN, linkGoneKind, type LinkGoneKind } from "../../../components/LinkGone";
import "../../file-download.css";

type SharedFile = {
  name: string;
  contentType: string;
  size: number;
  expiresAt?: string | null;
  passwordRequired: boolean;
};

type PublicSettings = {
  brandName?: string;
  siteTitle?: string;
  siteTitleMode?: SiteTitleMode;
  logoUrl?: string;
  primaryColor?: string;
  themeMode?: "light" | "dark";
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function fileKind(contentType: string, name: string) {
  const type = contentType.toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toUpperCase() : "";

  if (type.startsWith("image/") || ["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG", "ICO", "AVIF"].includes(ext)) {
    return { label: "รูปภาพ", ext: ext || "IMG", icon: FileImage, theme: "image", previewable: true, formatName: "รูปภาพกราฟิก" };
  }
  if (type.startsWith("video/") || ["MP4", "WEBM", "MOV", "MKV", "AVI"].includes(ext)) {
    return { label: "วิดีโอ", ext: ext || "VIDEO", icon: FileVideo, theme: "video", previewable: true, formatName: "ไฟล์วิดีโอมีเดีย" };
  }
  if (type.startsWith("audio/") || ["MP3", "WAV", "OGG", "M4A", "FLAC", "AAC"].includes(ext)) {
    return { label: "ไฟล์เสียง", ext: ext || "AUDIO", icon: FileAudio, theme: "audio", previewable: true, formatName: "ไฟล์เสียงมีเดีย" };
  }
  if (["DOC", "DOCX"].includes(ext) || type.includes("wordprocessingml") || type.includes("msword")) {
    return { label: "เอกสาร Word", ext: ext || "DOCX", icon: FileText, theme: "word", previewable: true, formatName: "Microsoft Word" };
  }
  if (["XLS", "XLSX"].includes(ext) || type.includes("spreadsheetml") || type.includes("excel")) {
    return { label: "สเปรดชีต Excel", ext: ext || "XLSX", icon: FileSpreadsheet, theme: "excel", previewable: true, formatName: "Microsoft Excel" };
  }
  if (["PPT", "PPTX"].includes(ext) || type.includes("presentationml") || type.includes("powerpoint")) {
    return { label: "งานนำเสนอ PPT", ext: ext || "PPTX", icon: FileText, theme: "ppt", previewable: true, formatName: "PowerPoint Presentation" };
  }
  if (type.includes("pdf") || ext === "PDF") {
    return { label: "เอกสาร PDF", ext: "PDF", icon: FileText, theme: "pdf", previewable: true, formatName: "Adobe PDF Document" };
  }
  if (["ZIP", "RAR", "7Z", "TAR", "GZ", "BZ2", "XZ"].includes(ext) || type.includes("zip") || type.includes("gzip") || type.includes("tar") || type.includes("rar") || type.includes("7z")) {
    return { label: "ไฟล์บีบอัด", ext: ext || "ZIP", icon: FileArchive, theme: "archive", previewable: true, formatName: "Compressed Archive" };
  }
  if (type.startsWith("text/") || ["TXT", "MD", "JSON", "JS", "TS", "HTML", "CSS", "PY", "GO", "PHP", "SQL", "CSV", "LOG", "ENV", "XML", "YAML", "YML"].includes(ext)) {
    return { label: "ข้อความ / โค้ด", ext: ext || "CODE", icon: FileCode, theme: "code", previewable: true, formatName: "Text / Source Code" };
  }
  return { label: "เอกสารทั่วไป", ext: ext || "FILE", icon: FileText, theme: "default", previewable: true, formatName: "Binary / Document" };
}

function formatExpiry(value?: string | null) {
  if (!value) return { primary: "ไม่หมดอายุ", secondary: "จนกว่าเจ้าของจะยกเลิกลิงก์", status: "permanent" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { primary: "ไม่ระบุวันหมดอายุ", secondary: "", status: "unknown" };
  const exact = date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  const hours = (date.getTime() - Date.now()) / 36e5;
  if (hours <= 0) return { primary: "ลิงก์หมดอายุแล้ว", secondary: exact, status: "expired" };
  if (hours < 18) return { primary: `เหลืออีก ${Math.max(1, Math.round(hours))} ชม.`, secondary: `หมดอายุ: ${exact}`, status: "soon" };
  const days = Math.max(1, Math.round(hours / 24));
  if (days < 8) return { primary: `เหลืออีก ${Math.round(days)} วัน`, secondary: `หมดอายุ: ${exact}`, status: "active" };
  return { primary: exact, secondary: "", status: "active" };
}

// The address does not change while this page is open; there is nothing to subscribe to.
const subscribeNever = () => () => {};

function readShareToken() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const filesIdx = parts.indexOf("files");
  const value = filesIdx >= 0 && parts[filesIdx + 1] === "d" ? parts[filesIdx + 2] || "" : "";
  return value.toLowerCase();
}

/** The token from the address; null while rendering on the server. */
function useShareToken() {
  return useSyncExternalStore(subscribeNever, readShareToken, () => null);
}

export default function PublicFileSharePage() {
  const token = useShareToken();
  const [file, setFile] = useState<SharedFile | null>(null);
  const [error, setError] = useState("");
  const [failedKind, setGoneKind] = useState<LinkGoneKind>("gone");
  const [attempt, setAttempt] = useState(0);
  const [fetching, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const shareUrl = useSyncExternalStore(subscribeNever, () => window.location.href, () => "");
  const previewRequest = useRef(0);
  // A token that cannot be a share link is reported at once, without asking the server.
  const tokenBroken = token !== null && !SHARE_TOKEN.test(token);
  const loading = fetching && !tokenBroken;
  const goneKind: LinkGoneKind = tokenBroken ? "broken" : failedKind;

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
    if (token === null || tokenBroken) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/public/files/${encodeURIComponent(token)}`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { kind: linkGoneKind(response.status) });
        }
        return payload as SharedFile;
      })
      .then((value) => {
        if (!cancelled) setFile(value);
      })
      .catch((requestError: Error & { kind?: LinkGoneKind }) => {
        if (!cancelled) {
          setFile(null);
          // A network failure has no kind and only a browser message ("Failed to fetch").
          setGoneKind(requestError.kind ?? "offline");
          setError(requestError.kind ? requestError.message : "");
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
    document.title = file?.name
      ? `${file.name} · ${settings.brandName || settings.siteTitle || "NEXORA CLOUD"}`
      : getDocumentTitle(settings, window.location.pathname);
  }, [file, settings]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function downloadFile(event?: FormEvent) {
    event?.preventDefault();
    if (!token || !file || busy) return;
    if (file.passwordRequired && !password.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/public/files/${encodeURIComponent(token)}/download`, {
        method: file.passwordRequired ? "POST" : "GET",
        credentials: "include",
        headers: file.passwordRequired ? { "Content-Type": "application/json" } : undefined,
        body: file.passwordRequired ? JSON.stringify({ password }) : undefined,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "รหัสผ่านไม่ถูกต้อง หรือดาวน์โหลดไฟล์ไม่สำเร็จ");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloaded(true);
      window.setTimeout(() => setDownloaded(false), 2400);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "ดาวน์โหลดไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function handleCopyLink() {
    if (typeof window === "undefined") return;
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function handleOpenPreview() {
    if (!token || !file) return;
    const requestId = ++previewRequest.current;
    setShowPreviewModal(true);
    setPreviewLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/public/files/${encodeURIComponent(token)}/download?preview=1`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "ไม่สามารถเปิดตัวอย่างไฟล์ได้");
      }
      const blob = await response.blob();
      if (requestId !== previewRequest.current) return;

      const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase() : "";
      const isText = file.contentType.startsWith("text/") ||
        file.contentType.includes("json") ||
        ["txt", "md", "json", "csv", "js", "ts", "html", "css", "py", "go", "php", "sql", "log", "env", "xml", "yaml", "yml"].includes(ext);

      if (isText) {
        try {
          const raw = await blob.text();
          setPreviewText(raw.slice(0, 80000));
        } catch {
          setPreviewText(null);
        }
      } else {
        setPreviewText(null);
      }

      const url = URL.createObjectURL(blob);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(url);
    } catch (requestError) {
      if (requestId === previewRequest.current) {
        setError(requestError instanceof Error ? requestError.message : "ไม่สามารถเปิดตัวอย่างไฟล์ได้");
        setShowPreviewModal(false);
      }
    } finally {
      if (requestId === previewRequest.current) setPreviewLoading(false);
    }
  }

  function closePreview() {
    previewRequest.current += 1;
    setPreviewLoading(false);
    setShowPreviewModal(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setPreviewText(null);
  }

  const brandName = settings?.brandName || "NEXORA CLOUD";
  const kind = file ? fileKind(file.contentType, file.name) : null;
  const FileIcon = kind?.icon || FileText;
  const expiry = formatExpiry(file?.expiresAt);

  const qrImageUrl = shareUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}&margin=4`
    : "";

  return (
    <div className="fd-page">
      <div className="fd-ambient-glow" aria-hidden="true" />
      <div className="fd-grid-pattern" aria-hidden="true" />

      {/* Main file download area */}
      <main className="fd-main">
        <div className="fd-container">
          <div className="fd-card" aria-labelledby="file-share-title">
            {token === null || loading ? (
              <div className="fd-wait">
                <span className="fd-spinner" aria-hidden="true" />
                <div className="fd-wait-text">
                  <strong>กำลังตรวจสอบไฟล์ในระบบ...</strong>
                  <small>กำลังเชื่อมต่อ Edge Datacenter</small>
                </div>
              </div>
            ) : file && kind ? (
              <>
                <div className="fd-card-intro">
                  <h1>ไฟล์พร้อมดาวน์โหลด</h1>
                  <p>กดดาวน์โหลดเพื่อบันทึกไฟล์ลงอุปกรณ์ของคุณโดยตรง</p>
                </div>

                {/* File Showcase Box */}
                <div className={`fd-file-showcase ${kind.theme}`}>
                  <div className="fd-file-icon-wrap">
                    <FileIcon size={34} aria-hidden="true" />
                    <span className="fd-file-ext-tag">{kind.ext}</span>
                  </div>
                  <div className="fd-file-details">
                    <h2 id="file-share-title" className="fd-file-title" title={file.name}>
                      {file.name}
                    </h2>
                    <div className="fd-file-subinfo">
                      <span className="fd-file-size-tag">{formatBytes(file.size)}</span>
                      <span className="fd-file-dot">•</span>
                      <span className="fd-file-type-tag">{kind.label}</span>
                    </div>
                  </div>
                </div>

                {/* Specs Grid */}
                <div className="fd-specs-grid">
                  <div className="fd-spec-item">
                    <span className="fd-spec-label">ขนาดไฟล์</span>
                    <strong className="fd-spec-val">{formatBytes(file.size)}</strong>
                  </div>
                  <div className="fd-spec-item">
                    <span className="fd-spec-label">ประเภท</span>
                    <strong className="fd-spec-val" title={kind.formatName}>{kind.formatName}</strong>
                  </div>
                  <div className="fd-spec-item">
                    <span className="fd-spec-label">วันหมดอายุ</span>
                    <strong className={`fd-spec-val expiry ${expiry.status}`} title={expiry.secondary || undefined}>
                      <Clock size={13} aria-hidden="true" />
                      <span>{expiry.primary}</span>
                    </strong>
                  </div>
                </div>

                {/* Password Form or Download Actions */}
                {file.passwordRequired ? (
                  <form className="fd-form" onSubmit={downloadFile}>
                    <div className="fd-password-notice">
                      <span className="fd-password-notice-icon"><Lock size={17} aria-hidden="true" /></span>
                      <div>
                        <strong>ไฟล์นี้มีรหัสผ่าน</strong>
                        <span>กรอกรหัสผ่านที่ได้รับจากผู้ส่งเพื่อดาวน์โหลด</span>
                      </div>
                    </div>
                    <label className="fd-label">
                      <span className="fd-label-text">รหัสผ่าน</span>
                      <div className="fd-password-wrap">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          autoComplete="current-password"
                          autoFocus
                          required
                          placeholder="กรอกรหัสผ่าน"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((open) => !open)}
                          aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                          className="fd-pw-toggle"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </label>

                    <button
                      type="submit"
                      className={`fd-btn-download-primary ${downloaded ? "downloaded" : ""}`}
                      disabled={busy || !password.trim()}
                    >
                      {busy ? (
                        <>
                          <span className="fd-btn-spinner-dark" />
                          <span>กำลังตรวจสอบและดาวน์โหลด...</span>
                        </>
                      ) : downloaded ? (
                        <>
                          <CheckCircle2 size={18} aria-hidden="true" />
                          <span>เริ่มดาวน์โหลดไฟล์แล้ว!</span>
                        </>
                      ) : (
                        <>
                          <Download size={18} aria-hidden="true" />
                          <span>ปลดล็อก & ดาวน์โหลดไฟล์</span>
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="fd-actions">
                    <button
                      type="button"
                      className={`fd-btn-download-primary ${downloaded ? "downloaded" : ""}`}
                      onClick={() => void downloadFile()}
                      disabled={busy}
                    >
                      {busy ? (
                        <>
                          <span className="fd-btn-spinner-dark" />
                          <span>กำลังเตรียมไฟล์ดาวน์โหลด...</span>
                        </>
                      ) : downloaded ? (
                        <>
                          <CheckCircle2 size={18} aria-hidden="true" />
                          <span>เริ่มดาวน์โหลดไฟล์แล้ว!</span>
                        </>
                      ) : (
                        <>
                          <Download size={18} aria-hidden="true" />
                          <span>ดาวน์โหลดไฟล์</span>
                        </>
                      )}
                    </button>

                    <div className="fd-action-row">
                      {kind.previewable && !file.passwordRequired && (
                        <button
                          type="button"
                          className="fd-secondary-btn preview"
                          onClick={() => void handleOpenPreview()}
                          title="เปิดดูไฟล์ในแท็บใหม่"
                        >
                          <ExternalLink size={14} aria-hidden="true" />
                          <span>ดูตัวอย่าง</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="fd-secondary-btn"
                        onClick={handleCopyLink}
                        title="คัดลอกลิงก์แชร์"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copied ? "คัดลอกแล้ว!" : "คัดลอกลิงก์"}</span>
                      </button>

                      <button
                        type="button"
                        className="fd-secondary-btn qr-btn"
                        onClick={() => setShowQrModal(true)}
                        title="เปิด QR Code สำหรับมือถือ"
                      >
                        <QrCode size={14} aria-hidden="true" />
                        <span>เปิดบนมือถือ</span>
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="fd-alert" role="alert">
                    <AlertCircle size={16} aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}
              </>
            ) : (
              <LinkGone kind={goneKind} noun="ไฟล์" onRetry={() => { setLoading(true); setError(""); setAttempt((n) => n + 1); }} homeLink />
            )}
          </div>

          <div className="fd-trust-footer">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>{brandName} File Transfer · ปลอดภัยด้วยการเข้ารหัส SSL 256-bit</span>
          </div>
        </div>
      </main>

      {/* Mobile QR Modal */}
      {showQrModal && (
        <div className="fd-modal-overlay" onClick={() => setShowQrModal(false)}>
          <div className="fd-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="fd-modal-header">
              <div className="fd-modal-title-wrap">
                <Smartphone size={18} aria-hidden="true" />
                <strong>ดาวน์โหลดบนสมาร์ตโฟน</strong>
              </div>
              <button
                type="button"
                className="fd-modal-close"
                onClick={() => setShowQrModal(false)}
                aria-label="ปิดหน้าต่าง"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="fd-modal-body">
              <div className="fd-modal-qr-wrap">
                <img src={qrImageUrl} alt="QR Code สำหรับดาวน์โหลด" />
              </div>
              <p>ใช้กล้องถ่ายรูปบนมือถือสแกน QR Code เพื่อเปิดหน้าดาวน์โหลดบน iPhone หรือ Android ได้ทันที</p>
              <button
                type="button"
                className="fd-secondary-btn copy"
                onClick={handleCopyLink}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? "คัดลอกลิงก์แล้ว!" : "คัดลอกลิงก์แชร์"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreviewModal && (
        <div className="fd-modal-overlay" onClick={closePreview}>
          <div className="fd-modal-content fd-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="fd-modal-header">
              <div className="fd-modal-title-wrap">
                <ExternalLink size={18} aria-hidden="true" />
                <strong title={file?.name}>{file?.name || "ดูตัวอย่างไฟล์"}</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {previewUrl && (
                  <button
                    type="button"
                    className="fd-secondary-btn"
                    style={{ minHeight: "34px", padding: "0 12px", fontSize: "12.5px" }}
                    onClick={() => void downloadFile()}
                    title="ดาวน์โหลดไฟล์นี้"
                  >
                    <Download size={14} aria-hidden="true" />
                    <span>ดาวน์โหลด</span>
                  </button>
                )}
                <button type="button" className="fd-modal-close" onClick={closePreview} aria-label="ปิดตัวอย่างไฟล์">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="fd-preview-body">
              {previewLoading ? (
                <div className="fd-wait">
                  <span className="fd-spinner" aria-hidden="true" />
                  <div className="fd-wait-text"><strong>กำลังเปิดตัวอย่างไฟล์...</strong></div>
                </div>
              ) : file?.contentType.startsWith("image/") ? (
                <img src={previewUrl} alt={`ตัวอย่าง ${file.name}`} className="fd-preview-image" />
              ) : file?.contentType.startsWith("video/") ? (
                <video src={previewUrl} className="fd-preview-media" controls autoPlay />
              ) : file?.contentType.startsWith("audio/") ? (
                <div className="fd-preview-audio-stage">
                  <div className="fd-preview-audio-disc">
                    <FileAudio size={48} aria-hidden="true" />
                  </div>
                  <strong className="fd-preview-audio-title">{file.name}</strong>
                  <audio src={previewUrl} className="fd-preview-audio" controls autoPlay />
                </div>
              ) : kind?.theme === "pdf" || file?.contentType === "application/pdf" ? (
                <iframe src={previewUrl} title={`ตัวอย่าง ${file?.name || "เอกสาร PDF"}`} className="fd-preview-frame" />
              ) : previewText !== null ? (
                <div className="fd-preview-code-stage">
                  <pre className="fd-code-block">
                    <code>{previewText || "(ไฟล์ว่างเปล่า)"}</code>
                  </pre>
                </div>
              ) : (
                <div className="fd-preview-fallback-stage">
                  <FileIcon size={46} aria-hidden="true" />
                  <div className="fd-fallback-copy">
                    <strong>{kind?.theme === "archive" ? "ไฟล์บีบอัด (Archive)" : "ไม่สามารถแสดงตัวอย่างบนเบราว์เซอร์ได้"}</strong>
                    <p>
                      {kind?.theme === "archive"
                        ? "เบราว์เซอร์ไม่สามารถเปิดดูเนื้อหาภายในไฟล์แพ็กเกจนี้ได้โดยตรง กรุณากดดาวน์โหลดเพื่อแตกไฟล์และใช้งานบนอุปกรณ์ของคุณ"
                        : "ไฟล์ประเภทนี้จำเป็นต้องใช้โปรแกรมเฉพาะทางบนอุปกรณ์ของคุณในการเปิดอ่าน (เช่น Microsoft Office หรือซอฟต์แวร์เฉพาะ)"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="fd-btn-action-primary"
                    style={{ minHeight: "44px", padding: "0 22px", fontSize: "14px" }}
                    onClick={() => void downloadFile()}
                  >
                    <Download size={15} aria-hidden="true" />
                    <span>{kind?.theme === "archive" ? "ดาวน์โหลดไฟล์บีบอัด" : "ดาวน์โหลดเพื่อเปิดดู"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
