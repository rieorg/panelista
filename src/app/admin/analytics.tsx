"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/firebase";
import type { Summary } from "@/lib/analytics";
import { ErrorText, Spinner } from "@/components/ui";

// The admin Analytics tab: visit counts from the daily stats, and the funnel and totals from what the app
// already stores (GET /api/visits). Admins only, so the text is English like the rest of the admin page.

// Names for the fixed keys in src/lib/analytics.ts: page groups, sources, devices, funnel steps.
const NAME: Record<string, string> = {
  home: "Home",
  evaluators: "Evaluator list",
  evaluator: "Evaluator profile",
  projects: "Project list",
  project: "Project page",
  results: "Evaluation results",
  login: "Sign in",
  me: "Account",
  post: "Post or edit a project",
  inbox: "Request chat",
  evaluate: "Evaluation form",
  certificate: "Certificate",
  check: "Certificate check",
  privacy: "Privacy",
  other: "Other",
  facebook: "Facebook",
  messenger: "Messenger",
  tiktok: "TikTok",
  google: "Google",
  direct: "Direct",
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
  visits: "Visits",
  signups: "Sign-ups",
  profiles: "Profiles",
  requests: "Requests",
  accepted: "Accepted",
  completed: "Completed",
  rated: "Rated",
};

const num = (n: number) => n.toLocaleString("en-PH");
/** "1 visit", "1,284 visits". */
const count = (n: number, one: string) => `${num(n)} ${one}${n === 1 ? "" : "s"}`;
const pct = (ratio: number | null, digits = 0) => (ratio === null ? "-" : `${(ratio * 100).toFixed(digits)}%`);
/** "Nov 24" from a YYYY-MM-DD day. */
const short = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });

const CARD = "card flex min-w-0 flex-col gap-3 p-4";
const TH = "py-2 pl-3 text-right font-medium whitespace-nowrap";
const TD = "py-2 pl-3 text-right tabular-nums";

function Tile({ label, value, hint, wide = false }: { label: string; value: string; hint: string; wide?: boolean }) {
  return (
    <div className={`card min-w-0 px-3 py-2.5 ${wide ? "max-sm:col-span-2" : ""}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

/** One row of a ranked list: the name, its figure, and a thin bar on a lighter track of the same green. */
function Row({ name, share, children }: { name: string; share: number; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span>{name}</span>
        <span className="text-right text-muted tabular-nums">{children}</span>
      </div>
      <div className="h-2 rounded-full bg-brand-soft">
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(1, share) * 100}%` }} />
      </div>
    </li>
  );
}

/** Where visits came from, or what they came on: every bucket with its count and share. */
function Split({ title, rows }: { title: string; rows: { id: string; n: number }[] }) {
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return (
    <section className={CARD}>
      <h2 className="font-bold">{title}</h2>
      <ul className="flex flex-col gap-2.5 text-sm">
        {rows.map((r) => (
          <Row key={r.id} name={NAME[r.id]} share={total ? r.n / total : 0}>
            <b className="text-ink">{num(r.n)}</b> · {pct(total ? r.n / total : 0)}
          </Row>
        ))}
      </ul>
    </section>
  );
}

/**
 * Visits per day as thin columns. Pointing at, tapping or tabbing to a column puts its number in the line
 * above the plot, which stays inside the card on a phone (a floating tooltip would not). Every number is
 * also in the table under it.
 */
function Days({ days }: { days: Summary["days"] }) {
  const [at, setAt] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.visits));
  const shown = days[at ?? days.findIndex((d) => d.visits === max)];
  return (
    <figure className={CARD}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-bold">Visits per day</h2>
        <p className="text-sm text-muted">
          {max ? (
            <>
              {at === null && "Busiest: "}
              <b className="text-ink">{num(shown.visits)}</b> on {short(shown.date)}
            </>
          ) : (
            "No visits counted yet"
          )}
        </p>
      </figcaption>
      {/* A finger leaves the moment it lifts, so only a mouse leaving clears the pick. */}
      <div className="flex h-36 items-end gap-0.5 border-b border-line" onPointerLeave={(e) => e.pointerType === "mouse" && setAt(null)}>
        {days.map((d, i) => (
          <div
            key={d.date}
            role="img"
            tabIndex={0}
            aria-label={`${short(d.date)}: ${count(d.visits, "visit")}`}
            onPointerEnter={() => setAt(i)}
            onFocus={() => setAt(i)}
            onBlur={() => setAt(null)}
            className="flex h-full min-w-0 flex-1 items-end justify-center"
          >
            <span className={`w-full max-w-6 rounded-t ${at === i ? "bg-brand-dark" : "bg-brand"}`} style={{ height: d.visits ? `${Math.max(2, (d.visits / max) * 100)}%` : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>{short(days[0].date)}</span>
        <span>{short(days[Math.floor(days.length / 2)].date)}</span>
        <span>{short(days[days.length - 1].date)}</span>
      </div>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-3 text-muted">Show the days as a table</summary>
        <table className="w-full">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="py-2 text-left font-medium">Day (Manila time)</th>
              <th className={TH}>Visits</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...days].reverse().map((d) => (
              <tr key={d.date}>
                <td className="py-2">{short(d.date)}</td>
                <td className={TD}>{num(d.visits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

export function Analytics() {
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Summary>("/api/visits", "GET").then(setS, (e) => setErr((e as Error).message));
  }, []);

  if (err) return <ErrorText code={err} />;
  if (!s) return <Spinner />;

  // Sign-ups and requests are counted over the same days as visits, and visits have only been counted since `since`.
  const span = s.windowDays < 30 ? `since ${short(s.since)}` : "last 30 days";
  const step = (id: string) => s.funnel.find((f) => f.id === id)!.n;
  const t = s.totals;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Tile wide label="Visits today" value={num(s.visits.today)} hint="Manila time" />
        {/* The average is over the days counted so far: in the first month that is fewer than 7 or 30. */}
        <Tile label="Visits, 7 days" value={num(s.visits.d7)} hint={`about ${num(Math.round(s.visits.d7 / Math.min(7, s.windowDays)))} a day`} />
        <Tile label="Visits, 30 days" value={num(s.visits.d30)} hint={`about ${num(Math.round(s.visits.d30 / s.windowDays))} a day`} />
        <Tile label="Sign-ups" value={num(step("signups"))} hint={span} />
        <Tile label="Requests" value={num(step("requests"))} hint={span} />
        <Tile label="Completion rate" value={pct(s.rates.completion)} hint={`${num(t.completed)} of ${num(t.requests)}, all time`} />
        <Tile label="Answer rate" value={pct(s.rates.answer)} hint="evaluators, all time" />
      </div>

      <Days days={s.days} />

      <div className="grid items-start gap-4 md:grid-cols-2">
        <Split title="Where visits came from" rows={s.sources} />
        <Split title="Devices" rows={s.devices} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className={CARD}>
          <h2 className="font-bold">Pages</h2>
          {s.pages.length === 0 ? (
            <p className="text-sm text-muted">No visits counted yet.</p>
          ) : (
            // A wide table scrolls inside this box, never the page.
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-muted">
                    <th className="py-2 text-left font-medium">Visits that opened</th>
                    <th className={TH}>Today</th>
                    <th className={TH}>7 days</th>
                    <th className={TH}>30 days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.pages.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2">{NAME[p.id]}</td>
                      <td className={TD}>{num(p.today)}</td>
                      <td className={TD}>{num(p.d7)}</td>
                      <td className={TD}>{num(p.d30)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={CARD}>
          <h2 className="font-bold">
            Funnel <span className="text-sm font-normal text-muted">{span}</span>
          </h2>
          <ol className="flex flex-col gap-2.5 text-sm">
            {s.funnel.map((f, i) => {
              // The first step has nothing before it; a step after an empty one has nothing to be a share of.
              const before = s.funnel[i - 1];
              const share = !before ? 1 : before.n ? f.n / before.n : 0;
              return (
                <Row key={f.id} name={NAME[f.id]} share={share}>
                  <b className="text-ink">{num(f.n)}</b>
                  {/* One decimal under 10%: a visit-to-sign-up rate of 0.4% must not read as 0%. */}
                  {before && before.n > 0 && ` · ${pct(share, share > 0 && share < 0.1 ? 1 : 0)} of ${NAME[before.id].toLowerCase()}`}
                </Row>
              );
            })}
          </ol>
          <p className="text-xs text-muted">Each bar is the share of the step before it. Rated counts the completed requests the student has rated.</p>
        </section>
      </div>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <section className={CARD}>
          <h2 className="font-bold">Active in a request</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 text-left font-medium">Side</th>
                <th className={TH}>7 days</th>
                <th className={TH}>30 days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <td className="py-2">Students</td>
                <td className={TD}>{num(s.active.students7)}</td>
                <td className={TD}>{num(s.active.students30)}</td>
              </tr>
              <tr>
                <td className="py-2">Evaluators</td>
                <td className={TD}>{num(s.active.evaluators7)}</td>
                <td className={TD}>{num(s.active.evaluators30)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-muted">People who sent, answered, wrote in or finished a request in that time.</p>
        </section>

        <section className={CARD}>
          <h2 className="font-bold">All time</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {(
              [
                ["Accounts", t.accounts],
                ["Profiles", t.profiles],
                ["Evaluators", t.evaluators],
                ["Projects", t.projects],
                ["Requests", t.requests],
                ["Completed", t.completed],
                ["Reviews", t.reviews],
                ["Crash reports", t.errors],
              ] as const
            ).map(([label, n]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-lg font-bold">{num(n)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">{count(t.errors7, "crash report")} in the last 7 days.</p>
        </section>
      </div>
    </div>
  );
}
