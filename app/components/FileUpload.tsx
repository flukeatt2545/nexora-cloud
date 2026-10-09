"use client";

import React, { useState, useRef, useCallback } from "react";
import { 
  UploadCloud, 
  File as FileIcon, 
  Image as ImageIcon, 
  FileText, 
  Code,
  CheckCircle,
  AlertCircle,
  X,
  Shield,
  Plus
} from "lucide-react";
import { API_BASE } from "../runtime";

interface FileUploadProps {
  onUploadSuccess?: (url: string) => void;
  acceptedTypes?: string;
  maxSizeMB?: number;
  category?: string;
}

type StagedFile = {
  id: string;
  file: File;
  status: "ready" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
};

export default function FileUpload({ 
  onUploadSuccess, 
  acceptedTypes = "*", 
  maxSizeMB = 50,
  category = ""
}: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [batchProgress, setBatchProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // Blocked extensions (mirrors backend)
  const blockedExtensions = new Set([
    '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
    '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1', '.psm1',
    '.sh', '.bash', '.php', '.phtml', '.asp', '.aspx', '.jsp',
    '.dll', '.sys', '.drv', '.reg', '.inf', '.hta', '.cpl',
    '.jar', '.class', '.py', '.pyc', '.rb',
  ]);

  const addFiles = useCallback((incoming?: FileList | File[] | null) => {
    setError(null);
    setSuccess(null);
    if (!incoming || incoming.length === 0) return;

    const list = Array.from(incoming);
    const newItems: StagedFile[] = list.map((file) => {
      let err: string | undefined;
      if (file.size > maxSizeMB * 1024 * 1024) {
        err = `ขนาดไฟล์ต้องไม่เกิน ${maxSizeMB}MB`;
      }
      const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
      if (blockedExtensions.has(ext)) {
        err = `ไม่อนุญาตให้อัพโหลดไฟล์ประเภท ${ext}`;
      }
      return {
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        status: err ? "error" : "ready",
        progress: 0,
        error: err,
      };
    });

    setStagedFiles((prev) => [...prev, ...newItems]);
  }, [maxSizeMB]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    if (!dragActive) setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget && !e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleContainerClick = () => {
    if (stagedFiles.length === 0 && !uploading && inputRef.current) {
      inputRef.current.click();
    }
  };

  const removeStaged = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (uploading) return;
    setStagedFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (uploading) return;
    setStagedFiles([]);
    setError(null);
    setSuccess(null);
    setBatchProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setUploading(false);
    setCurrentIdx(-1);
  };

  const handleUpload = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const pending = stagedFiles.filter((sf) => sf.status !== "success" && !sf.error);
    if (pending.length === 0 || uploading) return;

    setUploading(true);
    setError(null);
    setSuccess(null);
    setBatchProgress(0);

    let successCount = 0;
    let failCount = 0;
    let lastUrl = "";
    const total = stagedFiles.length;

    for (let i = 0; i < stagedFiles.length; i++) {
      const item = stagedFiles[i];
      if (item.status === "success" || item.error) continue;

      setCurrentIdx(i);
      setStagedFiles((prev) =>
        prev.map((sf, idx) => (idx === i ? { ...sf, status: "uploading", progress: 0, error: undefined } : sf))
      );

      const ok = await new Promise<boolean>((resolve) => {
        const formData = new FormData();
        formData.append("file", item.file);
        if (category) formData.append("category", category);

        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setStagedFiles((prev) =>
              prev.map((sf, idx) => (idx === i ? { ...sf, progress: pct } : sf))
            );
            const overall = Math.round(((i + pct / 100) / total) * 100);
            setBatchProgress(overall);
          }
        });

        xhr.addEventListener("load", () => {
          xhrRef.current = null;
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              setStagedFiles((prev) =>
                prev.map((sf, idx) => (idx === i ? { ...sf, status: "success", progress: 100 } : sf))
              );
              if (data.url) lastUrl = data.url;
              resolve(true);
            } else {
              setStagedFiles((prev) =>
                prev.map((sf, idx) => (idx === i ? { ...sf, status: "error", error: data.error || "อัปโหลดไม่สำเร็จ" } : sf))
              );
              resolve(false);
            }
          } catch {
            setStagedFiles((prev) =>
              prev.map((sf, idx) => (idx === i ? { ...sf, status: "error", error: "ข้อผิดพลาดจากเซิร์ฟเวอร์" } : sf))
            );
            resolve(false);
          }
        });

        xhr.addEventListener("error", () => {
          xhrRef.current = null;
          setStagedFiles((prev) =>
            prev.map((sf, idx) => (idx === i ? { ...sf, status: "error", error: "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ" } : sf))
          );
          resolve(false);
        });

        xhr.addEventListener("abort", () => {
          xhrRef.current = null;
          setStagedFiles((prev) =>
            prev.map((sf, idx) => (idx === i ? { ...sf, status: "error", error: "ยกเลิกแล้ว" } : sf))
          );
          resolve(false);
        });

        xhr.open("POST", `${API_BASE}/api/admin/files/upload`);
        xhr.withCredentials = true;
        xhr.send(formData);
      });

      if (ok) successCount++;
      else failCount++;
      setBatchProgress(Math.round(((i + 1) / total) * 100));
    }

    setUploading(false);
    setCurrentIdx(-1);

    if (failCount === 0 && successCount > 0) {
      setSuccess(`อัปโหลดสำเร็จทั้งหมด ${successCount} ไฟล์`);
      if (onUploadSuccess && lastUrl) onUploadSuccess(lastUrl);
      setTimeout(() => {
        setStagedFiles([]);
        setSuccess(null);
        setBatchProgress(0);
        if (inputRef.current) inputRef.current.value = "";
      }, 2500);
    } else if (successCount > 0 && failCount > 0) {
      setError(`อัปโหลดสำเร็จ ${successCount} ไฟล์ แต่ล้มเหลว ${failCount} ไฟล์`);
    } else if (failCount > 0) {
      setError(`อัปโหลดไม่สำเร็จ (${failCount} ไฟล์)`);
    }
  };

  const getFileIcon = (file: File) => {
    const type = file.type;
    if (type.startsWith("image/")) return <ImageIcon className="w-5 h-5 text-blue-500" />;
    if (type.includes("pdf") || type.includes("document")) return <FileText className="w-5 h-5 text-red-500" />;
    if (type.includes("json") || type.includes("javascript") || type.includes("html") || type.includes("css")) return <Code className="w-5 h-5 text-amber-500" />;
    return <FileIcon className="w-5 h-5 text-blue-500" />;
  };

  return (
    <div className="w-full max-w-xl mx-auto">
      <div 
        onClick={handleContainerClick}
        className={`relative border-2 border-dashed rounded-xl p-6 transition-all duration-200 flex flex-col items-center justify-center text-center overflow-hidden
          ${stagedFiles.length === 0 ? "cursor-pointer" : ""}
          ${dragActive ? "border-blue-500 bg-blue-500/10 scale-[1.01]" : ""}
          ${error ? "border-red-500/50 bg-red-500/5" : ""}
          ${success ? "border-green-500/50 bg-green-500/5" : ""}`}
        style={{
          backgroundColor: dragActive ? undefined : "var(--theme-input)",
          borderColor: dragActive || error || success ? undefined : "var(--theme-line-soft)",
          boxShadow: "0 4px 20px var(--theme-shadow)",
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input 
          ref={inputRef}
          type="file" 
          multiple
          className="hidden" 
          accept={acceptedTypes}
          onChange={handleChange}
        />

        {stagedFiles.length === 0 ? (
          <div className="flex flex-col items-center gap-4 pointer-events-none">
            <div 
              className="w-16 h-16 rounded-full flex items-center justify-center border shadow-inner transition-colors"
              style={{
                backgroundColor: "var(--theme-hover)",
                borderColor: "var(--theme-line-soft)",
              }}
            >
              <UploadCloud 
                className={`w-8 h-8 ${dragActive ? "text-blue-500 scale-110" : ""} transition-transform duration-300`}
                style={{ color: dragActive ? undefined : "var(--theme-text-soft)" }}
              />
            </div>
            <div>
              <p className="font-medium mb-1 text-base" style={{ color: "var(--theme-text-strong)" }}>
                ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์
              </p>
              <p className="text-sm" style={{ color: "var(--theme-text-soft)" }}>
                รองรับการเลือกและอัปโหลดพร้อมกันหลายไฟล์
              </p>
              <div className="flex items-center justify-center gap-2 mt-4">
                <Shield className="w-3.5 h-3.5 text-green-500" />
                <p className="text-xs opacity-75" style={{ color: "var(--theme-text-soft)" }}>
                  ขนาดสูงสุด: {maxSizeMB}MB ต่อไฟล์ · สแกนความปลอดภัยอัตโนมัติ
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            {/* Header info */}
            <div className="flex items-center justify-between text-xs px-1">
              <span className="font-medium" style={{ color: "var(--theme-text-strong)" }}>
                เลือกไว้ <strong>{stagedFiles.length}</strong> ไฟล์ (รวม {(stagedFiles.reduce((s, f) => s + f.file.size, 0) / (1024 * 1024)).toFixed(2)} MB)
              </span>
              {!uploading && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border"
                    style={{ backgroundColor: "var(--theme-hover)", borderColor: "var(--theme-line-soft)", color: "var(--theme-text-strong)" }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    เพิ่มไฟล์
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-xs text-red-400 hover:text-red-500"
                  >
                    ล้างทั้งหมด
                  </button>
                </div>
              )}
            </div>

            {/* Staged file items list */}
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
              {stagedFiles.map((sf) => (
                <div
                  key={sf.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left relative overflow-hidden transition-colors ${sf.error ? "border-red-500/40 bg-red-500/5" : sf.status === "success" ? "border-green-500/40 bg-green-500/5" : ""}`}
                  style={{
                    backgroundColor: sf.error || sf.status === "success" ? undefined : "var(--theme-hover)",
                    borderColor: sf.error || sf.status === "success" ? undefined : "var(--theme-line-soft)",
                  }}
                >
                  <div className="shrink-0">
                    {getFileIcon(sf.file)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--theme-text-strong)" }}>
                      {sf.file.name}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] mt-0.5" style={{ color: "var(--theme-text-soft)" }}>
                      <span>{(sf.file.size / (1024 * 1024)).toFixed(2)} MB</span>
                      {sf.status === "ready" && <span>· รออัปโหลด</span>}
                      {sf.status === "uploading" && <span className="text-blue-400">· {sf.progress}%</span>}
                      {sf.status === "success" && <span className="text-green-500 font-medium">· สำเร็จ</span>}
                      {sf.status === "error" && <span className="text-red-400">· {sf.error || "ล้มเหลว"}</span>}
                    </div>
                  </div>

                  {/* Progress Line */}
                  {sf.status === "uploading" && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/20">
                      <div className="h-full bg-blue-500 transition-all duration-150" style={{ width: `${sf.progress}%` }} />
                    </div>
                  )}

                  {!uploading && sf.status !== "success" && (
                    <button
                      type="button"
                      onClick={(e) => removeStaged(sf.id, e)}
                      className="p-1 rounded hover:bg-black/10 text-gray-400 hover:text-red-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Overall Progress */}
            {uploading && (
              <div className="w-full space-y-1 text-left">
                <div className="flex items-center justify-between text-xs" style={{ color: "var(--theme-text-soft)" }}>
                  <span>กำลังอัปโหลด ({currentIdx + 1}/{stagedFiles.length})...</span>
                  <span className="font-bold">{batchProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--theme-hover)" }}>
                  <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${batchProgress}%` }} />
                </div>
                <div className="text-right">
                  <button type="button" onClick={handleCancel} className="text-xs text-red-400 hover:text-red-500">
                    ยกเลิกการอัปโหลด
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 px-3 py-2 rounded-lg border border-red-500/20 text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 text-green-500 text-xs bg-green-500/10 px-3 py-2 rounded-lg border border-green-500/20 text-left">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <p>{success}</p>
              </div>
            )}

            {!success && !uploading && (
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || stagedFiles.length === 0 || stagedFiles.every((f) => f.status === "success" || f.error)}
                className="w-full py-2.5 px-4 text-white font-semibold rounded-lg shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:brightness-110 text-sm"
                style={{
                  backgroundColor: "var(--primary)",
                }}
              >
                <UploadCloud className="w-4 h-4" />
                <span>
                  {stagedFiles.length > 1
                    ? `อัปโหลดทั้ง ${stagedFiles.filter((f) => f.status !== "success" && !f.error).length} ไฟล์`
                    : "อัปโหลดไฟล์"}
                </span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
