import { adminAuth, body, db, FieldValue, HttpError, requireUser, route } from "@/lib/server";
import { reviewSchema } from "@/lib/schemas";
import { average, rankFor, reviewId, sideOf, type RequestLike } from "@/lib/domain";

// Marketplace-style two-way rating, allowed once per side after completion.
const MIN_ACCOUNT_DAYS = 3;
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = reviewSchema.parse(await body(req));
  const reqRef = db().doc(`requests/${input.requestId}`);
  const accountCreated = Date.parse((await adminAuth().getUser(user.uid)).metadata.creationTime);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpError(404, "not-found");
    const r = snap.data() as RequestLike & { projectTitle: string };
    const side = sideOf(r, user.uid);
    if (!side) throw new HttpError(403, "not-participant");
    if (r.status !== "completed") throw new HttpError(409, "not-completed");

    const revRef = db().doc(`reviews/${reviewId(input.requestId, side)}`);
    const toUid = side === "student" ? r.evaluatorUid : r.studentUid;
    const targetRef = db().doc(`profiles/${toUid}`);
    const [existing, target, me, earlier] = await Promise.all([
      tx.get(revRef),
      tx.get(targetRef),
      tx.get(db().doc(`profiles/${user.uid}`)),
      tx.get(db().collection("reviews").where("fromUid", "==", user.uid).where("toUid", "==", toUid).limit(1)),
    ]);
    if (existing.exists) throw new HttpError(409, "already-reviewed");

    // Anti review-farming: only a reviewer's first review of this person, from an
    // account at least MIN_ACCOUNT_DAYS old, moves the rating. The text still shows.
    const counted = earlier.empty && Date.now() - accountCreated >= MIN_ACCOUNT_DAYS * 864e5;
    if (counted) {
      const prefix = side === "student" ? "evalRating" : "studentRating";
      const sum = ((target.get(`${prefix}Sum`) as number) ?? 0) + input.stars;
      const count = ((target.get(`${prefix}Count`) as number) ?? 0) + 1;
      tx.update(targetRef, {
        [`${prefix}Sum`]: sum,
        [`${prefix}Count`]: count,
        [`${prefix}Avg`]: average(sum, count),
        ...(side === "student" ? { rank: rankFor({ ...target.data(), evalRatingSum: sum, evalRatingCount: count }) } : {}),
      });
    }
    tx.create(revRef, {
      requestId: input.requestId,
      direction: side === "student" ? "toEvaluator" : "toStudent",
      fromUid: user.uid,
      fromName: me.get("name") ?? "",
      fromPhoto: me.get("photoURL") ?? "",
      toUid,
      stars: input.stars,
      tags: input.tags,
      text: input.text,
      counted,
      projectTitle: r.projectTitle,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(reqRef, { [side === "student" ? "reviewedByStudent" : "reviewedByEvaluator"]: true });
  });
  return { ok: true };
});
