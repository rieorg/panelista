"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useApp } from "./app-provider";
import { CATEGORY_LABELS, errorKey, fieldKey } from "@/lib/i18n";
import type { EvalRequest } from "@/lib/types";
import { Pany, PanySays, type Pose } from "./pany";
import type { Timestamp } from "firebase/firestore";

// No photo: a DiceBear Notionists face (CC0, same as webinar's chat), seeded by a hash of the name so the same
// person always gets the same face and the name itself never leaves the site.
const faceUrl = (name: string) =>
  `https://api.dicebear.com/9.x/notionists-neutral/svg?seed=${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;

export function Avatar({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src || faceUrl(name)} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full bg-brand-soft object-cover" style={{ width: size, height: size }} />
  );
}

/** Star row. With count: "5.0 · 2 ratings", or "No ratings yet" instead of five grey stars. */
export function Stars({ value, count, size = "sm" }: { value: number; count?: number; size?: "sm" | "lg" }) {
  const { t } = useApp();
  const full = Math.round(value);
  if (count === 0) return <span className={`text-muted ${size === "lg" ? "text-base" : "text-sm"}`}>{t("noRatings")}</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${size === "lg" ? "text-base" : "text-sm"}`} aria-label={`${value.toFixed(1)} out of 5`}>
      <span aria-hidden className="tracking-tight">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={i <= full ? "text-star" : "text-line"}>
            ★
          </span>
        ))}
      </span>
      {count !== undefined && (
        <span className="text-muted">
          {value.toFixed(1)} · {t("ratingsCount", { n: count })}
        </span>
      )}
    </span>
  );
}

// Scalloped seal: a disc plus 10 lobes around it, one at the top.
const SEAL_LOBES = Array.from({ length: 10 }, (_, i) => {
  const a = (i * Math.PI) / 5 - Math.PI / 2;
  return [12 + 8.2 * Math.cos(a), 12 + 8.2 * Math.sin(a)].map((v) => Math.round(v * 100) / 100);
});

/** Verified mark in Facebook's style (seal with a check, right after the name), in brand green. */
export function VerifiedBadge({ size = 18, label = false }: { size?: number; label?: boolean }) {
  const { t } = useApp();
  const seal = (
    <svg role="img" aria-label={t("verified")} viewBox="0 0 24 24" width={size} height={size} className="inline-block shrink-0 text-brand">
      <title>{t("verified")}</title>
      <g fill="currentColor">
        <circle cx="12" cy="12" r="8.5" />
        {SEAL_LOBES.map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r="2.6" />
        ))}
      </g>
      <path d="M7.7 12.3l2.9 2.9 5.8-6.1" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return label ? (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
      {seal}
      {t("verified")}
    </span>
  ) : (
    seal
  );
}

/** Marks a Panelista admin (custom claim; on public profiles, the server-written isAdmin field). */
export function AdminBadge({ className = "inline-flex" }: { className?: string }) {
  const { t } = useApp();
  return (
    <span className={`${className} items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-white`}>
      <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 1.5 2.5 3.5v4c0 3.2 2.3 5.9 5.5 7 3.2-1.1 5.5-3.8 5.5-7v-4L8 1.5Z" strokeLinejoin="round" />
      </svg>
      {t("adminBadge")}
    </span>
  );
}

/** The project's evaluation form as a button, so the evaluator cannot miss it. */
export function FormLink({ href }: { href: string }) {
  const { t } = useApp();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="btn-primary w-fit max-w-full">
      {t("evalForm")}
      <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 11 11 5M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

export function CategoryChips({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((c) => (
        <span key={c} className="chip">
          {CATEGORY_LABELS[c] ?? c}
        </span>
      ))}
    </span>
  );
}

/**
 * Nothing here yet, or nothing found: Pany, what happened, and the next step as children.
 * "kulangpa" is for an empty list, "oops" for something missing or broken.
 */
export function Empty({ pose = "kulangpa", title, text, children }: { pose?: Pose; title?: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-4 px-6 py-8 text-center sm:flex-row sm:justify-center sm:gap-8 sm:px-10 sm:text-left">
      <Pany pose={pose} size={144} />
      <div className="flex max-w-sm flex-col items-center gap-3 sm:items-start">
        {title && <h1 className="text-xl font-bold">{title}</h1>}
        <p className="text-muted">{text}</p>
        {children}
      </div>
    </div>
  );
}

/** An error in Pany's voice: her "oops" avatar and a red bubble, announced to screen readers. */
export function ErrorText({ code }: { code: string | null }) {
  const { t } = useApp();
  if (!code) return null;
  // "invalid:stack" = the API rejected that field; name it so the user knows what to fix.
  const [c, field] = code.split(":");
  const label = field ? fieldKey(field) : null;
  return (
    <PanySays tone="oops" role="alert">
      {t(errorKey(c))} {label && <b>{t(label)}</b>}
    </PanySays>
  );
}

/** Loading: still skeleton rows right away (no shimmer). Pany joins only when it takes over a second. */
export function Spinner() {
  const { t } = useApp();
  return (
    <div role="status" aria-busy="true" className="card flex items-center gap-6 p-5">
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="flex min-w-0 flex-1 flex-col gap-5">
        {[62, 48, 55].map((w) => (
          <div key={w} className="flex items-center gap-3">
            <span className="h-10 w-10 shrink-0 rounded-full bg-line/70" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-2.5 rounded bg-line/70" style={{ width: `${w}%` }} />
              <span className="h-2.5 rounded bg-line/70" style={{ width: `${w - 20}%` }} />
            </span>
          </div>
        ))}
      </div>
      <Pany pose="thinking" size={112} className="after-1s max-sm:hidden" />
    </div>
  );
}

/**
 * A native modal dialog. showModal() brings what the hand-built overlay lacked: focus moves in and cannot
 * tab out to the page behind, Escape closes it, and closing puts focus back on the button that opened it.
 * A bottom sheet on phones, centered from 640px.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const { t } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  // A layout effect, so close() runs while the dialog is still in the page: that is when the browser returns focus.
  useLayoutEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      // Escape (and Back on Android) asks to close. Listening to "cancel" and not "close": our own close() above
      // fires "close" too, which in development (effects run twice) would shut the dialog as it opens.
      onCancel={onClose}
      // The backdrop is the dialog element itself, so a click whose target is the dialog was outside the box.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl bg-white text-ink backdrop:bg-ink/40 max-sm:mb-0 max-sm:max-w-none sm:rounded-2xl"
    >
      {/* The padding lives here and not on the dialog, or a click on the padding would count as the backdrop. */}
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label={t("close")} className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface">
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export const toDate = (ts?: Timestamp) => (ts ? ts.toDate() : undefined);
export const fmtDate = (ts: Timestamp | undefined, lang: string) =>
  ts ? ts.toDate().toLocaleDateString(lang === "tl" ? "en-PH" : "en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

/** Splits a comma separated input into trimmed, de-duplicated tags. */
export const splitTags = (s: string, max: number) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))].slice(0, max);

/** Live list of the user's requests, newest activity first. */
export function useInbox(uid: string | undefined) {
  const [items, setItems] = useState<EvalRequest[] | null>(null);
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "requests"), where("participants", "array-contains", uid), orderBy("lastMessageAt", "desc"), limit(50));
    return onSnapshot(q, (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }) as EvalRequest)), () => setItems([]));
  }, [uid]);
  return items;
}

/** Per-device read marker for the inbox (convenience only, not synced). */
export function seenAt(id: string): number {
  try {
    return Number(localStorage.getItem(`seen:${id}`) ?? 0);
  } catch {
    return 0;
  }
}
export function markSeen(id: string) {
  try {
    localStorage.setItem(`seen:${id}`, String(Date.now()));
  } catch {}
}
export const isUnread = (r: EvalRequest, uid: string) => r.lastSender !== uid && (r.lastMessageAt?.toMillis() ?? 0) > seenAt(r.id);
