"use client";
import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { api, db } from "@/lib/firebase";
import { ISO25010, ISO_ITEM_IDS, ISO_SCALE, type IsoScores } from "@/lib/iso25010";
import type { EvalRequest } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { RequireProfile } from "@/components/guard";
import { Empty, ErrorText, Spinner } from "@/components/ui";

function EvaluateForm({ id }: { id: string }) {
  const { t, user } = useApp();
  const [r, setR] = useState<EvalRequest | null | undefined>(undefined);
  const [scores, setScores] = useState<Partial<IsoScores>>({});
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "requests", id)).then((s) => setR(s.exists() ? ({ id: s.id, ...s.data() } as EvalRequest) : null), () => setR(null));
    // An earlier submission loads for editing; a missing one is simply a blank form.
    getDoc(doc(db, "evaluations", id)).then(
      (s) => {
        if (!s.exists()) return;
        setScores((s.get("scores") as Partial<IsoScores>) ?? {});
        setComments((s.get("comments") as string) ?? "");
      },
      () => {},
    );
  }, [id]);

  if (r === undefined) return <Spinner />;
  if (r === null || r.evaluatorUid !== user!.uid || !["accepted", "completed"].includes(r.status)) return <Empty img="empty-inbox" text={t("notFound")} />;

  const missing = ISO_ITEM_IDS.filter((k) => !scores[k]).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/evaluations", "POST", { requestId: id, scores, comments });
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-3xl flex-col gap-5">
      <Link href={`/inbox/${id}`} className="text-sm text-brand underline">
        {t("certBack")}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("isoTitle")}</h1>
        <p className="font-semibold">{r.projectTitle}</p>
        <p className="text-sm text-muted">{t("isoIntro")}</p>
      </div>

      {ISO25010.map((c) => (
        <fieldset key={c.id} className="card flex flex-col gap-4 p-4">
          <legend className="px-1 font-bold">{c.name}</legend>
          {c.items.map((i) => (
            <div key={i.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{i.name}</p>
                <p className="text-sm text-muted">{i.text}</p>
              </div>
              <div role="radiogroup" aria-label={i.name} className="flex shrink-0 gap-1">
                {[...ISO_SCALE].reverse().map((s) => (
                  <label key={s.score} title={s.label} className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border font-semibold focus-within:ring-2 focus-within:ring-brand ${scores[i.id] === s.score ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>
                    <input
                      type="radio"
                      name={i.id}
                      value={s.score}
                      checked={scores[i.id] === s.score}
                      onChange={() => setScores((x) => ({ ...x, [i.id]: s.score }))}
                      className="sr-only"
                      aria-label={`${s.score} ${s.label}`}
                    />
                    {s.score}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
      ))}

      <div className="card flex flex-col gap-2 p-4">
        <label htmlFor="comments" className="label">
          {t("isoComments")}
        </label>
        <textarea id="comments" className="input min-h-28" maxLength={1500} value={comments} onChange={(e) => setComments(e.target.value)} />
      </div>

      <p className="text-xs text-muted">{ISO_SCALE.map((s) => `${s.score} = ${s.label}`).join(" · ")}</p>
      {missing > 0 && <p className="text-sm text-muted">{t("isoMissing", { n: missing })}</p>}
      <ErrorText code={err} />
      {saved && <p className="font-semibold text-brand">{t("isoSaved")}</p>}
      <button type="submit" className="btn-primary w-fit" disabled={busy || missing > 0}>
        {t("isoSubmit")}
      </button>
    </form>
  );
}

export default function EvaluatePage({ params }: PageProps<"/inbox/[id]/evaluate">) {
  const { id } = use(params);
  return (
    <Suspense>
      <RequireProfile>
        <EvaluateForm id={id} />
      </RequireProfile>
    </Suspense>
  );
}
