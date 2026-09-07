# n8n wiring — Face-to-face (F2F) Google Calendar integration

**Contract source:** commit `57ef505` (deployed to `https://ella-recruitment-portal-pilot.vercel.app`).
**Status:** the Postgres side is implemented and deployed. The n8n workflow described
here is **not built yet**. This document is the build spec. It does not claim the
Calendar integration is complete — that requires the controlled test in section 9
to pass with live evidence.

Route implementation this doc is derived from:

- `src/app/api/internal/recruitment/bookings/calendar/route.ts`
- `src/lib/internal-recruitment-queries.ts` → `calendarEventQueue()`, `markInterviewCalendarEvent()`
- `src/db/schema-recruitment.ts` → `interviewSlots`
- `src/lib/internal-api.ts` → auth contract

---

## 1. Purpose

The target (Postgres) architecture no longer uses Google Sheets to drive interview
scheduling. Face-to-face interview slots live in the Neon `interview_slots` table.
When a candidate books an F2F slot, `bookInterviewSlot()` sets the slot `status` to
`booked` and leaves `calendar_event_id` empty. Nothing in Vercel talks to Google
Calendar — that is n8n's job.

Target flow:

```
Postgres: booked F2F slots with no calendar_event_id
   │
   ▼  GET /api/internal/recruitment/bookings/calendar        (n8n reads the work queue)
   │
   ▼  Google Calendar: create one event per slot             (n8n owns the Google credential)
   │
   ▼  POST /api/internal/recruitment/bookings/calendar        (n8n writes the event id back)
   │
   ▼  Postgres: interview_slots.calendar_event_id persisted
        → slot leaves the queue → replay creates no second event
```

**Voice interviews are phone calls.** `calendarEventQueue()` filters
`interview_type = 'final'` only. Voice slots are never returned by the GET endpoint
and must never be pushed into Google Calendar by this workflow.

---

## 2. Pilot endpoints

Base URL (Pilot only): `https://ella-recruitment-portal-pilot.vercel.app`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/internal/recruitment/bookings/calendar` | Return F2F slots awaiting a Calendar event |
| `POST` | `/api/internal/recruitment/bookings/calendar` | Persist the Calendar node outcome onto a slot |

### Authentication

Both endpoints are wrapped in `withInternalAuth("booking", …)`. There is **no**
cookie/session path — a browser cannot call these.

- Secret: the existing `INTERNAL_API_SECRET` environment variable on the Pilot
  deployment. **Do not invent a new secret.** In n8n this is the existing
  **`Ella Pilot Internal API`** credential (HTTP Header Auth).
- Presented as either:
  - `Authorization: Bearer <INTERNAL_API_SECRET>`, or
  - `X-Internal-Secret: <INTERNAL_API_SECRET>`
- Compared timing-safe server-side.
- The entity `booking` must be present in `INTERNAL_API_ENTITIES` on the Pilot
  deployment (it already is for the existing `/bookings`, `/bookings/slots`,
  `/bookings/tokens` routes).

Authorization decision order (from `authorizeInternalRequest`):

| Condition | HTTP | body `error` |
|---|---|---|
| missing / wrong secret | `401` | `invalid_or_missing_internal_secret` |
| `INTERNAL_API_ENTITIES` unset | `503` | `internal_api_entities_not_configured` |
| `booking` not in the allowlist | `403` | `internal_api_entity_not_allowed` |
| `DATABASE_URL` unset | `503` | `internal_api_database_not_configured` |
| authorized | — | route logic runs |

---

## 3. Exact GET response contract

`GET /api/internal/recruitment/bookings/calendar`

Request: no query parameters, no body. Auth header required.

Response `200`:

```json
{
  "ok": true,
  "migrated": true,
  "items": [ /* zero or more queue items, see below */ ]
}
```

Each element of `items` is a full `interview_slots` row (camelCase keys) plus
`roleExternalId`. Server-side filter: `status = 'booked'` **and**
`interviewType = 'final'` **and** `calendarEventId = ''`. Ordered by `startsAt`
ascending, max 100 rows.

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | **Slot ID.** Use this as `slotId` in the POST write-back. |
| `slotCode` | string \| null | Optional external slot code; unique when set. May be `null`. |
| `interviewType` | string | Always `"final"` for items from this endpoint. |
| `roleId` | string (uuid) \| null | Internal role FK. |
| `roleExternalId` | string | Role external id (e.g. `"AQAS01"`); `""` if the slot has no role. |
| `startsAt` | string (ISO 8601, UTC) | Event start. Example `"2026-09-15T02:00:00.000Z"`. |
| `endsAt` | string (ISO 8601, UTC) | Event end. |
| `timezone` | string | IANA tz the interview was scheduled in, e.g. `"Asia/Singapore"`. May be `""` — treat empty as `"Asia/Singapore"` (Pilot default) or fall back to UTC. |
| `status` | string | Always `"booked"` for queue items. |
| `applicationId` | string (uuid) \| null | Internal application FK. **The application _external_ id is NOT in this payload** — write back by `slotId`. |
| `candidateName` | string | Copied onto the slot at booking time. May be `""`. |
| `candidateEmail` | string | Candidate's real email, copied at booking time. May be `""`. See section 6 on attendees. |
| `bookedAt` | string (ISO 8601) \| null | When the candidate booked. |
| `interviewerName` | string | Present in schema, **currently `""`** in Pilot data (nothing populates it yet). |
| `interviewerEmail` | string | Present in schema, **currently `""`**. |
| `hodName` | string | Present in schema, **currently `""`**. |
| `hodEmail` | string | Present in schema, **currently `""`**. |
| `calendarEventId` | string | Always `""` for queue items (that is the filter). |
| `calendarEventLink` | string | Always `""` for queue items. |
| `calendarEventStatus` | string | `""`, or `"failed"` if a previous attempt failed (failed slots stay in the queue for retry). |
| `calendarEventError` | string | Last failure message, or `""`. |
| `createdAt` | string (ISO 8601) | Row creation. |
| `updatedAt` | string (ISO 8601) | Last update. |

**Not present in this payload** (do not reference from n8n expressions — they do
not exist here): role title, job description, venue / address / location,
application external id, candidate phone.

> **Venue/address:** there is no location column on `interview_slots` and the
> queue query does not join recruitment setup. If a physical venue string is
> required on the Calendar event, it must be sourced separately (e.g. a fixed
> Pilot test-venue constant in the n8n workflow, or a follow-up enhancement that
> adds a `location` column / joins role setup). For controlled Pilot testing use
> a constant test-venue string — see section 6.

---

## 4. Exact POST request contract

`POST /api/internal/recruitment/bookings/calendar`

Headers: auth header (section 2) + `Content-Type: application/json`.

### Accepted body fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `slotId` | string | one of `slotId` / `slotCode` / (`applicationExternalId`+`interviewType`) | Slot `id` from the GET payload. **Preferred.** |
| `slotCode` | string | " | Alternative slot lookup by `slot_code`. |
| `applicationExternalId` | string | " | Alternative lookup; **requires** `interviewType` and resolves to the most recently booked matching slot. Not usable straight from the GET payload (no external id there). |
| `interviewType` | `"voice"` \| `"final"` | with `applicationExternalId` | Only `"final"` is meaningful here. |
| `status` | `"created"` \| `"updated"` \| `"failed"` \| `"skipped"` | yes | See semantics below. |
| `eventId` | string | on success | Google Calendar event id. |
| `eventLink` | string | optional | Google Calendar `htmlLink`. |
| `error` | string | on `"failed"` | Failure message to persist; defaults to `"calendar_event_failed"` if omitted. |

### Validation

The request is rejected `422 { "ok": false, "error": "target_and_status_required" }` unless:

- at least one valid target is present (`slotId` **or** `slotCode` **or**
  `applicationExternalId` + a valid `interviewType`), **and**
- `status` is one of `created` / `updated` / `failed` / `skipped`.

Unknown fields are ignored. `eventId` / `eventLink` / `error` that are not strings
are treated as absent.

### Success body

```json
{
  "ok": true,
  "migrated": true,
  "updated": true,
  "duplicate": false,
  "eventId": "abcdef123456",
  "error": null
}
```

### Status codes

| HTTP | When | body |
|---|---|---|
| `200` | slot resolved and processed (including idempotent no-op / duplicate rejection) | `{ ok:true, updated, duplicate, eventId, error? }` |
| `401` / `403` / `503` | auth / config (section 2) | `{ ok:false, error }` |
| `404` | no slot matched the target | `{ ok:false, error:"slot_not_found" }` |
| `422` | body failed validation | `{ ok:false, error:"target_and_status_required" }` |
| `500` | unhandled server error | `{ ok:false, error:"internal_error" }` |

### `status` semantics (`markInterviewCalendarEvent`)

- **`created`** — first successful event. Persists `calendar_event_id`,
  `calendar_event_link`, sets `calendar_event_status = "created"`, clears
  `calendar_event_error`. Slot leaves the queue.
- **`updated`** — an event was modified (e.g. reschedule). Overwrites
  `calendar_event_id` / link even if one already exists, sets status `"updated"`.
- **`failed`** — records `calendar_event_status = "failed"` and
  `calendar_event_error`. **Does not write `calendar_event_id`.** The slot stays
  in the GET queue and is retryable. `updated` in the response is `true`
  (the failure was recorded), `duplicate` is `false`.
- **`skipped`** — like `created` but status is `"skipped"` (event id still stored
  if provided). Use only if you deliberately decide a slot needs no event.

### Idempotency / retry (see also section 8)

| Slot state | Incoming | Result |
|---|---|---|
| no event id | `created` + `eventId` | event id stored → `updated:true, duplicate:false` |
| has event id `X` | `created` + `eventId: X` (same) | no-op → `updated:false, duplicate:true, error:null` |
| has event id `X` | `created` + no `eventId` | no-op → `updated:false, duplicate:true, error:null` |
| has event id `X` | `created` + `eventId: Y` (different) | **rejected** → `updated:false, duplicate:true, error:"calendar_event_already_recorded"`, `eventId:"X"` (HTTP still `200`) |
| has event id `X` | `updated` + `eventId: Y` | overwritten → `updated:true, duplicate:false` |
| any | `failed` | error recorded, id untouched, slot retryable |

The lookup + update runs in a single DB transaction with `SELECT … FOR UPDATE` on
the slot row, so two concurrent replays serialize and cannot both write.

---

## 5. n8n node chain

Workflow name suggestion: **`Pilot Target — F2F Calendar`**. Keep it **inactive**;
run it only via Manual Execute during controlled tests.

```
[Manual Trigger]  (or [Schedule Trigger] when promoted to steady-state)
      │
      ▼
[HTTP Request: GET calendar queue]
      │
      ▼
[If: items present?]  ── false ──▶ [NoOp: nothing to do] (end)
      │ true
      ▼
[Split Out: items]
      │  (one item per booked F2F slot)
      ▼
[Google Calendar: Create Event]
      │
      ├── success ──▶ [HTTP Request: POST created]  ──▶ [NoOp: done] (end)
      │
      └── error   ──▶ [HTTP Request: POST failed]   ──▶ [NoOp: recorded, retryable] (end)
```

Enable **Settings → "Continue On Fail"** on the *Google Calendar: Create Event*
node (or wrap in an Error Trigger branch) so a Calendar failure routes to the
*POST failed* node instead of aborting the run.

### Node 1 — Manual Trigger

- **Purpose:** operator-controlled start for controlled testing.
- **Output:** one empty item.
- Promote to **Schedule Trigger** (e.g. every 5 min) only after the controlled
  test in section 9 passes and the workflow is approved for steady-state.

### Node 2 — HTTP Request: GET calendar queue

- **Purpose:** read the work queue.
- **Method:** `GET`
- **URL:** `https://ella-recruitment-portal-pilot.vercel.app/api/internal/recruitment/bookings/calendar`
- **Authentication:** Generic → **HTTP Header Auth** → credential **`Ella Pilot Internal API`**
  (header `Authorization`, value `Bearer <INTERNAL_API_SECRET>`).
- **Options:** Response → "Never Error" off (a non-2xx here should stop the run);
  Full Response off.
- **Expected output:** `{ ok: true, migrated: true, items: [...] }`.

### Node 3 — If: items present?

- **Purpose:** stop cleanly when the queue is empty.
- **Condition:** `{{ $json.items.length }}` **is not empty** / greater than `0`.
- **true →** Node 4. **false →** NoOp (end).

### Node 4 — Split Out: items

- **Purpose:** fan out to one run per slot.
- **Field to Split Out:** `items`
- **Output:** each item's fields become the item root (`$json.id`,
  `$json.startsAt`, …).

### Node 5 — Google Calendar: Create Event

- **Purpose:** create exactly one event per slot.
- **Resource:** Event · **Operation:** Create
- **Calendar:** the **Pilot / test calendar** (see section 7). Never a production
  calendar.
- **Credential:** the Pilot Google Calendar OAuth2 credential.
- **Field mapping:** section 6.
- **Options:** do **not** enable "Use Default Reminders" changes unless required;
  set **Send Updates / Send Notifications = "none"** during Pilot testing so no
  invite email is sent to the candidate.
- **Settings:** "Continue On Fail" = **on** (so failures reach Node 7).
- **Expected output (success):** an event object including `id` and `htmlLink`.

### Node 6 — HTTP Request: POST created

- **Purpose:** persist the event id back to Postgres.
- **Method:** `POST`
- **URL:** `https://ella-recruitment-portal-pilot.vercel.app/api/internal/recruitment/bookings/calendar`
- **Authentication:** HTTP Header Auth → **`Ella Pilot Internal API`**
- **Body (JSON):**
  ```
  {
    "slotId": "={{ $('Split Out: items').item.json.id }}",
    "status": "created",
    "eventId": "={{ $json.id }}",
    "eventLink": "={{ $json.htmlLink }}"
  }
  ```
  (`$json` here is the Google Calendar node output; `slotId` is pulled from the
  Split Out item so the mapping survives item pairing.)
- **Expected output:** `{ ok:true, updated:true, duplicate:false, eventId:"…" }`
  on first write, or `{ updated:false, duplicate:true }` on replay.

### Node 7 — HTTP Request: POST failed

- **Purpose:** record a Calendar failure without losing the slot.
- **Method:** `POST` · **URL:** same as Node 6 · **Auth:** same.
- **Body (JSON):**
  ```
  {
    "slotId": "={{ $('Split Out: items').item.json.id }}",
    "status": "failed",
    "error": "={{ $json.error?.message || $json.error || 'calendar_create_failed' }}"
  }
  ```
- **Expected output:** `{ ok:true, updated:true, duplicate:false }`. The slot
  keeps `calendar_event_id = ''` and is returned by the next GET.

---

## 6. Google Calendar field mapping

All source fields are from the **Split Out item** (a GET queue element, section 3).

| Calendar field | Expression / value | Notes |
|---|---|---|
| Start | `={{ $json.startsAt }}` | ISO 8601 UTC from Postgres. |
| End | `={{ $json.endsAt }}` | ISO 8601 UTC. |
| Time zone | `={{ $json.timezone || 'Asia/Singapore' }}` | `timezone` may be `""`; fall back to the Pilot default (or `'UTC'`). |
| Summary / title | `={{ 'F2F Interview — ' + ($json.candidateName || 'Candidate') + ' — ' + ($json.roleExternalId || 'Role') }}` | No role *title* in payload; use `roleExternalId`. |
| Description | see block below | |
| Location | **constant Pilot test venue string** (e.g. `"PILOT TEST — McLink Group Office (test event, do not attend)"`) | No venue field in the contract. Do not fabricate a real address. |
| Attendees | **none during Pilot testing** | See warning below. |
| Send updates / notifications | `none` | Prevents any email to the candidate. |

Description block:

```
Pilot test calendar event — face-to-face interview.

Candidate: {{ $json.candidateName }} <{{ $json.candidateEmail }}>
Role: {{ $json.roleExternalId }}
Slot ID: {{ $json.id }}
Scheduled: {{ $json.startsAt }} – {{ $json.endsAt }} ({{ $json.timezone }})
Interviewer: {{ $json.interviewerName || 'TBD' }}

Generated by n8n workflow "Pilot Target — F2F Calendar".
```

> **Attendees — Pilot safety.** `candidateEmail` is the candidate's **real**
> address. Adding it as an attendee causes Google to email a real invite, which
> violates the "all test mail only to `cs6@mclinkgroup.com`" rule. During
> controlled Pilot testing:
> - add **no attendees**, or
> - add **only** `cs6@mclinkgroup.com` as the sole attendee, and
> - set **Send Updates = none**.
> Real candidate attendees are a post-UAT decision, not part of this validation.

---

## 7. Safe Pilot rules

- **Pilot only.** Base URL `ella-recruitment-portal-pilot.vercel.app`. Never call
  `ella-recruitment.mclinkgroup.com` or any production host.
- **Production untouched.** No production n8n workflow is edited, activated, or
  executed.
- **Google Calendar:** use a dedicated **Pilot / test calendar** only. Never the
  production McLink calendar. Confirm the calendar id in Node 5 before running.
- **Email:** every test email in the wider Pilot validation goes **only** to
  `cs6@mclinkgroup.com`. This Calendar workflow should send **no** calendar
  invites (Send Updates = none, no real attendees).
- **Voice:** unrelated to this workflow; Vapi stays dry-run, zero real calls.
- **Workflow state:** all 13 target workflows start and end **inactive**
  (`13 / 0 active`). Activate/execute **only** `Pilot Target — F2F Calendar`, and
  only via Manual Execute, for the duration of the test; return it to inactive
  afterwards.

---

## 8. Idempotency / replay safety

Implemented in `markInterviewCalendarEvent()` (transactional, `SELECT … FOR UPDATE`):

1. **First success:** slot has `calendar_event_id = ''` → the incoming `eventId`
   is stored, status `"created"`, error cleared. The slot no longer matches the
   GET filter, so a later run does not see it.
2. **Replay, same event id:** `created` + `eventId` equal to the stored id →
   no-op. Response `updated:false, duplicate:true, error:null`. No DB write.
3. **Replay, no event id:** `created` with no `eventId` while one is stored →
   no-op, same as above.
4. **Replay, different event id:** `created` + a *different* `eventId` →
   **rejected**, `error:"calendar_event_already_recorded"`, the stored id is
   returned unchanged. This is the guard against a second Google event being
   recorded. (If a duplicate event was actually created in Google by mistake, it
   must be deleted in Google Calendar manually — the API only refuses to *record*
   it.)
5. **Failure:** `failed` → records `calendar_event_status='failed'` +
   `calendar_event_error`, leaves `calendar_event_id` empty → slot is returned by
   the next GET → retryable. Never silently completed.
6. **Reschedule:** `updated` + new `eventId` → overwrites the stored id.

### Replay test procedure

1. Run the workflow once for a fresh booked F2F slot. Record the returned
   `eventId` and confirm Postgres `calendar_event_id` matches (section 9 E–F).
2. **Do not** create a new slot. Manually execute the workflow again.
3. Expected: Node 2 GET `items` no longer contains that slot (it left the queue),
   so Node 3 `If` routes to NoOp. **No second Google event is created.**
4. To exercise the POST guard directly, send a manual POST with the same `slotId`
   and a **different** `eventId` and `status:"created"`:
   expect `200 { updated:false, duplicate:true, error:"calendar_event_already_recorded" }`.
5. Send the same `slotId` with the **same** `eventId`: expect
   `200 { updated:false, duplicate:true, error:null }`.

---

## 9. Controlled test procedure (person with n8n access)

**A. Confirm Pilot serves `57ef505`**
- `GET https://ella-recruitment-portal-pilot.vercel.app/api/internal/recruitment/bookings/calendar`
  with no auth → expect `401`.
- `GET …/bookings/calendar-does-not-exist` → expect `404`.
- (Optional) with the `Ella Pilot Internal API` header → expect
  `200 { ok:true, items:[…] }`.

**B. Confirm workflow starts inactive**
- In n8n, all 13 target workflows show **Inactive**. Note the list as evidence
  (`13 / 0 active`).

**C. Create / identify one synthetic booked F2F slot with no event id**
- Use the target booking API (or an existing synthetic F2F booking) so there is a
  row in `interview_slots` with `interview_type='final'`, `status='booked'`,
  `calendar_event_id=''`. Do **not** reuse Scenario C or seeded production-like
  identities for a fresh E2E; a dedicated `QC-CAL-*` slot code is fine.
- Confirm it appears in the GET `items`.

**D. Manually execute the workflow** (`Pilot Target — F2F Calendar`, Manual Trigger).

**E. Capture:**
- n8n execution ID
- Google Calendar event ID (`id`)
- Google Calendar event link (`htmlLink`)
- slot ID used

**F. Verify Postgres write-back**
- Query `interview_slots` for that slot:
  `calendar_event_id` == the captured event ID,
  `calendar_event_link` == the captured link,
  `calendar_event_status` == `"created"`,
  `calendar_event_error` == `""`.
- Confirm the slot no longer appears in a fresh GET.

**G. Run the workflow again** (Manual Execute, no new slot).

**H. Verify no second event**
- Node 3 `If` should route to NoOp (queue empty for that slot).
- Google Calendar shows **exactly one** event for that slot.
- (Optional) direct POST replay per section 8 step 4–5.

**I. Test forced Calendar failure**
- Temporarily point Node 5 at an invalid calendar id (or revoke the credential),
  create another `QC-CAL-*` booked F2F slot, execute.
- Node 5 fails → Node 7 `POST failed` runs.

**J. Verify failed state is retryable**
- `interview_slots.calendar_event_status` == `"failed"`,
  `calendar_event_error` populated, `calendar_event_id` still `""`.
- The slot **still appears** in the GET queue.
- Restore the correct calendar id, re-run → event is created, state flips to
  `"created"`.

**K. Return the workflow to inactive.** Re-confirm `13 / 0 active`.

---

## 10. Acceptance criteria

`GOOGLE CALENDAR = PASS` **only if all of the following are observed live:**

- [ ] GET returns the pending booked F2F slot (with a real `id`, `startsAt`,
      `endsAt`, `timezone`, `candidateName`, `roleExternalId`).
- [ ] Exactly **one** Google Calendar event is created (Pilot/test calendar).
- [ ] Event details correct: summary names candidate + role, start/end match
      `startsAt`/`endsAt`, time zone matches `timezone`, description carries slot
      ID + role + candidate, location is the Pilot test-venue constant.
- [ ] POST returns `{ updated:true, duplicate:false, eventId:"…" }`.
- [ ] Postgres `interview_slots.calendar_event_id` equals the returned event ID.
- [ ] `calendar_event_link` persisted (Google returns `htmlLink`).
- [ ] Replay (workflow re-run and/or direct POST) creates **no** second event;
      different-id POST is rejected with `calendar_event_already_recorded`.
- [ ] Forced-failure path records `calendar_event_status='failed'` + error and
      the slot remains in the queue (retryable); recovery run succeeds.
- [ ] Production calendar and production n8n untouched.
- [ ] Workflow returned to **inactive**; final state `13 / 0 active`.

Anything short of this is `PARTIAL` or `FAIL`, not `PASS`.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| GET/POST → `401 invalid_or_missing_internal_secret` | wrong/missing `Authorization` header; credential not attached | Attach `Ella Pilot Internal API`; verify header is `Authorization: Bearer <secret>` or `X-Internal-Secret`. |
| GET/POST → `403 internal_api_entity_not_allowed` | `booking` missing from `INTERNAL_API_ENTITIES` on Pilot | Add `booking` to the Pilot env var and redeploy. |
| GET/POST → `503 internal_api_entities_not_configured` / `…_database_not_configured` | Pilot env misconfigured | Set `INTERNAL_API_ENTITIES` / `DATABASE_URL` on Pilot. |
| GET/POST → `404` on the path itself | deployment behind `57ef505` (stale) | Redeploy Pilot from `main` ≥ `57ef505`; confirm with section 9 A. |
| GET `items` empty | no booked F2F slot without an event id | Create/identify a slot per section 9 C; check `status='booked'`, `interview_type='final'`, `calendar_event_id=''`. |
| Calendar node → "invalid time" / wrong day | `timezone` empty or event fed local time | Send `startsAt`/`endsAt` as the ISO UTC strings from the payload; set the Calendar node time zone from `timezone` (fallback `Asia/Singapore`). |
| Calendar node → auth/permission error | missing/expired Google credential; account lacks write on the calendar | Reconnect the Pilot Google Calendar OAuth2 credential; confirm the account can create events on the test calendar. |
| Event created on the wrong calendar | Node 5 "Calendar" set to primary/production | Set it explicitly to the Pilot test calendar id. |
| Calendar node → invalid attendee | real candidate email added as attendee | Remove attendees or use only `cs6@mclinkgroup.com`; Send Updates = none. |
| POST → `422 target_and_status_required` | missing `slotId` / bad `status`; `slotId` expression resolved empty | Map `slotId` from `$('Split Out: items').item.json.id`; `status` must be `created`/`updated`/`failed`/`skipped`. |
| POST → `404 slot_not_found` | wrong `slotId`, or slot deleted | Re-read GET; use the exact `id`. |
| POST → `200 duplicate:true error:"calendar_event_already_recorded"` | slot already has a different event id (replay with a new Google event) | Expected guard. Delete the extra Google event manually if one was created; the first id stays authoritative. |
| Workflow "succeeds" but `calendar_event_id` still `''` | POST not reached, or `status:"failed"` sent, or `eventId` expression empty | Check the run: Node 6 executed with a non-empty `eventId`; inspect the POST response body. |

---

## 12. Copy-paste build checklist

| # | Node | Type | Method / Op | URL / Calendar | Key config |
|---|---|---|---|---|---|
| 1 | `Start` | Manual Trigger | — | — | promote to Schedule Trigger post-UAT |
| 2 | `GET calendar queue` | HTTP Request | `GET` | `https://ella-recruitment-portal-pilot.vercel.app/api/internal/recruitment/bookings/calendar` | Header Auth cred `Ella Pilot Internal API` |
| 3 | `Has items?` | If | — | — | `{{ $json.items.length }}` > `0` → true; false → NoOp |
| 4 | `Split slots` | Split Out | — | — | Field to split: `items` |
| 5 | `Create Calendar event` | Google Calendar | Event → Create | **Pilot test calendar** | Start `={{ $json.startsAt }}`, End `={{ $json.endsAt }}`, TZ `={{ $json.timezone || 'Asia/Singapore' }}`, Summary `={{ 'F2F Interview — ' + ($json.candidateName||'Candidate') + ' — ' + ($json.roleExternalId||'Role') }}`, Location = Pilot test-venue constant, **no attendees**, Send Updates = none, **Continue On Fail = on** |
| 6 | `POST created` | HTTP Request | `POST` | same as #2 | Header Auth; JSON body `{ "slotId": "={{ $('Split slots').item.json.id }}", "status": "created", "eventId": "={{ $json.id }}", "eventLink": "={{ $json.htmlLink }}" }` |
| 7 | `POST failed` | HTTP Request | `POST` | same as #2 | Header Auth; JSON body `{ "slotId": "={{ $('Split slots').item.json.id }}", "status": "failed", "error": "={{ $json.error?.message || $json.error || 'calendar_create_failed' }}" }` |

Wiring: `1 → 2 → 3`; `3(true) → 4 → 5`; `5(success) → 6`; `5(error) → 7`.
`3(false) → NoOp`. `6 → NoOp(done)`. `7 → NoOp(recorded/retryable)`.

Success branch = #6. Failure branch = #7.

---

*Do not treat this document as evidence that the Calendar integration works.
`GOOGLE CALENDAR = PASS` is earned only by the observed results in sections 9–10.*
