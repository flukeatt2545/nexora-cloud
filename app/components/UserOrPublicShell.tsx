"use client";

import { ReactNode, useEffect, useState } from "react";
import { PageLoadingScreen } from "./PageLoadingScreen";
import UserApp from "../dashboard/UserApp";
import { API_BASE } from "../runtime";

type ShellView = "store";

export default function UserOrPublicShell({
  view,
  publicNode,
  loadingLabel,
}: {
  view: ShellView;
  publicNode: ReactNode;
  loadingLabel: string;
}) {
  const [mode, setMode] = useState<"loading" | "app" | "public">("loading");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    fetch(`${API_BASE}/api/auth/me`, { credentials: "include", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (cancelled) return;
        if (result?.authenticated && result.user) setMode("app");
        else setMode("public");
      })
      .catch(() => {
        if (!cancelled) setMode("public");
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  if (mode === "loading") return <PageLoadingScreen label={loadingLabel} />;
  if (mode === "app") return <UserApp view={view} />;
  return <>{publicNode}</>;
}
