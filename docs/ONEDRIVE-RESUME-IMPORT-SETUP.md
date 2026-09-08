# OneDrive resume import — Microsoft Entra setup

**Implementation status (2026-09-03): code COMPLETE.** OAuth connect/callback/
status/disconnect, Graph token refresh, folder browse, file download, the
shared bulk-intake pipeline (SHA-256 dedupe, `Bulk_Resume_Queue`, one
`cv_analysis` credit per screened file, batch-complete notification), the
**8-file-per-submission cap** (now identical to Google Drive import — was 25),
10 MB / PDF-DOC-DOCX validation, and every failure path in the table below are
all built and unit-tested (`tests/onedrive-import.test.mjs`).

**Remaining = external configuration only (`BLOCKED-MANUAL`):** the Microsoft
Entra app registration and its three secrets below. No live authorization has
been performed. Until the env vars are set the controls are inert (by design)
and every route returns a clean "not configured" response.

The "Connect OneDrive" / "Choose from OneDrive" controls on the Resume
Screening page are **inert until** a Microsoft Entra (Azure AD) app registration
is created and its credentials are set as environment variables. This is a
one-time task for an administrator of the McLink Microsoft 365 tenant. It is
completely separate from the Google OAuth client.

## 1. Register the application

1. Sign in to <https://entra.microsoft.com> as a Global Administrator or
   Application Administrator (or use <https://portal.azure.com> → **Microsoft
   Entra ID**).
2. **App registrations** → **New registration**.
   - **Name**: `Ella Recruitment Portal – OneDrive Import`
   - **Supported account types**: *Accounts in this organizational directory
     only* (single tenant) — recommended.
   - **Redirect URI**: platform **Web**, value
     `https://ella-recruitment-portal-pilot.vercel.app/api/auth/microsoft-drive/callback`
     (the canonical pilot URL — see `MANUAL-CHECKLIST.md` §D2)
   - **Register**.
3. For local development add a second Web redirect URI under
   **Authentication** → **Add URI**:
   `http://localhost:3000/api/auth/microsoft-drive/callback`.
4. On **Authentication**, leave "Access tokens" / "ID tokens" unchecked (this
   app uses the auth-code flow with a client secret, not implicit flow).

## 2. Add the client secret

1. **Certificates & secrets** → **Client secrets** → **New client secret**.
2. Description `portal`, expiry 12–24 months. **Add**.
3. Copy the secret **Value** immediately (it is shown only once).

## 3. Grant Microsoft Graph permissions

1. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Delegated permissions**.
2. Add exactly these — least privilege, read-only:
   - `Files.Read` — read the signed-in user's own files.
   - `User.Read` — confirm which account connected.
   - `offline_access` — keep a refresh token so HR does not re-consent daily.
   (`openid`, `profile`, `email` are added automatically.)
3. **Do not** add `Files.ReadWrite`, `Files.Read.All`, `Sites.*`, or any
   Application permission.
4. If your tenant requires admin consent for delegated Graph scopes, click
   **Grant admin consent for McLink** so each HR user is not blocked at first
   connect.

## 4. Collect the values

| Env var | Where to find it |
| --- | --- |
| `MS_CLIENT_ID` | App registration **Overview** → *Application (client) ID* |
| `MS_CLIENT_SECRET` | the secret **Value** from step 2 |
| `MS_TENANT_ID` | **Overview** → *Directory (tenant) ID* (or `organizations` for any work/school account) |

## 5. Set the environment variables

Add to Vercel (Project → Settings → Environment Variables, Production +
Preview) and to `.env.local` for local work:

```
MS_CLIENT_ID=<application client id>
MS_CLIENT_SECRET=<client secret value>
MS_TENANT_ID=<directory tenant id>
```

`MS_DRIVE_OAUTH_REDIRECT_URI` is optional — the portal derives the redirect
from the request origin. Redeploy after setting the variables.

## 6. Verify

1. Resume Screening page → **Connect OneDrive** appears (only when the vars are
   set).
2. Complete the Microsoft consent as an HR user → redirected back with
   `?onedrive=connected`, and the panel shows the connected account with a
   **Disconnect** link.
3. **Choose from OneDrive** → browse a folder → select 2–3 PDFs → **Import**.
4. Confirm the same `Bulk_Resume_Queue` rows appear, the status table reaches
   *Completed*, the Ella Credits meter drops by the file count, and re-importing
   the same files returns *Skipped* (SHA-256 dedupe) — identical to a local
   upload.

## Failure handling (already built in)

| Situation | Behaviour |
| --- | --- |
| Refresh token expired / password changed | list & import return `409 ONEDRIVE_NOT_CONNECTED`; panel prompts to reconnect |
| HR revoked the app in their Microsoft account | same as above |
| Selected file deleted / moved | that file becomes an inline `Failed` result ("no longer available"); the rest of the batch proceeds |
| No permission to a selected file | inline `Failed` result ("access denied or revoked") |
| Non-PDF/DOC/DOCX or > 10 MB | rejected in the metadata pass, before download |
| Same file imported again | `Skipped` via SHA-256 dedupe, no credit charged |
| Insufficient Ella Credits | `402`, no files submitted |
