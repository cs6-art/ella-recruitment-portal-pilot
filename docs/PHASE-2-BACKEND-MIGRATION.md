# Phase 2 — backend migration off Google Sheets

The portal runs on Vercel serverless (multi-instance). Several Sheets-era
assumptions are unsafe there — the module-level Sheets cache is per-instance,
Sheets `append()` has no row lock, and Sheets has no atomic increment so
concurrent credit deductions can overspend.

Phase 2 moves critical read/write processes onto **Neon Postgres**, one table
at a time, keeping the Sheets implementation intact and reversible until each
table is proven in production.

## Stack

- **Neon serverless Postgres** — `DATABASE_URL` env var.
- **Drizzle ORM** (`drizzle-orm` + `@neondatabase/serverless`, `neon-http`
  driver) for typed queries. Schema in `src/db/schema.ts`.
- Migrations are plain SQL in `drizzle/*.sql`, applied by a small forward-only
  runner (`src/db/migrate.mjs`) — **run manually**: `npm run db:migrate`.
  (`drizzle-kit` is intentionally not installed; add it later if you want
  `drizzle-kit generate` / `studio`.)
- `src/db/client.ts` creates the client lazily, so `next build` and
  `CREDITS_BACKEND=sheets` work with `DATABASE_URL` unset.

## First pilot table — Ella Credit Ledger

Chosen because it is **portal-only** (no n8n writer), small, append-only, and
hot (the credits meter polls the balance on every page). Postgres gives an
atomic O(1) balance and removes the overspend race.

Tables (`drizzle/0001_init_credit_ledger.sql`):

- `credit_ledger` — immutable audit trail, one row per top-up / deduction.
  `source_entry_id` (the old `LDG-…` id) is unique → every write is idempotent.
- `credit_balance` — a single row (`id = 1`); the authoritative current balance.

Every write moves `credit_balance` and appends to `credit_ledger` in **one
atomic SQL statement**. A guarded deduction that would go negative appends
nothing and raises `EllaCreditsError`.

### Backend switch — `CREDITS_BACKEND`

| Value | Behaviour |
|---|---|
| `sheets` (default) | Original Google Sheet ledger only. |
| `dual` | Sheets stays authoritative; every write is mirrored to Postgres best-effort; balance divergence is logged (`[Credits] Divergence …`). Reads still come from Sheets. |
| `postgres` | Neon Postgres authoritative — atomic, no overspend. Sheets not touched. |

The public API (`getCreditBalance`, `assertCreditsAvailable`, `recordDeduction`,
`recordTopUp`, …) and every caller are identical in all three modes.

## Cutover sequence

1. Set `DATABASE_URL` (Neon) in Vercel — **all** environments — and in local
   `.env.local`. Deploy with `CREDITS_BACKEND` unset (`sheets`). Zero behaviour
   change; the code is just present.
2. `npm run db:migrate` from your machine against the prod `DATABASE_URL`.
3. `npm run db:backfill:credits` — copies the live Sheet ledger into Postgres
   and sets `credit_balance`. It prints the sheet sum vs the Postgres balance
   and exits non-zero on mismatch. Idempotent — safe to re-run.
4. Set `CREDITS_BACKEND=dual`, redeploy. Watch the logs for
   `[Credits] Divergence` / `Postgres mirror write failed` for 24-48h. Re-run
   the backfill's compare (step 3) any time to reconcile.
5. When clean: `CREDITS_BACKEND=postgres`, redeploy. Postgres is now
   authoritative and atomic. The Sheet ledger is frozen (kept as history).

## Rollback

- Before step 5: set `CREDITS_BACKEND=sheets`, redeploy. Done.
- After step 5: Postgres has rows the Sheet doesn't. First append the
  postgres-only entries back to the `Ella_Credit_Ledger` sheet (any row whose
  `source_entry_id` is newer than the last sheet `Entry_ID`), verify the sums
  match, then set `CREDITS_BACKEND=sheets` and redeploy.

## Next tables (not started)

Confirmed portal-only, safe to follow the same pattern once the ledger is
stable: `Calendar_Connections` (OAuth tokens), `Resume_Screening_Invitations`,
`Settings`/portal-config, `Recruitment_Templates`. The dual-written core
(`Role_Requests`, `High_Match_Profile`, `Interview_Slots`, `*_Status_History`,
`Bulk_Resume_Queue`) needs coordinated pilot-n8n changes and is a later wave.

## n8n blocking (separate track)

Routes that block on a synchronous n8n round-trip before responding: create
role (15s), status transition (15s), recruitment setup / publish (45s),
parse-description (45s), and — the worst — **HR manual intake + public
application**, which await n8n's synchronous AI CV screening with **no
timeout** (`sendCandidateApplicationWebhook` in `src/lib/applicant-workflow.ts`).

Portal-side fix: bound that fetch with an `AbortController`
(`N8N_CANDIDATE_APPLICATION_TIMEOUT_MS`, default 60s). Real fix: a **new pilot
workflow** that acknowledges immediately and does screening asynchronously,
with the portal reading the result from `High_Match_Profile` on its next poll
(the queue-poll pattern the bulk flow already uses). Pilot n8n work — see
`docs/PHASE-1-N8N-CHANGES.md` conventions.

---

# Phase 2 closeout — 2026-08-31

Pilot scope confirmed with the operator:
- treat the **8-file upload cap** as the accepted pilot mitigation for the
  request-timeout risk;
- **do not** build the full async / background-drain now;
- keep `CREDITS_BACKEND=dual`; no `postgres` cutover without approval.

## 1. Backend migration status — CONFIRMED

Verified live (Neon + Sheets read):

| Item | State |
| --- | --- |
| Neon/Postgres foundation | ✅ complete — `_migrations`, `credit_balance`, `credit_ledger`; indexes: PKs, `credit_ledger_source_entry_id_key` (idempotency), `credit_ledger_entry_time_idx` |
| Ella Credit Ledger migrated | ✅ complete — `CREDITS_BACKEND=dual`, mirror write on every ledger op |
| Dual-write validated | ✅ Neon `credit_balance` **== 11** and Sheet `Ella_Credit_Ledger` sum **== 11** at closeout; 12 rows each; reconciles after a real top-up + 3 deductions + an adjustment earlier today |
| Remaining Sheets-backed processes | 🟳 intentionally deferred — **no other tables migrated**; nothing else moved today (no critical blocker required it) |

## 2. n8n optimisation status — MITIGATED (no rewrite)

Current pilot mitigation stack for the bulk intake request:

| Control | Value | Where |
| --- | --- | --- |
| Screening concurrency | 2 (hard max) | `MAX_CONCURRENCY` |
| Per-file start stagger | 10 s after the first 2 | `WORKER_START_INTERVAL_MS` |
| Files per submission | **8** (UI + server `422`) | `MAX_FILES_PER_SUBMISSION` |
| **Per-file webhook timeout** | **60 s** (`N8N_BULK_RESUME_TIMEOUT_MS`, default) — **added 2026-08-31** | `bulk-resume-intake.ts` |

The per-file webhook was previously **unbounded** (unlike the single-application
path). It now aborts at 60 s → that one file fails, the batch continues — one
stuck n8n execution can no longer hang the whole serverless function.

**Not done (by decision):** moving dispatch off the request.

### Post-freeze roadmap item — "202-then-background-drain"

Return `202` immediately after `assertCreditsAvailable` + the `Processing`
queue-row write; run the staggered worker pool in a background task / Vercel
Cron drain; the UI already reads terminal status from the queue poll. Removes
the in-request time ceiling entirely and lets `MAX_FILES_PER_SUBMISSION` return
to 25. Pairs with the R1 `reconcileBulkResumeQueue` cron. **Deferred to after
Code Freeze.**

## 3. Performance verification — timed 2 / 5 / 8 runs

Method: `POST /api/resume-screening/drive/import` on the deployed pilot with
2, then 5, then 8 distinct resume file IDs; record HTTP round-trip, time to all
queue rows terminal, any client error/timeout, orphaned `Processing`, credits
charged.

| Batch | Request→HTTP | →all terminal | Client error? | Orphaned Processing? | Credits charged | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2 files | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | 2-file imports run earlier today (F1 tests) returned `202` promptly with no timeout |
| 5 files | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | |
| 8 files | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ | |

**Status: NOT RUN — blocked.** The `MCLINK_TEST_SESSION` token expired (401 from
`/api/session`; a redeploy today rotated the signing context). Needs a fresh
`mclink_session` cookie in `.env.local` + a Drive folder with ≥ 8 distinct
throwaway resume PDFs. Balance is 11 (enough for the pre-flight check on all
three runs).

Code-derived expectation (unchanged): in-request wall time ≈ `(N−2) × 10 s`
stagger + per-file work; 8 files ≈ 60–75 s if files screen fast, bounded per
file at 60 s. A client-visible timeout at ≤ 8 files is unlikely but unconfirmed.

## 4. Phase 2 exit assessment vs URS criteria

| URS Phase 2 exit criterion | Classification | Reason |
| --- | --- | --- |
| Critical backend operations no longer depend **fully** on Google Sheets | **Complete with pilot mitigation** | The credit ledger — the one item with an overspend race — is on Postgres (dual). All other tables remain on Sheets by explicit pilot scope. |
| n8n workflows do not **unnecessarily** block the frontend | **Complete with pilot mitigation** | Concurrency 2 + 10 s stagger + 8-file cap + new 60 s per-file webhook bound. Not eliminated — the request still awaits screening — but bounded and capped. Full async dispatch deferred post-freeze. |
| Screening / parsing / notification **latency improved** | **Complete with pilot mitigation** | O(1) atomic credit balance replaces summing the whole Sheet ledger; per-file webhook no longer unbounded. End-to-end batch latency unchanged pending the async drain. Empirical 2/5/8 numbers **pending** (§3). |
| Existing records **remain intact** | **Complete** | Sheets untouched as the authority; Neon `credit_balance` == Sheet sum == 11; 12 rows each; no data migrated destructively. |
| Performance **verification** (compare vs current workflow) | **Blocked** | Timed 2/5/8 run not executed — expired session token (§3). |

## 5. Remaining risks

- **R-P2-1** (low, mitigated): a batch of 8 files that each screen slowly could
  still approach the platform function budget. Bounded per file at 60 s;
  practical ceiling ~8×concurrency-adjusted. Confirm with §3.
- **R-P2-2** (accepted): `MAX_FILES_PER_SUBMISSION = 8` is a usability
  constraint — HR runs multiple batches for large intakes until the async drain
  lands.
- **R-P2-3** (tracked, R1): stale `Processing` rows are only reconciled at read
  time, not persisted. Non-blocking; `reconcileBulkResumeQueue` cron is the fix.
- **R-P2-4** (open): the per-instance Sheets cache / rate-limiter are still not
  multi-instance safe for the tables that remain on Sheets. Out of Phase 2
  pilot scope; part of the later migration wave.

## 6. Validation gate (2026-08-31, HEAD after the webhook-timeout change)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | ✅ 0 errors |
| `eslint src tests` | ✅ 0 errors (8 pre-existing warnings) |
| `node --test tests/*.test.mjs` | ✅ 164 / 164 |
| `next build` | ✅ compiled successfully |

## 7. Verdict

**PARTIAL** — pending one deliverable.

Everything substantive is **Complete** or **Complete with pilot mitigation**:
the Postgres foundation and credit-ledger migration are done and dual-write
reconciles live; the n8n-blocking risk is mitigated (concurrency + stagger +
8-file cap + new 60 s per-file webhook bound); records are intact.

The single open item is the **performance verification** — the timed 2/5/8
batch run — which could not be executed because the pilot session token
expired. It flips to **COMPLETE WITH PILOT MITIGATION** the moment that run
completes with no client-visible timeout (the code math and today's 2-file
imports both point that way).
