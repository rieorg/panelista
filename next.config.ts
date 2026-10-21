import type { NextConfig } from "next";

// Firebase Auth handler is proxied through our own origin so the Google
// sign-in screen says "panelista.vercel.app" and works without third-party
// cookies (Safari, Chrome 3PC phase-out).
const FIREBASE_AUTH_HOST = process.env.FIREBASE_AUTH_HOST ?? `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`;

const isDev = process.env.NODE_ENV === "development";
const worker = process.env.NEXT_PUBLIC_WORKER_URL ?? "";
const emu = process.env.NEXT_PUBLIC_EMULATORS === "1" ? " http://127.0.0.1:9099 http://127.0.0.1:8080" : "";

// Static CSP, so every page can prerender and serve from the CDN. (A per-request
// nonce made each page view a function call.) Next puts its bootstrap and RSC
// payload in inline scripts on every page, and experimental SRI only hashes the
// src scripts, so a static policy needs 'unsafe-inline'. React escapes all user
// text and nothing uses dangerouslySetInnerHTML; script hosts stay allowlisted.
// Without the nonce, 'strict-dynamic' no longer vouches for scripts the SDKs
// inject, so Google sign-in and Turnstile are named here.
const csp = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://apis.google.com https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""};
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
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Firebase signInWithPopup needs to talk to its popup window.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // Not on /__/auth/*: Firebase frames /__/auth/iframe on our own origin to
      // deliver the sign-in result, and DENY would block it.
      { source: "/((?!__/).*)", headers: securityHeaders },
      { source: "/__/:path*", headers: [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] },
      // API responses are per-user JSON: never cache at the edge (public lists opt in with Vercel-CDN-Cache-Control).
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // Brand art changes rarely; a day in the browser saves a CDN request per image per page view.
      { source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
    ];
  },
  async rewrites() {
    return [{ source: "/__/auth/:path*", destination: `https://${FIREBASE_AUTH_HOST}/__/auth/:path*` }];
  },
};

export default nextConfig;
