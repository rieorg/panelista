import { adminAuth, body, db, FieldValue, HttpError, requireAdmin, route } from "@/lib/server";
import { adminBanSchema, adminVerifySchema, id } from "@/lib/schemas";
import { identityChanged, rankFor } from "@/lib/domain";
import { z } from "zod";

// Shown to the user inside "Na-reject po: {r}. Pwede po kayong mag-submit ulit." / "Rejected: {r}. You can submit again."
const STALE_REASON = "profile changed after applying (name, headline, link or years)";

const schema = z.discriminatedUnion("op", [
  adminVerifySchema.extend({ op: z.literal("verify") }),
  adminBanSchema.extend({ op: z.literal("ban") }),
  z.object({ op: z.literal("resolveReport"), id: id(64) }),
]);

export const POST = route(async (req) => {
  const admin = await requireAdmin(req);
  const input = schema.parse(await body(req));

  if (input.op === "verify") {
    const stale = await db().runTransaction(async (tx) => {
      const pRef = db().doc(`profiles/${input.uid}`);
      const vRef = db().doc(`verifications/${input.uid}`);
      const [p, v] = await Promise.all([tx.get(pRef), tx.get(vRef)]);
      if (!p.exists || !v.exists) throw new HttpError(404, "not-found");
      // The admin checked the proof against the name, headline, link and years the application was sent with.
      // If the profile says something else by now, approving would badge an identity nobody reviewed:
      // the application is turned down with that reason, and the user applies again as they are now.
      const stale = input.decision === "approve" && identityChanged(v.data() ?? {}, p.data() ?? {});
      const verified = input.decision === "approve" && !stale;
      tx.update(pRef, { verified, rank: rankFor({ ...p.data(), verified }) });
      tx.update(vRef, {
        status: verified ? "approved" : "rejected",
        reason: stale ? STALE_REASON : input.reason,
        reviewerUid: admin.uid,
        reviewedAt: FieldValue.serverTimestamp(),
      });
      return stale;
    });
    return { ok: true, stale };
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
