import { sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db/client";
import { EllaCreditsError } from "@/lib/ella-credit-math";
import type { CreditBalance, LedgerAppend, LedgerEntry } from "@/lib/ella-credits-store";

type Executor = { execute(query: SQL<unknown>): Promise<unknown> };

function rowsOf(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const rows = (value as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
}

function int(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function email(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) throw new Error("A valid credit account owner email is required.");
  return normalized;
}

function organization(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error("An organization is required for credit operations.");
  return normalized;
}

function entry(row: Record<string, unknown>): LedgerEntry {
  const time = row.entry_time;
  return {
    entryId: String(row.source_entry_id ?? row.id ?? ""),
    timestamp: time instanceof Date ? time.toISOString() : String(time ?? ""),
    type: String(row.type) === "TopUp" ? "TopUp" : "Deduction",
    event: String(row.event ?? ""),
    units: int(row.units),
    creditsDelta: int(row.credits_delta),
    balanceAfter: int(row.balance_after),
    reference: String(row.reference ?? ""),
    roleId: String(row.role_id ?? ""),
    actorName: String(row.actor_name ?? ""),
    actorEmail: String(row.actor_email ?? ""),
    note: String(row.note ?? ""),
  };
}

export function perUserCreditsEnabled() {
  const configured = (process.env.CREDITS_SCOPE || "").trim().toLowerCase();
  if (configured) return configured === "per_user";
  // Recruitment Postgres is the Pilot cutover boundary. Production and the
  // legacy portal keep the existing shared Sheet balance until explicitly
  // migrated, so this default cannot silently change them.
  return (process.env.RECRUITMENT_BACKEND || "").trim().toLowerCase() === "postgres";
}

export async function getAccountCreditBalance(input: { organizationId: string; ownerEmail: string }): Promise<CreditBalance> {
  const db = getDb();
  const orgId = organization(input.organizationId);
  const owner = email(input.ownerEmail);
  const [account] = rowsOf(await db.execute(sql`
    SELECT "id", "balance" FROM "credit_accounts"
    WHERE "organization_id" = ${orgId} AND "owner_email" = ${owner}
    LIMIT 1
  `));
  const totals = rowsOf(await db.execute(sql`
    SELECT
      coalesce(sum("credits_delta") FILTER (WHERE "credits_delta" > 0), 0)::int AS topped_up,
      coalesce(-sum("credits_delta") FILTER (WHERE "credits_delta" < 0), 0)::int AS consumed
    FROM "credit_account_ledger"
    WHERE "account_id" = ${account?.id ?? "00000000-0000-0000-0000-000000000000"}
  `))[0] ?? {};
  const ledger = rowsOf(await db.execute(sql`
    SELECT * FROM "credit_account_ledger"
    WHERE "account_id" = ${account?.id ?? "00000000-0000-0000-0000-000000000000"}
    ORDER BY "entry_time" DESC
    LIMIT 100
  `));
  return {
    balance: int(account?.balance),
    totals: { toppedUp: int(totals.topped_up), consumed: int(totals.consumed) },
    entries: ledger.map(entry),
  };
}

export async function appendAccountLedgerEntryOnExecutor(
  executor: Executor,
  input: { organizationId: string; ownerEmail: string; entry: LedgerAppend },
  options: { guard: boolean } = { guard: true },
) {
  const orgId = organization(input.organizationId);
  const owner = email(input.ownerEmail);
  const delta = Math.trunc(input.entry.creditsDelta);
  const units = Math.trunc(input.entry.units);
  const guard = options.guard ? sql` AND "credit_accounts"."balance" + ${delta} >= 0` : sql``;
  const result = await executor.execute(sql`
    WITH account AS (
      SELECT "id" FROM "credit_accounts"
      WHERE "organization_id" = ${orgId} AND "owner_email" = ${owner}
      FOR UPDATE
    ),
    existed AS (
      SELECT EXISTS (
        SELECT 1 FROM "credit_account_ledger"
        WHERE "account_id" = (SELECT "id" FROM account)
          AND "source_entry_id" = ${input.entry.sourceEntryId}
      ) AS value
    ),
    moved AS (
      UPDATE "credit_accounts"
      SET "balance" = "credit_accounts"."balance" + ${delta}, "updated_at" = now()
      WHERE "id" = (SELECT "id" FROM account)
        AND NOT (SELECT value FROM existed)${guard}
      RETURNING "id", "balance"
    ),
    inserted AS (
      INSERT INTO "credit_account_ledger"
        ("account_id", "type", "event", "units", "credits_delta", "balance_after",
         "reference", "role_id", "actor_name", "actor_email", "note", "source_entry_id")
      SELECT "id", ${input.entry.type}, ${input.entry.event}, ${units}, ${delta}, "balance",
        ${input.entry.reference ?? ""}, ${input.entry.roleId ?? ""}, ${input.entry.actorName ?? ""},
        ${input.entry.actorEmail ?? ""}, ${input.entry.note ?? ""}, ${input.entry.sourceEntryId}
      FROM moved
      RETURNING "balance_after"
    )
    SELECT
      (SELECT value FROM existed) AS existed,
      (SELECT count(*)::int FROM inserted) AS inserted_count,
      coalesce(
        (SELECT "balance" FROM moved),
        (SELECT "balance_after" FROM "credit_account_ledger"
          WHERE "account_id" = (SELECT "id" FROM account)
            AND "source_entry_id" = ${input.entry.sourceEntryId}),
        (SELECT "balance" FROM "credit_accounts" WHERE "id" = (SELECT "id" FROM account))
      ) AS balance_after
  `);
  const row = rowsOf(result)[0] ?? {};
  const existed = row.existed === true || row.existed === "t" || row.existed === 1;
  const inserted = int(row.inserted_count);
  const balanceAfter = row.balance_after == null ? 0 : int(row.balance_after);
  if (inserted > 0) return { balanceAfter, applied: true };
  if (existed) return { balanceAfter, applied: false };
  if (options.guard) throw new EllaCreditsError(Math.abs(delta), balanceAfter);
  throw new Error(`Credit account is not provisioned for ${owner}.`);
}

export async function appendAccountLedgerEntry(
  input: { organizationId: string; ownerEmail: string; entry: LedgerAppend },
  options: { guard: boolean } = { guard: true },
) {
  return appendAccountLedgerEntryOnExecutor(getDb(), input, options);
}
