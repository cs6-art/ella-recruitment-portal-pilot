# Ella Pilot E2E parity map

This document compares the working recruitment journey in `mclink-recruitment-portal`
with the Pilot/Postgres target. It is a test and implementation map, not a cutover
authorization. Pilot target workflows remain inactive unless a controlled test says
otherwise.

## Reference journey

The reference journey is:

`role request -> HR review/setup -> publish -> applicant intake -> screening -> HR review -> voice booking -> voice result/no-show/retry -> F2F booking -> final decision -> notifications`

The legacy portal stores operational state in Google Sheets and uses n8n for
orchestration, email, calendar, and Vapi integrations. The Pilot target stores
operational state in Postgres and uses authenticated internal APIs; n8n remains the
integration layer.

## Feature parity

| Old feature | Old route/workflow/code | Old trigger | Old store | Pilot equivalent | Pilot DB/API | n8n workflow | Integration | Status | Required action |
|---|---|---|---|---|---|---|---|---|---|
| Role creation | Role request portal and role-request foundation | HR/requester submits role | Sheets role request | Role request UI and target roles API | Postgres roles, status/history | `[TARGET-PG][PILOT] McLink - Role Request Status` | n8n status orchestration | PARTIAL | Validate target submission, audit, refresh, and publish path |
| HR review | HR approval/status actions | HR reviews request | Sheets status columns | HR decision UI/API | HR decisions, status history | `[TARGET-PG][PILOT] AI Recruitment HR Approval Notifications` | Pilot-safe notification | PARTIAL | Prove allowed HR transitions and notification payload |
| Recruitment setup | Recruitment setup fields and stage actions | HR completes setup | Sheets role/setup data | Target role setup/update path | Postgres roles | Role status target workflow | None beyond n8n | PARTIAL | Prove required fields, persistence, and publish |
| Publishing | Publish role stage | HR publishes | Sheets role status | Published target role | Postgres roles/status history | Role status target workflow | Portal UI | PARTIAL | Prove role appears in applicant intake |
| Application invite | `APPLICATION-INVITE-EMAIL` and invite workflow | HR requests applicant invite | Sheets + Gmail | Target application/invitation APIs | Postgres applications/invitations | `[TARGET-PG][PILOT] McLink - Application Invite Email` | Gmail, Pilot recipient guard | LEGACY-SHEETS | Replace active Sheets trigger with target API workflow and safe email test |
| Applicant application | Candidate application foundation | Candidate submits application | Sheets applicant/application rows | Target application endpoint/UI | Postgres applicants/applications | `[TARGET-PG][PILOT] McLink - Candidate Application Foundation` | n8n optional orchestration | LEGACY-SHEETS | Prove direct intake, dedupe, role mapping, and refresh |
| Resume screening | `9k5nGuC1CHQBdVHx`, bulk screening docs | Upload/Drive intake | Sheets + Drive | Bulk target queue and worker | Postgres bulk queue/results/history/credits | `[TARGET-PG][PILOT] Bulk Resume Upload Intake` | Drive + n8n AI credential | PASS/PARTIAL | Scenario C passed; retain regression and failure recovery |
| HR screening review | Screening results and HR decision stage | HR reviews result | Sheets result/status | Target screening/HR decision UI/API | Postgres screening results and history | HR decision target workflow | Pilot-safe notification | PARTIAL | Prove HR review and downstream transition |
| Voice booking | Voice booking page and booking workflow | Applicant selects slot | Sheets booking rows | Target public booking/token APIs | Postgres bookings/slots/tokens | `[TARGET-PG][PILOT] AI Voice Interview Booking Invitations` and confirmation | Gmail, dry-run only for calls | PARTIAL | Prove booking persistence, invite, and idempotency |
| Voice email | `gGTvRHKaHTX95y0b`, confirmation workflow | Voice invitation/booking | Gmail + Sheets | Target notification payload | Postgres notification state | Voice invitation/confirmation target workflows | Gmail, all test To addresses forced to `cs6@mclinkgroup.com` | MISSING | Complete target email workflow and verify safe recipient |
| Scheduled voice execution | Scheduled calling workflow | Due booking | Sheets queue | Target voice queue/attempt APIs | Postgres voice queue/attempts/logs | `[TARGET-PG][PILOT] AI Voice Interview Scheduled Calling` | Vapi request intercepted/dry-run | MISSING | Add Pilot dry-run guard and validate payload without dialing |
| Voice result sync | Result polling/status sync | Vapi callback/result | Sheets voice result rows | Target voice result API | Postgres voice results/history | `Voice Result Status Sync (Pilot)` | Synthetic callbacks only | PARTIAL | Prove pass/fail/no-show/retry and duplicate callback handling |
| No-show/retry | Queue attempt and retry logic | No-show or failed attempt | Sheets queue/attempts | Target attempt/status APIs | Postgres voice attempts/queue/history | Scheduled calling target workflow | Dry-run Vapi | PARTIAL | Prove attempt increment, retry cap, and no duplicate records |
| F2F booking | Final interview booking workflow | HR sends candidate to final stage | Sheets + Calendar | Target booking/token APIs | Postgres bookings/history | `[TARGET-PG][PILOT] AI Final Interview Booking Confirmation` | Pilot/test Calendar and Gmail | PARTIAL | Prove event, attendee, timezone, and dedupe |
| F2F email | Final booking confirmation | Booking completes | Gmail + Sheets | Target notification state | Postgres notifications/history | Final booking target workflow | Gmail recipient guard | MISSING | Complete safe test email and dedupe |
| Google Calendar | Shared HR calendar booking | F2F booking completes | Calendar + Sheets event ID | Pilot/test calendar integration | Postgres event metadata | n8n target confirmation workflow | Pilot calendar only | PARTIAL | Verify event creation and replay safety |
| Final decision | Final interview decision action | HR records outcome | Sheets status/history | Target HR decision route | Postgres decisions/history | HR decision target workflow | Notification API | PARTIAL | Prove pass and reject paths |
| Notifications | Status notifications and applicant badge | State transition | Sheets recipient resolution + Gmail | Target notifications API/UI | Postgres notifications/status history | Screening/decision notification target workflows | Gmail recipient guard | PARTIAL | Prove counts, seen state, RBAC, and safe email |
| Credits | Credit ledger and screening charge | Successful screening/payment/manual credit | Sheets + Postgres mirror during dual mode | Postgres payment/ledger target | Postgres ledger/payment tables | Bulk target worker | HitPay sandbox, manual credit RBAC | PASS/PARTIAL | Preserve Scenario C proof; complete target-only parity evidence |
| Payment | HitPay request/webhook | User buys credits | Postgres payment state + Sheets mirror | HitPay sandbox target | Postgres payments/events/ledger | Webhook/API | HitPay sandbox | PASS | Retain duplicate webhook regression |
| Audit/history | Status transition logging | Every state change | Sheets history/status | Target status/history APIs | Postgres history | Internal API | None | PARTIAL | Verify every tested transition is transactional |
| RBAC | Portal role checks and API guards | Every UI/API action | Session + Sheets permissions | Pilot role/API guards | Postgres-backed target routes | n8n internal auth | Google auth | PASS/PARTIAL | Re-run role matrix across the full journey |

## Current implementation status

- The Pilot bulk/Drive screening path is the strongest target path: the controlled
  Scenario C run recovered a queued item, screened it through the n8n-managed AI
  credential, persisted the result, deducted one credit, and left all 13 target
  workflows inactive afterward.
- The active legacy Pilot workflows for role status, application invite, candidate
  application, HR notifications, voice invitations/confirmation, result polling,
  voice HR decision, final booking, and screening notifications still use Sheets or
  are not the target Postgres path. They are references only for the target build.
- Target Postgres workflows exist for the major domains but are inactive. Existence
  is not treated as functional proof until a controlled Pilot execution is observed.
- AI screening is owned by n8n. The Pilot application must not require a duplicate
  `OPENAI_API_KEY`; the approved n8n screening credential remains the inference
  owner.
- Test email recipients must be forced to `cs6@mclinkgroup.com`. No candidate,
  HR, HOD, management, or external recipient may receive a test email.
- Voice execution must be dry-run/mock only. No real Vapi call may be placed.

## Acceptance gates

The complete Pilot is not accepted until the following are observed, not merely
implemented:

1. Role request, HR review/setup, publish, applicant intake, screening, and HR
   review persist and survive refresh in Postgres.
2. Voice booking and F2F booking persist exactly once and produce only safe test
   emails and Pilot/test Calendar events.
3. Voice dry-run payload, synthetic result, no-show, retry, malformed callback, and
   duplicate callback are all handled without real calls or duplicate records.
4. Final decisions and notifications are visible to the authorized roles, with the
   Applicants badge and bell count obeying RBAC and refresh behavior.
5. HitPay sandbox, credit deductions, idempotency, FK integrity, and concurrency
   checks pass.
6. Critical operational Sheets dependencies are zero; Sheets may remain only as
   archive, historical reference, reporting, or intentional configuration.
7. The final n8n state is `13 workflows / 0 active`.
