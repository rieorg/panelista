// Panelista Worker: private verification uploads (Workers KV) and the hourly
// cron that closes past-deadline projects in Firestore and triggers the app's
// /api/cron (request expiry and its emails).
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { sniff } from "./sniff";

interface ProofMeta {
  type: string;
  name: string;
  uid: string;
}

interface Env {
  PROOFS: KVNamespace;
  UPLOAD_LIMIT: RateLimit;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_PROJECT_NUMBER: string;
  ALLOWED_ORIGINS: string;
  SA_CLIENT_EMAIL: string;
  SA_PRIVATE_KEY: string;
  APP_URL: string;
  CRON_SECRET?: string;
}

const MAX_BYTES = 5_000_000;
const MAX_FILES_PER_USER = 10;
const PROOF_TTL_DAYS = 30;
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
const APP_CHECK_JWKS = createRemoteJWKSet(new URL("https://firebaseappcheck.googleapis.com/v1/jwks"));

/** Firebase App Check token minted by our Turnstile-backed provider. */
async function verifyAppCheck(req: Request, env: Env): Promise<boolean> {
  const token = req.headers.get("x-firebase-appcheck");
  if (!token) return false;
  try {
    await jwtVerify(token, APP_CHECK_JWKS, {
      issuer: `https://firebaseappcheck.googleapis.com/${env.FIREBASE_PROJECT_NUMBER}`,
      audience: [`projects/${env.FIREBASE_PROJECT_NUMBER}`, `projects/${env.FIREBASE_PROJECT_ID}`],
      algorithms: ["RS256"],
    });
    return true;
  } catch {
    return false;
  }
}

type User = JWTPayload & { user_id: string; admin?: boolean };

async function verifyUser(req: Request, env: Env): Promise<User | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(h.slice(7), JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
      algorithms: ["RS256"],
    });
    // Unverified email/password accounts cannot upload.
    return payload.sub && payload.email_verified === true ? ({ ...payload, user_id: payload.sub } as User) : null;
  } catch {
    return null;
  }
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return allowed.includes(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-file-name, x-firebase-appcheck",
        "access-control-max-age": "600",
        vary: "Origin",
      }
    : { vary: "Origin" };
}

/** Malformed %-escapes become an empty string (then fail validation) instead of a 500. */
function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, "content-type": "application/json", "cache-control": "no-store" } });

async function handle(req: Request, env: Env): Promise<Response> {
  const c = cors(req, env);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });
  const url = new URL(req.url);
  if (url.pathname === "/health") return json({ ok: true }, 200, c);

  const user = await verifyUser(req, env);
  if (!user) return json({ error: "unauthorized" }, 401, c);
  if (!(await verifyAppCheck(req, env))) return json({ error: "bad-app-check" }, 401, c);

  if (req.method === "POST" && url.pathname === "/proofs") {
    const { success } = await env.UPLOAD_LIMIT.limit({ key: user.user_id });
    if (!success) return json({ error: "rate-limited" }, 429, c);
    if (Number(req.headers.get("content-length") ?? MAX_BYTES + 1) > MAX_BYTES) return json({ error: "too-large" }, 413, c);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return json({ error: "too-large" }, 413, c);
    const kind = sniff(bytes);
    if (!kind) return json({ error: "bad-type" }, 415, c);
    const prefix = `proofs/${user.user_id}/`;
    const existing = await env.PROOFS.list({ prefix, limit: MAX_FILES_PER_USER });
    if (existing.keys.length >= MAX_FILES_PER_USER) return json({ error: "too-many" }, 429, c);
    const key = `${prefix}${crypto.randomUUID()}.${kind.ext}`;
    const name = safeDecode(req.headers.get("x-file-name") ?? "file").replace(/[^\w.\- ]/g, "_").slice(0, 120);
    // Privacy promise: proofs never outlive 30 days, even if nobody reviews them.
    await env.PROOFS.put(key, bytes, { expirationTtl: PROOF_TTL_DAYS * 86400, metadata: { type: kind.type, name, uid: user.user_id } satisfies ProofMeta });
    return json({ key }, 201, c);
  }

  if (url.pathname.startsWith("/proofs/")) {
    const key = safeDecode(url.pathname.slice("/proofs/".length));
    if (!/^proofs\/[\w-]{1,128}\/[\w-]{36}\.(jpg|png|webp|pdf)$/.test(key)) return json({ error: "bad-key" }, 400, c);
    const owner = key.startsWith(`proofs/${user.user_id}/`);
    if (req.method === "GET") {
      if (user.admin !== true) return json({ error: "forbidden" }, 403, c);
      const obj = await env.PROOFS.getWithMetadata<ProofMeta>(key, "stream");
      if (!obj.value) return json({ error: "not-found" }, 404, c);
      return new Response(obj.value, {
        headers: {
          ...c,
          "content-type": obj.metadata?.type ?? "application/octet-stream",
          "content-disposition": "inline",
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
          "cache-control": "private, no-store",
        },
      });
    }
    if (req.method === "DELETE") {
      if (user.admin !== true && !owner) return json({ error: "forbidden" }, 403, c);
      await env.PROOFS.delete(key);
      return json({ ok: true }, 200, c);
    }
  }
  return json({ error: "not-found" }, 404, c);
}

// ---- Firestore REST with a dedicated service account (roles/datastore.user) ----

let cachedToken: { value: string; exp: number } | null = null;

async function googleToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const key = await importPKCS8(env.SA_PRIVATE_KEY.replace(/\\n/g, "\n"), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.SA_CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("google token failed");
  cachedToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

type Filter = { field: string; op: string; value: Record<string, unknown> };

async function runQuery(env: Env, token: string, collection: string, filters: Filter[], limit = 300) {
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(`${base}:runQuery`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { compositeFilter: { op: "AND", filters: filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: f.value } })) } },
        limit,
      },
    }),
  });
  if (!res.ok) throw new Error(`runQuery ${collection} ${res.status}`);
  const rows = (await res.json()) as { document?: { name: string; updateTime: string } }[];
  return rows.flatMap((r) => (r.document ? [r.document] : []));
}

/** Sets status on each doc unless it changed since we read it (updateTime precondition). */
async function setStatus(env: Env, token: string, docs: { name: string; updateTime: string }[], status: string) {
  for (let i = 0; i < docs.length; i += 200) {
    const writes = docs.slice(i, i + 200).map((d) => ({
      update: { name: d.name, fields: { status: { stringValue: status } } },
      updateMask: { fieldPaths: ["status"] },
      updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }],
      currentDocument: { updateTime: d.updateTime },
    }));
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:batchWrite`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    if (!res.ok) throw new Error(`batchWrite ${res.status}`);
  }
}

async function deleteDocs(env: Env, token: string, docs: { name: string }[]) {
  for (let i = 0; i < docs.length; i += 200) {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:batchWrite`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ writes: docs.slice(i, i + 200).map((d) => ({ delete: d.name })) }),
    });
    if (!res.ok) throw new Error(`batchWrite delete ${res.status}`);
  }
}

async function cron(env: Env) {
  const token = await googleToken(env);
  const now = new Date();

  // Request expiry needs a system message, evaluator counters and emails, so the app does it.
  let app: unknown = "skipped: no CRON_SECRET";
  if (!env.CRON_SECRET) console.error("CRON_SECRET missing: requests will not expire");
  else {
    // A failing app must not stop the project closing and purge below.
    const init = { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` }, signal: AbortSignal.timeout(120_000) };
    app = await fetch(`${env.APP_URL}/api/cron`, init).then(
      (res) => (res.ok ? res.json() : `error ${res.status}`),
      (e) => `error ${e}`,
    );
  }

  const pastDeadline = await runQuery(env, token, "projects", [
    { field: "status", op: "IN", value: { arrayValue: { values: [{ stringValue: "open" }, { stringValue: "filled" }] } } },
    { field: "deadline", op: "LESS_THAN", value: { timestampValue: now.toISOString() } },
  ]);
  await setStatus(env, token, pastDeadline, "closed");

  // Firestore TTL needs a paid plan, so old rate-limit counters are purged here.
  const oldLimits = await runQuery(env, token, "ratelimits", [{ field: "expireAt", op: "LESS_THAN", value: { timestampValue: now.toISOString() } }], 500);
  await deleteDocs(env, token, oldLimits);

  console.log(JSON.stringify({ cron: "ok", app, closed: pastDeadline.length }));
}

export default {
  fetch: (req, env) => handle(req, env).catch((e) => {
    console.error(e);
    return json({ error: "server" }, 500, cors(req, env));
  }),
  scheduled: (_event, env, ctx) => ctx.waitUntil(cron(env)),
} satisfies ExportedHandler<Env>;
