"use client";
import { getApp, getApps, initializeApp } from "firebase/app";
import { CustomProvider, getToken, initializeAppCheck, type AppCheck } from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

// Local dev against the Firebase emulators (CONTRIBUTING.md): no real project, no App Check.
const EMULATORS = process.env.NEXT_PUBLIC_EMULATORS === "1";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const app = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
if (EMULATORS && !auth.emulatorConfig) {
  // The guard keeps hot reload from connecting twice (that throws).
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

// ---- App Check: invisible Cloudflare Turnstile -> /api/appcheck -> App Check token ----

let turnstileLoaded: Promise<void> | null = null;
function loadTurnstile() {
  turnstileLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      turnstileLoaded = null;
      reject(new Error("turnstile-load"));
    };
    document.head.appendChild(s);
  });
  return turnstileLoaded;
}

type Turnstile = { render: (el: HTMLElement, o: object) => string; remove: (id: string) => void };

/** One single-use Turnstile token from an off-screen invisible widget. */
async function turnstileToken(): Promise<string> {
  await loadTurnstile();
  const ts = (window as unknown as { turnstile: Turnstile }).turnstile;
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-10000px;top:0";
  document.body.appendChild(el);
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      fn();
      queueMicrotask(() => {
        ts.remove(id);
        el.remove();
      });
    };
    const id = ts.render(el, {
      sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
      callback: (t: string) => done(() => resolve(t)),
      "error-callback": () => done(() => reject(new Error("turnstile"))),
    });
  });
}

export const appCheck: AppCheck | null =
  typeof window === "undefined" || EMULATORS
    ? null
    : initializeAppCheck(app, {
        provider: new CustomProvider({
          getToken: async () => {
            const res = await fetch("/api/appcheck", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ turnstile: await turnstileToken() }),
            });
            if (!res.ok) throw new Error("app-check");
            return (await res.json()) as { token: string; expireTimeMillis: number };
          },
        }),
        // On demand, not at page load: a visitor who only browses cached pages never runs
        // Turnstile or calls /api/appcheck. Firestore and api() fetch a token when they need one.
        isTokenAutoRefreshEnabled: false,
      });

async function appCheckHeader(): Promise<Record<string, string>> {
  if (!appCheck) return {};
  const { token } = await getToken(appCheck);
  return { "x-firebase-appcheck": token };
}

/** Calls our API with the user's ID token and App Check token. Throws Error(code) on failure. */
export async function api<T = { ok: true }>(path: string, method: string, data?: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(await appCheckHeader()) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({ error: "server" }));
  if (!res.ok) {
    // Schema rejections name the first bad field ("invalid:stack") so the form can point at it.
    const field = json.issues?.[0]?.path?.[0];
    throw new Error(json.error === "invalid" && field ? `invalid:${field}` : (json.error ?? "server"));
  }
  return json as T;
}

/** Sends a crash to /api/client-errors (Firestore `clientErrors` + Vercel log). Never throws. */
export function reportError(e: Error & { digest?: string }) {
  fetch("/api/client-errors", {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: String(e?.message ?? e).slice(0, 500),
      stack: String(e?.stack ?? "").slice(0, 4000),
      digest: String(e?.digest ?? "").slice(0, 100),
      path: (location.pathname + location.search).slice(0, 300),
      ua: navigator.userAgent.slice(0, 400),
      uid: auth.currentUser?.uid ?? "",
    }),
  }).catch(() => {});
}

/** Calls the Cloudflare Worker (file uploads) with the user's ID token and App Check token. */
export async function worker(path: string, init: RequestInit = {}) {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, ...(await appCheckHeader()) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload-failed");
  return res;
}
