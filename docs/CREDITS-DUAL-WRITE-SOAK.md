# Ella Credits — dual-write soak & parity validation

> **Scope:** validate that the Google Sheets ↔ Neon/Postgres credit ledger stays
> perfectly in sync while `CREDITS_BACKEND=dual`. **No cutover.** `CREDITS_BACKEND`
> stays `dual`. This document is audit + operator instructions only. Prepared
> 2026-09-02.

## 0. What this session could and could not do

| | |
|---|---|
| Code-path review of the dual-write / divergence / backfill logic | **PASS CODE-PATH** — done (§1, §4) |
| Live Sheet balance / Postgres balance / row-level parity | **PASS — T+0 baseline verified** by the read-only checker; ongoing checkpoints remain operator-run. |
| Recent-log scan for divergence / mirror-failure | **BLOCKED / MANUAL** — no Vercel/Neon log access. Steps in §2. |

`.env.local` in this working copy *does* contain a populated `DATABASE_URL` and
Google service-account credentials. The read-only checker was run against those
configured pilot data sources and passed; no Vercel log access is available in
this session, and the soak still requires operator-run checkpoints.

**2026-09-02 — live parity check PASS (T+0 baseline):** operator ran
`npm run db:check:credits` → Sheets balance 7 == Postgres `credit_balance` 7 ==
Postgres ledger sum 7; 16 rows each; `Entry_ID` ↔ `source_entry_id` 16/16 1:1;
no duplicates; no NULLs; OVERALL PASS, exit 0. This is the **start** of the
24–48 h soak (§3 "Soak run log"), **not** a completed soak — the window and the
Vercel log scan run forward from here. `CREDITS_BACKEND` stays `dual`.

---

## 1. Task 1 — Parity check (operator-run)

### 1.0 Preferred: run the read-only checker

`src/db/check-credit-parity.mjs` (added 2026-09-02, uncommitted pending this run)
does the whole §1 cross-check in one command. Manual SQL/Sheet steps in §1a–§1d
are the fallback / cross-verification.

**Procedure — from the local pilot repo:**

1. `cd` to the repo root (`c:\Projects\ella-recruitment-portal-pilot`).
2. Ensure dependencies are installed (`googleapis`, `@neondatabase/serverless`
   are already in `package.json`): `npm ci` — skip if `node_modules` is current.
3. Confirm `.env.local` has these four populated, and that they point at the
   **same** Neon database and `Ella_Credit_Ledger` spreadsheet the deployed
   pilot uses:
   `DATABASE_URL`, `GOOGLE_SHEETS_SPREADSHEET_ID`,
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
   (Requires Node ≥ 20.6 for `--env-file-if-exists`; the pilot uses Node 22.)
4. Run, capturing the exit code:

   PowerShell:
   ```powershell
   npm run db:check:credits ; "EXIT: $LASTEXITCODE"
   ```
   or, for the cleanest exit code without npm's wrapper noise:
   ```powershell
   node --env-file-if-exists=.env.local src/db/check-credit-parity.mjs ; "EXIT: $LASTEXITCODE"
   ```
5. Copy back the **entire** block from `Ella Credits parity check —` through
   `This script made no writes...` **plus the `EXIT:` line**. Do **not** paste
   `.env.local`, `DATABASE_URL`, or the private key. The ledger values and
   `LDG-…` / `Entry_ID` strings are not secrets.

**Exit codes:** `0` = OVERALL PASS · `1` = FAIL (a mismatch) · `2` = BLOCKED
(credentials / connectivity / sheet shape — *not* a migration failure).

### 1.5 Interpreting the run

**Exit 0 (PASS):** proceed to the soak (§3). Do **not** change `CREDITS_BACKEND`.

**Exit 1 (FAIL):** do **not** run `db:backfill:credits` or any reconcile. Note
which assertion(s) failed, then:

| Failed assertion | Likely cause | Safe next step (read-only) |
|---|---|---|
| 8 — Sheet IDs missing in PG | mirror write(s) failed | Vercel logs for `Postgres mirror write failed` at those rows' timestamps; `SELECT *` those IDs is impossible (not in PG) — get them from the Sheet instead |
| 9 — PG IDs missing in Sheet | should be impossible in `dual` (Sheet written first): a manual PG insert, a prior `postgres`-mode write, or a deleted/edited Sheet row | `SELECT * FROM credit_ledger WHERE source_entry_id IN (…)`; check Sheet version history for deletions |
| 10 — duplicate IDs | Sheet: a row pasted twice. PG: only possible via NULLs (see 11) | compare timestamps/references of the dupes |
| 11 — NULL `source_entry_id` / synthetic≠blank | a mirror write without a key (bug), or blank-row drift | `SELECT * FROM credit_ledger WHERE source_entry_id IS NULL` |
| 12 — balance mismatch | PG balance ≠ PG sum → atomic-CTE invariant broken (manual `credit_balance` edit / partial write). PG sum ≠ Sheet sum → rows differ (see 8/9) | identify which pair disagrees first |
| 13 — row count | follows from 8/9/11 | resolve those first |

Then: **re-run the checker once** (rule out a transient Sheets/API blip),
gather the divergent rows from both stores, cross-reference Vercel logs at their
`entry_time`s, check Google Sheet version history — and report findings. No
remediation until the cause is known, and it will not be an automatic backfill.

**Exit 2 (BLOCKED):** the script prints `BLOCKED — <reason>`. This is a
config/connectivity/permissions issue, **not a failed migration**.

| Message contains | Category | Fix |
|---|---|---|
| `missing credentials: X` | environment config | populate `X` in `.env.local` |
| `could not read the '…' sheet: … permission` / 403 | Sheets auth | share the spreadsheet with `GOOGLE_SERVICE_ACCOUNT_EMAIL` (≥ Viewer), or fix `GOOGLE_SHEETS_SPREADSHEET_ID` |
| `could not read the '…' sheet: Unable to parse range` / not found | Sheets config | tab must be named exactly `Ella_Credit_Ledger`; check the spreadsheet ID |
| `invalid_grant` / JWT / key errors | Sheets auth | fix `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` quoting / `\n` escaping in `.env.local` |
| `sheet has no 'Entry_ID'/'Credits_Delta' column` | Sheet schema | the header row is missing/renamed — a Sheet problem, not a DB one |
| `could not read Postgres: ENOTFOUND` / timeout / `ECONNREFUSED` | Neon connectivity | bad host in `DATABASE_URL`, or the Neon project is paused/suspended, or network/firewall |
| `could not read Postgres: password authentication failed` / `role … does not exist` | Neon credentials | wrong user/password in `DATABASE_URL` |
| `could not read Postgres: relation "credit_ledger" does not exist` | wrong database | `.env.local` `DATABASE_URL` points at a DB without the credit tables |
| `credit_balance row (id = 1) is missing` | wrong database / un-migrated | `.env.local` points at the wrong Neon DB (do **not** migrate to "fix" it) |

---

### 1a. Postgres side — run against the pilot `DATABASE_URL`

`psql "$DATABASE_URL"` or the Neon SQL editor. **All read-only.**

```sql
-- Current Postgres balance
SELECT balance, updated_at FROM credit_balance WHERE id = 1;

-- Row count, signed delta sum, latest timestamps
SELECT count(*)                       AS pg_rows,
       sum(credits_delta)             AS pg_delta_sum,
       max(entry_time)                AS latest_entry_time,
       max(created_at)                AS latest_created_at
FROM credit_ledger;

-- Balance row vs ledger sum (MUST be equal)
SELECT (SELECT balance FROM credit_balance WHERE id = 1) AS balance_row,
       (SELECT sum(credits_delta) FROM credit_ledger)    AS ledger_sum;

-- Duplicate source_entry_id (MUST be zero rows — UNIQUE, but NULLs are allowed)
SELECT source_entry_id, count(*)
FROM credit_ledger
WHERE source_entry_id IS NOT NULL
GROUP BY source_entry_id HAVING count(*) > 1;

-- Rows with NULL source_entry_id (un-idempotent; SHOULD be zero)
SELECT count(*) AS null_source_ids FROM credit_ledger WHERE source_entry_id IS NULL;

-- All source_entry_ids, append order (for the set diff in 1c)
SELECT source_entry_id FROM credit_ledger ORDER BY entry_time, created_at;

-- balance_after running reconstruction (informational — see note)
WITH ordered AS (
  SELECT source_entry_id, entry_time, credits_delta, balance_after,
         sum(credits_delta) OVER (ORDER BY entry_time, created_at, id) AS running
  FROM credit_ledger
)
SELECT * FROM ordered WHERE running <> balance_after;
```

> **`balance_after` note.** The column is not uniformly meaningful:
> backfilled rows preserved the *Sheet's* `Balance_After` value
> (`backfill-credits.mjs:53`); live dual-write mirror rows store the *Postgres*
> running balance at mirror time (`ella-credits-postgres.ts:96`,
> `moved."balance"`). A mismatch here is **informational**, not a hard fail —
> the hard truth is `credit_balance.balance == sum(credits_delta)`.

### 1b. Sheet side — `Ella_Credit_Ledger` tab

Columns (A–L): `Entry_ID, Timestamp, Type, Event, Units, Credits_Delta,
Balance_After, Reference, Role_ID, Actor_Name, Actor_Email, Note`.

- **Sheet row count** = last data row − 1 (header row 1).
- **Sheet balance** = `=SUM(F2:F)` (column F = `Credits_Delta`).
- **Last `Balance_After`** (column G, last data row) should equal that sum.
- **Latest transaction** = column B (`Timestamp`) of the last data row.
- **`Entry_ID` list** = column A, rows 2..n.

### 1c. Cross-check (fill in with live values)

| # | Metric | Sheet | Postgres | Must match? | Result |
|---|---|---|---|---|---|
| 1 | Current balance | `SUM(Credits_Delta)` | `credit_balance.balance` | **Yes** | |
| 2 | Ledger Σ `credits_delta` | `SUM(F2:F)` | `sum(credit_ledger.credits_delta)` | **Yes** (both must also equal #1) | |
| 3 | Ledger row count | last row − 1 | `count(*) credit_ledger` | **Yes** (± rows with a synthetic `SHEET-*` key — see note) | |
| 4 | `Entry_ID` ↔ `source_entry_id` set | column A | `source_entry_id` list | **Yes** — 1:1, no orphans either side | |
| 5 | Duplicate ledger rows (PG) | n/a | dup `source_entry_id` query | **Yes** — zero | |
| 6 | Missing mirrored rows (Sheet has, PG lacks) | — | set diff | **Yes** — zero | |
| 7 | Extra PG-only rows (PG has, Sheet lacks) | — | set diff | **Yes** — zero (in `dual`; Sheet is written first) | |
| 8 | Latest transaction timestamp | column B last row | `max(entry_time)` | Close (mirror stamps `now()`, minor skew OK) | |
| 9 | `balance_after` consistency | last `Balance_After` == sum | running-sum query | Informational | |
| 10 | NULL `source_entry_id` (PG) | n/a | count | **Yes** — zero | |

> **Row-count note (#3).** Sheet rows that were written before the portal added
> `Entry_ID` values are backfilled into Postgres under a deterministic synthetic
> key `SHEET-<i>-<sha1…>`. Those still count 1:1; only truly blank/partial Sheet
> rows are skipped (`backfill-credits.mjs:35`). If counts differ, list the
> missing keys and confirm each is an empty Sheet row.

### 1d. Interpreting the result

- **#1, #2, #4, #5, #6, #7, #10 all clean → parity PASS for this point in time.**
- Any non-zero in #4–#7 or #10, or #1≠#2 → **divergence — STOP, report before
  any remediation.** Do **not** run `db:backfill:credits` to "fix" it until the
  cause is understood (it overwrites `credit_balance` with the Sheet sum and
  hides the symptom).

---

## 2. Task 2 — Log scan (operator-run)

**BLOCKED / MANUAL in this session.** Run in Vercel → the pilot project → Logs
(or a connected log drain), covering the full soak window:

Search terms (all emitted by `src/lib/ella-credits.ts`):

| String | Meaning | Expected |
|---|---|---|
| `[Credits] Divergence` | fresh Sheet balance ≠ fresh Postgres balance at a deduction/top-up | **zero** |
| `Postgres mirror write failed` | the Postgres mirror threw; Sheets still authoritative | **zero** |
| `[Credits] Divergence check failed` | the async divergence check itself errored (network/DB) | **zero** |
| `CREDITS_BACKEND=... but DATABASE_URL is unset` | misconfig — silently fell back to `sheets` | **zero** |
| `credit_balance row (id = 1) is missing` | migration not applied | **zero** |

Also scan for: Neon connection errors / timeouts on `/api/ella-credits*`,
`/api/applicants`, `/api/public/applications`, `/api/public/bookings/*`; HTTP 402
spikes (insufficient-credit) that don't match real low balance; any 5xx on the
credit routes.

**Duplicate-deduction symptom check:** in the ledger, look for two `Deduction`
rows with the **same `Reference`** (applicationId or `BULK-<role>-<sha>` queueId)
and the same `Event` close in time. One reference = one charge is the contract
(`ella-credits.ts` mints a fresh `LDG-<uuid>` per call, so a *caller-level* retry
is the only way to double-charge — see §6).

```sql
SELECT reference, event, count(*), min(entry_time), max(entry_time)
FROM credit_ledger
WHERE type = 'Deduction' AND reference <> ''
GROUP BY reference, event HAVING count(*) > 1;
```

Record the window start/end and paste the counts. **No divergence/mirror-failure
lines for the full window is a required PASS condition — do not infer it.**

---

## 3. Task 3 — The 24–48 hour soak

### Pre-soak

- [x] `CREDITS_BACKEND=dual` on the pilot (unchanged; not switched).
- [x] Divergence-detector fix (`fresh`-only, `ella-credits.ts`) deployed.
- [x] Run the parity check → clean baseline recorded (below).
- [ ] Start the log-scan window (§2) from the baseline timestamp.

### Soak run log (live)

**T+0 — BASELINE — 2026-09-02 06:47:54 UTC / 14:47:54 SGT** *(read-only
parity check; exit 0)*

| Metric | Value |
|---|---|
| Sheets balance (Σ `Credits_Delta`) | **7** |
| Postgres `credit_balance.balance` | **7** |
| Postgres ledger Σ `credits_delta` | **7** |
| Sheets ledger row count | **16** |
| Postgres ledger row count | **16** |
| `Entry_ID` ↔ `source_entry_id` set | **16 / 16, 1:1** |
| Duplicate IDs | **none** |
| NULL `source_entry_id` | **none** |
| `npm run db:check:credits` | **OVERALL PASS · exit 0** |

Source: read-only run of `node --env-file-if-exists=.env.local
src/db/check-credit-parity.mjs`, captured 2026-09-02 06:47:54 UTC / 14:47:54
SGT; `EXIT: 0`.
This is the clean starting point; the 24–48 h window runs from here.

**Checkpoint table** — fill one row per run, paste the full script output +
`EXIT:` line alongside. Every row must be `PASS / 0`. Any `FAIL / 1` → the
window restarts from a new baseline once the cause is resolved (see §1.5).

| Checkpoint | When (UTC / SGT) | Sheets bal | PG bal | PG sum | Sheet rows | PG rows | ID set | dup | null | Divergence logs | Mirror-fail logs | Result / exit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T+0 baseline | 2026-09-02 06:47:54Z / 14:47:54 SGT | 7 | 7 | 7 | 16 | 16 | 16/16 | none | none | (start scan) | (start scan) | PASS / 0 |
| after event #1 | | | | | | | | | | | | |
| after event #2 | | | | | | | | | | | | |
| after event #3 | | | | | | | | | | | | |
| after event #… | | | | | | | | | | | | |
| ~T+12h | | | | | | | | | | | | |
| ~T+24h | | | | | | | | | | | | |
| ~T+36h (optional) | | | | | | | | | | | | |
| T+48h close | | | | | | | | | | | | |

### Real transactions to observe during the soak

**Let genuine pilot activity drive this.** Do **not** create artificial
financial transactions purely for the test if they would move the real pilot
balance unnecessarily. The point is to watch real events mirror correctly, not
to manufacture events.

| Event type | Only if it happens for a real reason | Proof to capture |
|---|---|---|
| **Single CV analysis** (`cv_analysis` −1) | a real applicant screened via an HR invite link, or a genuine HR manual intake | 1 `cv_analysis` `Deduction` in Sheet **and** Postgres, same `Entry_ID`, balance −1 both sides, `Reference` = applicationId |
| **Bulk CV analysis** (`cv_analysis` −1 each) | a real bulk screen (≤8) of actual candidate resumes | one row per **screened** file (skipped/failed cost 0), `Reference` = each `BULK-<role>-<sha>` queueId, all mirrored 1:1 |
| **Manual top-up** (`manual_topup` +N) | **only if you were going to top up anyway** for real operational need — otherwise skip; do not add credits just to test | 1 `TopUp` mirrored 1:1 |
| **Volume discount** (`volume_discount` +bonus) | *naturally* — only if a real top-up crosses `Ella_Credit_Discount_Threshold` | the extra `volume_discount` `TopUp` row is **also** mirrored 1:1 (two rows, one action) |
| **Phone-interview deduction** (`phone_interview` −10) | a real AI voice interview booked for an actual candidate | 1 `phone_interview` `Deduction`, `Reference` = applicationId, mirrored 1:1 |
| **Concurrent reads** | normal dashboard / credit-meter polling (happens automatically) | **no** `[Credits] Divergence` from cached-vs-fresh (the detector fix removed this class) |

If a given event type simply does not occur during the window, record it as
**"not exercised — no real event"**. The soak can still pass on the event types
that did occur plus the parity + log criteria; the migration plan notes
`phone_interview` / `volume_discount` as "where practical", not mandatory.

**Do not** deliberately drive the balance low to test the 402 guard during the
soak — that path is already covered by the automated test suite
(`assertCreditsAvailable` / insufficient-credit 402) and by prior live
validation; forcing it here just churns the real balance.

### Checkpoints — exactly what to do at each

Every checkpoint = **the same two actions**, results pasted into the checkpoint
table + sent back:

- **A.** `npm run db:check:credits` (or `node --env-file-if-exists=.env.local
  src/db/check-credit-parity.mjs`) → capture the full output **and** the `EXIT:`
  code. Must be **PASS / exit 0**.
- **B.** Note anything that changed since the last checkpoint: which real credit
  events happened (type, count, roughly when), and the current balance.

The log scan (§2, action **C**) is only required at **T+12h**, **T+24h**,
**T+36h (optional)**, and the **T+48h close** — not after every event.

| Checkpoint | Trigger | Actions | Extra |
|---|---|---|---|
| **After each real credit event** | a genuine `cv_analysis` (single or bulk), `manual_topup`, `phone_interview`, or a `volume_discount` that fired naturally | A + B | confirm the **new** `Entry_ID`(s) appear on **both** sides and the balance moved by exactly the expected amount (−1 per screened CV, −10 per phone interview, +N per top-up) |
| **~T+12h** | elapsed time | A + B + **C** (log scan for the 0→12h window) | catches drift from background usage between events |
| **~T+24h** | elapsed time | A + B + **C** (0→24h window) | earliest point a 24h soak could close if all criteria are green |
| **~T+36h** *(optional)* | elapsed time | A + B + **C** (0→36h window) | only if you are extending toward 48h |
| **T+48h — close** | window end | A + B + **C** (full 0→48h window) + the duplicate-`(reference, event)` SQL from §2 + record rows-added / events-exercised | the final gate |

Minimum ≈ 5–7 runs. Keep every run's full output + exit code in the checkpoint
table.

**If any run returns exit 1:** stop the clock. The soak does **not** pass; a new
24–48 h window starts from a fresh baseline only after the cause is found and
resolved — **no auto-reconcile, no backfill**. Follow §1.5 (FAIL) and send me
the failing output.

**If any run returns exit 2:** config/connectivity blip, not a soak failure —
fix per §1.5 (BLOCKED) and re-run. The clock keeps running as long as no exit-1
occurred.

### Post-soak

- [ ] Final §1 parity check — all "must match" green.
- [ ] Full §2 log scan for the window — **zero** divergence, **zero** mirror
      failures, **zero** divergence-check errors, **zero** DB/network errors on
      credit routes.
- [ ] `SELECT` duplicate-reference query (§2) — zero.
- [ ] Duplicate `source_entry_id` — zero. NULL `source_entry_id` — zero.
- [ ] Record: rows added during the window, each event type exercised (Y/N),
      start/end balance, start/end row count.
- [ ] Write the result into `RELEASE-VALIDATION-STATUS.md` (§"Database — dual-write watch").

### PASS criteria (to *recommend* a future `postgres` cutover — not perform it)

All of the following, over a **single continuous 24–48 h `dual` window**:

1. `credit_balance.balance` == `sum(credit_ledger.credits_delta)` == Sheet
   `SUM(Credits_Delta)` at start, at end, and after every exercised event.
2. `Entry_ID` (Sheet) and `source_entry_id` (Postgres) are a **1:1 set** — zero
   missing, zero Postgres-only, zero duplicates, zero NULLs.
3. Ledger row counts equal (allowing only documented empty-Sheet-row skips).
4. **Zero** `[Credits] Divergence` log lines.
5. **Zero** `Postgres mirror write failed` log lines.
6. **Zero** `Divergence check failed` / DB-connectivity errors on credit paths.
7. At minimum these event types round-tripped 1:1 during the window: single
   `cv_analysis`, bulk `cv_analysis`, `manual_topup`, and (where practical)
   `phone_interview` and `volume_discount`.
8. No duplicate `Deduction` for the same `(reference, event)`.
9. The read-only parity script (§4) exists, is reviewed, and exits 0.
10. Backup/PITR prerequisites (§5) are satisfied and a **test restore** has
    passed.

Meeting 1–10 makes a `postgres`-primary cutover *safe to propose to the
operator*. **It does not authorise the cutover** — that remains a separate,
explicit decision, and this plan keeps credits on `dual`.

---

## 4. Task 4 — Parity tooling assessment

### What exists

| Script | Purpose | Read-only? | Fit for row-level parity? |
|---|---|---|---|
| `src/db/backfill-credits.mjs` (`npm run db:backfill:credits`) | one-off / reconcile: copy Sheet ledger → Postgres, set `credit_balance` to the Sheet sum | **No** — `INSERT … ON CONFLICT DO NOTHING` per row **and** unconditional `INSERT INTO credit_balance … DO UPDATE SET balance = <sheet sum>` | **No.** It *writes*. It reports only Sheet rows / inserted-this-run / Sheet sum / PG balance. It does not report PG row count, `source_entry_id` set diffs, duplicates, or NULLs, and it silently reconciles the balance — which would **mask** a divergence you are trying to detect. |
| `src/db/migrate.mjs` | apply SQL migrations | No | n/a |
| `getPostgresCreditBalance()` (`ella-credits-postgres.ts`) | app balance read | Yes | Partial — balance + lifetime totals + last 100 rows; not a Sheet comparison |

**Conclusion: tooling is insufficient for a safe, repeatable, non-destructive
row-level parity check.** The current options are "eyeball two SQL result sets"
or "run the write-capable backfill script".

### Recommendation — add a read-only `src/db/check-credit-parity.mjs`

**Why it is warranted and non-disruptive:**

- It only issues `SELECT`s against Postgres and one `spreadsheets.readonly`
  Google API call — **no writes, no reconciliation, ever.**
- It reuses the exact auth/config pattern of `backfill-credits.mjs` (same env
  vars, same `neon()` client, same JWT scope but read-only).
- It turns the §1 manual cross-check into one command with a machine-readable
  result and a non-zero exit on any "must match" failure — usable in the soak,
  in CI (against staging), and as a scheduled prod read.
- It is the enabling tool for soak PASS criterion #9 and for the migration
  plan's parity harness.

**Created 2026-09-02** at `src/db/check-credit-parity.mjs` (+ `npm run
db:check:credits`) — read-only and still pending review/commit. It was run against
the configured pilot Sheet and Neon database on 2026-09-02 and returned OVERALL
PASS / exit 0; the T+0 result is recorded in §3. Reference content:

```js
// src/db/check-credit-parity.mjs
// READ-ONLY parity check: Google Sheet `Ella_Credit_Ledger` vs Neon `credit_ledger` / `credit_balance`.
// Never writes, never reconciles. Exits non-zero on any must-match failure.
// Run: `node --env-file-if-exists=.env.local src/db/check-credit-parity.mjs`
import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();
const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "")
  .replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n").trim();

for (const [name, value] of Object.entries({ DATABASE_URL: databaseUrl, GOOGLE_SHEETS_SPREADSHEET_ID: spreadsheetId, GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceAccountEmail, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey })) {
  if (!value) { console.error(`${name} is not set (put it in .env.local).`); process.exit(2); }
}

const TAB = "Ella_Credit_Ledger";
const sql = neon(databaseUrl); // read-only usage below

// --- Sheet side (readonly scope) ---
const auth = new google.auth.JWT({ email: serviceAccountEmail, key: privateKey, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });
const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB}'!A:L` });
const values = resp.data.values ?? [];
const headers = (values[0] ?? []).map((c) => String(c ?? "").trim());
const ci = (n) => headers.indexOf(n);
const dataRows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
const sheetDeltas = dataRows.map((r) => Math.trunc(Number(String(r[ci("Credits_Delta")] ?? "").trim())) || 0);
const sheetSum = sheetDeltas.reduce((a, b) => a + b, 0);
const sheetIds = dataRows.map((r) => String(r[ci("Entry_ID")] ?? "").trim()).filter(Boolean);
const sheetIdSet = new Set(sheetIds);
const sheetLastBalanceAfter = dataRows.length ? Math.trunc(Number(String(dataRows.at(-1)[ci("Balance_After")] ?? "").trim())) || 0 : 0;

// --- Postgres side (SELECT only) ---
const [{ balance: pgBalance }] = await sql`select balance from credit_balance where id = 1`;
const [{ rows: pgRows, delta_sum: pgDeltaSum }] = await sql`select count(*)::int as rows, coalesce(sum(credits_delta),0)::int as delta_sum from credit_ledger`;
const pgIdRows = await sql`select source_entry_id from credit_ledger where source_entry_id is not null`;
const pgIds = pgIdRows.map((r) => r.source_entry_id);
const pgIdSet = new Set(pgIds);
const [{ n: pgNullIds }] = await sql`select count(*)::int as n from credit_ledger where source_entry_id is null`;
const pgDupes = await sql`select source_entry_id, count(*)::int as n from credit_ledger where source_entry_id is not null group by source_entry_id having count(*) > 1`;
const [{ latest }] = await sql`select max(entry_time) as latest from credit_ledger`;

// --- Compare ---
const missingInPg = [...sheetIdSet].filter((id) => !pgIdSet.has(id));   // Sheet has, PG lacks
const pgOnly = [...pgIdSet].filter((id) => !sheetIdSet.has(id) && !id.startsWith("SHEET-")); // PG has, Sheet lacks (ignore synthetic backfill keys)
const pgDupList = pgDupes.map((r) => `${r.source_entry_id} x${r.n}`);

const checks = [
  ["balance: PG credit_balance == PG ledger sum", Number(pgBalance) === Number(pgDeltaSum), `${pgBalance} vs ${pgDeltaSum}`],
  ["balance: PG == Sheet sum",                    Number(pgBalance) === sheetSum,            `${pgBalance} vs ${sheetSum}`],
  ["Sheet last Balance_After == Sheet sum",       sheetLastBalanceAfter === sheetSum,        `${sheetLastBalanceAfter} vs ${sheetSum}`],
  ["row counts (Sheet vs PG)",                    dataRows.length === Number(pgRows),        `${dataRows.length} vs ${pgRows}`],
  ["no Sheet Entry_IDs missing in PG",            missingInPg.length === 0,                  missingInPg.join(", ") || "-"],
  ["no PG-only rows (excl. SHEET-* backfill)",    pgOnly.length === 0,                       pgOnly.join(", ") || "-"],
  ["no duplicate source_entry_id in PG",          pgDupList.length === 0,                    pgDupList.join(", ") || "-"],
  ["no NULL source_entry_id in PG",               Number(pgNullIds) === 0,                   String(pgNullIds)],
];

console.log(`Sheet rows ${dataRows.length} | PG rows ${pgRows}`);
console.log(`Sheet sum ${sheetSum} | PG ledger sum ${pgDeltaSum} | PG balance ${pgBalance}`);
console.log(`Latest PG entry_time: ${latest?.toISOString?.() ?? latest}`);
let ok = true;
for (const [label, pass, detail] of checks) { console.log(`${pass ? "PASS" : "FAIL"}  ${label}  (${detail})`); if (!pass) ok = false; }
process.exit(ok ? 0 : 1);
```

Add to `package.json`: `"db:check:credits": "node --env-file-if-exists=.env.local src/db/check-credit-parity.mjs"`.

> If approved, this is a **new read-only script + one package.json line** — not a
> change to any credit code path, RBAC, applicant flow, voice lifecycle, or bulk
> limit. It cannot be run in a mode that writes.

---

## 5. Task 5 — Backup / recovery prerequisite (Neon)

**Current state: NOTHING is configured or documented for Neon backup/recovery.**
`PRODUCTION-HARDENING.md` covers only Google-Sheet versioned backups. The only
recovery path that exists today is "re-run `db:backfill:credits` from the Sheet",
which works **only** while `dual` keeps the Sheet complete and authoritative —
after a `postgres` cutover there is **no documented backup at all**. This is
risk **C6** in `DATABASE-MIGRATION-PLAN.md`.

### Operator checklist (do NOT change Neon settings without explicit authorisation)

| # | Item | Action | Owner | Done |
|---|---|---|---|---|
| 1 | **PITR capability** | In the Neon console, confirm the project's plan supports point-in-time restore / history retention. Record the current plan and the current retention window. | | |
| 2 | **Retention period** | Set history retention to **≥ 7 days** (target **30**). Record the value and the date changed. | | |
| 3 | **Logical backup** | Schedule a periodic `pg_dump` of the pilot DB to durable object storage (e.g. weekly + before any migration). Document the command, destination, and encryption. | | |
| 4 | **Restore procedure — documented** | Write the exact steps: (a) create a Neon branch from a timestamp *or* in-place restore; (b) point a scratch `DATABASE_URL` at it; (c) verify. Include how to get back to a known-good state after a bad migration. | | |
| 5 | **Test restore — executed** | Actually perform a restore into a throwaway branch, then run `db:check:credits` (§4) against it and confirm it matches a known checkpoint. Record date, restored-to timestamp, and result. | | |
| 6 | **RPO / RTO stated** | Write down the acceptable data-loss window (RPO) and recovery time (RTO) for the credit balance, agreed with the operator. | | |
| 7 | **Backup verification owner** | Name the person responsible for periodically re-running the test restore (suggest quarterly, matching the Sheet-backup cadence in `PRODUCTION-HARDENING.md`). | | |
| 8 | **Monitoring** | Add a lightweight check that alerts if `db:check:credits` fails or if `[Credits] Divergence` / `Postgres mirror write failed` appears in logs. | | |

### What must be proven before Postgres becomes source of truth

- Items 1–7 above complete, with a **passing test restore on record**.
- The §3 soak PASS criteria (1–10) met over a fresh 24–48 h window.
- A rollback runbook exists: how to return to `CREDITS_BACKEND=sheets` (before
  cutover: env flip + redeploy; after cutover: append the Postgres-only rows
  back to `Ella_Credit_Ledger`, verify sums, then flip — per
  `PHASE-2-BACKEND-MIGRATION.md` §Rollback).
- Explicit operator written approval for the `postgres` cutover.

---

## 6. Task 6 — Migration readiness status

Phases per `DATABASE-MIGRATION-PLAN.md`: **A = prep only**, **B = credits
observation/soak**, **C–H = NO-GO until UAT sign-off + explicit approval**.

| Milestone | Status | Blocking items |
|---|---|---|
| **Credits dual-write parity** | **PASS — baseline established** | Live parity check 2026-09-02: 7 == 7 == 7, 16/16 rows, 1:1 `Entry_ID` set, no dupes, no NULLs, exit 0. This is the **T+0 baseline**, not the completed soak. |
| **Credits — Postgres-primary** (`CREDITS_BACKEND=postgres`) | **NO-GO** | (a) the 24–48 h zero-divergence soak has **started but not completed** (only T+0 recorded); (b) parity script exists but is **not yet committed / reviewed-in-repo**; (c) Neon backup/PITR + tested restore not done (§5); (d) no operator approval; (e) recommended pre-cutover hardening (caller-level idempotency key, risk C2) not done. **Out of scope to perform regardless.** |
| **Recruitment — shadow-write** (Phase C) | **NO-GO** | Phase A prerequisites not started (drizzle-kit, Neon backups, pooled driver, `/api/internal/*` design, staging rig, parity harness, data-cleanup rules); UAT not signed off; no explicit approval. |
| **Recruitment — backfill** (Phase D) | **NO-GO** | Depends on C; plus data-cleanup rules (person dedupe, status→enum, timestamp rule) not signed off. |
| **Recruitment — Postgres read-primary** (Phase F) | **NO-GO** | Depends on C→D→E per entity; parity evidence per entity not gathered; backups/restore not proven. |

The credits parity **baseline** is now green; the soak is **in progress**.
Nothing else in the readiness picture has changed since
`DATABASE-MIGRATION-PLAN.md`.

### Is any code change actually needed right now?

**No confirmed defect. No required code change for the soak itself.**

- The `dual` path is correct by code review: Sheet write is authoritative and
  first; the Postgres mirror is best-effort and **idempotent on
  `source_entry_id`**; the divergence check is fresh-vs-fresh and fires on every
  deduction batch + top-up; failures are logged, never silently swallowed into
  data loss (Postgres can only fall *behind*, never get ahead, in `dual`).
- **Recommended (not required, needs approval), both non-disruptive:**
  1. `src/db/check-credit-parity.mjs` — read-only tooling (§4).
  2. A caller-level idempotency key (applicationId / queueId) on
     `recordDeduction` / `recordTopUp` — **hardening before any `postgres`
     cutover**, because today a *caller-level* retry mints a fresh `LDG-<uuid>`
     and would double-charge. This is risk **C2** in the migration plan, not an
     active defect in `dual` (Sheets is authoritative and the mirror dedupes).
     Do **not** implement without explicit approval — it is not part of this
     validation pass.

---

## 7. Consolidated report

| # | Item | Value / status |
|---|---|---|
| 1 | Current Sheets balance | **PASS — 7** (live read-only parity check, 2026-09-02) |
| 2 | Current Postgres balance | **PASS — 7** (live read-only parity check, 2026-09-02) |
| 3 | Ledger row counts | **PASS — 16 / 16** (Sheet / PG, live read-only parity check) |
| 4 | `Entry_ID` / `source_entry_id` parity | **PASS — 16 / 16, 1:1** (live read-only parity check) |
| 5 | Divergence / errors found | **MANUAL** — no Vercel log access in this session; run the §2 scan for the soak window. |
| 6 | Soak status | **IN PROGRESS — T+0 baseline is green; 24–48 h window is not complete.** Checklist in §3. |
| 7 | Blocked / manual | Vercel log scan, the remaining soak checkpoints, and the test restore require operator live access. |
| 8 | Code change needed? | **No.** No confirmed defect. Two *recommended, approval-gated, non-disruptive* items: read-only parity script; pre-cutover caller-level idempotency key. |
| 9 | Backup / PITR readiness | **NOT READY.** Nothing configured or documented for Neon. Checklist in §5. Test restore not done. |
| 10 | GO / NO-GO — credits Postgres-primary | **NO-GO.** Blocked on: fresh soak evidence, parity script, Neon backup + tested restore, operator approval. (Also explicitly out of scope to perform.) |
| 11 | GO / NO-GO — recruitment migration (C–H) | **NO-GO.** UAT not signed off; Phase A prerequisites not started; no explicit approval. |
| 12 | Recommended next action | 1) Continue the §3 24–48 h soak (normal usage + targeted real events). 2) Run the §2 log scan at T+12h/T+24h and at close. 3) Start the §5 Neon backup checklist in parallel (PITR + retention + **test restore**). 4) Record results in `RELEASE-VALIDATION-STATUS.md`. Keep `CREDITS_BACKEND=dual` throughout. |

---

*Audit and operator-procedure document only. No migration, no `postgres` cutover,
no Neon setting change, no live n8n change, no RBAC / applicant-flow / voice /
bulk-limit change has been made or is authorised by this document.*
