// Grants (or removes) the admin custom claim for a user who has signed in once.
// Usage: GOOGLE_APPLICATION_CREDENTIALS=path/to/admin-sa.json node scripts/set-admin.mjs you@gmail.com [--remove]
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [email, flag] = process.argv.slice(2);
if (!email) throw new Error("usage: node scripts/set-admin.mjs <email> [--remove]");
initializeApp({ credential: applicationDefault() });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, flag === "--remove" ? {} : { admin: true });
await auth.revokeRefreshTokens(user.uid); // forces a fresh token with the new claim
// The public Admin badge; the profile API also refreshes it from the claim on every save.
const profile = getFirestore().doc(`profiles/${user.uid}`);
if ((await profile.get()).exists) await profile.update({ isAdmin: flag !== "--remove" });
console.log(`${flag === "--remove" ? "removed admin from" : "admin granted to"} ${email} (${user.uid}); sign out and in again.`);
