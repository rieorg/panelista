import type { Timestamp } from "@/lib/firestore";
import { body, db, FieldValue, HttpError, rateLimit, requireUser, route } from "@/lib/server";
import { id as idSchema, projectPatchSchema } from "@/lib/schemas";
import { deadlineEnd, looksLikeSecret, projectStatusFor } from "@/lib/domain";

export const PATCH = route(async (req, ctx) => {
  const user = await requireUser(req);
  const id = idSchema(64).parse((await ctx.params).id);
  const input = projectPatchSchema.parse(await body(req));
  if (input.abstract && looksLikeSecret(input.abstract)) throw new HttpError(400, "secret-in-public");
  await rateLimit(user.uid, "project-edit", 60);
  const ref = db().doc(`projects/${id}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "not-found");
    if (snap.get("ownerUid") !== user.uid) throw new HttpError(403, "not-owner");
    const { status, deadline, ...rest } = input;
    const needed = rest.needed ?? snap.get("needed");
    // Otherwise the card reads "3/2 evaluators".
    if (rest.needed !== undefined && needed < (snap.get("acceptedCount") ?? 0)) throw new HttpError(409, "needed-below-accepted");
    const current = status === "closed" ? "closed" : status === "open" ? "open" : snap.get("status");
    const next = projectStatusFor(current, snap.get("acceptedCount"), needed);
    // A project past its deadline cannot be open: the hourly cron would close it again with no word to the owner.
    const end = deadline ? deadlineEnd(deadline) : (snap.get("deadline") as Timestamp | undefined)?.toDate();
    if (next !== "closed" && end && end.getTime() < Date.now()) throw new HttpError(400, "deadline-past");
    tx.update(ref, {
      ...rest,
      ...(rest.stack ? { stackLower: rest.stack.map((s) => s.toLowerCase()) } : {}),
      ...(deadline ? { deadline: deadlineEnd(deadline) } : {}),
      status: next,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});
