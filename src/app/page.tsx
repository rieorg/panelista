"use client";
import Link from "next/link";
import { useApp } from "@/components/app-provider";
import { Pany } from "@/components/pany";

export default function Home() {
  const { t, user } = useApp();
  // Pany walks through the three steps: a tip, a hello, then the certificate.
  const steps = [
    ["how1T", "how1", "tip"],
    ["how2T", "how2", "wave"],
    ["how3T", "how3", "certificate"],
  ] as const;
  const beHref = user ? "/me?tab=profile&role=evaluator" : "/login?next=%2Fme%3Ftab%3Dprofile%26role%3Devaluator";
  return (
    <div className="flex flex-col gap-14 py-4 sm:gap-20 sm:py-8">
      <section className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
        <div className="flex flex-col gap-5">
          <p className="text-sm font-medium text-brand-dark">{t("freeNote")}</p>
          <h1 className="text-4xl leading-[1.1] font-bold tracking-tight sm:text-5xl">{t("heroTitle")}</h1>
          <p className="max-w-xl text-lg text-muted">{t("heroSub")}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/evaluators" className="btn-primary min-h-12 px-5 text-base">
              {t("ctaFind")}
            </Link>
            <Link href={beHref} className="btn-ghost min-h-12 px-5 text-base">
              {t("ctaBe")}
            </Link>
          </div>
        </div>
        <div className="rounded-3xl bg-brand-soft p-5 sm:p-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/hero.svg" alt="" width={560} height={420} className="mx-auto w-full max-w-lg" />
        </div>
      </section>

      <section aria-labelledby="how" className="flex flex-col gap-6">
        <h2 id="how" className="text-2xl font-bold tracking-tight sm:text-[28px]">
          {t("howTitle")}
        </h2>
        <ol className="grid border-t border-line md:grid-cols-3">
          {steps.map(([title, body, pose], i) => (
            <li key={title} className="flex items-start gap-4 border-b border-line py-5 md:flex-col md:gap-3 md:border-r md:border-b-0 md:px-6 md:py-6 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
              {/* One fixed cell on phones, so the three titles line up whatever the pose's width. */}
              <span className="flex w-[82px] shrink-0 justify-center md:w-auto">
                <Pany pose={pose} size={96} />
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="font-mono text-sm text-brand tabular-nums">0{i + 1}</span>
                <h3 className="text-lg font-bold">{t(title)}</h3>
                <p className="text-[15px] leading-relaxed text-muted">{t(body)}</p>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Link href={user ? "/me/projects/new" : "/login?next=%2Fme%2Fprojects%2Fnew"} className="btn-primary min-h-12 px-5 text-base">
            {t("ctaPost")}
          </Link>
        </div>
      </section>

      <section className="grid items-center gap-6 rounded-3xl bg-ink p-6 text-white sm:p-10 md:grid-cols-[1fr_auto] md:gap-10">
        <div className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold tracking-tight sm:text-[28px]">{t("proTitle")}</h2>
          <p className="max-w-2xl text-white/80">{t("proSub")}</p>
        </div>
        <div className="flex items-end justify-between gap-5">
          <Link href={beHref} className="btn min-h-12 bg-surface px-5 text-base text-ink hover:bg-brand-soft">
            {t("ctaBe")}
          </Link>
          <span className="flex h-28 w-28 shrink-0 items-end justify-center overflow-hidden rounded-2xl bg-surface">
            <Pany pose="cheer" size={104} />
          </span>
        </div>
      </section>
    </div>
  );
}
