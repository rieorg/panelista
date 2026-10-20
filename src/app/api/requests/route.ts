import { body, db, FieldValue, HttpError, rateLimit, requireNoPendingReview, requireUser, route } from "@/lib/server";
import { createRequestSchema } from "@/lib/schemas";
import { requestId, type Side } from "@/lib/domain";
import { mails, notify, type MailReq } from "@/lib/mail";

// A request links one project with one evaluator. The project owner can invite
// an evaluator, or an evaluator can offer to evaluate an open project.
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = createRequestSchema.parse(await body(req));
  // Anyone but the evaluator is asking as the student (the owner check below rejects the rest).
  if (user.uid !== input.evaluatorUid) await requireNoPendingReview(user.uid);
  await rateLimit(user.uid, "request", 20);

  const id = requestId(input.projectId, input.evaluatorUid);
  const ref = db().doc(`requests/${id}`);
  const projectRef = db().doc(`projects/${input.projectId}`);
  const evalRef = db().doc(`profiles/${input.evaluatorUid}`);
  // Unanswered invites already waiting on this evaluator: no more than they take at once,
  // so students stop piling onto a silent account. Equality-only, single-field indexes.
  // ponytail: counted outside the transaction, so two invites at the same moment can pass the cap by one.
  const waiting =
    user.uid === input.evaluatorUid
      ? 0
      : (
          await db()
            .collection("requests")
            .where("evaluatorUid", "==", input.evaluatorUid)
            .where("status", "==", "pending")
            .where("initiatedBy", "==", "student")
            .count()
            .get()
        ).data().count;

  const created = await db().runTransaction(async (tx): Promise<{ doc: MailReq; quiet: boolean }> => {
    const [existing, project, evaluator] = await Promise.all([tx.get(ref), tx.get(projectRef), tx.get(evalRef)]);
    if (!project.exists || !evaluator.exists) throw new HttpError(404, "not-found");
    if (project.get("status") !== "open") throw new HttpError(409, "project-not-open");
    if (!evaluator.get("isEvaluator") || evaluator.get("banned")) throw new HttpError(409, "not-evaluator");

    const ownerUid = project.get("ownerUid") as string;
    if (ownerUid === input.evaluatorUid) throw new HttpError(400, "self");

    let initiatedBy: Side;
    if (user.uid === ownerUid) {
      initiatedBy = "student";
      if (!evaluator.get("accepting")) throw new HttpError(409, "not-accepting");
      if ((evaluator.get("activeCount") ?? 0) >= (evaluator.get("maxActive") ?? 5)) throw new HttpError(409, "evaluator-full");
      if (waiting >= (evaluator.get("maxActive") ?? 5)) throw new HttpError(409, "evaluator-busy");
    } else if (user.uid === input.evaluatorUid) {
      initiatedBy = "evaluator";
      if ((evaluator.get("yearsExp") ?? 0) < (project.get("minYears") ?? 0)) throw new HttpError(409, "below-min-years");
    } else {
      throw new HttpError(403, "not-allowed");
    }

    if (existing.exists) {
      const s = existing.get("status");
      // Re-asking is fine after a cancel or expiry, never after a decline.
      if (s !== "cancelled" && s !== "expired") throw new HttpError(409, s === "declined" ? "declined-before" : "exists");
    }
    // A re-ask after a cancel shows in the inbox but sends no mail (no cancel/re-ask spam).
    const quiet = existing.get("status") === "cancelled";

    const student = await tx.get(db().doc(`profiles/${ownerUid}`));
    const doc: MailReq = {
      id,
      projectTitle: project.get("title"),
      studentUid: ownerUid,
      studentName: student.get("name") ?? project.get("ownerName"),
      evaluatorUid: input.evaluatorUid,
      evaluatorName: evaluator.get("name"),
      initiatedBy,
    };
    tx.set(ref, {
      projectId: input.projectId,
      projectTitle: doc.projectTitle,
      studentUid: ownerUid,
      studentName: doc.studentName,
      studentPhoto: student.get("photoURL") ?? "",
      evaluatorUid: input.evaluatorUid,
      evaluatorName: doc.evaluatorName,
      evaluatorPhoto: evaluator.get("photoURL") ?? "",
      participants: [ownerUid, input.evaluatorUid],
      initiatedBy,
      status: "pending",
      note: input.note,
      lastMessage: input.note.slice(0, 120),
      lastSender: user.uid,
      lastMessageAt: FieldValue.serverTimestamp(),
      reviewedByStudent: false,
      reviewedByEvaluator: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (input.note) {
      tx.set(ref.collection("messages").doc(), { senderUid: user.uid, text: input.note, createdAt: FieldValue.serverTimestamp() });
    }
    return { doc, quiet };
  });
  if (!created.quiet) notify([mails.created(created.doc)]);
  return { id };
});
