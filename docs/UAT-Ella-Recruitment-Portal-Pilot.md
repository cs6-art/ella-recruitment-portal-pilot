**User Acceptance Test (UAT)**

**Company name**  : McLink Group

**Project name**   : Ella Recruitment Portal — Pilot

**Platform**    : Next.js (Vercel), Neon Postgres, Google Sheets, n8n, Google Drive / OneDrive, Google Calendar, Gmail, Vapi (AI voice), HitPay

**Date**     : September 10, 2026

| # | Test Condition | Expected Result | Pass/Fail |
|---|---|---|---|
| 1 | Google Workspace Sign-In | Portal accepts a Google sign-in only for an active user in the allowed `@mclinkgroup.com` directory, issues an HTTP-only secure session cookie, and lands the user on the dashboard. | |
| 2 | Inactive / Foreign Account Rejection | An inactive, unlisted, or non-domain Google account is denied access and never receives a portal session. | |
| 3 | Unauthenticated Route Protection | A logged-out visitor hitting `/dashboard`, `/roles`, `/roles/new`, `/settings`, or `/profile` is redirected to the login page with no data exposed. | |
| 4 | Session Logout | Signing out clears the session cookie and returns the user to the login page; protected routes are no longer reachable. | |
| 5 | RBAC — Creator Visibility | A requester sees only their own role requests ("My Role Requests"), scoped list and metrics, and a direct URL to another user's role returns access denied. | |
| 6 | RBAC — HOD Department Scope | A Head of Department sees and acts only on their own department's roles and applicants, can action their own draft, and cannot view other departments. | |
| 7 | RBAC — HR Full Pipeline | HR has company-wide visibility and can manage recruitment setup, applicant decisions, and the full pipeline across all departments. | |
| 8 | RBAC — Management View-Only | A Management user has organisation-wide read access but cannot perform recruitment setup, pipeline management, applicant decisions, or edit/delete. | |
| 9 | RBAC — Credit Management Gate | Only the Admin and HR paths can open manual credit management; broad capability flags alone do not grant it. | |
| 10 | Confidential Role Visibility | Department scoping applies identically to roles and applicants, so a confidential cross-department role and its applicants are hidden from users outside that scope. | |
| 11 | Role Request Creation | A creator submits a role requisition with department choices, salary band, and HR screening fields; identity is server-owned; the role persists complete and enters the HR review queue with an audited transition. | |
| 12 | AI Job-Description Guidance | Pasting a job description generates AI screening guidance for the role without triggering the creation workflow. | |
| 13 | Role Draft Autosave | Draft edits autosave without invoking the creation workflow, use fresh reads across instances, and normalise the stored target date for the browser date input. | |
| 14 | HR Review — Approve | HR approves a role in review; the role advances and the decision is recorded in status history with the reviewer identity and timestamp. | |
| 15 | HR Review — Reject / Return | HR rejects or returns a role with comments; a typed event is enqueued and any downstream n8n rejection detail is preserved in the response. | |
| 16 | Idempotent Status Action | Repeating the same status action request (same `actionRequestId`) after a refresh or network retry is an idempotent replay, not a second transition. | |
| 17 | Recruitment Setup Required Fields | Higher-stage actions require the VAPI prompt, three interview questions, a posting channel, salary, experience, and any conditional HOD or licence fields; incomplete stage actions are rejected server-side. | |
| 18 | Publish Gating | "Publish Role" is enabled only at "Ready for Publishing"; a draft never becomes "Job Posted", and publishing returns durable validation and queues notification work. | |
| 19 | Role Edit & Archive | HR edits an existing role's setup and archives it through the Postgres target; request-type labels are normalised and the hiring-date column is preserved. | |
| 20 | Published Role in Candidate Intake | Only roles with durable publication evidence appear on the public apply pages; public role pages use short revalidation while booking stays live. | |
| 21 | Saved Template Load Safety | Loading a saved recruitment template into a role prompts before replacing a non-empty setup and clearly marks unsaved template content until saved. | |
| 22 | Public Applicant Submission | A candidate submits the public application form for a published role; a new applicant identity is created (repeat email + role allowed), and exactly one idempotent acknowledgment event is queued. | |
| 23 | Application Rate Limiting | High-cost and state-changing public endpoints apply per-client request throttling and return rate-limit headers. | |
| 24 | Invalid Application Payload | A malformed, non-McLink, or field-mismatched application payload is rejected with a clear error and no partial record. | |
| 25 | Single Resume Upload | A standalone resume upload requires HR review access, is bounded and standalone, and stores a resume with a traceable Drive link back to the candidate/application. | |
| 26 | File Type Validation | Local, Google Drive, and OneDrive intake all reject unsupported file types, folders, roots, and stale picker IDs, and enforce the 8-file operator cap server-side and in the UI. | |
| 27 | Duplicate Resume Prevention | Same-batch duplicate files are reserved by content hash before any Drive/n8n work, and re-uploading a historical hash reuses the existing Drive object with no second charge. | |
| 28 | Resume Parsing | PDF and DOCX resumes are parsed with the current resilient parser entrypoint and contact fields are extracted. | |
| 29 | Bulk Resume Upload | A multi-file batch processes with bounded, configurable concurrency; every file gets a saved queue event before parsing; the application is created before a queue item is exposed to workers. | |
| 30 | Bulk Per-File Timeout | Each per-file screening webhook is time-bounded so one stuck n8n call cannot hang the batch, and stale terminal waits expire. | |
| 31 | Bulk Retry — Failed Only | Retrying a batch re-runs only the failed files and only retries stale states when no saved applicant evidence exists. | |
| 32 | Bulk Status Reconciliation | Live bulk status reads are fresh, match by job identity (not storage identity), support historical identifiers, and expose the downstream queue as the source of truth. | |
| 33 | Google Drive Import | Google Drive is a separate HR-gated per-user OAuth connection; list and import feed the shared intake pipeline (including Shared Drives) and keep queue and credit safety guarantees. | |
| 34 | OneDrive Import | OneDrive is a wholly separate OAuth connection, HR-gated, feeding the same shared intake pipeline, and handles expired/revoked tokens, missing files, and permission errors. | |
| 35 | Screening Execution | Screening inference is owned by n8n (not the Pilot Vercel app), is role-bound and HR-owned, produces strict output, and cannot make an HR decision. | |
| 36 | Screening Result Transaction | The screening result, status history, queue completion, and the credit charge commit in one transaction; duplicate queue processing is a no-op. | |
| 37 | Failed Screening Credit Protection | A resume the workflow rejects synchronously or that errors is never billed, and the queue is marked failed without a credit write. | |
| 38 | Exactly-Once Credit Deduction | A successful screening deducts exactly once; a stable caller idempotency key makes retries a no-op on `source_entry_id`; the Postgres append is atomic and cannot take the balance negative. | |
| 39 | Credit Dual-Write Parity | In dual mode the Sheet is authoritative and every write mirrors to Postgres best-effort; `npm run db:check:credits` reconciles the two ledgers (`PG balance == PG Σ == Sheet Σ + Σ Postgres-only`) with no lost or invented credits. | |
| 40 | Credit Mirror Reconciliation | A Postgres-only ledger row is detected, categorised, and can be mirrored to the Sheet verbatim by `db:reconcile:credits:mirror` without re-charging or touching the balance. | |
| 41 | Manual Top-Up | A manual credit top-up requires a positive whole amount and a reason, carries a stable idempotency key, and applies the configured volume-discount bonus row deterministically. | |
| 42 | HitPay Purchase | Credits are granted only on a signature-verified provider webhook (never a frontend redirect); the amount is server-calculated and a provider mismatch is never credited; replays are idempotent. | |
| 43 | HR Applicant Review | The applicant record renders readable HR text (not raw JSON arrays), reflects the real call outcome (or "no interview took place"), and is reachable from the reviewer shell and role detail without reloading the full list. | |
| 44 | HR Approve — Voice Invite | Approving a screened applicant queues the AI voice interview booking invitation immediately and replays safely. | |
| 45 | Applicant Status History | Every stage change records the previous and new status pair with server-owned, normalised identity fields and preserved email casing. | |
| 46 | Voice Interview Booking | Booking a voice slot creates exactly one scheduled attempt at the persisted UTC instant; capacity allows ten applicants per identical instant and blocks the eleventh; only future weekday ten-minute slots are created. | |
| 47 | Timezone Handling | AI voice interview times follow the applicant's country or phone timezone and are persisted as the correct UTC instant; face-to-face stays office time; portal timestamps use the shared Singapore/Manila timezone. | |
| 48 | Scheduled Call Trigger | A due voice call is claimed atomically before provider dispatch; late or stale scheduled work is expired before it can be claimed. | |
| 49 | Voice Dispatch Delegation | Voice dispatch delegates provider ownership to n8n, retains the maximum voice-charge preflight, and remains dry-run unless the Pilot explicitly opts into live calls. | |
| 50 | Actual Interview Call | At the scheduled time Ella calls the candidate's real mobile number, conducts the interview, and the call completes. | |
| 51 | Missed / Failed Call Billing | Vapi no-contact outcomes bill as `no_answer` (−5), a connected-but-unfinished interview bills as `incomplete` (−8), a completed interview bills as `phone_interview` (−10), and non-terminal / cancelled / provider-failure outcomes are free. | |
| 52 | Retry Handling | The voice retry endpoint is authenticated and idempotent, a retry is scheduled automatically when a call does not connect, and the candidate receives the retry notification copy. | |
| 53 | Voice Result Sync | Voice results are ingested via the authenticated internal API, are idempotent per attempt, are tied to the current applicant attempt, and own the single terminal billing event. | |
| 54 | Stale Result Protection | A stale or terminal voice attempt cannot receive a result or a call log. | |
| 55 | Duplicate Callback Protection | A replayed calendar or result callback never records a second event ID and a replayed booking token is idempotent. | |
| 56 | Correct Applicant Mapping | A voice result or log resolves to the correct application by ID, code, or application + interview type, with no cross-applicant contamination. | |
| 57 | Face-to-Face Booking & Calendar | An eligible final booking invites the applicant, creates and records a Google Calendar event on the shared HR calendar, leaves a failed attempt retryable, and never double-books on replay. | |
| 58 | Booking Token Safety | Booking links use the public portal host, final tokens are single-use, and an invalid or expired token renders a branded unavailable page. | |
| 59 | Final Decision | HR records a pass or reject at the final stage; the applicant advances or is rejected accordingly and every transition is written to status history. | |
| 60 | Notification Copy & Queue | The notification queue exposes email-ready wording (not raw workflow keys) and ready-to-send candidate email copy per booking event, with recorded attempt, sent time, provider ID, and recipient. | |
| 61 | Notification Badge | The Applicants badge is data-driven, hides at zero, keeps reviewer-only visibility and refresh behaviour, and reserves layout space instead of overlaying page controls. | |
| 62 | Pilot Recipient Guard | Pilot outbound email goes only to the candidate address (or the configured test address) plus the explicit internal monitoring copies, and is candidate-event allowlisted — never an arbitrary mailbox. | |
| 63 | Notification Outcome Resilience | Notification results of `sent`, `pending`, `failed`, and `not_configured` all preserve workflow success. | |
| 64 | Client Polling Efficiency | Shared pollers dedupe in-flight requests, are visibility-aware, back off (credits meter to five minutes), and poll only while a batch is pending and the tab is visible. | |
| 65 | Portal Page Rendering | Login, dashboard, role creation, and settings render correctly at 1440 / 1024 / 768 / 390 px with the expected headings, four dashboard stat cards, and no horizontal overflow. | |
| 66 | Internal API Authentication | The internal API requires the shared secret (Bearer or `X-Internal-Secret`), fails closed on missing entity or database configuration, is no-store and non-indexable, and never exposes a database URL to n8n. | |
| 67 | Internal API Authorization Matrix | Each internal route has an explicit entity allow-list that does not inherit from a parent entry and returns the required status matrix. | |
| 68 | API Input Validation | Salary rejects negative and inverted values; emails are validated and server-owned; payment amounts must be strict positive two-decimal major-unit strings; interview question counts cannot exceed five. | |
| 69 | Postgres-First Role Resolution | Intake routes resolve a published role from Postgres before applying published-role validation and do not perform a direct Sheets role lookup in target mode. | |
| 70 | Database Referential Integrity | `npm run db:check:recruitment:integrity` reports all 17 recruitment tables present, all foreign-key constraints, and zero orphan rows across every FK edge. | |
| 71 | Database Schema Constraints | The recruitment schema keeps applicants separate from applications, preserves every Sheet human ID as `external_id` / `code`, uses `timestamptz` and constrained status columns, and stays separate from the credit and payment schemas. | |
| 72 | Migration Runner Safety | The migration runner requires an explicit target, cannot leap to a later file, and rejects functions, DO blocks, and dollar-quoting. | |
| 73 | Recruitment Parity Check | `npm run db:check:recruitment` defers to the integrity check post-cutover (SUPERSEDED, exit 0); `--legacy-parity` still runs the Sheets↔Postgres comparison with probe-based tab resolution. | |
| 74 | Demo Mode Isolation | Demo mode keeps generated history out of the default lists, exposes only read-only stage examples, and leaves normal production records unrestricted. | |
| 75 | Pilot Data Isolation | The Pilot Postgres target uses an explicit allow-list (no global bypass), the reset script is pilot-gated and FK-ordered, and reset/seed never touch the credit or payment tables. | |
| 76 | End-to-End Applicant Journey | A single fresh applicant completes the full journey — role creation → publish → application → resume upload → screening → exactly-once credit deduction → HR decision → voice interview scheduling → actual scheduled call → result sync → correct final status — with the credit balance moving by exactly the screening cost plus the terminal voice cost. | |

**Signature by Client**

Name:

Date:

Signature:
