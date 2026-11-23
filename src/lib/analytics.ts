// Visit counting and the numbers on the admin Analytics tab. Pure: no Firebase and no browser APIs, so the
// beacon (src/lib/firebase.ts), the route (src/app/api/visits) and the tests all run the same code.
import type { RequestStatus, Side } from "./domain";

// The only names a beacon may carry. The server refuses anything else (visitSchema), so a day's stats hold
// counts under these names and never a URL, an id or anything a browser typed.
export const PAGES = ["home", "evaluators", "evaluator", "projects", "project", "results", "login", "me", "post", "inbox", "evaluate", "certificate", "check", "privacy", "other"] as const;
export const SOURCES = ["facebook", "messenger", "tiktok", "google", "direct", "other"] as const;
export const DEVICES = ["phone", "tablet", "desktop"] as const;
export type Page = (typeof PAGES)[number];
export type Source = (typeof SOURCES)[number];
export type Device = (typeof DEVICES)[number];

const DAY = 864e5;
// The day visit counting went live. The counted window never opens before it: sign-ups from days that
// have no visit counts would make the first step of the funnel look better than it was.
export const SINCE = "2026-11-24";

/** The calendar day in the Philippines (UTC+8, no daylight saving) as YYYY-MM-DD, so an 11 PM visit counts for that day. */
export const dayKey = (ms = Date.now()) => new Date(ms + 8 * 36e5).toISOString().slice(0, 10);

/** The last 30 Manila days, oldest first, and the day and instant the counted window opens. */
export function windowOf(now = Date.now()) {
  const keys = Array.from({ length: 30 }, (_, i) => dayKey(now - (29 - i) * DAY));
  const open = keys.find((k) => k >= SINCE) ?? keys[29];
  return { keys, open, from: Date.parse(`${open}T00:00:00+08:00`) };
}

const ROUTES: [RegExp, Page][] = [
  [/^\/$/, "home"],
  [/^\/evaluators$/, "evaluators"],
  [/^\/e\/[^/]+$/, "evaluator"],
  [/^\/projects$/, "projects"],
  [/^\/p\/[^/]+$/, "project"],
  [/^\/p\/[^/]+\/results$/, "results"],
  [/^\/login$/, "login"],
  [/^\/me$/, "me"],
  [/^\/me\/projects\//, "post"],
  [/^\/inbox\/[^/]+$/, "inbox"],
  [/^\/inbox\/[^/]+\/evaluate$/, "evaluate"],
  [/^\/inbox\/[^/]+\/certificate$/, "certificate"],
  [/^\/c\/[^/]+$/, "check"],
  [/^\/privacy$/, "privacy"],
];

/** The group a path is counted under. Profile, project and request ids stay in the browser. */
export const pageOf = (path: string): Page => ROUTES.find(([re]) => re.test(path))?.[1] ?? "other";

// One matcher for our own utm_source tags ("fb", "FB-group", "msgr"), referrer hosts ("l.facebook.com",
// "com.facebook.orca") and in-app browser user agents ("FBAN/FBIOS", "musical_ly", "trill_": TikTok in Asia).
// Messenger comes first: its in-app browser carries Facebook's FBAV too. Mail and other Google hosts are not a search.
function named(s: string): Source {
  if (/messenger|msgr|\borca\b/i.test(s)) return "messenger";
  if (/facebook|^fb|fban|fbav|fb_iab/i.test(s)) return "facebook";
  if (/tiktok|musical_?ly|trill_|ugc\.trill|bytedance/i.test(s)) return "tiktok";
  if (/^(www\.)?google([._-]|$)|googlequicksearchbox/i.test(s)) return "google";
  return "other";
}

/**
 * Where a visit came from. Our own tag wins, then the app whose in-app browser opened the page (those
 * often send no referrer), then Facebook's click id, then the referrer. Nothing of the above: direct.
 */
export function sourceOf(search: string, referrer: string, userAgent: string, host: string): Source {
  const query = new URLSearchParams(search);
  const tag = query.get("utm_source");
  if (tag) return named(tag);
  const app = named(userAgent);
  if (app !== "other") return app;
  if (query.has("fbclid")) return "facebook";
  let from = "";
  try {
    from = new URL(referrer).host;
  } catch {}
  return !from || from === host ? "direct" : named(from);
}

/** Phone, tablet or desktop from the screen's short side (CSS px) and whether the main pointer is a finger. No user agent needed. */
export const deviceOf = (shortSide: number, touch: boolean): Device => (!touch ? "desktop" : shortSide < 600 ? "phone" : "tablet");

/** One day's counters: everything a stats/{YYYY-MM-DD} document holds. */
export interface DayStats {
  /** Browser sessions that began that day. */
  visits?: number;
  /** Sessions that opened each page group. */
  pages?: Partial<Record<Page, number>>;
  /** Where the sessions came from, and on what. */
  sources?: Partial<Record<Source, number>>;
  devices?: Partial<Record<Device, number>>;
}

/** A request with something happening in the last 30 days. Times are in ms. */
export interface Thread {
  studentUid: string;
  evaluatorUid: string;
  initiatedBy: Side;
  status: RequestStatus;
  createdAt: number;
  respondedAt?: number;
  completedAt?: number;
  lastMessageAt: number;
  lastSender: string;
  reviewedByStudent: boolean;
}

/** All-time counts, except `newProfiles` (made inside the window) and `errors7` (the last 7 days). */
export interface Counts {
  profiles: number;
  newProfiles: number;
  evaluators: number;
  projects: number;
  requests: number;
  completed: number;
  reviews: number;
  errors: number;
  errors7: number;
  /** Invites evaluators answered and invites they let expire, summed over every profile. */
  answered: number;
  missed: number;
}

const ratio = (part: number, whole: number) => (whole ? part / whole : null);

/**
 * Everything the admin Analytics tab shows. Visits come from the daily stats; the funnel, the active
 * counts and the totals from what the app already stores, so nothing extra is written for them.
 */
export function summarize(d: { stats: Record<string, DayStats | undefined>; accounts: number[]; threads: Thread[]; counts: Counts }, now = Date.now()) {
  const { keys, open, from } = windowOf(now);
  const c = d.counts;
  /** One counter added up over the last `days` days. */
  const over = (days: number, pick: (s: DayStats) => number | undefined) => keys.slice(-days).reduce((sum, k) => sum + (pick(d.stats[k] ?? {}) ?? 0), 0);
  const inWindow = (at?: number) => at !== undefined && at >= from;
  const done = d.threads.filter((t) => inWindow(t.completedAt));

  /** People on one side who did something in a request lately: started it, answered it, or were the last to write or act in it. */
  const active = (side: Side, days: number) => {
    const cut = now - days * DAY;
    const who = new Set<string>();
    for (const t of d.threads) {
      const uid = side === "student" ? t.studentUid : t.evaluatorUid;
      const acts = [t.initiatedBy === side ? t.createdAt : t.respondedAt, t.lastSender === uid ? t.lastMessageAt : undefined];
      if (acts.some((at) => at !== undefined && at >= cut)) who.add(uid);
    }
    return who.size;
  };

  return {
    /** The first day the window covers, and how many days that makes (30 once counting is a month old). */
    since: open,
    windowDays: 30 - keys.indexOf(open),
    days: keys.map((date) => ({ date, visits: d.stats[date]?.visits ?? 0 })),
    visits: { today: over(1, (s) => s.visits), d7: over(7, (s) => s.visits), d30: over(30, (s) => s.visits) },
    pages: PAGES.map((id) => ({ id, today: over(1, (s) => s.pages?.[id]), d7: over(7, (s) => s.pages?.[id]), d30: over(30, (s) => s.pages?.[id]) }))
      .filter((p) => p.d30)
      .sort((a, b) => b.d30 - a.d30),
    sources: SOURCES.map((id) => ({ id, n: over(30, (s) => s.sources?.[id]) })).sort((a, b) => b.n - a.n),
    devices: DEVICES.map((id) => ({ id, n: over(30, (s) => s.devices?.[id]) })).sort((a, b) => b.n - a.n),
    // Each step counts what happened inside the window. "rated" is the share of the window's completed requests the student has rated.
    funnel: [
      { id: "visits", n: over(30, (s) => s.visits) },
      { id: "signups", n: d.accounts.filter((at) => inWindow(at)).length },
      { id: "profiles", n: c.newProfiles },
      { id: "requests", n: d.threads.filter((t) => inWindow(t.createdAt)).length },
      // An answer that was not a decline: accepted, and maybe completed or cancelled since.
      { id: "accepted", n: d.threads.filter((t) => inWindow(t.respondedAt) && t.status !== "declined").length },
      { id: "completed", n: done.length },
      { id: "rated", n: done.filter((t) => t.reviewedByStudent).length },
    ],
    // All time. Null when there is nothing to divide by yet.
    rates: { completion: ratio(c.completed, c.requests), answer: ratio(c.answered, c.answered + c.missed) },
    active: { students7: active("student", 7), students30: active("student", 30), evaluators7: active("evaluator", 7), evaluators30: active("evaluator", 30) },
    totals: { accounts: d.accounts.length, profiles: c.profiles, evaluators: c.evaluators, projects: c.projects, requests: c.requests, completed: c.completed, reviews: c.reviews, errors: c.errors, errors7: c.errors7 },
  };
}

export type Summary = ReturnType<typeof summarize>;
