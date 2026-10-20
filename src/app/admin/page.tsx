"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { api, db, worker } from "@/lib/firebase";
import { useApp } from "@/components/app-provider";
import { RequireProfile } from "@/components/guard";
import { ErrorText, Spinner } from "@/components/ui";

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

function Admin() {
  const { isAdmin, t } = useApp();
  const [vs, setVs] = useState<Verification[] | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const a = onSnapshot(query(collection(db, "verifications"), where("status", "==", "pending"), orderBy("submittedAt"), limit(50)), (s) =>
      setVs(s.docs.map((d) => d.data() as Verification)),
    );
    const b = onSnapshot(query(collection(db, "reports"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(50)), (s) =>
      setReports(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Report)),
    );
    return () => {
      a();
      b();
    };
  }, [isAdmin]);

  if (!isAdmin) return <p className="card p-5">Admins only.</p>;

  async function run(payload: object) {
    setErr(null);
    try {
      await api("/api/admin", "POST", payload);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function decide(v: Verification, decision: "approve" | "reject") {
    const reason = decision === "reject" ? (prompt("Reason shown to the user") ?? "").slice(0, 300) : "";
    await run({ op: "verify", uid: v.uid, decision, reason });
    // Proof files are deleted right after review (privacy policy promise).
    await Promise.all(v.files.map((f) => worker(`/proofs/${encodeURIComponent(f.key)}`, { method: "DELETE" }).catch(() => {})));
  }

  return (
    <div className="flex flex-col gap-8">
      <ErrorText code={err} />
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Verifications</h1>
        {!vs ? (
          <Spinner />
        ) : vs.length === 0 ? (
          <p className="text-muted">None pending.</p>
        ) : (
          vs.map((v) => (
            <div key={v.uid} className="card flex flex-col gap-2 p-4">
              <Link href={`/e/${v.uid}`} className="font-semibold text-brand underline">
                {v.name}
              </Link>
              <p className="text-sm text-muted">
                {v.headline} · {t("yearsExp", { n: v.yearsExp })} {v.linkedin && <a className="underline" href={v.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
              </p>
              {v.note && <p className="text-sm">{v.note}</p>}
              <div className="flex flex-wrap items-start gap-2">
                {v.files.map((f) => (
                  <Proof key={f.key} file={f} />
                ))}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" onClick={() => decide(v, "approve")}>
                  Approve
                </button>
                <button className="btn-danger" onClick={() => decide(v, "reject")}>
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">Reports</h2>
        {!reports ? (
          <Spinner />
        ) : reports.length === 0 ? (
          <p className="text-muted">No open reports.</p>
        ) : (
          reports.map((r) => (
            <div key={r.id} className="card flex flex-col gap-2 p-4">
              <p className="text-sm">
                <span className="chip">{r.reason}</span>{" "}
                <Link className="text-brand underline" href={`/e/${r.targetUid}`}>
                  target
                </Link>{" "}
                ·{" "}
                <Link className="text-brand underline" href={`/e/${r.reporterUid}`}>
                  reporter
                </Link>
              </p>
              {r.details && <p className="text-sm">{r.details}</p>}
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => run({ op: "resolveReport", id: r.id })}>
                  Resolve
                </button>
                <button
                  className="btn-danger"
                  onClick={async () => {
                    if (!confirm("Ban this user? Disables their login and hides their listings.")) return;
                    await run({ op: "ban", uid: r.targetUid, banned: true });
                    await run({ op: "resolveReport", id: r.id });
                  }}
                >
                  Ban user
                </button>
              </div>
            </div>
          ))
        )}
      </section>
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
