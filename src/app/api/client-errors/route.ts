import { body, db, FieldValue, rateLimit, route } from "@/lib/server";
import { clientErrorSchema } from "@/lib/schemas";

// Crash reports from the error screens (src/app/error.tsx, global-error.tsx).
// No login or App Check: the crash may be in sign-in or App Check itself.
export const POST = route(
  async (req) => {
    const input = clientErrorSchema.parse(await body(req));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim().replace(/[^\w.:-]/g, "") || "unknown";
    // 30 a day per address, and 500 a day for everyone together: this route has no login, so rotating
    // addresses must not be able to spend the day's Firestore write quota. Real crashes are far fewer.
    await rateLimit(`ip-${ip}`, "client-error", 30, 500);
    console.error("client-error", JSON.stringify(input));
    await db().collection("clientErrors").add({ ...input, createdAt: FieldValue.serverTimestamp() });
    return { ok: true };
  },
  { appCheck: false },
);
