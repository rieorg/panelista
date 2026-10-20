import { NextRequest, NextResponse } from "next/server";

// Strict nonce-based CSP for every page render. API routes, static files and
// the proxied Firebase auth handler (/__/auth) are excluded by the matcher.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const worker = process.env.NEXT_PUBLIC_WORKER_URL ?? "";
  const emu = process.env.NEXT_PUBLIC_EMULATORS === "1" ? " http://127.0.0.1:9099 http://127.0.0.1:8080" : "";
  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://apis.google.com${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://lh3.googleusercontent.com https://api.dicebear.com;
    font-src 'self';
    connect-src 'self' https://*.googleapis.com wss://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://challenges.cloudflare.com ${worker}${emu};
    frame-src 'self' blob: https://accounts.google.com https://*.firebaseapp.com https://challenges.cloudflare.com${emu};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    ${isDev ? "" : "upgrade-insecure-requests;"}
  `.replace(/\s{2,}/g, " ").trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|__|_next/static|_next/image|favicon.ico|icon.svg|brand/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
