# Known Issues and Planned Fixes

Open items found during the 2026-08-14 demo preparation. Each entry records what
was observed, what the investigation established, and the fix that has not been
applied yet. Fixes already shipped are listed at the bottom for context.

## 1. Loading a saved template silently overwrites a role's setup — RESOLVED

**Resolution (2026-09-14).** The portal no longer exposes a template-load
control in Recruitment Setup. The affected live `WD01` Web Developer posting
was placed **On Hold**, its application link and publication flags were cleared,
and its screening criteria, interview questions, and AI prompt were cleared for
HR to configure afresh before relaunch. No applicant can enter that role while
it is on hold.

**Severity:** high — produced live, incorrect screening on a published role.

**What happened.** Role `WD01` (Web Developer) was published on 2026-08-14 at
05:06 carrying the recruitment setup of an AI Engineer role: LLM/RAG screening
criteria, RAG/PyTorch/Pinecone keywords, an AWS Machine Learning certification
requirement, and five LLM-specific interview questions. Candidates applying to a
Web Developer post would have been screened on retrieval-augmented generation.

**Root cause.** The content is a byte-for-byte match with the saved template
`AE` (`Template_ID 26655781-30dd-4ddb-b4ff-adcabd0c0d17`, source role `SAE01`,
created by Bong at 02:06). The distinguishing detail is
`earliestAvailabilityRule`: the template says "within 30 to 60 days" while
`SAE01`'s own row says "within 30 days or has a standard notice period" — so the
values came from the template, not from the source role.

The editor does **not** auto-apply templates: `RecruitmentSetupEditor` only
fetches them into a list, and `Load` must be clicked. The hazard is presentation,
not logic:

- The template panel sits at the top of the setup section with a prominent
  `Load` button, directly above the fields it replaces.
- `Load` replaces every HR-editable field at once with no confirmation.
- Once loaded, nothing distinguishes template content from the role's own saved
  setup, so the next save silently adopts it.

**Historical planned fix (superseded).**

The former confirmation/banner/move-template plan is no longer the active
remediation because the template-load control has been removed from the
Recruitment Setup UI. The live role was also placed on hold and cleared before
launch. Do not treat the historical bullets below as remaining work.

1. Confirmation prompt before `Load` replaces a non-empty setup, naming the
   template and the role it will overwrite.
2. A persistent "Loaded from template *<name>* — not saved yet" banner while the
   form holds unsaved template content, cleared on save or reload.
3. Consider moving the template panel below the HR-edited sections so it is not
   the first thing in reach.

**Historical data-cleanup finding (resolved above).** `WD01` previously retained the AI Engineer setup and was
`Job Posted` with a live application link. It needs either a clear-back-to-blank
or a genuine Web Developer setup. Its `AI_System_Prompt` also opens with "You are
Julio…" instead of "You are Ella…" — someone edited the prompt after loading, and
the interviewer would introduce herself as Julio on a real call.

The preceding paragraph is historical discovery evidence; the resolution above
is the current state. HR must configure and review a genuine Web Developer setup
before publishing `WD01` again.

## 2. Final-interview invitation is never sent unless Vapi said "Completed" — FIXED

**Status (2026-09-12):** the planned fix below has shipped and is live in
production workflow `4FsKYuSxyaKxFtsM`, node **Filter Voice HR Actions**:
`hrHasDecided` is present and the return condition matches exactly what's
described below. Left here for history; not an open item.

**Severity (at the time):** high — approved candidates silently never received a booking link.

**Where.** n8n workflow *Voice Interview HR Decision v2 – Hashed Final Booking
Token* (`4FsKYuSxyaKxFtsM`), node **Filter Voice HR Actions**.

**Root cause.** The filter's final condition is:

```js
return (resultCompleted || explicitApprovalOverride) && (rejectReady || approvalReady);
```

`resultCompleted` requires the `Voice_Interview_Results` row to have both
`Call_Status` **and** `Call_Final_Status` equal to `completed`.
`explicitApprovalOverride` only fires when `Voice_HR_Comments` literally contains
the word "manual". So an HR **Approve** on any candidate whose call came back
`No Answer`, `Busy`, or `Incomplete` is discarded, and no invitation is sent.

This compounds with the Vapi mis-count in item 4: a candidate who genuinely
finished the interview can be labelled `Incomplete`, and then their HR approval
is silently dropped here.

**Observed.** Of 13 approved applicants, three never received the email:

| Applicant | `Call_Status` | Blocker |
| --- | --- | --- |
| `APP-3e795aad…` Julio Jose Padilla | `no answer` | fails `resultCompleted` |
| `hulyo jose padilla` | `busy` | fails `resultCompleted` |
| `Lucas` | `completed` | claim flag stuck at `Processing` with an expired token (2026-08-10) |

**Planned fix.** Treat an explicit HR decision as authoritative — HR only decides
after reviewing the interview, so the decision itself is the signal to act on:

```js
// An explicit HR decision is authoritative. Requiring the Vapi call to be
// "Completed" meant a candidate whose call came back "No Answer", "Busy", or
// "Incomplete" never received the final-interview invitation even after HR
// approved them — and "Incomplete" is itself unreliable (see item 4).
const hrHasDecided = decision === 'approve' || decision === 'reject';

return (
  (resultCompleted || explicitApprovalOverride || hrHasDecided) &&
  (rejectReady || approvalReady)
);
```

**Secondary.** The `approvalFlag === 'processing'` retry branch also requires an
unexpired `Final_Interview_Booking_Token_Expires_At`. Once the token lapses the
row can never be retried (Lucas). Either allow re-issuing a token on expiry, or
clear `Voice_Approval_Processed` to re-queue the applicant.

## 3. "Unable to save" may not mean the save failed

**Severity:** medium — HR cannot tell whether to redo the work.

The recruitment-setup route treats a workflow reply as failure unless the body
carries `success: true`. If n8n returns HTTP 200 without that field while still
performing its writes, the portal reports a failure for work that actually
landed.

This is **unconfirmed** — it requires inspecting the response node of the n8n
recruitment-setup workflow. Mitigation already shipped (see below) reloads the
saved record after a failure so HR can see what was kept, but the underlying
ambiguity should be settled by checking what that workflow returns.

## 4. Voice interview question count comes from Vapi, not the portal

The `Prepare Final Result` node in *Phase 5 – Scheduled Vapi Result Polling* was
fixed to stop mis-attributing answers when a candidate asks the interviewer to
repeat a question. That fix corrects the **Interview evidence** block and the
local completeness fallback.

The "N of 5 questions answered" figure in the summary header still prefers
Vapi's own `answered_question_count` when present, so a miscount originating in
Vapi's end-of-call analysis will still show. If that proves unreliable, prefer
the locally computed count over the provider's.

## 5. Recruitment setup stage buttons

`Mark as Recruitment Ready` and `Mark as Ready for Publishing` are now optional —
`Publish Role` unlocks on genuine field readiness. The four buttons were kept
deliberately.

Collapsing to `Save Draft` + `Publish Role` would simplify the UI, but it would
stop `recruitment_setup_marked_ready` and
`recruitment_setup_ready_for_publishing` from ever reaching n8n. Any workflow
branching on those action values must be checked before removing the buttons.

## 6. Schema documentation drift

`GOOGLE-SHEETS-SCHEMA.md` does not list the `Interview_Slots` columns
`Interviewer_Name`, `Interviewer_Email`, `HOD_Name`, and `HOD_Email`, which the
final-interview booking flow reads and writes (range widened to `X`).

Related: `updateRoleRequestFields()` appends any column it cannot find. If a
header name in the code ever drifts from the sheet, the mismatch appears as a new
column at the far right of `Role_Requests` rather than as an error.

## 8. Voice result webhook pointed at a retired URL with no secret, and a second `outcome` constraint bug it exposed — FIXED

**Status (2026-09-15):** both fixed. n8n's outbound Vapi call node now points
at the current result webhook and sends its secret; `updateVoiceAttemptStatus`
now normalizes `outcome` before writing it. See item 7 above for the prompt
side of this same incident (same applicant, same day).

**Severity:** high — every pilot voice call dispatched between
2026-09-14T01:01Z and the fix stayed stuck at "Voice Interview Scheduled" /
call status "In Progress" forever, with no transcript or evaluation ever
reaching HR.

**Observed.** Applicant `APP-1abbc639-45d6-49dc-80ab-f5b9fb78a499` (Julio UAT
Test, General Manager) stayed at "Voice Interview Scheduled" / "In Progress"
long after its call had actually completed.

**Root cause 1 — dead webhook, no secret.** The pilot outbound-call workflow
(`[TARGET-PG][PILOT] AI Voice Interview Scheduled Calling (Pilot)`,
`sJM0djTE8oIjpPvo`, node **Call Vapi with n8n credential (Pilot)**) set
`assistantOverrides.server.url` to a retired webhook path
(`.../webhook/target-pg-m9hyanrov4tcpfiq`). The live result-webhook workflow
(`[TARGET-PG][PILOT] Phase 5 - Scheduled Vapi Result Polling (Pilot)`,
`m4KFJIOIqo1VMc6g`) had since rotated to a different path and its Normalize
code node silently discards (`return []`, no error) any request whose
`x-vapi-secret` header doesn't match a fixed value — never sent either. Zero
successful executions on that webhook from 2026-09-14T01:01:54Z onward
despite many calls dispatched in that window. **Fix:** the node now sets the
correct URL and `server.secret`.

**Root cause 2 — a second, previously-unexercised bug this uncovered.**
Fixing the webhook let real traffic reach `POST
/api/internal/recruitment/voice/attempts/status` (`updateVoiceAttemptStatus`)
for the first time with `outcome: "incomplete"` — a legitimate
`VoiceInterviewBillingOutcome` value n8n sends straight through. That
function wrote it unmapped into `voice_call_attempts.outcome`, whose CHECK
constraint (`drizzle/0006_voice_attempt_dispatch_states.sql`) has never
allowed `"incomplete"` (only `completed`, `no_answer`, `busy`,
`wrong_person`, `no_show`, `cancelled`, `system_failure`) — a 500,
masked as a generic `{"error":"internal_error"}` by `withInternalAuth`'s
catch-all. The sibling function `settleVoiceAttemptFromResult` (used by
`/voice/results`, which is why it never hit this) already maps
`"incomplete"` billing outcome to the attempt-level `"completed"` outcome —
`updateVoiceAttemptStatus` just never got the same treatment. Reproduced
locally against the real database with `tsx` (`DrizzleQueryError` ->
`23514 violates check constraint "voice_call_attempts_outcome_check"`)
before fixing it, and confirmed fixed after.

**Fix.** `normalizeVoiceAttemptOutcome()` (`src/lib/internal-recruitment-
queries.ts`) now maps `"incomplete"` to `"completed"` and drops anything else
not in the DB's allowed set, and `updateVoiceAttemptStatus`'s UPDATE routes
every `outcome` through it. `tests/voice-credit-outcomes.test.mjs` adds a
regression test that also cross-checks the code's allowed-values set against
the actual CHECK constraint SQL, so a future migration change that narrows
the constraint without updating the code fails the test suite instead of
failing silently in production again.

**Also recovered:** Julio's specific stuck call was backfilled from Vapi's
real call record (a 5-second call, `customer-ended-call`, transcript "Hi." —
not a real interview, but real data instead of a permanently empty "Awaiting
AI evaluation").

## 7. Pilot voice calls ran under the wrong Vapi assistant prompt — FIXED

**Status (2026-09-14):** fixed the same day it was found. The portal now
builds and validates the call's prompt before dispatch (`buildVoiceCallPrompt`
in `src/lib/recruitment-prompt.ts`, wired into
`/api/internal/recruitment/voice/dispatch`), and the pilot n8n workflow now
forwards it. See `docs/N8N-CONTRACTS.md` → "Postgres-target voice dispatch"
for the contract.

**Severity:** high — live applicants were called by an AI voice interviewer
that did not run the Ella script at all.

**Observed.** A Vapi call log for applicant Lihen Bong (Malaysia number,
09/14/2026, assistant `4698fa1c-eef6-454f-9b0b-830c76738d1c`, named
`ELAI (Copy) (Copy)` in the Vapi dashboard) opened with "Hello, how can I
assist you today? Are you looking to schedule a meeting, check calendar
availability, or something else?" — not Ella's identity confirmation line and
not part of the Ella prompt anywhere.

**Root cause.** The Postgres-target pilot's outbound-call workflow
(`[TARGET-PG][PILOT] AI Voice Interview Scheduled Calling (Pilot)`,
`sJM0djTE8oIjpPvo`, node **Call Vapi with n8n credential (Pilot)**) sent
`assistantOverrides.variableValues` with only `application_id`, `attempt_id`,
`candidate_name`, `contact_number`, `role`, `selected_role`, `role_id`, and
`scheduled_at` — never `ella_system_prompt`. It couldn't have: the endpoint it
calls, `POST /api/internal/recruitment/voice/dispatch`, only ever returned
candidate name/phone and role id/title, never a resolved prompt. Per
`N8N-CONTRACTS.md`, n8n is required to send a rendered `ella_system_prompt`
on every call — but that contract only documented the older Sheets-era
role-setup-update flow, not this Postgres pilot's per-call dispatch endpoint,
so the gap was never caught. Every MY/SG pilot voice call dispatched through
this path ran on whatever prompt happens to be saved directly on the Vapi
assistant in the dashboard — unrelated, unversioned, and in this case a
duplicated ("(Copy) (Copy)") generic scheduling-bot prompt.

**Fix.**
1. `voiceAttemptContext()` now also loads the role's saved recruitment setup
   (`roles.setup`) and the resume screening result (match score, AI summary).
2. `buildVoiceCallPrompt()` (`src/lib/recruitment-prompt.ts`) renders the
   role's Ella template with both role- and candidate-level placeholders
   resolved, and reports `resolved: false` if the result is missing the
   `[Identity]` section or still has an unresolved `{{token}}`.
3. `/api/internal/recruitment/voice/dispatch` calls it, returns the result
   under `prompt.ellaSystemPrompt` (plus job description, screening criteria,
   interview questions, evaluation fields, match score, AI summary), and
   refuses to dispatch (`voice_prompt_not_resolved`, HTTP 409) instead of
   claiming the attempt when the prompt did not resolve — a broken prompt can
   no longer reach Vapi silently.
4. The pilot n8n workflow's Vapi call node now reads `prompt.ellaSystemPrompt`
   from the dispatch response into
   `assistantOverrides.variableValues.ella_system_prompt`.
5. Regression tests: `tests/recruitment-setup-stage.test.mjs` asserts
   `buildVoiceCallPrompt` fully resolves a real call's prompt with no
   remaining `{{...}}` tokens, and that the dispatch route contains the
   `resolved` guard.

---

## Fixed on 2026-08-14

- **Phone numbers lost their `+`.** Sheets' `USER_ENTERED` mode parsed a leading
  `+` as a formula, storing `60127717025`, which the Vapi dialer could not call.
  Phone writes now use the `'` text-cell prefix. Verified by round-trip against
  the live sheet.
- **"Role request not found" after creating a role.** `POST /api/roles` cached
  the pre-creation list and never invalidated it, so the redirect read a stale
  snapshot for up to 20 seconds.
- **Stale status after setup and status actions.** Added cache invalidation
  after the n8n webhook succeeds, and unconditionally in the status route where
  the previous invalidation sat inside a `try` that swallows errors.
- **Publish reported a false error.** A second click after a successful publish
  hit the `Approved`/`Recruitment Setup` guard once the role became
  `Job Posted`. Publish is now idempotent and reports the settled state.
- **Publish button stayed disabled with a complete checklist.** It required the
  stored stage to equal `Ready for Publishing`; it now gates on actual readiness.
- **Save Draft lost data.** Only voice fields were written directly; everything
  else depended on the n8n mapper. All HR-entered setup fields are now persisted
  by the portal using the same values sent to the workflow.
- **Final Interview card shown too early.** It now appears only after the voice
  HR decision is `Approve`.
- **Interview evidence mis-attributed after a repeat request.** See item 4.
- **Recruitment Setup hidden once published.** The section returned `null` for
  any status other than `Approved`/`Recruitment Setup`, so HR could not see what
  Ella was configured to ask on a live role. Published roles now render it
  read-only, matching the server, which refuses setup saves for them.
- **Recommendation showed a final-interview stage too early.** `Status 3 (Final
  Interview)` defaults to `Pending`, which the summary read as "Awaiting Final
  Interview Scheduling" before the voice call had happened. The voice stage is
  now reported while the voice HR decision is still open.
