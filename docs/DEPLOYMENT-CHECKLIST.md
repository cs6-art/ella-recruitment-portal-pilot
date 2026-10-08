# Deployment checklist

Last updated: 29 September 2026. The production deployment runs on Vercel with Neon Postgres
and self-hosted n8n.

## 1. Database

- `DATABASE_URL` set, `RECRUITMENT_BACKEND=postgres` set. (The daily health digest reports
  `legacy_backend` if production starts without it.)
- Apply migrations in order: `npm run db:migrate -- --target=<latest file>`. The latest is
  `0031_email_template_buttons_image.sql`. Emails and the Automated Emails settings need
  `0030` and `0031`.
- Neon backups / point-in-time recovery enabled and a restore tested.

## 2. Environment variables

Every variable is described in `.env.example`. The ones that decide whether things work:

| Area | Variables |
| --- | --- |
| Core | `SESSION_SECRET` (32+ characters), `NEXT_PUBLIC_APP_URL` (public HTTPS URL), `CRON_SECRET`, `INTERNAL_API_SECRET`, `INTERNAL_API_ENTITIES` |
| Email | `PILOT_OUTBOUND_EMAIL_ENABLED=true` (email is fail-closed under Postgres without it), `N8N_VERIFICATION_EMAIL_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `HEALTH_ALERT_EMAIL` |
| Voice | `PILOT_VOICE_DRY_RUN` (keep `true` until the first supervised call), `VAPI_PHONE_NUMBER_ID_SG` / `_PH` / `_MY` (empty keeps the n8n default for that region) |
| Video interview | `LIVEAVATAR_API_KEY`, `LIVEAVATAR_AVATAR_ID`, `LIVEAVATAR_VOICE_AGENT_ID`, `LIVEAVATAR_IS_SANDBOX=false`, `INTERVIEW_RECORDING_DRIVE_FOLDER_ID` (shared with the service account), `INTERVIEW_RECORDING_RETENTION_DAYS` (default 90; 0 keeps recordings), `INTERVIEW_ANALYSIS_OPENAI_API_KEY` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `RESUME_STORAGE_DRIVE_FOLDER_ID` (a Shared Drive ID with the service account as Content manager; the service account uses `drive.file` only and stores resumes in its own "Smile Resume Storage" folder) |
| Payments | `HITPAY_API_KEY`, `HITPAY_SALT`, `HITPAY_WEBHOOK_SECRET`, `HITPAY_MODE`, `HITPAY_BASE_URL` (sandbox until live keys are set) |
| Credits | `CREDITS_BACKEND=dual` (do not change without approval; the live wallet is Postgres) |

## 3. Google Cloud

- OAuth client redirect URIs for Calendar and Drive on the production domain.
- **Publishing status.** In *Testing*, only listed test users can connect and their
  connections expire after 7 days. Publish the app to production so connections last; for
  more than 100 users, complete Google's verification (Calendar scopes are sensitive).
- Privacy policy and terms pages must be live and linked before submitting for
  verification, and reviewed by legal.

## 4. n8n

All email, voice and screening workflows must be active and bound to the right credentials
(`Ella Pilot Internal API`, `Gmail account 4`, Vapi bearer credential).

- Calling: `[TARGET-PG][PILOT] AI Voice Interview Scheduled Calling` (`sJM0djTE8oIjpPvo`).
  Its "Resolve Pilot Vapi configuration" step uses `caller.phoneNumberId` from the portal and
  otherwise its own defaults (PH assistant and number for +63; the Singapore assistant and
  number for everyone else).
- Emails: the three sender workflows listed in [EMAIL-TEMPLATES.md](EMAIL-TEMPLATES.md).
- Make sure the old Google Sheets workflows tagged `recruitment-prod` are not also sending
  for the same events.
- After any credential or scheduler change, publish the workflow and check a real execution.

## 5. Scheduled jobs

`vercel.json` lists the daily crons. The Vercel Hobby plan permits daily schedules only; use
Pro (or an external scheduler that sends `Authorization: Bearer $CRON_SECRET`) before making
queue reconciliation or the voice reconcile more frequent. Confirm `CRON_SECRET` is set and
each cron shows green.

## 6. Before real applicants

- `npm run lint`, `npx tsc --noEmit`, `npm test` pass (CI does this on every push).
- Smoke test with fresh data, end to end: register and confirm an account, create and publish
  a role, apply as a candidate (privacy box), book and take a voice interview, check the
  emails (and an edited email), take a video interview, review the applicant, book a
  face-to-face interview and confirm the calendar event.
- HTTPS and secure cookies, monitoring (`/api/health` uptime check, `HEALTH_ALERT_EMAIL`),
  and a rollback plan.
- The privacy notice is public at `/privacy`. Have counsel review it, and any terms of
  service, before launch.
- Add a Content Security Policy (start report-only). Not yet in place.
- Keep the voice dry-run on until the first supervised call is verified, then set
  `PILOT_VOICE_DRY_RUN=false` for that window only.
