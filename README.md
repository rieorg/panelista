# Panelista

Free Philippine web app where capstone students (BSIT, BSIS, BSCS) find IT
professionals and domain experts to evaluate their systems, Facebook
Marketplace style: profiles, star ratings both ways, a Verified badge, and an
in-app chat per evaluation request. Sign in with Google or email + password
(email must be verified before any write).

Live: https://panelista.vercel.app

**Looking for maintainers, contributors and promoters**, especially students who
know (or want to learn) Next.js, Firebase and Cloudflare Workers. Local dev runs
on the Firebase emulators, no keys needed: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Why

Students cold-message strangers on Facebook ("need din namin ng 10 IT expert",
"school requires 3+ / 5+ years of experience", signed acceptance form from
someone outside the school). One volunteer cannot answer all of them, so
Panelista lets many professionals share the load, and lets students see who is
credible and responsive.

## Architecture

```
Browser (Next.js 16 client, Taglish/English)
  |  Google or email/password sign-in (Firebase Auth, auth handler proxied on our origin)
  |  App Check: invisible Cloudflare Turnstile -> /api/appcheck -> 1 h App Check token
  |  realtime reads + chat writes (Firestore SDK, guarded by firestore.rules + App Check)
  v
Vercel, region hkg1  ── Next.js route handlers /api/*  ── firebase-admin ──> Firestore (asia-east1)
  |  all other writes: validated (zod), rate limited, transactional
  v
Cloudflare Worker panelista-worker
  - POST/GET/DELETE /proofs: verification files in private Workers KV (magic-byte sniffing, 5 MB, per-user rate limit, 30-day TTL)
  - hourly cron: close past-deadline projects, purge old rate-limit counters,
    then POST /api/cron (Bearer CRON_SECRET) so the app expires requests and emails people
```

Evaluation workspace (`src/lib/iso25010.ts`): an accepted evaluator can fill the
built-in ISO 25010 form (8 characteristics, 31 items, 1 to 5) from the chat.
The student's `/p/{id}/results` page tabulates every submission into weighted means
per item, per characteristic and overall, with verbal interpretation and a Copy table
button for Chapter 4. The printed certificate links to a public `/c/{requestId}` check
that shows only completed requests, the names, the date and the overall mean.

Email notifications (`src/lib/mail.ts`, Gmail SMTP with an app password in
`SMTP_USER` and `SMTP_PASSWORD`; nothing is sent without them):

- new request or offer: to the side that must answer
- accept, decline, cancel, done: to the other side (done asks the student to rate)
- day 2 of 3 unanswered: a reminder to the side that must answer (`/api/cron`)
- day 3: the request expires with a chat notice and a mail to the asker. An
  evaluator who lets 2 invites in a row expire is set to Away (accepting off) and told how to come back.

Why this split: Firebase stays on the free Spark plan (no Cloud Functions, no
Firebase Storage, no TTL), Workers KV needs no card (R2 does), and Vercel serves
the app. The Worker uses its own service account with only `roles/datastore.user`.

### Data (Firestore)

| Collection | Who reads | Who writes |
|---|---|---|
| `profiles/{uid}` | public | API (`PUT /api/profile`); ratings/verified/counters server-only |
| `projects/{id}` | public | API (`/api/projects`) |
| `requests/{projectId_evaluatorUid}` | the two participants, admin | API (state machine); participants may only bump the inbox preview |
| `requests/*/messages/*` | participants, admin | participants once accepted (rules check sender, size, status, verified email) |
| `reviews/{requestId_side}` | public | API, once per side after completion |
| `evaluations/{requestId}` | that request's evaluator and student, admin | API (evaluator only, while accepted or completed) |
| `verifications/{uid}` | owner, admin | API |
| `reports/*` | admin | API |
| `ratelimits/*` | nobody | API |

Request lifecycle (`src/lib/domain.ts`, tested in `tests/logic.test.ts`):
`pending -> accepted | declined | cancelled | expired`, `accepted -> completed | cancelled`.
The side that did not start the request answers it; either side marks an accepted
evaluation done, and the student must then rate the evaluator before asking for
more help. Pending requests expire after 3 days. Ranking is a Bayesian average
(prior 4.0 weighted as 3 reviews) plus a small Verified bonus, minus up to 0.5
for invites the evaluator let expire (smoothed answer rate, so new evaluators
start at full marks). A student can have at most `maxActive` unanswered invites
waiting on one evaluator.

### Security

- Strict nonce CSP via `src/proxy.ts`, HSTS preload, `X-Frame-Options: DENY`,
  nosniff, Referrer-Policy, Permissions-Policy, COOP for the auth popup.
- App Check (custom provider backed by Cloudflare Turnstile) enforced on Firestore,
  the API and the Worker: scripts without a real browser session on our site get 401/403.
- Firestore rules deny every client write except chat messages; public lists must be paged (limit 50 or less).
- API: Firebase ID token check with revocation, same-origin check, zod
  validation, body size cap, per-user daily rate limits, deterministic doc ids
  (no duplicate requests or reviews), transactions for counters.
- Auth: Google and email/password (verified email required at the API, rules
  and Worker; enumeration protection on; password policy 8+ chars with a
  number), Anonymous off, authorized domains limited, browser API key
  restricted to our referrers and four APIs.
- Verified badge drops automatically when name, headline, LinkedIn or years change.
- Uploads: type from magic bytes (no SVG/HTML), private KV, admin-only read,
  deleted after review, 30-day TTL.
- Facebook/Messenger in-app browser detection on login (Google blocks OAuth there).

## Run locally

```bash
npm install
cp .env.example .env.local
npm run emulators    # terminal 1: Firebase Auth + Firestore emulators (needs Java 21+)
npm run dev          # terminal 2: http://localhost:3000
npm test             # domain + upload-sniffing checks (node:test, Node 22.18+)
```

Details, checks and the admin setup are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Deploy (maintainers)

Production env vars (Vercel): `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
`NEXT_PUBLIC_FIREBASE_APP_ID`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `FIREBASE_AUTH_HOST`,
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WORKER_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`TURNSTILE_SECRET` and `FIREBASE_SERVICE_ACCOUNT_B64` (base64 of the admin
service-account JSON). Never set the `*_EMULATOR_HOST` vars there.

```bash
vercel deploy --prod                                  # app
firebase deploy --only firestore --project panelista-riecodes  # rules + indexes
cd worker && npx wrangler deploy                      # worker + cron
```

Admin: after signing in once, run
`GOOGLE_APPLICATION_CREDENTIALS=admin-sa.json node scripts/set-admin.mjs you@gmail.com`.
Production E2E (creates and deletes throwaway users):
`GOOGLE_APPLICATION_CREDENTIALS=admin-sa.json node scripts/e2e.mjs <api-key> <app-id>`.

Plan, evidence and capacity estimates: `docs/PLAN.md`.

## Brand

Logo and illustrations in `brand/` were generated by Codex (headless) from
`brand/BRIEF.md`; palette in `brand/brand.json`, preview in `brand/preview.html`.

## Known limits (deliberate)

- Text search filters loaded pages client-side; add Typesense/Algolia past a few thousand evaluators.
- Chat messages send no email (they are written straight to Firestore, with no server hook);
  the inbox shows unread state per device. Request events do email.
- Mail is fire-and-forget through Gmail (about 500 recipients a day); a failed send is only logged.
- Firebase project id is `panelista-riecodes` (`panelista` was taken globally). It moved off
  the repurposed `med-price-tracker` project on 2026-10-16.
- Reviews from accounts younger than 3 days, or repeat reviews of the same person, are
  shown but do not move ratings (anti review-farming). Patient sock puppets can still
  farm slowly; Verified badges and reports are the counterweight.
