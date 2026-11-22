"use client";
import { Suspense, use, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Project } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { RequireProfile } from "@/components/guard";
import { ProjectForm } from "@/components/project-form";
import { Empty, Spinner } from "@/components/ui";

function Inner({ id }: { id: string }) {
  const { t, user } = useApp();
  const [p, setP] = useState<Project | null | undefined>(undefined);
  useEffect(() => {
    getDoc(doc(db, "projects", id)).then((s) => setP(s.exists() ? ({ id: s.id, ...s.data() } as Project) : null), () => setP(null));
  }, [id]);
  if (p === undefined) return <Spinner />;
  if (!p || p.ownerUid !== user?.uid) return <Empty pose="oops" text={t("notFound")} />;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("editProject")}</h1>
      <ProjectForm existing={p} />
    </div>
  );
}

export default function EditProjectPage({ params }: PageProps<"/me/projects/[id]/edit">) {
  const { id } = use(params);
  return (
    <Suspense>
      <RequireProfile>
        <Inner id={id} />
      </RequireProfile>
    </Suspense>
  );
}
