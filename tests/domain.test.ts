// Request rules, ranking and copy checks beyond tests/logic.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlineEnd, identityChanged, looksLikeSecret, rankScore, requestId, reviewId, safePhoto, sideOf, transition, type Action, type RequestLike, type RequestStatus, type Side } from "../src/lib/domain.ts";
import { safeNext } from "../src/lib/signin.ts";
import { errorKey, STRINGS, translate } from "../src/lib/i18n.ts";
import { ISO_ITEM_IDS, tabulate, toTsv } from "../src/lib/iso25010.ts";
import { sniff } from "../worker/src/sniff.ts";

const STATUSES: RequestStatus[] = ["pending", "accepted", "declined", "cancelled", "completed", "expired"];
const ACTIONS: Action[] = ["accept", "decline", "cancel", "complete"];
const SIDES: Side[] = ["student", "evaluator"];

test("the whole request state machine: 6 statuses x 2 initiators x 3 callers x 4 actions", () => {
  // The spec, written out independently of transition(): everything not listed is refused.
  const allowed = (status: RequestStatus, responder: boolean, action: Action): RequestStatus | null => {
    if (status === "pending") {
      if (responder && action === "accept") return "accepted";
      if (responder && action === "decline") return "declined";
      if (!responder && action === "cancel") return "cancelled";
    }
    if (status === "accepted") {
      if (action === "complete") return "completed";
      if (action === "cancel") return "cancelled";
    }
    return null;
  };
  let checked = 0;
  for (const status of STATUSES)
    for (const initiatedBy of SIDES)
      for (const action of ACTIONS) {
        const r: RequestLike = { status, initiatedBy, studentUid: "S", evaluatorUid: "E" };
        for (const [uid, side] of [["S", "student"], ["E", "evaluator"]] as const) {
          const want = allowed(status, side !== initiatedBy, action);
          const got = transition(r, uid, action);
          assert.deepEqual(got.ok ? got.next : null, want, `${status}, started by ${initiatedBy}: ${side} tries ${action}`);
          checked++;
        }
        assert.deepEqual(transition(r, "X", action), { ok: false, error: "not-participant" }, `${status}: a stranger tries ${action}`);
        checked++;
      }
  assert.equal(checked, 144);
});

test("refusals say why", () => {
  const r: RequestLike = { status: "pending", initiatedBy: "student", studentUid: "S", evaluatorUid: "E" };
  assert.deepEqual(transition(r, "S", "accept"), { ok: false, error: "initiator-cannot-answer" });
  assert.deepEqual(transition(r, "E", "cancel"), { ok: false, error: "cannot-cancel" });
  assert.deepEqual(transition(r, "E", "complete"), { ok: false, error: "not-accepted" });
  assert.deepEqual(transition({ ...r, status: "expired" }, "E", "accept"), { ok: false, error: "not-pending" });
});

test("sides and ids", () => {
  const r: RequestLike = { status: "pending", initiatedBy: "student", studentUid: "S", evaluatorUid: "E" };
  assert.equal(sideOf(r, "S"), "student");
  assert.equal(sideOf(r, "E"), "evaluator");
  assert.equal(sideOf(r, ""), null);
  assert.equal(sideOf(r, "s"), null, "uids are case sensitive");
  assert.equal(reviewId(requestId("p1", "E"), "student"), "p1_E_student");
  assert.notEqual(reviewId("p1_E", "student"), reviewId("p1_E", "evaluator"), "one review per direction");
});

test("the Verified badge vouches for name, headline, link and years: a change in any of them is an identity change", () => {
  // Also the gate on approving: an application is compared with the profile as it is at approval time.
  const applied = { name: "Ana Reyes", headline: "QA Engineer", linkedin: "https://linkedin.com/in/ana", yearsExp: 5, note: "COE attached", status: "pending" };
  const now = { name: "Ana Reyes", headline: "QA Engineer", linkedin: "https://linkedin.com/in/ana", yearsExp: 5, bio: "new bio", titles: ["CTO"], skills: ["Go"], city: "Cebu", accepting: false };
  assert.equal(identityChanged(applied, now), false, "bio, titles, skills and settings are not identity");
  for (const patch of [{ name: "Dr. Ana Reyes" }, { headline: "CTO at Google" }, { linkedin: "https://linkedin.com/in/someone-else" }, { linkedin: "" }, { yearsExp: 15 }, { yearsExp: "5" }])
    assert.equal(identityChanged(applied, { ...now, ...patch }), true, JSON.stringify(patch));
  assert.equal(identityChanged({ name: "Ana" }, { name: "Ana", headline: "", linkedin: "", yearsExp: 0 }), false, "a missing field reads as empty");
  assert.equal(identityChanged({}, {}), false);
});

test("rank stays inside its band and never rewards a miss", () => {
  for (const [sum, count] of [[0, 0], [5, 1], [1, 1], [500, 100], [100, 100]] as const)
    for (const verified of [true, false])
      for (const [answered, missed] of [[0, 0], [10, 0], [0, 10], [3, 7]] as const) {
        const s = rankScore(sum, count, verified, answered, missed);
        assert.ok(s >= 0.5 && s <= 5.25, `${s} for ${sum}/${count}`);
        assert.ok(rankScore(sum, count, verified, answered, missed + 1) < s, "one more expired invite always costs something");
        assert.ok(rankScore(sum, count, verified, answered + 1, missed) >= s, "one more answer never costs anything");
      }
  assert.ok(rankScore(25, 5, false) > rankScore(5, 5, false), "better ratings rank higher");
});

test("demo-login detection: more shapes, and words that only contain 'pass'", () => {
  for (const s of ["username = admin", "User name: juan", "passcode: 1234", "PASSWORD=Admin123", "pass: 1234", "login with admin@demo.com admin123"]) assert.equal(looksLikeSecret(s), true, s);
  for (const s of ["It can bypass: nothing.", "A compass = a tool for directions", "Students log in with a password they choose.", "Uses username and password login", "Ask us at team@school.edu.ph"]) assert.equal(looksLikeSecret(s), false, s);
});

test("ISO 25010 table: unanswered items are left out of a mean, the TSV has one row per line of the table", () => {
  const all = (x: number) => Object.fromEntries(ISO_ITEM_IDS.map((k) => [k, x]));
  const { fs1: _skip, ...partial } = all(2);
  void _skip;
  const t = tabulate([all(4), partial]);
  assert.equal(t.n, 2);
  assert.equal(t.characteristics[0].items[0].mean, 4, "fs1: only the one evaluator who answered counts");
  assert.equal(t.characteristics[0].items[1].mean, 3, "fs2: (4+2)/2");
  for (const c of tabulate([all(5)]).characteristics) assert.equal(c.mean, 5);
  assert.equal(tabulate([all(1)]).overall, 1);
  const lines = toTsv(t).split("\n");
  assert.equal(lines.length, 1 + 8 + 31 + 1, "header, 8 characteristics, 31 items, overall");
  assert.match(lines.at(-1)!, /^Overall\t\d\.\d\d\t\w/);
  for (const l of lines) assert.equal(l.split("\t").length, 3);
});

test("copy: both languages for every string, the same variables in each, no em dash", () => {
  for (const [key, pair] of Object.entries(STRINGS)) {
    const [tl, en] = pair as readonly [string, string];
    assert.ok(tl.trim() && en.trim(), `${key} has both languages`);
    assert.equal(/—/.test(tl + en), false, `${key} has no em dash`);
    // {s} is the plural helper, which Taglish often does not need.
    const vars = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].filter((v) => v !== "{s}").sort();
    assert.deepEqual(vars(tl), vars(en), `${key} uses the same variables in both languages`);
  }
  assert.equal(translate("tl", "waitingFor", { name: "Ana" }), "Waiting pa sa sagot ni Ana.");
  assert.equal(translate("en", "isoMissing", { n: 3 }), "3 items still need a rating.");
  assert.equal(translate("tl", "belowMinYears", { n: 1, m: 0 }), "Need po dito ng 1+ yr exp, at 0 po ang nasa profile niyo.");
});

test("API error codes map to a message, unknown ones to the generic one", () => {
  for (const code of ["rate-limited", "review-pending", "evaluator-full", "evaluator-busy", "exists", "declined-before", "below-min-years", "project-not-open", "no-profile", "deadline-past", "secret-in-public", "needed-below-accepted", "evaluation-locked", "already-reviewed", "not-evaluator", "not-found", "verify-email", "invalid", "self"])
    assert.equal(errorKey(code), `e_${code}`, code);
  assert.equal(errorKey("something-new"), "e_generic");
  assert.equal(errorKey("__proto__"), "e_generic");
});

test("upload sniffing: short, truncated and look-alike files are not a known type", () => {
  assert.equal(sniff(new Uint8Array([])), null);
  assert.equal(sniff(new Uint8Array([0xff, 0xd8])), null, "two bytes of a JPEG header");
  assert.equal(sniff(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])), null, "RIFF but WAVE, not WEBP");
  assert.equal(sniff(new TextEncoder().encode("%PDF")), null, "needs the dash of %PDF-");
  assert.equal(sniff(new TextEncoder().encode("GIF89a")), null, "GIF is not accepted");
  assert.equal(sniff(new TextEncoder().encode("PK\u0003\u0004 docx or zip")), null);
  assert.equal(sniff(new TextEncoder().encode("<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'>")), null);
  assert.deepEqual(sniff(new TextEncoder().encode("%PDF-1.7 <script>alert(1)</script>")), { type: "application/pdf", ext: "pdf" }, "served as a PDF, never as HTML");
});

test("a deadline is the last second of that day in the Philippines, whatever the server's time zone", () => {
  assert.equal(deadlineEnd("2026-11-22").toISOString(), "2026-11-22T15:59:59.000Z");
  assert.equal(deadlineEnd("2027-01-01").toISOString(), "2027-01-01T15:59:59.000Z");
  // 03:30 on the 23rd in Manila is still the 22nd in UTC: the 22nd is over there, and the old UTC check let it through.
  const now = Date.parse("2026-11-22T19:30:00Z");
  assert.ok(deadlineEnd("2026-11-22").getTime() < now, "yesterday in Manila is past");
  assert.ok(deadlineEnd("2026-11-23").getTime() > now, "today in Manila is still open until midnight there");
});

test("only a Google account photo is kept as an avatar", () => {
  const google = "https://lh3.googleusercontent.com/a/ACg8ocK-abc=s96-c";
  assert.equal(safePhoto(google), google);
  // The photo in a sign-in token is whatever the user last set with updateProfile().
  for (const bad of [undefined, null, "", 5, "https://evil.example/track.gif", "http://lh3.googleusercontent.com/a/x", "https://lh3.googleusercontent.com.evil.example/a", "https://lh3.googleusercontent.com", "data:image/svg+xml,<svg onload=alert(1)>", "javascript:alert(1)", " https://lh3.googleusercontent.com/a/x"])
    assert.equal(safePhoto(bad), "", String(bad));
});

test("after sign-in: ?next= only ever leads to a path on this site", () => {
  const site = "https://panelista.vercel.app";
  const go = (raw: string | null) => safeNext(raw, site);
  assert.equal(go(null), "/me");
  assert.equal(go(""), "/me");
  assert.equal(go("/inbox/p1_E?tab=chat"), "/inbox/p1_E?tab=chat");
  assert.equal(go("/p/abc"), "/p/abc");
  for (const raw of ["https://evil.example/", "//evil.example", "/\\evil.example", "\\\\evil.example", "javascript:alert(1)", "data:text/html,x", "https://panelista.vercel.app.evil.example/", "https://panelista.vercel.app@evil.example/"])
    assert.equal(go(raw), "/me", raw);
  // Same origin, but the path itself starts with "//": handed to the router it means another host.
  for (const raw of ["https://panelista.vercel.app//evil.example", "/x/..//evil.example", "/\t/evil.example", "https://panelista.vercel.app///evil.example/a?b=1"]) {
    const next = go(raw);
    assert.equal(new URL(next, `${site}/login`).origin, site, `${raw} -> ${next}`);
    assert.match(next, /^\/(?!\/)/, raw);
  }
  assert.equal(go("https://panelista.vercel.app//evil.example"), "/evil.example");
});
