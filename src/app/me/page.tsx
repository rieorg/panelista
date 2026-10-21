"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { api, db, worker } from "@/lib/firebase";
import type { Project } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { RequireProfile } from "@/components/guard";
import { ProfileForm } from "@/components/profile-form";
import { ProjectCard } from "@/components/cards";
import { AdminBadge, Avatar, Empty, ErrorText, isUnread, Spinner, useInbox } from "@/components/ui";

const TABS = ["inbox", "projects", "profile", "verify"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL = { inbox: "tabInbox", projects: "tabProjects", profile: "tabProfile", verify: "tabVerify" } as const;

function MeInner() {
  const { t, user, profile, isAdmin } = useApp();
  const router = useRouter();
  const sp = useSearchParams();
  // New users land on the profile tab, but the inbox stays reachable without one.
  // Fixed at mount, so saving a first profile does not jump away from its next steps.
  const [fallback] = useState<Tab>(profile ? "inbox" : "profile");
  const tab = (TABS.includes(sp.get("tab") as Tab) ? sp.get("tab") : fallback) as Tab;

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => router.replace(`/me?tab=${k}`)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? "border-brand text-brand" : "border-transparent text-muted"}`}
          >
            {t(TAB_LABEL[k])}
          </button>
        ))}
        {isAdmin && <AdminBadge className="ml-auto inline-flex self-center" />}
        {profile && (
          <Link href={`/e/${user!.uid}`} className={`${isAdmin ? "" : "ml-auto"} self-center whitespace-nowrap px-2 text-sm text-brand underline`}>
            {t("viewPublic")}
          </Link>
        )}
      </div>
      {tab === "inbox" && <InboxList />}
      {tab === "projects" && <MyProjects />}
      {tab === "profile" && <ProfileForm />}
      {tab === "verify" && <Verification />}
    </div>
  );
}

function InboxList() {
  const { t, user } = useApp();
  const items = useInbox(user!.uid);
  if (!items) return <Spinner />;
  if (!items.length)
    return (
      <Empty img="empty-inbox" text={t("emptyInbox")}>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/evaluators" className="btn-primary">
            {t("ctaFind")}
          </Link>
          <Link href="/projects" className="btn-ghost">
            {t("browseProjects")}
          </Link>
        </div>
      </Empty>
    );
  return (
    <ul className="card divide-y divide-line">
      {items.map((r) => {
        const otherIsEval = r.studentUid === user!.uid;
        const name = otherIsEval ? r.evaluatorName : r.studentName;
        const photo = otherIsEval ? r.evaluatorPhoto : r.studentPhoto;
        const unread = isUnread(r, user!.uid);
        return (
          <li key={r.id}>
            <Link href={`/inbox/${r.id}`} className="flex items-center gap-3 p-4 hover:bg-surface">
              <Avatar src={photo} name={name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`truncate ${unread ? "font-bold" : "font-semibold"}`}>{name}</span>
                  <span className="chip shrink-0">{t(`st_${r.status}`)}</span>
                </div>
                <p className="truncate text-sm text-muted">{r.projectTitle}</p>
                <p className={`truncate text-sm ${unread ? "text-ink" : "text-muted"}`}>{r.lastMessage}</p>
              </div>
              {unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-label="unread" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MyProjects() {
  const { t, user } = useApp();
  const [items, setItems] = useState<Project[] | null>(null);
  useEffect(() => {
    getDocs(query(collection(db, "projects"), where("ownerUid", "==", user!.uid), orderBy("createdAt", "desc"), limit(50)))
      .then((s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Project)))
      .catch(() => setItems([]));
  }, [user]);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/me/projects/new" className="btn-primary w-fit">
        {t("newProject")}
      </Link>
      {!items ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty img="empty-projects" text={t("needProject")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/**
 * Phone photos and screenshots of proofs become WebP, at most 2000 px on the long side:
 * often a tenth of the size, and the re-encode drops EXIF (GPS included). Text on an ID
 * or certificate stays readable. Keeps the original when the browser cannot encode WebP
 * (Safari falls back to PNG) or the WebP comes out bigger.
 */
async function toWebp(file: File): Promise<File> {
  if (file.type !== "image/jpeg" && file.type !== "image/png") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    if (blob.type !== "image/webp" || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp" });
  } catch {
    return file;
  }
}

function Verification() {
  const { t, user, profile } = useApp();
  const [v, setV] = useState<{ status: string; reason?: string } | null | undefined>(undefined);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(
    () => onSnapshot(doc(db, "verifications", user!.uid), (s) => setV(s.exists() ? (s.data() as { status: string; reason?: string }) : null), () => setV(null)),
    [user],
  );

  if (!profile?.isEvaluator) return <p className="card p-5 text-muted">{t("verifyNeedEval")}</p>;
  if (v === undefined) return <Spinner />;
  if (profile.verified)
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/verified.svg" alt="" className="h-32" />
        <p className="font-semibold text-brand">{t("verifyApproved")}</p>
      </div>
    );
  if (v?.status === "pending") return <p className="card p-5">{t("verifyPending")}</p>;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const uploaded = [];
      for (const picked of files) {
        if (!ALLOWED.includes(picked.type)) throw new Error("upload-failed");
        // Converted first, so a big phone photo can still fit under the 5 MB cap.
        const file = await toWebp(picked);
        if (file.size > 5_000_000) throw new Error("upload-failed");
        const res = await worker("/proofs", { method: "POST", body: file, headers: { "content-type": file.type, "x-file-name": encodeURIComponent(file.name.slice(0, 120)) } });
        const { key } = (await res.json()) as { key: string };
        uploaded.push({ key, name: file.name.slice(0, 120), type: file.type, size: file.size });
      }
      await api("/api/verification", "POST", { files: uploaded, note: note.trim() });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold">{t("verifyTitle")}</h2>
      <p className="text-sm text-muted">{t("verifySub")}</p>
      {v?.status === "rejected" && <p className="text-sm text-red-700">{t("verifyRejected", { r: v.reason || "-" })}</p>}
      <div>
        <label className="label" htmlFor="files">
          {t("verifyFiles")}
        </label>
        <input id="files" type="file" multiple accept={ALLOWED.join(",")} className="input" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 3))} />
      </div>
      <div>
        <label className="label" htmlFor="vnote">
          {t("verifyNote")}
        </label>
        <textarea id="vnote" className="input min-h-20" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ErrorText code={err} />
      <button className="btn-primary w-fit" disabled={busy || files.length === 0} onClick={submit}>
        {t("verifySubmit")}
      </button>
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense>
      <RequireProfile optional>
        <MeInner />
      </RequireProfile>
    </Suspense>
  );
}
