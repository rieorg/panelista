"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useApp } from "./app-provider";
import { AdminBadge, Avatar, isUnread, useInbox } from "./ui";

export function Logo() {
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-extrabold tracking-tight text-ink">
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

  // A thread on a phone is one focused screen, like any chat: its own header has the way back,
  // so the link row steps aside there and the messages get the room.
  const inThread = /^\/inbox\/[^/]+$/.test(path);

  const links = [
    { href: "/evaluators", label: t("navEvaluators") },
    { href: "/projects", label: t("navProjects") },
    ...(user ? [{ href: "/me?tab=inbox", label: t("navInbox"), badge: unread }] : []),
    ...(isAdmin ? [{ href: "/admin", label: t("navAdmin") }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur print:hidden">
      <div className={`mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 px-4 pt-1.5 sm:pb-1.5 ${inThread ? "pb-1.5" : ""}`}>
        <Logo />
        {/* Phones: a second row where every link is an equal, 44 px tall share of the width. */}
        <nav aria-label="Main" className={`order-3 w-full gap-1 pb-1.5 sm:order-none sm:flex sm:w-auto sm:pb-0 ${inThread ? "hidden" : "flex"}`}>
          {links.map((l) => {
            const active = path === l.href.split("?")[0];
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium whitespace-nowrap sm:flex-none ${active ? "bg-brand-soft text-brand-dark" : "text-muted hover:bg-surface hover:text-ink"}`}
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
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button onClick={() => setLang(lang === "tl" ? "en" : "tl")} className="btn-quiet px-2.5 text-xs font-semibold">
            {t("langSwitch")}
          </button>
          {user ? (
            <>
              {isAdmin && <AdminBadge className="hidden sm:inline-flex" />}
              <Link href="/me?tab=profile" aria-label={t("navMe")} className="grid h-11 w-11 place-items-center rounded-full">
                <Avatar src={profile?.photoURL || user.photoURL || ""} name={profile?.name || user.displayName || "?"} size={34} />
              </Link>
              {/* Phones get Sign out on the account page (/me) instead. */}
              <button onClick={() => signOut(auth)} className="btn-quiet hidden px-2.5 text-xs sm:inline-flex">
                {t("signOut")}
              </button>
            </>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(path)}`} className="btn-primary">
              {t("signIn")}
            </Link>
          )}
        </div>
      </div>
      {due && path !== `/inbox/${due.id}` && (
        <div role="status" className="border-t border-line bg-tip">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 px-4 py-1 text-sm">
            <span>{t("reviewDue", { name: due.evaluatorName })}</span>
            <Link href={`/inbox/${due.id}`} className="inline-flex min-h-11 items-center font-semibold text-brand-dark underline">
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
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 py-3 text-sm text-muted">
        <p>{t("madeBy")}</p>
        <nav aria-label="Footer" className="-mx-2 flex">
          <Link href="/privacy" className="inline-flex min-h-11 items-center px-2 hover:text-ink">
            {t("privacy")}
          </Link>
          <a href="mailto:eirmonpaculan11@gmail.com" className="inline-flex min-h-11 items-center px-2 hover:text-ink">
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
