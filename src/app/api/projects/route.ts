import { Timestamp } from "firebase-admin/firestore";
import { body, db, FieldValue, HttpError, rateLimit, requireNoPendingReview, requireUser, route } from "@/lib/server";
import { projectSchema } from "@/lib/schemas";
import { looksLikeSecret } from "@/lib/domain";

// Public list of open projects for /projects, cached on Vercel's CDN like /api/evaluators:
// Firestore is read at most once per region every 5 minutes instead of on every visit.
// ponytail: a new project shows up in the list within 5 minutes; past 300 open projects, page it server-side.
const OPEN_MAX = 300;
// Only what ProjectCard and the category filter use.
const CARD_FIELDS = ["ownerName", "ownerPhoto", "title", "abstract", "school", "course", "categories", "needed", "acceptedCount", "minYears", "deadline"];

export async function GET() {
  const snap = await db().collection("projects").where("status", "==", "open").orderBy("createdAt", "desc").limit(OPEN_MAX).select(...CARD_FIELDS).get();
  const rows = snap.docs.map((d) => {
    const { deadline, abstract, ...p } = d.data();
    // The card shows three lines of the abstract; the full text is on the project page.
    return { ...p, id: d.id, abstract: String(abstract ?? "").slice(0, 400), deadline: deadline instanceof Timestamp ? deadline.toMillis() : 0 };
  });
  // Vercel-CDN-Cache-Control is read only by Vercel's CDN, so the browser still sees no-store (next.config.ts).
  return Response.json(rows, { headers: { "Vercel-CDN-Cache-Control": "max-age=300, stale-while-revalidate=3600" } });
}

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = projectSchema.parse(await body(req));
  if (new Date(input.deadline).getTime() < Date.now() - 864e5) throw new HttpError(400, "deadline-past");
  if (looksLikeSecret(input.abstract)) throw new HttpError(400, "secret-in-public");
  const owner = await db().doc(`profiles/${user.uid}`).get();
  if (!owner.exists) throw new HttpError(400, "no-profile");
  await requireNoPendingReview(user.uid);
  await rateLimit(user.uid, "project", 5);
  const ref = db().collection("projects").doc();
  await ref.set({
    ...input,
    deadline: new Date(input.deadline + "T23:59:59+08:00"),
    stackLower: input.stack.map((s) => s.toLowerCase()),
    ownerUid: user.uid,
    ownerName: owner.get("name"),
    ownerPhoto: owner.get("photoURL") ?? "",
    acceptedCount: 0,
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
});
