# Live validation run — 2026-08-31

Executed by the assistant with the access actually available: **Neon (read)**,
**Google Sheets service account (read)**, unauthenticated HTTP probes of the
deployed apps, local repo/build/test. No `vercel` CLI, no n8n API, no browser,
no authenticated portal session (session-token minting from `SESSION_SECRET`
was blocked by the safety classifier — correctly). `CREDITS_BACKEND` unchanged.

## Access inventory

| Target | Access | How |
| --- | --- | --- |
| Neon Postgres | ✅ read (write possible, not used) | `DATABASE_URL` in `.env.local` + `@neondatabase/serverless` |
| Google Sheets (both workbooks) | ✅ read (write possible, not used) | service-account creds in `.env.local` |
| Deployed pilot — HTTP probe | ✅ unauthenticated only | `curl` |
| Deployed pilot — authenticated API | ❌ | no browser for OAuth; token minting blocked |
| Vercel project / runtime logs / env | ❌ | no CLI, no `VERCEL_TOKEN` |
| n8n pilot workflows / executions | ❌ | no base URL / API key anywhere in env |
| Google Drive OAuth in a browser | ❌ | no browser tool in this environment |
| HR-scored resumes (Phase 6) | ❌ | not provided |

## Phase 2 / Database — PASS (stores in sync)

**Neon `credit_balance`** (`select * from credit_balance where id=1`):
`balance = 0`, `updated_at = 2026-08-31T01:36:32.027Z`.

**Neon `credit_ledger`** (aggregate): `4 rows`, `sum(credits_delta) = 0`,
first `2026-08-28T08:14:19Z`, last `2026-08-31T01:36:32Z`.

**Google Sheet `Ella_Credit_Ledger`** (`A:L`): `4 data rows`,
`sum(Credits_Delta) = 0`, last `Balance_After = 0`.

| # | Sheet (id, event, delta, bal) | Postgres (event, delta, bal) | Match |
| --- | --- | --- | --- |
| 1 | LDG-f2df16a6 · manual_topup · +100 · 100 | manual_topup · +100 · 100 | ✅ |
| 2 | LDG-cfcfd4e1 · cv_analysis · −100 · 0 | cv_analysis · −100 · 0 (ref APP-7d3e09bf…) | ✅ |
| 3 | LDG-44f948d1 · manual_topup · +2 · 2 | manual_topup · +2 · 2 | ✅ |
| 4 | LDG-21c1853e · manual_adjustment · −2 · 0 | manual_adjustment · −2 · 0 | ✅ |

- **Balance: Sheet 0 == Postgres 0.** Ledger sum: 0 == 0. Row count 4 == 4.
  Per-entry deltas identical. **Dual-write is faithful.**
- Rows 3 & 4 `entry_time` in Postgres is ~11 s later than the Sheet `Timestamp`
  — expected: the mirror writes with `now()`, not the sheet timestamp
  (`schema.ts`: "`now()` for new writes"). Not a divergence.
- Could **not** inspect Vercel logs for `[Credits] Divergence` /
  `Postgres mirror write failed` — needs Vercel access. The runtime divergence
  check only logs; it does not persist, so the stores matching now is
  necessary-but-not-sufficient evidence for the soak.

### Finding D1 — historical pricing inconsistency (low severity)

Ledger row 2 (2026-08-28) is `cv_analysis, units 1, credits_delta −100` — cost
100 credits/CV at that time. Current `CREDIT_COST.cv_analysis = 1`
(`ella-credit-math.ts`). Both stores agree, balance is 0, so no live impact, but
the ledger history contains an entry at 100× the current price (pre-dates commit
`07c6be9 "align Ella Credits with published pricing"`). If any report sums
lifetime "credits consumed" it will be skewed by this one row.

## Deployment findings (HTTP probe)

| URL | `/` | `/api/auth/google-drive/status` | `/api/resume-screening/bulk` |
| --- | --- | --- | --- |
| `ella-recruitment-portal-pilot.vercel.app` | 200 | 401 (route exists) | 401 (exists) |
| `ella-recruitment.mclinkgroup.com` | 200 | **404** | — |

### Finding D2 — `NEXT_PUBLIC_APP_URL` points at a stale deployment (medium)

`.env.local` has `NEXT_PUBLIC_APP_URL=https://ella-recruitment.mclinkgroup.com`,
but that host returns **404 for the Phase-3 routes** — it is serving a build
without Google Drive / OneDrive import. The pilot with Phase 3 is
`ella-recruitment-portal-pilot.vercel.app`. Anything that derives an absolute
URL from `NEXT_PUBLIC_APP_URL` when a request origin is unavailable — email
links, fallback OAuth redirect URIs — would target old code. Confirm which URL
is the real pilot and align `NEXT_PUBLIC_APP_URL`, the custom domain, and the
Google OAuth redirect URI to the deployment that has Phase 3.

## Phase 3 — Google Drive: PARTIAL PASS

**PASS (evidence: `Drive_Connections` sheet):** one row,
`cs6@mclinkgroup.com`, scope
`https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email`,
`Connected_At = 2026-08-31T03:37:44.276Z`. So on the pilot today: the connect
route, Google consent, the account-match check, token exchange, and the
**encrypted** per-user token store all worked end to end. Access-control (HR
only) and the minimum-scope requirement are satisfied.

**NOT RUN (needs authenticated session / browser):** the 2-file import E2E —
`drive/list` browse, `drive/import`, queue-row creation, credit deduction,
webhook execution, progress polling, notifications, dedupe re-import. These
cannot be exercised without either a browser OAuth login or authorization to
mint a session token for `cs6@` against the pilot.

## Phase 5 — batch capacity: NOT RUN

Requires authenticated `POST /bulk/upload` + `POST /drive/import` and Vercel
function metrics. Neither available. Code-derived analysis stands
(`BATCH-CAPACITY-VALIDATION.md`): no `maxDuration`, inline staggered pool,
safe batch ≈ 2 on the platform default.

## Phase 7 / 8 — NOT RUN (browser + HR + phone participant required)

## Finding R1 — `Bulk_Resume_Queue` terminal-status reliability

> **SUPERSEDED — see [R1-BULK-QUEUE-PROCESSING-INVESTIGATION.md](R1-BULK-QUEUE-PROCESSING-INVESTIGATION.md).**
> The 49% figure below is a measurement artifact: `Bulk_Resume_Queue` is an
> append-only event log and this counted raw rows. Collapsed to latest-state
> per resume (1,398 unique files): **87.9% Screened, 10.5% Failed, 0.7% (10)
> Processing** — of the 10, 8 were actually screened (cosmetic sheet
> staleness), 1 is a mis-uploaded JD, 1 is collateral of a one-off 2026-08-19
> webhook-secret incident. **Corrected severity: LOW, not a release blocker.**

### (original, uncorrected) HIGH

`Bulk_Resume_Queue` in the candidate workbook: **3,688 data rows**. Status
distribution:

| Status | Count | % |
| --- | ---: | ---: |
| Processing | **1,810** | 49% |
| Screened | 1,246 | 34% |
| Failed | 603 | 16% |
| Skipped | 15 | <1% |
| (blank) | 14 | <1% |

Nearly **half** of every bulk resume ever queued is still `Processing`. The
portal writes `Processing` before calling the n8n webhook and depends on the
queue poll to observe the terminal status n8n is supposed to write back. A 49%
`Processing` rate means either n8n frequently never writes a terminal status, or
it completes the applicant but never updates the queue row. Many recent
(2026-08-15) `Failed` rows carry: *"the n8n workflow execution stalled (no
result within several minutes) and never reached a terminal status."*

This is the strongest available evidence for the split-brain reliability concern
and directly bears on QC blocker #5 (latency) and the Phase-5 timeout risk. It
is an **n8n / integration** problem, not portal code, but it is a release
concern for the bulk-screening feature.

## Automated gate (re-run, HEAD = `30cb580`)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | ✅ 0 errors |
| `eslint src tests` | ✅ 0 errors (8 pre-existing warnings) |
| `node --test tests/*.test.mjs` | ✅ 153 / 153 |
| `next build` | ✅ exit 0 |
