// Notification mails go out from the owner's own address and carry user-written names and titles,
// so who gets which mail and what user text can do inside it are both security questions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mailHtml, mails, type MailReq } from "../src/lib/mail.ts";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://panelista.vercel.app";
const invite: MailReq = { id: "p1_E", projectTitle: "Barangay Health Records", studentUid: "S", studentName: "Juan Dela Cruz", evaluatorUid: "E", evaluatorName: "Ana Reyes", initiatedBy: "student" };
const offer: MailReq = { ...invite, initiatedBy: "evaluator" };

test("a new request mails the side that must answer, greeted by first name", () => {
  const toEvaluator = mails.created(invite);
  assert.equal(toEvaluator.uid, "E");
  assert.match(toEvaluator.text, /^Hi Ana!\n/);
  assert.match(toEvaluator.text, /from Juan Dela Cruz/);
  assert.equal(toEvaluator.subject, "Capstone evaluation request: Barangay Health Records · Panelista");
  const toStudent = mails.created(offer);
  assert.equal(toStudent.uid, "S");
  assert.match(toStudent.text, /^Hi Juan!\n/);
  assert.match(toStudent.text, /Ana Reyes wants to evaluate your capstone/);
});

test("accept, decline, cancel and done go to the other participant, never the actor", () => {
  for (const action of ["accept", "decline", "cancel", "complete"] as const) {
    assert.equal(mails.action(invite, "E", action).uid, "S", `${action} by the evaluator`);
    assert.equal(mails.action(invite, "S", action).uid, "E", `${action} by the student`);
  }
  assert.match(mails.action(invite, "E", "complete").text, /Required 'to bago ka mag-post or mag-request ulit/, "done tells the student the rating is required");
});

test("expiry mails the asker; the results mail goes to the student; Away goes to the evaluator", () => {
  assert.equal(mails.expired(invite).uid, "S");
  assert.equal(mails.expired(offer).uid, "E");
  const results = mails.evaluated(invite, "p1");
  assert.equal(results.uid, "S");
  assert.ok(results.text.includes(`${SITE}/p/p1/results`));
  const away = mails.away("E", "Ana Reyes", 2);
  assert.equal(away.uid, "E");
  assert.ok(away.text.includes(`${SITE}/me?tab=profile`));
});

test("every mail links only to Panelista and ends with the never-send-money line", () => {
  const all = [mails.created(invite), mails.created(offer), mails.expired(invite), mails.expired(offer), mails.evaluated(invite, "p1"), mails.away("E", "Ana", 2), ...(["accept", "decline", "cancel", "complete"] as const).flatMap((a) => [mails.action(invite, "E", a), mails.action(invite, "S", a)])];
  for (const m of all) {
    const links = m.text.match(/https?:\/\/\S+/g) ?? [];
    assert.equal(links.length, 1, m.subject);
    assert.ok(links[0].startsWith(`${SITE}/`), links[0]);
    assert.ok(m.text.endsWith("Libre ang Panelista. Wag magpadala ng pera o password kahit kanino."), m.subject);
    assert.equal((m.subject + m.text).includes(String.fromCharCode(0x2014)), false, "no em dash");
  }
});

test("user text cannot add links, lines or headers to a mail", () => {
  const evil: MailReq = {
    ...invite,
    projectTitle: "Verify now\r\nBcc: victim@example.com\nhttps://evil.example/login bit.ly/x",
    studentName: "Admin\nPanelista Support http://evil.example",
  };
  const m = mails.created(evil);
  assert.equal(/[\r\n]/.test(m.subject), false, "the subject stays one line");
  assert.equal(m.text.includes("evil.example"), false);
  assert.equal(m.text.includes("bit.ly"), false);
  assert.equal((m.text.match(/\[link\]/g) ?? []).length, 3);
  // The title sits on its own quoted line: its line breaks became spaces, so it cannot start a fake paragraph.
  assert.ok(m.text.split("\n").includes('"Verify now Bcc: victim@example.com [link] [link]"'));
  const links = m.text.match(/https?:\/\/\S+/g) ?? [];
  assert.deepEqual(links, [`${SITE}/inbox/p1_E`]);
});

// Audit finding: plain() strips "http://x" and "x.com/path" but not a bare "x.com", which Gmail turns into a link.
test("a bare domain in a name or title is not left for the mail client to auto-link", { todo: "not neutralized yet, see the audit report" }, () => {
  const m = mails.created({ ...invite, projectTitle: "Claim your prize at evil-site.com today" });
  assert.equal(/evil-site\.com/.test(m.subject + m.text), false);
});

test("the HTML part escapes user text and only ever links what the text links", () => {
  const html = mailHtml(mails.created({ ...invite, projectTitle: '<img src=x onerror=alert(1)> & "quotes"', studentName: "<script>alert(1)</script>" }).text);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img src=x"), false);
  assert.ok(html.includes("&#60;img src=x onerror=alert(1)&#62; &#38; &#34;quotes&#34;"));
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(hrefs)].sort(), [SITE, `${SITE}/inbox/p1_E`].sort());
  // A link line cannot break out of its href attribute.
  const broken = mailHtml('Open this:\nhttps://x.example/"onmouseover="alert(1)');
  assert.equal(broken.includes('"onmouseover="'), false);
  assert.ok(broken.includes("&#34;onmouseover=&#34;"));
});
