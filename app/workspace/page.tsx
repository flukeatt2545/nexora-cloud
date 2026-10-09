"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle, ArrowLeft, ExternalLink, Code2 } from "lucide-react";
import Link from "next/link";
import { API_BASE } from "../runtime";

interface SiteDetail {
  site: {
    id: string;
    name: string;
    domain: string;
    subdomain?: string;
    status: string;
    accessRole?: "owner" | "admin" | "editor" | "viewer";
    storageUsed?: string;
  };
}

function WorkspaceContainerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const siteId = searchParams.get("id") || searchParams.get("siteId");
  const ticket = searchParams.get("ticket");

  const [statusText, setStatusText] = useState("กำลังเตรียมการเชื่อมต่อ...");
  const [error, setError] = useState<string | null>(null);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initializeWorkspace() {
      try {
        setError(null);

        let activeSiteId = siteId;

        // 1. Consume ticket if arriving from Discord or one-time SSO link
        if (ticket && !activeSiteId) {
          setStatusText("กำลังตรวจสอบสิทธิ์การเข้าใช้งาน...");
          let res = await fetch(`${API_BASE}/api/auth/workspace/ticket/consume`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket }),
          });

          if (res.status === 404) {
            res = await fetch(`${API_BASE}/api/auth/oauth/ticket/consume`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticket }),
            });
          }

          const ticketData = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(ticketData.error || "ลิงก์เข้าใช้งานไม่ถูกต้องหรือหมดอายุแล้ว");
          }

          if (ticketData.siteId) {
            activeSiteId = ticketData.siteId;
          }
        }

        if (!activeSiteId) {
          throw new Error("ไม่พบข้อมูลโปรเจกต์ที่ต้องการเปิด");
        }

        // 2. Fetch site information to determine code subdomain
        setStatusText("กำลังโหลดข้อมูลโปรเจกต์และเชื่อมต่อ VS Code...");
        const siteRes = await fetch(`${API_BASE}/api/hosting/sites/${encodeURIComponent(activeSiteId)}`, {
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });

        if (!siteRes.ok) {
          if (siteRes.status === 401) {
            throw new Error("กรุณาเข้าสู่ระบบก่อนเข้าใช้งานพื้นที่เขียนโค้ด");
          }
          if (siteRes.status === 403) {
            throw new Error("คุณไม่มีสิทธิ์เข้าถึงโปรเจกต์นี้");
          }
          if (siteRes.status === 404) {
            throw new Error("ไม่พบข้อมูลโปรเจกต์ที่ระบุ");
          }
          const errData = await siteRes.json().catch(() => ({}));
          throw new Error(errData.error || "เกิดข้อผิดพลาดในการโหลดข้อมูลโปรเจกต์");
        }

        const data: SiteDetail = await siteRes.json();
        const site = data.site;
        const subdomain = site.subdomain || site.domain.split(".")[0];

        // 3. Request a secure SSO workspace launch token
        setStatusText("กำลังเริ่มการทำงานของสภาพแวดล้อม VS Code...");
        let launchToken = "";
        try {
          const tokenRes = await fetch(`${API_BASE}/api/hosting/sites/${encodeURIComponent(activeSiteId)}/workspace/token`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
          });
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json().catch(() => ({}));
            launchToken = tokenData.token || "";
          }
        } catch {
          // Fallback
        }

        // 4. Construct the code subdomain destination
        const currentHostname = typeof window !== "undefined" ? window.location.hostname : "nkn02.com";
        const baseDomain = currentHostname.includes("localhost") ? "localhost" : "nkn02.com";
        const protocol = typeof window !== "undefined" ? window.location.protocol : "https:";
        const portSuffix = currentHostname.includes("localhost") && window.location.port ? `:${window.location.port}` : "";

        const codeHost = `code-${subdomain}.${baseDomain}${portSuffix}`;
        const finalUrl = `${protocol}//${codeHost}${launchToken ? `?token=${encodeURIComponent(launchToken)}` : ""}`;

        if (isMounted) {
          setTargetUrl(finalUrl);
          document.title = `${site.name || subdomain} — VS Code | NEXORA`;
          window.location.replace(finalUrl);
        }
      } catch (err) {
        if (isMounted) {
          setError((err instanceof Error && err.message) || "เกิดข้อผิดพลาดในการเชื่อมต่อพื้นที่เขียนโค้ด");
        }
      }
    }

    initializeWorkspace();

    return () => {
      isMounted = false;
    };
  }, [ticket, siteId, router]);

  if (error) {
    return (
      <div className="fixed inset-0 bg-[#08090d] flex flex-col items-center justify-center p-4 text-center select-none">
        <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-400 mb-4">
          <AlertCircle size={36} />
        </div>
        <h2 className="text-base font-semibold text-white mb-2">ไม่สามารถเปิด VS Code ได้</h2>
        <p className="text-xs text-slate-400 max-w-md mb-6">{error}</p>
        <div className="flex items-center gap-3">
          <Link
            href="/hosting"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#151824] hover:bg-[#1e2336] border border-white/10 text-xs font-semibold text-white transition-colors"
          >
            <ArrowLeft size={14} />
            <span>กลับหน้าโฮสติ้ง</span>
          </Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl bg-[#ff1018] hover:bg-[#e00e15] text-xs font-semibold text-white transition-colors"
          >
            ลองใหม่อีกครั้ง
          </button>
        </div>
      </div>
    );
  }

  if (targetUrl) {
    return (
      <div className="fixed inset-0 bg-[#08090d] flex flex-col items-center justify-center text-slate-400 select-none p-4">
        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 mb-4 shadow-2xl flex items-center justify-center">
          <Code2 size={40} className="text-[#ff1018]" />
        </div>
        <div className="flex items-center gap-2 mb-2">
          <Loader2 size={16} className="animate-spin text-[#ff1018]" />
          <h2 className="text-sm font-semibold text-white">กำลังเปิด VS Code IDE...</h2>
        </div>
        <p className="text-xs text-slate-500 font-mono mb-4">NEXORA Cloud &middot; Isolated VS Code Environment</p>
        <a
          href={targetUrl}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#ff1018] hover:bg-[#e00e15] text-xs font-semibold text-white transition-colors shadow-lg shadow-[#ff1018]/25"
        >
          <span>เปิดทันทีหากไม่เปลี่ยนหน้าอัตโนมัติ</span>
          <ExternalLink size={14} />
        </a>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#08090d] flex flex-col items-center justify-center text-slate-400 select-none p-4">
      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 mb-4 shadow-2xl flex items-center justify-center">
        <Code2 size={40} className="text-[#ff1018]" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Loader2 size={16} className="animate-spin text-[#ff1018]" />
        <h2 className="text-sm font-semibold text-white">{statusText}</h2>
      </div>
      <p className="text-xs text-slate-500 font-mono">NEXORA Cloud &middot; Isolated VS Code Environment</p>
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 bg-[#08090d] flex flex-col items-center justify-center text-slate-400 select-none">
          <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/10 mb-4 shadow-xl">
            <Loader2 size={36} className="animate-spin text-[#ff1018]" />
          </div>
          <h2 className="text-sm font-semibold text-white mb-1">กำลังเริ่มทำงาน...</h2>
        </div>
      }
    >
      <WorkspaceContainerContent />
    </Suspense>
  );
}
