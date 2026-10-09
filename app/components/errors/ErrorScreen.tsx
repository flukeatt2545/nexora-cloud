"use client";

import { LockKeyhole, RotateCw, Home } from "lucide-react";
import "./error-screen.css";

export default function ErrorScreen({ status, reset }: { status: number; reset?: () => void }) {
  const copy = status === 404 ? { title: "ไม่พบหน้าที่ต้องการ", message: "หน้านี้อาจถูกย้ายหรือลบไปแล้ว" } : { title: "ระบบมีปัญหา", message: "ลองอีกครั้งในอีกสักครู่" };
  return <div className="nexora-error-screen">
    <header><a className="error-brand" href="/">NEXORA</a></header>
    <main><section><div className="error-status-wrap"><div className="error-status" aria-label={`ข้อผิดพลาด ${status}`}>{status}</div><LockKeyhole className="error-lock" size={38} aria-hidden="true" /></div><h1>{copy.title}</h1><p>{copy.message}</p></section>
      <nav aria-label="ตัวเลือกเมื่อพบปัญหา">{reset && <button type="button" onClick={reset}><RotateCw size={18} aria-hidden="true" />ลองอีกครั้ง</button>}<a href="/"><Home size={18} aria-hidden="true" />กลับหน้าหลัก</a></nav>
    </main></div>;
}
