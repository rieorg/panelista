import "server-only";
import { after } from "next/server";
import nodemailer from "nodemailer";
import type { Action, Side } from "./domain";
import { adminAuth } from "./server";

// Email notifications: Gmail SMTP with an app password on SMTP_USER. Without
// SMTP_USER and SMTP_PASSWORD (local dev, forks) nothing is sent.

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://panelista.vercel.app";

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

// Who gets a mail: uid, name for the greeting, and the register. Same split as the UI
// strings in i18n.ts: panelists get "po", students get everyday Taglish without it.
type To = { uid: string; name: string; panelist: boolean };
const to = (r: MailReq, uid: string): To => ({ uid, name: nameOf(r, uid), panelist: uid === r.evaluatorUid });

/** One plain-text mail: greeting, the news, the link on its own line, the owner's sign-off. */
const note = (t: To, subject: string, lines: string[], url: string): Note => ({
  uid: t.uid,
  subject: `${subject} · Panelista`.replace(/[\r\n]+/g, " "),
  text: [
    `Hi ${t.name.trim().split(/\s+/)[0]}!`,
    "",
    ...lines,
    url,
    "",
    t.panelist ? "May tanong po? Reply lang po kayo dito." : "May tanong? Reply ka lang dito.",
    "Eirmon",
    "",
    "--",
    "Libre ang Panelista. Wag magpadala ng pera o password kahit kanino.",
  ].join("\n"),
});

const inbox = (r: MailReq) => `${SITE}/inbox/${r.id}`;
const SUBJECT: Record<Action, string> = { accept: "Accepted", decline: "Declined", cancel: "Cancelled", complete: "Done na" };

export const mails = {
  /** A new request goes to the side that must answer it. */
  created(r: MailReq): Note {
    const from = nameOf(r, initiator(r));
    const t = to(r, answerer(r));
    return t.panelist
      ? note(t, `Capstone evaluation request: ${titleOf(r)}`, [`May capstone evaluation request po kayo from ${from}:`, `"${titleOf(r)}"`, "", "Pa-accept or decline lang po within 3 days, para di mag-expire:"], inbox(r))
      : note(t, `May offer ka: ${titleOf(r)}`, [`${from} wants to evaluate your capstone!`, `"${titleOf(r)}"`, "", "Accept or decline mo lang within 3 days, para di mag-expire:"], inbox(r));
  },
  /** Accept, decline, cancel or done: tells the other participant. */
  action(r: MailReq, actorUid: string, action: Action): Note {
    const t = to(r, other(r, actorUid));
    const name = nameOf(r, actorUid);
    const title = `"${titleOf(r)}"`;
    const [lines, url] = t.panelist
      ? ({
          accept: [[`Na-accept po ni ${name} ang offer niyo para sa ${title}!`, "Pwede na po kayong mag-chat dito:"], inbox(r)],
          decline: [[`Na-decline po ni ${name} ang offer niyo para sa ${title}.`, "Thank you pa rin po sa pag-offer! Marami pa pong capstones dito:"], `${SITE}/projects`],
          cancel: [[`Na-cancel po ni ${name} ang evaluation para sa ${title}.`, "Details po dito:"], inbox(r)],
          complete: [[`Done na po ang evaluation para sa ${title}, sabi ni ${name}. Thank you po!`, "Pwede niyo rin po siyang i-rate dito:"], inbox(r)],
        } as const)[action]
      : ({
          accept: [[`Na-accept ni ${name} ang request mo para sa ${title}!`, "Chat na kayo dito:"], inbox(r)],
          decline: [[`Na-decline ni ${name} ang request mo para sa ${title}.`, "Don't worry, marami pang evaluators. Request ka lang ulit dito:"], `${SITE}/evaluators`],
          cancel: [[`Na-cancel ni ${name} ang evaluation para sa ${title}.`, "Details dito:"], inbox(r)],
          complete: [[`Done na daw ang evaluation ni ${name} para sa ${title}!`, "Rate mo siya dito. Required 'to bago ka mag-post or mag-request ulit:"], inbox(r)],
        } as const)[action];
    return note(t, `${SUBJECT[action]}: ${titleOf(r)}`, [...lines], url);
  },
  /** Day 3: the asker learns it lapsed and can ask someone else. */
  expired(r: MailReq): Note {
    const them = nameOf(r, answerer(r));
    const t = to(r, initiator(r));
    return t.panelist
      ? note(t, `Expired: ${titleOf(r)}`, [`Expired na po ang offer niyo para sa "${titleOf(r)}". Di po nakasagot si ${them} within 3 days.`, "Thank you pa rin po! Marami pa pong capstones dito:"], `${SITE}/projects`)
      : note(t, `Expired: ${titleOf(r)}`, [`Expired na ang request mo kay ${them} para sa "${titleOf(r)}", walang reply within 3 days.`, "Don't worry, marami pang evaluators. Hanap ka ng iba dito:"], `${SITE}/evaluators`);
  },
  /** First ISO 25010 submission: the student's computed results are ready. */
  evaluated(r: MailReq, projectId: string): Note {
    return note(to(r, r.studentUid), `ISO 25010 results: ${titleOf(r)}`, [
      `Na-submit na ni ${nameOf(r, r.evaluatorUid)} ang ISO 25010 evaluation para sa "${titleOf(r)}"!`,
      "Computed na ang weighted means para sa Chapter 4 mo, nandito:",
    ], `${SITE}/p/${projectId}/results`);
  },
  /** The evaluator let too many invites expire and no longer takes new ones. */
  away(uid: string, name: string, missed: number): Note {
    const t = { uid, name: plain(name), panelist: true };
    return note(t, "Naka-Away po muna kayo", [
      `Naka-Away po muna kayo sa Panelista kasi ${missed} requests ang nag-expire nang walang reply, kaya wala po munang bagong requests.`,
      `Pag ready na po kayo, pa-on lang ulit ang "Accepting requests ngayon" sa profile niyo:`,
    ], `${SITE}/me?tab=profile`);
  },
};

// The HTML part, drawn from the text: the same renderer as webinar.riecodes.com (lib/mailbank.ts mailHtml), with
// Panelista's logo and color. The logo over the message, the site under it.
const BRAND = { name: "Panelista", tagline: "Capstone evaluators", logo: `${SITE}/brand/logo-mark.png`, site: SITE, color: "#176B55" };
// Button labels by link: the line above the link says why, the button says where it goes.
const BUTTONS: [RegExp, string][] = [[/\/inbox\//, "Open request"], [/\/results\b/, "View results"], [/\/projects\b/, "Browse capstones"], [/\/evaluators\b/, "Find evaluators"], [/\/me\b/, "Open profile"]];
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const ALONE = /^https?:\/\/\S+$/;
// What a link shows when nothing names it: host and path, never the query (keys, tokens) or a long tail.
const shortUrl = (url: string) => { const bare = url.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*/, "").replace(/\/$/, ""); return bare.length > 40 ? `${bare.slice(0, 39)}…` : bare; };
const link = (url: string, label: string) => `<a href="${escapeHtml(url)}" style="color:${BRAND.color};font-weight:600">${escapeHtml(label)}</a>`;
const button = (url: string, main: boolean) => `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:8px;padding:${main ? `12px 22px;background:${BRAND.color};color:#ffffff` : `11px 20px;border:1px solid #B9DACE;color:${BRAND.color}`};border-radius:8px;font-weight:600;text-decoration:none">${BUTTONS.find(([pattern]) => pattern.test(url))?.[1] ?? "Open link"}</a>`;

// One line that isn't a bare link. "Label: link" shows the label, not the link: a whole line gets a button under its
// label, a list item or the last sentence links its words. A link inside a sentence shows shortUrl.
function line(text: string) {
  const labelled = text.match(/^(.*\S):\s+(https?:\/\/\S+)$/);
  if (!labelled) return text.split(/(https?:\/\/\S*[^\s.,)])/).map((part, index) => index % 2 ? link(part, shortUrl(part)) : escapeHtml(part)).join("");
  const [, label, url] = labelled;
  const cut = Math.max(label.lastIndexOf(". "), label.lastIndexOf("? "), label.lastIndexOf("! ")) + 2;
  const lead = cut > 1 ? label.slice(0, cut) : label.startsWith("- ") ? "- " : "";
  return lead ? escapeHtml(lead) + link(url, label.slice(lead.length)) : `${escapeHtml(label)}:<br>${button(url, false)}`;
}
// The lines under a line ending in ":" (the capstone's title): the mail's summary, in a card. The first is the thing
// itself, in bold, unless it's a list item or holds a link.
const card = (rows: string[]) => `<div style="margin:8px 0 4px;padding:12px 16px;border-radius:10px;background:#EAF4F0">${rows.map((row, index) => index || /^(- |\d+\. )|https?:/.test(row) ? line(row) : `<strong>${escapeHtml(row)}</strong>`).join("<br>")}</div>`;

// The brand on top, the summary card, and no bare link. The first link on its own line under a line ending in ":"
// becomes the main button (the call to action); other links get a plain button or their label. The "--" block
// (the anti-scam line) goes small and grey.
function mailHtml(text: string) {
  let main = false;
  const blocks = text.split(/\n{2,}/).map((block) => {
    if (block.startsWith("--\n")) return `<span style="font-size:13px;color:#52525B">${line(block.slice(3).replace(/\n/g, " "))}</span>`;
    const lines = block.split("\n");
    const parts: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      const current = lines[index].trim();
      if (ALONE.test(current)) {
        const first = !main && !!lines[index - 1]?.trimEnd().endsWith(":");
        main ||= first;
        parts.push(button(current, first));
        continue;
      }
      parts.push(line(lines[index]));
      let end = index + 1;
      if (current.endsWith(":")) while (end < lines.length && !ALONE.test(lines[end].trim())) end++;
      if (end > index + 1) { parts.push(card(lines.slice(index + 1, end))); index = end - 1; }
    }
    // A card is a block of its own: no line break next to it.
    return parts.reduce((html, part, index) => html + (index && !part.startsWith("<div") && !parts[index - 1].startsWith("<div") ? "<br>" : "") + part, "");
  });
  // The inbox preview: the line after the greeting, not the header's name.
  const gist = (text.split(/\n{2,}/)[1] ?? text).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
  const header = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px"><tr><td style="padding:0 10px 0 0"><img src="${BRAND.logo}" alt="" width="36" height="36" style="display:block;border-radius:8px"></td>`
    + `<td style="line-height:1.3"><div style="font-weight:700">${BRAND.name}</div><div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#71717A">${BRAND.tagline}</div></td></tr></table>`;
  return `<div style="padding:24px 12px;background:#F4F4F5;font:15px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111111">`
    + `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(gist)}</div>`
    + `<div style="max-width:520px;margin:0 auto;padding:24px;border-radius:12px;background:#ffffff">${header}${blocks.map((block, index) => `<div style="margin:0 0 ${index === blocks.length - 1 ? 0 : 16}px">${block}</div>`).join("")}</div>`
    + `<div style="max-width:520px;margin:16px auto 0;text-align:center;font-size:12px;color:#52525B">${BRAND.name} · ${link(BRAND.site, shortUrl(BRAND.site))}</div></div>`;
}

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
          .sendMail({ from: { name: "Panelista", address: user }, to: addr, subject: n.subject, text: n.text, html: mailHtml(n.text) })
          .catch((e) => console.error("mail not sent:", n.subject, e instanceof Error ? e.message : e));
      }
    } finally {
      transport.close();
    }
  });
}
