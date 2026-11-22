import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

// Local dev: with FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST set,
// firebase-admin talks only to the emulators and needs no credentials.
const EMULATED = !!process.env.FIRESTORE_EMULATOR_HOST;

// Service account comes in as base64 JSON so it survives env var tooling.
export function app() {
  if (getApps().length) return getApps()[0];
  if (EMULATED) return initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
  const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64 ?? "", "base64").toString("utf8"));
  return initializeApp({ credential: cert(sa), projectId: sa.project_id });
}

export const db = () => getFirestore(app());
export const adminAuth = () => getAuth(app());
export { FieldValue };

export class HttpError extends Error {
  status: number;
  code: string;
  // Plain fields, not parameter properties: Node's type stripping (npm test) only takes erasable syntax.
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Verifies the Firebase ID token (including revocation and disabled users). */
export async function requireUser(req: Request): Promise<DecodedIdToken> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError(401, "no-token");
  let user: DecodedIdToken;
  try {
    user = await adminAuth().verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, "bad-token");
  }
  // Google accounts arrive verified; email/password accounts must click the link first.
  if (user.email_verified !== true) throw new HttpError(403, "verify-email");
  return user;
}

export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  if (user.admin !== true) throw new HttpError(403, "not-admin");
  return user;
}

/** Same-origin check for state-changing requests (defense in depth with Bearer auth). */
function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host; // "null" origins throw here
  } catch {}
  if (originHost !== host) throw new HttpError(403, "bad-origin");
}

/** App Check token from our Turnstile-backed provider (see /api/appcheck). */
async function checkAppCheck(req: Request) {
  // Emulators have no App Check. Safe: with this env var set, the API can only reach emulator data.
  if (EMULATED) return;
  const token = req.headers.get("x-firebase-appcheck");
  if (!token) throw new HttpError(401, "no-app-check");
  try {
    await getAppCheck(app()).verifyToken(token);
  } catch {
    throw new HttpError(401, "bad-app-check");
  }
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>;

/** Wraps a route handler: origin + App Check, typed HTTP errors, everything else a logged 500. */
export function route(fn: Handler, opts: { appCheck?: boolean } = {}) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      if (req.method !== "GET") checkOrigin(req);
      if (opts.appCheck !== false) await checkAppCheck(req);
      const data = await fn(req, ctx);
      return NextResponse.json(data ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.code }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: "invalid", issues: e.issues.slice(0, 5) }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: "server" }, { status: 500 });
    }
  };
}

export async function body(req: Request) {
  // Measure the actual body: chunked requests have no Content-Length.
  const raw = await req.text();
  if (raw.length > 20_000) throw new HttpError(413, "too-large");
  // Only the caller's own body is "bad-json". A SyntaxError from anywhere else (a missing service account,
  // an upstream that answers with HTML) is ours: it must reach the log as a 500, not pass as a client mistake.
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "bad-json");
  }
}

/**
 * One shared result per server instance for `ttlMs`. Concurrent and repeat callers get the same promise, so
 * requests that get past the CDN cache cost one Firestore query per window, not one each. A failed load is not kept.
 */
export function memo<T>(ttlMs: number, load: () => Promise<T>, now: () => number = Date.now): () => Promise<T> {
  let hit: { at: number; value: Promise<T> } | undefined;
  return () => {
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const mine = { at: now(), value: load() };
    hit = mine;
    mine.value.catch(() => {
      if (hit === mine) hit = undefined;
    });
    return mine.value;
  };
}

/**
 * The public lists are cached by URL, and "?x=1", "?x=2"... are all different URLs: each would run the
 * handler and read the whole list again. A request with a query string is sent to the one cached address.
 */
export function onlyPlainUrl(req: Request): Response | null {
  const url = new URL(req.url);
  return url.search ? new Response(null, { status: 308, headers: { location: url.pathname } }) : null;
}

/**
 * A finished evaluation obliges the student to rate the evaluator: that rating
 * is the trade for free help. Until they do, nothing that asks for more help
 * (new project, invite, accepting an offer) goes through. Equality-only query,
 * so Firestore serves it from single-field indexes.
 */
export async function requireNoPendingReview(uid: string) {
  const due = await db()
    .collection("requests")
    .where("studentUid", "==", uid)
    .where("status", "==", "completed")
    .where("reviewedByStudent", "==", false)
    .limit(1)
    .get();
  if (!due.empty) throw new HttpError(409, "review-pending");
}

/**
 * Fixed-window daily limit per user and bucket, stored in Firestore. `sharedPerDay` adds one ceiling for all
 * callers of the bucket together, checked in the same transaction: once either is reached, nothing is written.
 * ponytail: one doc write per call; move to Upstash/Workers KV if write volume matters.
 */
export async function rateLimit(uid: string, bucket: string, perDay: number, sharedPerDay?: number) {
  const day = new Date().toISOString().slice(0, 10);
  const limits: [string, number][] = [[uid, perDay]];
  if (sharedPerDay !== undefined) limits.push(["all", sharedPerDay]);
  const refs = limits.map(([who]) => db().doc(`ratelimits/${who}_${bucket}_${day}`));
  await db().runTransaction(async (tx) => {
    const counts = (await tx.getAll(...refs)).map((snap) => (snap.get("n") as number | undefined) ?? 0);
    if (counts.some((n, i) => n >= limits[i][1])) throw new HttpError(429, "rate-limited");
    counts.forEach((n, i) => tx.set(refs[i], { n: n + 1, expireAt: new Date(Date.now() + 2 * 864e5) }, { merge: true }));
  });
}
