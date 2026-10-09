import type { Metadata } from "next";
import { fetchServerApiJson, SERVER_PUBLIC_ORIGIN } from "../../../runtime.server";

type SharedCategory = { name: string; fileCount: number };
type PublicSettings = { brandName?: string; siteTitle?: string };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const safe = /^[a-f0-9]{32}$/.test(token);
  const [category, settings] = await Promise.all([
    safe ? fetchServerApiJson<SharedCategory>(`/api/public/file-categories/${token}`) : Promise.resolve(null),
    fetchServerApiJson<PublicSettings>("/api/settings/public"),
  ]);
  const brand = settings?.brandName || settings?.siteTitle || "NEXORA CLOUD";
  const title = category ? `${category.name} · แชร์โฟลเดอร์ | ${brand}` : `แชร์โฟลเดอร์ | ${brand}`;
  const description = category
    ? `ดาวน์โหลดไฟล์ ${category.fileCount} รายการจากโฟลเดอร์ ${category.name}`
    : "ดูรายการไฟล์ที่แชร์จากโฟลเดอร์";
  const pageUrl = `${SERVER_PUBLIC_ORIGIN}/files/c/${token}`;

  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: { title, description, url: pageUrl, siteName: brand, type: "website", locale: "th_TH" },
    twitter: { card: "summary", title, description },
  };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
