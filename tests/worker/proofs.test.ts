// The Worker's private uploads (worker/src/index.ts): who may store, read and delete a verification file.
// Real signature checks against keys made for this run, a Map standing in for Workers KV, no network.
// Own script because it needs the Worker's dependency: `npm ci --prefix worker`, then `npm run test:worker`.
import { before, test } from "node:test";
import assert from "node:assert/strict";

const PROJECT = "demo-panelista-test";
const NUMBER = "123456789";
const SITE = "https://panelista.vercel.app";
const b64 = (x: string | Uint8Array) => Buffer.from(x).toString("base64url");
const rsa = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const google = await rsa(); // stands in for Google's signing key: its public half is what the JWKS endpoints serve below
const forger = await rsa(); // a key Google never published

async function jwt(claims: Record<string, unknown>, key: CryptoKey = google.privateKey, alg = "RS256") {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg, kid: "test-key", typ: "JWT" }));
  const body = b64(JSON.stringify({ iat: now - 10, exp: now + 3600, ...claims }));
  const sig = alg === "none" ? "" : b64(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, Buffer.from(`${head}.${body}`))));
  return `${head}.${body}.${sig}`;
}
const idToken = (uid: string, extra: Record<string, unknown> = {}, key?: CryptoKey, alg?: string) =>
  jwt({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email_verified: true, ...extra }, key, alg);
const appCheck = (number = NUMBER) => jwt({ iss: `https://firebaseappcheck.googleapis.com/${number}`, aud: [`projects/${number}`, `projects/${PROJECT}`], sub: "1:app" });

const store = new Map<string, { value: Uint8Array; metadata: Record<string, string>; ttl: number }>();
let underLimit = true;
const env = {
  PROOFS: {
    list: async ({ prefix, limit }: { prefix: string; limit: number }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name })) }),
    put: async (key: string, value: Uint8Array, o: { expirationTtl: number; metadata: Record<string, string> }) => void store.set(key, { value, metadata: o.metadata, ttl: o.expirationTtl }),
    getWithMetadata: async (key: string) => ({ value: store.get(key)?.value ?? null, metadata: store.get(key)?.metadata ?? null }),
    delete: async (key: string) => void store.delete(key),
  },
  UPLOAD_LIMIT: { limit: async () => ({ success: underLimit }) },
  FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_PROJECT_NUMBER: NUMBER,
  ALLOWED_ORIGINS: `${SITE}, https://www.panelista.example`,
};

let worker: { fetch: (req: Request, env: unknown) => Promise<Response> };
before(async () => {
  // The Worker fetches Google's public keys from two fixed URLs. Serve ours, and let nothing else out.
  const jwks = JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey("jwk", google.publicKey)), kid: "test-key", alg: "RS256", use: "sig" }] });
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/(www\.googleapis\.com\/service_accounts\/v1\/jwk\/securetoken@system\.gserviceaccount\.com|firebaseappcheck\.googleapis\.com\/v1\/jwks)$/);
    return new Response(jwks, { headers: { "content-type": "application/json" } });
  };
  worker = (await import("../../worker/src/index.ts")).default;
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
type Init = { headers?: Record<string, string>; body?: Uint8Array };
async function call(method: string, path: string, init: Init = {}) {
  const res = await worker.fetch(new Request(`https://worker.test${path}`, { method, headers: init.headers, body: init.body }), env);
  const text = res.headers.get("content-type") === "application/json" ? ((await res.json()) as Record<string, unknown>) : {};
  return { status: res.status, ...text, res };
}
const signedIn = async (uid: string, extra: Record<string, unknown> = {}) => ({ authorization: `Bearer ${await idToken(uid, extra)}`, "x-firebase-appcheck": await appCheck() });
const upload = async (uid: string, bytes: Uint8Array, headers: Record<string, string> = {}) =>
  call("POST", "/proofs", { headers: { ...(await signedIn(uid)), "content-type": "image/png", "content-length": String(bytes.byteLength), ...headers }, body: bytes });
const short = ({ status, error }: { status: number; error?: unknown }) => ({ status, error });

test("nothing gets in without a Google-signed token for this project, a verified email and App Check", async () => {
  const ac = await appCheck();
  const tries: Record<string, Record<string, string>> = {
    "no headers": {},
    "App Check only": { "x-firebase-appcheck": ac },
    "not a Bearer header": { authorization: `Basic ${await idToken("alice")}`, "x-firebase-appcheck": ac },
    "signed by someone else": { authorization: `Bearer ${await idToken("alice", {}, forger.privateKey)}`, "x-firebase-appcheck": ac },
    "unsigned (alg none)": { authorization: `Bearer ${await idToken("alice", { admin: true }, undefined, "none")}`, "x-firebase-appcheck": ac },
    "another Firebase project": { authorization: `Bearer ${await jwt({ iss: "https://securetoken.google.com/other", aud: "other", sub: "alice", email_verified: true })}`, "x-firebase-appcheck": ac },
    "expired": { authorization: `Bearer ${await idToken("alice", { exp: Math.floor(Date.now() / 1000) - 60 })}`, "x-firebase-appcheck": ac },
    "email not verified": { authorization: `Bearer ${await idToken("alice", { email_verified: false })}`, "x-firebase-appcheck": ac },
  };
  for (const [name, headers] of Object.entries(tries)) {
    assert.deepEqual(short(await call("POST", "/proofs", { headers: { ...headers, "content-length": "12" }, body: PNG })), { status: 401, error: "unauthorized" }, name);
    assert.deepEqual(short(await call("GET", "/proofs/proofs/alice/x", { headers })), { status: 401, error: "unauthorized" }, name);
  }
  const user = { authorization: `Bearer ${await idToken("alice")}` };
  assert.deepEqual(short(await call("POST", "/proofs", { headers: { ...user, "content-length": "12" }, body: PNG })), { status: 401, error: "bad-app-check" });
  assert.deepEqual(short(await call("POST", "/proofs", { headers: { ...user, "x-firebase-appcheck": await appCheck("999"), "content-length": "12" }, body: PNG })), { status: 401, error: "bad-app-check" }, "App Check of another project");
  assert.deepEqual(short(await call("POST", "/proofs", { headers: { ...user, "x-firebase-appcheck": await idToken("alice"), "content-length": "12" }, body: PNG })), { status: 401, error: "bad-app-check" }, "an ID token is not an App Check token");
  assert.equal(store.size, 0, "nothing was stored");
  assert.equal((await call("GET", "/health")).status, 200, "the health check is the one open path");
});

test("upload: the bytes decide the type, the file lands under the caller's own folder for 30 days, limits hold", async () => {
  const made = await upload("alice", PNG, { "x-file-name": encodeURIComponent("../../<script>ID card.png") });
  assert.equal(made.status, 201);
  const key = (made as { key?: string }).key ?? "";
  assert.match(key, /^proofs\/alice\/[\w-]{36}\.png$/);
  const saved = store.get(key)!;
  assert.deepEqual(saved.metadata, { type: "image/png", name: ".._..__script_ID card.png", uid: "alice" }, "the type is the sniffed one, the name is made harmless");
  assert.equal(saved.ttl, 30 * 86400);

  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  assert.deepEqual(short(await upload("alice", html)), { status: 415, error: "bad-type" }, "HTML sent as image/png");
  assert.deepEqual(short(await upload("alice", svg, { "content-type": "image/svg+xml" })), { status: 415, error: "bad-type" });
  assert.deepEqual(short(await upload("alice", new Uint8Array(0))), { status: 413, error: "too-large" }, "empty");
  assert.deepEqual(short(await upload("alice", PNG, { "content-length": "5000001" })), { status: 413, error: "too-large" });
  underLimit = false;
  assert.deepEqual(short(await upload("alice", PNG)), { status: 429, error: "rate-limited" });
  underLimit = true;
  for (let i = store.size; i < 10; i++) assert.equal((await upload("alice", PNG)).status, 201);
  assert.deepEqual(short(await upload("alice", PNG)), { status: 429, error: "too-many" }, "an 11th file");
  assert.equal((await upload("bob", PNG)).status, 201, "the cap is per user");
  assert.equal([...store.keys()].filter((k) => k.startsWith("proofs/alice/")).length, 10);
});

test("read and delete: only an admin reads; the owner or an admin deletes; keys cannot leave the proofs folder", async () => {
  const [mine] = [...store.keys()].filter((k) => k.startsWith("proofs/alice/"));
  const path = `/proofs/${encodeURIComponent(mine)}`;
  assert.deepEqual(short(await call("GET", path, { headers: await signedIn("alice") })), { status: 403, error: "forbidden" }, "not even the owner reads it back");
  assert.deepEqual(short(await call("GET", path, { headers: await signedIn("mallory") })), { status: 403, error: "forbidden" });
  assert.deepEqual(short(await call("GET", path, { headers: await signedIn("mallory", { admin: "true" }) })), { status: 403, error: "forbidden" }, "admin must be exactly true");

  const seen = await call("GET", path, { headers: { ...(await signedIn("boss", { admin: true })), origin: SITE } });
  assert.equal(seen.status, 200);
  assert.deepEqual(new Uint8Array(await seen.res.arrayBuffer()), PNG);
  // A stored file is served so that it can never run as a page: fixed type, no sniffing, sandboxed, never cached.
  const h = (name: string) => seen.res.headers.get(name);
  assert.deepEqual([h("content-type"), h("x-content-type-options"), h("cache-control"), h("access-control-allow-origin")], ["image/png", "nosniff", "private, no-store", SITE]);
  assert.match(h("content-security-policy") ?? "", /^sandbox; default-src 'none'/);

  assert.deepEqual(short(await call("DELETE", path, { headers: await signedIn("mallory") })), { status: 403, error: "forbidden" });
  assert.equal(store.has(mine), true);
  assert.deepEqual(short(await call("DELETE", path, { headers: await signedIn("alice") })), { status: 200, error: undefined });
  assert.equal(store.has(mine), false);
  assert.deepEqual(short(await call("GET", path, { headers: await signedIn("boss", { admin: true }) })), { status: 404, error: "not-found" });
  const [bobs] = [...store.keys()].filter((k) => k.startsWith("proofs/bob/"));
  assert.equal((await call("DELETE", `/proofs/${encodeURIComponent(bobs)}`, { headers: await signedIn("boss", { admin: true }) })).status, 200, "an admin may delete anyone's");

  const admin = await signedIn("boss", { admin: true });
  for (const bad of ["secrets", "proofs/alice/../../secrets", "proofs/alice/short.png", `proofs/alice/${"a".repeat(36)}.html`, `other/alice/${"a".repeat(36)}.png`, `proofs/a b/${"a".repeat(36)}.png`, "%E0%A4%A"])
    assert.deepEqual(short(await call("GET", `/proofs/${bad.includes("%") ? bad : encodeURIComponent(bad)}`, { headers: admin })), { status: 400, error: "bad-key" }, bad);
});

test("CORS: only the configured origins are answered", async () => {
  const ok = await call("OPTIONS", "/proofs", { headers: { origin: SITE } });
  assert.deepEqual([ok.status, ok.res.headers.get("access-control-allow-origin")], [204, SITE]);
  for (const origin of ["https://evil.example", "https://panelista.vercel.app.evil.example", "null", ""]) {
    const res = (await call("OPTIONS", "/proofs", { headers: { origin } })).res;
    assert.equal(res.headers.get("access-control-allow-origin"), null, origin);
  }
});
