import type { Metadata } from "next";
import { publicDoc } from "@/lib/meta";
import { translate } from "@/lib/i18n";
import { ProjectView } from "./view";

// The project loads live in the browser; only the link-preview metadata comes from here, cached an hour.
export const revalidate = 3600;

export async function generateMetadata({ params }: PageProps<"/p/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = await publicDoc(`projects/${id}`);
  if (!p) return {};
  const description = `${p.course} · ${p.school}. ${translate("en", "neededCount", { a: p.acceptedCount, n: p.needed })} found. ${String(p.abstract).slice(0, 140)}`;
  return { title: p.title, description, openGraph: { title: `Evaluate "${p.title}" on Panelista`, description } };
}

export default async function Page({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  return <ProjectView id={id} />;
}
