// Pure business rules shared by the API routes, the Worker cron and tests.
// No Firebase imports here, so it runs anywhere (node:test, Workers, browser).

export const CATEGORIES = [
  "web",
  "mobile",
  "iot",
  "ai-ml",
  "database",
  "networking",
  "security",
  "ui-ux",
  "game",
  "health",
  "education",
  "business",
  "gov",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type RequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "completed" | "expired";
export type Side = "student" | "evaluator";
export type Action = "accept" | "decline" | "cancel" | "complete";

export interface RequestLike {
  status: RequestStatus;
  initiatedBy: Side;
  studentUid: string;
  evaluatorUid: string;
}

// Unanswered requests expire after 3 days so the student can ask someone else
// in time; the one who must answer gets a reminder email after 2.
export const PENDING_TTL_DAYS = 3;
export const REMIND_AFTER_DAYS = 2;
// An evaluator who lets this many invites in a row expire is set to Away (accepting off).
export const AWAY_AFTER = 2;

/** Which side the user is on in this request, or null if not a participant. */
export function sideOf(r: RequestLike, uid: string): Side | null {
  if (uid === r.studentUid) return "student";
  if (uid === r.evaluatorUid) return "evaluator";
  return null;
}

/**
 * Next status for an action, or an error code. The party who did not start the
 * request answers it. Either side can mark an accepted evaluation done: the
 * evaluator may not wait on a student who never confirms, because completion is
 * what obliges the student to rate them (a false "done" earns a low rating).
 */
export function transition(r: RequestLike, uid: string, action: Action): { ok: true; next: RequestStatus } | { ok: false; error: string } {
  const side = sideOf(r, uid);
  if (!side) return { ok: false, error: "not-participant" };
  const responder = side !== r.initiatedBy;
  switch (action) {
    case "accept":
    case "decline":
      if (r.status !== "pending") return { ok: false, error: "not-pending" };
      if (!responder) return { ok: false, error: "initiator-cannot-answer" };
      return { ok: true, next: action === "accept" ? "accepted" : "declined" };
    case "cancel":
      if (r.status === "pending" && !responder) return { ok: true, next: "cancelled" };
      if (r.status === "accepted") return { ok: true, next: "cancelled" };
      return { ok: false, error: "cannot-cancel" };
    case "complete":
      if (r.status !== "accepted") return { ok: false, error: "not-accepted" };
      return { ok: true, next: "completed" };
  }
}

/** Deterministic request id: one request per project and evaluator. */
export const requestId = (projectId: string, evaluatorUid: string) => `${projectId}_${evaluatorUid}`;

/** Deterministic review id: one review per request and direction. */
export const reviewId = (reqId: string, from: Side) => `${reqId}_${from}`;

/**
 * Ranking score: Bayesian average with a prior of 4.0 stars weighted as 3
 * reviews, so one 5-star review does not outrank twenty 4.8s. Invites the
 * evaluator let expire cost up to 0.5 through their answer rate, smoothed so a
 * new evaluator starts at 100%: a silent account sinks below active ones.
 */
export function rankScore(sum: number, count: number, verified: boolean, answered = 0, missed = 0): number {
  const PRIOR = 4.0;
  const WEIGHT = 3;
  const bayes = (sum + PRIOR * WEIGHT) / (count + WEIGHT);
  const answerRate = (answered + 1) / (answered + missed + 1);
  return Math.round((bayes + (verified ? 0.25 : 0) - 0.5 * (1 - answerRate)) * 1000) / 1000;
}

/** Rank from a stored profile's fields (spread the doc, then override what changes). */
export function rankFor(p: { evalRatingSum?: number; evalRatingCount?: number; verified?: boolean; responseCount?: number; missedCount?: number }) {
  return rankScore(p.evalRatingSum ?? 0, p.evalRatingCount ?? 0, p.verified === true, p.responseCount ?? 0, p.missedCount ?? 0);
}

/**
 * True when public text looks like it carries a login ("Password: 1234",
 * "admin@site.com Admin123!"). Demo logins belong in the chat once a request
 * is accepted, never on a public project page.
 */
export function looksLikeSecret(s: string): boolean {
  return /\b(user ?name|pass(word|wd|code)?|pwd)\s*[:=]/i.test(s) || /[\w.+-]+@[\w-]+(\.[\w-]+)+\s+\S*\d\S*/.test(s);
}

export function average(sum: number, count: number): number {
  return count ? Math.round((sum / count) * 10) / 10 : 0;
}

/** Marketplace-style responsiveness label key from average response hours. */
export function responseLabel(avgHours: number | undefined, count: number): "hour" | "day" | "days" | "new" {
  if (!count || avgHours === undefined) return "new";
  if (avgHours <= 2) return "hour";
  if (avgHours <= 24) return "day";
  return "days";
}

/** True when a pending request is old enough for the cron to expire it. */
export function isStale(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs > PENDING_TTL_DAYS * 24 * 3600 * 1000;
}

/** Project status after the accepted count changes. Closed stays closed. */
export function projectStatusFor(current: "open" | "filled" | "closed", accepted: number, needed: number) {
  if (current === "closed") return "closed";
  return accepted >= needed ? "filled" : "open";
}
