"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/firebase";
import { CATEGORIES } from "@/lib/domain";
import { CATEGORY_LABELS } from "@/lib/i18n";
import type { Project } from "@/lib/types";
import { useApp } from "./app-provider";
import { ErrorText, splitTags } from "./ui";

const inTwoWeeks = () => new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);

export function ProjectForm({ existing }: { existing?: Project }) {
  const { t, profile } = useApp();
  const router = useRouter();
  const [f, setF] = useState({
    title: existing?.title ?? "",
    abstract: existing?.abstract ?? "",
    school: existing?.school ?? profile?.school ?? "",
    course: existing?.course ?? profile?.course ?? "BSIT",
    categories: existing?.categories ?? ([] as string[]),
    stack: existing?.stack.join(", ") ?? "",
    needed: existing?.needed ?? 5,
    minYears: existing?.minYears ?? 3,
    deadline: existing ? existing.deadline.toDate().toISOString().slice(0, 10) : inTwoWeeks(),
    formUrl: existing?.formUrl ?? "",
    mode: existing?.mode ?? "online",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit() {
    // The chips are not form inputs, so the browser cannot flag a missing category itself.
    if (!f.categories.length) return setErr("invalid:categories");
    setBusy(true);
    setErr(null);
    const payload = { ...f, stack: splitTags(f.stack, 12), title: f.title.trim(), abstract: f.abstract.trim(), formUrl: f.formUrl.trim() };
    try {
      if (existing) {
        await api(`/api/projects/${existing.id}`, "PATCH", payload);
        router.push(`/p/${existing.id}`);
      } else {
        const r = await api<{ id: string }>("/api/projects", "POST", payload);
        router.push(`/p/${r.id}`);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form
      className="card flex flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label className="label" htmlFor="title">
          {t("fTitle")}
        </label>
        <input id="title" className="input" required minLength={5} maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="abstract">
          {t("fAbstract")}
        </label>
        <textarea id="abstract" className="input min-h-32" required minLength={20} maxLength={1500} value={f.abstract} onChange={(e) => set("abstract", e.target.value)} aria-describedby="abstract-hint" />
        <p id="abstract-hint" className="mt-1 text-xs text-muted">
          {t("fAbstractHint")}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="school">
            {t("fSchool")}
          </label>
          <input id="school" className="input" required minLength={2} maxLength={80} value={f.school} onChange={(e) => set("school", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="course">
            {t("fCourse")}
          </label>
          <input id="course" className="input" required minLength={2} maxLength={80} value={f.course} onChange={(e) => set("course", e.target.value)} />
        </div>
      </div>
      <fieldset>
        <legend className="label">{t("fCategories")}</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const on = f.categories.includes(c);
            return (
              <button
                type="button"
                key={c}
                aria-pressed={on}
                onClick={() => set("categories", on ? f.categories.filter((x) => x !== c) : [...f.categories, c].slice(0, 4))}
                className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand bg-brand text-white" : "border-line bg-white"}`}
              >
                {CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="stack">
          {t("fStack")}
        </label>
        <input id="stack" className="input" placeholder="Laravel, MySQL, Flutter" value={f.stack} onChange={(e) => set("stack", e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="needed">
            {t("fNeeded")}
          </label>
          <input id="needed" type="number" min={1} max={30} className="input" value={f.needed} onChange={(e) => set("needed", Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="minYears">
            {t("fMinYears")}
          </label>
          <input id="minYears" type="number" min={0} max={20} className="input" value={f.minYears} onChange={(e) => set("minYears", Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="deadline">
            {t("fDeadline")}
          </label>
          <input id="deadline" type="date" className="input" required value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="formUrl">
            {t("fFormUrl")} ({t("optional")})
          </label>
          <input id="formUrl" type="url" pattern="https://.*" maxLength={300} className="input" placeholder="https://forms.gle/..." value={f.formUrl} onChange={(e) => set("formUrl", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="mode">
            {t("fMode")}
          </label>
          <select id="mode" className="input" value={f.mode} onChange={(e) => set("mode", e.target.value as typeof f.mode)}>
            <option value="online">{t("online")}</option>
            <option value="onsite">{t("onsite")}</option>
            <option value="either">{t("either")}</option>
          </select>
        </div>
      </div>
      <ErrorText code={err} />
      <button className="btn-primary" disabled={busy}>
        {existing ? t("save") : t("postProject")}
      </button>
    </form>
  );
}
