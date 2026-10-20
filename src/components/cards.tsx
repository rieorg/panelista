"use client";
import Link from "next/link";
import { responseLabel } from "@/lib/domain";
import type { Profile, Project } from "@/lib/types";
import { useApp } from "./app-provider";
import { Avatar, CategoryChips, fmtDate, Stars, VerifiedBadge } from "./ui";

/** "Answered 3 of 4 requests · Usually responds within a day"; the rate shows once any invite was answered or let expire. */
export function useResponseText() {
  const { t } = useApp();
  return (p: Pick<Profile, "avgResponseHours" | "responseCount" | "missedCount">) => {
    const label = responseLabel(p.avgResponseHours, p.responseCount);
    const speed = t(({ hour: "respHour", day: "respDay", days: "respDays", new: "respNew" } as const)[label]);
    const asked = p.responseCount + (p.missedCount ?? 0);
    if (!asked) return speed;
    const rate = t("answerRate", { a: p.responseCount, n: asked });
    return label === "new" ? rate : `${rate} · ${speed}`;
  };
}

export function EvaluatorCard({ p }: { p: Profile }) {
  const { t } = useApp();
  const resp = useResponseText();
  return (
    <Link href={`/e/${p.uid}`} className="card flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-3">
        <Avatar src={p.photoURL} name={p.name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate font-bold">{p.name}</h3>
            {p.verified && <VerifiedBadge />}
          </div>
          <p className="line-clamp-2 text-sm text-muted">{p.headline || p.titles.join(", ")}</p>
          <Stars value={p.evalRatingAvg} count={p.evalRatingCount} />
        </div>
      </div>
      <CategoryChips items={p.categories.slice(0, 3)} />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          {t("yearsExp", { n: p.yearsExp })} · {t("evalsDone", { n: p.completedCount })}
        </span>
        <span className={p.accepting ? "font-semibold text-brand" : ""}>{p.accepting ? t("accepting") : t("notAccepting")}</span>
      </div>
      <p className="text-xs text-muted">{resp(p)}</p>
    </Link>
  );
}

export function ProjectCard({ p }: { p: Project }) {
  const { t, lang } = useApp();
  const pct = Math.min(100, Math.round((p.acceptedCount / p.needed) * 100));
  return (
    <Link href={`/p/${p.id}`} className="card flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div>
        <h3 className="line-clamp-2 font-bold">{p.title}</h3>
        <p className="text-sm text-muted">
          {p.course} · {p.school}
        </p>
      </div>
      <p className="line-clamp-3 text-sm">{p.abstract}</p>
      <CategoryChips items={p.categories} />
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted">
          <span>{t("neededCount", { a: p.acceptedCount, n: p.needed })}</span>
          <span>
            {t("deadline")}: {fmtDate(p.deadline, lang)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-brand-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 text-xs text-muted">
        <Avatar src={p.ownerPhoto} name={p.ownerName} size={22} />
        <span className="truncate">{p.ownerName}</span>
        {p.minYears > 0 && <span className="ml-auto chip">{t("minYears", { n: p.minYears })}</span>}
      </div>
    </Link>
  );
}
