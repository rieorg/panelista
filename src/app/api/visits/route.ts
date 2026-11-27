import { AggregateField, Timestamp, type Query } from "@/lib/firestore";
import { adminAuth, body, db, FieldValue, HttpError, memo, requireAdmin, route } from "@/lib/server";
import { visitSchema } from "@/lib/schemas";
import { dayKey, summarize, windowOf, type DayStats, type Thread } from "@/lib/analytics";

// First-party visit counts. A beacon adds to ONE document per Manila day, stats/{YYYY-MM-DD}: there is no
// document per visit, and nothing in it but counters under the fixed names in src/lib/analytics.ts.
// No cookie, account, address or user agent is stored, in the stats or anywhere else.

const DAY = 864e5;
// No login and no App Check on the beacon (a visitor reading a cached page never runs Turnstile), so two
// ceilings stand in, both without the Firestore rate limiter: that one costs a read and a write of its own
// per call, which would triple the writes of every page view.
// All beacons in a day: a quarter of Firestore's free 20,000 daily writes, whoever is sending them.
const PER_DAY = 5000;
// One address in a day, so a single sender cannot fill the day alone. Counted in this server instance's
// memory, which is why no address is ever written down.
// ponytail: every instance counts on its own, so a patient sender gets this much from each; PER_DAY is the hard stop.
const PER_ADDRESS = 300;
const byAddress = new Map<string, number>();
let addressDay = "";

// Beacons counted so far today, read at most once a minute per instance. Past the ceiling, the rest of the
// day costs no reads and no writes. ponytail: the ceiling can be passed by up to a minute of traffic.
const countedToday = memo(60_000, async () => {
  const day = dayKey();
  const pages = ((await db().doc(`stats/${day}`).get()).get("pages") ?? {}) as Record<string, number>;
  return { day, n: Object.values(pages).reduce((sum, n) => sum + n, 0) };
});

export const POST = route(
  async (req) => {
    const { page, entry } = visitSchema.parse(await body(req));
    const day = dayKey();
    if (day !== addressDay) {
      byAddress.clear();
      addressDay = day;
    }
    const counted = await countedToday();
    const address = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    const mine = (byAddress.get(address) ?? 0) + 1;
    if ((counted.day === day && counted.n >= PER_DAY) || mine > PER_ADDRESS) throw new HttpError(429, "rate-limited");
    byAddress.set(address, mine);

    const one = FieldValue.increment(1);
    await db()
      .doc(`stats/${day}`)
      .set({ pages: { [page]: one }, ...(entry ? { visits: one, sources: { [entry.source]: one }, devices: { [entry.device]: one } } : {}) }, { merge: true });
  },
  { appCheck: false },
);

// What the numbers need from a request, and nothing that says what was written in it.
const THREAD_FIELDS = ["studentUid", "evaluatorUid", "initiatedBy", "status", "createdAt", "respondedAt", "completedAt", "lastMessageAt", "lastSender", "reviewedByStudent"];
const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : undefined);
const count = async (q: Query) => (await q.count().get()).data().count;
// One field per query: a query that sums two fields only looks at documents that have both, and most profiles have no missedCount.
const sum = async (field: string) => (await db().collection("profiles").aggregate({ n: AggregateField.sum(field) }).get()).data().n;

/** When each sign-in account was made. ponytail: one Auth call per 1000 accounts on every load; keep a counter instead past 20,000 or so. */
async function accountTimes() {
  const times: number[] = [];
  let next: string | undefined;
  do {
    const batch = await adminAuth().listUsers(1000, next);
    for (const u of batch.users) times.push(Date.parse(u.metadata.creationTime));
    next = batch.pageToken;
  } while (next);
  return times;
}

// The admin Analytics tab (src/app/admin/analytics.tsx). The funnel and the totals come from what the app already
// stores, as count() and sum() queries that cost one read per 1000 matches. The only documents read are the 30 daily
// stats and the requests that moved in the last 30 days. Every query here runs on the automatic single-field indexes.
export const GET = route(async (req) => {
  await requireAdmin(req);
  const now = Date.now();
  const { keys, from } = windowOf(now);
  const col = (name: string) => db().collection(name);
  const [days, accounts, moved, answered, missed, profiles, newProfiles, evaluators, projects, requests, completed, reviews, errors, errors7] = await Promise.all([
    db().getAll(...keys.map((k) => db().doc(`stats/${k}`))),
    accountTimes(),
    // ponytail: past 1000 requests moving in a month, the funnel and the active counts read low; page this then.
    col("requests").where("lastMessageAt", ">=", new Date(now - 30 * DAY)).orderBy("lastMessageAt", "desc").limit(1000).select(...THREAD_FIELDS).get(),
    sum("responseCount"),
    sum("missedCount"),
    count(col("profiles")),
    count(col("profiles").where("createdAt", ">=", new Date(from))),
    count(col("profiles").where("isEvaluator", "==", true)),
    count(col("projects")),
    count(col("requests")),
    count(col("requests").where("status", "==", "completed")),
    count(col("reviews")),
    count(col("clientErrors")),
    count(col("clientErrors").where("createdAt", ">=", new Date(now - 7 * DAY))),
  ]);
  return summarize(
    {
      stats: Object.fromEntries(days.map((d) => [d.id, d.data() as DayStats | undefined])),
      accounts,
      threads: moved.docs.map((d) => {
        const r = d.data();
        return { ...r, createdAt: ms(r.createdAt) ?? 0, respondedAt: ms(r.respondedAt), completedAt: ms(r.completedAt), lastMessageAt: ms(r.lastMessageAt) ?? 0 } as Thread;
      }),
      counts: { profiles, newProfiles, evaluators, projects, requests, completed, reviews, errors, errors7, answered, missed },
    },
    now,
  );
});
