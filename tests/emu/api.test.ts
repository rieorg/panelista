// The API route handlers against the Auth and Firestore emulators: `npm run test:emu` (needs Java 21+, see CONTRIBUTING.md).
// Real ID tokens from the Auth emulator, the real handlers, the real transactions. No mail: there are no SMTP settings here.
// The tests run top to bottom and build on each other: one student, one evaluator, one stranger, one admin.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { deleteApp } from "firebase-admin/app";
import type { Summary } from "../../src/lib/analytics.ts";

const projectId = process.env.GCLOUD_PROJECT ?? "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "";
const storeHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
assert.ok(authHost && storeHost && projectId.startsWith("demo-"), "run through `npm run test:emu`: these tests only ever talk to the emulators");
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = projectId;
process.env.CRON_SECRET = "emulator-cron-secret";
process.env.METADATA_SERVER_DETECTION ??= "none"; // no credentials are needed, so do not go looking for a metadata server
for (const k of ["SMTP_USER", "SMTP_PASSWORD", "FIREBASE_SERVICE_ACCOUNT_B64"]) delete process.env[k];

const { adminAuth, app, db } = await import("../../src/lib/server.ts");
const { deadlineEnd, rankScore } = await import("../../src/lib/domain.ts");
const { ISO_ITEM_IDS } = await import("../../src/lib/iso25010.ts");
const api = {
  profile: (await import("../../src/app/api/profile/route.ts")).PUT,
  projects: (await import("../../src/app/api/projects/route.ts")).POST,
  projectList: (await import("../../src/app/api/projects/route.ts")).GET,
  project: (await import("../../src/app/api/projects/[id]/route.ts")).PATCH,
  requests: (await import("../../src/app/api/requests/route.ts")).POST,
  request: (await import("../../src/app/api/requests/[id]/route.ts")).POST,
  evaluations: (await import("../../src/app/api/evaluations/route.ts")).POST,
  reviews: (await import("../../src/app/api/reviews/route.ts")).POST,
  reports: (await import("../../src/app/api/reports/route.ts")).POST,
  verification: (await import("../../src/app/api/verification/route.ts")).POST,
  admin: (await import("../../src/app/api/admin/route.ts")).POST,
  cron: (await import("../../src/app/api/cron/route.ts")).POST,
  clientErrors: (await import("../../src/app/api/client-errors/route.ts")).POST,
  evaluators: (await import("../../src/app/api/evaluators/route.ts")).GET,
  visit: (await import("../../src/app/api/visits/route.ts")).POST,
  visitNumbers: (await import("../../src/app/api/visits/route.ts")).GET,
};

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Calls a handler the way the browser does: a Bearer ID token (or none) and a JSON body. */
async function call(handler: Handler, idToken: string | null, data: unknown = {}, params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const req = new Request("https://panelista.test/api", { method: "POST", headers: { ...(idToken ? { authorization: `Bearer ${idToken}` } : {}), ...headers }, body: JSON.stringify(data) });
  const res = await handler(req, { params: Promise.resolve(params) });
  return { status: res.status, ...((await res.json()) as Record<string, unknown>) };
}

/** An ID token from the Auth emulator. Pass `create` the first time a uid is used. */
async function token(uid: string, create?: { emailVerified?: boolean; photoURL?: string; admin?: boolean }) {
  const email = `${uid}@example.test`;
  const password = "emulator-only";
  if (create) {
    await adminAuth().createUser({ uid, email, password, emailVerified: create.emailVerified ?? true, photoURL: create.photoURL });
    if (create.admin) await adminAuth().setCustomUserClaims(uid, { admin: true });
  }
  const res = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const { idToken } = (await res.json()) as { idToken?: string };
  assert.ok(idToken, `the Auth emulator signed ${uid} in`);
  return idToken;
}

const get = async (path: string) => (await db().doc(path).get()).data() ?? {};
const day = new Date().toISOString().slice(0, 10);
/** A calendar date in the Philippines, `days` from today. */
const manila = (days: number) => new Date(Date.now() + 8 * 36e5 + days * 864e5).toISOString().slice(0, 10);

const profile = (over: Record<string, unknown> = {}) => ({
  name: "Juan Dela Cruz", headline: "BSIT student", bio: "", titles: [], yearsExp: 0, categories: ["web"], skills: ["Laravel"], city: "Cebu",
  modes: ["online"], linkedin: "", school: "CTU", course: "BSIT", isStudent: true, isEvaluator: false, accepting: false, maxActive: 5, ...over,
});
const evaluator = (over: Record<string, unknown> = {}) =>
  profile({ name: "Ana Reyes", headline: "Senior developer", linkedin: "https://www.linkedin.com/in/ana-reyes", yearsExp: 5, isStudent: false, isEvaluator: true, accepting: true, maxActive: 2, ...over });
const project = (over: Record<string, unknown> = {}) => ({
  title: "Barangay Health Records System", abstract: "A web system that keeps patient records for a barangay health center.", school: "CTU", course: "BSIT",
  categories: ["web", "health"], stack: ["Laravel", "MySQL"], needed: 1, minYears: 3, deadline: manila(14), formUrl: "", mode: "online", ...over,
});

let S = "";
let E = "";
let X = "";
let A = "";
let pid = "";
let rid = "";

before(async () => {
  // A clean slate, whatever an earlier run or the other test file left behind.
  await fetch(`http://${storeHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: "DELETE" });
  S = await token("stu", {});
  E = await token("eva", {});
  X = await token("xan", {});
  A = await token("adm", { admin: true });
});

// Closes the Admin SDK's connections, so the run ends when the tests do.
after(() => deleteApp(app()));

test("profile: needs a verified sign-in; the badge, rank, ban flag, counters and avatar are the server's", async () => {
  assert.deepEqual(await call(api.profile, null, profile()), { status: 401, error: "no-token" });
  assert.deepEqual(await call(api.profile, "not-a-token", profile()), { status: 401, error: "bad-token" });
  assert.deepEqual(await call(api.profile, await token("unv", { emailVerified: false }), profile()), { status: 403, error: "verify-email" });

  const greedy = { ...profile(), verified: true, banned: true, isAdmin: true, rank: 99, evalRatingAvg: 5, evalRatingCount: 40, completedCount: 40, photoURL: "https://evil.example/a.png" };
  assert.deepEqual(await call(api.profile, S, greedy), { status: 200, ok: true });
  const p = await get("profiles/stu");
  assert.deepEqual([p.verified, p.banned, p.isAdmin, p.rank, p.evalRatingAvg, p.evalRatingCount, p.completedCount, p.photoURL], [false, false, false, rankScore(0, 0, false), 0, 0, 0, ""]);
  assert.equal((await get("profiles/unv")).name, undefined, "the refused call wrote nothing");

  // The avatar is read from the sign-in token, and a user can set their own token's photo to anything.
  await call(api.profile, await token("pic", { photoURL: "https://evil.example/pixel.gif" }), profile());
  assert.equal((await get("profiles/pic")).photoURL, "");
  const google = "https://lh3.googleusercontent.com/a/ACg8ocK-abc=s96-c";
  await adminAuth().updateUser("pic", { photoURL: google });
  await call(api.profile, await token("pic"), profile());
  assert.equal((await get("profiles/pic")).photoURL, google);

  // The public Admin flag mirrors the token's claim, never the request body.
  await call(api.profile, A, profile({ name: "Site Admin" }));
  assert.equal((await get("profiles/adm")).isAdmin, true);
});

test("projects: created for the caller, edited by the owner only, never open past the deadline, edits limited per day", async () => {
  assert.deepEqual(await call(api.projects, X, project()), { status: 400, error: "no-profile" });
  const made = await call(api.projects, S, { ...project(), ownerUid: "xan", status: "filled", acceptedCount: 9 });
  assert.equal(made.status, 200);
  pid = made.id as string;
  let p = await get(`projects/${pid}`);
  assert.deepEqual([p.ownerUid, p.status, p.acceptedCount, p.deadline.toDate().toISOString()], ["stu", "open", 0, deadlineEnd(manila(14)).toISOString()]);
  assert.deepEqual(await call(api.projects, S, project({ deadline: manila(-1) })), { status: 400, error: "deadline-past" });
  assert.deepEqual(await call(api.projects, S, project({ abstract: "Demo login for the panel. Username: admin Password: admin123" })), { status: 400, error: "secret-in-public" });

  const edit = (who: string, data: unknown, id = pid) => call(api.project, who, data, { id });
  assert.deepEqual(await edit(X, { title: "Hijacked by a stranger" }), { status: 403, error: "not-owner" });
  assert.deepEqual(await edit(E, { status: "closed" }), { status: 403, error: "not-owner" });
  assert.deepEqual(await edit(S, { title: "A title for nothing" }, "missing"), { status: 404, error: "not-found" });
  assert.equal((await edit(S, { title: "A title for nothing" }, `${pid}/messages/x`)).error, "invalid", "an id with a slash never reaches Firestore");
  assert.deepEqual(await edit(S, { title: "Barangay Health Records", ownerUid: "xan", acceptedCount: 5 }), { status: 200, ok: true });
  p = await get(`projects/${pid}`);
  assert.deepEqual([p.title, p.ownerUid, p.acceptedCount], ["Barangay Health Records", "stu", 0]);

  assert.deepEqual(await edit(S, { status: "closed" }), { status: 200, ok: true });
  await db().doc(`projects/${pid}`).update({ deadline: new Date(Date.now() - 36e5) });
  assert.deepEqual(await edit(S, { title: "Closed projects can be edited" }), { status: 200, ok: true });
  // Reopening used to work, and the hourly cron then closed the project again without a word.
  assert.deepEqual(await edit(S, { status: "open" }), { status: 400, error: "deadline-past" });
  assert.deepEqual(await edit(S, { status: "open", deadline: manila(-1) }), { status: 400, error: "deadline-past" });
  assert.deepEqual(await edit(S, { status: "open", deadline: manila(14) }), { status: 200, ok: true });
  assert.equal((await get(`projects/${pid}`)).status, "open");

  await db().doc(`ratelimits/stu_project-edit_${day}`).set({ n: 60 });
  assert.deepEqual(await edit(S, { title: "One edit too many today" }), { status: 429, error: "rate-limited" });
  await db().doc(`ratelimits/stu_project-edit_${day}`).delete();
});

test("requests: only the owner invites, only the other side answers, strangers get nowhere, counters follow", async () => {
  await call(api.profile, E, evaluator());
  await call(api.profile, X, profile({ name: "Xander Cruz" }));
  const ask = { projectId: pid, evaluatorUid: "eva", note: "Hello po, pwede po ba kayo?" };
  assert.deepEqual(await call(api.requests, X, ask), { status: 403, error: "not-allowed" }, "a stranger cannot pair two other people");
  assert.deepEqual(await call(api.requests, S, { ...ask, evaluatorUid: "xan" }), { status: 409, error: "not-evaluator" });
  assert.deepEqual(await call(api.requests, S, { ...ask, projectId: "missing" }), { status: 404, error: "not-found" });
  rid = `${pid}_eva`;
  assert.deepEqual(await call(api.requests, S, ask), { status: 200, id: rid });
  const r = await get(`requests/${rid}`);
  assert.deepEqual([r.status, r.initiatedBy, r.studentUid, r.evaluatorUid, r.participants], ["pending", "student", "stu", "eva", ["stu", "eva"]]);
  assert.deepEqual(await call(api.requests, S, ask), { status: 409, error: "exists" });

  const act = (who: string, action: string, id = rid) => call(api.request, who, { action }, { id });
  assert.deepEqual(await act(X, "accept"), { status: 409, error: "not-participant" });
  assert.deepEqual(await act(X, "cancel"), { status: 409, error: "not-participant" });
  assert.deepEqual(await act(S, "accept"), { status: 409, error: "initiator-cannot-answer" });
  assert.deepEqual(await act(E, "complete"), { status: 409, error: "not-accepted" });
  assert.deepEqual(await act(E, "accept", "missing"), { status: 404, error: "not-found" });
  assert.equal((await act(E, "accept", `${rid}/messages/x`)).error, "invalid");
  assert.equal((await act(E, "expire")).error, "invalid", "expiry is the cron's alone");
  assert.equal((await get(`requests/${rid}`)).status, "pending", "nothing above changed it");

  assert.deepEqual(await act(E, "accept"), { status: 200, ok: true });
  assert.deepEqual(await act(E, "accept"), { status: 409, error: "not-pending" });
  const [proj, ev] = [await get(`projects/${pid}`), await get("profiles/eva")];
  assert.deepEqual([proj.acceptedCount, proj.status, ev.activeCount, ev.responseCount], [1, "filled", 1, 1]);

  const answers = { requestId: rid, scores: Object.fromEntries(ISO_ITEM_IDS.map((k: string) => [k, 4])), comments: "Solid work." };
  assert.deepEqual(await call(api.evaluations, S, answers), { status: 403, error: "not-evaluator" }, "a student cannot fill in their own evaluation");
  assert.deepEqual(await call(api.evaluations, X, answers), { status: 403, error: "not-evaluator" });
  assert.deepEqual(await call(api.evaluations, E, answers), { status: 200, ok: true });
  const form = await get(`evaluations/${rid}`);
  assert.deepEqual([form.studentUid, form.evaluatorUid, form.projectId], ["stu", "eva", pid]);

  const review = { requestId: rid, stars: 5, tags: ["helpful"], text: "Very clear feedback." };
  assert.deepEqual(await call(api.reviews, S, review), { status: 409, error: "not-completed" }, "no rating before the work is done");
  assert.deepEqual(await act(X, "complete"), { status: 409, error: "not-participant" });
  assert.deepEqual(await act(E, "complete"), { status: 200, ok: true });
  const done = await get("profiles/eva");
  assert.deepEqual([done.activeCount, done.completedCount], [0, 1]);
  assert.deepEqual(await call(api.evaluations, E, { ...answers, comments: "Changed my mind." }), { status: 409, error: "evaluation-locked" });
  assert.deepEqual(await act(S, "cancel"), { status: 409, error: "cannot-cancel" }, "a finished evaluation cannot be undone");
});

test("a finished evaluation must be rated before the student asks for more help; one rating per side", async () => {
  const review = { requestId: rid, stars: 5, tags: ["helpful"], text: "Very clear feedback." };
  assert.deepEqual(await call(api.projects, S, project({ title: "Second capstone project" })), { status: 409, error: "review-pending" });
  assert.deepEqual(await call(api.requests, S, { projectId: pid, evaluatorUid: "eva", note: "" }), { status: 409, error: "review-pending" });
  assert.deepEqual(await call(api.reviews, X, review), { status: 403, error: "not-participant" });
  assert.equal((await call(api.reviews, S, { ...review, stars: 6 })).error, "invalid");
  assert.deepEqual(await call(api.reviews, S, review), { status: 200, ok: true });
  assert.deepEqual(await call(api.reviews, S, { ...review, stars: 1 }), { status: 409, error: "already-reviewed" });
  const rev = await get(`reviews/${rid}_student`);
  assert.deepEqual([rev.fromUid, rev.toUid, rev.direction, rev.stars, rev.counted], ["stu", "eva", "toEvaluator", 5, false]);
  // Anti review-farming: a rating from an account younger than 3 days shows, but does not move the score.
  assert.equal((await get("profiles/eva")).evalRatingCount, 0);
  assert.equal((await get(`requests/${rid}`)).reviewedByStudent, true);
  assert.equal((await call(api.projects, S, project({ title: "Second capstone project" }))).status, 200, "rated: the gate is open again");
});

test("admin: closed to everyone else; a badge is not approved for an identity that changed after applying", async () => {
  const verify = (who: string | null, decision: string, uid = "eva") => call(api.admin, who, { op: "verify", uid, decision, reason: "" });
  assert.deepEqual(await verify(null, "approve"), { status: 401, error: "no-token" });
  for (const who of [S, E, X]) assert.deepEqual(await verify(who, "approve"), { status: 403, error: "not-admin" });
  assert.deepEqual(await call(api.admin, E, { op: "ban", uid: "stu", banned: true }), { status: 403, error: "not-admin" });

  const proof = (uid: string) => ({ files: [{ key: `proofs/${uid}/id.pdf`, name: "id.pdf", type: "application/pdf", size: 1000 }], note: "" });
  assert.deepEqual(await call(api.verification, E, proof("xan")), { status: 400, error: "bad-key" }, "someone else's upload");
  assert.deepEqual(await call(api.verification, S, proof("stu")), { status: 400, error: "not-evaluator" });
  assert.deepEqual(await call(api.verification, E, proof("eva")), { status: 200, ok: true });
  assert.deepEqual(await verify(A, "approve", "nobody"), { status: 404, error: "not-found" });

  // Apply as a senior developer, then become a bank's CTO while the application waits.
  const cto = { headline: "Chief Technology Officer, Big Bank" };
  await call(api.profile, E, evaluator(cto));
  assert.deepEqual(await verify(A, "approve"), { status: 200, ok: true, stale: true });
  assert.equal((await get("profiles/eva")).verified, false, "the badge would have vouched for a title nobody reviewed");
  const turnedDown = await get("verifications/eva");
  assert.equal(turnedDown.status, "rejected");
  assert.match(turnedDown.reason, /profile changed/);

  // Applying again as they are now works, and the badge lifts the rank.
  assert.deepEqual(await call(api.verification, E, proof("eva")), { status: 200, ok: true });
  assert.deepEqual(await verify(A, "approve"), { status: 200, ok: true, stale: false });
  const badged = await get("profiles/eva");
  assert.equal(badged.verified, true);
  assert.equal((await get("verifications/eva")).status, "approved");
  // A later change of identity drops it; a change of bio does not.
  await call(api.profile, E, evaluator({ ...cto, bio: "Ten years in fintech." }));
  assert.equal((await get("profiles/eva")).verified, true);
  await call(api.profile, E, evaluator({ ...cto, name: "Somebody Else" }));
  const dropped = await get("profiles/eva");
  assert.equal(dropped.verified, false);
  assert.ok(dropped.rank < badged.rank);
});

test("reports and bans: a ban ends the session at once, hides the profile and closes the account's projects", async () => {
  assert.deepEqual(await call(api.reports, S, { targetUid: "stu", reason: "spam", details: "" }), { status: 400, error: "self" });
  assert.deepEqual(await call(api.reports, S, { targetUid: "xan", reason: "scam", details: "Asked for a payment." }), { status: 200, ok: true });
  const open = await db().collection("reports").where("status", "==", "open").get();
  assert.deepEqual(open.docs.map((d) => [d.get("reporterUid"), d.get("targetUid")]), [["stu", "xan"]], "the reporter is the caller, not a field in the body");
  assert.deepEqual(await call(api.admin, X, { op: "resolveReport", id: open.docs[0].id }), { status: 403, error: "not-admin" });
  assert.deepEqual(await call(api.admin, A, { op: "resolveReport", id: open.docs[0].id }), { status: 200, ok: true });
  assert.equal((await get(`reports/${open.docs[0].id}`)).status, "resolved");

  const mine = await call(api.projects, X, project({ title: "Xander's capstone project" }));
  assert.equal(mine.status, 200);
  assert.deepEqual(await call(api.admin, A, { op: "ban", uid: "xan", banned: true }), { status: 200, ok: true });
  const p = await get("profiles/xan");
  assert.deepEqual([p.banned, p.isEvaluator, p.accepting, (await get(`projects/${mine.id}`)).status], [true, false, false, "closed"]);
  assert.deepEqual(await call(api.profile, X, profile()), { status: 401, error: "bad-token" }, "the token X already holds is dead");
});

test("cron: an invite ignored for 3 days expires and counts against the evaluator; a newer one is left alone", async () => {
  const seed = (id: string, daysOld: number) =>
    db().doc(`requests/${id}`).set({
      projectId: pid, projectTitle: "Barangay Health Records", studentUid: "stu", studentName: "Juan Dela Cruz", evaluatorUid: "eva", evaluatorName: "Ana Reyes",
      participants: ["stu", "eva"], initiatedBy: "student", status: "pending", createdAt: new Date(Date.now() - daysOld * 864e5), lastMessageAt: new Date(),
    });
  await seed("ignored", 3.1);
  await seed("recent", 2.9);
  const run = (secret: string) => call(api.cron, null, {}, {}, { authorization: `Bearer ${secret}` });
  assert.deepEqual(await run("not-the-secret"), { status: 401, error: "unauthorized" });
  assert.deepEqual(await call(api.cron, S), { status: 401, error: "unauthorized" }, "a signed-in user is not the cron");
  assert.equal((await get("requests/ignored")).status, "pending");
  assert.deepEqual(await run("emulator-cron-secret"), { status: 200, expired: 1, mails: 1 });
  assert.deepEqual([(await get("requests/ignored")).status, (await get("requests/recent")).status], ["expired", "pending"]);
  const ev = await get("profiles/eva");
  assert.deepEqual([ev.missedCount, ev.missedStreak, ev.accepting], [1, 1, true]);
  assert.deepEqual(await run("emulator-cron-secret"), { status: 200, expired: 0, mails: 0 }, "running again changes nothing");
});

test("crash reports: no login, 30 a day per address and 500 a day in total, nothing written past either", async (t) => {
  t.mock.method(console, "error", () => {});
  const send = (ip: string) => call(api.clientErrors, null, { message: "boom", stack: "", digest: "", path: "/", ua: "node", uid: "" }, {}, { "x-forwarded-for": `${ip}, 10.0.0.1` });
  const stored = async () => (await db().collection("clientErrors").count().get()).data().count;
  const used = async (who: string) => ((await get(`ratelimits/${who}_client-error_${day}`)).n as number | undefined) ?? 0;

  assert.deepEqual(await send("203.0.113.7"), { status: 200, ok: true });
  assert.deepEqual([await stored(), await used("ip-203.0.113.7"), await used("all")], [1, 1, 1]);
  await db().doc(`ratelimits/ip-203.0.113.7_client-error_${day}`).set({ n: 30 });
  assert.deepEqual(await send("203.0.113.7"), { status: 429, error: "rate-limited" });
  assert.deepEqual([await stored(), await used("all")], [1, 1], "a blocked address does not use up everyone's allowance");
  // Without the shared ceiling, a sender that changes address every 30 calls could write all day.
  await db().doc(`ratelimits/all_client-error_${day}`).set({ n: 500 });
  assert.deepEqual(await send("198.51.100.9"), { status: 429, error: "rate-limited" });
  assert.deepEqual([await stored(), await used("ip-198.51.100.9")], [1, 0], "past the shared ceiling a new address writes nothing at all");
});

test("public lists: card fields only, no banned accounts, no closed or filled projects", async () => {
  const evaluators = (await (await api.evaluators(new Request("https://panelista.test/api/evaluators"))).json()) as Record<string, unknown>[];
  assert.deepEqual(evaluators.map((e) => e.uid), ["eva"]);
  for (const k of ["linkedin", "bio", "city", "school", "banned", "maxActive", "activeCount", "missedStreak", "isAdmin", "email"]) assert.equal(k in evaluators[0], false, k);
  const projects = (await (await api.projectList(new Request("https://panelista.test/api/projects"))).json()) as Record<string, unknown>[];
  assert.deepEqual(projects.map((p) => p.title), ["Second capstone project"], "the filled one and the banned owner's are not listed");
  for (const k of ["ownerUid", "formUrl", "stack", "status"]) assert.equal(k in projects[0], false, k);
});

test("visits: one counter document a day under fixed names, a ceiling per address and per day, and the numbers are the admin's", async () => {
  const today = manila(0);
  const beacon = (data: unknown, ip = "203.0.113.20", handler: Handler = api.visit) => call(handler, null, data, {}, { "x-forwarded-for": `${ip}, 10.0.0.1` });
  const numbers = async (who: string | null) => {
    const res = await api.visitNumbers(new Request("https://panelista.test/api/visits", { headers: who ? { authorization: `Bearer ${who}` } : {} }), { params: Promise.resolve({}) });
    return { status: res.status, ...((await res.json()) as Partial<Summary> & { error?: string }) };
  };

  assert.deepEqual(await beacon({ page: "home", entry: { source: "facebook", device: "phone" }, uid: "stu", ua: "Mozilla/5.0" }), { status: 200, ok: true });
  assert.deepEqual(await beacon({ page: "evaluators" }), { status: 200, ok: true }, "the same session opening a second page group");
  assert.equal((await beacon({ page: "/e/eva" })).error, "invalid", "a path is not a page group");
  assert.equal((await beacon({ page: "home", entry: { source: "evil.example", device: "phone" } })).error, "invalid");
  // All that two page views left behind: one document of counters. No address, user agent, id or event.
  assert.deepEqual(await get(`stats/${today}`), { visits: 1, pages: { home: 1, evaluators: 1 }, sources: { facebook: 1 }, devices: { phone: 1 } });
  assert.equal((await db().collection("stats").count().get()).data().count, 1);
  assert.equal((await db().collection("ratelimits").get()).docs.some((d) => d.id.includes("203.0.113.20")), false, "the address is counted in memory, not in Firestore");

  assert.deepEqual(await numbers(null), { status: 401, error: "no-token" });
  assert.deepEqual(await numbers(S), { status: 403, error: "not-admin" });
  const n = await numbers(A);
  assert.equal(n.status, 200);
  assert.deepEqual([n.visits, n.days?.at(-1)], [{ today: 1, d7: 1, d30: 1 }, { date: today, visits: 1 }]);
  assert.deepEqual(n.pages, [{ id: "home", today: 1, d7: 1, d30: 1 }, { id: "evaluators", today: 1, d7: 1, d30: 1 }]);
  assert.deepEqual([n.sources?.[0], n.devices?.[0]], [{ id: "facebook", n: 1 }, { id: "phone", n: 1 }]);
  // The rest comes from what the earlier tests stored: six accounts, five profiles, one request accepted, completed and rated.
  const funnel = Object.fromEntries((n.funnel ?? []).map((f) => [f.id, f.n]));
  assert.deepEqual([funnel.visits, funnel.signups, funnel.profiles, funnel.accepted, funnel.completed, funnel.rated], [1, 6, 5, 1, 1, 1]);
  assert.deepEqual(n.totals, { accounts: 6, profiles: 5, evaluators: 1, projects: 3, requests: 3, completed: 1, reviews: 1, errors: 1, errors7: 1 });
  assert.deepEqual(n.rates, { completion: 1 / 3, answer: 1 / 2 }, "eva answered one invite and let one expire");
  assert.deepEqual(n.active, { students7: 1, students30: 1, evaluators7: 1, evaluators30: 1 });

  // One address: 300 counted in a day, then nothing more is written for it.
  for (let i = 0; i < 300; i++) await beacon({ page: "other" }, "198.51.100.77");
  assert.deepEqual(await beacon({ page: "other" }, "198.51.100.77"), { status: 429, error: "rate-limited" });
  assert.equal((await get(`stats/${today}`)).pages.other, 300);

  // Everyone together: 5000 in a day. A fresh copy of the route (a second server instance) reads the day's count first.
  await db().doc(`stats/${today}`).set({ pages: { other: 5000 } }, { merge: true });
  const another = (await import("../../src/app/api/visits/route.ts?instance=2")).POST;
  assert.deepEqual(await beacon({ page: "home" }, "203.0.113.99", another), { status: 429, error: "rate-limited" });
  assert.equal((await get(`stats/${today}`)).pages.home, 1, "past the day's ceiling nothing is written");
});
