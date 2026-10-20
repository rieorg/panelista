# Panelista: brainstorm, evidence and plan

Written 2026-10-14. Names, schools and project titles of the students who
messaged are left out on purpose.

## 1. The problem, from the source

**The founder's Messenger requests (Requests > Spam folder, read 2026-10-14): 11
message requests** from strangers, all variations of "please evaluate our capstone"
("pwede rin po kaya kaming magpaevaluate sainyo"):

| What they asked | Detail seen in the message |
|---|---|
| Be a technical evaluator / IT expert evaluator for the system | "need din po namin ng technical evaluator", "We need IT Expert like you po na mag Evaluate ng system" |
| Many evaluators per group | "need lang din namin nang 10 I.T expert" |
| A school-imposed experience bar | "ask po if you already have at least 3 yrs of experience in the IT field since ayun po ang required ng aming campus" |
| Answer a survey as an IT pro | a group asking for an IT professional's survey answers for their system |
| A "qualified Software Engineer" | an IoT hardware kit |
| Example systems | library security, health records, BSIS business systems |

**Facebook groups (searched 2026-10-14):**

- *App Builders PH*: BSIT students need an **external evaluator** because
  "the acceptance form must be signed by someone outside the university to avoid
  bias", with a specific skill (Android TalkBack / accessibility).
- *BSIT Worldwide*: repeated "LOOKING FOR IT EXPERTS" posts ("at least 5 years of
  experience"), stack-specific asks (Python, FastAPI), and "IT, IS or CS graduates
  ... respondents for our capstone survey".
- Neither group showed an existing app or site that matches students with evaluators.

**Web research (subagent, 2026-10-14):** no Philippine equivalent found. The
nearest tools solve a different problem: Prolific (paid, unvetted respondents),
SurveyCircle and SurveySwap (survey swapping), ADPList and MentorCruise (mentoring),
Respondent.io (paid B2B interviews), ThesisForge (AI review). Students today rely on
one-off referrals and cold DMs, which is exactly the flood in that inbox.

**Conclusion:** demand is real, repetitive and unmet. One volunteer cannot absorb
it, but a shared pool of professionals with visible track records can.

## 2. Brainstorm

Ideas considered (kept: **bold**):

- **Two-sided marketplace: students post capstones, evaluators list profiles; either side can start.**
- **Marketplace-style trust: stars both ways, review tags, "usually replies within", completed count.**
- **Verified badge from proof (company ID, COE, PRC, cert), reviewed by admin, files deleted after review.**
- **Not only IT: QA, PMs, nurses (health systems), accountants (POS), teachers, as "titles".**
- **School requirements as fields: evaluators needed (often 5 to 10), minimum years, deadline, form link.**
- **In-app chat per request so nobody has to expose a personal FB account.**
- **Taglish-first copy with English toggle; FB/Messenger in-app browser warning on Google login.**
- Paid evaluations / platform fee: dropped (free only; avoids payments, KYC, disputes).
- Certificate generator for the signed acceptance form: later (schools use their own forms).
- Email or push notifications: later (inbox unread state ships first). Email shipped 2026-10-20.
- Leaderboards / gamified badges: later, only if engagement needs it.

## 3. Decisions made

| Question | Pick |
|---|---|
| Name | Panelista (panelista.vercel.app was free) |
| Fees | Free only |
| Evaluator trust | Open signup + admin-verified badge |
| Contact | In-app chat per request |
| Firebase home | Own project `panelista-riecodes` (first lived in repurposed med-price-tracker; moved 2026-10-16 once quota was raised) |
| Login | Email + password, then "or", then Google |

## 4. Architecture

```
Browser (Next.js 16, Taglish/English)
  - Google or email/password login (Firebase Auth, handler proxied on our origin)
  - App Check: invisible Cloudflare Turnstile -> /api/appcheck -> 1 h App Check token
  - realtime reads + chat writes straight to Firestore (rules + App Check enforced)
        |
Vercel (hkg1): Next.js pages + /api/* route handlers (firebase-admin)
  - every write: ID token (revocation checked) + verified email + App Check +
    same-origin + zod validation + per-user daily rate limit + transaction
        |
Firestore (asia-east1)            Cloudflare Worker panelista-worker
  profiles, projects, requests,     - /proofs upload/read/delete in Workers KV
  messages, reviews,                  (magic-byte sniffing, 5 MB, 30-day TTL,
  verifications, reports,              admin-only read, App Check + verified email)
  ratelimits                        - hourly cron: close past-deadline projects,
                                      purge rate-limit counters (own SA,
                                      roles/datastore.user only), then call
                                      the app's /api/cron to expire 3-day-old
                                      pending requests and send reminders
```

Request state machine (`src/lib/domain.ts`, unit tested): `pending` to
`accepted | declined | cancelled | expired`; `accepted` to `completed | cancelled`.
The side that did not start answers; either side marks an accepted evaluation
done, and the student must then rate the evaluator before posting or requesting
again; chat opens after acceptance.

## 5. Security posture

- Strict nonce CSP, HSTS preload, frame denial (except the auth iframe), nosniff,
  Referrer-Policy, Permissions-Policy.
- Firestore: clients can only read, plus post chat messages in accepted threads;
  public lists must be paged (limit 50 or less); App Check enforced.
- Auth: verified email required everywhere; enumeration protection; password
  policy (8+ chars with a number); browser API key restricted to our referrers
  and four APIs; authorized domains trimmed.
- Abuse: per-user daily limits on profile, project, request, action, report and
  verification writes; Worker upload limit (10 per minute) and file cap; reviews
  from accounts younger than 3 days, or repeat reviews of the same person, are
  shown but do not move the rating (anti review-farming); Verified badge drops
  on identity edits; admin ban disables login and hides listings.
- Independent security review: no Critical or High findings; Medium/Low fixed.
- Production E2E (`scripts/e2e.mjs`) proves the above against the live stack.

## 6. Scale and cost (estimates, check current pricing pages before relying on them)

Per active session the app reads roughly: browse page 24 docs, a profile 1 + up
to 30 reviews, inbox up to 50, header listeners 2. Call it ~100 to 150 reads.

| Layer | Free tier (approx.) | What it means |
|---|---|---|
| Firestore Spark | 50k reads, 20k writes per day | about 300 to 500 active users a day |
| Firestore Blaze | pay per use, cents per 100k reads | 10k active users a day is roughly a dollar a day in reads |
| Vercel Hobby | generous function quota | pages are thin shells; API is hit only on writes |
| Workers + KV free | 100k requests/day, 1k KV writes/day | uploads are rare (verification only) |

No hot-document limits are near: counters change on accept/complete/review only.
Upgrade path when needed: Blaze plan, Typesense/Algolia for text search, Upstash
or Workers KV for rate limits, email notifications via a Worker queue.

## 7. Roadmap

1. Seed: invite the students from the Messenger requests and post in App Builders PH,
   BSIT Worldwide and IT recruitment groups ("Be a Panelista" link).
2. Open source: public repo, emulator-based local dev, recruit student maintainers,
   contributors and promoters. Optional custom domain.
3. Done 2026-10-20: email notifications for request events (not chat messages),
   3-day expiry with a reminder, Away after 2 ignored invites, rank by answer rate.
   Why first: on 2026-10-20, 123 of 158 requests were pending and 23 of 30
   evaluators had never answered one.
4. Done 2026-10-19 (PR #8): printable "certificate of evaluation" page per completed request.
5. Done 2026-10-16: moved to the dedicated Firebase project `panelista-riecodes`.
6. Next: evaluation workspace (built-in ISO 25010 form, tabulated weighted means,
   a certificate schools can verify).
