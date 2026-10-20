import { timingSafeEqual } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db, FieldValue, HttpError, route } from "@/lib/server";
import { AWAY_AFTER, isStale, rankFor, REMIND_AFTER_DAYS } from "@/lib/domain";
import { mails, notify, type MailReq, type Note } from "@/lib/mail";

// Hourly, triggered by the Worker cron with CRON_SECRET. It lives in the app,
// not the Worker, because it sends mail and needs account emails (Firebase Auth).
export const maxDuration = 300;

function requireCron(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(401, "unauthorized");
}

/** Expires one pending request and returns the mails it causes (none if it changed meanwhile). */
async function expire(ref: DocumentReference): Promise<Note[]> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("status") !== "pending") return [];
    const r = { ...(snap.data() as MailReq), id: ref.id };
    const notes = [mails.expired(r)];
    // Only an invite the evaluator ignored counts against them; a student ignoring an offer costs nobody.
    const evalRef = db().doc(`profiles/${r.evaluatorUid}`);
    const ev = r.initiatedBy === "student" ? await tx.get(evalRef) : null;

    const now = FieldValue.serverTimestamp();
    if (ev?.exists) {
      const missed = ((ev.get("missedCount") as number) ?? 0) + 1;
      // Invites from before they came back from Away still count in the rate, not toward a new Away.
      const backAt = ev.get("backAt") as Timestamp | undefined;
      const fresh = !backAt || (snap.get("createdAt") as Timestamp).toMillis() > backAt.toMillis();
      const streak = ((ev.get("missedStreak") as number) ?? 0) + (fresh ? 1 : 0);
      const away = streak >= AWAY_AFTER && ev.get("accepting") === true;
      tx.update(evalRef, { missedCount: missed, missedStreak: streak, rank: rankFor({ ...ev.data(), missedCount: missed }), ...(away ? { accepting: false } : {}) });
      if (away) notes.push(mails.away(r.evaluatorUid, streak));
    }
    // lastSender "" marks the thread unread for both sides.
    tx.update(ref, { status: "expired", updatedAt: now, lastMessage: "[expired]", lastSender: "", lastMessageAt: now });
    tx.set(ref.collection("messages").doc(), { senderUid: "", system: "expired", text: "", createdAt: now });
    return notes;
  });
}

/** One reminder per request, only while it is still pending (safe if two cron runs overlap). */
async function remind(ref: DocumentReference): Promise<Note[]> {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.get("status") !== "pending" || snap.get("remindedAt")) return [];
    tx.update(ref, { remindedAt: FieldValue.serverTimestamp() });
    return [mails.reminder({ ...(snap.data() as MailReq), id: ref.id })];
  });
}

export const POST = route(
  async (req) => {
    requireCron(req);
    const now = Date.now();
    // Pending past the reminder age, oldest first: the stale ones expire, the rest get one reminder.
    // ponytail: 300 per run; the hourly cron catches up on the rest next hour.
    const due = await db()
      .collection("requests")
      .where("status", "==", "pending")
      .where("createdAt", "<", new Date(now - REMIND_AFTER_DAYS * 864e5))
      .orderBy("createdAt")
      .limit(300)
      .get();
    const notes: Note[] = [];
    let expired = 0;
    let reminded = 0;
    for (const d of due.docs) {
      if (isStale(d.get("createdAt").toMillis(), now)) {
        const n = await expire(d.ref);
        if (n.length) expired++;
        notes.push(...n);
      } else if (!d.get("remindedAt")) {
        const n = await remind(d.ref);
        reminded += n.length;
        notes.push(...n);
      }
    }
    notify(notes);
    return { expired, reminded, mails: notes.length };
  },
  { appCheck: false },
);
