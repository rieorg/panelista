import "server-only";
import { db } from "./server";
import type { DocumentData } from "./firestore";

/** Reads one public doc for link-preview metadata; returns null on any failure. */
export async function publicDoc(path: string): Promise<DocumentData | null> {
  try {
    const snap = await db().doc(path).get();
    return snap.exists ? (snap.data() ?? null) : null;
  } catch {
    return null;
  }
}
