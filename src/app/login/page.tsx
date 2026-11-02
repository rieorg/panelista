"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  updateProfile,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useApp } from "@/components/app-provider";
import { Logo } from "@/components/chrome";
import { ErrorText } from "@/components/ui";
import { REDIRECT_FLAG, signInLock } from "@/lib/signin";

// Facebook, Messenger, Instagram and LINE in-app browsers: Google blocks OAuth there.
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\//i;

/** Only allow same-origin redirects after login (blocks //evil and /\evil). */
function safeNext(raw: string | null) {
  if (!raw) return "/me";
  try {
    const u = new URL(raw, location.origin);
    return u.origin === location.origin ? u.pathname + u.search : "/me";
  } catch {
    return "/me";
  }
}

const codeOf = (e: unknown) => (e as { code?: string }).code ?? "generic";
const CANCELLED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

function hadRedirect() {
  try {
    return sessionStorage.getItem(REDIRECT_FLAG) === "1";
  } catch {
    return false;
  }
}

function LoginInner() {
  const { t, user, ready } = useApp();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inApp, setInApp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  // Every sign-in (email, Google popup or redirect) goes through this lock.
  const [signingIn, setSigningIn] = useState(false);
  const [lock] = useState(() => signInLock(setSigningIn));
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator exists only after hydration
    setInApp(IN_APP.test(navigator.userAgent));
    const back = hadRedirect();
    setReturning(back);
    getRedirectResult(auth)
      .then((r) => {
        // With a user, stay locked until the redirect below leaves the page.
        if (!r) setReturning(false);
      })
      .catch((e) => {
        setReturning(false);
        if (!CANCELLED.has(codeOf(e))) setErr(codeOf(e));
      })
      .finally(() => {
        try {
          sessionStorage.removeItem(REDIRECT_FLAG);
        } catch {}
      });
  }, []);

  useEffect(() => {
    if (ready && user) router.replace(next);
  }, [ready, user, next, router]);

  function signIn(fn: () => Promise<unknown>) {
    setErr(null);
    setNotice("");
    lock(fn).catch((e) => {
      const code = codeOf(e);
      if (!CANCELLED.has(code)) setErr(code);
    });
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setErr(codeOf(e));
    } finally {
      setBusy(false);
    }
  }

  const submitEmail = () =>
    signIn(async () => {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name.trim().slice(0, 60) });
      await sendEmailVerification(cred.user, { url: `${location.origin}/me` });
    });

  const google = () =>
    signIn(async () => {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        const code = codeOf(e);
        if (code !== "auth/popup-blocked" && code !== "auth/operation-not-supported-in-this-environment") throw e;
        try {
          sessionStorage.setItem(REDIRECT_FLAG, "1");
        } catch {}
        await signInWithRedirect(auth, provider);
      }
    });

  // Block the whole page while auth resolves, a sign-in runs, or a signed-in user is on the way out.
  if (!ready || user || signingIn || returning)
    return (
      <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element -- plain mark, not the Logo link, so nothing here navigates away */}
        <img src="/brand/logo-mark.svg" alt="" width={48} height={48} className="animate-pulse" />
        <p className="text-muted">{user || signingIn || returning ? t("signingIn") : t("loading")}</p>
      </div>
    );

  const forgot = () =>
    run(async () => {
      // Same message whether or not the email exists (no account enumeration).
      await sendPasswordResetEmail(auth, email.trim(), { url: `${location.origin}/login` }).catch(() => {});
      setNotice(t("resetSent"));
    });

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-5 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo />
        <h1 className="text-2xl font-bold">{mode === "signin" ? t("loginTitle") : t("createAccount")}</h1>
      </div>

      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submitEmail();
        }}
      >
        {mode === "signup" && (
          <div>
            <label className="label" htmlFor="name">
              {t("fullName")}
            </label>
            <input id="name" className="input" required minLength={2} maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">
            {t("email")}
          </label>
          <input id="email" type="email" className="input" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">
            {t("password")}
          </label>
          <input
            id="password"
            type="password"
            className="input"
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "signup" && <p className="mt-1 text-xs text-muted">{t("pwHint")}</p>}
        </div>
        <ErrorText code={err} />
        {notice && (
          <p role="status" className="text-sm text-brand">
            {notice}
          </p>
        )}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {mode === "signin" ? t("signInEmail") : t("createAccount")}
        </button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          {mode === "signin" ? (
            <button type="button" className="text-brand underline" onClick={forgot} disabled={busy || !email}>
              {t("forgotPw")}
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="text-brand underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? `${t("noAccount")} ${t("createAccount")}` : `${t("haveAccount")} ${t("signInEmail")}`}
          </button>
        </div>
      </form>

      <div className="flex items-center gap-3 text-sm text-muted" role="separator" aria-label={t("or")}>
        <span className="h-px flex-1 bg-line" />
        {t("or")}
        <span className="h-px flex-1 bg-line" />
      </div>

      {inApp && (
        <div role="alert" className="card border-accent bg-accent/15 p-4 text-sm">
          <p>{t("inAppWarn")}</p>
          <button className="btn-ghost mt-3 w-full" onClick={() => navigator.clipboard.writeText(location.href).then(() => setCopied(true), () => {})}>
            {copied ? t("copied") : t("copyLink")}
          </button>
        </div>
      )}
      <button onClick={google} disabled={busy} className="btn-ghost w-full py-3 text-base">
        <svg aria-hidden viewBox="0 0 48 48" className="h-5 w-5">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
        </svg>
        {t("signInGoogle")}
      </button>
      <p className="text-center text-xs text-muted">{t("loginSub")}</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
