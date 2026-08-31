# Automated bulk resume screening

<!-- Operations note: this runbook documents the Drive convention, service
     account permissions, retry behavior, and historical-date rules. -->

The active n8n workflow `JD Role Folder Bulk Resume Screening`
(`MWt7W7LNFNZxcc0q`) polls Google Drive every ten minutes. HR only needs to
upload resumes into the correct role and month folder; no portal upload is
required.

## Import from your Google Drive (portal)

As an alternative to the folder poller and local uploads, an HR reviewer can
pick resumes straight from their own Google Drive on the Resume Screening page:

1. **Connect Google Drive** — a one-time per-user OAuth consent (read-only
   `drive.readonly`, stored separately from the calendar connection).
2. **Choose from Google Drive** — a folder browser opens; navigate, select up
   to 25 PDF/DOC/DOCX files, and **Import**.

The portal downloads the selected files server-side and runs them through the
**same** bulk intake pipeline as a local upload — SHA-256 dedupe, the Shared
Drive copy, `Bulk_Resume_Queue`, the `bulk_resume_uploaded` webhook, one Ella
Credit per accepted file, and the live status table. Re-importing the same
files returns `Skipped`.

Google Cloud Console prerequisites (one-time): add the `drive.readonly` scope
to the OAuth consent screen, confirm the Google Drive API is enabled, and add
`https://<portal-domain>/api/auth/google-drive/callback` to the OAuth client's
Authorized redirect URIs. For an Internal Workspace app no verification is
needed.

## Drive layout

Use this structure:

```text
Resume Bulk Uploads/
  General Manager/
    Nov 2025/
    Dec 2025/
    Jan 2026/
```

Accepted month folder names are abbreviated or full English month plus year,
for example `Dec 2025` and `December 2025`. Numeric `2025-12` and `12-2025`
names are also accepted. Files placed directly in the role root are ignored,
which prevents the role's job-description file from being screened as a resume.

Accepted resume formats are PDF, DOC, and DOCX. The portal extraction endpoint
limits each file to 10 MB. Password-protected, corrupt, image-only, or otherwise
unreadable files are recorded as failed after retries rather than silently
disappearing.

## Role-folder mapping

The candidate workbook contains `Bulk_Role_Folder_Map` with these columns:

`Role_ID, Role_Name, Drive_Folder_ID, Active`

To add another role, add one row with its published portal role ID, Drive role
folder ID, and `TRUE` in `Active`. No n8n workflow edit is required.

Only portal roles whose `Status` is `Job Posted` and whose recruitment setup is
`Published` should be enabled. The shared workflow currently has active mappings
for these published roles:

- `HG01` - HR Generalist
- `GM01` - General Manager
- `IE01` - IT Support Engineer
- `ME01` - Marketing Intern
- `SM01` - Sales Manager
- `BDE01` - Business Development Executive
- `ISS01` - Inside Sales Supervisor
- `ISSP01` - Inside Sales Specialist
- `OT01` - Outdoor Technician
- `SBOFC01` - SAP Business One Functional Consultant
- `WD01` - Web Developer
- `SAE01` - Senior AI Engineer

Published roles without a mapped Drive folder remain disabled until their role
folder is available to the n8n service account. This prevents resumes from being
screened against a draft role or the wrong job description.

Pending published-role folders: `CSE01` Customer Service Executive, `AC01` AI
Coordinator, `PE01` Prompt Engineering, `AE01` AI Engineer, `CA01`
Cybersecurity Analyst, and `QEETA01` QA End-to-End Test Analyst.

## Processing behavior

- A maximum of 20 due resumes is selected and claimed per run.
- All selected resumes are claimed before serial processing starts, preventing
  an overlapping run from selecting the same files.
- Resumes are processed one at a time, with pauses around downloads and API calls.
- Drive, Google Sheets, text extraction, and role-screening AI requests use
  bounded retries. Google Sheets quota retries pause for 20 seconds.
- Email and mobile are extracted deterministically from resume text, avoiding
  an extra AI request per file. Missing values remain blank.
- Queue failures retry up to three total attempts with 5-minute and 15-minute
  backoff. A processing claim older than 30 minutes is recoverable.
- `APP-BULK-<Drive file ID>` is the permanent application identity. The workflow
  checks `High_Match_Profile` before submitting, preventing duplicate applicant
  rows after a timeout or restarted execution.
- Successful resumes appear in the portal as processed and pending HR review.
  Missing email or mobile fields remain blank; they do not block the applicant.

## Historical application dates

The month folder controls `Date of Application`. A stable hash of the Drive file
ID chooses a day and time inside that month in Singapore time. For example,
files in `Dec 2025` receive varied December 2025 timestamps. The value is stable:
retries produce the same date instead of changing it.

## Service-account access

The n8n credential `Google Service Account API` must have at least Viewer access
to every mapped role folder and its children, and Editor access to the candidate
workbook. Sharing the common `Resume Bulk Uploads` parent folder normally lets
new child folders inherit access. If a future mapped folder is outside that
shared tree, share it with the service account email shown in the n8n credential.
The current account is
`recruitment-portal-sheets@mclink-recruitment-portal.iam.gserviceaccount.com`.
