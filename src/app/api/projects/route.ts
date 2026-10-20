import { body, db, FieldValue, HttpError, rateLimit, requireNoPendingReview, requireUser, route } from "@/lib/server";
import { projectSchema } from "@/lib/schemas";
import { looksLikeSecret } from "@/lib/domain";

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
