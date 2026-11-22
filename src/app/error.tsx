"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/firebase";
import { useApp } from "@/components/app-provider";
import { Empty } from "@/components/ui";

// A crash inside a page: keep the header, log it, offer a reload (a retry
// alone cannot fix a DOM that something outside React has changed).
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  const { t } = useApp();
  useEffect(() => reportError(error), [error]);
  return (
    <Empty pose="oops" text={t("crashText")}>
      <button className="btn-primary" onClick={() => location.reload()}>
        {t("reload")}
      </button>
    </Empty>
  );
}
