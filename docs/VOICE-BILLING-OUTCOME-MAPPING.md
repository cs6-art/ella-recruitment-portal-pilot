# Voice interview billing — outcome classification

Terminal voice attempts are billed once per attempt id from
`classifyVoiceInterviewBillingOutcome()` in
[`src/lib/ella-credit-math.ts`](../src/lib/ella-credit-math.ts). The attempt id is
the billing identity, so result / log / status-update retries and callback
replays cannot charge the same call twice.

## Classifier inputs

`outcome`, `callStatus`, `callFinalStatus` are lower-cased and trimmed into a
signal list. `transcript`, `isComplete`, `completenessScore` refine the
completed-vs-incomplete split when a call did connect.

## Mapping table

| Vapi ended reason / status signal | Normalized outcome | Credit charge | Event tag |
| --- | --- | --- | --- |
| `completed` / `ended` / `finished` **with** a non-empty transcript and `completenessScore` ≥ 100 (or absent) | `completed` | **-10** | `phone_interview` |
| `customer-busy`, `customer_busy`, `busy` | `no_answer` | **-5** | `phone_interview_no_answer` |
| `customer-did-not-answer`, `customer_did_not_answer`, `did-not-answer` | `no_answer` | **-5** | `phone_interview_no_answer` |
| `no-answer`, `no_answer`, `no answer` | `no_answer` | **-5** | `phone_interview_no_answer` |
| `voicemail` | `no_answer` | **-5** | `phone_interview_no_answer` |
| `no-show`, `no_show` | `no_answer` | **-5** | `phone_interview_no_answer` |
| Call connected/started but interview not completed: `incomplete`, `partial`, `ended-before-completion`, `isComplete === false`, or `completenessScore < 100` | `incomplete` | **-8** | `phone_interview_incomplete` |
| `completed`/`ended` terminal but **no transcript** produced | `incomplete` | **-8** | `phone_interview_incomplete` |
| `cancelled`, `provider_failure`, `system_failure`, `technical_failure`, `failed` (no transcript, not a no-contact reason) | *(none)* | **0** | — |
| Non-terminal: `initiated`, `in_progress`, booking-only | `null` | **0** | — |

### Why `customer-busy` is `no_answer`, not `incomplete`

`customer-busy` means the call never connected — no interview took place, so it
belongs in the same bucket as `no-answer`/`voicemail` (-5). It is only classed
`incomplete` (-8) when a call actually connects and the interview is cut short.
The live callback on 2026-09-08 (attempt result, ended reason `customer-busy`,
no transcript) exposed the gap: `ended` was treated as a terminal completed-style
signal and, with no matching no-answer entry, fell through to `incomplete` (-8).
Fixed by adding the `customer-busy` family to `NO_ANSWER_SIGNALS`, which is
checked before any terminal/transcript logic.

## Correcting a mis-billed attempt

`src/db/correct-voice-billing-attempt.mjs` appends one auditable corrective
`TopUp` row (`event = billing_correction`) keyed deterministically off the bad
entry id. It never deletes ledger history and is idempotent on re-run.

```
node src/db/correct-voice-billing-attempt.mjs --bad-entry=<entry id> --amount=3           # dry run
node src/db/correct-voice-billing-attempt.mjs --bad-entry=<entry id> --amount=3 --commit  # apply
```
