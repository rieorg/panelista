// Run: npm test  (Node 24 strips TS types natively; no test framework needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { average, looksLikeSecret, projectStatusFor, rankFor, rankScore, requestId, responseLabel, transition, type RequestLike } from "../src/lib/domain.ts";
import { sniff } from "../worker/src/sniff.ts";
import { fieldKey, translate } from "../src/lib/i18n.ts";
import { findEvaluators, NO_FILTERS, type EvaluatorSort } from "../src/lib/evaluators.ts";
import type { Profile } from "../src/lib/types.ts";
import { interpret, ISO25010, ISO_ITEM_IDS, tabulate, toTsv } from "../src/lib/iso25010.ts";

const base: RequestLike = { status: "pending", initiatedBy: "student", studentUid: "S", evaluatorUid: "E" };

test("only the non-initiator answers a pending request", () => {
  assert.deepEqual(transition(base, "E", "accept"), { ok: true, next: "accepted" });
  assert.deepEqual(transition(base, "E", "decline"), { ok: true, next: "declined" });
  assert.equal(transition(base, "S", "accept").ok, false);
  const offer = { ...base, initiatedBy: "evaluator" as const };
  assert.deepEqual(transition(offer, "S", "accept"), { ok: true, next: "accepted" });
  assert.equal(transition(offer, "E", "accept").ok, false);
});

test("strangers can do nothing", () => {
  for (const a of ["accept", "decline", "cancel", "complete"] as const) assert.equal(transition(base, "X", a).ok, false);
});

test("cancel rules", () => {
  assert.deepEqual(transition(base, "S", "cancel"), { ok: true, next: "cancelled" });
  assert.equal(transition(base, "E", "cancel").ok, false, "responder declines instead of cancelling");
  const accepted = { ...base, status: "accepted" as const };
  assert.equal(transition(accepted, "E", "cancel").ok, true);
  assert.equal(transition(accepted, "S", "cancel").ok, true);
  assert.equal(transition({ ...base, status: "completed" }, "S", "cancel").ok, false);
});

test("either side marks an accepted evaluation done, never a pending one", () => {
  const accepted = { ...base, status: "accepted" as const };
  assert.deepEqual(transition(accepted, "S", "complete"), { ok: true, next: "completed" });
  assert.deepEqual(transition(accepted, "E", "complete"), { ok: true, next: "completed" });
  assert.equal(transition(base, "S", "complete").ok, false);
  assert.equal(transition(base, "E", "complete").ok, false);
});

test("evaluator filters combine; sorts order by the chosen number", () => {
  const p = (o: Partial<Profile>) =>
    ({ name: "x", headline: "", titles: [], skills: [], categories: [], modes: ["online"], yearsExp: 0, evalRatingAvg: 0, evalRatingCount: 0,
      completedCount: 0, responseCount: 0, rank: 4, verified: false, accepting: true, ...o }) as Profile;
  const ana = p({ name: "Ana", skills: ["Laravel"], categories: ["web"], yearsExp: 5, evalRatingAvg: 4.8, evalRatingCount: 10, verified: true, responseCount: 3, avgResponseHours: 5 });
  const ben = p({ name: "Ben", categories: ["mobile"], yearsExp: 1, evalRatingAvg: 5, evalRatingCount: 1, modes: ["onsite"], responseCount: 2, avgResponseHours: 1 });
  const cy = p({ name: "Cy", yearsExp: 12, accepting: false });
  const all = [ana, ben, cy];
  const names = (f: Partial<typeof NO_FILTERS>, s: EvaluatorSort = "rank") => findEvaluators(all, { ...NO_FILTERS, ...f }, s).map((x) => x.name);
  assert.deepEqual(names({ search: "laravel" }), ["Ana"]);
  assert.deepEqual(names({ years: 3 }, "years"), ["Cy", "Ana"]);
  assert.deepEqual(names({ rating: 4.5 }, "rating"), ["Ben", "Ana"], "unrated Cy drops out");
  assert.deepEqual(names({ mode: "onsite" }), ["Ben"]);
  assert.deepEqual(names({ verified: true, cat: "web" }), ["Ana"]);
  assert.deepEqual(names({ accepting: true }, "reviews"), ["Ana", "Ben"]);
  assert.deepEqual(names({}, "fast"), ["Ben", "Ana", "Cy"], "no reply history sorts last");
  const away = p({ name: "Dee", rank: 9, accepting: false });
  assert.deepEqual(findEvaluators([away, ana], NO_FILTERS, "rank").map((x) => x.name), ["Ana", "Dee"], "Away sorts after anyone accepting");
});

test("counts read as words: 1 yr, 3 yrs", () => {
  assert.equal(translate("en", "minYears", { n: 1 }), "1+ yr exp");
  assert.equal(translate("en", "minYears", { n: 3 }), "3+ yrs exp");
  assert.equal(translate("en", "evalsDone", { n: 0 }), "0 evaluations done");
  assert.equal(translate("en", "neededCount", { a: 0, n: 1 }), "0/1 evaluator");
  assert.equal(translate("en", "ratingsCount", { n: 2 }), "2 ratings");
  assert.equal(translate("en", "answerRate", { a: 3, n: 4 }), "Answered 3 of 4 requests");
  assert.equal(translate("tl", "sys_accepted", { name: "Ana" }), "Na-accept ni Ana ang request");
});

test("terminal states are terminal", () => {
  for (const status of ["declined", "cancelled", "completed", "expired"] as const)
    for (const a of ["accept", "decline"] as const) assert.equal(transition({ ...base, status }, "E", a).ok, false);
});

test("rank: many good reviews beat one perfect review; verified gets a nudge", () => {
  assert.ok(rankScore(4.8 * 20, 20, false) > rankScore(5, 1, false));
  assert.ok(rankScore(0, 0, true) > rankScore(0, 0, false));
  assert.equal(rankScore(0, 0, false), 4);
});

test("rank: ignored invites sink a silent evaluator below new and active ones", () => {
  const ghost = rankScore(0, 0, true, 0, 3); // verified, never answered, 3 expired
  assert.ok(ghost < rankScore(0, 0, false), "below a brand-new unverified evaluator");
  assert.ok(ghost < rankScore(10, 2, false, 4, 0), "below an active rated one");
  assert.equal(rankScore(0, 0, false, 5, 0), 4, "answering everything costs nothing");
  assert.ok(rankScore(0, 0, false, 9, 1) > rankScore(0, 0, false, 1, 1), "one miss hurts less with a long record");
  assert.equal(rankFor({ evalRatingSum: 10, evalRatingCount: 2, verified: true, responseCount: 4, missedCount: 1 }), rankScore(10, 2, true, 4, 1));
  assert.equal(rankFor({}), 4);
});

test("ISO 25010: 8 characteristics, 31 items, weighted means and interpretation", () => {
  assert.equal(ISO25010.length, 8);
  assert.equal(ISO_ITEM_IDS.length, 31);
  assert.equal(new Set(ISO_ITEM_IDS).size, 31, "item ids are unique");
  const all = (x: number) => Object.fromEntries(ISO_ITEM_IDS.map((k) => [k, x]));
  const t = tabulate([all(5), all(4), { ...all(3), fs1: 5 }]);
  assert.equal(t.n, 3);
  assert.equal(t.characteristics[0].items[0].mean, 4.67, "fs1: (5+4+5)/3");
  assert.equal(t.characteristics[0].items[1].mean, 4, "fs2: (5+4+3)/3");
  assert.equal(t.characteristics[0].mean, 4.22, "mean of 4.67, 4, 4");
  assert.equal(interpret(4.21), "Excellent");
  assert.equal(interpret(4.2), "Very Good");
  assert.equal(interpret(3.41), "Very Good");
  assert.equal(interpret(2.61), "Good");
  assert.equal(interpret(1.81), "Fair");
  assert.equal(interpret(1.8), "Poor");
  assert.equal(tabulate([]).overall, 0);
  assert.match(toTsv(t), /^Indicator\tWeighted mean\tInterpretation\nFunctional suitability\t4\.22\tExcellent\n  Functional completeness\t4\.67\tExcellent/);
});

test("demo logins are kept off public text", () => {
  assert.equal(looksLikeSecret("Sample Account: Username: kmocampo@deped.gov.ph Password: 111111"), true);
  assert.equal(looksLikeSecret("admin: admin@c-point.com Admin123! employee: x"), true);
  assert.equal(looksLikeSecret("pwd=hunter2"), true);
  assert.equal(looksLikeSecret("A grading portal with password reset and an early warning system."), false);
  assert.equal(looksLikeSecret("Contact the team at team@school.edu.ph for a walkthrough."), false);
});

test("average, labels, staleness, ids", () => {
  assert.equal(average(0, 0), 0);
  assert.equal(average(14, 3), 4.7);
  assert.equal(responseLabel(undefined, 0), "new");
  assert.equal(responseLabel(1, 3), "hour");
  assert.equal(responseLabel(20, 3), "day");
  assert.equal(responseLabel(50, 3), "days");
  assert.equal(requestId("p1", "u1"), "p1_u1");
});

test("project status follows the accepted count, closed stays closed", () => {
  assert.equal(projectStatusFor("open", 5, 5), "filled");
  assert.equal(projectStatusFor("filled", 4, 5), "open");
  assert.equal(projectStatusFor("closed", 0, 5), "closed");
});

test("upload sniffing trusts bytes, not headers", () => {
  const b = (...x: number[]) => new Uint8Array([...x, ...new Array(16).fill(0)]);
  assert.equal(sniff(b(0xff, 0xd8, 0xff, 0xe0))?.ext, "jpg");
  assert.equal(sniff(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.ext, "png");
  assert.equal(sniff(b(0x25, 0x50, 0x44, 0x46, 0x2d))?.ext, "pdf");
  assert.equal(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))?.ext, "webp");
  assert.equal(sniff(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniff(new TextEncoder().encode("<html><script>")), null);
});

test("a rejected API field maps to its form label", () => {
  assert.equal(fieldKey("stack"), "fStack");
  assert.equal(fieldKey("categories"), "fCategories");
  assert.equal(fieldKey("skills"), "pSkills");
  assert.equal(fieldKey("nope"), null);
});
