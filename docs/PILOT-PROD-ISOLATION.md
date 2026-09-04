# Pilot / production isolation — current state

Last live audit: 2026-09-02. All n8n mutations in this audit were pilot-only;
no production workflow was edited, unpublished, or disabled.

## Completed

- Pilot Google credential: `ELLA PILOT` (`1q7QoF1bXJs2KeZw`) is the correct
  `mclink-recruitment-portal-p2` service account. Read/write probes passed on
  both pilot workbooks and the pilot Drive folder.
- All audited pilot Google Sheets nodes use `ELLA PILOT` and only the pilot
  workbooks:
  - main: `1tiPTyCWwMQGnXdCpFle70wmfHJNz6YZ2_bWFVqOxko4`
  - candidate/roles: `1kUl6lrwxanKPvGifcE1uF5NuJ9fseJb_L5nKN3YM78g`
- Pilot Drive folder: `0AFViF0P5HxmHUk9PVA`.
- Pilot webhook paths are suffixed with `-pilot`; the local `.env.local` URLs
  now point to those paths, including recruitment setup through the pilot role
  workflow.
- Pilot Gmail nodes use the shared `Gmail account 4` credential and retain
  `[PILOT]` subjects. No live email test was sent.
- The application-invite copy rejects non-synthetic recipients and requires
  `environment=pilot` or `is_uat=true`. A pinned synthetic test completed
  without sending email.
- The Vapi caller is fail-closed. It requires an exact match in the n8n
  environment variable `PILOT_ALLOWED_TEST_PHONES`; when unset, it logs a
  `[PILOT SAFETY]` warning and records a blocked attempt in the pilot queue.
- The F2F invitation requires `Final_Interview_Venue` and includes the full
  venue/address text in the candidate email.
- Pilot Gmail nodes now have explicit `operation=send` where n8n had omitted
  the default discriminator.
- `CREDITS_BACKEND=dual` remains enabled. The read-only parity checker passed:
  7 Sheets credits = 7 Postgres credits, 16 rows and IDs on each side, no
  duplicates or NULL IDs.

## Published pilot workflows

| Workflow | ID | Active version | Purpose |
|---|---|---|---|
| Candidate Application Foundation | `K1JdkJH4NKEcB78E` | `0b44f26a-a588-4961-81ce-8f27f0616030` | pilot application/screening |
| Voice Result Status Sync | `29HvXI7H4eKUJ1Uv` | `b6ad523e-235f-4123-801e-492973786a34` | pilot result reconciliation |
| Scheduled Voice Calling | `cTJHm2ZAJQap7uWW` | `8da35b24-a335-4ae7-bb4e-c694eee37649` | fail-closed pilot Vapi caller |
| Role Request Status | `EYJvn4dVWPDGUh5Q` | `fa2d9945-9340-4ead-99bb-9b2c2db20199` | role/status/setup events |
| Application Invite Email | `CM9VLY9UlViocoLd` | `de79580b-653a-4964-9b57-574dbaa3d32f` | synthetic pilot invite email |
| HR Approval Notifications | `fBL9aYz5PNne0jh6` | `0e76d988-21ad-4762-8891-bd18ea35d629` | pilot HR approval equivalent |
| Voice Booking Invitations | `gGTvRHKaHTX95y0b` | `0e09dca5-1e60-4623-96bd-38ca92547a04` | pilot voice-booking email |
| Bulk Resume Intake | `P3cEDCDf70Os1Ae9` | `f58a191c-23b6-45b4-b129-6f27c59c0b0d` | pilot bulk screening |
| Voice Booking Confirmation | `NN8r5PPUktrPkVIr` | `f6bd96e9-d761-4d0d-9ccb-04df750a4c37` | pilot voice confirmation |
| Final Booking Confirmation | `SQgv92WepQCNmAgx` | `0ed570ff-d250-4a42-b74c-58ed78b90ad7` | pilot F2F confirmation |
| Voice HR Decision / F2F Invite | `rsfQl6nkVWd7Zo3B` | `90d91a61-2f77-4736-8722-534225e06ac2` | pilot decision and F2F invite |
| Screening Complete Notifier | `OnQNFmdMzrZPnLT0` | `d68bb0d7-ee3d-4c28-b3d1-25643548a600` | pilot screening notifications |
| Vapi Result Polling | `M9HyAnRov4TcpFIQ` | `19099d6e-b295-4d70-8a2d-a08e5676547b` | pilot Vapi result polling |

SDK-created copies are in n8n project `wwjZ8XFETyncXLez`. They were published
only after credentials, document IDs, webhook paths, and connections were
checked.

## Quota remediation (Google Sheets 429)

### Root cause

The isolation consolidated **every** pilot Google Sheets call onto the single
`ELLA PILOT` service account in project `mclink-recruitment-portal-p2`. Google's
default Sheets API limit is ~60 read requests / minute / user. Seven pilot
pollers were all firing on the same minute boundary (`:00`, `:05`, …), and
several do a filtered "read one row" call per pending applicant, so an aligned
tick could burst 40–60+ read calls in one ~10-second window → HTTP 429
`Read requests per minute per user`. `29HvXI7H4eKUJ1Uv` errored on every run
2026-09-02 → 2026-09-03 as a result. The 429 is a **rate** problem, not a
credential problem (confirmed: execution 1276861 failed node `Read Voice
Interview Results` with "The service is receiving too many requests from you").

### Applied 2026-09-03 (pilot only, timing changes only — no logic/data change)

Staggered every scheduled pilot poller onto its own cron slot so no two run in
the same minute:

| Workflow | Trigger node | New cron | Fires |
|---|---|---|---|
| `cTJHm2ZAJQap7uWW` Scheduled Voice Calling | Scheduled Voice Call Polling | `0 0/5 * * * *` | every 5 min @ :00 |
| `gGTvRHKaHTX95y0b` Voice Booking Invitations | Voice Invitation Poll Every 5 Minutes | `0 1/5 * * * *` | every 5 min @ :01 |
| `fBL9aYz5PNne0jh6` HR Approval Notifications | HR Approval Polling Schedule | `0 2/5 * * * *` | every 5 min @ :02 |
| `rsfQl6nkVWd7Zo3B` Voice HR Decision / F2F | Voice HR Decision Polling | `0 3/5 * * * *` | every 5 min @ :03 |
| `NN8r5PPUktrPkVIr` Voice Booking Confirmation | Confirmation Schedule | `0 4/5 * * * *` | every 5 min @ :04 |
| `SQgv92WepQCNmAgx` Final Booking Confirmation | Confirmation Schedule | `30 7/10 * * * *` | every 10 min @ :07:30 |
| `29HvXI7H4eKUJ1Uv` Voice Result Status Sync | Voice Result Status Polling | `30 9/10 * * * *` | every 10 min @ :09:30 |

Retry/backoff (`retryOnFail`, 4×5 s, `2×` on `29HvXI7H`) stays on every Google
node as the second line of defence. All 13 pilot workflows now carry the
`recruitment-pilot` tag.

### Still required (cannot be done from n8n)

1. **Raise the Sheets + Drive API quota** for GCP project
   `mclink-recruitment-portal-p2` (IAM & Admin → Quotas → Google Sheets API →
   *Read requests per minute per user* and *…per project*; request an increase,
   e.g. to 300–600/min). This is the durable fix; the stagger only spreads the
   existing budget.
2. **Production side:** the production recruitment pollers run on separate
   credentials/GCP project, but the same anti-pattern (aligned schedules +
   per-row reads) exists there. Apply the same stagger + request a quota
   increase on the production project before pilot + production run heavy
   concurrent load. No production workflow was changed in this audit.
3. **Longer term:** collapse the per-applicant "verify flag" reads into a single
   full-sheet read + in-memory filter per run (cuts steady-state calls to ~1 per
   poller per tick), and/or move the pilot workbooks to Postgres (separate
   planned phase — not part of this task).

### Verification

Pending: the first fully green execution of each staggered poller (especially
`29HvXI7H4eKUJ1Uv` and `rsfQl6nkVWd7Zo3B`) must be observed before declaring the
429 resolved. The pre-change 429 evidence is retained above, not hidden.

## Deferred or externally required

1. Vercel deployment values still need to be set and verified in the pilot
   deployment. The current working copy has the pilot IDs/URLs, but its
   `GOOGLE_SERVICE_ACCOUNT_EMAIL` is still the production service account; the
   matching pilot private key is not available in this workspace. Do not mix a
   pilot email with a production private key. Set both service-account values
   together using the `mclink-recruitment-portal-p2` key.
2. A dedicated pilot Gmail mailbox and Vapi credential were intentionally
   deferred. Until provisioned, shared credentials remain in use behind the
   `[PILOT]`, synthetic-recipient, and exact test-phone guards.
3. The role-description parser (`eo6jK6OzrI5CHvAE`) remains shared because it
   is stateless: it has an OpenAI model, no Google Sheets or Gmail nodes, and
   only returns a draft. A pilot parser copy can be made later if required.
4. Booking API callers were audited in the portal first. Current booking
   routes are portal-owned (`src/app/api/public/bookings/[kind]/[token]`)
   and use the configured pilot Sheets service account; no shared production
   booking workflow was changed. A Vercel live smoke test is still required.

## Required pilot deployment values

Use the same n8n base URL as production, but these paths and data targets:

```text
GOOGLE_SHEETS_SPREADSHEET_ID=1tiPTyCWwMQGnXdCpFle70wmfHJNz6YZ2_bWFVqOxko4
GOOGLE_CANDIDATE_SPREADSHEET_ID=1kUl6lrwxanKPvGifcE1uF5NuJ9fseJb_L5nKN3YM78g
RESUME_STORAGE_DRIVE_FOLDER_ID=0AFViF0P5HxmHUk9PVA
GOOGLE_BULK_RESUME_DRIVE_URL=https://drive.google.com/drive/folders/0AFViF0P5HxmHUk9PVA
N8N_CANDIDATE_APPLICATION_WEBHOOK_URL=.../webhook/candidate-application-pilot
N8N_APPLICATION_INVITE_EMAIL_WEBHOOK_URL=.../webhook/application-invite-email-pilot
N8N_BULK_RESUME_UPLOAD_WEBHOOK_URL=.../webhook/bulk-resume-upload-pilot
N8N_ROLE_WEBHOOK_URL=.../webhook/role-request-pilot
N8N_RECRUITMENT_SETUP_WEBHOOK_URL=.../webhook/role-request-pilot
CREDITS_BACKEND=dual
```

Do not commit `.env.local`, credentials, private keys, or n8n API data.
