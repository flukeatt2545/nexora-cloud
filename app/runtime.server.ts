import "server-only";

import type { RuntimeEnvironment } from "./runtime";

export const SERVER_RUNTIME_ENVIRONMENT: RuntimeEnvironment =
  process.env.NODE_ENV === "production" ? "production" : "development";

function trimOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export const SERVER_PUBLIC_ORIGIN = trimOrigin(
  process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (SERVER_RUNTIME_ENVIRONMENT === "production" ? "https://nkn02.com" : "http://localhost:3000"),
);

export function serverApiBases(): string[] {
  const configured = process.env.API_BASE_URL ? trimOrigin(process.env.API_BASE_URL) : "";
  const automatic = SERVER_RUNTIME_ENVIRONMENT === "production"
    ? "http://api:8080"
    : "http://127.0.0.1:8080";
  return [...new Set([configured, automatic].filter(Boolean))];
}

export async function fetchServerApiJson<T>(path: string): Promise<T | null> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  for (const base of serverApiBases()) {
    try {
      const response = await fetch(`${base}${normalizedPath}`, { cache: "no-store" });
      if (response.ok) return await response.json() as T;
    } catch {
      // Builds can run while the API is offline. Metadata falls back safely.
    }
  }
  return null;
}
