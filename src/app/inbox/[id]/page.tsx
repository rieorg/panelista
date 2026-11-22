"use client";
import { Suspense, use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { collection, doc, getDoc, limitToLast, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import { api, db } from "@/lib/firebase";
import { sideOf, type Action } from "@/lib/domain";
import { REVIEW_TAGS } from "@/lib/schemas";
import type { EvalRequest, Message } from "@/lib/types";
import { useApp } from "@/components/app-provider";
import { RequireProfile } from "@/components/guard";
import { Avatar, Empty, ErrorText, FormLink, markSeen, Spinner } from "@/components/ui";

function Thread({ id }: { id: string }) {
  const { t, user } = useApp();
  const uid = user!.uid;
  const [r, setR] = useState<EvalRequest | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The project's form link, so the evaluator has it right in the thread.
  const [formUrl, setFormUrl] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const projectId = r?.projectId;

  useEffect(() => onSnapshot(doc(db, "requests", id), (s) => setR(s.exists() ? ({ id: s.id, ...s.data() } as EvalRequest) : null), () => setR(null)), [id]);
  useEffect(() => {
    if (!projectId) return;
    getDoc(doc(db, "projects", projectId)).then((s) => setFormUrl((s.get("formUrl") as string) ?? ""), () => setFormUrl(""));
  }, [projectId]);
  // Whether the evaluator has submitted the built-in ISO 25010 form for this request.
  const [evaluated, setEvaluated] = useState(false);
  useEffect(() => onSnapshot(doc(db, "evaluations", id), (s) => setEvaluated(s.exists()), () => setEvaluated(false)), [id]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, "requests", id, "messages"), orderBy("createdAt"), limitToLast(200)), (s) => {
        setMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Message));
        markSeen(id);
      }, () => {}),
    [id],
  );
  // To the end when messages arrive, and again when the strip under the header shows up or the request changes
  // state: both change the room the list has, and the last message or the rating form slid out of view.
  // Braces matter: Chrome (151+) returns a Promise from scrollIntoView, and
  // React calls whatever an effect returns as its cleanup ("i is not a function").
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length, formUrl, evaluated, r?.status]);

  if (r === undefined) return <Spinner />;
  if (r === null) return <Empty pose="oops" text={t("notFound")} />;

  const side = sideOf(r, uid)!;
  const other = side === "student" ? { name: r.evaluatorName, photo: r.evaluatorPhoto, uid: r.evaluatorUid } : { name: r.studentName, photo: r.studentPhoto, uid: r.studentUid };
  const responder = side !== r.initiatedBy;
  // Chat opens once the request is accepted (no unsolicited message floods).
  const canChat = r.status === "accepted" || r.status === "completed";
  const reviewed = side === "student" ? r.reviewedByStudent : r.reviewedByEvaluator;
  // Under the header: the school's form link, the built-in ISO form (evaluator) or its results (owner), and,
  // only while the evaluation is still open, a nudge for the owner to add a form link. Nothing to offer, no strip.
  const nudge = side === "student" && !formUrl && r.status === "accepted";
  const strip = canChat && formUrl !== null && (!!formUrl || side === "evaluator" || evaluated || nudge);

  async function send() {
    const body = text.trim().slice(0, 2000);
    if (!body) return;
    setText("");
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "requests", id, "messages")), { senderUid: uid, text: body, createdAt: serverTimestamp() });
    batch.update(doc(db, "requests", id), { lastMessage: body.slice(0, 120), lastMessageAt: serverTimestamp(), lastSender: uid });
    await batch.commit().catch(() => {
      setErr("generic");
      // Give the text back unless they already started a new one.
      setText((cur) => cur || body);
    });
  }

  async function act(action: Action) {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/requests/${id}`, "POST", { action });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Phones: edge to edge and as tall as the screen under the site header (57px there, see chrome.tsx).
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-white max-sm:-mx-4 max-sm:-my-6 max-sm:h-[calc(100dvh-57px)] max-sm:rounded-none max-sm:border-0">
      <header className="flex flex-wrap items-center gap-x-2 border-b border-line px-2 py-1 sm:gap-x-3 sm:px-3 sm:py-2">
        {/* Phones: the way back to the inbox, since the site's link row is hidden on this screen. */}
        <Link href="/me?tab=inbox" aria-label={t("navInbox")} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface sm:hidden">
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <Link href={`/e/${other.uid}`} className="flex min-h-11 min-w-0 items-center gap-2">
          <Avatar src={other.photo} name={other.name} size={40} />
          <span className="truncate font-semibold">{other.name}</span>
        </Link>
        <span className="chip shrink-0">{t(`st_${r.status}`)}</span>
        {/* Phones: the project title starts a second row (45% of the header cut every title short),
            with the certificate beside it once there is one. Wider screens keep one row, title at the right. */}
        <span className="basis-full sm:hidden" />
        <Link href={`/p/${r.projectId}`} className="min-w-0 flex-1 truncate px-1 py-3 text-sm text-brand underline sm:order-last sm:ml-auto sm:max-w-[45%] sm:flex-none sm:px-0">
          {r.projectTitle}
        </Link>
        {r.status === "completed" && (
          <Link href={`/inbox/${id}/certificate`} className="btn-ghost shrink-0 py-1.5">
            {t("certificate")}
          </Link>
        )}
      </header>
      {strip && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft/50 p-2 text-sm sm:p-3">
          {formUrl && <FormLink href={formUrl} />}
          {side === "evaluator" ? (
            <Link href={`/inbox/${id}/evaluate`} className={formUrl ? "btn-ghost" : "btn-primary"}>
              {t(evaluated ? "isoEdit" : "isoFill")}
            </Link>
          ) : (
            <>
              {nudge && (
                <p>
                  {t("noFormOwner")}{" "}
                  <Link href={`/me/projects/${r.projectId}/edit`} className="font-semibold text-brand underline">
                    {t("addForm")}
                  </Link>
                </p>
              )}
              {evaluated && (
                <Link href={`/p/${r.projectId}/results`} className="btn-primary">
                  {t("isoResults")}
                </Link>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-surface p-3 sm:p-4">
        <p className="mb-4 rounded-xl bg-accent/20 p-3 text-center text-xs">{t("safety")}</p>
        <ul className="flex flex-col gap-2">
          {msgs.map((m) =>
            m.system ? (
              <li key={m.id} className="text-center text-xs text-muted">
                {m.senderUid === uid ? t(`sysMe_${m.system}` as never) : t(`sys_${m.system}` as never, { name: other.name })}
              </li>
            ) : (
              <li key={m.id} className={`flex ${m.senderUid === uid ? "justify-end" : "justify-start"}`}>
                <p className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${m.senderUid === uid ? "bg-brand text-white" : "bg-white"}`}>{m.text}</p>
              </li>
            ),
          )}
        </ul>
        {/* Phones: the hint for the button below reads here, at the end of the thread, so the bar under it stays two rows. */}
        {r.status === "accepted" && <p className="mt-3 text-center text-xs text-muted sm:hidden">{t(side === "student" ? "completeHint" : "completeEvalHint")}</p>}
        {/* The rating form is the last thing in the thread, not a fixed block that leaves the messages a slit. */}
        {r.status === "completed" && !reviewed && (
          <div className="mt-4">
            <RateForm requestId={id} name={other.name} required={side === "student"} />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex flex-col gap-2 border-t border-line p-3">
        <ErrorText code={err} />
        {r.status === "pending" &&
          (responder ? (
            <div className="flex gap-2">
              <button className="btn-primary flex-1" disabled={busy} onClick={() => act("accept")}>
                {t("accept")}
              </button>
              <button className="btn-ghost flex-1" disabled={busy} onClick={() => act("decline")}>
                {t("decline")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-sm text-muted">
              <span>{t("waitingFor", { name: other.name })}</span>
              <button className="btn-ghost py-1.5" disabled={busy} onClick={() => act("cancel")}>
                {t("cancelReq")}
              </button>
            </div>
          ))}
        {r.status === "accepted" && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary max-sm:flex-1" disabled={busy} onClick={() => act("complete")}>
              {t(side === "student" ? "complete" : "completeEval")}
            </button>
            <span className="text-xs text-muted max-sm:hidden">{t(side === "student" ? "completeHint" : "completeEvalHint")}</span>
            <button className="btn-ghost ml-auto py-1.5" disabled={busy} onClick={() => act("cancel")}>
              {t("cancelReq")}
            </button>
          </div>
        )}
        {canChat && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              rows={1}
              className="input max-h-32 resize-none"
              maxLength={2000}
              placeholder={t("typeMsg")}
              aria-label={t("typeMsg")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button className="btn-primary" disabled={!text.trim()}>
              {t("send")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function RateForm({ requestId, name, required }: { requestId: string; name: string; required: boolean }) {
  const { t } = useApp();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/reviews", "POST", { requestId, stars, tags, text: text.trim() });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-brand-soft p-3">
      <p className="font-semibold">{t("rateTitle", { name })}</p>
      {required && <p className="text-xs text-muted">{t("rateRequired")}</p>}
      <div role="radiogroup" aria-label={t("rateTitle", { name })} className="-ml-1.5 flex text-3xl">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={stars === i} aria-label={`${i}`} onClick={() => setStars(i)} className={`h-11 w-11 ${i <= stars ? "text-star" : "text-line-strong"}`}>
            ★
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {REVIEW_TAGS.map((tg) => {
          const on = tags.includes(tg);
          return (
            <button
              type="button"
              key={tg}
              aria-pressed={on}
              onClick={() => setTags(on ? tags.filter((x) => x !== tg) : [...tags, tg].slice(0, 4))}
              className="pick"
            >
              {t(`tag_${tg}` as never)}
            </button>
          );
        })}
      </div>
      <textarea className="input min-h-16" maxLength={500} placeholder={t("ratePh")} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("ratePh")} />
      <ErrorText code={err} />
      <button className="btn-primary w-fit" disabled={busy || !stars} onClick={submit}>
        {t("rateSubmit")}
      </button>
    </div>
  );
}

export default function ThreadPage({ params }: PageProps<"/inbox/[id]">) {
  const { id } = use(params);
  return (
    <Suspense>
      <RequireProfile>
        <Thread id={id} />
      </RequireProfile>
    </Suspense>
  );
}
