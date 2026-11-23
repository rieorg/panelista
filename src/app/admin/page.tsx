"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { api, db, worker } from "@/lib/firebase";
import { useApp } from "@/components/app-provider";
import { RequireProfile } from "@/components/guard";
import { PanySays } from "@/components/pany";
import { Empty, ErrorText, Spinner } from "@/components/ui";
import { Analytics } from "./analytics";

interface Verification {
  uid: string;
  name: string;
  headline: string;
  linkedin: string;
  yearsExp: number;
  note: string;
  files: { key: string; name: string; type: string }[];
}
interface Report {
  id: string;
  targetUid: string;
  reporterUid: string;
  reason: string;
  details: string;
}
/** What the last decision did. Without it a reviewed row just leaves the queue and says nothing. */
interface Outcome {
  kind: "approved" | "rejected" | "stale";
  name: string;
}

// A link in a queue row: brand text and a full 44 px target.
const ROW_LINK = "inline-flex min-h-11 items-center text-brand underline";

/**
 * Proof file fetched with the admin's token and shown in place: images inline,
 * PDFs in the browser's own viewer inside an iframe. Opening a blob: URL in a
 * new tab after the fetch got blocked or came up blank, so nothing opens a
 * window.
 */
function Proof({ file }: { file: Verification["files"][number] }) {
  const [blob, setBlob] = useState<{ url: string; type: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let url = "";
    let gone = false;
    worker(`/proofs/${encodeURIComponent(file.key)}`)
      .then((r) => r.blob())
      .then(
        (b) => {
          url = URL.createObjectURL(b);
          if (gone) URL.revokeObjectURL(url);
          else setBlob({ url, type: b.type });
        },
        (e) => setErr((e as Error).message),
      );
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.key]);

  if (err) return <ErrorText code={err} />;
  if (!blob) return <span className="text-xs text-muted">{file.name}</span>;
  return blob.type.startsWith("image/") ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={blob.url} alt={file.name} title={file.name} className="max-h-96 max-w-full rounded-lg border border-line" />
  ) : (
    <iframe src={blob.url} title={file.name} className="h-[80vh] w-full rounded-lg border border-line" />
  );
}

/** The moderation queue: verification applications and open reports. */
function Queue() {
  const { isAdmin, t } = useApp();
  const [vs, setVs] = useState<Verification[] | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // A queue that could not be read. Without it the skeleton never left, and an empty list would read as "nothing waiting".
  const [failed, setFailed] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // One admin call at a time: the buttons wait while a decision is on its way.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    const a = onSnapshot(
      query(collection(db, "verifications"), where("status", "==", "pending"), orderBy("submittedAt"), limit(50)),
      (s) => setVs(s.docs.map((d) => d.data() as Verification)),
      () => setFailed(true),
    );
    const b = onSnapshot(
      query(collection(db, "reports"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(50)),
      (s) => setReports(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Report)),
      () => setFailed(true),
    );
    return () => {
      a();
      b();
    };
  }, [isAdmin]);

  /** One admin call. Gives back the response, or null after showing the error. */
  async function run(payload: object) {
    setErr(null);
    setBusy(true);
    try {
      return await api<{ ok: true; stale?: boolean }>("/api/admin", "POST", payload);
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function decide(v: Verification, decision: "approve" | "reject") {
    let reason = "";
    if (decision === "reject") {
      // Cancel means "do not reject". It used to send the rejection with an empty reason.
      const typed = prompt("Reason shown to the user");
      if (typed === null) return;
      reason = typed.slice(0, 300);
    }
    setOutcome(null);
    const res = await run({ op: "verify", uid: v.uid, decision, reason });
    // The decision did not go through, so the application is still pending and its proof has to stay.
    if (!res) return;
    // The API turns an approval into a rejection when the profile changed after the person applied.
    setOutcome({ kind: res.stale ? "stale" : decision === "approve" ? "approved" : "rejected", name: v.name });
    // Proof files are deleted right after review (privacy policy promise).
    await Promise.all(v.files.map((f) => worker(`/proofs/${encodeURIComponent(f.key)}`, { method: "DELETE" }).catch(() => {})));
  }

  async function ban(r: Report) {
    if (!confirm("Ban this user? Disables their login and hides their listings.")) return;
    // The report is resolved only once the ban went through.
    if (await run({ op: "ban", uid: r.targetUid, banned: true })) await run({ op: "resolveReport", id: r.id });
  }

  if (failed) return <ErrorText code="generic" />;
  if (!vs || !reports) return <Spinner />;

  return (
    <div className="flex flex-col gap-5">
      <ErrorText code={err} />
      {outcome && (
        <PanySays tone={outcome.kind === "stale" ? "tip" : "say"} role="status">
          {outcome.kind === "stale" ? (
            <>
              Not approved. <b>{outcome.name}</b> changed their name, headline, link or years after applying, so the application was rejected with that reason. They can apply again with
              the profile as it is now.
            </>
          ) : outcome.kind === "approved" ? (
            <>
              Approved. <b>{outcome.name}</b> now has the Verified badge.
            </>
          ) : (
            <>
              Rejected. <b>{outcome.name}</b> sees the reason and can apply again.
            </>
          )}
        </PanySays>
      )}
      {vs.length === 0 && reports.length === 0 ? (
        <Empty pose="cheer" text="All caught up. No applications and no open reports are waiting." />
      ) : (
        // Desktop: the two queues side by side. minmax(0, ...) lets a pasted link wrap instead of widening a column.
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              Verifications <span className="chip">{vs.length}</span>
            </h2>
            {vs.length === 0 && <p className="card p-4 text-sm text-muted">None pending.</p>}
            {vs.map((v) => (
              <div key={v.uid} className="card flex min-w-0 flex-col gap-2 p-4 break-words">
                <div>
                  <Link href={`/e/${v.uid}`} className={`${ROW_LINK} font-semibold`}>
                    {v.name}
                  </Link>
                  <p className="text-sm text-muted">
                    {v.headline} · {t("yearsExp", { n: v.yearsExp })}
                  </p>
                </div>
                {v.linkedin && (
                  <a href={v.linkedin} target="_blank" rel="noopener noreferrer nofollow" className={`${ROW_LINK} -my-2 text-sm break-all`}>
                    {v.linkedin.replace(/^https:\/\/(www\.)?/, "")}
                  </a>
                )}
                {v.note && <p className="text-sm whitespace-pre-line">{v.note}</p>}
                {v.files.length > 0 && (
                  <div className="flex flex-wrap items-start gap-2">
                    {v.files.map((f) => (
                      <Proof key={f.key} file={f} />
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button className="btn-primary max-sm:flex-1" disabled={busy} onClick={() => decide(v, "approve")}>
                    Approve
                  </button>
                  <button className="btn-danger max-sm:flex-1" disabled={busy} onClick={() => decide(v, "reject")}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              Reports <span className="chip">{reports.length}</span>
            </h2>
            {reports.length === 0 && <p className="card p-4 text-sm text-muted">No open reports.</p>}
            {reports.map((r) => (
              <div key={r.id} className="card flex min-w-0 flex-col gap-1 p-4 break-words">
                <div className="flex flex-wrap items-center gap-x-4 text-sm">
                  <span className="chip">{r.reason}</span>
                  <Link className={ROW_LINK} href={`/e/${r.targetUid}`}>
                    Reported profile
                  </Link>
                  <Link className={ROW_LINK} href={`/e/${r.reporterUid}`}>
                    Reporter
                  </Link>
                </div>
                {r.details && <p className="text-sm">{r.details}</p>}
                <div className="mt-1 flex gap-2">
                  <button className="btn-ghost max-sm:flex-1" disabled={busy} onClick={() => run({ op: "resolveReport", id: r.id })}>
                    Resolve
                  </button>
                  <button className="btn-danger max-sm:flex-1" disabled={busy} onClick={() => ban(r)}>
                    Ban user
                  </button>
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

const TABS = { queue: "Queue", analytics: "Analytics" } as const;
type Tab = keyof typeof TABS;

function Admin() {
  const { isAdmin, t } = useApp();
  const router = useRouter();
  const tab: Tab = useSearchParams().get("tab") === "analytics" ? "analytics" : "queue";

  // The one admin screen other people can land on, so it follows their language. Everything past it stays English.
  if (!isAdmin)
    return (
      <Empty pose="oops" title={t("adminOnly")} text={t("adminOnlyText")}>
        <Link href="/" className="btn-ghost">
          {t("backHome")}
        </Link>
      </Empty>
    );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Admin</h1>
      {/* The same strip as the account page (/me): it bleeds to the screen edge on phones. */}
      <div role="tablist" className="-mx-4 flex overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {(Object.keys(TABS) as Tab[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => router.replace(k === "queue" ? "/admin" : `/admin?tab=${k}`)}
            className={`min-h-11 flex-1 border-b-2 px-3 text-sm font-semibold whitespace-nowrap sm:flex-none sm:px-4 ${tab === k ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}
          >
            {TABS[k]}
          </button>
        ))}
      </div>
      {tab === "analytics" ? <Analytics /> : <Queue />}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <RequireProfile optional>
        <Admin />
      </RequireProfile>
    </Suspense>
  );
}
