"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, getDocFromServer } from "firebase/firestore";
import { api, auth, db } from "@/lib/firebase";
import { CATEGORIES } from "@/lib/domain";
import { CATEGORY_LABELS } from "@/lib/i18n";
import { useApp } from "./app-provider";
import { Bubble, Pany, type Pose } from "./pany";
import { ErrorText } from "./ui";

// "Skip for now" is remembered per account on this device, like the inbox read markers in ui.tsx.
const skipKey = (uid: string) => `onboard-skip:${uid}`;
export function skippedOnboarding(uid: string) {
  try {
    return localStorage.getItem(skipKey(uid)) === "1";
  } catch {
    return false;
  }
}
function rememberSkip(uid: string) {
  try {
    localStorage.setItem(skipKey(uid), "1");
  } catch {}
}

type Step = "role" | "name" | "school" | "work" | "expertise" | "done";
const POSE: Record<Step, Pose> = { role: "wave", name: "grading", school: "tip", work: "grading", expertise: "thinking", done: "cheer" };
const QUESTION = { role: "onbHi", name: "onbName", school: "onbSchool", work: "onbWork", expertise: "onbExpertise" } as const;
const COURSES = ["BSIT", "BSIS", "BSCS"];
// What "Later na" leaves out of the saved profile, per step.
const BLANK = { school: { school: "", course: "" }, work: { headline: "", yearsExp: 0 }, expertise: { categories: [] as string[] } };
type Skippable = keyof typeof BLANK;
const MAX_CATEGORIES = 6;

/**
 * First run, guided by Pany: one question per screen, and only the questions that fit the
 * chosen role. It saves through PUT /api/profile with the same fields as the profile form,
 * so nothing here needs new rules or data. Everything else stays editable under Profile.
 *
 * `required`: the page underneath needs a profile, so the flow cannot be skipped and its last
 * button reveals that page. Otherwise it offers "skip for now" and points at the next step.
 * `onSaving` fires right before the save, `onClose` when the person leaves the flow.
 */
export function Onboarding({ required, onSaving, onClose }: { required: boolean; onSaving: () => void; onClose: () => void }) {
  const { t, user } = useApp();
  const wantsEval = useSearchParams().get("role") === "evaluator";
  const [f, setF] = useState({
    isStudent: !wantsEval,
    isEvaluator: wantsEval,
    name: user?.displayName ?? "",
    school: "",
    course: "BSIT",
    otherCourse: false,
    headline: "",
    yearsExp: 0,
    categories: [] as string[],
  });
  const [step, setStep] = useState<Step>("role");
  const [later, setLater] = useState<Skippable[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const steps: Step[] = ["role", "name", ...(f.isStudent ? (["school"] as const) : []), ...(f.isEvaluator ? (["work", "expertise"] as const) : []), "done"];
  const at = steps.indexOf(step);
  // Signing in was step 1, so the bar never starts empty.
  const n = at + 2;
  const total = steps.length + 1;

  // Moving between steps puts focus on the new question, so screen readers announce it
  // and Tab continues from there. Not on first paint: that would steal focus from the page.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);

  function go(to: Step) {
    moved.current = true;
    setErr(null);
    setStep(to);
  }

  async function submit(skip: boolean) {
    setErr(null);
    if (step === "role" && !f.isStudent && !f.isEvaluator) return setErr("pick-role");
    if (step === "name" && f.name.trim().length < 2) return setErr("invalid:name");
    const skipped = step in BLANK ? (skip ? [...later, step as Skippable] : later.filter((s) => s !== step)) : later;
    setLater(skipped);
    const next = steps[at + 1];
    if (next !== "done") return go(next);

    // Last question. Answers for a role that was switched off, or a step left for later, are not saved.
    const left: Partial<typeof f> = Object.assign({}, ...skipped.map((s) => BLANK[s]), f.isStudent ? {} : BLANK.school, f.isEvaluator ? {} : { ...BLANK.work, ...BLANK.expertise });
    const data = { ...f, ...left };
    setBusy(true);
    try {
      // This flow is for accounts without a profile, and the save would replace an existing one.
      // Ask the server (not the listener) once more, and step aside if a profile is there.
      if ((await getDocFromServer(doc(db, "profiles", user!.uid))).exists()) return onClose();
      onSaving();
      await api("/api/profile", "PUT", {
        name: data.name.trim(),
        headline: data.headline.trim(),
        bio: "",
        titles: [],
        yearsExp: data.yearsExp,
        categories: data.categories,
        skills: [],
        city: "",
        modes: ["online"],
        linkedin: "",
        school: data.school.trim(),
        course: data.course.trim(),
        isStudent: data.isStudent,
        isEvaluator: data.isEvaluator,
        accepting: true,
        maxActive: 5,
      });
      go("done");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const bar = (
    <div className="flex min-h-11 items-center gap-3">
      {at > 0 && step !== "done" && (
        <button type="button" onClick={() => go(steps[at - 1])} aria-label={t("back")} className="-ml-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-brand-soft">
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}
      <div role="progressbar" aria-label={t("onbProgress", { a: n, n: total })} aria-valuemin={1} aria-valuemax={total} aria-valuenow={n} className="h-1 flex-1 overflow-hidden rounded-full bg-brand-soft">
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${(n / total) * 100}%` }} />
      </div>
      <span aria-hidden className="font-mono text-xs text-muted tabular-nums">
        {n} / {total}
      </span>
      {/* Leaving the whole flow is offered up front; later steps have "Later na" instead. */}
      {!required && step === "role" && (
        <button
          type="button"
          className="btn-quiet -mr-3"
          onClick={() => {
            if (user) rememberSkip(user.uid);
            onClose();
          }}
        >
          {t("onbSkip")}
        </button>
      )}
    </div>
  );

  if (step === "done") {
    const first = f.name.trim().split(/\s+/)[0];
    // Someone who is both gets the student path first: posting the capstone is what unblocks them.
    const s = f.isStudent;
    const todo = s ? (["ctaPost", "onbCheckRequest"] as const) : (["onbCheckOffer", "onbCheckVerify"] as const);
    return (
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        {bar}
        <div className="step-in flex flex-col gap-5">
          <div className="flex justify-center rounded-3xl bg-brand-soft pt-4">
            <Pany pose="cheer" size={176} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">
              {t(s ? "onbDoneStudent" : "onbDoneEval", { name: first })}
            </h1>
            <p className="text-muted">{t(s ? "onbDoneStudentSub" : "onbDoneEvalSub")}</p>
          </div>
          <ol className="card divide-y divide-line text-[15px]">
            {(["signIn", "onbCheckProfile"] as const).map((k) => (
              <li key={k} className="flex items-center gap-3 px-4 py-3.5 text-muted">
                <span aria-hidden className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-brand text-white">
                  <Check />
                </span>
                <span className="line-through">{t(k)}</span>
                <span className="sr-only">{t("onbCheckDone")}</span>
              </li>
            ))}
            {todo.map((k, i) => (
              <li key={k} className={`flex items-center gap-3 px-4 py-3.5 ${i === 0 ? "font-medium" : ""}`}>
                <span aria-hidden className={`h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px] ${i === 0 ? "border-brand" : "border-line-strong"}`} />
                {t(k)}
                {i === 0 && s && <span className="ml-auto font-mono text-xs font-normal text-muted tabular-nums">{t("onbMins", { n: 2 })}</span>}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-2">
            {required ? (
              // The page under this flow was waiting for the profile that now exists.
              <button type="button" onClick={onClose} className="btn-primary min-h-[52px] text-base">
                {t("onbContinue")}
              </button>
            ) : (
              <Link href={s ? "/me/projects/new" : "/projects"} onClick={onClose} className="btn-primary min-h-[52px] text-base">
                {t(s ? "ctaPost" : "browseProjects")}
              </Link>
            )}
            <Link href={s ? "/evaluators" : "/me?tab=profile"} onClick={onClose} className="btn-quiet">
              {t(s ? "onbBrowseFirst" : "onbFinishProfile")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const skippable = step in BLANK;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      {bar}
      <form
        key={step}
        className="step-in flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <div className="flex items-start gap-2.5">
          <Pany pose={POSE[step]} size={112} />
          <Bubble tone={step === "school" ? "tip" : "say"} who={step === "school" ? t("onbTip") : "Pany"} className="mt-3 flex-1">
            <h1 ref={heading} tabIndex={-1} id="onb-q" className="text-lg leading-snug font-semibold outline-none">
              {t(QUESTION[step])}
            </h1>
          </Bubble>
        </div>

        {step === "role" && (
          <div role="group" aria-labelledby="onb-q" className="flex flex-col gap-3">
            <RoleCard checked={f.isStudent} onChange={(v) => set("isStudent", v)} title={t("onbStudent")} sub={t("onbStudentSub")}>
              <path d="M22 10 12 5 2 10l10 5 10-5Z" />
              <path d="M6 12v5c3 2 9 2 12 0v-5" />
            </RoleCard>
            <RoleCard checked={f.isEvaluator} onChange={(v) => set("isEvaluator", v)} title={t("onbEvaluator")} sub={t("onbEvaluatorSub")}>
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
              <path d="m9 10 2 2 4-4" />
            </RoleCard>
            <p className="text-sm text-muted">{t("onbBoth")}</p>
          </div>
        )}

        {step === "name" && (
          <div>
            <label className="label" htmlFor="onb-name">
              {t("pName")}
            </label>
            <input id="onb-name" className="input" required minLength={2} maxLength={60} autoComplete="name" aria-describedby="onb-name-hint" value={f.name} onChange={(e) => set("name", e.target.value)} />
            <p id="onb-name-hint" className="mt-1.5 text-sm text-muted">
              {t("onbNameHint")}
            </p>
          </div>
        )}

        {step === "school" && (
          <>
            <div>
              <label className="label" htmlFor="onb-school">
                {t("pSchool")}
              </label>
              <input id="onb-school" className="input" maxLength={80} autoComplete="organization" value={f.school} onChange={(e) => set("school", e.target.value)} />
            </div>
            <fieldset>
              <legend className="label">{t("pCourse")}</legend>
              <div className="grid grid-cols-4 gap-1.5">
                {[...COURSES, ""].map((c) => {
                  const on = c ? !f.otherCourse && f.course === c : f.otherCourse;
                  return (
                    <label key={c} className="pick px-1">
                      <input type="radio" name="onb-course" className="sr-only" checked={on} onChange={() => setF((x) => ({ ...x, course: c, otherCourse: !c }))} />
                      {c || t("reasonOther")}
                    </label>
                  );
                })}
              </div>
              {f.otherCourse && <input className="input mt-2" maxLength={80} aria-label={t("pCourse")} placeholder="BS Computer Engineering" value={f.course} onChange={(e) => set("course", e.target.value)} />}
            </fieldset>
          </>
        )}

        {step === "work" && (
          <>
            <div>
              <label className="label" htmlFor="onb-headline">
                {t("pHeadline")}
              </label>
              <input id="onb-headline" className="input" maxLength={80} autoComplete="organization-title" value={f.headline} onChange={(e) => set("headline", e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="onb-years">
                {t("pYears")}
              </label>
              <div className="flex items-center gap-2">
                <StepButton label={t("onbLess")} disabled={f.yearsExp <= 0} onClick={() => set("yearsExp", Math.max(0, f.yearsExp - 1))}>
                  <path d="M5 12h14" />
                </StepButton>
                <input
                  id="onb-years"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={50}
                  aria-describedby="onb-years-hint"
                  className="input w-24 text-center font-mono tabular-nums"
                  value={f.yearsExp}
                  onChange={(e) => set("yearsExp", Math.max(0, Math.min(50, Math.round(Number(e.target.value) || 0))))}
                />
                <StepButton label={t("onbMore")} disabled={f.yearsExp >= 50} onClick={() => set("yearsExp", Math.min(50, f.yearsExp + 1))}>
                  <path d="M12 5v14M5 12h14" />
                </StepButton>
              </div>
              <p id="onb-years-hint" className="mt-1.5 text-sm text-muted">
                {t("onbWorkHint")}
              </p>
            </div>
          </>
        )}

        {step === "expertise" && (
          <fieldset aria-labelledby="onb-q" className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = f.categories.includes(c);
                return (
                  <label key={c} className="pick">
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => set("categories", on ? f.categories.filter((x) => x !== c) : [...f.categories, c].slice(0, MAX_CATEGORIES))} />
                    {CATEGORY_LABELS[c]}
                  </label>
                );
              })}
            </div>
            <p className="font-mono text-xs text-muted tabular-nums" aria-live="polite">
              {f.categories.length} / {MAX_CATEGORIES}
            </p>
          </fieldset>
        )}

        <ErrorText code={err} />

        <div className="flex flex-col gap-2">
          <button className="btn-primary min-h-[52px] text-base" disabled={busy} aria-busy={busy}>
            {t("next")}
          </button>
          {skippable && (
            <button type="button" className="btn-quiet" disabled={busy} onClick={() => submit(true)}>
              {t("onbLater")}
            </button>
          )}
        </div>
      </form>

      {step === "role" && user?.email && (
        <p className="text-center text-sm text-muted">
          {t("onbSignedInAs", { email: user.email })}{" "}
          <button type="button" className="-my-3 py-3 font-medium text-brand underline" onClick={() => signOut(auth)}>
            {t("signOut")}
          </button>
        </p>
      )}
    </div>
  );
}

const Check = () => (
  <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12 5 5 9-10" />
  </svg>
);

/** One role as a big check card: a real checkbox, so both can be on and the keyboard just works. */
function RoleCard({ checked, onChange, title, sub, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; sub: string; children: React.ReactNode }) {
  return (
    <label className="flex min-h-[76px] cursor-pointer items-center gap-3.5 rounded-2xl border border-line-strong bg-white p-4 transition-colors hover:bg-brand-soft/40 has-[:checked]:border-brand has-[:checked]:bg-brand-soft/40 has-[:checked]:shadow-[inset_0_0_0_1px_var(--color-brand)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-muted peer-checked:text-brand" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-muted">{sub}</span>
      </span>
      <span aria-hidden className="ml-auto grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-muted/60 text-transparent peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white">
        <Check />
      </span>
    </label>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="btn-ghost w-11 px-0">
      <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {children}
      </svg>
    </button>
  );
}
