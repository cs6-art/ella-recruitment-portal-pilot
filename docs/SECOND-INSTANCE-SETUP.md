# Standing up a separate instance (new repo → new Vercel project → new URL)

This app has **no database**. It runs entirely on:

- **Google Sheets** — all portal data (roles, applicants, users, settings, the Ella Credit ledger)
- **Google Drive** — private resume file storage
- **Google OAuth** — login + HR calendar connection
- **n8n webhooks** — role workflow, AI CV screening, applicant emails, voice interview calling

For this instance we keep **one** shared Google Cloud identity (service account + OAuth client) and
give it a **brand-new spreadsheet, Drive folder, and its own n8n workflows**, so data is fully
isolated but you skip re-doing the Google Cloud consent screen.

---

## 1. Repo

```bash
# from a clean copy of this project
git remote remove origin
git remote add origin git@github.com:<org>/<new-repo>.git
git push -u origin main
```

Nothing in the code is environment-specific — every difference is an env var.

## 2. Google Sheets — new workbook

1. Create a new Google Sheet (a **Shared Drive** is strongly preferred over My Drive).
2. Create the tabs and **exact headers** from [`GOOGLE-SHEETS-SCHEMA.md`](GOOGLE-SHEETS-SCHEMA.md):
   `Role_Requests`, `Role_Status_History`, `Candidate_Status_History`, `High_Match_Profile`,
   `Interview_Slots`, `User_Directory`, `Settings`, `Recruitment_Templates`, `Bulk_Resume_Queue`,
   `Voice_Call_Queue`, `Voice_Interview_Results`.
   Fastest: **make a copy of the current production workbook, then delete every data row** (keep
   row 1). Clear `Settings` back to defaults if it carries prod values.
   - `Ella_Credit_Ledger` does **not** need creating — the portal adds it on first use.
3. **Share the workbook with the existing service account email** (`GOOGLE_SERVICE_ACCOUNT_EMAIL`)
   as **Editor**.
4. Seed `User_Directory` with at least one active row that is a reviewer **and** settings editor
   (so you can log in, see roles, and open Settings → Ella Credits). Columns:
   `Email, Full_Name, Access_Role, Department, Can_Create_Role, Can_Review_Role, Can_Approve_Role,
   Can_Edit_Settings, Can_Manage_Users, Active` → set the boolean columns to `TRUE`.
5. Copy the spreadsheet ID from its URL (`/d/<ID>/edit`).
6. Verify access before deploying:
   ```bash
   GOOGLE_SHEETS_SPREADSHEET_ID=<new-id> \
   GOOGLE_SERVICE_ACCOUNT_EMAIL=<sa-email> \
   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="<key>" \
   node tools/scripts/test-user-directory.mjs
   ```

## 3. Google Drive — new resume folder

1. Create a folder (Shared Drive preferred — a service account has no storage quota of its own).
2. Share it with `GOOGLE_SERVICE_ACCOUNT_EMAIL` as **Editor**.
3. Keep its folder ID for `RESUME_STORAGE_DRIVE_FOLDER_ID`. If you also use the Drive-poller bulk
   flow, make a second folder for `GOOGLE_BULK_RESUME_DRIVE_FOLDER_ID` (configured in n8n).

## 4. Google OAuth — reuse the existing Web client

In Google Cloud Console → **APIs & Services → Credentials → the existing OAuth 2.0 Web client**:

- **Authorized JavaScript origins**: add `https://<new-url>`
- **Authorized redirect URIs**: add `https://<new-url>/api/auth/google-calendar/callback`
  **and** `https://<new-url>/api/auth/google-drive/callback`

For the HR "Connect Google Drive" resume-import feature also: on the **OAuth
consent screen** add the scope `https://www.googleapis.com/auth/drive.readonly`,
and confirm the **Google Drive API** is enabled under APIs & Services. For an
Internal Workspace app no verification review is required.

Same `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` values as
production. `ALLOWED_GOOGLE_DOMAIN` stays `mclinkgroup.com`.

> You need the final URL here. Either decide the custom domain now, or first deploy to get the
> `*.vercel.app` URL (step 7), add it here, then redeploy.

## 5. n8n — duplicate the workflows for the new spreadsheet

Each workflow below must be duplicated in n8n with (a) its **Google Sheets credential/spreadsheet
ID pointed at the new workbook** and (b) its **Header Auth secret set to this instance's new
`N8N_WEBHOOK_SECRET`**. Give each a fresh webhook path so it can't collide with production.

| Workflow (repo reference) | Portal env var(s) pointing at it |
|---|---|
| `role-request-foundation.json` (role created / status / recruitment setup / bulk batch complete) | `N8N_ROLE_WEBHOOK_URL`, `N8N_ROLE_REQUEST_WEBHOOK_URL`, `N8N_RECRUITMENT_SETUP_WEBHOOK_URL` |
| `ai-role-description-parser.ts` | `N8N_ROLE_DESCRIPTION_PARSER_WEBHOOK_URL` |
| `candidate-application-foundation.json` (AI CV screening) | `N8N_CANDIDATE_APPLICATION_WEBHOOK_URL` |
| `application-invite-email.json` | `N8N_APPLICATION_INVITE_EMAIL_WEBHOOK_URL` |
| `bulk-resume-upload-intake.ts` | `N8N_BULK_RESUME_UPLOAD_WEBHOOK_URL` |
| `bulk-resume-screening.ts` / `jd-role-folder-bulk-resume-screening.ts` (Drive poller, optional) | n8n env: `GOOGLE_BULK_RESUME_DRIVE_FOLDER_ID`, `N8N_BULK_RESUME_PORTAL_BASE_URL` |
| Vapi voice-interview calling + results (external, not in repo — reads `Voice_Call_Queue`, writes `Voice_Interview_Results`) | — |

Contract details: [`N8N-CONTRACTS.md`](N8N-CONTRACTS.md). Set `N8N_BULK_RESUME_PORTAL_BASE_URL` /
`RESUME_SCREENING_INVITE_BASE_URL` to the new public URL so n8n can call back for text extraction.

## 6. Secrets

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 48   # N8N_WEBHOOK_SECRET  (must match the value set in every n8n workflow above)
```

## 7. Vercel project

1. **Add New → Project → import the new repo.** Framework preset: Next.js.
2. **Build & Development Settings → Build Command:** override to `npm run build`
   (the repo script pins `next build --webpack`).
3. Node.js version: 22.x.
4. Add the environment variables below (Production, and Preview if you want PR previews)
   **before the first deploy** — the Next build reads Google Sheets config while collecting page
   data, so a build with those vars missing fails. `NEXT_PUBLIC_APP_URL` / `GOOGLE_OAUTH_REDIRECT_URI`
   can start as a placeholder and be corrected in step 6.
5. Deploy. Note the assigned URL, or attach a custom domain now.
6. Go back to **step 4** and add that URL to the OAuth client; set `NEXT_PUBLIC_APP_URL` /
   `GOOGLE_OAUTH_REDIRECT_URI` to it; **redeploy**.

### Environment variables

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://<new-url>` |
| `NEXT_PUBLIC_APP_NAME` | display name (e.g. `Ella Recruitment Portal`) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | same as production |
| `GOOGLE_CLIENT_ID` | same as production |
| `GOOGLE_OAUTH_CLIENT_SECRET` | same as production |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://<new-url>/api/auth/google-calendar/callback` |
| `ALLOWED_GOOGLE_DOMAIN` | `mclinkgroup.com` |
| `SESSION_SECRET` | new random (step 6) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | **new workbook ID** |
| `GOOGLE_CANDIDATE_SPREADSHEET_ID` | leave unset unless you split candidate data into a 2nd workbook |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | same as production |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | same as production (quoted, `\n`-escaped) |
| `RESUME_STORAGE_DRIVE_FOLDER_ID` | **new Drive folder ID** |
| `N8N_WEBHOOK_SECRET` | new random (step 6), matching n8n |
| `N8N_ROLE_WEBHOOK_URL` / `N8N_ROLE_REQUEST_WEBHOOK_URL` | new role workflow URL |
| `N8N_RECRUITMENT_SETUP_WEBHOOK_URL` | new (or same as role URL) |
| `N8N_ROLE_DESCRIPTION_PARSER_WEBHOOK_URL` | new parser workflow URL |
| `N8N_CANDIDATE_APPLICATION_WEBHOOK_URL` | new screening workflow URL |
| `N8N_APPLICATION_INVITE_EMAIL_WEBHOOK_URL` | new invite-email workflow URL |
| `N8N_BULK_RESUME_UPLOAD_WEBHOOK_URL` | new bulk-intake workflow URL |
| `N8N_BULK_RESUME_PORTAL_BASE_URL` | `https://<new-url>` |
| `RESUME_SCREENING_INVITE_BASE_URL` | `https://<new-url>/index.html` (or the careers-site origin) |
| `GOOGLE_BULK_RESUME_DRIVE_URL` | link to the bulk Drive folder (UI convenience) |
| `BOOKING_LINK_EXPIRY_DAYS` | `7` |
| `BULK_RESUME_UPLOAD_CONCURRENCY` | `5` |
| `BULK_RESUME_NOTIFY_ON_SUCCESS` | `false` |
| `DEMO_MODE` | `false` |
| `DEMO_CUTOFF` | any past ISO date, e.g. `2026-01-01T00:00:00+08:00` |
| `BULK_RESUME_UAT_MODE` | `false` |
| `BULK_RESUME_PRODUCTION_UAT_BATCH_ID`, `BULK_RESUME_UAT_*`, `N8N_BULK_RESUME_*_UAT_*` | leave blank |

## 8. Post-deploy smoke test

1. Open `https://<new-url>` → sign in with a Workspace account that has an active `User_Directory` row.
2. **Settings → Ella Credits** → add e.g. `2000` with a note → balance shows, a `TopUp` row lands in
   `Ella_Credit_Ledger`.
3. Dashboard + Role Requests load without errors.
4. Create a role request → confirm a row appears in `Role_Requests` (proves the role n8n workflow +
   secret are wired).
5. Publish a role, generate an application link, submit a test application → applicant appears,
   balance drops by 1, a `cv_analysis` deduction row is written.
6. Set the balance low (add a negative adjustment) and retry a bulk upload → it is refused with
   "Not enough Ella Credits" and **no** files are sent to n8n.
7. Book a test AI voice interview → balance drops by 10; `Voice_Call_Queue` gets a row.

## Configuring without a redeploy

Most operational settings can be changed at runtime from **Settings → Infrastructure** (settings
admins only) instead of Vercel env vars: the six n8n webhook URLs, `App_URL`, the invite / portal
base URLs, the resume-storage Drive folder ID, the bulk Drive link, the allowed Google domain, link
expiry days, bulk upload concurrency, the batch-complete email toggle, and the Ella credit costs.
A blank field uses the environment variable; a filled field overrides it. A changed webhook URL
takes effect on the next workflow action — no redeploy.

**Still requires setting env vars + redeploy:** the spreadsheet ID and Google service account
(bootstrap), `SESSION_SECRET`, `N8N_WEBHOOK_SECRET`, the Google OAuth client ID/secret/redirect URI,
the public CORS allowlist, and the UAT/demo toggles.

So the minimal path for a new instance is: set the bootstrap + secret env vars, deploy, then finish
configuration in Settings → Infrastructure.

## Notes

- The Ella Credits balance is per-instance because it lives in that instance's spreadsheet.
- HR users must each connect their Google Calendar again on this instance (tokens are stored per
  spreadsheet).
- If n8n workflows aren't ready yet, the portal still runs — the affected routes return
  "workflow is not configured" until their URLs are set.
