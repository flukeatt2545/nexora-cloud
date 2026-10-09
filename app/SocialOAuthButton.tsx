"use client";

import { ReactNode, useEffect, useState } from "react";
import { API_BASE } from "./runtime";

export type SocialProvider = "discord" | "google" | "github";
export type SocialMode = "login" | "register" | "connect";

type SocialAvailability = Partial<Record<SocialProvider, boolean>>;

/**
 * Which providers an admin has switched on and configured, from the public settings.
 * Empty until loaded, so callers can treat "unknown" separately from "off".
 */
export function useSocialAvailability(): SocialAvailability {
  const [available, setAvailable] = useState<SocialAvailability>({});
  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/settings/public`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((settings) => {
        if (!active || !settings) return;
        setAvailable({
          discord: Boolean(settings.discordEnabled && settings.discordConfigured),
          google: Boolean(settings.googleEnabled && settings.googleConfigured),
          github: Boolean(settings.githubEnabled && settings.githubConfigured),
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return available;
}

export async function createSocialOAuthTicket(provider: SocialProvider, mode: SocialMode) {
  const response = await fetch(`${API_BASE}/api/auth/oauth/ticket`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, mode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.path !== "string") {
    throw new Error(payload.error || "ยังไม่สามารถเริ่มการเชื่อมต่อได้");
  }
  return payload.path as string;
}

export default function SocialOAuthButton({
  provider,
  mode,
  className,
  ariaLabel,
  disabled = false,
  title,
  children,
}: {
  provider: SocialProvider;
  mode: SocialMode;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function start() {
    if (disabled || state === "loading") return;
    setState("loading");
    try {
      const path = await createSocialOAuthTicket(provider, mode);
      window.location.assign(path);
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={start}
      disabled={disabled || state === "loading"}
      aria-label={ariaLabel}
      aria-busy={state === "loading"}
      title={title}
    >
      {state === "loading" ? "กำลังเชื่อมต่อ..." : state === "error" ? "ลองอีกครั้ง" : children}
    </button>
  );
}
