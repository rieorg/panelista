import { body, db, FieldValue, rateLimit, requireUser, route } from "@/lib/server";
import { profileSchema } from "@/lib/schemas";
import { rankFor, rankScore } from "@/lib/domain";

// Upsert the caller's own profile. Server-owned fields (ratings, verified,
// counters, banned) are never taken from the client.
export const PUT = route(async (req) => {
  const user = await requireUser(req);
  const input = profileSchema.parse(await body(req));
  await rateLimit(user.uid, "profile", 60);
  const ref = db().doc(`profiles/${user.uid}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const base = {
      ...input,
      skillsLower: input.skills.map((s) => s.toLowerCase()),
      photoURL: user.picture ?? "",
      // Public Admin badge mirrors the custom claim; clients can never write it (rules deny profile writes).
      isAdmin: user.admin === true,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (snap.exists) {
      // The badge vouches for who you are: changing identity fields drops it until re-reviewed.
      const identityChanged = (["name", "headline", "linkedin", "yearsExp"] as const).some((k) => snap.get(k) !== input[k]);
      const unverify = identityChanged && snap.get("verified") === true;
      tx.update(ref, {
        ...base,
        ...(unverify ? { verified: false, rank: rankFor({ ...snap.data(), verified: false }) } : {}),
        // Back from Away (see /api/cron): a fresh start on the expired-invite streak.
        ...(input.accepting && snap.get("accepting") === false ? { missedStreak: 0, backAt: FieldValue.serverTimestamp() } : {}),
      });
    } else {
      tx.set(ref, {
        ...base,
        verified: false,
        banned: false,
        evalRatingSum: 0,
        evalRatingCount: 0,
        evalRatingAvg: 0,
        studentRatingSum: 0,
        studentRatingCount: 0,
        studentRatingAvg: 0,
        completedCount: 0,
        activeCount: 0,
        responseCount: 0,
        responseHoursSum: 0,
        rank: rankScore(0, 0, false),
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { ok: true };
});
