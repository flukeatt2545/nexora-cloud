"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { applyThemeColor } from "../themeColor";
import { getDocumentTitle, type SiteTitleMode } from "../pageTitle";
import { API_BASE } from "../runtime";
import { PageLoadingScreen } from "../components/PageLoadingScreen";
import "./terms.css";

interface PublicSettings {
  brandName: string;
  siteTitle: string;
  siteTitleMode: SiteTitleMode;
  siteDescription: string;
  primaryColor: string;
  themeMode: "light" | "dark";
  logoUrl: string;
  faviconUrl: string;
}

export default function TermsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/public`)
      .then((res) => (res.ok ? (res.json() as Promise<PublicSettings>) : null))
      .then((value) => {
        if (!value) return;
        setSettings(value);
        document.documentElement.dataset.theme = value.themeMode || "dark";
        applyThemeColor(value.primaryColor);
        document.title = getDocumentTitle(value, window.location.pathname);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const brandName = settings?.brandName || "NEXORA CLOUD";

  if (!ready) return <PageLoadingScreen label="กำลังโหลด..." />;

  return (
    <div className="terms-page-root">
      {/* Top Navigation */}
      <header className="terms-nav">
        <div className="terms-container nav-inner">
          <Link href="/" className="back-link">
            <ArrowLeft size={16} />
            <span>กลับหน้าหลัก</span>
          </Link>
          <div className="terms-brand-wrap">
            {settings?.logoUrl && <img src={settings.logoUrl} alt={brandName} className="terms-logo-img" />}
            <span className="brand-title">{brandName}</span>
          </div>
        </div>
      </header>

      {/* Header Title */}
      <div className="terms-hero">
        <div className="terms-container">
          <h1>ข้อกำหนดการใช้งาน</h1>
          <p className="subtitle">ข้อตกลงและเงื่อนไขการใช้บริการโฮสติ้งและฐานข้อมูล</p>
        </div>
      </div>

      {/* Main Content */}
      <main className="terms-container terms-body">
        <div className="terms-paper">
          <section className="terms-block">
            <h2>1. ข้อตกลงทั่วไป</h2>
            <p>
              ข้อกำหนดนี้เป็นข้อตกลงระหว่างผู้ใช้บริการกับ <strong>{brandName}</strong> 
              การลงทะเบียนหรือการใช้บริการโฮสติ้ง เว็บไซต์ ฐานข้อมูล หรือระบบใดๆ ถือว่าผู้ใช้บริการยอมรับเงื่อนไขในเอกสารนี้เรียบร้อยแล้ว
            </p>
          </section>

          <section className="terms-block">
            <h2>2. การดูแลรักษาบัญชี</h2>
            <p>
              ผู้ใช้บริการมีหน้าที่รักษาความปลอดภัยของชื่อผู้ใช้ รหัสผ่าน และการเข้าถึงระบบของตนเอง 
              หากมีความเสียหายหรือกิจกรรมเกิดขึ้นภายใต้บัญชีของผู้ใช้บริการ จะถือเป็นความรับผิดชอบของเจ้าของบัญชี
            </p>
          </section>

          <section className="terms-block">
            <h2>3. ข้อห้ามการใช้งาน</h2>
            <p>ไม่อนุญาตให้ใช้บริการ {brandName} ในการกระทำดังต่อไปนี้:</p>
            <ul className="terms-list">
              <li>ใช้งานเว็บไซต์หรือฐานข้อมูลเพื่อจัดเก็บและเผยแพร่สิ่งผิดกฎหมาย หรือละเมิดลิขสิทธิ์</li>
              <li>การโจมตีระบบ เช่น DDoS, Hacking, Port Scanning หรือส่งไวรัสและมัลแวร์</li>
              <li>รันกระบวนการขุดคริปโท (Crypto Mining) หรือใช้งาน CPU / RAM สูงเกินขีดจำกัดอย่างต่อเนื่อง</li>
              <li>การส่งอีเมลขยะ (Spam) หรือรัน Script ที่ก่อให้เกิดผลกระทบต่อผู้ใช้งานท่านอื่นบนเซิร์ฟเวอร์</li>
            </ul>
          </section>

          <section className="terms-block">
            <h2>4. การสำรองข้อมูลและทรัพยากร</h2>
            <p>
              ผู้ใช้บริการควรสำรองข้อมูล (Backup) ซอร์สโค้ดและฐานข้อมูลด้วยตนเองอย่างสม่ำเสมอ 
              ระบบมีการดูแลรักษาความเสถียรของเครื่องแม่ข่ายตามมาตรฐาน แต่ไม่อาจรับประกันความเสียหายของข้อมูลที่เกิดจากความผิดพลาดของแอปพลิเคชันฝั่งผู้ใช้
            </p>
          </section>

          <section className="terms-block">
            <h2>5. การระงับบริการ</h2>
            <p>
              หากพบการใช้งานที่ละเมิดข้อกำหนดข้างต้น หรือส่งผลกระทบต่อความปลอดภัยของระบบโดยรวม 
              ทีมงานขอสงวนสิทธิ์ในการระงับการใช้งานบัญชีหรือบริการชั่วคราวเพื่อตรวจสอบโดยทันที
            </p>
          </section>
        </div>

        <div className="terms-footer">
          <span>© 2026 {brandName}. All rights reserved.</span>
        </div>
      </main>
    </div>
  );
}
