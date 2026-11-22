"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { sendEmailVerification } from "firebase/auth";
import { useApp } from "./app-provider";
import { Onboarding, skippedOnboarding } from "./onboarding";
import { Pany, PanySays } from "./pany";
import { Spinner } from "./ui";

/**
 * Signed-in, email-verified users only. Someone without a profile goes through the
 * first-run flow (components/onboarding.tsx) before the page shows: posting projects
 * and sending requests need a profile. With `optional` the page works without one;
 * add `onboard` there to still offer the flow, with a way to skip it (the account page).
 * People who already have a profile never see it.
 */
export function RequireProfile({ children, optional = false, onboard = !optional }: { children: React.ReactNode; optional?: boolean; onboard?: boolean }) {
  const { user, profile, ready } = useApp();
  const router = useRouter();
  const path = usePathname();
  // "open" from the moment the flow saves, so its last screen stays up once the profile
  // exists; "closed" when the person leaves it (finished or skipped).
  const [flow, setFlow] = useState<"open" | "closed">();

  useEffect(() => {
    if (ready && !user) router.replace(`/login?next=${encodeURIComponent(path + location.search)}`);
  }, [ready, user, router, path]);

  if (!ready || !user) return <Spinner />;
  if (!user.emailVerified) return <VerifyEmail />;
  if (onboard && (flow === "open" || (flow === undefined && !profile && !(optional && skippedOnboarding(user.uid)))))
    return <Onboarding required={!optional} onSaving={() => setFlow("open")} onClose={() => setFlow("closed")} />;
  // Saved a moment ago and the profile has not arrived over the listener yet.
  if (!profile && !optional) return <Spinner />;
  return <>{children}</>;
}

function VerifyEmail() {
  const { t, user } = useApp();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    await user!.reload();
    if (user!.emailVerified) {
      await user!.getIdToken(true); // fresh token carries email_verified for the API and rules
      location.reload();
    } else setMsg(t("verifyNotYet"));
    setBusy(false);
  }

  return (
    <div className="card mx-auto flex max-w-md flex-col items-center gap-4 p-6 text-center sm:p-8">
      <Pany pose="tip" size={144} />
      <h1 className="text-xl font-bold">{t("verifyTitle2")}</h1>
      <p className="text-muted">{t("verifySent", { email: user!.email ?? "" })}</p>
      {msg && (
        <PanySays tone="tip" role="status" className="text-left">
          {msg}
        </PanySays>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={check}>
          {t("verifyDone")}
        </button>
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={() => sendEmailVerification(user!, { url: `${location.origin}/me` }).then(() => setMsg(t("verifySent", { email: user!.email ?? "" })), () => setMsg(t("e_generic")))}
        >
          {t("verifyResend")}
        </button>
      </div>
    </div>
  );
}
