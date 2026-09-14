# Deployment checklist

- Configure every variable in `.env.example` in the production environment.
- Grant the Google service account editor access to the spreadsheet and verify
  all tab headers using `GOOGLE-SHEETS-SCHEMA.md`.
- Activate the production n8n webhook and validate `X-Webhook-Secret`.
- Set `NEXT_PUBLIC_APP_URL` to the public HTTPS portal URL.
- Resume storage is Google Drive, not local disk (Vercel's filesystem is
  read-only outside `/tmp`, which isn't durable or shared across instances
  anyway). Create a folder for private resume uploads, share it with the
  service account in `GOOGLE_SERVICE_ACCOUNT_EMAIL` (Editor access — a
  Shared Drive is strongly preferred over a personal My Drive folder, since
  service accounts have no storage quota of their own and uploads fail
  outright without one), then set `RESUME_STORAGE_DRIVE_FOLDER_ID` to that
  folder's ID.
- Add malware scanning at the hosting edge or storage layer and verify the 30-day resume retention policy.
- Confirm active User_Directory rows and permissions for a creator, reviewer,
  approver, and settings editor.
- Ella Credits: the `Ella_Credit_Ledger` tab is created automatically on first
  use. After deploy, a settings admin opens Settings -> Ella Credits and adds a
  starting balance; AI CV analysis and AI phone interviews are blocked at a
  zero balance.
- Pilot recruitment screening does not require `OPENAI_API_KEY`: inference is
  owned by the approved n8n screening credential. Configure this variable only
  if the optional in-portal HelpBot is intentionally enabled; when absent,
  HelpBot must remain hidden and unavailable.
- Run `npm.cmd test`, `npx.cmd tsc --noEmit`, and `npm.cmd run build`.
- Perform the manual smoke test in `TESTING.md` against production n8n and a
  test spreadsheet row.
- Verify HTTPS, secure cookie behavior, backups, monitoring, and rollback.
- Set `CRON_SECRET` and confirm the daily queue-reconciliation and resume-cleanup
  cron executions are green. Vercel Hobby permits daily cron schedules only;
  use Pro before changing queue reconciliation to a sub-daily schedule.
- Complete the live release checklist with fresh test data before admitting real
  applicants; automated tests cannot verify the real n8n, email, calendar, or
  phone path.
- For a controlled soft launch, keep `RECRUITMENT_BACKEND=postgres` and
  `CREDITS_BACKEND=dual`; keep voice dry-run enabled until the first supervised
  n8n/Vapi call is verified. Set `PILOT_VOICE_DRY_RUN=false` only for that
  explicit live-call window.
- Before opening to client users, close the external gates: resolve the known
  n8n Google Sheets 429/quota issue, confirm `CRON_SECRET` in Vercel, enable
  shared edge rate limiting, confirm Neon backups/PITR and a tested restore,
  and verify monitoring/error alerts.
