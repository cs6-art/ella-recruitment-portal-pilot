# Legacy Google Sheets recruitment path

Production runs with `RECRUITMENT_BACKEND=postgres`. Everything below still
exists only so local development, demo mode and rollback keep working.

## Already on Postgres (no Sheets read or write when the backend is Postgres)
Roles, applicants, applications, screening, bookings, invitations, status
history, notifications, voice attempts, live interviews, credits (organization
wallet), portal settings, the McLink staff directory, and the Calendar, Drive
and OneDrive OAuth tokens.

## Still reading Sheets
- `User_Directory` as a last-resort fallback when a staff email is not in the
  `users` table (`findDirectoryUser`, `getDirectoryUsers`).
- The credits ledger mirror when `CREDITS_BACKEND` is `sheets` or `dual` (not
  used for the organization wallet).
- The legacy recruitment implementation: `applicant-workflow.ts`,
  `candidate-applications.ts`, the legacy branches in `google-sheets.ts`,
  `bulk-resume-intake.ts`, plus the demo-mode data.

## Why it has not been deleted
About 6,000 lines are interleaved with the Postgres implementation through
roughly 75 `isPostgresRecruitmentTarget()` branches across routes and
libraries, fifteen test files assert on the legacy sources, and demo mode runs
on it. Removing it is a refactor, not a cleanup, and should be its own change
with the safeguards below.

## Safeguards in place
- The daily health check reports `legacy_backend` if production is ever started
  without `RECRUITMENT_BACKEND=postgres`.

## Removal plan
1. Move demo mode onto seeded Postgres data.
2. Delete `applicant-workflow.ts` and `candidate-applications.ts` and point the
   routes at the `target*` functions directly.
3. Delete the legacy branches in `google-sheets.ts`, `bulk-resume-intake.ts`
   and the Sheets token/settings fallbacks; keep only the service-account
   Sheets client if any export still needs it.
4. Run `db:backfill:sheets --commit` one last time before step 3 and drop the
   `User_Directory` fallback once every staff row exists in `users`.
5. Update or remove the tests that read the deleted sources.
