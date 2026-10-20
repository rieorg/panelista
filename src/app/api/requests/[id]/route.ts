import { body, db, FieldValue, HttpError, rateLimit, requireNoPendingReview, requireUser, route } from "@/lib/server";
import { actionSchema } from "@/lib/schemas";
import { projectStatusFor, rankFor, sideOf, transition, type RequestLike } from "@/lib/domain";
import { mails, notify, type MailReq } from "@/lib/mail";
import type { Timestamp } from "firebase-admin/firestore";

const SYSTEM_TEXT = { accepted: "accepted", declined: "declined", cancelled: "cancelled", completed: "completed" } as const;

export const POST = route(async (req, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { action } = actionSchema.parse(await body(req));
  await rateLimit(user.uid, "action", 100);
  const ref = db().doc(`requests/${id}`);

  const done = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "not-found");
    const r = snap.data() as RequestLike & MailReq & { projectId: string; createdAt: Timestamp };
    const t = transition(r, user.uid, action);
    if (!t.ok) throw new HttpError(409, t.error);
    if (t.next === "accepted" && sideOf(r, user.uid) === "student") await requireNoPendingReview(user.uid);

    const projectRef = db().doc(`projects/${r.projectId}`);
    const evalRef = db().doc(`profiles/${r.evaluatorUid}`);
    const [project, evaluator] = await Promise.all([tx.get(projectRef), tx.get(evalRef)]);
    const accepted = (project.get("acceptedCount") as number) ?? 0;
    const needed = (project.get("needed") as number) ?? 1;
    const projStatus = project.get("status") as "open" | "filled" | "closed";

    const evalUpdate: Record<string, unknown> = {};
    // Responsiveness only counts the evaluator answering a student's invite. An answer
    // also ends a run of expired invites (see /api/cron) and lifts the answer rate in the rank.
    if ((action === "accept" || action === "decline") && sideOf(r, user.uid) === "evaluator") {
      const hours = Math.max(0, (Date.now() - r.createdAt.toMillis()) / 36e5);
      const count = ((evaluator.get("responseCount") as number) ?? 0) + 1;
      const sum = ((evaluator.get("responseHoursSum") as number) ?? 0) + hours;
      Object.assign(evalUpdate, {
        responseCount: count,
        responseHoursSum: sum,
        avgResponseHours: Math.round((sum / count) * 10) / 10,
        missedStreak: 0,
        rank: rankFor({ ...evaluator.data(), responseCount: count }),
      });
    }

    if (t.next === "accepted") {
      if (projStatus !== "open") throw new HttpError(409, "project-not-open");
      // Re-check the evaluator at accept time: they may be banned or full since offering.
      if (evaluator.get("banned") || !evaluator.get("isEvaluator")) throw new HttpError(409, "not-evaluator");
      if ((evaluator.get("activeCount") ?? 0) >= (evaluator.get("maxActive") ?? 5)) throw new HttpError(409, "evaluator-full");
      tx.update(projectRef, { acceptedCount: accepted + 1, status: projectStatusFor(projStatus, accepted + 1, needed) });
      evalUpdate.activeCount = FieldValue.increment(1);
    } else if (t.next === "cancelled" && r.status === "accepted") {
      tx.update(projectRef, { acceptedCount: Math.max(0, accepted - 1), status: projectStatusFor(projStatus, accepted - 1, needed) });
      evalUpdate.activeCount = FieldValue.increment(-1);
    } else if (t.next === "completed") {
      evalUpdate.activeCount = FieldValue.increment(-1);
      evalUpdate.completedCount = FieldValue.increment(1);
    }
    if (Object.keys(evalUpdate).length) tx.update(evalRef, evalUpdate);

    const now = FieldValue.serverTimestamp();
    tx.update(ref, {
      status: t.next,
      updatedAt: now,
      lastMessage: `[${SYSTEM_TEXT[t.next as keyof typeof SYSTEM_TEXT]}]`,
      lastSender: user.uid,
      lastMessageAt: now,
      ...(t.next === "accepted" || t.next === "declined" ? { respondedAt: now } : {}),
      ...(t.next === "completed" ? { completedAt: now } : {}),
    });
    tx.set(ref.collection("messages").doc(), { senderUid: user.uid, system: t.next, text: "", createdAt: now });
    return { r: { ...r, id }, next: t.next, was: r.status };
  });
  // Withdrawing an unanswered request sends nothing, so cancel/re-ask loops can't spam the other side.
  if (!(done.next === "cancelled" && done.was === "pending")) notify([mails.action(done.r, user.uid, action)]);
  return { ok: true };
});
