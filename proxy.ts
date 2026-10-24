import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function formatHostname(hostname: string): string {
  return hostname.includes(":") ? `[${hostname}]` : hostname;
}

function buildContentSecurityPolicy(nonce: string, request: NextRequest): string {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const hostname = formatHostname(request.nextUrl.hostname || "localhost");
  const browserPort = request.nextUrl.port || "3000";
  const formAction = isDevelopment
    ? "form-action 'self' http://db.localhost:8088"
    : "form-action 'self' https://db.nkn02.com";
  const imageSources = ["'self'", "data:", "blob:", "https:"];
  // Dev serves uploads through Caddy (:8088) and secure /f/ links straight from the API (:8080).
  if (isDevelopment) imageSources.push(`http://${hostname}:8088`, `http://${hostname}:8080`);
  const connectSources = ["'self'", "blob:"];
  if (isDevelopment) {
    connectSources.push(`http://${hostname}:8080`, `ws://${hostname}:${browserPort}`);
  } else {
    connectSources.push("https://api.nkn02.com");
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // Cloudflare Turnstile (the captcha on /verify) draws its box in a frame.
    "frame-src 'self' blob: https://challenges.cloudflare.com",
    formAction,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' blob:",
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce, request);
  const requestHeaders = new Headers(request.headers);

  // Vinext/Next reads the CSP request header while rendering and propagates
  // its nonce to framework, hydration, and application script tags.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    "/((?!api|assets|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
