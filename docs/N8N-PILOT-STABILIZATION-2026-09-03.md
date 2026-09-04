# Pilot n8n stabilization — 2026-09-03

Pilot-only. No production workflow was edited. Companion to
`PILOT-PROD-ISOLATION.md` (§Quota remediation).

## The four failing workflows

| Workflow | ID | Action taken | Verification |
|---|---|---|---|
| Voice Booking Invitations | `gGTvRHKaHTX95y0b` | **Fixed + published.** 5 Google Sheets nodes had `documentId` pointing at the candidate workbook `1kUl6l…`, which has no `High_Match_Profile` tab → `Sheet with ID 1396336152 not found` every run. Repointed all 5 to the main pilot workbook `1tiPTyCWwMQ…`; the sheet gid `1396336152` was already correct. `maxTries` 4 → 2. | Manual run green; scheduled runs 01:46Z & 01:51Z green; all prior runs errored. |
| HR Approval Notifications | `fBL9aYz5PNne0jh6` | **Fixed + published.** Same defect across 9 Google Sheets nodes. Repointed all 9; `maxTries` 4 → 2. | Manual run green; scheduled runs 01:47Z & 01:52Z green; all prior runs errored. |
| Scheduled Voice Calling (runaway) | `cTJHm2ZAJQap7uWW` | **Unpublished.** Was producing 752 error executions, overlapping (6-min runs on a 5-min cron) → a Google Sheets 429 retry storm on the shared `ELLA PILOT` service account. Routing was already correct. Set `retryOnFail=false` on all 14 Google Sheets nodes + the Vapi HTTP node (retries 4 → 1, per instruction). **Kept OFF** until `29HvXI7H` is green and the shared read budget recovers. | n/a — deliberately stopped. |
| Voice Result Status Sync | `29HvXI7H4eKUJ1Uv` | **Unresolved.** See structural analysis below. Config is already correct. Classified `SUSPECTED 429 — exact current error body unavailable` (the n8n MCP drops every `includeData` call this session). | Every scheduled run still errors (~60–75 s, 309 error executions, before and after changes). |

**Verified spreadsheet facts (via the Sheets API, service account `recruitment-portal-sheets@…`):**

- `High_Match_Profile` (gid `1396336152`) exists **only** in the main pilot
  workbook `1tiPTyCWwMQGnXdCpFle70wmfHJNz6YZ2_bWFVqOxko4`
  ("Ella AI Agentic Agent Logs Pilot").
- The candidate workbook `1kUl6lrwxanKPvGifcE1uF5NuJ9fseJb_L5nKN3YM78g`
  ("McLink Recruitment System Pilot") holds `Role_Requests`, `User_Directory`,
  `Role_AI_Settings`, `Settings`, `Calendar_Connections`, etc. — **no**
  `High_Match_Profile`.
- Neither workbook contains an `Ella_Credit_Ledger` tab (see
  `CREDITS-DUAL-WRITE-SOAK.md` / the P3 config fix).

## `29HvXI7H4eKUJ1Uv` — structural analysis (from the workflow JSON, not execution logs)

6 nodes: `Voice Result Status Polling` (cron `30 9/10 * * * *` — every 10 min at
:09:30/:19:30/…) → `Read Applicant Profiles` → `Read Voice Interview Results` →
`Read Voice Call Queue for Sync` → `Find Terminal Voice Results` (Code) →
`Mark Voice Interview Completed` (Sheets update).

| Check | Finding |
|---|---|
| Wrong workbook | **No.** All 4 Sheets nodes use `documentId` = main pilot workbook in `id` mode, `sheetName` in `name` mode. `High_Match_Profile`, `Voice_Interview_Results`, `Voice_Call_Queue` all exist there. |
| Bad ranges | **No.** `name` mode, no explicit A1 ranges. |
| Duplicate scheduling | **No.** The prod `Voice Result Status Sync` (`JKv9cdP7ihejhl9D`) is tagged `recruitment-prod` on prod credentials — a separate instance, not a pilot duplicate. |
| Retry loop / SplitInBatches | **No** internal loop. |
| Filters returning excessive rows | **N/A** — but see "excessive reads". |
| **Excessive reads** | **Yes — the likely trigger.** All three read nodes do an **unfiltered full-tab read** every run: the entire `High_Match_Profile`, the entire `Voice_Interview_Results`, and the entire `Voice_Call_Queue`. Three large sequential reads on the same `ELLA PILOT` service account inside a ~10-second window. When the pilot poller fleet is also active this bursts past the ~60 reads/min/user Sheets quota → `HTTP 429`. |
| Retry config | `retryOnFail: true`, `maxTries: 2`, `waitBetweenTries: 5000`. **Anti-pattern:** both attempts (call + 5 s + call) land inside the *same* rate-limit minute, so a 429 fails both. A ~40–70 s total across three retrying reads matches the observed ~60–75 s failure duration. |
| Error handling | No `onError` on any node — one read blip fails the whole run and writes nothing; the next cron tick (10 min later) retries from scratch. Acceptable for a reconciler, but under **sustained** 429 it means sustained failure with zero progress. |
| `Mark Voice Interview Completed` | `mappingMode: defineBelow`, `matchingColumns: ["Application ID"]`, `schema: []`. Only executes when `Find Terminal Voice Results` emits ≥1 item; an empty schema maps by header name and is not the failure (the run dies earlier, in a read). |

### Recommended actions (in order)

1. **External — durable:** raise the Google Sheets API quota
   ("Read requests per minute per user", → 300–600) for GCP project
   `mclink-recruitment-portal-p2`. This fixes the whole 429 class, not just this
   workflow. **BLOCKED-MANUAL** (needs GCP console access).
2. **n8n — safe mitigation APPLIED 2026-09-03 (published):** `retryOnFail: false`
   on the three read nodes. Run time dropped from ~60–75 s to ~36 s (the two
   5 s retry waits are gone), confirming the retries were adding no value. The
   run **still errors at ~36 s on the first attempt of a read** — so the cause
   is *deterministic*, i.e. sustained quota exhaustion from the poller fleet
   (or another hard Sheets error), not a transient blip that a retry would
   clear. This makes item 1 (the quota increase) the required fix, not
   optional. No logic change was made.
3. **n8n — reduce read volume:** add a `filtersUI` "read matching" on
   `Read Applicant Profiles` for `Status 2 (Voice Interview)` in an active set
   (`Scheduled`, `Calling`, `Initiated`, `In Progress`). n8n still reads the tab
   server-side, so this is a payload/parse win, not an API-quota win — item 1 is
   the quota fix.
4. **Durable — migrate off Sheets:** point this workflow at
   `GET /api/internal/recruitment/voice/results?ids=…` +
   `GET /api/internal/recruitment/voice/queue` (see
   `N8N-SHEETS-TO-API-MIGRATION.md`). Removes all three Sheets reads.

### Re-enable sequence for `cTJHm2ZAJQap7uWW`

Keep it unpublished until: (a) item 1 above is done **or** `29HvXI7H` has one
clean run, then (b) publish, (c) require one green execution before considering
the fleet stable. Do not re-enable it while `29HvXI7H` is still erroring — they
share the same service-account read budget.
