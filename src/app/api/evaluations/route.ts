import { body, db, FieldValue, HttpError, rateLimit, requireUser, route } from "@/lib/server";
import { evaluationSchema } from "@/lib/schemas";
import { mails, notify, type MailReq } from "@/lib/mail";

// The evaluator's ISO 25010 answers for one request. Saved as evaluations/{requestId},
// editable while the request is accepted or completed; the student's results page tabulates them.
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = evaluationSchema.parse(await body(req));
  await rateLimit(user.uid, "evaluation", 30);

  const r = await db().doc(`requests/${input.requestId}`).get();
  if (!r.exists) throw new HttpError(404, "not-found");
  if (r.get("evaluatorUid") !== user.uid) throw new HttpError(403, "not-evaluator");
  if (!["accepted", "completed"].includes(r.get("status"))) throw new HttpError(409, "not-accepted");

  const ref = db().doc(`evaluations/${input.requestId}`);
  const data = {
    requestId: input.requestId,
    projectId: r.get("projectId"),
    studentUid: r.get("studentUid"),
    evaluatorUid: user.uid,
    evaluatorName: r.get("evaluatorName"),
    scores: input.scores,
    comments: input.comments,
    updatedAt: FieldValue.serverTimestamp(),
  };
  // create() is atomic, so only the very first submission emails the student.
  const first = await ref.create(data).then(
    () => true,
    (e: { code?: number }) => {
      if (e.code !== 6) throw e; // 6 = ALREADY_EXISTS
      return false;
    },
  );
  if (!first) {
    // Once completed, the certificate and /c show this score: no silent edits after that.
    if (r.get("status") === "completed") throw new HttpError(409, "evaluation-locked");
    await ref.set(data);
  }
  if (first) notify([mails.evaluated({ ...(r.data() as MailReq), id: r.id }, r.get("projectId"))]);
  return { ok: true };
});
