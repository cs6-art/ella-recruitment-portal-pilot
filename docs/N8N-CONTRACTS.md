# n8n payload contracts

<!-- Contract note: this document is the integration source of truth for
     portal-to-n8n payloads and bulk-processing behavior. -->

## Recruitment setup update

The portal sends this payload to `N8N_RECRUITMENT_SETUP_WEBHOOK_URL`, or to
`N8N_ROLE_WEBHOOK_URL` when the dedicated URL is not set:

```json
{
  "eventType": "recruitment_setup_updated",
  "roleId": "ROLE-...",
  "actionRequestId": "uuid",
  "expectedCurrentStatus": "Approved",
  "recruitmentSetup": {
    "jobDescription": "...",
    "screeningCriteria": "...",
    "aiSystemPrompt": "Editable template containing {{system_prompt}}",
    "resolvedAiSystemPrompt": "Rendered prompt for the current role",
    "initialInterviewBookingLink": "https://...",
    "hodInterviewBookingLink": "https://...",
    "postingChannels": "LinkedIn, careers page",
    "voiceInterviewAvailabilityMode": "automatic",
    "voiceInterviewSlots": [],
    "voiceInterviewAutoStartDate": "2026-08-17",
    "voiceInterviewAutoEndDate": "2026-08-28",
    "voiceInterviewTimezone": "Asia/Singapore",
    "evaluationFieldToggles": ["technical_depth"],
    "customEvaluationFields": [
      { "key": "domain_fluency", "label": "Domain fluency", "description": "Assess fluency in the required domain." }
    ]
  },
  "Job_Description": "...",
  "Screening_Criteria": "...",
  "Initial_Interview_Questions": "...",
  "AI_System_Prompt": "...",
  "VAPI_Resolved_System_Prompt": "...",
  "ella_system_prompt": "...",
  "Initial_Interview_Booking_Link": "https://...",
  "HOD_Interview_Booking_Link": "https://...",
  "Posting_Channels": "LinkedIn, careers page",
  "Evaluation_Fields": "[{\"key\":\"score\",\"label\":\"Score\",\"description\":\"Overall numeric fit score for the role.\"}]",
  "Recruitment_Setup_Updated_At": "2026-07-25T00:00:00.000Z",
  "Recruitment_Setup_Updated_By_Name": "HR User",
  "Recruitment_Setup_Updated_By_Email": "hr@mclinkgroup.com",
  "License_or_Certificate_Required": "",
  "Keywords_to_Look_For": "",
  "Minimum_Years_of_Experience": "None",
  "Transferable_Skills_Accepted": "",
  "Salary_or_Budget_Range": "",
  "Earliest_Availability_Rule": "",
  "Interview_Behavior": "",
  "performedByName": "HR User",
  "performedByEmail": "hr@mclinkgroup.com",
  "performedByAccessRole": "HR",
  "performedByDepartment": "People",
  "comments": "Setup completed",
  "portalUrl": "https://recruitment.example.com/roles/ROLE-...",
  "timestamp": "2026-07-25T00:00:00.000Z"
}
```

The candidate-application event also carries `evaluationFields`, using the
same baseline, optional, and custom field definitions saved in the role's
`Evaluation_Fields` column. The resume-screening workflow and the post-call
voice evaluator must use that list rather than maintaining separate rubrics.

After a voice call, the Vapi result workflow is responsible for evaluating the
completed transcript against `evaluationFields` and writing one result row to
`Voice_Interview_Results`. It must persist at least `Voice_Score`,
`Voice_Recommendation`, `Voice_Strengths`, `Voice_Concerns`, and one value for
each configured optional/custom field using the exact field `key` as the
column name (the field label is accepted as a backwards-compatible fallback).
For example, a custom field with key `domain_fluency` must be written to a
`domain_fluency` or `Domain_Fluency` column. The portal reads that row after the
call and displays the result for HR review; it does not treat a call as graded
merely because a prompt was saved.

n8n must verify `X-Webhook-Secret`, verify the role is still in
`expectedCurrentStatus`, persist the editable `AI_System_Prompt` template and
the structured criteria values, and use `VAPI_Resolved_System_Prompt` (also
provided as `ella_system_prompt`) when configuring Vapi. VAPI may keep this
literal system prompt in its dashboard:

```text
{{ella_system_prompt}}
```

When starting a call, n8n must pass the rendered prompt through VAPI's
`assistantOverrides.variableValues`:

```json
{
  "assistantOverrides": {
    "variableValues": {
      "ella_system_prompt": "<the rendered role and candidate prompt>"
    }
  }
}
```

The rendered value must have the role and candidate placeholders resolved for
that call; do not pass the literal `{{ella_system_prompt}}` as its value. The
`{{system_prompt}}` placeholder must be replaced with the structured HR
criteria at call setup; the editable template must remain available for later
HR changes. Return HTTP 200 JSON with `{ "success": true }`.

For candidate final-interview invitations, the portal creates or normalizes
`Final_Interview_Booking_Link` when HR approves the voice interview. n8n
should send that exact sheet value in the invitation email; it should not
replace the host with a hard-coded `ellaimclinkgroup.com` or `localhost`.
The portal uses `NEXT_PUBLIC_APP_URL` when configured, otherwise the forwarded
request host, so local development produces `http://localhost:3000/book/final/...`.
After the candidate books a slot, the portal sets
`Final_Interview_Booking_Token_Status` to `Used`, and the same token must not
be accepted again.

For every AI Voice Interview invitation and booking confirmation email, include
this exact notice near the booking link or interview details:

> AI Interview Notice: This interview will be conducted with the assistance of
> an AI interviewing system, which may record, transcribe and assess your
> responses against job-related criteria. Any information or responses
> generated by the AI should not be considered an official representation,
> commitment or offer by Mclink Group unless confirmed in writing by an
> authorized representative.

Do not summarize, paraphrase, or omit this notice. Do not describe the AI voice
interview as a human interview. Face-to-Face Interview invitations are for the
human HR interviewer and should not contain the AI voice-interview notice.

## Events and responses

Role-request payloads include `role.hodEmail` and
`role.hodAvailabilitySlots`. The workflow should map these to
`HOD_Email` and `HOD_Availability_Slots`; the portal also sends the legacy
human-readable `HOD_Availability_Dates` and `HOD_Availability_Times` fields.
`HOD_Availability_Slots` is a JSON array of `{ date, startTime, endTime,
timezone }` objects and is used by the portal when validating final interview
slots.

Recruitment setup payloads also include the optional HR-owned voice availability
configuration. The workflow should preserve `voiceInterviewAvailabilityMode`,
`voiceInterviewSlots`, `voiceInterviewAutoStartDate`,
`voiceInterviewAutoEndDate`, and `voiceInterviewTimezone` in the role row.
Publishing the role creates the configured AI Voice Interview slots in the
portal's `Interview_Slots` tab; the existing booking workflow then uses them.

The portal also supports `interviewAvailabilityRules`, persisted in the
`Interview_Availability_Rules` Role_Requests column. Treat this as the
preferred source for new schedules: recurring rules and specific slots are
expanded virtually by the portal. n8n should preserve the field when reading
or updating a role and should not recreate virtual availability as duplicate
`Interview_Slots` rows. Existing booked and legacy rows remain compatible.

The existing role-request webhook accepts `role_request_created`,
`role_status_transition`, and `recruitment_setup_updated`. Every write carries
an `actionRequestId`; n8n must treat it as an idempotency key and return JSON
with `success`, `roleId`, `status`, `action`, `actionRequestId`,
`notificationStatus`, `notificationError`, and optional `idempotentReplay`.
`notificationStatus` is `sent`, `pending`, `failed`, or `not_configured`.
Notification failure must not change `success` to false after the sheet update.
For `role_request_created`, the foundation workflow must append the role row
before sending the internal HR notification. The checked-in implementation is
`integrations/n8n/role-request-foundation.json`; it requires the Gmail account
and header-auth credentials to be assigned and the workflow to be active in
n8n. See `integrations/n8n/ROLE-REQUEST-NOTIFICATIONS.md`.

## Candidate application submission

The portal sends this payload to `N8N_CANDIDATE_APPLICATION_WEBHOOK_URL` with
the same `X-Webhook-Secret` and `X-Idempotency-Key` pattern used by the public
application route and the HR manual intake route:

```json
{
  "eventType": "candidate_application_submitted",
  "applicationId": "APP-...",
  "roleId": "ROLE-...",
  "Role_ID": "ROLE-...",
  "jobTitle": "Sales Manager",
  "department": "Commercial",
  "candidate": {
    "name": "Candidate Name",
    "email": "candidate@example.com",
    "phone": "+639000000000",
    "preferredMobile": "+639171234567",
    "resumeText": "Extracted resume text only",
    "salaryExpectation": "PHP 50,000",
    "noticePeriod": "30 days",
    "availability": "Immediate",
    "skillsAssessment": "Strong communication",
    "roleExpectations": "Clear ownership",
    "applicationSource": "Direct Application",
    "consent": true
  },
  "resumeFile": {
    "fileId": "RES-...",
    "fileName": "candidate-resume.pdf",
    "mimeType": "application/pdf",
    "size": 123456,
    "sha256": "...",
    "uploadedAt": "2026-08-11T00:00:00.000Z",
    "expiresAt": "2026-09-10T00:00:00.000Z",
    "kind": "pdf"
  },
  "submittedAt": "2026-08-07T00:00:00.000Z",
  "source": "Public Application Page",
  "applicationSource": "Direct Application"
}
```

The portal presents one contact-number control to HR and candidates: a country
code plus a local number. It sends the normalized international number through
the legacy `phone` and `preferredMobile` aliases so existing voice-booking
workflows continue to work. n8n should write the same value to the candidate
sheet's contact-number fields. The selected role is carried in `jobTitle` and
`department` so CV analysis can populate `Selected_Role` and `Department` in
`High_Match_Profile`; the portal reads those fields when rendering applicants.

The HR intake route uses the same schema, but the `source` value is
`HR Manual Intake` and `consent` is omitted. The allowed `applicationSource`
values are `Direct Application`, `Referral`, `Walk-in`, `Agency`,
`Existing Database`, and `HR Invitation`.

The portal accepts either pasted resume text or one validated PDF, legacy DOC, or DOCX file.
For a file submission, the portal validates the extension, MIME type, file
signature, 10 MB limit, and readable extracted text, stores the binary in the
private resume storage directory, and sends only extracted text plus safe file
metadata to n8n. The active `McLink - Candidate Application Foundation`
workflow validates the selected `Role_ID` and file metadata, loads that role's
job description and screening criteria, runs role-specific AI screening, and
appends the result with `Recommendation: For HR Review`,
`Resume_HR_Decision: Pending`, and safe `Resume_File_*` metadata. The AI is
not allowed to approve or reject a candidate. Resume screening must use only
job-related evidence and must not use or infer protected characteristics such as
age, gender, race, ethnicity, nationality, religion, disability, medical
history, family status, appearance, accent, location, or economic background.
HR decisions remain portal-owned and are written to candidate status history.
Binary or base64 resume content is never sent to or stored in Google Sheets.

## Bulk Resume Screening

The Resume Screening page can direct HR to a shared Google Drive folder for
bulk intake. Upload PDF, legacy DOC, or DOCX files using a role-prefixed filename such as
`AC01 - Candidate Name.pdf`. The n8n poller searches that folder every five
minutes, claims one file at a time, extracts its text through the portal, and
submits the same candidate-application contract used by the existing screening
workflow.

Create a `Bulk_Resume_Queue` tab in the candidate workbook with this header
row, in this order:

`driveFileId, driveFileName, driveFileUrl, driveFileMimeType, roleId,
candidateName, candidateEmail, preferredMobile, applicantCountry, status,
applicationId, errorMessage, discoveredAt, processingStartedAt, processedAt,
attemptCount, lastUpdated`

The queue uses `Queued`, `Processing`, `Screened`, `Failed`, and `Skipped`
statuses. The portal groups events by `driveFileId` and displays only the latest
timestamped status. `Screened` is terminal for the selected role: uploading the
same resume again returns a `Skipped` result and does not call the AI screening
workflow or create another queue item.
The queue identity is role-scoped for portal uploads, so the same resume may be
screened independently for a different published role. The Drive poller retries
transient failures up to three total attempts. It waits five minutes before the
second attempt and fifteen minutes before the third; a `Processing` lease older
than thirty minutes is also eligible for recovery. After the third failed
attempt, the latest `Failed` event remains visible for HR review.

Configure the n8n environment with `GOOGLE_BULK_RESUME_DRIVE_FOLDER_ID` and
`N8N_BULK_RESUME_PORTAL_BASE_URL`. The latter must be a URL reachable from n8n
(a local `http://localhost:3000` URL will not work from a hosted n8n instance).

For local HR testing, the primary flow is the portal's direct multi-file upload.
The portal extracts each PDF/DOC/DOCX locally and sends at most two files in
flight, starting later workers 10 seconds apart, to
`N8N_BULK_RESUME_UPLOAD_WEBHOOK_URL` at `/webhook/bulk-resume-upload`.
The `McLink - Bulk Resume Upload Intake` workflow extracts candidate contact
details, writes the processing claim, calls the existing candidate screening
workflow, retries quota-sensitive Sheets operations up to five times with a
5-second delay, and records the final queue status. The portal also applies
exponential backoff to its own Sheets reads. This conservative limit yields a
long-run intake rate of approximately six resumes per minute, subject to AI and
Sheets latency; completed results may be slower when retries are needed. It
uses the SHA-256 file hash as the queue ID, so uploading the same file again
does not create another screening request after it is marked `Screened`.

The active workflow `JD Role Folder Bulk Resume Screening`
(`MWt7W7LNFNZxcc0q`) reads active role-to-folder mappings from the
`Bulk_Role_Folder_Map` tab. Each mapped role folder contains month/year folders
such as `Dec 2025` or `January 2026`; only PDF, legacy DOC, and DOCX files inside
those month folders are screened. Up to 20 resumes are claimed every ten
minutes and processed sequentially with API pauses and bounded Sheet retries.
Missing email or mobile values
are stored as blank and do not prevent the applicant from appearing in the
portal. See `docs/AUTOMATED-BULK-RESUME-SCREENING.md` for operations and access
requirements.

Portal multi-file uploads emit one `bulk_resume_batch_complete` event to the
canonical role-request webhook after every selected file has received a
terminal response from the bulk intake workflow. The active role-request
workflow sends one internal HTML summary through Gmail account 4 to
`cs6@mclinkgroup.com`, `cs9@mclinkgroup.com`, `mgt@mclinkgroup.com`, and
`hrsg@mclinkgroup.com`. This notification is internal-only; no candidate is
included as a recipient.

## Recruitment Setup stage actions

The portal keeps the event name `recruitment_setup_updated` and adds a
`setupAction` field so existing webhook routing remains compatible. Supported
actions are `save_draft`, `mark_recruitment_ready`,
`mark_ready_for_publishing`, and `publish_role`. n8n must write the supplied
`Recruitment_Setup_Status` and stage audit columns. Only `publish_role` may
write `Status: Job Posted`, `Posted_At`, and `Posted_By`; a normal draft save
must not publish or trigger posting notifications.

The server rejects stage actions before sending them when required fields are
missing and returns `RECRUITMENT_SETUP_INCOMPLETE` with `missingFields`.

## Status notifications

The existing `role_status_transition` payload continues to be the source of
truth for status updates. After Google Sheets writes, n8n should resolve
recipients and send the email. A temporary production override currently
routes role request, recruitment status, and recruitment setup notifications
only to `cs6@mclinkgroup.com`; this does not change User_Directory permissions.
Return `notificationStatus` as `sent`, `pending`, `failed`, or
`not_configured`. The email link must use the payload's `portalUrl`.

When `RECRUITMENT_BACKEND=postgres`, the portal commits the role transition
first and records the role-status notification as `pending`. The target n8n
notifier must poll `GET /api/internal/recruitment/notifications` with the
`notifications` entity enabled, send the requester/HR email, then acknowledge
the history ID with `POST` and `status: sent` (or `failed`). A publish is not
rolled back because an email attempt is slow or unavailable.

### Notification queue display fields

Every application item from `GET /api/internal/recruitment/notifications`
carries email-ready copy alongside the raw keys. **Bind these in the email
template instead of the raw `notificationEventType` / `newStage` values:**

| Field | Example | Use |
| --- | --- | --- |
| `eventLabel` | `AI voice interview completed — HR review needed` | Subject / heading (from `notificationEventType`) |
| `statusLabel` | `Voice Interview Review` | "Status" line (from `newStage`) |
| `previousStatusLabel` | `Voice Interview Scheduled` | Optional "from" context (from `previousStage`) |
| `summary` | `The AI voice interview is complete. Open the applicant record to review…` | Body sentence — the reviewer's comment when present, otherwise a per-event default |
| `email` | `{ subject, heading, message, cta, ctaLink, signoff }` or `null` | Full candidate-facing email body. Render these fields directly; `cta`/`ctaLink` are empty when there is no button. `null` means **do not send an email** for this event. |

`email.message` already contains the greeting and paragraphs (`\n\n`
between them); append `email.signoff` after it. For booking invitations
`email.ctaLink` is the secure booking URL; for the AI voice confirmation the
message embeds `Scheduled for: <date> at <time> (<timezone>)` in the
candidate's timezone and there is no CTA (attach an ICS instead).

The raw `notificationEventType`, `newStage`, `previousStage`, and `comments`
fields remain in the payload for routing and auditing.

Approving the AI voice interview now emits a `final_booking_invitation`
event (a `final` booking token is created in the same request), so the
candidate receives the face-to-face interview booking link the same way
resume approval sends the voice interview link.

**No face-to-face booking confirmation email.** Booking a face-to-face slot
records a `final_booking_confirmation` history row with
`notificationStatus: "skipped"`, so it never appears in the queue — the
Google Calendar invitation (the candidate is added as an attendee) is the
confirmation. The AI voice interview still sends `voice_booking_confirmation`
because that call has no calendar event.

**AI voice interview timezone.** Voice interview slot times are generated in
the applicant's own country timezone (resolved from the stored country, or
the E.164 phone number). Face-to-face slots stay in the office timezone
(`Asia/Singapore`).

## Public resume submission receipt

The public resume page currently sends multipart form data to
`POST /webhook/recruitment/apply` and ends at a submission receipt. The
candidate sees that the resume was received and is asked to wait for an email
from the recruitment team. The page does not poll application status or show
voice-interview and final-interview stages.

The previous polling contract is preserved in
`docs/LEGACY-APPLICATION-STATUS.md` for a future release.

## URS Phase 1 changes

All Phase-1 n8n work is done as **new workflows in the pilot n8n project**
(`wwjZ8XFETyncXLez` / folder `5j9w9tazTxLIti82`) — the production workflows are
never edited. See `docs/PHASE-1-N8N-CHANGES.md` for the build list.

### Management-approval step removed

The `send_for_management_approval`, `return_for_revision_management`,
`place_on_hold_management`, and `resume_management_approval` actions and the
`Pending Management Approval` status no longer occur. An HR reviewer approves
or rejects directly from `Pending HR Discussion` via `approve_role` /
`reject_role` (both sent with the existing `role_status_transition` contract).
Route notifications for those actions to the requester and active HR reviewers.

### Face-to-face interview venue

`recruitment_setup_updated` payloads carry `Final_Interview_Venue` (and
`recruitmentSetup.finalInterviewVenue`). On voice approval the portal also
writes `Final_Interview_Venue` to `High_Match_Profile`. The face-to-face
invitation email MUST include this venue text (address, floor/room, arrival
instructions, on-site contact) alongside the `Final_Interview_Booking_Link`.

### Numbered interview questions

`Initial_Interview_Questions` and `VAPI_Resolved_System_Prompt` now contain a
canonical numbered list (`Q1: …`, `Q2: …`). The post-call voice evaluator MUST
associate each candidate answer to its question by the `Qn` number, echo that
number in `Voice_Interview_Results` per-question fields, and never infer the
mapping from transcript turn order. The approved license-clarification and
start-availability follow-ups are not numbered questions and must not be
recorded as `Q` answers.

### AI voice interview — attempt 1–N retry

The portal now sets `Voice_Call_Max_Attempts` (Settings, default 3) on each
`Voice_Call_Queue` row and manages the missed-call state:
`Voice_Call_Status = Retry Scheduled` with a bumped `Voice_Call_Attempts` and a
future `Voice_Call_Scheduled_At` while attempts remain, then terminal `No Show`.
The pilot calling workflow MUST: for a `Retry Scheduled` row, place the next
call at `Voice_Call_Scheduled_At`; on a completed call write a `Completed`
status and a `Voice_Interview_Results` row; never exceed `Voice_Call_Max_Attempts`
calls; and write terminal `No Show` only when instructed by the row state, not
independently.

### Post-screening notifications

The portal does not see screening completion (n8n appends the
`High_Match_Profile` result row directly). A new pilot workflow must, right
after appending each screening result, notify HR (recipients resolved from
`User_Directory` `Can_Review_Role = TRUE`, include `Application_ID`,
`roleTitle`, `Recommendation`, match score) and email the candidate that their
application was received and reviewed.
