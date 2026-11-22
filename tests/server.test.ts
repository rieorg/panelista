// The API wrapper every route handler goes through (src/lib/server.ts): origin check, App Check, sign-in,
// error mapping. No Firebase here: with no emulator and no service account, anything that reaches it fails closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.FIREBASE_SERVICE_ACCOUNT_B64;
const { body, HttpError, requireAdmin, requireUser, route } = await import("../src/lib/server.ts");
const cron = await import("../src/app/api/cron/route.ts");

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const SITE = "https://panelista.vercel.app";

async function call(handler: Handler, init: RequestInit = {}, url = `${SITE}/api/x`) {
  const res = await handler(new Request(url, init), { params: Promise.resolve({}) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
const post = (headers: Record<string, string> = {}, data: unknown = {}) => ({ method: "POST", headers: { "x-forwarded-host": "panelista.vercel.app", ...headers }, body: JSON.stringify(data) });
const open = (fn: (req: Request) => Promise<unknown> = async () => undefined) => route(fn, { appCheck: false });

test("a handler's result becomes JSON; nothing returned means { ok: true }", async () => {
  assert.deepEqual(await call(open(), post()), { status: 200, json: { ok: true } });
  assert.deepEqual(await call(open(async () => ({ id: "p1" })), post()), { status: 200, json: { id: "p1" } });
});

test("state-changing requests from another site are refused before the handler runs", async () => {
  let ran = 0;
  const h = open(async () => void ran++);
  for (const origin of ["https://evil.example", "https://panelista.vercel.app.evil.example", "https://panelista.vercel.app:8443", "http://localhost:3000", "null"]) {
    assert.deepEqual(await call(h, post({ origin })), { status: 403, json: { error: "bad-origin" } }, origin);
  }
  assert.equal(ran, 0);
  assert.equal((await call(h, post({ origin: SITE }))).status, 200, "our own origin passes");
  assert.equal((await call(h, post())).status, 200, "no Origin header (not a browser): the ID token still gates it");
  assert.equal((await call(h, { headers: { origin: "https://evil.example", "x-forwarded-host": "panelista.vercel.app" } })).status, 200, "GET changes nothing, so it is not origin-checked");
  assert.equal(ran, 3);
});

test("App Check is on unless a route opts out: no token or a bad one never reaches the handler", async () => {
  let ran = 0;
  const h = route(async () => void ran++);
  assert.deepEqual(await call(h, post()), { status: 401, json: { error: "no-app-check" } });
  assert.deepEqual(await call(h, post({ "x-firebase-appcheck": "not.a.token" })), { status: 401, json: { error: "bad-app-check" } });
  assert.deepEqual(await call(h, { headers: {} }), { status: 401, json: { error: "no-app-check" } }, "GET too");
  assert.equal(ran, 0);
});

test("sign-in: no token, a non-Bearer header or a forged token is a 401", async () => {
  const h = open(async (req) => ({ uid: (await requireUser(req)).uid }));
  assert.deepEqual(await call(h, post()), { status: 401, json: { error: "no-token" } });
  assert.deepEqual(await call(h, post({ authorization: "Basic dXNlcjpwYXNz" })), { status: 401, json: { error: "no-token" } });
  assert.deepEqual(await call(h, post({ authorization: "Bearer " })), { status: 401, json: { error: "no-token" } });
  // alg "none", uid "admin", admin: true, email_verified: true. Unsigned tokens are only ever accepted by the emulator.
  const forged = `${btoa(JSON.stringify({ alg: "none", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: "admin", user_id: "admin", admin: true, email_verified: true }))}.`;
  assert.deepEqual(await call(h, post({ authorization: `Bearer ${forged}` })), { status: 401, json: { error: "bad-token" } });
  const admin = open(async (req) => void (await requireAdmin(req)));
  assert.deepEqual(await call(admin, post()), { status: 401, json: { error: "no-token" } });
  assert.deepEqual(await call(admin, post({ authorization: `Bearer ${forged}` })), { status: 401, json: { error: "bad-token" } });
});

test("errors map to stable codes and never leak internals", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  assert.deepEqual(await call(open(async () => Promise.reject(new HttpError(409, "exists"))), post()), { status: 409, json: { error: "exists" } });

  const schema = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string(), f: z.string(), g: z.string() });
  const invalid = await call(open(async (req) => schema.parse(await body(req))), post({}, {}));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error, "invalid");
  const issues = invalid.json.issues as { path: string[] }[];
  assert.equal(issues.length, 5, "at most 5 issues go back");
  assert.deepEqual(issues[0].path, ["a"], "the first bad field is named, so the form can point at it");

  const badJson = { method: "POST", headers: { "x-forwarded-host": "panelista.vercel.app" }, body: "{not json" };
  assert.deepEqual(await call(open(async (req) => body(req)), badJson), { status: 400, json: { error: "bad-json" } });
  assert.equal(logged.mock.callCount(), 0, "client mistakes are not logged as server errors");

  const crash = await call(open(async () => Promise.reject(new Error("connect ECONNREFUSED db-password=hunter2"))), post());
  assert.deepEqual(crash, { status: 500, json: { error: "server" } });
  assert.equal(logged.mock.callCount(), 1, "the real error goes to the server log only");
});

test("request bodies are capped at 20,000 characters", async () => {
  const echo = open(async (req) => ({ got: (await body(req)).x.length }));
  assert.deepEqual(await call(echo, post({}, { x: "a".repeat(19_000) })), { status: 200, json: { got: 19_000 } });
  assert.deepEqual(await call(echo, post({}, { x: "a".repeat(20_000) })), { status: 413, json: { error: "too-large" } });
});

test("cron: only the exact Bearer secret gets in, and an unset secret lets nobody in", async (t) => {
  t.mock.method(console, "error", () => {});
  const hit = (authorization?: string) => call(cron.POST as Handler, { method: "POST", headers: authorization === undefined ? {} : { authorization } }, `${SITE}/api/cron`);
  const before = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    for (const a of [undefined, "", "Bearer ", "Bearer undefined"]) assert.deepEqual(await hit(a), { status: 401, json: { error: "unauthorized" } }, `unset secret, header ${a}`);
    process.env.CRON_SECRET = "s3cret-value";
    for (const a of [undefined, "", "Bearer ", "Bearer s3cret-valuE", "Bearer s3cret-value!", "Bearer s3cret-valu", "bearer s3cret-value", "s3cret-value", "Basic s3cret-value"])
      assert.deepEqual(await hit(a), { status: 401, json: { error: "unauthorized" } }, `header ${a}`);
    // The right secret passes the gate (there is no database in unit tests, so the run itself then fails).
    assert.notEqual((await hit("Bearer s3cret-value")).status, 401);
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});

// A guard for the next route someone adds: writes need a signed-in caller and a daily limit unless listed here with a reason.
const NO_LOGIN: Record<string, string> = {
  "appcheck/route.ts": "trades a Turnstile pass for an App Check token, before any sign-in",
  "client-errors/route.ts": "crash reports: the crash may be in sign-in itself; limited per IP instead",
  "cron/route.ts": "the Worker's hourly call, gated by CRON_SECRET",
};
const NO_DAILY_LIMIT: Record<string, string> = {
  "appcheck/route.ts": "writes nothing",
  "cron/route.ts": "the Worker's hourly call, gated by CRON_SECRET",
  "admin/route.ts": "admins only",
  "reviews/route.ts": "one review per request and side (deterministic id), so it cannot repeat",
  "projects/[id]/route.ts": "TODO: project edits have no daily limit yet",
};

test("every state-changing API route is wrapped, signed-in and rate limited, or listed as an exception", () => {
  const dir = new URL("../src/app/api/", import.meta.url);
  const files = (readdirSync(dir, { recursive: true }) as string[]).map((f) => f.replaceAll("\\", "/")).filter((f) => f.endsWith("route.ts"));
  assert.ok(files.length >= 14, "found the route files");
  const writes = files.filter((f) => /export const (POST|PUT|PATCH|DELETE)\b/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.ok(writes.length >= 11);
  for (const f of writes) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.match(src, /export const (POST|PUT|PATCH|DELETE) = route\(/, `${f}: goes through route() (origin check, App Check, error mapping)`);
    if (!(f in NO_LOGIN)) assert.match(src, /await require(User|Admin)\(req\)/, `${f}: requires a signed-in user`);
    if (!(f in NO_DAILY_LIMIT)) assert.match(src, /await rateLimit\(/, `${f}: has a daily limit`);
  }
  for (const f of [...Object.keys(NO_LOGIN), ...Object.keys(NO_DAILY_LIMIT)]) assert.ok(writes.includes(f), `${f} is still a route`);
});
