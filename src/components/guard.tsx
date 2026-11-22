"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { sendEmailVerification } from "firebase/auth";
import { useApp } from "./app-provider";
import { Pany, PanySays } from "./pany";
import { ProfileForm } from "./profile-form";
import { Spinner } from "./ui";

/**
 * Signed-in, email-verified users only. Without `optional`, users without a
 * profile set one up first (needed to post projects or send requests).
 */
export function RequireProfile({ children, optional = false }: { children: React.ReactNode; optional?: boolean }) {
  const { user, profile, ready, t } = useApp();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (ready && !user) router.replace(`/login?next=${encodeURIComponent(path + location.search)}`);
  }, [ready, user, router, path]);

  if (!ready || !user) return <Spinner />;
  if (!user.emailVerified) return <VerifyEmail />;
  if (!profile && !optional)
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("welcomeTitle")}</h1>
          <p className="text-muted">{t("welcomeSub")}</p>
        </div>
        <ProfileForm />
      </div>
    );
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
