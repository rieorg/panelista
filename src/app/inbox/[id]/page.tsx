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
  useEffect(
    () =>
      onSnapshot(query(collection(db, "requests", id, "messages"), orderBy("createdAt"), limitToLast(200)), (s) => {
        setMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Message));
        markSeen(id);
      }, () => {}),
    [id],
  );
  // Braces matter: Chrome (151+) returns a Promise from scrollIntoView, and
  // React calls whatever an effect returns as its cleanup ("i is not a function").
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  if (r === undefined) return <Spinner />;
  if (r === null) return <Empty img="empty-inbox" text={t("notFound")} />;

  const side = sideOf(r, uid)!;
  const other = side === "student" ? { name: r.evaluatorName, photo: r.evaluatorPhoto, uid: r.evaluatorUid } : { name: r.studentName, photo: r.studentPhoto, uid: r.studentUid };
  const responder = side !== r.initiatedBy;
  // Chat opens once the request is accepted (no unsolicited message floods).
  const canChat = r.status === "accepted" || r.status === "completed";
  const reviewed = side === "student" ? r.reviewedByStudent : r.reviewedByEvaluator;

  async function send() {
    const body = text.trim().slice(0, 2000);
    if (!body) return;
    setText("");
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "requests", id, "messages")), { senderUid: uid, text: body, createdAt: serverTimestamp() });
    batch.update(doc(db, "requests", id), { lastMessage: body.slice(0, 120), lastMessageAt: serverTimestamp(), lastSender: uid });
    await batch.commit().catch(() => setErr("generic"));
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
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-line p-3">
        <Link href={`/e/${other.uid}`} className="flex items-center gap-2">
          <Avatar src={other.photo} name={other.name} size={40} />
          <span className="font-semibold">{other.name}</span>
        </Link>
        <span className="chip">{t(`st_${r.status}`)}</span>
        {r.status === "completed" && (
          <Link href={`/inbox/${id}/certificate`} className="btn-ghost py-1.5">
            {t("certificate")}
          </Link>
        )}
        <Link href={`/p/${r.projectId}`} className="ml-auto max-w-[45%] truncate text-sm text-brand underline">
          {r.projectTitle}
        </Link>
      </header>
      {canChat && formUrl !== null && (formUrl || side === "student") && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft/50 p-3 text-sm">
          {formUrl ? (
            <FormLink href={formUrl} />
          ) : (
            <p>
              {t("noFormOwner")}{" "}
              <Link href={`/me/projects/${r.projectId}/edit`} className="font-semibold text-brand underline">
                {t("addForm")}
              </Link>
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-surface p-4">
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
            <button className="btn-primary" disabled={busy} onClick={() => act("complete")}>
              {t(side === "student" ? "complete" : "completeEval")}
            </button>
            <span className="text-xs text-muted">{t(side === "student" ? "completeHint" : "completeEvalHint")}</span>
            <button className="btn-ghost ml-auto py-1.5" disabled={busy} onClick={() => act("cancel")}>
              {t("cancelReq")}
            </button>
          </div>
        )}
        {r.status === "completed" && !reviewed && <RateForm requestId={id} name={other.name} required={side === "student"} />}
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
      <div role="radiogroup" aria-label={t("rateTitle", { name })} className="flex gap-1 text-3xl">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={stars === i} aria-label={`${i}`} onClick={() => setStars(i)} className={i <= stars ? "text-star" : "text-line"}>
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
              className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-brand bg-brand text-white" : "border-line bg-white"}`}
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
