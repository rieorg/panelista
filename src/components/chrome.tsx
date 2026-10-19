"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useApp } from "./app-provider";
import { Avatar, isUnread, useInbox } from "./ui";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-mark.svg" alt="" width={32} height={32} />
      Panelista
    </Link>
  );
}

export function Header() {
  const { user, profile, isAdmin, lang, setLang, t } = useApp();
  const path = usePathname();
  const inbox = useInbox(user?.uid);
  const unread = user && inbox ? inbox.filter((r) => isUnread(r, user.uid)).length : 0;
  // Rating the evaluator is required (the API blocks new asks until then), so keep it in view.
  const due = user && inbox?.find((r) => r.studentUid === user.uid && r.status === "completed" && !r.reviewedByStudent);

  const links = [
    { href: "/evaluators", label: t("navEvaluators") },
    { href: "/projects", label: t("navProjects") },
    ...(user ? [{ href: "/me?tab=inbox", label: t("navInbox"), badge: unread }] : []),
    ...(isAdmin ? [{ href: "/admin", label: t("navAdmin") }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Logo />
        <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {links.map((l) => {
            const active = path === l.href.split("?")[0];
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-soft text-brand-dark" : "text-muted hover:bg-surface"}`}
              >
                {l.label}
                {"badge" in l && l.badge ? (
                  <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs font-bold text-ink" aria-label={`${l.badge} unread`}>
                    {l.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setLang(lang === "tl" ? "en" : "tl")} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-muted hover:bg-surface">
            {t("langSwitch")}
          </button>
          {user ? (
            <>
              <Link href="/me?tab=profile" aria-label={t("navMe")} className="rounded-full">
                <Avatar src={profile?.photoURL || user.photoURL || ""} name={profile?.name || user.displayName || "?"} size={34} />
              </Link>
              <button onClick={() => signOut(auth)} className="hidden rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-surface sm:block">
                {t("signOut")}
              </button>
            </>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(path)}`} className="btn-primary py-2">
              {t("signIn")}
            </Link>
          )}
        </div>
      </div>
      {due && path !== `/inbox/${due.id}` && (
        <div role="status" className="border-t border-line bg-accent/20">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <span>{t("reviewDue", { name: due.evaluatorName })}</span>
            <Link href={`/inbox/${due.id}`} className="font-semibold text-brand underline">
              {t("rateNow")}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const { t } = useApp();
  return (
    <footer className="border-t border-line bg-white print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted">
        <p>{t("madeBy")}</p>
        <nav className="flex gap-4">
          <Link href="/privacy" className="hover:text-ink">
            {t("privacy")}
          </Link>
          <a href="mailto:eirmonpaculan11@gmail.com" className="hover:text-ink">
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
