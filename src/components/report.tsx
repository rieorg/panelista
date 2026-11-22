"use client";
import { useState } from "react";
import { api } from "@/lib/firebase";
import { useApp } from "./app-provider";
import { ErrorText, Modal } from "./ui";

const REASONS = [
  ["fake", "reasonFake"],
  ["spam", "reasonSpam"],
  ["rude", "reasonRude"],
  ["scam", "reasonScam"],
  ["other", "reasonOther"],
] as const;

export function ReportButton({ targetUid }: { targetUid: string }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("fake");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setState("busy");
    setErr(null);
    try {
      await api("/api/reports", "POST", { targetUid, reason, details: details.trim() });
      setState("done");
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  }

  return (
    <>
      {/* Quiet text, full 44px target: -my-2 keeps the card as tall as it was. */}
      <button className="-my-2 inline-flex min-h-11 min-w-11 items-center self-start text-xs text-muted underline hover:text-red-700" onClick={() => setOpen(true)}>
        {t("report")}
      </button>
      {open && (
        <Modal title={t("reportTitle")} onClose={() => setOpen(false)}>
          {state === "done" ? (
            <p>{t("reportSent")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <fieldset className="flex flex-col">
                {REASONS.map(([v, k]) => (
                  <label key={v} className="check">
                    <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => setReason(v)} className="h-5 w-5 shrink-0 accent-brand" />
                    {t(k)}
                  </label>
                ))}
              </fieldset>
              <textarea className="input min-h-24" maxLength={500} placeholder={t("reportDetails")} value={details} onChange={(e) => setDetails(e.target.value)} aria-label={t("reportDetails")} />
              <ErrorText code={err} />
              <button className="btn-danger" disabled={state === "busy"} onClick={submit}>
                {t("report")}
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
