import { adminAuth, body, db, FieldValue, HttpError, requireAdmin, route } from "@/lib/server";
import { adminBanSchema, adminVerifySchema, id } from "@/lib/schemas";
import { rankFor } from "@/lib/domain";
import { z } from "zod";

const schema = z.discriminatedUnion("op", [
  adminVerifySchema.extend({ op: z.literal("verify") }),
  adminBanSchema.extend({ op: z.literal("ban") }),
  z.object({ op: z.literal("resolveReport"), id: id(64) }),
]);

export const POST = route(async (req) => {
  const admin = await requireAdmin(req);
  const input = schema.parse(await body(req));

  if (input.op === "verify") {
    const approve = input.decision === "approve";
    await db().runTransaction(async (tx) => {
      const pRef = db().doc(`profiles/${input.uid}`);
      const p = await tx.get(pRef);
      if (!p.exists) throw new HttpError(404, "not-found");
      tx.update(pRef, { verified: approve, rank: rankFor({ ...p.data(), verified: approve }) });
      tx.update(db().doc(`verifications/${input.uid}`), {
        status: approve ? "approved" : "rejected",
        reason: input.reason,
        reviewerUid: admin.uid,
        reviewedAt: FieldValue.serverTimestamp(),
      });
    });
  } else if (input.op === "ban") {
    await adminAuth().updateUser(input.uid, { disabled: input.banned });
    if (input.banned) await adminAuth().revokeRefreshTokens(input.uid);
    await db().doc(`profiles/${input.uid}`).update(input.banned ? { banned: true, isEvaluator: false, accepting: false } : { banned: false });
    if (input.banned) {
      const projects = await db().collection("projects").where("ownerUid", "==", input.uid).where("status", "in", ["open", "filled"]).get();
      const batch = db().batch();
      projects.forEach((d) => batch.update(d.ref, { status: "closed" }));
      await batch.commit();
    }
  } else {
    await db().doc(`reports/${input.id}`).update({ status: "resolved", resolvedBy: admin.uid, resolvedAt: FieldValue.serverTimestamp() });
  }
  return { ok: true };
});
