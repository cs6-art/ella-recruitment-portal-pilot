# McLink Group Recruitment Portal

## User Requirements Study and Approval

**Document status:** For CEO review and approval  
**Version:** 1.0  
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
| CEO / Management approver | Review and approve management-stage role decisions | Review and approve |
| HR / Recruiter | Create roles, complete recruitment setup, review candidates, manage interviews | Create, review, and operate recruitment workflows |
| Hiring manager / HOD | Provide role information and participate in review or interviews | Access according to assigned permissions |
| Interviewer | Conduct or review assigned interviews | Interview operations only |
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

### UR-06: AI voice-interview invitation and booking

When a candidate is approved for an AI voice interview, the system shall send a
secure booking invitation containing an expiring booking link. Candidates shall
see only valid available slots and shall receive a confirmation after a booking
is successfully reserved.

The invitation and confirmation emails shall contain this exact notice:

> AI Interview Notice: This interview will be conducted with the assistance of
> an AI interviewing system, which may record, transcribe and assess your
> responses against job-related criteria. Any information or responses
> generated by the AI should not be considered an official representation,
> commitment or offer by Mclink Group unless confirmed in writing by an
> authorized representative.

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
   without paraphrasing or omission.
5. Expired, invalid, reused, over-capacity, or unauthorized booking requests
   are rejected safely.
6. HR can review screening and voice-interview evidence before recording a
   human decision.
7. Human final-interview bookings are validated and reflected in the shared
   calendar where configured.
8. Integration failures are visible, do not falsely report success, and can be
   recovered using the documented process.
9. Security, contract, workflow, and browser smoke tests pass for the release.

## 9. Assumptions and decisions requiring confirmation

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

## 10. Approval and sign-off

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

