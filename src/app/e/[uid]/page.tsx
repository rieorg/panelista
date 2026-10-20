import type { Metadata } from "next";
import { publicDoc } from "@/lib/meta";
import { translate } from "@/lib/i18n";
import { EvaluatorProfile } from "./profile";

export async function generateMetadata({ params }: PageProps<"/e/[uid]">): Promise<Metadata> {
  const { uid } = await params;
  const p = await publicDoc(`profiles/${uid}`);
  if (!p) return {};
  const rating = p.evalRatingCount ? ` · ★ ${Number(p.evalRatingAvg).toFixed(1)} · ${translate("en", "ratingsCount", { n: p.evalRatingCount })}` : "";
  const description = `${p.headline || (p.titles ?? []).join(", ")}${rating} · ${translate("en", "yearsExp", { n: p.yearsExp })}. Request a capstone evaluation on Panelista.`;
  return { title: p.name, description, openGraph: { title: `${p.name} on Panelista`, description } };
}

export default async function Page({ params }: PageProps<"/e/[uid]">) {
  const { uid } = await params;
  return <EvaluatorProfile uid={uid} />;
}
