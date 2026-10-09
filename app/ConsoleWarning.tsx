"use client";

import { useEffect } from "react";

// Printed once per page load, so anyone told to paste code into DevTools sees why not to
// (self-XSS: the pasted code runs as them and can take over their account).
let shown = false;

export default function ConsoleWarning() {
  useEffect(() => {
    if (shown) return;
    shown = true;
    const brand = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "currentColor";
    console.log(
      "%cหยุดก่อน!",
      `color:${brand};font-size:40px;font-weight:800;line-height:1.3;font-family:Kanit,system-ui,sans-serif`,
    );
    console.log(
      "%cตรงนี้เป็นเครื่องมือสำหรับนักพัฒนา ถ้ามีคนบอกให้คัดลอกโค้ดมาวางตรงนี้\nนั่นคือการหลอกเพื่อขโมยบัญชีของคุณ — NEXORA จะไม่ขอให้ทำแบบนี้",
      "font-size:16px;line-height:1.6;font-family:Kanit,system-ui,sans-serif",
    );
  }, []);
  return null;
}
