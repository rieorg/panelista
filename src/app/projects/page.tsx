"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Timestamp } from "firebase/firestore";
import { CATEGORIES } from "@/lib/domain";
import { CATEGORY_LABELS } from "@/lib/i18n";
import type { Project } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { ProjectCard } from "@/components/cards";
import { Empty, Spinner } from "@/components/ui";

const PAGE = 24;

/** Open projects, newest first, from the CDN-cached /api/projects (no Firestore read or App Check per visit). */
async function loadOpenProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("server");
  const rows = (await res.json()) as (Omit<Project, "deadline"> & { deadline: number })[];
  return rows.map((p) => ({ ...p, deadline: Timestamp.fromMillis(p.deadline) }));
}

export default function ProjectsPage() {
  const { t, user } = useApp();
  const [cat, setCat] = useState("");
  const [all, setAll] = useState<Project[] | null>(null);
  const [shownN, setShownN] = useState(PAGE);

  useEffect(() => {
    loadOpenProjects().then(setAll, () => setAll([]));
  }, []);

  const matches = all?.filter((p) => !cat || p.categories.includes(cat as Project["categories"][number])) ?? null;
  const items = matches?.slice(0, shownN) ?? null;
  const more = (matches?.length ?? 0) > shownN;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("projectsTitle")}</h1>
        <Link href={user ? "/me/projects/new" : "/login?next=%2Fme%2Fprojects%2Fnew"} className="btn-primary">
          {t("ctaPost")}
        </Link>
      </div>
      <select
        className="input sm:max-w-[220px]"
        value={cat}
        onChange={(e) => {
          setCat(e.target.value);
          setShownN(PAGE);
        }}
        aria-label={t("allCategories")}
      >
        <option value="">{t("allCategories")}</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty img="empty-projects" text={t("noProjects")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
      {more && (
        <button className="btn-ghost mx-auto" onClick={() => setShownN((n) => n + PAGE)}>
          {t("loadMore")}
        </button>
      )}
    </div>
  );
}
