"use client";
import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useApp } from "./app-provider";
import { CATEGORY_LABELS, errorKey, fieldKey } from "@/lib/i18n";
import type { EvalRequest } from "@/lib/types";
import type { Timestamp } from "firebase/firestore";

export function Avatar({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full bg-brand-soft object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-dark" style={{ width: size, height: size, fontSize: size / 2.6 }}>
      {initials || "?"}
    </span>
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
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="btn-primary w-fit">
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

export function Empty({ img, text, children }: { img: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/${img}.svg`} alt="" width={200} height={160} className="h-32 w-auto" />
      <p className="max-w-sm text-muted">{text}</p>
      {children}
    </div>
  );
}

export function ErrorText({ code }: { code: string | null }) {
  const { t } = useApp();
  if (!code) return null;
  // "invalid:stack" = the API rejected that field; name it so the user knows what to fix.
  const [c, field] = code.split(":");
  const label = field ? fieldKey(field) : null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {t(errorKey(c))} {label && <b>{t(label)}</b>}
    </p>
  );
}

export function Spinner() {
  const { t } = useApp();
  return <p className="py-10 text-center text-muted">{t("loading")}</p>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-xl text-muted hover:bg-surface">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
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
