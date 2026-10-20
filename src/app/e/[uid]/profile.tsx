"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { api, db } from "@/lib/firebase";
import { CATEGORY_LABELS } from "@/lib/i18n";
import type { Profile, Project, Review } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { useResponseText } from "@/components/cards";
import { AdminBadge, Avatar, Empty, ErrorText, fmtDate, Modal, Spinner, Stars, VerifiedBadge } from "@/components/ui";
import { ReportButton } from "@/components/report";

export function EvaluatorProfile({ uid }: { uid: string }) {
  const { t, lang, user } = useApp();
  const resp = useResponseText();
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "profiles", uid)).then((s) => setP(s.exists() ? ({ uid: s.id, ...s.data() } as Profile) : null), () => setP(null));
    getDocs(query(collection(db, "reviews"), where("toUid", "==", uid), where("direction", "==", "toEvaluator"), orderBy("createdAt", "desc"), limit(30)))
      .then((s) => setReviews(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Review)))
      .catch(() => {});
  }, [uid]);

  if (p === undefined) return <Spinner />;
  if (p === null) return <Empty img="empty-projects" text={t("notFound")} />;
  const own = user?.uid === uid;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-6">
        <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <Avatar src={p.photoURL} name={p.name} size={96} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{p.name}</h1>
              {p.verified && <VerifiedBadge size={24} />}
              {p.isAdmin && <AdminBadge />}
            </div>
            <p className="text-muted">{p.headline}</p>
            <Stars value={p.evalRatingAvg} count={p.evalRatingCount} size="lg" />
            <p className="text-sm text-muted">
              {t("yearsExp", { n: p.yearsExp })} · {t("evalsDone", { n: p.completedCount })}
              {p.city ? ` · ${p.city}` : ""} · {t("joined", { d: fmtDate(p.createdAt, lang) })}
            </p>
            <p className="text-sm text-muted">{resp(p)}</p>
            {p.banned && <p className="text-sm font-semibold text-red-700">{t("suspended")}</p>}
          </div>
        </section>

        {(p.bio || p.titles.length > 0) && (
          <section className="card flex flex-col gap-3 p-5">
            <h2 className="font-bold">{t("about")}</h2>
            {p.titles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {p.titles.map((x) => (
                  <span key={x} className="chip">
                    {x}
                  </span>
                ))}
              </div>
            )}
            {p.bio && <p className="whitespace-pre-line text-sm">{p.bio}</p>}
          </section>
        )}

        <section className="card flex flex-col gap-3 p-5">
          <h2 className="font-bold">
            {t("reviews")} ({reviews.length < 30 ? reviews.length : "30+"})
          </h2>
          {reviews.length > p.evalRatingCount && <p className="text-xs text-muted">{t("ratingsNote")}</p>}
          {reviews.length === 0 && <p className="text-sm text-muted">{t("noReviews")}</p>}
          <ul className="flex flex-col divide-y divide-line">
            {reviews.map((r) => (
              <li key={r.id} className="flex gap-3 py-3">
                <Avatar src={r.fromPhoto} name={r.fromName} size={36} />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold">{r.fromName}</span>
                    <Stars value={r.stars} />
                    <span className="text-xs text-muted">{fmtDate(r.createdAt, lang)}</span>
                  </div>
                  <p className="text-xs text-muted">{r.projectTitle}</p>
                  {r.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.tags.map((tg) => (
                        <span key={tg} className="chip">
                          {t(`tag_${tg}` as never)}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.text && <p className="text-sm">{r.text}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="card flex flex-col gap-3 p-5 lg:sticky lg:top-20">
          <span className={`font-semibold ${p.accepting ? "text-brand" : "text-muted"}`}>{p.accepting ? t("accepting") : t("notAccepting")}</span>
          {own ? (
            <Link href="/me?tab=profile" className="btn-ghost">
              {t("navMe")}
            </Link>
          ) : !user ? (
            <Link href={`/login?next=${encodeURIComponent(`/e/${uid}`)}`} className="btn-primary">
              {t("signInToRequest")}
            </Link>
          ) : (
            <button className="btn-primary" disabled={!p.accepting || !p.isEvaluator} onClick={() => setAsking(true)}>
              {t("requestEval")}
            </button>
          )}
          {p.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.categories.map((c) => (
                <span key={c} className="chip">
                  {CATEGORY_LABELS[c]}
                </span>
              ))}
            </div>
          )}
          {p.skills.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">{t("skills")}</h3>
              <p className="text-sm text-muted">{p.skills.join(", ")}</p>
            </div>
          )}
          {p.modes.length > 0 && <p className="text-sm text-muted">{p.modes.map((m) => t(m)).join(" · ")}</p>}
          {p.linkedin && (
            <a href={p.linkedin} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-sm text-brand underline">
              {p.linkedin.replace(/^https:\/\/(www\.)?/, "")}
            </a>
          )}
          {user && !own && <ReportButton targetUid={uid} />}
        </div>
      </aside>

      {asking && <RequestModal evaluator={p} onClose={() => setAsking(false)} />}
    </div>
  );
}

function RequestModal({ evaluator, onClose }: { evaluator: Profile; onClose: () => void }) {
  const { t, user } = useApp();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneId, setDoneId] = useState("");

  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, "projects"), where("ownerUid", "==", user.uid), orderBy("createdAt", "desc"), limit(20))).then((s) => {
      const open = s.docs.map((d) => ({ id: d.id, ...d.data() }) as Project).filter((x) => x.status === "open");
      setProjects(open);
      if (open[0]) setProjectId(open[0].id);
    }, () => setProjects([]));
  }, [user]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string }>("/api/requests", "POST", { projectId, evaluatorUid: evaluator.uid, note: note.trim() });
      setDoneId(r.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("requestEval")} onClose={onClose}>
      {doneId ? (
        <div className="flex flex-col gap-3">
          <p>{t("requestSent")}</p>
          <Link href={`/inbox/${doneId}`} className="btn-primary">
            {t("navInbox")}
          </Link>
        </div>
      ) : projects === null ? (
        <Spinner />
      ) : projects.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p>{t("needProject")}</p>
          <Link href="/me/projects/new" className="btn-primary">
            {t("ctaPost")}
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
          <label className="label" htmlFor="proj">
            {t("pickProject")}
          </label>
          <select id="proj" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
          <textarea className="input min-h-28" maxLength={500} placeholder={t("notePh")} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("notePh")} />
          <p className="text-xs text-muted">{t("safety")}</p>
          <ErrorText code={err} />
          <button className="btn-primary" disabled={busy || !projectId}>
            {t("sendRequest")}
          </button>
        </form>
      )}
    </Modal>
  );
}
