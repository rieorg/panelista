"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/firebase";
import { AWAY_AFTER, CATEGORIES } from "@/lib/domain";
import { CATEGORY_LABELS } from "@/lib/i18n";
import { useApp } from "./app-provider";
import { ErrorText, splitTags } from "./ui";

export function ProfileForm() {
  const { t, user, profile } = useApp();
  const wantsEval = useSearchParams().get("role") === "evaluator";
  const [f, setF] = useState({
    name: profile?.name ?? user?.displayName ?? "",
    headline: profile?.headline ?? "",
    bio: profile?.bio ?? "",
    titles: profile?.titles.join(", ") ?? "",
    yearsExp: profile?.yearsExp ?? 0,
    categories: (profile?.categories ?? []) as string[],
    skills: profile?.skills.join(", ") ?? "",
    city: profile?.city ?? "",
    modes: profile?.modes ?? (["online"] as ("online" | "onsite")[]),
    linkedin: profile?.linkedin ?? "",
    school: profile?.school ?? "",
    course: profile?.course ?? "",
    isStudent: profile?.isStudent ?? !wantsEval,
    isEvaluator: profile?.isEvaluator ?? wantsEval,
    accepting: profile?.accepting ?? true,
    maxActive: profile?.maxActive ?? 5,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // First save of a new profile: point at the next step instead of a bare "Saved!".
  const [isNew] = useState(!profile);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: v }));
  };

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/profile", "PUT", {
        ...f,
        name: f.name.trim(),
        titles: splitTags(f.titles, 5),
        skills: splitTags(f.skills, 15),
        linkedin: f.linkedin.trim(),
      });
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (k: "name" | "headline" | "city" | "linkedin" | "school" | "course" | "titles" | "skills", label: string, max: number, extra = {}) => (
    <div>
      <label className="label" htmlFor={k}>
        {label}
      </label>
      <input id={k} className="input" maxLength={max} value={f[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
    </div>
  );

  return (
    <form
      className="card flex flex-col gap-5 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="label">{t("roleQ")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isStudent} onChange={(e) => set("isStudent", e.target.checked)} className="h-4 w-4 accent-brand" />
          {t("roleStudent")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isEvaluator} onChange={(e) => set("isEvaluator", e.target.checked)} className="h-4 w-4 accent-brand" />
          {t("roleEvaluator")}
        </label>
      </fieldset>

      {field("name", t("pName"), 60, { required: true, minLength: 2 })}
      {field("headline", t("pHeadline"), 80)}

      {f.isStudent && (
        <section className="flex flex-col gap-4 rounded-xl bg-surface p-4">
          <h3 className="font-semibold">{t("studentSection")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("school", t("pSchool"), 80)}
            {field("course", t("pCourse"), 80)}
          </div>
        </section>
      )}

      {f.isEvaluator && (
        <section className="flex flex-col gap-4 rounded-xl bg-surface p-4">
          <h3 className="font-semibold">{t("evaluatorSection")}</h3>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.accepting} onChange={(e) => set("accepting", e.target.checked)} className="h-4 w-4 accent-brand" />
            {t("pAccepting")}
          </label>
          {!f.accepting && (profile?.missedStreak ?? 0) >= AWAY_AFTER && <p className="text-sm text-muted">{t("awayNote", { n: profile?.missedStreak ?? 0 })}</p>}
          {field("titles", t("pTitles"), 200, { placeholder: "Software Engineer, QA Tester, Registered Nurse" })}
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="yearsExp">
                {t("pYears")}
              </label>
              <input id="yearsExp" type="number" min={0} max={50} className="input" value={f.yearsExp} onChange={(e) => set("yearsExp", Number(e.target.value))} />
            </div>
            <div>
              <label className="label" htmlFor="maxActive">
                {t("pMaxActive")}
              </label>
              <input id="maxActive" type="number" min={1} max={20} className="input" value={f.maxActive} onChange={(e) => set("maxActive", Number(e.target.value))} />
            </div>
            {field("city", t("pCity"), 40)}
          </div>
          <fieldset>
            <legend className="label">{t("pCategories")}</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = f.categories.includes(c);
                return (
                  <button
                    type="button"
                    key={c}
                    aria-pressed={on}
                    onClick={() => set("categories", on ? f.categories.filter((x) => x !== c) : [...f.categories, c].slice(0, 6))}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand bg-brand text-white" : "border-line bg-white"}`}
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {field("skills", t("pSkills"), 300, { placeholder: "Laravel, React, MySQL, Figma" })}
          <fieldset className="flex flex-wrap gap-4">
            <legend className="label">{t("pModes")}</legend>
            {(["online", "onsite"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={f.modes.includes(m)}
                  onChange={(e) => set("modes", e.target.checked ? [...f.modes, m] : f.modes.filter((x) => x !== m))}
                />
                {t(m)}
              </label>
            ))}
          </fieldset>
          {field("linkedin", t("pLinkedin"), 300, { type: "url", pattern: "https://.*", placeholder: "https://linkedin.com/in/..." })}
          <div>
            <label className="label" htmlFor="bio">
              {t("pBio")}
            </label>
            <textarea id="bio" className="input min-h-28" maxLength={600} value={f.bio} onChange={(e) => set("bio", e.target.value)} />
          </div>
        </section>
      )}

      <ErrorText code={err} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy}>
          {t("save")}
        </button>
        {saved && !isNew && <span className="text-sm font-semibold text-brand">{t("saved")}</span>}
      </div>
      {saved && isNew && (
        <section className="flex flex-col gap-3 rounded-xl bg-brand-soft p-4" role="status">
          <h3 className="font-semibold">{t("nextTitle")}</h3>
          <div className="flex flex-wrap gap-2">
            {f.isStudent && (
              <>
                <Link href="/me/projects/new" className="btn-primary">
                  {t("ctaPost")}
                </Link>
                <Link href="/evaluators" className="btn-ghost">
                  {t("ctaFind")}
                </Link>
              </>
            )}
            {f.isEvaluator && (
              <>
                <Link href="/projects" className={f.isStudent ? "btn-ghost" : "btn-primary"}>
                  {t("browseProjects")}
                </Link>
                <Link href="/me?tab=verify" className="btn-ghost">
                  {t("verifyTitle")}
                </Link>
              </>
            )}
          </div>
        </section>
      )}
    </form>
  );
}
