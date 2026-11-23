// firestore.rules against the Firestore emulator: `npm run test:emu` (needs Java 21+, see CONTRIBUTING.md).
// Clients are the real web SDK with a mock sign-in token; data is seeded with the Admin SDK, which skips rules.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { addDoc, collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, where, writeBatch, type Firestore } from "firebase/firestore";
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "").split(":");
const projectId = process.env.GCLOUD_PROJECT ?? "";
assert.ok(host && port && projectId.startsWith("demo-"), "run through `npm run test:emu`: these tests only ever talk to the emulator");

process.env.METADATA_SERVER_DETECTION ??= "none"; // no credentials are needed, so do not go looking for a metadata server
setLogLevel("silent"); // every refusal below would otherwise be logged as a warning

const adminApp = initializeAdminApp({ projectId }, "rules-seed");
const admin = getAdminFirestore(adminApp);
const apps: FirebaseApp[] = [];

/** A browser client signed in as `uid` (null: signed out). Email verified unless a claim says otherwise. */
function as(uid: string | null, claims: Record<string, unknown> = {}): Firestore {
  const app = initializeApp({ projectId, apiKey: "demo-key" }, `client-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, host, Number(port), uid ? { mockUserToken: { sub: uid, user_id: uid, email_verified: true, ...claims } } : {});
  return db;
}
const denied = (p: Promise<unknown>, why: string) => assert.rejects(p, { code: "permission-denied" }, why);

const anon = as(null);
const student = as("S");
const evaluator = as("E");
const stranger = as("X");
const unverified = as("E", { email_verified: false });
const boss = as("A", { admin: true });

const now = new Date();
const request = (status: string) => ({
  projectId: "p1", projectTitle: "Health Records", studentUid: "S", studentName: "Juan", evaluatorUid: "E", evaluatorName: "Ana", participants: ["S", "E"],
  initiatedBy: "student", status, note: "", lastMessage: "", lastSender: "S", lastMessageAt: now, reviewedByStudent: false, reviewedByEvaluator: false, createdAt: now,
});

before(async () => {
  // A clean slate, whatever an earlier run or the other test file left behind.
  await fetch(`http://${host}:${port}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  const b = admin.batch();
  for (const uid of ["S", "E", "X"]) b.set(admin.doc(`profiles/${uid}`), { name: uid, isEvaluator: uid === "E", verified: false, banned: false, rank: 4 });
  b.set(admin.doc("projects/p1"), { ownerUid: "S", title: "Health Records", status: "open", createdAt: now });
  b.set(admin.doc("reviews/p1_E_student"), { toUid: "E", fromUid: "S", direction: "toEvaluator", stars: 5, createdAt: now });
  b.set(admin.doc("requests/open"), request("accepted"));
  b.set(admin.doc("requests/done"), request("completed"));
  b.set(admin.doc("requests/waiting"), request("pending"));
  b.set(admin.doc("requests/dead"), request("declined"));
  b.set(admin.doc("requests/open/messages/m1"), { senderUid: "S", text: "hello", createdAt: now });
  b.set(admin.doc("evaluations/open"), { requestId: "open", projectId: "p1", studentUid: "S", evaluatorUid: "E", scores: {}, comments: "" });
  b.set(admin.doc("verifications/E"), { uid: "E", status: "pending", submittedAt: now, files: [] });
  b.set(admin.doc("reports/r1"), { targetUid: "E", reporterUid: "S", status: "open", createdAt: now });
  b.set(admin.doc("ratelimits/S_request_2026-01-01"), { n: 20 });
  b.set(admin.doc("clientErrors/c1"), { message: "boom" });
  await b.commit();
});

after(async () => {
  await Promise.all(apps.map((a) => deleteApp(a)));
  await deleteAdminApp(adminApp);
});

test("profiles, projects and reviews are public to read, one at a time or in pages of 50 at most", async () => {
  for (const name of ["profiles", "projects", "reviews"]) {
    const id = { profiles: "E", projects: "p1", reviews: "p1_E_student" }[name]!;
    assert.equal((await getDoc(doc(anon, name, id))).exists(), true, `${name}: signed out can read one`);
    assert.ok((await getDocs(query(collection(anon, name), limit(50)))).size >= 1, `${name}: a page of 50`);
    await denied(getDocs(query(collection(anon, name), limit(51))), `${name}: a page of 51`);
    await denied(getDocs(collection(anon, name)), `${name}: the whole collection`);
    await denied(getDocs(collection(boss, name)), `${name}: the whole collection, even as admin`);
  }
  assert.equal((await getDocs(query(collection(anon, "reviews"), where("toUid", "==", "E"), where("direction", "==", "toEvaluator"), orderBy("createdAt", "desc"), limit(30)))).size, 1, "the profile page's review query");
});

test("no browser can write a profile, project, review, request, evaluation, verification or report", async () => {
  // Every one of these goes through the API. If a rule ever allowed it, a user could badge, unban or rate themselves.
  await denied(updateDoc(doc(evaluator, "profiles/E"), { verified: true }), "self-verify");
  await denied(updateDoc(doc(evaluator, "profiles/E"), { banned: false, rank: 99, evalRatingAvg: 5 }), "unban, rank");
  await denied(setDoc(doc(stranger, "profiles/X"), { name: "X", verified: true }), "create own profile directly");
  await denied(setDoc(doc(stranger, "profiles/new"), { name: "ghost" }), "create a profile");
  await denied(deleteDoc(doc(student, "profiles/S")), "delete own profile");
  await denied(updateDoc(doc(student, "projects/p1"), { status: "closed" }), "owner edits the project directly");
  await denied(addDoc(collection(student, "projects"), { ownerUid: "S", title: "x" }), "create a project");
  await denied(setDoc(doc(student, "reviews/fake"), { toUid: "E", fromUid: "S", stars: 5, direction: "toEvaluator" }), "write a review");
  await denied(updateDoc(doc(evaluator, "reviews/p1_E_student"), { stars: 1 }), "edit a review about yourself");
  await denied(setDoc(doc(student, "requests/p1_X"), request("accepted")), "create a request");
  await denied(deleteDoc(doc(student, "requests/open")), "delete a request");
  await denied(setDoc(doc(evaluator, "evaluations/done"), { studentUid: "S", evaluatorUid: "E", scores: {} }), "write an evaluation");
  await denied(updateDoc(doc(evaluator, "evaluations/open"), { scores: { fs1: 5 } }), "edit an evaluation");
  await denied(updateDoc(doc(evaluator, "verifications/E"), { status: "approved" }), "approve yourself");
  await denied(addDoc(collection(student, "reports"), { targetUid: "E", status: "open" }), "file a report directly");
  await denied(setDoc(doc(boss, "profiles/A"), { name: "A", isAdmin: true }), "not even the admin writes from the browser");
});

test("a request is readable by its two participants and the admin only", async () => {
  assert.equal((await getDoc(doc(student, "requests/open"))).exists(), true);
  assert.equal((await getDoc(doc(evaluator, "requests/open"))).exists(), true);
  assert.equal((await getDoc(doc(boss, "requests/open"))).exists(), true);
  await denied(getDoc(doc(stranger, "requests/open")), "a stranger");
  await denied(getDoc(doc(anon, "requests/open")), "signed out");
  const inbox = (db: Firestore, uid: string) => getDocs(query(collection(db, "requests"), where("participants", "array-contains", uid), orderBy("lastMessageAt", "desc"), limit(50)));
  assert.equal((await inbox(student, "S")).size, 4, "the inbox query");
  await denied(inbox(stranger, "S"), "someone else's inbox");
  await denied(getDocs(query(collection(student, "requests"), limit(50))), "every request");
  await denied(getDocs(query(collection(student, "requests"), where("status", "==", "accepted"), limit(50))), "requests by status");
});

test("a participant may only bump the inbox preview, as themselves, at server time, once chat is open", async () => {
  const bump = (db: Firestore, id: string, data: Record<string, unknown>) => updateDoc(doc(db, "requests", id), data);
  const ok = { lastMessage: "hi", lastMessageAt: serverTimestamp(), lastSender: "E" };
  await bump(evaluator, "open", ok);
  await bump(evaluator, "done", ok);
  await denied(bump(evaluator, "waiting", ok), "not accepted yet");
  await denied(bump(evaluator, "dead", ok), "declined");
  await denied(bump(stranger, "open", { ...ok, lastSender: "X" }), "a stranger");
  await denied(bump(unverified, "open", ok), "email not verified");
  await denied(bump(evaluator, "open", { ...ok, lastSender: "S" }), "as the other person");
  await denied(bump(evaluator, "open", { ...ok, lastMessageAt: Timestamp.fromMillis(Date.now() + 864e5) }), "a time of their choosing");
  await denied(bump(evaluator, "open", { ...ok, lastMessage: "x".repeat(121) }), "a preview over 120 characters");
  await denied(bump(evaluator, "open", { ...ok, lastMessage: 5 }), "a preview that is not text");
  for (const [field, value] of [["status", "completed"], ["reviewedByStudent", true], ["reviewedByEvaluator", true], ["participants", ["E", "X"]], ["evaluatorName", "Dr. Ana"], ["studentUid", "E"], ["projectId", "p2"], ["completedAt", serverTimestamp()]] as const)
    await denied(bump(evaluator, "open", { ...ok, [field]: value }), `also changing ${field}`);
  await denied(bump(evaluator, "open", { status: "completed" }), "only the status");
});

test("chat: only participants, only once accepted, only as themselves, text only", async () => {
  const send = (db: Firestore, id: string, data: Record<string, unknown>) => addDoc(collection(db, "requests", id, "messages"), data);
  const msg = (senderUid: string, text = "hello") => ({ senderUid, text, createdAt: serverTimestamp() });
  await send(evaluator, "open", msg("E"));
  await send(student, "done", msg("S"));
  await send(evaluator, "open", msg("E", "x".repeat(2000)));
  await denied(send(evaluator, "waiting", msg("E")), "before the request is accepted");
  await denied(send(evaluator, "dead", msg("E")), "after a decline");
  await denied(send(stranger, "open", msg("X")), "a stranger");
  await denied(send(anon, "open", msg("S")), "signed out");
  await denied(send(unverified, "open", msg("E")), "email not verified");
  await denied(send(evaluator, "open", msg("S")), "as the other person");
  await denied(send(evaluator, "open", { ...msg("E"), system: "completed" }), "a forged system notice");
  await denied(send(evaluator, "open", { ...msg("E", ""), system: "accepted" }), "an empty forged notice");
  await denied(send(evaluator, "open", msg("E", "")), "an empty message");
  await denied(send(evaluator, "open", msg("E", "x".repeat(2001))), "over 2000 characters");
  await denied(send(evaluator, "open", { senderUid: "E", text: 5, createdAt: serverTimestamp() }), "text that is not text");
  await denied(send(evaluator, "open", { senderUid: "E", text: "hi", createdAt: Timestamp.fromMillis(0) }), "a time of their choosing");
  await denied(send(evaluator, "open", { senderUid: "E", text: "hi" }), "no time");
  await denied(send(evaluator, "nope", msg("E")), "a thread that does not exist");
  await denied(updateDoc(doc(student, "requests/open/messages/m1"), { text: "edited" }), "edit a sent message");
  await denied(deleteDoc(doc(student, "requests/open/messages/m1")), "delete a sent message");

  const thread = (db: Firestore) => getDocs(query(collection(db, "requests/open/messages"), orderBy("createdAt")));
  assert.ok((await thread(student)).size >= 3);
  assert.ok((await thread(boss)).size >= 3, "the admin can read a reported chat");
  await denied(thread(stranger), "a stranger reading the chat");
  await denied(thread(anon), "signed out reading the chat");

  // The page sends a message and the preview bump as one batch: both rules have to pass together.
  const batch = writeBatch(student);
  batch.set(doc(collection(student, "requests/open/messages")), msg("S", "batched"));
  batch.update(doc(student, "requests/open"), { lastMessage: "batched", lastMessageAt: serverTimestamp(), lastSender: "S" });
  await batch.commit();
});

test("ISO 25010 answers: the evaluator who wrote them and the student they are for", async () => {
  assert.equal((await getDoc(doc(evaluator, "evaluations/open"))).exists(), true);
  assert.equal((await getDoc(doc(student, "evaluations/open"))).exists(), true);
  assert.equal((await getDoc(doc(boss, "evaluations/open"))).exists(), true);
  await denied(getDoc(doc(stranger, "evaluations/open")), "a stranger");
  await denied(getDoc(doc(anon, "evaluations/open")), "signed out");
  assert.equal((await getDoc(doc(stranger, "evaluations/not-submitted"))).exists(), false, "a missing form reads as missing (the thread page asks before one exists)");
  await denied(getDoc(doc(anon, "evaluations/not-submitted")), "signed out, even for a missing one");
  const mine = (db: Firestore, uid: string) => getDocs(query(collection(db, "evaluations"), where("projectId", "==", "p1"), where("studentUid", "==", uid)));
  assert.equal((await mine(student, "S")).size, 1, "the results page query");
  await denied(mine(stranger, "S"), "another student's results");
  await denied(getDocs(query(collection(student, "evaluations"), where("projectId", "==", "p1"))), "a project's answers without being its student");
  await denied(getDocs(collection(evaluator, "evaluations")), "every evaluation");
});

test("verification files list, reports, rate limits and crash logs stay private", async () => {
  assert.equal((await getDoc(doc(evaluator, "verifications/E"))).exists(), true, "your own application");
  await denied(getDoc(doc(student, "verifications/E")), "someone else's application");
  await denied(getDoc(doc(anon, "verifications/E")), "signed out");
  const pending = (db: Firestore) => getDocs(query(collection(db, "verifications"), where("status", "==", "pending"), orderBy("submittedAt"), limit(50)));
  assert.equal((await pending(boss)).size, 1, "the admin queue");
  await denied(pending(evaluator), "the admin queue as a user");
  assert.equal((await getDocs(query(collection(boss, "reports"), where("status", "==", "open"), orderBy("createdAt", "desc"), limit(50)))).size, 1);
  await denied(getDoc(doc(evaluator, "reports/r1")), "the reported user reading the report");
  await denied(getDoc(doc(student, "reports/r1")), "the reporter reading it back");
  for (const db of [anon, student, boss]) {
    await denied(getDoc(doc(db, "ratelimits/S_request_2026-01-01")), "rate limit counters");
    await denied(setDoc(doc(db, "ratelimits/S_request_2026-01-01"), { n: 0 }), "resetting a rate limit");
    await denied(getDoc(doc(db, "clientErrors/c1")), "crash logs");
    await denied(getDoc(doc(db, "stats/2026-01-01")), "visit counts: even the admin reads them through the API");
    await denied(setDoc(doc(db, "stats/2026-01-01"), { visits: 9 }), "adding visits from a browser");
    await denied(setDoc(doc(db, "anything/else"), { x: 1 }), "a collection the rules do not name");
  }
  // A claim only counts when it is exactly `admin: true` on the token.
  for (const claims of [{ admin: "true" }, { admin: 1 }, { isAdmin: true }, { role: "admin" }]) await denied(getDoc(doc(as("Z", claims), "reports/r1")), JSON.stringify(claims));
});
