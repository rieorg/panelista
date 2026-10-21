import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/server";

// Public evaluator list for /evaluators, cached on Vercel's CDN. Before this, every
// visit read every evaluator from Firestore (and needed an App Check token first);
// now Firestore is read at most once per region every 5 minutes.
// ponytail: up to 5 minutes stale (new evaluators, Away, bans); purge by cache tag if that ever matters.
const MAX = 500;
// Only what the list, its filters and its sorts use (src/lib/evaluators.ts, EvaluatorCard).
const FIELDS = [
  "name", "photoURL", "headline", "titles", "skills", "skillsLower", "categories", "yearsExp", "modes", "verified", "accepting",
  "rank", "evalRatingAvg", "evalRatingCount", "completedCount", "responseCount", "missedCount", "avgResponseHours", "createdAt",
];

export async function GET() {
  const snap = await db().collection("profiles").where("isEvaluator", "==", true).orderBy("rank", "desc").limit(MAX).select(...FIELDS).get();
  const rows = snap.docs.map((d) => {
    const { createdAt, ...p } = d.data();
    return { ...p, uid: d.id, createdAt: createdAt instanceof Timestamp ? createdAt.toMillis() : undefined };
  });
  // Vercel-CDN-Cache-Control is read only by Vercel's CDN, so the browser still sees no-store (next.config.ts).
  return Response.json(rows, { headers: { "Vercel-CDN-Cache-Control": "max-age=300, stale-while-revalidate=3600" } });
}
