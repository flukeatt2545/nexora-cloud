"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, CirclePause, FileImage, Landmark, RefreshCw, ShieldCheck, X, Zap } from "lucide-react";

type TopupConfig = {
  configured: boolean;
  enabled: boolean;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  maxFileSize: number;
};

type TopupErrorNotice = { title: string; text: string };

const ALLOWED_SLIP_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function topupErrorTitle(code?: string) {
  switch (code) {
    case "duplicate_slip": return "สลิปนี้ถูกใช้แล้ว";
    case "receiver_mismatch": return "บัญชีผู้รับไม่ตรง";
    case "invalid_slip_size":
    case "invalid_slip_type": return "ไฟล์สลิปไม่ถูกต้อง";
    case "slip_reference_mismatch":
    case "slip_transaction_not_found":
    case "slip_qr_unverified":
    case "slip_flagged":
    case "slip_rejected": return "สลิปไม่ผ่านการตรวจสอบ";
    case "invalid_slip": return "สลิปไม่ถูกต้อง";
    case "receiver_unreadable":
    case "slip_amount_unreadable":
    case "slip_reference_unreadable":
    case "invalid_slip_amount":
    case "missing_transaction_reference": return "อ่านข้อมูลสลิปไม่สำเร็จ";
    case "topup_processing_failed": return "บันทึกยอดเติมเงินไม่สำเร็จ";
    case "topup_disabled":
    case "topup_not_configured":
    case "slip_provider_auth":
    case "slip_provider_quota":
    case "slip_provider_config": return "ระบบเติมเงินยังไม่พร้อม";
    default: return "เติมเงินไม่สำเร็จ";
  }
}

export function TopupModal({
  onClose,
  onSuccess,
  onError,
  apiBase,
}: {
  onClose: () => void;
  onSuccess: (points: number, amount: number) => void;
  onError: (notice: TopupErrorNotice) => void;
  apiBase: string;
}) {
  const [config, setConfig] = useState<TopupConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ amount: number; points: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);
  const onErrorRef = useRef(onError);

  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    fetch(`${apiBase}/api/topup/config`, { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "โหลดข้อมูลเติมเงินไม่สำเร็จ");
        setConfig(data);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        const message = requestError instanceof Error ? requestError.message : "โหลดข้อมูลเติมเงินไม่สำเร็จ";
        setError(message);
        onErrorRef.current({ title: "โหลดข้อมูลไม่สำเร็จ", text: message });
      })
      .finally(() => setConfigLoading(false));

    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      mountedRef.current = false;
      controller.abort();
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [apiBase, onClose]);

  function closeModal() {
    onClose();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !config?.configured || !config.enabled) return;

    const maxFileSize = config.maxFileSize || 5 * 1024 * 1024;
    if (!ALLOWED_SLIP_TYPES.has(file.type)) {
      const message = "รองรับเฉพาะไฟล์ JPG, PNG และ WebP";
      setError(message);
      onError({ title: "ไฟล์สลิปไม่ถูกต้อง", text: message });
      return;
    }
    if (file.size <= 0 || file.size > maxFileSize) {
      const message = `ไฟล์สลิปต้องมีขนาดไม่เกิน ${Math.round(maxFileSize / 1024 / 1024)} MB`;
      setError(message);
      onError({ title: "ไฟล์สลิปมีขนาดใหญ่เกินไป", text: message });
      return;
    }

    setLoading(true);
    setFileName(file.name);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("slip", file);

    try {
      const response = await fetch(`${apiBase}/api/topup/slip`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message = data?.error || "ไม่สามารถตรวจสอบสลิปได้";
        setError(message);
        onError({ title: topupErrorTitle(data?.code), text: message });
        return;
      }

      const points = Number(data.newPoints ?? data.points);
      const amount = Number(data.amount);
      if (!Number.isFinite(points) || !Number.isFinite(amount)) throw new Error("ผลลัพธ์การเติมเงินไม่ถูกต้อง");
      if (mountedRef.current) setSuccess({ amount, points });
      onSuccess(points, amount);
    } catch (requestError: unknown) {
      const message = requestError instanceof Error ? requestError.message : "ไม่สามารถตรวจสอบสลิปได้";
      if (mountedRef.current) {
        setError(message);
      }
      onError({ title: "เชื่อมต่อระบบไม่สำเร็จ", text: message });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop topup-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeModal()}>
      <section className={`topup-dialog ${config?.enabled === false ? "is-disabled" : ""}`} role="dialog" aria-modal="true" aria-labelledby="topup-title" aria-busy={loading}>
        <header className="topup-header">
          <span className="topup-header-icon"><Zap size={20} /></span>
          <div>
            <h2 id="topup-title">เติมเงิน</h2>
            <p>{config?.enabled === false ? "ยังไม่เปิดรับรายการเติมเงินในขณะนี้" : "โอนเงินแล้วอัปโหลดสลิปเพื่อรับ Points"}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="topup-close" onClick={closeModal} aria-label="ปิดหน้าต่างเติมเงิน"><X size={19} /></button>
        </header>

        <div className="topup-body">
          {success ? (
            <div className="topup-result success" role="status">
              <CheckCircle2 size={34} />
              <h3>เติมเงินสำเร็จ</h3>
              <p>ตรวจพบยอดโอน <strong>{success.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</strong></p>
              <div><span>ยอดคงเหลือ</span><strong>{success.points.toLocaleString("th-TH")} Points</strong></div>
              <button type="button" onClick={closeModal}>เสร็จสิ้น</button>
            </div>
          ) : configLoading ? (
            <div className="topup-loading"><RefreshCw size={20} /> กำลังโหลดข้อมูลบัญชี</div>
          ) : config?.enabled === false ? (
            <div className="topup-disabled-state" role="status">
              <span className="topup-disabled-icon"><CirclePause size={30} /></span>
              <h3>ปิดให้บริการชั่วคราว</h3>
              <button type="button" onClick={closeModal}>ปิดหน้าต่าง</button>
            </div>
          ) : (
            <>
              {config?.configured ? (
                <div className="topup-account">
                  <div className="topup-account-heading"><Landmark size={18} /><strong>บัญชีรับเงิน</strong></div>
                  <div className="topup-account-number"><span>เลขบัญชี</span><strong>{config.accountNumber}</strong></div>
                  <div className="topup-account-details">
                    <div><span>ธนาคาร</span><strong>{config.bankName || config.bankCode}</strong></div>
                    <div><span>ชื่อบัญชี</span><strong>{config.accountName}</strong></div>
                  </div>
                  <div className="topup-rate"><span>อัตราเติมเงิน</span><strong>1 บาท = 1 Point</strong></div>
                </div>
              ) : (
                <div className="topup-config-error"><AlertCircle size={20} /><div><strong>ยังไม่สามารถเติมเงินได้</strong><span>ระบบยังไม่ได้ตั้งค่าบัญชีรับเงิน</span></div></div>
              )}

              {error && <div className="topup-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}

              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={loading || !config?.configured || !config?.enabled} hidden />
              <button
                type="button"
                className="topup-upload"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading || !config?.configured || !config?.enabled}
              >
                {loading ? <RefreshCw className="topup-spinner" size={25} /> : <FileImage size={25} />}
                <span>{loading ? "กำลังตรวจสอบสลิป" : "เลือกรูปสลิป"}</span>
                <small>{loading ? fileName : "JPG, PNG หรือ WebP · ไม่เกิน 5 MB"}</small>
              </button>

              <p className="topup-security-note"><ShieldCheck size={14} /> Points จะเพิ่มเมื่อสลิปผ่านการตรวจสอบ ผู้รับถูกต้อง และไม่เคยใช้งานมาก่อน</p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
