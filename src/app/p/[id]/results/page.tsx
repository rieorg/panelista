"use client";
import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { interpret, ISO_SCALE, tabulate, toTsv } from "@/lib/iso25010";
import type { Evaluation } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { RequireProfile } from "@/components/guard";
import { Empty, Spinner } from "@/components/ui";

/** The project owner's Chapter 4 table: ISO 25010 weighted means across every submitted evaluation. */
function Results({ id }: { id: string }) {
  const { t, user } = useApp();
  const uid = user!.uid;
  const [title, setTitle] = useState<string | null | undefined>(undefined);
  const [evals, setEvals] = useState<Evaluation[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "projects", id)).then((s) => setTitle(s.exists() && s.get("ownerUid") === uid ? (s.get("title") as string) : null), () => setTitle(null));
    getDocs(query(collection(db, "evaluations"), where("projectId", "==", id), where("studentUid", "==", uid))).then(
      (s) => setEvals(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Evaluation)),
      () => setEvals([]),
    );
  }, [id, uid]);

  if (title === undefined || evals === null) return <Spinner />;
  if (title === null) return <Empty img="empty-projects" text={t("notFound")} />;

  const table = tabulate(evals.map((e) => e.scores));

  async function copy() {
    try {
      await navigator.clipboard.writeText(toTsv(table));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href={`/p/${id}`} className="text-sm text-brand underline">
        {title}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("isoResults")}</h1>
        <p className="text-sm text-muted">
          {t("resultsCount", { n: table.n })} · {t("resultsIntro")}
        </p>
      </div>

      {table.n === 0 ? (
        <Empty img="empty-projects" text={t("resultsNone")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={copy}>
              {t("resultsCopy")}
            </button>
            {copied && <span className="text-sm text-brand">{t("copied")}</span>}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="p-3">{t("colIndicator")}</th>
                  <th className="p-3 text-right">{t("colMean")}</th>
                  <th className="p-3">{t("colInterp")}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {table.characteristics.map((c) => [
                  <tr key={c.id} className="border-b border-line bg-brand-soft/50 font-bold">
                    <td className="p-3">{c.name}</td>
                    <td className="p-3 text-right">{c.mean.toFixed(2)}</td>
                    <td className="p-3">{interpret(c.mean)}</td>
                  </tr>,
                  ...c.items.map((i) => (
                    <tr key={i.id} className="border-b border-line">
                      <td className="p-3 pl-6">{i.name}</td>
                      <td className="p-3 text-right">{i.mean.toFixed(2)}</td>
                      <td className="p-3">{interpret(i.mean)}</td>
                    </tr>
                  )),
                ])}
                <tr className="font-extrabold">
                  <td className="p-3">{t("overall")}</td>
                  <td className="p-3 text-right">{table.overall.toFixed(2)}</td>
                  <td className="p-3">{interpret(table.overall)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card flex flex-col gap-2 p-4 text-sm">
            <h2 className="font-bold">{t("scaleTitle")}</h2>
            {ISO_SCALE.map((s) => (
              <p key={s.score} className="tabular-nums">
                {s.score} · {s.range} · {s.label}
              </p>
            ))}
          </div>

          {evals.some((e) => e.comments) && (
            <div className="card flex flex-col gap-3 p-4">
              <h2 className="font-bold">{t("evaluatorComments")}</h2>
              {evals
                .filter((e) => e.comments)
                .map((e) => (
                  <div key={e.id} className="text-sm">
                    <p className="font-semibold">{e.evaluatorName}</p>
                    <p className="whitespace-pre-line">{e.comments}</p>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ResultsPage({ params }: PageProps<"/p/[id]/results">) {
  const { id } = use(params);
  return (
    <Suspense>
      <RequireProfile>
        <Results id={id} />
      </RequireProfile>
    </Suspense>
  );
}
