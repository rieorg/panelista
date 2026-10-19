"use client";
import { Suspense, use, useEffect, useState } from "react";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { EvalRequest, Profile } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { RequireProfile } from "@/components/guard";
import { Empty, fmtDate, Spinner, VerifiedBadge } from "@/components/ui";

function Certificate({ id }: { id: string }) {
  const { t, lang } = useApp();
  const [r, setR] = useState<EvalRequest | null | undefined>(undefined);
  const [evaluator, setEvaluator] = useState<Profile | null | undefined>(undefined);
  const evaluatorUid = r?.status === "completed" ? r.evaluatorUid : undefined;

  useEffect(() => {
    getDoc(doc(db, "requests", id)).then((s) => setR(s.exists() ? ({ id: s.id, ...s.data() } as EvalRequest) : null), () => setR(null));
  }, [id]);
  useEffect(() => {
    if (!evaluatorUid) return;
    getDoc(doc(db, "profiles", evaluatorUid)).then((s) => setEvaluator(s.exists() ? ({ uid: s.id, ...s.data() } as Profile) : null), () => setEvaluator(null));
  }, [evaluatorUid]);

  if (r === undefined || (evaluatorUid && evaluator === undefined)) return <Spinner />;
  if (r === null) return <Empty img="empty-inbox" text={t("notFound")} />;
  if (r.status !== "completed")
    return (
      <Empty img="empty-inbox" text={t("certNotYet")}>
        <Link href={`/inbox/${id}`} className="text-sm text-brand underline">
          {t("certBack")}
        </Link>
      </Empty>
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 print:max-w-none">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/inbox/${id}`} className="text-sm text-brand underline">
          {t("certBack")}
        </Link>
        <button className="btn-primary" onClick={() => window.print()}>
          {t("certPrint")}
        </button>
      </div>

      <article className="card flex flex-col items-center gap-6 px-6 py-12 text-center sm:px-12 print:min-h-[240mm] print:justify-center print:break-inside-avoid print:border-2 print:border-brand">
        <div className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-mark.svg" alt="" width={40} height={40} />
          Panelista
        </div>
        <h1 className="text-3xl font-bold text-brand-dark">{t("certTitle")}</h1>

        <div className="flex flex-col items-center gap-2">
          <p className="text-muted">{t("certProject")}</p>
          <p className="text-2xl font-bold">{r.projectTitle}</p>
          <p>{t("certStudent", { name: r.studentName })}</p>
        </div>

        <div className="flex flex-col items-center gap-2">
          <p className="text-muted">{t("certEvaluatedBy")}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <p className="text-2xl font-bold">{evaluator?.name || r.evaluatorName}</p>
            {evaluator?.verified && !evaluator.banned && <VerifiedBadge />}
          </div>
          {evaluator?.headline && <p className="text-muted">{evaluator.headline}</p>}
        </div>

        <p className="font-semibold">{t("certCompleted", { d: fmtDate(r.completedAt ?? r.updatedAt, lang) })}</p>

        <div className="flex max-w-md flex-col gap-1 border-t border-line pt-6 text-xs text-muted">
          <p>{t("certNote")}</p>
          <p>{t("certRef", { id })}</p>
        </div>
      </article>
    </div>
  );
}

export default function CertificatePage({ params }: PageProps<"/inbox/[id]/certificate">) {
  const { id } = use(params);
  return (
    <Suspense>
      <RequireProfile>
        <Certificate id={id} />
      </RequireProfile>
    </Suspense>
  );
}
