import { z } from "zod";
import { CATEGORIES } from "./domain";
import { ISO_ITEM_IDS, type IsoItemId } from "./iso25010";

// Validation at the trust boundary (API routes). Clients never write these
// collections directly; Firestore rules deny it.

const text = (max: number) => z.string().trim().max(max);
const tag = z.string().trim().min(1).max(30);
// Firestore ids only: no "/" so a crafted id cannot address another document.
export const id = (max: number) => z.string().min(1).max(max).regex(/^[\w-]+$/);
const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https:\/\/[^\s<>"']+$/i.test(v), "must be an https:// link");

export const profileSchema = z.object({
  name: text(60).min(2),
  headline: text(80),
  bio: text(600),
  titles: z.array(tag).max(5),
  yearsExp: z.number().int().min(0).max(50),
  categories: z.array(z.enum(CATEGORIES)).max(6),
  skills: z.array(tag).max(15),
  city: text(40),
  modes: z.array(z.enum(["online", "onsite"])).max(2),
  linkedin: httpsUrl,
  school: text(80),
  course: text(80),
  isStudent: z.boolean().default(true),
  isEvaluator: z.boolean(),
  accepting: z.boolean(),
  maxActive: z.number().int().min(1).max(20),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const projectSchema = z.object({
  title: text(120).min(5),
  abstract: text(1500).min(20),
  school: text(80).min(2),
  // 80: "Bachelor of Science in Information Technology" alone is 45.
  course: text(80).min(2),
  categories: z.array(z.enum(CATEGORIES)).min(1).max(4),
  stack: z.array(tag).max(12),
  needed: z.number().int().min(1).max(30),
  minYears: z.number().int().min(0).max(20),
  deadline: z.iso.date(),
  formUrl: httpsUrl,
  mode: z.enum(["online", "onsite", "either"]),
});
export type ProjectInput = z.infer<typeof projectSchema>;

export const projectPatchSchema = projectSchema.partial().extend({ status: z.enum(["open", "closed"]).optional() });

export const createRequestSchema = z.object({
  projectId: id(64),
  evaluatorUid: id(128),
  note: text(500),
});

export const actionSchema = z.object({ action: z.enum(["accept", "decline", "cancel", "complete"]) });

// Every one of the 31 ISO 25010 items, 1 to 5 (a record with enum keys requires them all).
export const evaluationSchema = z.object({
  requestId: id(200),
  scores: z.record(z.enum(ISO_ITEM_IDS as [IsoItemId, ...IsoItemId[]]), z.number().int().min(1).max(5)),
  comments: text(1500),
});

export const REVIEW_TAGS = ["fast", "helpful", "detailed", "professional", "kind", "organized", "on-time", "clear"] as const;
export const reviewSchema = z.object({
  requestId: id(200),
  stars: z.number().int().min(1).max(5),
  tags: z.array(z.enum(REVIEW_TAGS)).max(4),
  text: text(500),
});

export const reportSchema = z.object({
  targetUid: id(128),
  reason: z.enum(["fake", "spam", "rude", "scam", "other"]),
  details: text(500),
});

export const verificationSchema = z.object({
  files: z
    .array(z.object({ key: z.string().min(1).max(200), name: text(120), type: text(60), size: z.number().int().max(5_000_000) }))
    .min(1)
    .max(3),
  note: text(300),
});

export const adminVerifySchema = z.object({
  uid: id(128),
  decision: z.enum(["approve", "reject"]),
  reason: text(300),
});

export const adminBanSchema = z.object({ uid: id(128), banned: z.boolean() });

export const clientErrorSchema = z.object({
  message: z.string().max(500),
  stack: z.string().max(4000),
  digest: z.string().max(100),
  path: z.string().max(300),
  ua: z.string().max(400),
  uid: z.string().max(128),
});
