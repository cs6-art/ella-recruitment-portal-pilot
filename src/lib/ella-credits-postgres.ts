import { desc, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db/client";
import { creditBalance, creditLedger } from "@/db/schema";
import { EllaCreditsError } from "@/lib/ella-credit-math";
import type { CreditBalance, LedgerAppend, LedgerEntry } from "@/lib/ella-credits-store";

/**
 * Postgres (Neon) storage for the Ella Credit ledger.
 *
 * `credit_balance` (single row, id = 1) is the source of truth for the current
 * balance. Every write moves that row and appends to the immutable
 * `credit_ledger` audit trail in ONE atomic statement — a guarded deduction
 * that would take the balance negative appends nothing and reports
 * insufficient funds, which the Sheets store could never guarantee.
 * `source_entry_id` makes every write idempotent (safe retries + dual-write).
 */

function toInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function rowToEntry(row: Record<string, unknown>): LedgerEntry {
  const time = row.entry_time ?? row.entryTime;
  return {
    entryId: String(row.source_entry_id ?? row.sourceEntryId ?? row.id ?? ""),
    timestamp: time instanceof Date ? time.toISOString() : String(time ?? ""),
    type: String(row.type) === "TopUp" ? "TopUp" : "Deduction",
    event: String(row.event ?? ""),
    units: toInt(row.units),
    creditsDelta: toInt(row.credits_delta ?? row.creditsDelta),
    balanceAfter: toInt(row.balance_after ?? row.balanceAfter),
    reference: String(row.reference ?? ""),
    roleId: String(row.role_id ?? row.roleId ?? ""),
    actorName: String(row.actor_name ?? row.actorName ?? ""),
    actorEmail: String(row.actor_email ?? row.actorEmail ?? ""),
    note: String(row.note ?? ""),
  };
}

function resultRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

export async function getPostgresCreditBalance(): Promise<CreditBalance> {
  const db = getDb();
  const [balanceRow] = await db.select({ balance: creditBalance.balance }).from(creditBalance).where(sql`${creditBalance.id} = 1`);
  const [totals] = await db
    .select({
      toppedUp: sql<number>`coalesce(sum(${creditLedger.creditsDelta}) filter (where ${creditLedger.creditsDelta} > 0), 0)`,
      consumed: sql<number>`coalesce(-sum(${creditLedger.creditsDelta}) filter (where ${creditLedger.creditsDelta} < 0), 0)`,
    })
    .from(creditLedger);
  const entries = await db.select().from(creditLedger).orderBy(desc(creditLedger.entryTime)).limit(100);

  return {
    balance: toInt(balanceRow?.balance ?? 0),
    totals: { toppedUp: toInt(totals?.toppedUp ?? 0), consumed: toInt(totals?.consumed ?? 0) },
    entries: entries.map((row) => rowToEntry(row as unknown as Record<string, unknown>)),
  };
}

/**
 * Append one ledger entry and move the balance atomically.
 * - `guard: true`  → a deduction that would go negative appends nothing and
 *   throws `EllaCreditsError` (authoritative Postgres mode).
 * - `guard: false` → unconditional (mirror mode: Sheets already decided).
 * A repeated `sourceEntryId` is a no-op that returns the current balance.
 */
type SqlExecutor = { execute(query: SQL<unknown>): Promise<unknown> };

/**
 * Shared implementation used by both the standalone credit path and a
 * recruitment transaction. Keeping the ledger CTE on the caller's executor
 * makes a successful screening result and its charge atomic.
 */
export async function appendPostgresLedgerEntryOnExecutor(
  executor: SqlExecutor,
  entry: LedgerAppend,
  options: { guard: boolean } = { guard: true },
): Promise<{ balanceAfter: number; applied: boolean }> {
  const delta = Math.trunc(entry.creditsDelta);
  const units = Math.trunc(entry.units);
  const guardClause = options.guard ? sql` and "credit_balance"."balance" + ${delta} >= 0` : sql``;

  const result = await executor.execute(sql`
    with existed as (
      select exists(select 1 from "credit_ledger" where "source_entry_id" = ${entry.sourceEntryId}) as v
    ),
    moved as (
      update "credit_balance"
      set "balance" = "credit_balance"."balance" + ${delta}, "updated_at" = now()
      where "credit_balance"."id" = 1 and (select not v from existed)${guardClause}
      returning "credit_balance"."balance"
    ),
    inserted as (
      insert into "credit_ledger"
        ("entry_time", "type", "event", "units", "credits_delta", "balance_after",
         "reference", "role_id", "actor_name", "actor_email", "note", "source_entry_id")
      select now(), ${entry.type}, ${entry.event}, ${units}, ${delta}, moved."balance",
             ${entry.reference ?? ""}, ${entry.roleId ?? ""}, ${entry.actorName ?? ""},
             ${entry.actorEmail ?? ""}, ${entry.note ?? ""}, ${entry.sourceEntryId}
      from moved
      returning "balance_after"
    )
    select
      (select v from existed) as existed,
      (select count(*)::int from inserted) as inserted_count,
      coalesce(
        (select "balance" from moved),
        (select "balance_after" from "credit_ledger" where "source_entry_id" = ${entry.sourceEntryId}),
        (select "balance" from "credit_balance" where "id" = 1)
      ) as balance_after
  `);

  const rows = resultRows(result);
  const row = rows[0] ?? {};
  const existed = row.existed === true || row.existed === "t" || row.existed === 1;
  const insertedCount = toInt(row.inserted_count);
  const balanceAfter = row.balance_after === null || row.balance_after === undefined ? null : toInt(row.balance_after);

  if (insertedCount > 0) return { balanceAfter: balanceAfter ?? 0, applied: true };
  if (existed) return { balanceAfter: balanceAfter ?? 0, applied: false }; // idempotent no-op
  if (options.guard) {
    throw new EllaCreditsError(Math.abs(delta), balanceAfter ?? 0);
  }
  throw new Error("credit_balance row (id = 1) is missing; run `npm run db:migrate`.");
}

export async function appendPostgresLedgerEntry(
  entry: LedgerAppend,
  options: { guard: boolean } = { guard: true },
): Promise<{ balanceAfter: number; applied: boolean }> {
  return appendPostgresLedgerEntryOnExecutor(getDb(), entry, options);
}
