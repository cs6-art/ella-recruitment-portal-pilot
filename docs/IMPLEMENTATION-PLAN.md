# McLink Recruitment Portal & HR Resume Screener — Implementation Plan

This is the goal and roadmap for the project, as set by leadership. Four
weekly phases take the system from a stabilized demo through a complete
internal recruitment workflow: role request → AI resume screening → AI
phone interview → HR decisions → final HOD interview scheduling.

---

## Week 1 — Version 1 Stabilization and Quality Validation
**July 20–24, 2026**

### Main product development
Maintain the working Version 1 demo:
- Candidate submits or uploads a resume
- Candidate is linked to a selected role
- AI Ella screens the resume
- AI generates: match score, candidate summary, strengths and gaps,
  recommendation, interview questions
- Screening results are stored correctly
- Basic AI phone interview remains functional
- Secure login and initial role-based permissions remain stable

### AI prompt improvement
Update the AI interview prompt to:
- Ask or confirm the candidate's preferred mobile number
- Offer several interview-date options
- Avoid automatically scheduling during the closing
- Ask whether the candidate has any final questions
- Close the interview politely
- Remove the previous five-minute restriction
- Set a hard maximum interview duration of 20 minutes
- Add a wrap-up instruction before the maximum duration
- Add multilingual fallback instructions
- Improve response depth for role-specific and technical questions

### Prompt testing and validation
Test the prompts against multiple situations: strong candidate, weak
candidate, candidate with incomplete experience, candidate with
transferable skills, candidate with unrealistic salary expectations,
candidate who switches language, candidate who gives a wrong phone number,
candidate who asks unrelated questions, candidate who gives very short or
very long answers, candidate who interrupts or does not respond, candidate
who wants to reschedule, candidate who asks about confidential company
information.

Validate:
- Questions are asked correctly
- AI does not invent company policies
- Recommendations match the candidate evidence
- Scoring is consistent
- AI does not skip required questions
- AI does not exceed the interview limit
- Closing sequence works
- Multilingual fallback is polite
- Transcript and recommendation are saved correctly

### Presentation preparation
- Record the full demo video
- Prepare test candidates and test roles
- Verify Philippine and Singapore calling behavior
- Prepare a fallback demonstration path in case live calling fails

### Week 1 deliverable
A stabilized Version 1 demo with tested resume screening, improved AI
interview behavior, documented prompt-validation results, and a completed
presentation recording.

---

## Week 2 — Government Demo Version
**July 27–31, 2026**

### Main objective
Deliver a stable government-demo version of the recruitment portal.

### Demo workflow
Company user logs in → creates or selects a role → candidate applies or HR
uploads a resume → candidate is linked to the correct role → AI Ella
screens the resume → HR reviews the AI recommendation → HR approves or
rejects → candidate selects an interview schedule → candidate confirms a
mobile number → AI Ella conducts the interview → interview result is
returned to HR.

### Portal features for the demo
Secure company login, active-user verification, Google Sheets-based
permissions, basic role creation or role selection, centralized resume
upload, candidate application form, candidate-to-role linking, AI resume
screening, HR recommendation view, basic approve or reject action,
interview booking link, multiple available date options, preferred
phone-number collection, AI phone interview, interview summary and
recommendation, basic role and candidate status display.

### Prompt testing and validation
Before the demo: run full end-to-end tests, test the exact government-demo
candidate, test at least one approved and one rejected scenario, test
rescheduling, test invalid phone number handling, test language fallback,
test interview wrap-up, verify no sensitive values appear in logs, confirm
results return to the correct candidate.

### Controlled or simulated items
These may use manual triggers or prepared data for demo stability:
management approval, job posting, rejection email, final HOD interview,
some status updates, some email notifications.

### Week 2 deliverable
A stable government-demo version covering company login, role selection,
resume intake, AI screening, HR review, scheduling, mobile-number
collection, AI phone interview, and interview results.

---

## Week 3 — Version 2 Phase 1: Role Request to HR Assessment
**August 3–7, 2026**

### Steps 1–3: Role request and approval
HOD or Management submits a staff addition or replacement request.
Request includes: job title, department, vacancies, hiring reason, target
hiring date.

HR reviews and confirms: job responsibilities, skills, qualifications,
experience, salary range, role expectations, work arrangement.

Management can: approve, reject, return for revision, place on hold.

**Role templates:** HR can save approved role requirements as templates;
HR can create a new request from a saved template; historical requests
remain unchanged when a template is edited; system prompts and
HR-editable role instructions are clearly separated.

### Steps 4–5: Posting preparation and application routes
Support: direct candidate application, HR invitation using a role-specific
link, HR manual upload for referral / walk-in / agency / existing
database.

Collect: resume, contact details, preferred phone number, skills
assessment, role expectations, salary expectations, availability or
notice period, application source.

### Steps 6–7: AI screening and HR assessment
AI screens only against the selected approved role. AI recommendation is
sent to HR. HR can: approve for interview, reject, request manual review,
add comments. Rejection email is sent only after HR confirms the
decision.

**Audit history** records: previous status, new status, action taken,
user who performed it, date and time, comments, rejection or return
reason.

### Prompt testing and validation
Test different role templates, validate role-specific scoring, test
candidate-to-role mismatch prevention, validate HR approve/reject
outcomes, test duplicate resume and duplicate candidate cases, verify
audit records are complete.

### Week 3 deliverable
Version 2 Phase 1 covering role requests, HR review, management approval,
role templates, three candidate-intake routes, AI screening, HR
assessment, rejection handling, and audit history.

---

## Week 4 — Version 2 Phase 2: AI Interview to Final HOD Interview
**August 10–14, 2026**

### Step 8: Interview invitation
Send invitation only after HR approval. Candidate selects from multiple
dates and times. Candidate confirms preferred phone number. Apply booking
rules. Support rescheduling. Record no-show status.

### Step 9: AI phone interview
Use the correct role-specific questions. Ask required questions exactly
as configured. Evaluate against defined criteria. Apply the 10-minute
maximum. Perform proper wrap-up and courtesy closing. Use multilingual
fallback when needed.

**Interview outputs:** transcript, recording URL, summary, evaluation by
criterion, strengths, concerns, recommendation, updated candidate score
where applicable.

### Step 10: HR final decision
HR reviews: resume-screening result, AI interview result, salary
expectations, availability, role fit, AI recommendation. HR can: approve
for HOD interview, reject, return for further review, add comments.

### Step 11: Final interview invitation
Candidate receives final interview booking link. Candidate selects a
schedule. HOD receives the interview details. Calendar event is created.
Final interview status is tracked.

### Prompt testing and validation
Test complete interview scripts for multiple roles, compare AI
evaluations across similar candidate answers, check scoring consistency,
test no-show and rescheduling scenarios, validate interview summary
accuracy, confirm rejection messages are appropriate, test HOD scheduling
and calendar creation.

### Week 4 deliverable
A complete internal recruitment workflow from role request through AI
resume screening, AI phone interview, HR final decision, and final HOD
interview scheduling.
