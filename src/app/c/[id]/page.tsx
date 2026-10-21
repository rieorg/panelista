import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/server";
import { interpret, tabulate, type IsoScores } from "@/lib/iso25010";
import { VerifiedBadge } from "@/components/ui";

// Public check for a printed certificate: a school opens the link on it and sees
// the same facts. Completed requests only, and only what reviews already make public
// (project, names, date) plus the overall ISO 25010 mean. English, for the school.
export const metadata: Metadata = { title: "Certificate check", robots: { index: false } };
// Public and unauthenticated: cache each check for 5 minutes to cap Firestore reads.
export const revalidate = 300;
// No ids at build time: each check renders on its first visit, then serves from cache.
export const generateStaticParams = async () => [];

export default async function CertificateCheck({ params }: PageProps<"/c/[id]">) {
  const { id } = await params;
  if (!/^[\w-]{1,200}$/.test(id)) notFound();
  // A Firestore error throws (error page), so an outage never reads as "not a real certificate".
  const r = await db().doc(`requests/${id}`).get();
  if (!r.exists || r.get("status") !== "completed") notFound();
  const [ev, evaluator] = await Promise.all([db().doc(`evaluations/${id}`).get(), db().doc(`profiles/${r.get("evaluatorUid")}`).get()]);
  // A banned evaluator's certificates stop checking out.
  if (evaluator.get("banned") === true) notFound();
  const overall = ev.exists ? tabulate([ev.get("scores") as Partial<IsoScores>]).overall : null;
  const done = (r.get("completedAt") ?? r.get("updatedAt"))?.toDate() as Date | undefined;

  return (
    <article className="mx-auto flex max-w-xl flex-col gap-5 py-6">
      <p className="chip w-fit">Valid certificate</p>
      <h1 className="text-3xl font-bold text-brand-dark">Certificate of Evaluation</h1>
      <dl className="card grid gap-4 p-5 sm:grid-cols-[10rem_1fr]">
        <dt className="text-sm text-muted">Capstone project</dt>
        <dd className="font-semibold">{r.get("projectTitle")}</dd>
        <dt className="text-sm text-muted">Student</dt>
        <dd>{r.get("studentName")}</dd>
        <dt className="text-sm text-muted">Evaluated by</dt>
        <dd className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 font-semibold">
            {evaluator.get("name") ?? r.get("evaluatorName")}
            {evaluator.get("verified") === true && <VerifiedBadge />}
          </span>
          {evaluator.get("headline") && <span className="text-sm text-muted">{evaluator.get("headline")}</span>}
        </dd>
        <dt className="text-sm text-muted">Completed</dt>
        <dd>{done ? done.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }) : "Completed"}</dd>
        {overall !== null && (
          <>
            <dt className="text-sm text-muted">ISO 25010 overall</dt>
            <dd className="tabular-nums">
              {overall.toFixed(2)} ({interpret(overall)})
            </dd>
          </>
        )}
        <dt className="text-sm text-muted">Reference</dt>
        <dd className="break-all font-mono text-sm">{id}</dd>
      </dl>
      <p className="text-sm text-muted">Arranged through Panelista, a free platform connecting capstone students with IT professionals.</p>
    </article>
  );
}
