import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./dashboard/dashboard.css";
import "./dashboard/file-library-122.css";
import "./theme.css";
import "./user-app.css";
import "./dashboard/admin-overview.css";
import ThemeLoader from "./ThemeLoader";
import ConsoleWarning from "./ConsoleWarning";
import { brandVariables } from "./themeColor";
import { fetchServerApiJson } from "./runtime.server";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#08090d" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

type PublicSettings = {
  brandName?: string;
  siteTitle?: string;
  siteDescription?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImageUrl?: string;
  ogCardType?: string;
  ogColor?: string;
  primaryColor?: string;
  themeMode?: "light" | "dark";
  logoUrl?: string;
  faviconUrl?: string;
};

async function getPublicSettings(): Promise<PublicSettings | null> {
  return fetchServerApiJson<PublicSettings>("/api/settings/public");
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const siteTitle = settings?.brandName || settings?.siteTitle || "NEXORA CLOUD";
  const ogTitle = settings?.ogTitle || siteTitle;
  const description = settings?.ogDescription || settings?.siteDescription || "ศูนย์รวมร้านค้า สินค้าเกม และไอเท็มชิ้นโปรดของคุณ";
  const iconUrl = settings?.faviconUrl || settings?.logoUrl || "/logo-v2.png";
  const ogImage = settings?.ogImageUrl || iconUrl;
  const cardType = (settings?.ogCardType === "summary" ? "summary" : "summary_large_image") as "summary" | "summary_large_image";

  return {
    title: siteTitle,
    description: description,
    icons: {
      icon: [{ url: iconUrl }],
      shortcut: iconUrl,
      apple: iconUrl,
    },
    openGraph: {
      title: ogTitle,
      description: description,
      siteName: siteTitle,
      type: "website",
      locale: "th_TH",
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: cardType,
      title: ogTitle,
      description: description,
      images: ogImage ? [ogImage] : undefined,
    },
    other: {
      "theme-color": "#08090d",
      "msapplication-TileColor": "#08090d",
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="th" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kanit:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" />
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `try{var d=document.documentElement,t=localStorage.getItem("nexora-theme");if(t==="light"||t==="dark")d.dataset.theme=t;var c=localStorage.getItem("nexora-primary"),v=c&&(${brandVariables.toString()})(c);if(v)for(var k in v)d.style.setProperty(k,v[k])}catch(e){}` }} />
      </head>
      <body>
        <ThemeLoader />
        <ConsoleWarning />
        {children}
      </body>
    </html>
  );
}
