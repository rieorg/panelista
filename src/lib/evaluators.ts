// Evaluator list filtering and sorting, kept pure so tests can run it.
import type { Category } from "./domain";
import type { Profile } from "./types";

// Unknown response time sorts last.
const replyHours = (p: Profile) => (p.responseCount && p.avgResponseHours !== undefined ? p.avgResponseHours : 1e9);

/** Sort orders for the evaluator list. Ties fall back to the other rating number. */
export const EVALUATOR_SORTS = {
  // Recommended puts evaluators who take requests (not Away or full) first.
  rank: (a: Profile, b: Profile) => Number(b.accepting) - Number(a.accepting) || b.rank - a.rank,
  rating: (a: Profile, b: Profile) => b.evalRatingAvg - a.evalRatingAvg || b.evalRatingCount - a.evalRatingCount,
  reviews: (a: Profile, b: Profile) => b.evalRatingCount - a.evalRatingCount || b.evalRatingAvg - a.evalRatingAvg,
  years: (a: Profile, b: Profile) => b.yearsExp - a.yearsExp,
  evals: (a: Profile, b: Profile) => b.completedCount - a.completedCount,
  fast: (a: Profile, b: Profile) => replyHours(a) - replyHours(b),
  new: (a: Profile, b: Profile) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
};
export type EvaluatorSort = keyof typeof EVALUATOR_SORTS;

export const NO_FILTERS = { search: "", cat: "", years: 0, rating: 0, mode: "", verified: false, accepting: false };
export type EvaluatorFilters = typeof NO_FILTERS;

/** Evaluators matching every filter, in the chosen order. A rating filter skips the unrated. */
export function findEvaluators(all: Profile[], f: EvaluatorFilters, sort: EvaluatorSort): Profile[] {
  const q = f.search.trim().toLowerCase();
  return all
    .filter(
      (p) =>
        (!q || [p.name, p.headline, ...p.titles, ...(p.skillsLower ?? p.skills)].some((s) => s.toLowerCase().includes(q))) &&
        (!f.cat || p.categories.includes(f.cat as Category)) &&
        p.yearsExp >= f.years &&
        (!f.rating || (p.evalRatingCount > 0 && p.evalRatingAvg >= f.rating)) &&
        (!f.mode || p.modes.includes(f.mode as Profile["modes"][number])) &&
        (!f.verified || p.verified) &&
        (!f.accepting || p.accepting),
    )
    .sort(EVALUATOR_SORTS[sort]);
}
