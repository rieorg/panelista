# Contributing to Panelista

Salamat sa interes! Panelista is a free app that helps Filipino capstone students
find IT professionals and domain experts to evaluate their systems. It is built
by volunteers, and students are very welcome: this is real production code with
real users, which is good for your portfolio.

## Ways to help

- **Contributors** (code): Next.js, Firebase and Cloudflare Workers. Pick an
  issue, send a pull request.
- **Maintainers**: contributors who have had a few pull requests merged and want
  to review others' work, triage issues and help plan. Ask in an issue or by
  email; maintainers join the GitHub organization with write access.
- **Promoters** (no code): share Panelista in your school org, capstone groups
  and IT communities, invite IT pros to sign up as evaluators, report bugs, and
  review the Taglish copy. Open an issue with what you found or tried.

## Run it locally (no keys needed)

Local dev uses the Firebase emulators, so you do not need access to the real
Firebase project, Cloudflare or any secret.

Requirements: Node.js 22.18 or newer (24 LTS recommended) and Java 21 or newer
(the Firestore emulator runs on Java).

```bash
npm install
cp .env.example .env.local
npm run emulators      # terminal 1: Auth on 9099, Firestore on 8080
npm run dev            # terminal 2: http://localhost:3000
```

- **Sign up** in the app with any email and password. The emulator does not send
  email: the verification link is printed in the emulators terminal. Or use
  "Sign in with Google", which opens the emulator's fake account picker.
- **Admin page**: after signing in once, run
  `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-panelista node scripts/set-admin.mjs you@example.com`,
  then sign out and in again.
- Emulator data is wiped when you stop the emulators.
- In emulator mode there is no App Check or Turnstile, and verification
  uploads do not work (they need the Cloudflare Worker in `worker/`).

## Before you open a pull request

```bash
npm run lint
npm run typegen && npx tsc --noEmit
npm test
```

GitHub Actions runs the same checks on every pull request.

- One change per pull request, kept small. Link the issue it closes.
- Comment on an issue before starting so two people do not build the same thing.
- UI copy is everyday Taglish (English UI words plus common Tagalog, never deep
  Tagalog), with an English version. Add both in `src/lib/i18n.ts`.
- Request rules live in `src/lib/domain.ts` and are tested in
  `tests/logic.test.ts`. Change the test with the rule.
- These files guard user data and need a maintainer's careful review:
  `firestore.rules`, `src/lib/server.ts`, `next.config.ts`,
  `src/app/api/**` and `worker/`. Explain why in the pull request.
- AI coding tools are fine, but you must understand and test what you submit.
- Never commit `.env.local`, service account keys or any other secret.

## Project map

| Path | What it is |
|---|---|
| `src/app/` | Pages (Next.js App Router) and API routes (`src/app/api/`) |
| `src/components/` | Shared UI |
| `src/lib/firebase.ts` | Browser Firebase setup, App Check, API helper |
| `src/lib/server.ts` | Server auth checks, rate limits, route wrapper |
| `src/lib/domain.ts` | Request state machine and rating rules |
| `src/lib/i18n.ts` | Taglish and English copy |
| `firestore.rules` | Who can read and write what in Firestore |
| `worker/` | Cloudflare Worker: verification uploads and the hourly cleanup cron |
| `docs/PLAN.md` | Why Panelista exists, architecture and roadmap |

## Code of conduct

Be kind and patient; many contributors are students doing this for the first
time. No harassment, insults or discrimination. Taglish and English are both
welcome. Report problems to the maintainers at eirmonpaculan11@gmail.com.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
