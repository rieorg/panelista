"use client";
import Link from "next/link";
import { useApp } from "@/components/app-provider";
import { Empty } from "@/components/ui";

// Any address that matches no page. It renders inside the root layout, so the header stays.
export default function NotFound() {
  const { t } = useApp();
  return (
    <Empty pose="wave" title={t("lostTitle")} text={t("notFound")}>
      <Link href="/" className="btn-primary">
        {t("backHome")}
      </Link>
    </Empty>
  );
}
