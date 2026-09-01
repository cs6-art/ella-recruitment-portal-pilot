# Ella Help — Recruitment Portal FAQ Knowledge Base

This is the approved knowledge source for the "Ella Help" in-portal assistant.
It is written for portal end users (Creators, HR, Management, HODs, interviewers,
administrators). It is derived from the McLink Recruitment Portal User Manual, the
working recruitment workflow notes, and the portal access-control model.

Rules for the assistant:

- Only answer using the information in this file.
- If the answer is not covered here, say you don't know and suggest contacting HR
  or the portal administrator.
- This assistant is informational only. It cannot see candidate records, resumes,
  scores, calendars, or any live portal data, and it cannot perform actions.

---

## Overview: what the portal is for

The McLink Recruitment Portal keeps a hiring request in one place, from the first
staffing request through screening and interviews. What each person can see and do
depends on their assigned access. The short version of the process:

1. Someone submits a role request (requisition).
2. HR reviews the details and discusses any changes.
3. Management approves, returns, holds, or rejects the request.
4. HR prepares the hiring details in Recruitment Setup and publishes the role.
5. Candidates are screened (resume, then AI voice interview) and interviewed by HR.

The main menu items are Dashboard, Role Requests, Resume Screening, Applicants,
Bookings, Settings, User Accounts, and Profile. Menu items you are not allowed to
use do not appear for you.

---

## Signing in

Sign in with your McLink Group Google Workspace account using "Sign in with
Google". Personal Google accounts are rejected. The portal checks that the email
is verified and belongs to the company Workspace domain. If access is denied after
a successful Google sign-in, your account may not have recruitment access yet —
contact HR or the portal administrator.

---

## How to create a role requisition (role request)

A role request is used when a team needs an additional employee or a replacement.

Before starting, gather: the job title and department; whether it is a staff
addition or a replacement; a description of the work and the reason; the number of
vacancies and the target hiring date; and salary or budget information if your
process requires it.

Steps:

1. Open **Role Requests**, then select **Create Role Request**.
2. Complete the role details: request type, department, employment type, job
   title, number of vacancies, and target hiring date.
3. Explain the need. For a replacement, name the employee or position being
   replaced. For any request, explain why the role is needed.
4. Optionally add HR interview and screening questions if you already have them.
   These can be refined later by HR.
5. Review and submit. Your name and email are filled in from your signed-in
   account and cannot be changed in the form.

Job description helper: if you have a job description file you can upload it or
paste the text, then choose the option to fill in the form from it. Always check
the suggested details before submitting.

A saved draft is not a submitted request and does not publish a job. After you
submit, the request goes to HR for discussion and you can follow it from Role
Requests.

---

## How HR reviews and approves a role

Open a request from the Role Requests list to see its details, comments, history,
and available actions.

Finding a request: use the **Status** filter to see requests at a particular
step; search by job title, role number, department, or requester; use sort
options for the newest request or the nearest target date; select **Refresh** if
someone else may have updated it.

Making a decision: choose the action that matches the decision (approve, return
for revision, hold, or reject), add a clear comment when useful, and confirm. If
the request changed since you opened it, refresh and review again before retrying
the action — an "HTTP 409" or "someone else changed the record" message means
exactly this.

The typical flow is: the requester submits → **Pending HR Discussion** (HR checks
details) → **Pending Management Approval** (Management decides) → **Approved**.
From there HR does Recruitment Setup and publishing.

Important: approving a role is not the same as publishing a job. HR still has to
complete Recruitment Setup and publish the role before candidates can apply.

---

## What the role request statuses mean

- **Draft** — still being prepared. Complete and submit it.
- **Pending HR Discussion** — HR needs to review the request and discuss any
  changes.
- **Pending Management Approval** — Management needs to decide: approve, return,
  hold, or reject.
- **Returned for Revision** — more information or changes are needed from the
  requester or HR.
- **On Hold** — the request is paused; resume it when the business is ready.
- **Approved** — the role has approval to move forward; HR completes the hiring
  setup.
- **Recruitment Setup** — HR is preparing screening and interview details.
- **Job Posted** — the role is available for candidates; review applicants as they
  arrive.
- **Rejected** — the request will not move forward; read the comments for the
  reason.

---

## How Recruitment Setup works

Recruitment Setup is where HR tells the portal what to look for in resumes and
interviews for an approved role. It is normally available only to HR reviewers.

Screening instructions to complete:

- What the interviewer should listen for (the evidence that matters for the role).
- Whether a license or certificate is required, preferred, or not needed.
- Keywords to look for (skills, tools, or terms, comma-separated).
- Which transferable / related experience may count.
- Minimum relevant experience (for example "None", "3 years", "5+ years").
- Approved salary or budget range, if applicable.
- Earliest availability instructions (any start-date question to ask).

Evaluation fields and questions: the portal always considers the candidate's
score, recommendation, strengths, and concerns. HR can add role-specific items
and up to three custom items, plus three to five interview questions. Questions
are asked as written, so keep them clear and fair. Suggested questions may be
shown as a starting point — edit them as needed.

Publishing checklist: choose at least one place the job will be posted; choose
the salary visibility option; choose the license requirement; choose whether an
HR interview is required.

Save and move the role forward:

- **Save** — save changes and keep working.
- **Mark as Recruitment Ready** — the basic screening and interview information is
  complete.
- **Mark as Ready for Publishing** — the publishing checklist is complete and HR
  has reviewed it.
- **Publish Role** — the role is ready to appear for candidates.

Read the script preview before saving — it shows the kind of conversation
candidates will receive. A `RECRUITMENT_SETUP_INCOMPLETE` error means required
fields for the requested stage are missing; the message lists them. Complete
those fields, or choose the explicit "Not disclosed" / "Not required" option,
then retry.

---

## How resume screening works

When a candidate applies to a published role, the portal records the application
with a new `APP-...` identity, extracts the resume text, runs an automated AI CV
analysis against the role's screening criteria, and adds the candidate to the HR
review list. The same email address may apply again, including for the same role;
each submission is a separate application record.

Automated screening is an aid for HR, not a hiring decision. HR always reviews the
resume and supporting information and records the decision. A hiring decision
should never be based only on an automated score.

To review: open **Applicants**, use the search box (name, role, email, or
application number) and the role/stage filters, then select **View** beside a
candidate. The record brings together contact information, role, resume
information, the screening result, interview activity, and history.

---

## How bulk resume upload works

HR can screen a group of resumes for one published role from **Resume Screening**.

Upload from your computer:

1. Choose the published role that matches every resume in the batch.
2. Add the files — drag them in or click the box. PDF, DOC, and DOCX are
   accepted, up to 25 files at a time, 10 MB per file.
3. Select **Start screening**. The portal queues each file for processing.
4. Watch progress — the list updates automatically, or choose **Refresh status**.
5. When processing is complete, choose **View Processed Applicants** to begin the
   human review.

Queue messages: **Queued** (waiting) and **Processing** (being read) mean wait;
**Completed / Screened** means review the candidate; **Skipped** means the file
was already handled for this role; **Failed** means check the file and choose
**Retry failed** — use a readable, unlocked PDF, DOC, or DOCX.

Each file is handled once per role. Automated screening remains an aid, not a
final decision.

---

## How Google Drive import works

If your team uses the shared Google Drive resume folder, first connect Google
Drive (HR uses "Connect Google Drive"; this uses a read-only permission). Then in
**Resume Screening**, choose the role first and select **Upload from Google
Drive**.

Put each resume inside the correct role and month folder. Do not put resumes
directly in the role's top-level folder. From there the files go through the same
screening queue as a computer upload (Queued → Processing → Completed / Screened,
with Skipped and Failed as above).

OneDrive import works the same way when it is configured for your organization.

---

## How voice interview scheduling works

After HR approves a candidate's resume, the application moves to the AI voice
interview stage and the portal sends the candidate a secure booking invitation by
email, followed by a confirmation email once they book.

The booking emails include a required notice that the interview is conducted with
the assistance of an AI interviewing system that may record, transcribe, and
assess responses against job-related criteria, and that AI output is not an
official offer or commitment unless confirmed in writing by an authorized McLink
representative. This notice must not be summarized, paraphrased, or removed.

The candidate opens their private `/book/voice/...` link and picks one of the
generated 10-minute weekday slots. A successful reservation records the scheduled
date, time, and timezone, marks the booking link used, and queues the call. Each
voice time is shared across roles and stays open until ten applicants are
scheduled for that exact time; after that the time is hidden and further bookings
for it are rejected.

At the scheduled time an automated process places the AI voice call, then records
the transcript and a structured interview result on the applicant's record for HR
to review.

---

## How candidates book interview slots

Candidates book from the private link in their invitation email — they do not see
the internal calendar, only individual available times.

- **Phone (voice) interview:** open the booking link, enter the local mobile
  number without the country code, choose a date, choose a time, and confirm.
  Keep the confirmation email.
- **HR / face-to-face interview:** if HR invites the candidate to the next step,
  they open the new booking link and choose from the available times. The page
  shows whether the interview is scheduled, completed, or no longer available.

Booking links are personal and single-purpose. They should not be forwarded or
posted in a group chat. If a link does not work or has already been used, the
candidate should contact the recruitment team for a new invitation.

---

## How HR reviews voice interview results

When the AI voice interview result is ready, the candidate's stage becomes
**Voice HR Review**. HR opens the applicant record and reviews the voice interview
evidence — the transcript and the structured result — alongside the resume and
screening result.

HR then records an explicit decision. Approval moves the candidate to
**Approved for Face-to-Face Interview** and generates the HR interview booking
invitation. A rejection stops the candidate at this stage. As with resume
screening, the AI result is evidence for a human decision, not the decision
itself.

---

## How final / face-to-face (F2F) interview booking works

When HR approves a candidate after the voice interview, the portal sends an HR
interview booking invitation with a new private link. The candidate chooses from
the available times, which come from the shared HR Google Calendar configured in
Settings.

A valid booking creates the appointment on the shared calendar, adds the
candidate's email as an attendee, marks the booking link used, and stores the
scheduled date, time, and timezone on the applicant record. The candidate
receives a confirmation and both sides see the same time because the timezone is
recorded.

HR availability: in **Bookings**, choose **+ HR Availability**, choose an approved
role, and choose **Refresh availability** to check the shared HR calendar, then
share the booking link with the candidate. If a candidate does not attend, open
the date details, find the appointment, and choose **Mark No Show** after the
interview start time, then confirm.

If the calendar shows no times: check the role and interview-type filters, choose
the correct month, and refresh. If there are still none, ask the person who
manages Settings to check or reconnect the shared HR calendar.

---

## What the applicant stages mean

- **Resume HR Review** — the resume has been received and needs a human review.
- **Resume Approved** — the candidate can move to the phone interview step.
- **Voice Booking Pending** — the candidate needs to choose a phone interview
  time.
- **Voice Interview Scheduled** — a phone interview time has been booked.
- **Voice HR Review** — the phone interview result is ready for HR to review.
- **Approved for Face-to-Face Interview** — the candidate can choose a
  face-to-face interview time.
- **Face-to-Face Interview Scheduled** — a face-to-face interview time has been
  booked.
- **Passed Face-to-Face Interview** — the candidate passed the face-to-face step.
- **Rejected** — the candidate will not move to the next step.

---

## How credits work (Ella Credits)

Ella Credits are the portal's usage allowance for AI-assisted recruitment work,
such as automated CV screening and AI voice interviews. The current balance is
shown in the sidebar (the Ella Credits meter) and on the Ella Credits panel.

Each AI-assisted action draws down the balance — for example screening a resume or
running an AI voice interview consumes credits. When the balance runs low, ask
the portal administrator or HR operations to review the top-up; if credits run
out, AI-assisted steps may be blocked until the balance is restored. Ordinary
portal actions like creating a role request, commenting, or booking do not consume
credits. For exact per-action costs and your current allowance, check the Ella
Credits panel or contact the portal administrator.

---

## Who can access what: HR, Management, HOD, and Creator

The portal shows only the actions a person is allowed to use. Access is built from
five permissions: submit and track role requests; review HR setup and applicants
and manage interview operations; approve or reject management-stage decisions;
edit portal settings; and manage user accounts.

- **Creator / Requester** — creates staffing requests and follows the requests
  they submitted. Usually sees Dashboard, Role Requests, and Profile. Does not
  review applicants or use HR operational tools.
- **HR / Recruiter** — reviews role details, edits Recruitment Setup, screens
  candidates, arranges interviews, and manages the hiring list. Usually sees Role
  Requests, Resume Screening, Applicants, and Bookings. HR does not give final
  management approval.
- **Management** — reviews the business need and approves, returns, holds, or
  rejects role requests, and can review organization-wide records and applicants.
  Management is view-only across the rest of the portal: it does not create role
  requests and does not use the HR operational tools (Recruitment Setup, Resume
  Screening, Bookings).
- **HOD / Department Head** — read-only visibility (plus interview participation)
  scoped to their own department. May also be given the ability to create
  requests. Does not manage the company-wide pipeline unless HR grants more
  access.
- **Administrator** — manages user accounts and permissions and, where
  authorized, shared settings and the interview calendar connection.

Settings and the connected interview Google account are visible read-only to
every signed-in user, but only an administrator (or a specifically trusted HR
operations administrator) can connect, disconnect, or change that Google account.
Other people should get calendar access through Google Calendar sharing.

If a menu item or action you need is missing, that is usually an access setting —
ask HR or the portal administrator to review your access.

---

## Common troubleshooting questions

**"I cannot see a role or applicant."** Your access may limit you to your own
requests or your department. Ask HR to confirm you have the right access.

**"My request is not moving."** Check the status and the latest comment. It may be
waiting for HR or Management, returned for more information, or on hold.

**"The role was approved but candidates cannot apply."** Approval is only one
step. HR must complete the Recruitment Setup checklist and publish the role.

**"A resume failed to screen."** Make sure it is a readable, unlocked PDF, DOC, or
DOCX no larger than 10 MB, then use the retry option. If it still fails, ask HR to
check the file or enter the candidate another way.

**"The calendar shows no times."** Check the role and interview-type filters,
choose the correct month, and refresh. If there are still none, ask the calendar
administrator to check the shared HR calendar.

**"The page says someone else changed the record" / "HTTP 409".** Refresh the
page, read the latest information, then try again. This prevents one person's
changes from overwriting another's.

**"The n8n webhook is not configured."** A server configuration value is missing.
This is for the portal administrator to fix; it is never something the browser or
an end user sets.

**"Unable to load role requests."** Usually a server-side spreadsheet access or
configuration problem. Report it to the portal administrator with the time and
what you were doing.

**Booking link does not work.** Booking links are single-use and personal. If a
link is expired or already used, generate or request a new invitation.

---

## Good practice

- Use clear, job-related information and check details before submitting or
  publishing.
- Keep candidate information and private booking links confidential.
- Use human judgement alongside automated screening results; never decide on a
  score alone.
- Add useful comments when returning or rejecting a request.
- Use your company account, not a personal account, for recruitment work.
- Do not delete records unless you are sure — deleting an applicant also removes
  the related screening information, history, and interview times.
