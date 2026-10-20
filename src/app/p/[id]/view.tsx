"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot } from "firebase/firestore";
import { api, db } from "@/lib/firebase";
import type { Project } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { Avatar, CategoryChips, Empty, ErrorText, fmtDate, FormLink, Modal, Spinner } from "@/components/ui";

export function ProjectView({ id }: { id: string }) {
  const { t, lang, user, profile } = useApp();
  const [p, setP] = useState<Project | null | undefined>(undefined);
  const [offering, setOffering] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(
    () => onSnapshot(doc(db, "projects", id), (s) => setP(s.exists() ? ({ id: s.id, ...s.data() } as Project) : null), () => setP(null)),
    [id],
  );

  if (p === undefined) return <Spinner />;
  if (p === null) return <Empty img="empty-projects" text={t("notFound")} />;
  const own = user?.uid === p.ownerUid;
  const short = profile && profile.yearsExp < p.minYears;
  const statusKey = p.status === "open" ? "statusOpen" : p.status === "filled" ? "statusFilled" : "statusClosed";

  async function setStatus(status: "open" | "closed") {
    setErr(null);
    try {
      await api(`/api/projects/${id}`, "PATCH", { status });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <article className="card flex flex-col gap-4 p-5">
        <span className={`chip w-fit ${p.status === "open" ? "" : "bg-line text-muted"}`}>{t(statusKey)}</span>
        <h1 className="text-2xl font-bold">{p.title}</h1>
        <p className="text-muted">
          {p.course} · {p.school}
        </p>
        <CategoryChips items={p.categories} />
        <p className="whitespace-pre-line">{p.abstract}</p>
        {p.stack.length > 0 && <p className="text-sm text-muted">Stack: {p.stack.join(", ")}</p>}
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">{t("navEvaluators")}</dt>
            <dd className="font-semibold">{t("neededCount", { a: p.acceptedCount, n: p.needed })}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("deadline")}</dt>
            <dd className="font-semibold">{fmtDate(p.deadline, lang)}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("minYearsLabel")}</dt>
            <dd className="font-semibold">{p.minYears}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("fMode")}</dt>
            <dd className="font-semibold">{t(p.mode)}</dd>
          </div>
        </dl>
        {p.formUrl ? (
          <FormLink href={p.formUrl} />
        ) : (
          own && (
            <p className="rounded-xl bg-accent/15 p-3 text-sm">
              {t("noFormOwner")}{" "}
              <Link href={`/me/projects/${id}/edit`} className="font-semibold text-brand underline">
                {t("addForm")}
              </Link>
            </p>
          )
        )}
      </article>

      <aside className="card flex h-fit flex-col gap-3 p-5 lg:sticky lg:top-20">
        <p className="text-sm text-muted">{t("postedBy")}</p>
        <Link href={`/e/${p.ownerUid}`} className="flex items-center gap-2 font-semibold">
          <Avatar src={p.ownerPhoto} name={p.ownerName} size={36} />
          {p.ownerName}
        </Link>
        {own ? (
          <>
            <p className="chip w-fit">{t("yourProject")}</p>
            <Link href={`/me/projects/${id}/edit`} className="btn-ghost">
              {t("editProject")}
            </Link>
            <Link href={`/p/${id}/results`} className="btn-ghost">
              {t("isoResults")}
            </Link>
            <Link href="/evaluators" className="btn-primary">
              {t("ctaFind")}
            </Link>
            {p.status === "closed" ? (
              <button className="btn-ghost" onClick={() => setStatus("open")}>
                {t("reopenProject")}
              </button>
            ) : (
              <button className="btn-danger" onClick={() => setStatus("closed")}>
                {t("closeProject")}
              </button>
            )}
          </>
        ) : !user ? (
          <Link href={`/login?next=${encodeURIComponent(`/p/${id}`)}`} className="btn-primary">
            {t("signIn")}
          </Link>
        ) : !profile?.isEvaluator ? (
          <>
            <p className="text-sm text-muted">{t("beEvaluatorFirst")}</p>
            <Link href="/me?tab=profile&role=evaluator" className="btn-ghost">
              {t("ctaBe")}
            </Link>
          </>
        ) : (
          <>
            <button className="btn-primary" disabled={p.status !== "open" || !!short} onClick={() => setOffering(true)}>
              {t("offer")}
            </button>
            {short && <p className="text-sm text-muted">{t("belowMinYears", { n: p.minYears, m: profile.yearsExp })}</p>}
          </>
        )}
        <ErrorText code={err} />
      </aside>

      {offering && <OfferModal project={p} onClose={() => setOffering(false)} />}
    </div>
  );
}

function OfferModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { t, user } = useApp();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneId, setDoneId] = useState("");

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string }>("/api/requests", "POST", { projectId: project.id, evaluatorUid: user!.uid, note: note.trim() });
      setDoneId(r.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("offer")} onClose={onClose}>
      {doneId ? (
        <div className="flex flex-col gap-3">
          <p>{t("offerSent")}</p>
          <Link href={`/inbox/${doneId}`} className="btn-primary">
            {t("navInbox")}
          </Link>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea className="input min-h-28" maxLength={500} placeholder={t("offerPh")} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("offerPh")} />
          <p className="text-xs text-muted">{t("safety")}</p>
          <ErrorText code={err} />
          <button className="btn-primary" disabled={busy}>
            {t("sendRequest")}
          </button>
        </form>
      )}
    </Modal>
  );
}
