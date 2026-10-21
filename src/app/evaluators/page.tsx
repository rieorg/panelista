"use client";
import { useEffect, useState } from "react";
import { Timestamp } from "firebase/firestore";
import { CATEGORIES } from "@/lib/domain";
import { EVALUATOR_SORTS, findEvaluators, NO_FILTERS, type EvaluatorSort as Sort } from "@/lib/evaluators";
import { CATEGORY_LABELS } from "@/lib/i18n";
import type { Profile } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { EvaluatorCard } from "@/components/cards";
import { Empty, ErrorText, Spinner } from "@/components/ui";

const PAGE = 24;
/**
 * Every evaluator (up to 500), best rank first, from the CDN-cached /api/evaluators.
 * Filtering and sorting happen client-side, so any mix of filters works without a
 * composite index per combination.
 * ponytail: past 500 evaluators, move filters into Firestore queries (one index each) or Typesense/Algolia.
 */
async function loadEvaluators(): Promise<Profile[]> {
  const res = await fetch("/api/evaluators");
  if (!res.ok) throw new Error("server");
  const rows = (await res.json()) as (Omit<Profile, "createdAt"> & { createdAt?: number })[];
  return rows.map((p) => ({ ...p, createdAt: p.createdAt === undefined ? undefined : Timestamp.fromMillis(p.createdAt) }));
}

const YEARS = [1, 3, 5, 10];
const RATINGS = [3, 4, 4.5];
const NONE = NO_FILTERS;

export default function EvaluatorsPage() {
  const { t } = useApp();
  const [all, setAll] = useState<Profile[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [f, setF] = useState(NONE);
  const [sort, setSort] = useState<Sort>("rank");
  const [shownN, setShownN] = useState(PAGE);
  const set = <K extends keyof typeof NONE>(k: K, v: (typeof NONE)[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setShownN(PAGE);
  };

  useEffect(() => {
    loadEvaluators().then(setAll, () => (setFailed(true), setAll([])));
  }, []);

  const matches = findEvaluators(all ?? [], f, sort);
  const filtered = JSON.stringify(f) !== JSON.stringify(NONE);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">{t("evaluatorsTitle")}</h1>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input sm:flex-1" type="search" placeholder={t("searchPh")} value={f.search} onChange={(e) => set("search", e.target.value)} aria-label={t("searchPh")} />
        <label className="flex items-center gap-2 text-sm sm:w-64">
          <span className="shrink-0 text-muted">{t("sortBy")}</span>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {(Object.keys(EVALUATOR_SORTS) as Sort[]).map((s) => (
              <option key={s} value={s}>
                {t(`sort_${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <select className="input sm:w-auto" value={f.cat} onChange={(e) => set("cat", e.target.value)} aria-label={t("allCategories")}>
          <option value="">{t("allCategories")}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select className="input sm:w-auto" value={f.years} onChange={(e) => set("years", Number(e.target.value))} aria-label={t("anyYears")}>
          <option value={0}>{t("anyYears")}</option>
          {YEARS.map((n) => (
            <option key={n} value={n}>
              {t("yearsAtLeast", { n })}
            </option>
          ))}
        </select>
        <select className="input sm:w-auto" value={f.rating} onChange={(e) => set("rating", Number(e.target.value))} aria-label={t("anyRating")}>
          <option value={0}>{t("anyRating")}</option>
          {RATINGS.map((n) => (
            <option key={n} value={n}>
              {t("ratingAtLeast", { n })}
            </option>
          ))}
        </select>
        <select className="input sm:w-auto" value={f.mode} onChange={(e) => set("mode", e.target.value)} aria-label={t("anyMode")}>
          <option value="">{t("anyMode")}</option>
          <option value="online">{t("online")}</option>
          <option value="onsite">{t("onsite")}</option>
        </select>
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" checked={f.verified} onChange={(e) => set("verified", e.target.checked)} className="h-4 w-4 accent-brand" />
          {t("verifiedOnly")}
        </label>
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" checked={f.accepting} onChange={(e) => set("accepting", e.target.checked)} className="h-4 w-4 accent-brand" />
          {t("acceptingOnly")}
        </label>
      </div>
      {all === null ? (
        <Spinner />
      ) : failed ? (
        <ErrorText code="generic" />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-3 text-sm text-muted" aria-live="polite">
            {t("resultsCount", { n: matches.length })}
            {filtered && (
              <button className="text-brand underline" onClick={() => (setF(NONE), setShownN(PAGE))}>
                {t("clearFilters")}
              </button>
            )}
          </p>
          {matches.length === 0 ? (
            <Empty img="empty-projects" text={all.length ? t("noMatch") : t("noEvaluators")} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {matches.slice(0, shownN).map((p) => (
                <EvaluatorCard key={p.uid} p={p} />
              ))}
            </div>
          )}
          {matches.length > shownN && (
            <button className="btn-ghost mx-auto" onClick={() => setShownN(shownN + PAGE)}>
              {t("loadMore")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
