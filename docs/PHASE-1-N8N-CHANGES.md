# URS Phase 1 — n8n change list (pilot only)

The portal side of URS Phase 1 is done in this repo. The items below are the
matching n8n work. **Rules:**

- Never edit a production ("non-pilot") workflow.
- Build everything as **new workflows** in the pilot project
  `wwjZ8XFETyncXLez` / folder `5j9w9tazTxLIti82`
  (`https://n8n.srv1457709.hstgr.cloud/projects/wwjZ8XFETyncXLez/folders/5j9w9tazTxLIti82/workflows`).
- Point each new workflow's Google Sheets nodes at the **pilot spreadsheet**
  (`GOOGLE_SHEETS_SPREADSHEET_ID`) and its Header-Auth at the **pilot
  `N8N_WEBHOOK_SECRET`**.
- After creating a webhook workflow, put its production URL into the pilot
  Vercel deployment under **Settings → Infrastructure** (or the matching env
  var). No code change or redeploy of the portal is needed for a URL swap.

## No environment variables to add

Every new Phase-1 tunable is a Settings value, not an env var:
`Voice_Call_Max_Attempts` (3), `Voice_Call_Retry_Gap_Hours` (24),
`Ella_Credit_Discount_Threshold` (2000), `Ella_Credit_Discount_Percent` (10),
plus the existing infrastructure keys. New Google Sheet columns
(`Final_Interview_Venue`, the `Voice_Call_Queue` attempt columns) are created
automatically by the portal on first write.

---

## 1. Pilot – Screening Complete Notifier  (new webhook workflow)

**Why:** "post-screening notifications trigger automatically". The portal never
sees screening completion — n8n appends the `High_Match_Profile` row itself.

- Trigger: called by a **pilot copy of `McLink - Candidate Application
  Foundation`** right after its "append screening result" node (and by the
  pilot bulk-screening workflow after each `Record Resume Screened`).
- Input: `{ applicationId, roleId, roleTitle, candidateName, candidateEmail,
  recommendation, matchScore }`.
- Action A — HR email: resolve recipients from `User_Directory` where
  `Can_Review_Role = TRUE` and `Active = TRUE` (same lookup the status-notifier
  uses); subject e.g. `New screened candidate — {roleTitle}`; body includes
  applicationId, recommendation, match score, and a portal link
  `{App_URL}/applicants/{applicationId}`.
- Action B — candidate email: "We've received and reviewed your application for
  {roleTitle}. Our recruitment team will contact you about the next step."
- Return `{ success: true }`.

## 2. Pilot copy — Candidate Application Foundation

Duplicate to the pilot folder, repoint Sheets + secret, and add the call to
workflow #1 after the result is appended. No other logic change.

## 3. Pilot copy — Face-to-face invitation workflow

Duplicate `Voice Interview HR Decision v2 – Hashed Final Booking Token` to the
pilot folder. In the invitation email that carries
`Final_Interview_Booking_Link`, also read `Final_Interview_Venue` from the
`High_Match_Profile` row and include the address / floor / room / arrival
instructions / on-site contact. Keep the existing AI-interview notice rules for
voice emails; the F2F email is a human-interview email and must not carry the
AI voice notice.

## 4. Pilot copy — Vapi result / evaluator workflow

Duplicate the result-evaluator to the pilot folder. Parse the numbered
`Q1:/Q2:/…` list from `VAPI_Resolved_System_Prompt` (or
`Initial_Interview_Questions`). For every configured evaluation field and every
per-question value written to `Voice_Interview_Results`, associate the answer
to its question **by `Qn` number**, and include the question number in the
output. Do not number by transcript turn order. Treat the license-clarification
and start-availability follow-ups as non-numbered.

## 5. Pilot copy — AI Voice Interview Scheduled Calling

Duplicate the calling workflow to the pilot folder and make it attempt-aware:

- For a `Voice_Call_Queue` row with `Voice_Call_Status = Retry Scheduled`,
  place the next call at `Voice_Call_Scheduled_At`.
- Never place more than `Voice_Call_Max_Attempts` calls for one row.
- On a completed call: write `Voice_Call_Status = Completed` and the
  `Voice_Interview_Results` row (per #4).
- On a missed/failed call: leave the row for the portal to advance
  (`Retry Scheduled` with a bumped `Voice_Call_Attempts` / future
  `Voice_Call_Scheduled_At`, or terminal `No Show` once exhausted). The
  workflow should not write a terminal `No Show` on its own.

## 6. Pilot copy — Role-request status workflow

Duplicate to the pilot folder. Drop the `send_for_management_approval`
recipient rule. Handle `approve_role` / `reject_role` (from HR reviewers) —
notify the requester and active HR reviewers. `Pending Management Approval`
never occurs.

---

## Portal Settings to set on the pilot after the workflows exist

| Setting (Settings → Infrastructure / Workflow Rules / Ella Credits) | Value |
|---|---|
| `N8N_Candidate_Application_Webhook_URL` | pilot copy of #2 |
| `N8N_Application_Invite_Email_Webhook_URL` | existing pilot invite-email workflow |
| `N8N_Bulk_Resume_Upload_Webhook_URL` | pilot bulk-intake workflow |
| `N8N_Role_Webhook_URL` / `N8N_Recruitment_Setup_Webhook_URL` | pilot copy of #6 |
| `N8N_Role_Description_Parser_Webhook_URL` | pilot parser workflow |
| `Voice_Call_Max_Attempts` | `3` (or as agreed) |
| `Voice_Call_Retry_Gap_Hours` | `24` |
| `Ella_Credit_Discount_Threshold` / `Ella_Credit_Discount_Percent` | `2000` / `10` |

The "Screening Complete Notifier" (#1) is an internal webhook called by #2, so
it does not need a portal Settings entry — put its URL in the #2 workflow.
