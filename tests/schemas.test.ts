// The zod schemas are the API's trust boundary: route handlers spread the parsed input straight into Firestore.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionSchema,
  adminBanSchema,
  adminVerifySchema,
  clientErrorSchema,
  createRequestSchema,
  evaluationSchema,
  id,
  profileSchema,
  projectPatchSchema,
  projectSchema,
  reportSchema,
  reviewSchema,
  verificationSchema,
} from "../src/lib/schemas.ts";
import { ISO_ITEM_IDS } from "../src/lib/iso25010.ts";

const ok = (schema: { safeParse: (x: unknown) => { success: boolean } }, x: unknown) => schema.safeParse(x).success;

const profile = {
  name: "Ana Reyes",
  headline: "QA Engineer",
  bio: "",
  titles: ["QA Tester"],
  yearsExp: 5,
  categories: ["web"],
  skills: ["Laravel"],
  city: "Cebu",
  modes: ["online"],
  linkedin: "https://linkedin.com/in/ana",
  school: "",
  course: "",
  isEvaluator: true,
  accepting: true,
  maxActive: 5,
};

const project = {
  title: "Barangay Health Records System",
  abstract: "A web system that keeps patient records for a barangay health center.",
  school: "CTU",
  course: "BSIT",
  categories: ["web", "health"],
  stack: ["Laravel", "MySQL"],
  needed: 5,
  minYears: 3,
  deadline: "2026-12-15",
  formUrl: "",
  mode: "online",
};

test("ids are Firestore-safe: nothing that can address another document", () => {
  const rid = id(64);
  for (const good of ["abc", "a_b-C9", "x".repeat(64)]) assert.equal(ok(rid, good), true, good);
  for (const bad of ["", "a/b", "../requests/x", "a b", "a.b", "a%2Fb", "a\\b", "a\nb", "ñ", "x".repeat(65), 5, null, undefined, ["a"]]) assert.equal(ok(rid, bad), false, String(bad));
});

test("profile: a normal profile passes, text is trimmed, isStudent defaults to true", () => {
  const p = profileSchema.parse({ ...profile, name: "  Ana Reyes  ", titles: [" QA Tester "] });
  assert.equal(p.name, "Ana Reyes");
  assert.deepEqual(p.titles, ["QA Tester"]);
  assert.equal(p.isStudent, true);
});

test("profile: a client cannot set server-owned fields", () => {
  const p = profileSchema.parse({ ...profile, verified: true, banned: false, isAdmin: true, rank: 99, evalRatingAvg: 5, evalRatingCount: 100, completedCount: 50, missedCount: 0, photoURL: "https://evil.example/x.png", uid: "someone-else" });
  for (const k of ["verified", "banned", "isAdmin", "rank", "evalRatingAvg", "evalRatingCount", "completedCount", "missedCount", "photoURL", "uid"]) assert.equal(k in p, false, k);
});

test("profile: limits", () => {
  const bad: Record<string, unknown>[] = [
    { name: "A" },
    { name: "   a   " },
    { name: "x".repeat(61) },
    { headline: "x".repeat(81) },
    { bio: "x".repeat(601) },
    { titles: ["a", "b", "c", "d", "e", "f"] },
    { titles: [""] },
    { titles: ["x".repeat(31)] },
    { skills: Array.from({ length: 16 }, (_, i) => `s${i}`) },
    { yearsExp: -1 },
    { yearsExp: 51 },
    { yearsExp: 2.5 },
    { yearsExp: "5" },
    { categories: ["hacking"] },
    { categories: ["web", "mobile", "iot", "ai-ml", "database", "networking", "security"] },
    { modes: ["telepathy"] },
    { maxActive: 0 },
    { maxActive: 21 },
    { isEvaluator: "yes" },
    { accepting: 1 },
  ];
  for (const patch of bad) assert.equal(ok(profileSchema, { ...profile, ...patch }), false, JSON.stringify(patch).slice(0, 60));
  assert.equal(ok(profileSchema, { ...profile, yearsExp: 0, maxActive: 20, titles: [], categories: [], skills: [], modes: [] }), true);
});

test("links must be https and cannot carry markup or script URLs", () => {
  for (const good of ["", "https://linkedin.com/in/ana", "HTTPS://Example.com/x?y=1#z", "  https://forms.gle/abc  "]) assert.equal(ok(profileSchema, { ...profile, linkedin: good }), true, good);
  for (const bad of [
    "http://linkedin.com/in/ana",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example",
    "linkedin.com/in/ana",
    "https://",
    "https://x.com/a b",
    'https://x.com/"onmouseover="alert(1)',
    "https://x.com/'><script>",
    "https://x.com/<b>",
    `https://x.com/${"a".repeat(300)}`,
  ])
    assert.equal(ok(profileSchema, { ...profile, linkedin: bad }), false, bad.slice(0, 50));
  // The project's form link goes through the same rule.
  assert.equal(ok(projectSchema, { ...project, formUrl: "javascript:alert(1)" }), false);
  assert.equal(ok(projectSchema, { ...project, formUrl: "https://forms.gle/abc" }), true);
});

test("project: a normal project passes; owner, counters and status never come from the client", () => {
  const p = projectSchema.parse({ ...project, ownerUid: "someone-else", ownerName: "Admin", acceptedCount: 99, status: "filled", createdAt: 0 });
  for (const k of ["ownerUid", "ownerName", "acceptedCount", "status", "createdAt"]) assert.equal(k in p, false, k);
  assert.equal(p.deadline, "2026-12-15");
});

test("project: limits", () => {
  const bad: Record<string, unknown>[] = [
    { title: "abcd" },
    { title: "x".repeat(121) },
    { abstract: "too short" },
    { abstract: "x".repeat(1501) },
    { school: "" },
    { course: "x".repeat(81) },
    { categories: [] },
    { categories: ["web", "mobile", "iot", "ai-ml", "database"] },
    { categories: ["nope"] },
    { stack: Array.from({ length: 13 }, (_, i) => `s${i}`) },
    { needed: 0 },
    { needed: 31 },
    { needed: 2.5 },
    { minYears: -1 },
    { minYears: 21 },
    { deadline: "tomorrow" },
    { deadline: "12/15/2026" },
    { deadline: "2026-13-01" },
    { deadline: "2026-12-15T00:00:00Z" },
    { deadline: "" },
    { mode: "hybrid" },
  ];
  for (const patch of bad) assert.equal(ok(projectSchema, { ...project, ...patch }), false, JSON.stringify(patch).slice(0, 60));
});

test("project edit: every field optional, status only open or closed, counters still server-owned", () => {
  assert.deepEqual(projectPatchSchema.parse({}), {});
  assert.deepEqual(projectPatchSchema.parse({ status: "closed" }), { status: "closed" });
  assert.equal(ok(projectPatchSchema, { status: "filled" }), false, "filled is derived from the accepted count");
  assert.equal(ok(projectPatchSchema, { status: "deleted" }), false);
  assert.equal(ok(projectPatchSchema, { title: "abcd" }), false, "partial does not relax the limits");
  const p = projectPatchSchema.parse({ needed: 3, acceptedCount: 0, ownerUid: "someone-else" });
  assert.deepEqual(p, { needed: 3 });
});

test("request: both ids are validated, the note is capped", () => {
  assert.deepEqual(createRequestSchema.parse({ projectId: "p1", evaluatorUid: "u1", note: "  hi  " }), { projectId: "p1", evaluatorUid: "u1", note: "hi" });
  assert.equal(ok(createRequestSchema, { projectId: "p1/../x", evaluatorUid: "u1", note: "" }), false);
  assert.equal(ok(createRequestSchema, { projectId: "p1", evaluatorUid: "u1/messages/m", note: "" }), false);
  assert.equal(ok(createRequestSchema, { projectId: "p1", evaluatorUid: "u1", note: "x".repeat(501) }), false);
  assert.equal(ok(createRequestSchema, { projectId: "p1", evaluatorUid: "u1" }), false, "note is required, even if empty");
});

test("action: only the four participant actions exist (expiry is the cron's alone)", () => {
  for (const a of ["accept", "decline", "cancel", "complete"]) assert.equal(ok(actionSchema, { action: a }), true, a);
  for (const a of ["expire", "expired", "completed", "reopen", "", null, 1]) assert.equal(ok(actionSchema, { action: a }), false, String(a));
});

test("evaluation: all 31 items, each a whole number from 1 to 5", () => {
  const scores = Object.fromEntries(ISO_ITEM_IDS.map((k) => [k, 4]));
  assert.equal(ok(evaluationSchema, { requestId: "p1_u1", scores, comments: "" }), true);
  const { fs1: _dropped, ...missingOne } = scores;
  void _dropped;
  assert.equal(ok(evaluationSchema, { requestId: "p1_u1", scores: missingOne, comments: "" }), false, "a missing item is rejected");
  for (const v of [0, 6, 4.5, "5", null]) assert.equal(ok(evaluationSchema, { requestId: "p1_u1", scores: { ...scores, fs1: v }, comments: "" }), false, String(v));
  assert.equal(ok(evaluationSchema, { requestId: "p1_u1", scores, comments: "x".repeat(1501) }), false);
  assert.equal(ok(evaluationSchema, { requestId: "p1/u1", scores, comments: "" }), false);
  // An unknown item never reaches Firestore: it is either rejected or dropped.
  const extra = evaluationSchema.safeParse({ requestId: "p1_u1", scores: { ...scores, evil: 5 }, comments: "" });
  assert.equal(extra.success && "evil" in extra.data.scores, false);
});

test("review: 1 to 5 whole stars, known tags only, at most 4", () => {
  const r = { requestId: "p1_u1", stars: 5, tags: ["fast", "kind"], text: "Salamat!" };
  assert.equal(ok(reviewSchema, r), true);
  for (const patch of [{ stars: 0 }, { stars: 6 }, { stars: 4.5 }, { stars: "5" }, { tags: ["fast", "helpful", "detailed", "kind", "clear"] }, { tags: ["best-ever"] }, { text: "x".repeat(501) }, { requestId: "a/b" }])
    assert.equal(ok(reviewSchema, { ...r, ...patch }), false, JSON.stringify(patch).slice(0, 60));
});

test("report, verification and admin inputs", () => {
  assert.equal(ok(reportSchema, { targetUid: "u1", reason: "scam", details: "" }), true);
  assert.equal(ok(reportSchema, { targetUid: "u1", reason: "annoying", details: "" }), false);
  assert.equal(ok(reportSchema, { targetUid: "u/1", reason: "scam", details: "" }), false);
  assert.equal(ok(reportSchema, { targetUid: "u1", reason: "scam", details: "x".repeat(501) }), false);

  const file = { key: "proofs/u1/0f8fad5b-d9cb-469f-a165-70867728950e.png", name: "id.png", type: "image/png", size: 1000 };
  assert.equal(ok(verificationSchema, { files: [file], note: "" }), true);
  assert.equal(ok(verificationSchema, { files: [], note: "" }), false, "at least one file");
  assert.equal(ok(verificationSchema, { files: [file, file, file, file], note: "" }), false, "at most three");
  assert.equal(ok(verificationSchema, { files: [{ ...file, size: 5_000_001 }], note: "" }), false);
  assert.equal(ok(verificationSchema, { files: [{ ...file, key: "" }], note: "" }), false);
  assert.equal(ok(verificationSchema, { files: [file], note: "x".repeat(301) }), false);

  assert.equal(ok(adminVerifySchema, { uid: "u1", decision: "approve", reason: "" }), true);
  assert.equal(ok(adminVerifySchema, { uid: "u1", decision: "maybe", reason: "" }), false);
  assert.equal(ok(adminVerifySchema, { uid: "../u1", decision: "approve", reason: "" }), false);
  assert.equal(ok(adminBanSchema, { uid: "u1", banned: true }), true);
  assert.equal(ok(adminBanSchema, { uid: "u1", banned: "true" }), false);
});

test("crash report: every field capped, all required", () => {
  const e = { message: "boom", stack: "at x", digest: "", path: "/me", ua: "Mozilla", uid: "" };
  assert.equal(ok(clientErrorSchema, e), true);
  for (const [k, max] of [["message", 500], ["stack", 4000], ["digest", 100], ["path", 300], ["ua", 400], ["uid", 128]] as const) {
    assert.equal(ok(clientErrorSchema, { ...e, [k]: "x".repeat(max) }), true, `${k} at the cap`);
    assert.equal(ok(clientErrorSchema, { ...e, [k]: "x".repeat(max + 1) }), false, `${k} over the cap`);
    const { [k]: _gone, ...rest } = e;
    void _gone;
    assert.equal(ok(clientErrorSchema, rest), false, `${k} missing`);
  }
});
