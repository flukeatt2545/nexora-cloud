import type { Metadata } from "next";
import { fetchServerApiJson, SERVER_PUBLIC_ORIGIN } from "../../../runtime.server";

type PublicSettings = {
  brandName?: string;
  siteTitle?: string;
  ogImageUrl?: string;
  ogCardType?: "summary" | "summary_large_image";
};

type SharedFile = {
  name: string;
  contentType: string;
  size: number;
  passwordRequired: boolean;
};

function toAbsoluteUrl(value: string) {
  try {
    return new URL(value, SERVER_PUBLIC_ORIGIN).toString();
  } catch {
    return "";
  }
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, value || 0)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function canUseFileAsOpenGraphImage(file: SharedFile) {
  const type = file.contentType.toLowerCase().split(";", 1)[0].trim();
  return !file.passwordRequired && ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"].includes(type);
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params;
  const safeToken = /^[a-f0-9]{32}$/.test(token) ? token : "";
  const [settings, file] = await Promise.all([
    fetchServerApiJson<PublicSettings>("/api/settings/public"),
    safeToken ? fetchServerApiJson<SharedFile>(`/api/public/files/${safeToken}`) : Promise.resolve(null),
  ]);
  const brandName = settings?.brandName || settings?.siteTitle || "NEXORA CLOUD";
  const title = file?.name ? `${file.name} · แชร์ไฟล์ | ${brandName}` : `แชร์ไฟล์ | ${brandName}`;
  const description = file
    ? `ดาวน์โหลด ${file.name} (${formatBytes(file.size)})${file.passwordRequired ? " · ต้องใช้รหัสผ่าน" : ""} ผ่าน ${brandName}`
    : `หน้าดาวน์โหลดไฟล์ที่แชร์ผ่าน ${brandName}`;
  const pageUrl = `${SERVER_PUBLIC_ORIGIN}/files/d/${safeToken || token}`;
  const fallbackImage = settings?.ogImageUrl ? toAbsoluteUrl(settings.ogImageUrl) : `${SERVER_PUBLIC_ORIGIN}/logo-v2.png`;
  const imageUrl = file && safeToken && canUseFileAsOpenGraphImage(file)
    ? `${SERVER_PUBLIC_ORIGIN}/api/public/files/${safeToken}/download?preview=1`
    : fallbackImage;
  const card = file && canUseFileAsOpenGraphImage(file) ? "summary_large_image" : (settings?.ogCardType || "summary_large_image");

  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: brandName,
      type: "website",
      locale: "th_TH",
      images: imageUrl ? [{
        url: imageUrl,
        type: file && canUseFileAsOpenGraphImage(file) ? file.contentType : undefined,
        alt: file?.name ? `ตัวอย่างไฟล์ ${file.name}` : `ไฟล์ที่แชร์ผ่าน ${brandName}`,
      }] : undefined,
    },
    twitter: {
      card,
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default function SharedFileLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
