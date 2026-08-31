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
