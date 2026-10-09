export type RuntimeEnvironment = "development" | "production";

export const RUNTIME_ENVIRONMENT: RuntimeEnvironment =
  process.env.NODE_ENV === "production" ? "production" : "development";

export const IS_DEVELOPMENT = RUNTIME_ENVIRONMENT === "development";
export const IS_PRODUCTION = RUNTIME_ENVIRONMENT === "production";

function browserApiBase(): string {
  if (typeof window === "undefined") {
    return IS_DEVELOPMENT ? "http://127.0.0.1:8080" : "";
  }

  // Development builds can run on any port or LAN host. Production always
  // uses the same origin and lets Caddy route /api to the backend.
  if (IS_PRODUCTION) return "";

  const hostname = window.location.hostname || "localhost";
  const formattedHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `http://${formattedHost}:8080`;
}

export const API_BASE = browserApiBase();

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}
