# McLink Group Recruitment Portal

## User Requirements Study and Approval

**Document status:** For CEO review and approval  
**Version:** 1.1

**Date:** 27 August 2026  
**Prepared for:** McLink Group  
**Prepared by:** Recruitment Portal Project Team

## 1. Purpose

This document defines the business, user, functional, security, and operational
requirements for the McLink Group Recruitment Portal. It is intended to create
a shared baseline for implementation, testing, deployment, and future change
requests.

CEO approval confirms that the requirements and priorities below represent the
intended recruitment operating model for the current release.

## 2. Business objectives

The portal shall:

1. Standardize recruitment activity from role request through interview stages.
2. Reduce manual handling of job descriptions, resumes, candidate records, and
   interview scheduling.
3. Give HR and management timely visibility of recruitment status and actions.
4. Protect candidate and company information through authenticated access,
   role-based permissions, secure links, and server-side validation.
5. Use AI to assist with resume screening and voice interviews while keeping
   recruitment decisions under authorized human control.
6. Provide a traceable record of important recruitment decisions, messages,
   bookings, and status changes.

## 3. Stakeholders and users

| User | Primary responsibilities | Required access |
| --- | --- | --- |
| HR / Recruiter | Create roles, complete recruitment setup, review candidates, manage interviews | Create, review, and operate recruitment workflows |
| Hiring manager / HOD | Provide role information and participate in review or interviews | Access according to assigned permissions |
| Administrator | Manage users, settings, integrations, and access | Full administrative access |
| Candidate | Apply, receive interview instructions, book an authorized slot, and attend interviews | Tokenized candidate links only |

Access shall be granted through the maintained user directory and shall not be
based solely on a matching email domain.

## 4. Scope

### In scope

- Authenticated internal recruitment dashboard.
- Role creation, status management, approvals, and recruitment setup.
- Structured job description, screening criteria, and interview-question data.
- Candidate application and resume intake.
- Bulk resume processing and AI-assisted screening.
- AI voice-interview booking, scheduled calling, results, and HR review.
- Human final-interview scheduling and shared calendar integration.
- Candidate email notifications and booking confirmations.
- Google Sheets and n8n workflow integration.
- User permissions, operational safeguards, and documentation.

### Out of scope for this release

- Automatic hiring or rejection decisions without human approval.
- Payroll, onboarding, employee-record, or performance-management functions.
- Public access to internal recruitment screens or internal data.
- A general-purpose external job board.
- Replacement of the company’s authoritative HR or finance systems.

## 5. End-to-end user requirements

### UR-01: Secure access

The system shall require authenticated, authorized access for internal users.
Unauthenticated visitors shall not be able to open internal dashboards, APIs,
candidate records, or administrative functions. Candidate-facing actions shall
require a valid, purpose-specific invitation or booking token.

### UR-02: Role request and approval

Authorized users shall be able to submit a staff addition or replacement role
request. The system shall assign a unique role identifier, validate required
fields, record the creator, and support discussion, return, hold, approval, and
rejection status changes.

### UR-03: Recruitment setup

Authorized HR users shall be able to maintain the job description, screening
criteria, salary and experience requirements, license requirements, and initial
interview questions. The system shall prevent publication until the required
setup fields and applicable interview choices are complete.

All mandatory recruitment-setup fields, screening criteria, interview
questions, prompts, and evaluation instructions shall be reviewed and validated
for discriminatory, exclusionary, or otherwise unlawful language before they
can be published or used by an AI workflow. The system shall identify and block
criteria based on protected or irrelevant personal characteristics, including
age, gender, race, ethnicity, nationality, religion, disability, medical
history, family status, appearance, accent, location, or economic background,
unless a lawful, documented, job-related exception has been approved through
the required legal or compliance process.

### UR-04: Candidate and resume intake

The system shall accept candidate details and resume files through a controlled
candidate experience. It shall validate file type and required details, create
an application identity, and prevent duplicate processing of the same completed
resume for the same role.

### UR-05: AI-assisted screening

The system shall submit eligible resumes to the configured screening workflow,
store structured screening results, and show HR the evidence used for review.
AI screening shall be treated as decision support and shall not make a final
hiring decision on behalf of McLink Group.

AI screening prompts, criteria, mandatory fields, scoring rubrics, and output
fields shall not contain language or rules that directly or indirectly
discriminate against candidates. Screening shall use only consistent,
job-related evidence and shall not request, infer, score, or rely on protected
characteristics or proxies for protected characteristics. The system shall
reject or flag discriminatory instructions before an AI screening workflow is
executed, and HR shall be able to review the criteria and evidence supporting
each result.

### UR-06: AI voice-interview invitation and booking

When a candidate is approved for an AI voice interview, the system shall send a
secure booking invitation containing an expiring booking link. Candidates shall
see only valid available slots and shall receive a confirmation after a booking
is successfully reserved.

The invitation and confirmation emails shall contain this exact notice:

> AI Interview Notice: This interview will be conducted with the assistance of
> an AI interviewing system, which may record, transcribe and assess your
> responses against job-related criteria. Any information or responses
> generated, transcribed, summarized, or communicated by the AI may be
> inaccurate, incomplete, misleading, or inconsistent with the candidate's
> actual statements or qualifications. AI output is not verified and must not
> be relied upon as an official statement, representation, commitment, promise,
> or offer by McLink Group. The candidate remains responsible for the accuracy
> of information submitted or communicated and must not misrepresent their
> identity, qualifications, experience, or responses. McLink Group does not
> accept responsibility for decisions or actions based on unverified AI output,
> and only an authorized McLink Group representative may make or confirm an
> official employment-related statement or offer in writing.

The same disclaimer shall be communicated clearly at the start of every AI
phone interview and, where technically supported, repeated before the call
ends. The disclaimer shall explain that AI-generated questions, transcripts,
summaries, and assessments may contain errors or hallucinations, and that they
do not create any representation, commitment, promise, or offer on behalf of
McLink Group.

### UR-07: Interview scheduling and capacity

The system shall validate slot availability at the time of booking, prevent
expired or reused tokens, apply the configured capacity rules, record the
candidate’s timezone and contact number, and create the corresponding call
queue record.

### UR-08: Voice interview execution and review

The configured AI voice service shall receive only the information required to
conduct the interview. The system shall record the provider status, transcript,
structured result, and processing errors where available. HR shall be able to
review the interview evidence and record an authorized human decision.

AI phone interviews shall use only approved, job-related questions and
evaluation criteria and shall not solicit or infer discriminatory information.
The system shall preserve the disclaimer presented to the candidate and shall
clearly identify AI-generated questions, transcripts, summaries, and results as
unverified decision-support content. No AI phone-interview output shall be
treated as an official statement or employment commitment by McLink Group, and
all consequential decisions shall remain subject to authorized human review.

### UR-09: Human final interview

Where the candidate proceeds to a final interview, the system shall provide a
secure booking link, validate the selected slot, and synchronize the booking
with the approved shared Google Calendar. Human interview invitations shall be
clearly distinguished from AI voice-interview communications.

### UR-10: Notifications

The system shall send relevant candidate and internal notifications for booking,
confirmation, workflow errors, and configured recruitment status events. Failed
notifications shall be visible to authorized HR users and retryable where safe.

### UR-11: Auditability and data integrity

The system shall preserve application and role identifiers, timestamps, status
history, processing state, booking state, and the identity of authorized users
performing material actions. Partial failures shall not silently appear as
successful recruitment actions.

## 6. Non-functional requirements

### Security and privacy

- Production traffic shall use HTTPS.
- Session cookies, webhook secrets, API credentials, and provider tokens shall
  remain server-side and shall not be exposed in browser code or source control.
- Every protected page and API shall enforce authorization on the server.
- Access shall follow least privilege and be reviewed when a user changes role
  or leaves the organization.
- Candidate links and booking tokens shall be unguessable, purpose-specific,
  time-limited, and single-use where applicable.
- Resume files, transcripts, and candidate data shall be accessible only to
  authorized users and approved service integrations.
- Logs and error messages shall avoid unnecessary personal or credential data.

### Usability

- The portal shall be usable on current desktop and mobile browsers.
- Forms shall identify required fields and provide understandable validation
  messages.
- Destructive or irreversible actions shall require clear confirmation.
- Candidate emails shall display correctly on common email clients and provide
  clear next steps.

### Reliability and operations

- Integrations shall use explicit contracts, validation, retry rules, and
  recoverable error states.
- The system shall provide operational documentation for deployment, testing,
  migration, troubleshooting, and access administration.
- Changes shall be tested before production release and the production version
  shall be identifiable.

## 7. Integrations and authoritative data

The current operating model uses:

- Next.js for the portal interface and server-side API routes.
- Google login and the maintained user directory for internal access.
- Google Sheets for configured recruitment records and workflow state.
- n8n for recruitment automation, notifications, and external workflow steps.
- An approved AI voice provider for scheduled calls and interview results.
- Google Calendar for human final-interview scheduling.

Each integration shall have a documented owner, credential owner, failure mode,
and recovery procedure. Server-generated identifiers and state transitions shall
remain authoritative over values supplied by the browser or automation client.

## 8. Acceptance criteria

The release shall be considered acceptable when:

1. An unauthorized user cannot access internal pages, APIs, candidate records,
   or settings.
2. An authorized HR user can create, configure, submit, review, and progress a
   role through the approved workflow.
3. A candidate can complete an authorized application and, where approved,
   book a valid AI voice-interview slot exactly once.
4. Booking invitation and confirmation emails contain the approved AI notice
   without paraphrasing or omission, and the AI phone interview communicates the
   approved disclaimer at the required points.
5. Expired, invalid, reused, over-capacity, or unauthorized booking requests
   are rejected safely.
6. HR can review screening and voice-interview evidence before recording a
   human decision.
7. Mandatory recruitment fields, screening criteria, prompts, interview
   questions, and evaluation fields are blocked or flagged when they contain
   discriminatory or irrelevant criteria.
8. Human final-interview bookings are validated and reflected in the shared
   calendar where configured.
9. Integration failures are visible, do not falsely report success, and can be
   recovered using the documented process.
10. Security, contract, workflow, and browser smoke tests pass for the release.

## 9. Implementation roadmap and release plan

The following phase-by-phase timeline is the delivery plan associated with this
requirements baseline. Dates are target dates and may be adjusted through the
change-control process. A phase is complete only when its stated exit criteria
are met and no unresolved critical regression prevents progression.

### Phase 1 — Critical QC fixes and core workflow

**Target:** 26–28 August 2026

**Objective:** Close the major functional blockers so the core recruitment flow
is stable.

| Date | Task | Owner | Deliverable |
| --- | --- | --- | --- |
| 26 Aug | Fix post-screening notifications | Julio | HR and candidate notifications trigger automatically after screening |
| 26 Aug | Add F2F interview venue/address | Julio | Interview email includes physical address, room, and arrival details |
| 26–27 Aug | Fix Ella interview summary misattribution | Julio | Candidate answers map to the proper interview question |
| 26–27 Aug | Remove Management approval | Julio | Simplified workflow without a Management approval dependency |
| 27–28 Aug | Implement credit-based pricing | Julio | Credit wallet, deductions, balance checking, and discount logic |
| 27–28 Aug | Implement candidate no-show lifecycle | Julio | Attempt 1–3 retry flow and final handling |
| 28 Aug | Quick regression test | Julio + QA | Core features retested after changes |

**Phase exit criteria:** Post-screening alerts work; F2F invitations contain
complete venue information; Ella summary mapping is resolved; Management
approval is removed without breaking the workflow; the credit-system MVP and
no-show/three-attempt lifecycle are functional; and no new P0 regression issues
exist. The first four items directly address the functional and AI workflow
blockers identified by QC.

### Phase 2 — Backend and performance improvement

**Target:** 27–31 August 2026

**Objective:** Reduce system latency and prepare the backend for new
integrations.

| Date | Task | Owner | Deliverable |
| --- | --- | --- | --- |
| 27–28 Aug | Review Google Sheets dependencies | July | Identify critical tables/processes to migrate |
| 28–30 Aug | Create target database structure | July | Database schema for users, jobs, candidates, screening, and interview data |
| 29–31 Aug | Migrate critical backend processes | July | Critical read/write processes moved away from Google Sheets |
| 29–31 Aug | Optimize n8n execution | July + Julio | Long-running workflows reduced or moved to asynchronous processing |
| 31 Aug | Performance verification | July + Julio | Compare response time against the current workflow |

**Phase exit criteria:** Critical backend operations no longer depend fully on
Google Sheets; n8n workflows do not unnecessarily block the frontend;
screening, parsing, and notification latency is improved; and existing records
remain intact. The QC report identifies synchronous n8n execution as a
performance and reliability failure.

### Phase 3 — Cloud resume-upload integration

**Target:** 29 August–2 September 2026

**Objective:** Allow large resume batches to enter Ella without relying only on
manual local uploads.

**Google Drive — 29 August–1 September**

- Configure Google Drive access and authentication.
- Add file selection and multiple-resume selection.
- Import selected files into Ella and push them into the existing screening queue.
- Preserve filename and source metadata.
- Add duplicate detection, batch progress, and failure handling.

**OneDrive — 31 August–2 September**

- Configure Microsoft/OneDrive authentication.
- Add multi-file selection and connect selected files to the same screening pipeline.
- Add permission handling, failure handling, duplicate protection, and batch status.

**Owner:** Julio + July

**Phase exit criteria:** Both Drive and OneDrive can import multiple resumes;
imported files enter the same screening process as normal uploads; duplicate
screening jobs are prevented; and failed files can be identified without
stopping the whole batch.

### Phase 4 — Documentation and AI support

**Target:** 29 August–2 September 2026

**Objective:** Produce client documentation and use it as the knowledge base
for an in-system support assistant.

**User manual — Owner: Julio — 29 August–2 September**

The manual shall cover the system overview, HOD workflow, HR workflow,
candidate flow, CV screening, AI phone interview, interview scheduling, credit
system, bulk upload, and troubleshooting.

**AI support bot — Owner: July — 1–2 September**

Build the support assistant, connect it to the approved documentation, enable
operational questions, provide step-by-step instructions, and add a fallback
when information is unavailable.

**Knowledge base — Owner: July — 2 September**

Upload the finalized user manual, index the documentation, test document
retrieval, and validate answers against the actual guide.

**Phase exit criteria:** A client-ready manual exists; the support bot retrieves
answers from the manual; and bot answers are grounded in approved system
documentation.

### Phase 5 — Hosting and batch-capacity validation

**Target:** 1–2 September 2026

**Owner:** Julio

**Objective:** Determine whether direct GoDaddy uploads support large batches
and define a safe upload limit.

The validation shall review the GoDaddy upload configuration, individual file
and request-size limits, timeout and memory limits, progressively larger batch
tests, processing time, and the failure threshold. It shall compare direct
uploads with Drive and OneDrive uploads and document the recommended maximum
direct batch size.

### Phase 6 — Ella AI-scoring validation

**Target:** 2–3 September 2026

**Owner:** Julio + HR/QA

**Objective:** Validate Ella’s AI evaluation against the actual HR scoring
standard.

Representative candidate examples shall be manually scored by HR and run
through Ella. The results shall be compared, material scoring differences
identified, scoring prompts or logic tuned where necessary, and the benchmark
rerun and documented.

**Phase exit criteria:** Ella scoring has been formally compared with HR’s
rubric; material discrepancies are corrected or documented; and QA/HR accepts
the results for UAT. This closes the scoring-benchmark item pending in the QC
report.

### Phase 7 — Full regression testing

**Target:** 3 September 2026

**Owner:** Development + QA

The complete system shall be tested across login/SSO, RBAC, job and role
creation, the simplified approval flow, resume upload, Google Drive and
OneDrive import, single and bulk screening, post-screening notifications,
credit deductions and insufficient-credit handling, interview booking, F2F
invitation, AI phone interview, missed-call handling, the three-attempt
lifecycle, transcript generation, Ella summary, AI scoring, database
operations, n8n performance, form persistence, and error handling.

**Exit criterion:** No unresolved critical regression defects.

### Phase 8 — Formal QC retest

**Target:** 4 September 2026

**Owner:** QA + Development

QC shall specifically retest the six original open items:

- Post-screening notifications.
- F2F interview address.
- Ella summary misattribution.
- Applicant no-show handling.
- n8n/system latency.
- Ella scoring accuracy.

The QC report currently blocks Code Freeze until remaining material issues are
corrected and retested.

**Exit criterion:** Original blockers are cleared or formally accepted.

### Phase 9 — Critical fix window and Code Freeze

**Target:** 5 September 2026

**Owner:** Julio + July + QA

Only critical issues found during the QC retest shall be fixed. The affected
test cases shall be rerun, no P0/P1 blockers shall remain open, and the final
release candidate shall be tagged.

**Code Freeze — 5 September:** After this point there shall be no new features
or workflow redesign; only critical defect fixes are permitted.

### Phase 10 — Formal UAT

**Target:** 6–7 September 2026

**Owner:** HR + QA + Development

UAT shall cover the following user and system scenarios:

- **HOD:** Create a role/job, submit requirements, and follow the simplified workflow.
- **HR:** Review roles and applications, perform screening, review Ella scoring, and arrange interviews.
- **Candidate:** Application, screening, notification, booking, AI interview, and missed-call/retry scenarios.
- **System:** Credit usage, notifications, upload integrations, support bot, and database performance.

**Exit criterion:** Formal UAT sign-off.

### Phase 11 — Production readiness

**Target:** 8 September 2026

**Owner:** Development team

Before production deployment, the team shall confirm that UAT issues are
closed; production configuration, database, and n8n workflows are verified;
credit rules and notification credentials are verified; Drive and OneDrive
integration is verified; backup and rollback procedures are confirmed; and
documentation is finalized.

### Final milestone summary

| Milestone | Target |
| --- | --- |
| Core QC, workflow, and credits complete | 28 Aug 2026 |
| Backend/performance improvement complete | 31 Aug 2026 |
| Cloud upload, documentation, and support bot complete | 2 Sep 2026 |
| AI validation and full regression | 3 Sep 2026 |
| QC retest | 4 Sep 2026 |
| Code Freeze | 5 Sep 2026 |
| Formal UAT | 6–7 Sep 2026 |
| Production ready | 8 Sep 2026 |

The development sequence is: **Fix Core → Stabilize Backend → Add Integrations
→ Validate AI → Regression → QC → Freeze → UAT → Production.**

## 10. Assumptions and decisions requiring confirmation

- McLink Group will nominate an owner for the portal, Google Workspace access,
  Google Sheets, n8n, AI voice provider, and shared calendar.
- HR will define the retention period and deletion process for resumes,
  transcripts, and candidate records.
- HR and management will confirm the final access role assignments before broad
  internal rollout.
- Any change to automated screening, interview questions, candidate messaging,
  or AI data handling will be reviewed and approved before release.
- Legal or privacy review will be obtained where required by the jurisdictions
  in which candidates are recruited.

## 11. Approval and sign-off

By signing below, the CEO confirms that this User Requirements Study is an
approved baseline for the McLink Group Recruitment Portal. Changes to these
requirements after approval shall be recorded, assessed for impact, and
approved through the company’s change-control process.

**CEO name:** ______________________________________________

**Signature:** ______________________________________________

**Date:** __________________________________________________

**Comments or conditions of approval:**

______________________________________________________________________________

______________________________________________________________________________

______________________________________________________________________________
