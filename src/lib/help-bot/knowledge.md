# Smile — Recruitment Portal FAQ Knowledge Base

This is the approved knowledge source for the "Smile" in-portal help assistant.
It is written for portal end users (Creators, HR, Management, HODs, interviewers,
administrators). It is derived from the McLink Recruitment Portal User Manual, the
working recruitment workflow notes, and the portal access-control model.

Rules for the assistant:

- Only answer using the information in this file.
- If the answer is not covered here, say you don't know and suggest contacting HR
  or the portal administrator.
- This assistant is informational only. It can report the signed-in user's
  organisation-wide Smile Credits balance and, for pipeline users, aggregate
  queue and interview counts through approved live checks. It cannot see
  candidate records, resumes, scores, calendars, or other live business data,
  and it cannot perform actions.

---

## Overview: what the portal is for

The McLink Recruitment Portal keeps a hiring request in one place, from the first
staffing request through screening and interviews. What each person can see and do
depends on their assigned access. The short version of the process:

1. Someone submits a role request (requisition).
2. HR reviews the details and discusses any changes.
3. HR reviews the request and makes the recruitment decision according to the
   organisation's access rules.
4. HR prepares the hiring details in Recruitment Setup and publishes the role.
5. Candidates are screened by resume and, when enabled, an AI voice interview;
   HR reviews the evidence and makes the hiring decisions.

The main menu items are Dashboard, Role Requests, Resume Screening, Applicants,
Bookings, Settings, User Accounts, and Profile. Menu items you are not allowed to
use do not appear for you.

## Quick answers for common portal questions

**Where do I add a user?** Open **User Accounts**, choose **Add user account**,
complete the name, email, access role, department, and permissions, then save.
McLink platform administrators can first choose the organization in **Manage
users for**. Organization administrators manage users in their own organization.

**How do I add an organization?** A McLink platform administrator opens **User
Accounts**, uses **Add organization**, enters the organization name and lowercase
slug, and saves. The new organization can then be selected in **Manage users for**
so its user directory can be created. Editing an organization changes its
directory metadata; it does not move or delete recruitment records.

**Are client records mixed together?** No. Each organization's users,
departments, roles, applicants, interview records, and Smile Credits are separated
by the organization's access boundary. A user only sees the organization tied to
their signed-in account.

**What does Smile know about me?** Smile can explain the signed-in account's access
role, department, and permissions. When asked, she can report the organisation's
current Smile Credits balance and, for pipeline users, aggregate bulk-queue or
interview counts. She cannot look up candidate records, resume files, applicant
scores, calendars, or other live business records.

**What is the current bulk screening limit?** The current limit is
{{BULK_FILE_LIMIT}} files per batch, with PDF, DOC, and DOCX accepted up to
10 MB per file. The limit is shared by computer upload, Google Drive import,
and OneDrive import.

---

## Signing in

Sign in with your email address and password. The first time, choose **Create
account**, enter your name, your organisation email address, and a password of at
least 10 characters. Your account is placed in your organisation automatically,
based on your email address. We email you a link; select it within 24 hours to
confirm your address, then **Log in**.

- **Forgot your password?** Choose **Forgot your password?** on the sign-in page and
  follow the link we email you. The link works once and expires after an hour.
- **"Verify your email":** choose **Resend verification email** and use the newest link.
- **Your email is not accepted when creating an account:** only addresses that belong
  to an organisation on the portal can register. Ask HR to add you in User Accounts.
- **Too many attempts:** wait a few minutes and try again.
- **"Limited access" after signing in:** your account is active but has not been given
  recruitment permissions yet. Contact HR.

A person who creates their own account with an organisation email starts with HR
access for that organisation (create, review and approve roles, edit settings,
manage accounts). They do not get Manage Smile Credits. HR can change any account
in User Accounts.

## Getting started checklist for a new organisation

When a new organisation first signs in, HR users see a **Getting Started** card on
the Dashboard. Its steps: create and publish your first role (paste a job description
and Smile fills in the screening questions); add Smile credits (a new organisation
starts with none); get your first candidates (share the role's application link or
upload a batch of resumes); confirm email delivery (shows whether candidate and HR
emails are going out and whether any failed); invite your team (colleagues join by
creating an account with your organisation email); and connect Google Calendar (only
needed for face-to-face interviews). Each step shows whether it is done and has a
button that goes straight there.

---

## User accounts and organizations

Every account belongs to one organisation. The account's access
role, department, and permissions determine which screens and actions are
available. An administrator can open **User Accounts**, choose **Add user
account**, then set the user's name, email, access role, department, permissions,
and active status. Deactivate an account when access should be removed; do not
reuse another person's account.

The portal can serve multiple organizations. A McLink platform administrator can
open **User Accounts**, add an organization in the **Organizations** section,
then choose it in **Manage users for** before adding its users. Each organization
has its own users, departments, roles, applicants, interview records, and Smile
Credits. Users cannot manage or view another organization's recruitment records.
The McLink organization remains the existing organization; adding a client does
not copy McLink's recruitment records into that client.

The organization and user setup is informationally separate from candidate
records: an organization administrator can manage users and access, while HR
handles roles, screening, applicants, and interviews. If a menu item is missing,
the account's permissions or active status should be checked.

## What the User Accounts permissions mean

- **Create role requests** lets the user submit staffing requests.
- **Review role requests** gives company-wide HR operational access, including
  Recruitment Setup, applicant review, and interview operations.
- **Review own department only** gives HOD-style read-only visibility for the
  user's department, plus interview participation where enabled.
- **Approve role requests and hiring decisions** permits the approval or rejection
  actions assigned to that account.
- **Edit settings** permits authorized portal settings changes.
- **Manage user accounts and roles** permits adding, editing, activating, and
  deactivating accounts within the user's organization.

Changing an access role applies the portal's recommended permissions, which an
administrator can then adjust. Access changes affect future requests and page
visibility; they do not delete recruitment history.

## How to create a role requisition (role request)

A role request is used when a team needs an additional employee or a replacement.
The quickest way is to paste or upload the job description and let Smile fill in the
form.

Steps:

1. Open **Role Requests**, then select **Create Role Request**.
2. Upload a PDF, DOC or DOCX, or paste the job description text, then choose
   **Populate from a job description**. Smile fills in the role details, the reason,
   the screening criteria, the scoring areas, the interview questions and the voice
   instructions. Always read the result and correct anything that is wrong.
3. Check the role details: request type, department, employment type, job title,
   number of vacancies and target hiring date. For a replacement, name the employee
   or position being replaced.
4. Check the screening and interview section: the screening criteria (what Smile
   should score or note), optional scoring areas, up to five interview questions and
   Smile's voice instructions.
5. Submit. Your name and email are filled in from your signed-in account and cannot
   be changed in the form.

What you see depends on your access. HR users who can create and approve see
**Create role**, which saves the screening and interview setup, approves the role,
and makes its Smile application link available in one action. **Save as draft**
keeps it private so it can be finished later. Other users see **Submit for HR
approval**, and HR then reviews the request.

HR sets salary visibility (and the range if it will be disclosed), license or
certificate requirements, and the face-to-face interview and venue in the same
Create Role form. Selecting LinkedIn, Facebook, or JobStreet is no longer
required; the role can be shared using its Smile application link.

The form saves a draft automatically while you work on a new request. When you edit
an approved or submitted request, change what you need and select **Save role
request**; that button is greyed out until something has changed. A saved draft is
not a submitted request and does not publish a job. When a role is published, the
organisation's owner receives a "new role posted" email.

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

The usual request flow is: the requester submits → **Pending HR Discussion** →
HR reviews the request and approves, returns, holds, or rejects it. When an HR
approver creates a role with the full Create Role form, Smile saves its setup and
publishes the application link in that same action. Other requesters may need HR
to complete the role details and publish it after approval. Historical records
may still show a management approval status. Management is view-only for
operational recruitment tools: it does not edit setup, screen resumes, schedule
interviews, or change applicant records.

External job-board choices are optional. The Smile application link is enough for
candidates to apply through the portal.

---

## What the role request statuses mean

- **Draft** — still being prepared. Complete and submit it.
- **Pending HR Discussion** — HR needs to review the request and discuss any
  changes.
- **Pending Management Approval** — a historical or organisation-specific status
  where Management must decide. If it appears unexpectedly, ask the
  administrator to confirm the workflow configuration.
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

## How to review role setup after creation

HR-created roles are configured in the Create Role form. The role details page
remains available to HR reviewers for updating screening and interview settings
after creation; it is not a separate required publishing step.

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

Optional external posting channels: LinkedIn, Facebook, and JobStreet are
optional. The role's Smile application link remains available without selecting
an external job board. Set salary visibility, license requirements, and
face-to-face interview details in Create Role; HR can update them from role
details later.

Choosing the interviewer: when a face-to-face interview is required, an
**Interviewer** picker lists the people in your organisation who have connected
their own Google Calendar. Choose one and that role's interviews are created on
that person's calendar, with only their free times offered to candidates. If you
leave it empty, or the person has not connected a calendar, the shared HR calendar
is used, so booking never stops. People connect their own calendar from **Profile**
(**My Google Calendar**).

Everything you fill in is used: Smile uses every setup field when it screens resumes
and when it interviews by phone or on video (screening criteria, keywords, minimum
experience, transferable skills, license requirement, scoring areas and your
interview questions). Salary is kept confidential unless you choose Disclosed. On
an applicant's record, **How AI Graded This Applicant** shows exactly which settings
were applied.

Save and move the role forward:

- **Save** — save changes and keep working.
- **Mark as Recruitment Ready** — the basic screening and interview information is
  complete.
- **Mark as Ready for Publishing** — the publishing checklist is complete and HR
  has reviewed it.
- **Publish Role** — the role is ready to appear for candidates.

Read the script preview before saving — it shows the kind of conversation
candidates will receive. If a button says required fields are missing, the message lists them.
Complete those fields, or choose the explicit "Not disclosed" / "Not required"
option, then try again.

---

## How resume screening works

When a candidate applies to a published role, the portal records the application
as a new application, extracts the resume text, runs an automated AI CV
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

The AI result is advisory. It compares the resume with the selected role's job
description, screening criteria, keywords, experience requirement, transferable
skills, and license or certificate requirement. A score is not an approval or
rejection. HR must review the evidence and record the decision.

## The three HR ways to screen resumes

From **Resume Screening**, HR can choose one of three intake options:

1. **Upload from your computer** — select up to {{BULK_FILE_LIMIT}} PDF, DOC, or
   DOCX resumes for one published role and start screening.
2. **Import from Google Drive** — connect Google Drive, choose files from the
   folder browser, and import them for the selected published role.
3. **Import from OneDrive** — connect OneDrive and choose files from the folder
   browser. This option is shown only after the Microsoft Entra setup is complete.

All three options use the same screening queue, duplicate detection, status
updates, and credit rules. A duplicate for the same role is skipped and is not
charged. A successful screening is charged once; a failed or invalid file is not
charged. Candidates can also submit one resume through an application page, but
that is a separate candidate-intake route rather than a fourth HR bulk option.

The single-resume form (**CV Analysis**, at the bottom of Resume Screening) runs the
billing CV screening when HR completes the form and selects **Start CV Analysis**.
The application is queued first and 1 credit is used when the screening result is
successfully saved. Failed or invalid screening is not charged.

Contact number: choose the candidate's country first. The box shows an example
number for that country and how to type it (without the country code and without a
leading 0). A leading 0 or a country code that is typed anyway is removed, and the
number is checked before saving. The same applies when editing an applicant and when
a candidate books a voice interview.

---

## How bulk resume upload works

HR can screen a group of resumes for one published role from **Resume Screening**.

Upload from your computer:

1. Choose the published role that matches every resume in the batch.
2. Add the files — drag them in or click the box. PDF, DOC, and DOCX are
   accepted, up to {{BULK_FILE_LIMIT}} files at a time, 10 MB per file.
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

Current launch limit: select no more than {{BULK_FILE_LIMIT}} files per bulk submission across
local upload, Google Drive, and OneDrive. This is the same limit enforced by
the portal's upload, Drive, and OneDrive controls.

If your team uses the shared Google Drive resume folder, first connect Google
Drive (HR uses "Connect Google Drive"; this uses a read-only permission). Then in
**Resume Screening**, choose the role first and select **Upload from Google
Drive**.

Put each resume inside the correct role and month folder. Do not put resumes
directly in the role's top-level folder. From there the files go through the same
screening queue as a computer upload (Queued → Processing → Completed / Screened,
with Skipped and Failed as above).

## How OneDrive import works

OneDrive is the third cloud option for HR resume screening. It uses a separate
Microsoft 365 connection and read-only file access; it does not use Google Drive
credentials. In **Resume Screening**, select **Connect OneDrive**, complete the
Microsoft sign-in, then choose **Choose from OneDrive** and import the files for a
published role. The same {{BULK_FILE_LIMIT}}-file limit, 10 MB limit, accepted file types, queue,
duplicate handling, statuses, and one-credit-per-successful-file rule apply.

If the OneDrive buttons are hidden, Microsoft Entra configuration has not been
completed or the connection is not available. Ask the portal administrator to
finish the setup or reconnect it. Do not upload the same files repeatedly while
waiting for a cloud connection.

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

At the scheduled time Smile places the AI voice call, then records the transcript
and a structured interview result on the applicant's record for HR to review.

Which number calls the candidate: candidates in the Philippines (+63) are called from
a Philippine number and candidates in Malaysia (+60) from a Malaysian number, which
they are more likely to answer. Everyone else is called from the Singapore number.

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

## How HR reviews voice and Live Avatar interview results

Candidates can choose **Schedule a Call** for a voice interview or choose the
**Live Avatar Interview** link. When an interview result is ready, the applicant
record shows **Voice Interview Review** for a call or **Avatar Interview
Review** for a Live Avatar interview. HR opens the applicant record and reviews
the matching interview evidence alongside the resume and screening result; the
Live Avatar evidence section is titled **Live Avatar Review**.

The **Live Avatar Review** shows the transcript, the scores and strengths, and the
recording. The **Interview with our Avatar now** interview costs 20 Smile Credits,
reserved when the candidate starts it (released again if it cannot start), lasts up
to about five minutes, and asks the role's interview questions. Candidates agree to
the recording, camera and microphone first; if they do not agree the interview does
not start. Recordings are deleted automatically 90 days after the interview; the
transcript and review are kept.

**How AI Graded This Applicant** on the applicant record explains a result in plain
language: the score, the recommendation, **Strengths** and **Areas To Review**, and
every role setting Smile applied (screening criteria, keywords, license
requirement, minimum experience, transferable skills, salary handling, start
availability). The interview review lists all of the role's interview questions with
the candidate's answers. The Candidate Status History lists each change with who made
it; steps the portal takes on its own show as **Automatic update**.

HR then records an explicit decision. Approval moves the candidate to
**Approved for Face-to-Face Interview** and generates the HR interview booking
invitation. A rejection stops the candidate at this stage. As with resume
screening, the AI result is evidence for a human decision, not the decision
itself.

---

## How final / face-to-face (F2F) interview booking works

When HR approves a candidate after the voice interview, the portal sends an HR
interview booking invitation with a new private link. The candidate chooses from
the available times, which come from the calendar of the interviewer chosen for the
role, or from the shared HR Google Calendar configured in Settings when no
interviewer was chosen. The booking status on the applicant record updates by itself
within moments of the candidate booking.

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

## How to edit the automated emails

Users with the Edit settings permission open **Settings** and use **Automated Emails**.
The emails that can be edited are the **AI Voice Interview Invitation**, the **AI Voice
Interview Confirmation** and **New Role Posted**.

1. Pick the email from the list on the left. "Edited" marks one that has been changed.
2. Change the **Subject** and the **Message**. Use the **Insert** buttons to add
   details such as the candidate name or company name where the cursor is; they are
   filled in for each person when the email is sent. A line whose detail is empty
   (for example the interview time on an invitation) is left out.
3. Change the **Button text** for emails that have buttons. Where a button leads is set
   by the portal and cannot be changed, so a link can never break. Leave the box empty
   to keep the standard text.
4. Optionally add a **Header image**: a public link that starts with https:// and ends
   in .png, .jpg or .gif, about 600 pixels wide, with a short description that shows if
   the image cannot load. The image is linked, not attached, so it must stay online.
5. Check the preview (it uses sample details) and select **Save Email**. **Restore
   Original** puts the standard wording back and **Discard Changes** drops edits that
   have not been saved.

Edits apply to emails sent from then on, usually within about five minutes; emails
already sent do not change. The closing lines ("Kind regards, [organisation name]
Recruitment Team") are added automatically using the organisation name from
Organization branding. Keep the AI interview notice in the voice-interview emails:
candidates must be told that an AI conducts the interview. The characters < and >
cannot be used. Emails are sent from the portal's email account.

## Privacy and how long information is kept

Applicants tick a required box to agree to the Privacy Notice when they apply, and
before a Live Avatar interview they agree to the recording, camera and microphone.
Resume files are deleted automatically 30 days after upload. Interview recordings are
deleted automatically 90 days after the interview (an administrator can set a
different period). Application records, transcripts and results are kept until the
application is deleted; deleting an applicant removes everything held about them.

---

## What the applicant stages mean

- **Resume Review** — the resume has been received and needs a human review.
- **Resume Approved** — the candidate can choose **Schedule a Call** or a
  **Live Avatar Interview**.
- **Interview Choice Pending** — the invitation is ready, but the candidate
  has not chosen between a call and a Live Avatar interview yet.
- **Voice Interview Booking Pending** — the candidate has the secure link to
  choose a time for a call.
- **Voice Interview Scheduled** — the call interview has a confirmed time.
- **Voice Interview Review** — the call result is ready for HR to review.
- **Live Avatar Interview Pending** — the candidate chose the Live Avatar
  option and is waiting to begin; no calendar slot is required.
- **Live Avatar Review** — the Live Avatar result is ready for HR to review.
- **Approved for Face-to-Face Interview** — the candidate can choose a
  face-to-face interview time.
- **Face-to-Face Interview Scheduled** — a face-to-face interview time has been
  booked.
- **Passed Face-to-Face Interview** — the candidate passed the face-to-face step.
- **Rejected** — the candidate will not move to the next step.

---

## How credits work (Smile Credits)

Smile Credits are the portal's usage allowance for AI-assisted recruitment work,
such as automated CV screening and AI voice interviews. The current balance is
shown in the sidebar (the Smile Credits meter) and on the Smile Credits panel.

Current usage costs are:

- **1 credit** per successfully screened resume / AI CV analysis.
- **10 credits** for a completed AI voice interview.
- **8 credits** when an AI voice interview is connected but incomplete.
- **5 credits** when the candidate does not answer.
- **20 credits** for an Interview with Smile on video (the Live Avatar interview),
  reserved when the interview starts.

Booking a time, creating a role request, commenting, and ordinary portal actions
do not consume credits. A duplicate resume for the same role is skipped and is
not charged. Failed or invalid resume screening is not charged.

Each AI-assisted action draws down the balance — for example screening a resume or
running an AI voice interview consumes credits. When the balance runs low, ask
the portal administrator or HR operations to review the top-up; if credits run
out, AI-assisted steps may be blocked until the balance is restored. Ordinary
portal actions like creating a role request, commenting, or booking do not consume
credits. For exact per-action costs and your current allowance, check the Smile
Credits panel or contact the portal administrator.

---

## Who can access what: HR, Management, HOD, and Creator

The portal shows only the actions a person is allowed to use. Access is built from
explicit permissions: submit and track role requests; review HR setup and
applicants and manage interview operations; approve or reject management-stage
decisions; edit portal settings; manage user accounts; and manage Smile Credits.

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
- **Administrator / HR access administrator** — manages user accounts and
  permissions and, where authorized, shared settings and the interview calendar
  connection. The Admin starting preset is for Smile Credits only; HR grants any
  additional capabilities explicitly.

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

**"The role was approved but candidates cannot apply."** Check that the role
status is **Job Posted** and that its Smile application link is available. HR can
finish publishing from the role details page if it was submitted for approval
without the full Create Role form.

**"A resume failed to screen."** Make sure it is a readable, unlocked PDF, DOC, or
DOCX no larger than 10 MB, then use the retry option. If it still fails, ask HR to
check the file or enter the candidate another way. Failed or invalid screening is
not charged.

**"What are the three ways to screen resumes?"** From **Resume Screening**, HR can
upload from a computer, import from Google Drive, or import from OneDrive when it
is configured. These use the same queue and credit rules. A candidate application
with one attached resume is a separate intake route.

**"What does the screening score mean?"** It is an automated comparison with the
selected role's criteria and resume evidence. It helps HR prioritize review; it is
not a hiring decision. Open the applicant record to review the score, summary,
strengths, gaps, and interview questions, then make the human decision.

**"The calendar shows no times."** Check the role and interview-type filters,
choose the correct month, and refresh. If there are still none, ask the calendar
administrator to check the shared HR calendar.

**"The page says someone else changed the record" / "HTTP 409".** Refresh the
page, read the latest information, then try again. This prevents one person's
changes from overwriting another's.

**"Candidates are not receiving emails."** Look at the **Confirm email delivery** step on
the Dashboard: it shows whether email is switched on and whether any failed. If email is
off or failing, ask the portal administrator. Check that the candidate's address is right
in Applicants. Emails go out within a few minutes.

**"I want to change the wording of an email."** Open Settings and use **Automated
Emails**. If you do not see Settings, ask HR for the Edit settings permission.

**"I cannot save a change to a role request."** Open the role, choose **Edit**, make the
change and select **Save role request**. The button is greyed out until something has
changed.

**"Something says it is not available right now" or "Unable to load role requests."**
This is a problem on the portal's side, not something you did. Try again in a minute; if
it keeps happening, report it to the portal administrator with the time and what you were
doing.

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
