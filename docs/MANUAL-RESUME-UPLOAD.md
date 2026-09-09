# Resume upload scope

<!-- Scope note: keep this document aligned with src/lib/resume-files.ts when
     supported file formats or storage/extraction behavior changes. -->

The portal now accepts one PDF, legacy DOC, or DOCX file, while retaining pasted text as a
fallback during rollout. PDF, DOC, and DOCX bytes are never placed in
`High_Match_Profile` or sent as a large base64 JSON field.

1. `CandidateApplicationForm.tsx` accepts one PDF, legacy DOC, or DOCX file and validates
   the extension and a 10 MB maximum.
2. `/api/uploads/resumes` is restricted to authenticated HR reviewers. It
   validates the file signature, extracts readable text with server-side
   PDF/DOC/DOCX parsers, and stores the binary as a Google Drive file (not
   local disk — Vercel's filesystem is read-only outside `/tmp`) in the
   folder configured via `RESUME_STORAGE_DRIVE_FOLDER_ID`. Public applicants
   submit resumes inline through `/api/public/applications`, which is
   rate-limited separately.
3. The application webhook carries `resumeFile` metadata alongside the
   extracted `resumeText`. n8n validates the metadata and screens the extracted
   text; no binary data crosses the webhook.
4. `High_Match_Profile` stores extracted text and non-sensitive file metadata,
   never file bytes or permanent public URLs.
5. `/api/uploads/resumes/[fileId]` allows only authorized HR sessions to
   download a non-expired file. Expiry is 30 days by default.

Uploads are limited per client/user and request bodies are bounded before
`formData()` parsing. Retention cleanup is available through the protected
`/api/cron/resume-cleanup` endpoint, deleting any Drive file whose `expiresAt`
property has passed. A production scheduler must send `Authorization: Bearer
$CRON_SECRET` (or `X-Cron-Secret`) to that endpoint; Preview deployments skip
the operation. Uploads also retain a once-per-process safety cleanup. Before
production enablement, share the `RESUME_STORAGE_DRIVE_FOLDER_ID` folder with
`GOOGLE_SERVICE_ACCOUNT_EMAIL` (Editor access — prefer a Shared Drive, since
a service account has no Drive storage quota of its own) and add malware
scanning at the hosting edge or storage layer. The route rejects invalid file
signatures and empty extraction results before screening.
