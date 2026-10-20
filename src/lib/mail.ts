import "server-only";
import { after } from "next/server";
import nodemailer from "nodemailer";
import type { Action, Side } from "./domain";
import { translate } from "./i18n";
import { adminAuth } from "./server";

// Email notifications: Gmail SMTP with an app password on SMTP_USER. Without
// SMTP_USER and SMTP_PASSWORD (local dev, forks) nothing is sent.

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://panelista.vercel.app";
const FOOTER = "\n\n--\nPanelista: libreng capstone evaluators. Huwag magpadala ng pera o password kahit kanino.";

export type Note = { uid: string; subject: string; text: string };

/** The request fields a mail needs (stored on every request doc). */
export type MailReq = {
  id: string;
  projectTitle: string;
  studentUid: string;
  studentName: string;
  evaluatorUid: string;
  evaluatorName: string;
  initiatedBy: Side;
};

// Names and titles are user text in mail from our address: no links, no line breaks (anti-phishing).
const plain = (s: string) => s.replace(/https?:\/\/\S+|\b[\w-]+(\.[\w-]+)+\/\S*/gi, "[link]").replace(/[\r\n\t]+/g, " ");
const other = (r: MailReq, uid: string) => (uid === r.studentUid ? r.evaluatorUid : r.studentUid);
const nameOf = (r: MailReq, uid: string) => plain(uid === r.studentUid ? r.studentName : r.evaluatorName);
const titleOf = (r: MailReq) => plain(r.projectTitle);
const answerer = (r: MailReq) => (r.initiatedBy === "student" ? r.evaluatorUid : r.studentUid);
const initiator = (r: MailReq) => other(r, answerer(r));

/** One plain-text mail about a request: the news, then the link. Titles are user text, so no line breaks in the subject. */
const note = (uid: string, subject: string, body: string, url: string): Note => ({
  uid,
  subject: `${subject} · Panelista`.replace(/[\r\n]+/g, " "),
  text: `${body}\n\nBuksan: ${url}${FOOTER}`,
});

const inbox = (r: MailReq) => `${SITE}/inbox/${r.id}`;

const SUBJECT: Record<Action, string> = { accept: "Accepted", decline: "Declined", cancel: "Cancelled", complete: "Tapos na" };
const STATUS_OF = { accept: "accepted", decline: "declined", cancel: "cancelled", complete: "completed" } as const;

export const mails = {
  /** A new request goes to the side that must answer it. */
  created(r: MailReq): Note {
    const from = nameOf(r, initiator(r));
    return r.initiatedBy === "student"
      ? note(answerer(r), `Bagong evaluation request: ${titleOf(r)}`, `Si ${from} ay humihingi ng evaluation para sa capstone nila, "${titleOf(r)}". Pakisagot (Accept o Decline) within 3 days, kung hindi mag-e-expire ito.`, inbox(r))
      : note(answerer(r), `May nag-offer na mag-evaluate: ${titleOf(r)}`, `Si ${from} ay nag-offer na i-evaluate ang "${titleOf(r)}". Pakisagot within 3 days, kung hindi mag-e-expire ito.`, inbox(r));
  },
  /** Accept, decline, cancel or done: tells the other participant. */
  action(r: MailReq, actorUid: string, action: Action): Note {
    const to = other(r, actorUid);
    // Same words as the chat notice: "Tinanggap ni Ben ang request".
    const did = translate("tl", `sys_${STATUS_OF[action]}`, { name: nameOf(r, actorUid) });
    const rate = action === "complete" && to === r.studentUid ? " I-rate mo siya: required ito bago ka mag-post o mag-request ulit." : "";
    return note(to, `${SUBJECT[action]}: ${titleOf(r)}`, `${did} para sa "${titleOf(r)}".${rate}`, inbox(r));
  },
  /** Day 2 of 3: nudges the side that has not answered. */
  reminder(r: MailReq): Note {
    return note(answerer(r), `Paalala: ${titleOf(r)}`, `Hindi mo pa nasasagot ang request ni ${nameOf(r, initiator(r))} para sa "${titleOf(r)}". Mag-e-expire ito bukas.`, inbox(r));
  },
  /** Day 3: the asker learns it lapsed and can ask someone else. */
  expired(r: MailReq): Note {
    const url = r.initiatedBy === "student" ? `${SITE}/evaluators` : `${SITE}/projects`;
    return note(initiator(r), `Nag-expire: ${titleOf(r)}`, `Nag-expire ang request kay ${nameOf(r, answerer(r))} para sa "${titleOf(r)}": walang sagot sa loob ng 3 araw. Pwede kang humanap ng iba.`, url);
  },
  /** The evaluator let too many invites expire and no longer takes new ones. */
  away(uid: string, missed: number): Note {
    return note(uid, "Naka-Away ka muna", `Na-set ka namin sa Away kasi ${missed} request ang nag-expire nang walang sagot, kaya hindi ka muna makakatanggap ng bago. I-on ulit ang "Tumatanggap ng requests" sa profile mo pag ready ka na.`, `${SITE}/me?tab=profile`);
  },
};

/**
 * Emails each user after the response is sent, so the request never waits on SMTP.
 * Only verified addresses get mail.
 * ponytail: fire-and-forget, a failed send is only logged; add an outbox with retries if mails go missing.
 */
export function notify(notes: Note[]) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD?.replace(/\s/g, "");
  if (!user || !pass || !notes.length) return;
  after(async () => {
    const to = new Map<string, string>();
    for (let i = 0; i < notes.length; i += 100) {
      const { users } = await adminAuth().getUsers(notes.slice(i, i + 100).map((n) => ({ uid: n.uid })));
      for (const u of users) if (u.email && u.emailVerified) to.set(u.uid, u.email);
    }
    // Gmail allows about 500 recipients a day; 5 per second keeps us under its burst limit.
    const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass }, pool: true, maxConnections: 1, rateDelta: 1000, rateLimit: 5 });
    try {
      for (const n of notes) {
        const addr = to.get(n.uid);
        if (!addr) continue;
        await transport
          .sendMail({ from: { name: "Panelista", address: user }, to: addr, subject: n.subject, text: n.text })
          .catch((e) => console.error("mail not sent:", n.subject, e instanceof Error ? e.message : e));
      }
    } finally {
      transport.close();
    }
  });
}
