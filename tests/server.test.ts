// The API wrapper every route handler goes through (src/lib/server.ts): origin check, App Check, sign-in,
// error mapping. No Firebase here: with no emulator and no service account, anything that reaches it fails closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
delete process.env.FIREBASE_SERVICE_ACCOUNT_B64;
const { body, HttpError, memo, onlyPlainUrl, requireAdmin, requireUser, route } = await import("../src/lib/server.ts");
const cron = await import("../src/app/api/cron/route.ts");
const evaluators = await import("../src/app/api/evaluators/route.ts");
const projects = await import("../src/app/api/projects/route.ts");

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

  // A SyntaxError that is not the caller's body (an upstream answering with HTML, a broken service-account
  // env var) is a server fault. It used to go back as 400 "bad-json" and never reached the log.
  const upstream = await call(open(async () => JSON.parse("<html>502 Bad Gateway</html>")), post());
  assert.deepEqual(upstream, { status: 500, json: { error: "server" } });
  assert.equal(logged.mock.callCount(), 2);
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
    // The right secret passes the gate. There is no database in unit tests, so the run itself then fails: a 500.
    assert.deepEqual(await hit("Bearer s3cret-value"), { status: 500, json: { error: "server" } });
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});

test("memo: one load per window, shared by concurrent callers; a failure is not kept", async () => {
  let clock = 1_000_000;
  let loads = 0;
  let fail = false;
  const get = memo(300_000, async () => {
    loads++;
    if (fail) throw new Error("firestore down");
    return { n: loads };
  }, () => clock);

  const [a, b, c] = await Promise.all([get(), get(), get()]);
  assert.equal(loads, 1, "three requests at once make one query");
  assert.equal(a, b);
  assert.equal(b, c);
  clock += 299_999;
  assert.deepEqual(await get(), { n: 1 }, "still inside the window");
  clock += 1;
  assert.deepEqual(await get(), { n: 2 }, "the window is over: load again");

  clock += 300_000;
  fail = true;
  await assert.rejects(get(), /firestore down/);
  await assert.rejects(get(), /firestore down/, "the failure was not cached: this is a second attempt");
  assert.equal(loads, 4);
  fail = false;
  assert.deepEqual(await get(), { n: 5 }, "and it recovers as soon as the load works");
});

test("public lists: a query string is redirected to the one cached URL without reading anything", async () => {
  // One GET of these reads up to 500 documents with no login, and every "?x=..." is a new CDN cache entry.
  for (const [mod, path] of [[evaluators, "/api/evaluators"], [projects, "/api/projects"]] as const) {
    for (const query of ["?x=1", "?cb=829347", "?a=1&b=2"]) {
      const res = await mod.GET(new Request(`${SITE}${path}${query}`));
      assert.equal(res.status, 308, `${path}${query}`);
      assert.equal(res.headers.get("location"), path);
    }
    assert.equal(onlyPlainUrl(new Request(`${SITE}${path}`)), null, "the plain URL is served");
  }
});

// A guard for the next route someone adds: writes need a signed-in caller and a daily limit unless listed here with a reason.
const NO_LOGIN: Record<string, string> = {
  "appcheck/route.ts": "trades a Turnstile pass for an App Check token, before any sign-in",
  "client-errors/route.ts": "crash reports: the crash may be in sign-in itself; limited per IP instead",
  "cron/route.ts": "the Worker's hourly call, gated by CRON_SECRET",
  "visits/route.ts": "the visit beacon: most visitors are not signed in; whitelisted counters only",
};
const NO_DAILY_LIMIT: Record<string, string> = {
  "appcheck/route.ts": "writes nothing",
  "cron/route.ts": "the Worker's hourly call, gated by CRON_SECRET",
  "admin/route.ts": "admins only",
  "visits/route.ts": "its own ceilings, per address in memory and per day: rateLimit() would triple the writes of every page view",
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
