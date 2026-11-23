// Visit counting (src/lib/analytics.ts): the day a visit lands on, the fixed names it is counted under,
// and the numbers the admin Analytics tab is built from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKey, deviceOf, pageOf, SINCE, sourceOf, summarize, windowOf, type Counts, type Thread } from "../src/lib/analytics.ts";
import { visitSchema } from "../src/lib/schemas.ts";

const at = (iso: string) => Date.parse(iso);

test("a visit counts for the calendar day in Manila, not in UTC", () => {
  assert.equal(dayKey(at("2026-11-24T15:59:59Z")), "2026-11-24", "11:59 PM in Manila");
  assert.equal(dayKey(at("2026-11-24T16:00:00Z")), "2026-11-25", "midnight in Manila");
  assert.equal(dayKey(at("2026-12-31T20:00:00Z")), "2027-01-01");
});

test("the window is the last 30 Manila days and never opens before counting began", () => {
  const first = windowOf(at(`${SINCE}T04:00:00Z`));
  assert.deepEqual([first.keys.length, first.keys[29], first.open], [30, SINCE, SINCE]);
  assert.equal(first.from, at(`${SINCE}T00:00:00+08:00`));
  const later = windowOf(at("2027-03-10T04:00:00Z"));
  assert.deepEqual([later.keys[0], later.keys[29], later.open], ["2027-02-09", "2027-03-10", "2027-02-09"]);
});

test("paths fold into page groups, so no profile, project or request id is ever sent", () => {
  const cases: [string, string][] = [
    ["/", "home"], ["/evaluators", "evaluators"], ["/e/7Hq2abcUID", "evaluator"], ["/projects", "projects"], ["/p/abc123", "project"],
    ["/p/abc123/results", "results"], ["/login", "login"], ["/me", "me"], ["/me/projects/new", "post"], ["/me/projects/abc123/edit", "post"],
    ["/inbox/abc123_uid", "inbox"], ["/inbox/abc123_uid/evaluate", "evaluate"], ["/inbox/abc123_uid/certificate", "certificate"],
    ["/c/abc123_uid", "check"], ["/privacy", "privacy"], ["/admin", "other"], ["/no/such/page", "other"],
  ];
  for (const [path, page] of cases) assert.equal(pageOf(path), page, path);
});

test("the source is our own tag first, then the app that opened the page, then the referrer", () => {
  const HOST = "panelista.vercel.app";
  const CHROME = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  const src = (search = "", referrer = "", ua = CHROME) => sourceOf(search, referrer, ua, HOST);

  assert.equal(src(), "direct");
  assert.equal(src("", `https://${HOST}/evaluators`), "direct", "our own pages are not a source");
  assert.equal(src("", "not a url"), "direct");

  assert.equal(src("?utm_source=tiktok"), "tiktok");
  assert.equal(src("?utm_source=FB-group"), "facebook");
  assert.equal(src("?utm_source=msgr"), "messenger");
  assert.equal(src("?utm_source=newsletter"), "other");
  assert.equal(src("?utm_source=tiktok", "https://l.facebook.com/"), "tiktok", "the tag wins over the referrer");

  assert.equal(src("", "", `${CHROME} [FB_IAB/FB4A;FBAV/480.0.0.54.88;]`), "facebook", "Facebook's in-app browser, no referrer");
  assert.equal(src("", "", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0.0;]"), "messenger");
  assert.equal(src("", "", `${CHROME} [FB_IAB/Orca-Android;FBAV/470.0.0.20.103;]`), "messenger");
  assert.equal(src("", "", `${CHROME} trill_2024101030 BytedanceWebview/d8a21c6`), "tiktok", "TikTok's app in the Philippines");

  assert.equal(src("?fbclid=IwAR0abc"), "facebook", "a Facebook link opened in the phone's own browser");
  assert.equal(src("", "https://l.facebook.com/"), "facebook");
  assert.equal(src("", "https://l.messenger.com/"), "messenger");
  assert.equal(src("", "android-app://com.facebook.orca/"), "messenger");
  assert.equal(src("", "https://www.tiktok.com/"), "tiktok");
  assert.equal(src("", "https://www.google.com.ph/"), "google");
  assert.equal(src("", "android-app://com.google.android.googlequicksearchbox/"), "google");
  assert.equal(src("", "https://mail.google.com/"), "other", "a link in an email is not a search");
  assert.equal(src("", "https://www.linkedin.com/"), "other");
});

test("device: from the screen and the pointer, with no user agent", () => {
  assert.equal(deviceOf(390, true), "phone");
  assert.equal(deviceOf(820, true), "tablet");
  assert.equal(deviceOf(1080, false), "desktop");
  assert.equal(deviceOf(400, false), "desktop", "a small window with a mouse");
});

test("the beacon carries whitelisted names only: no path, id, address or free text gets through", () => {
  const ok = (x: unknown) => visitSchema.safeParse(x).success;
  assert.ok(ok({ page: "home" }));
  assert.ok(ok({ page: "evaluator", entry: { source: "facebook", device: "phone" } }));
  assert.equal(ok({ page: "/e/7Hq2abcUID" }), false);
  assert.equal(ok({ page: "home", entry: { source: "l.facebook.com", device: "phone" } }), false);
  assert.equal(ok({ page: "home", entry: { source: "facebook", device: "iPhone 16" } }), false);
  assert.equal(ok({ page: "home", entry: { source: "facebook" } }), false);
  assert.equal(ok({}), false);
  // Anything extra is dropped before it could reach Firestore.
  assert.deepEqual(visitSchema.parse({ page: "home", uid: "u1", ua: "Mozilla", entry: { source: "direct", device: "desktop", ip: "203.0.113.7" } }), {
    page: "home",
    entry: { source: "direct", device: "desktop" },
  });
});

test("summarize: visits from the daily stats, the funnel and active people from requests, rates from the all-time counts", () => {
  const now = at("2026-12-10T04:00:00Z"); // noon in Manila
  const ago = (days: number) => now - days * 864e5;
  const counts: Counts = { profiles: 40, newProfiles: 6, evaluators: 12, projects: 9, requests: 20, completed: 5, reviews: 7, errors: 3, errors7: 1, answered: 9, missed: 3 };
  const thread = (over: Partial<Thread>): Thread => ({
    studentUid: "s1", evaluatorUid: "e1", initiatedBy: "student", status: "pending", createdAt: ago(1), lastMessageAt: ago(1), lastSender: "s1", reviewedByStudent: false, ...over,
  });
  const threads = [
    thread({}), // sent yesterday, not answered
    thread({ evaluatorUid: "e2", status: "declined", createdAt: ago(5), respondedAt: ago(4), lastMessageAt: ago(4), lastSender: "e2" }),
    thread({ studentUid: "s2", evaluatorUid: "e3", status: "completed", createdAt: ago(12), respondedAt: ago(11), completedAt: ago(9), lastMessageAt: ago(9), lastSender: "e3", reviewedByStudent: true }),
    // An offer from before counting began, accepted by the student and finished inside the window, not rated yet.
    thread({ studentUid: "s3", evaluatorUid: "e1", initiatedBy: "evaluator", status: "completed", createdAt: ago(25), respondedAt: ago(20), completedAt: ago(10), lastMessageAt: ago(10), lastSender: "s3" }),
    // Expired: the evaluator never did anything, so they are not active.
    thread({ studentUid: "s4", evaluatorUid: "e4", status: "expired", createdAt: ago(6), lastMessageAt: ago(3), lastSender: "" }),
  ];
  const s = summarize(
    {
      stats: {
        "2026-12-10": { visits: 4, pages: { home: 4, evaluators: 2 }, sources: { facebook: 3, direct: 1 }, devices: { phone: 4 } },
        "2026-12-05": { visits: 6, pages: { home: 5, evaluator: 3 }, sources: { facebook: 2, tiktok: 4 }, devices: { phone: 5, desktop: 1 } },
        "2026-11-25": { visits: 10, pages: { home: 10 }, sources: { google: 10 }, devices: { desktop: 10 } },
      },
      accounts: [ago(40), ago(15), ago(2), ago(1)],
      threads,
      counts,
    },
    now,
  );

  assert.deepEqual(s.visits, { today: 4, d7: 10, d30: 20 });
  assert.equal(s.days.length, 30);
  assert.deepEqual(s.days[29], { date: "2026-12-10", visits: 4 });
  assert.deepEqual(s.days[28], { date: "2026-12-09", visits: 0 }, "a day with no visits is a zero, not a gap");
  assert.deepEqual(s.pages, [
    { id: "home", today: 4, d7: 9, d30: 19 },
    { id: "evaluator", today: 0, d7: 3, d30: 3 },
    { id: "evaluators", today: 2, d7: 2, d30: 2 },
  ], "busiest first, and groups nobody opened are left out");
  assert.deepEqual(s.sources.slice(0, 3), [{ id: "google", n: 10 }, { id: "facebook", n: 5 }, { id: "tiktok", n: 4 }]);
  assert.deepEqual(s.devices, [{ id: "desktop", n: 11 }, { id: "phone", n: 9 }, { id: "tablet", n: 0 }]);

  // Counting began on SINCE (16 days before `now`), so the window is those 17 days: the account from 40 days ago
  // and the offer made 25 days ago are outside it, the acceptance 20 days ago too.
  assert.deepEqual([s.since, s.windowDays], [SINCE, 17]);
  assert.deepEqual(Object.fromEntries(s.funnel.map((f) => [f.id, f.n])), { visits: 20, signups: 3, profiles: 6, requests: 4, accepted: 1, completed: 2, rated: 1 });

  assert.deepEqual(s.rates, { completion: 5 / 20, answer: 9 / 12 });
  // 7 days: s1 sent, e2 declined, s4 sent. 30 days adds s2 and s3 (accepted an offer), e3, and e1 (made that offer).
  assert.deepEqual(s.active, { students7: 2, students30: 4, evaluators7: 1, evaluators30: 3 });
  assert.deepEqual(s.totals, { accounts: 4, profiles: 40, evaluators: 12, projects: 9, requests: 20, completed: 5, reviews: 7, errors: 3, errors7: 1 });

  const empty = summarize({ stats: {}, accounts: [], threads: [], counts: { ...counts, requests: 0, completed: 0, answered: 0, missed: 0 } }, now);
  assert.deepEqual(empty.rates, { completion: null, answer: null }, "nothing to divide by yet is not 0%");
  assert.deepEqual([empty.visits.d30, empty.pages.length], [0, 0]);
});
