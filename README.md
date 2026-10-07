# McLink Recruitment Portal (Smile)

A multi-organisation recruitment portal. A team requests a role, HR publishes it, candidates
apply, and **Smile** (the AI assistant) screens resumes and interviews candidates by phone or
on video. People review the evidence and make every hiring decision.

Last updated: 29 September 2026

## How it fits together

| Part | What it does |
| --- | --- |
| **Next.js 16 app** (Vercel) | Every page and API route: sign-in, role requests, applicants, bookings, credits, settings, public application and booking pages. |
| **Postgres** (Neon, `drizzle-orm`) | The system of record, with an `organization_id` on every row. `RECRUITMENT_BACKEND=postgres` in production. |
| **n8n** (self-hosted) | Runs the AI resume analysis, places the Vapi voice calls, and sends the emails (its Gmail credential). It talks to the app through the internal API, never to the database. |
| **Vapi** | AI voice interviews. Calls come from a Philippine, Malaysian or Singapore number by the candidate's country code. |
| **LiveAvatar** (HeyGen) | The "Interview with Smile" video interview. |
| **HitPay** | Buying Smile Credits. |
| **Google** | Calendar (interviewer availability and events), Drive (resume import, recording storage). |

The original Google Sheets implementation is still in the code for local development and
demo mode. It is not used in production. See
[docs/LEGACY-SHEETS-REMOVAL.md](docs/LEGACY-SHEETS-REMOVAL.md).

## What people can do

- **Sign in** with email and password. Accounts are created with an organisation email and
  confirmed from a link we email; new accounts start with HR access for their organisation.
- **Request a role.** Paste a job description and Smile fills in the whole form. HR approvers
  create and publish in one step.
- **Set up hiring.** Screening criteria, interview questions, scoring areas, an interviewer
  for face-to-face interviews (from people who connected their own Google Calendar).
- **Screen resumes** by upload (20 per batch), Google Drive, OneDrive, a single form, or a
  personal application link. Candidates confirm a privacy notice when they apply.
- **Review applicants.** *How AI Graded This Applicant* shows the result and every role
  setting Smile applied; all interview questions are shown; history shows automatic changes
  as "Automatic update".
- **Interview.** AI voice interviews and video interviews with Smile, then face-to-face
  interviews booked against the interviewer's calendar.
- **Credits.** One shared balance per organisation. CV analysis 1, phone interview 10 (8
  incomplete, 5 no answer), video interview 20 (reserved when it starts).
- **Edit the automated emails** (subject, message, button text, header image) in Settings.

The end-user guide is [docs/Smile-Recruitment-Portal-User-Manual.md](docs/Smile-Recruitment-Portal-User-Manual.md)
(also as a `.pdf` in the same folder). The in-portal help assistant reads
[src/lib/help-bot/knowledge.md](src/lib/help-bot/knowledge.md); keep the two in step.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values you need
npm run dev
```

Open `http://localhost:3000`. `next dev` rewrites `next-env.d.ts` each run; do not commit
that change. Read the Next.js guides in `node_modules/next/dist/docs/` before changing
framework-level code (see `AGENTS.md`): this Next.js version has breaking changes.

Generate secrets with `openssl rand -base64 48`. `SESSION_SECRET` (at least 32 characters)
signs the session cookie and derives the key that encrypts stored Google tokens. Never use
the `NEXT_PUBLIC_` prefix for a secret.

## Checks

```bash
npm run lint          # eslint src tests
npx tsc --noEmit
npm test              # contract and behaviour tests
npm run test:browser  # Playwright, optional
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, type-check and the tests on Node 24 for
every push. Tests run without a database or `.env.local`.

## Database

Migrations are plain SQL in `drizzle/`, applied forward-only and in order:

```bash
npm run db:migrate -- --target=0031_email_template_buttons_image.sql
```

A target is required whenever migrations are pending, so a later one is never applied by
accident. The runner uses `DATABASE_URL` (from `.env.local` or the environment).
`npm run db:backfill:sheets` copies old Sheets data into Postgres and is safe to re-run.

## Operating it

- **Scheduled jobs** (`vercel.json`, daily on the Vercel Hobby plan, protected by
  `CRON_SECRET`): queue reconciliation, voice-attempt reconciliation, resume cleanup (files
  older than 30 days), live-interview recovery, the health digest, and interview-recording
  retention (90 days, `INTERVIEW_RECORDING_RETENTION_DAYS`, 0 keeps them).
- **Monitoring**: `GET /api/health` for an uptime monitor; the daily digest emails
  `HEALTH_ALERT_EMAIL` about failed or stuck emails, recordings, interviews, calendar events
  and voice calls, and flags production running without the Postgres backend.
- **Deploying**: [docs/DEPLOYMENT-CHECKLIST.md](docs/DEPLOYMENT-CHECKLIST.md).
- **Emails**: [docs/EMAIL-TEMPLATES.md](docs/EMAIL-TEMPLATES.md).
- **n8n contracts and workflows**: [docs/N8N-CONTRACTS.md](docs/N8N-CONTRACTS.md),
  [docs/WORKING-RECRUITMENT-WORKFLOW.md](docs/WORKING-RECRUITMENT-WORKFLOW.md).
- **Access model**: [docs/access-control-matrix.md](docs/access-control-matrix.md).
- **Known issues and open items**: [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md).

## Project layout

- `src/app/` pages and API routes; `src/components/` UI; `src/lib/` server logic, access
  control, prompts, credits, help-assistant knowledge.
- `src/db/` schema and operational scripts; `drizzle/` migrations.
- `integrations/n8n/` importable workflows; `tests/` contract, policy and browser tests;
  `docs/` guides and reports.
