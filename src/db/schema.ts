import { integer, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Phase 2 backend migration — first pilot table.
 *
 * The Ella Credits balance lived in an append-only Google Sheet tab, where the
 * balance was the sum of every row and concurrent deductions could overspend
 * (Sheets has no atomic increment). Here `credit_balance` is a single row that
 * is the source of truth, updated atomically in the same statement that
 * appends to the immutable `credit_ledger` audit trail.
 */

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Logical event time. Preserved from the sheet's `Timestamp` on backfill;
    // `now()` for new writes.
    entryTime: timestamp("entry_time", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(), // 'TopUp' | 'Deduction'
    event: text("event").notNull(), // manual_topup | manual_adjustment | volume_discount | cv_analysis | phone_interview
    units: integer("units").notNull(),
    creditsDelta: integer("credits_delta").notNull(), // signed
    balanceAfter: integer("balance_after").notNull(),
    reference: text("reference").notNull().default(""),
    roleId: text("role_id").notNull().default(""),
    actorName: text("actor_name").notNull().default(""),
    actorEmail: text("actor_email").notNull().default(""),
    note: text("note").notNull().default(""),
    // Old `LDG-…` sheet id (or a deterministic synthetic key). Unique so the
    // backfill and dual-write mirror are idempotent.
    sourceEntryId: text("source_entry_id").unique(),
  },
  (table) => [index("credit_ledger_entry_time_idx").on(table.entryTime)],
);

export const creditBalance = pgTable("credit_balance", {
  id: integer("id").primaryKey(), // always 1
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreditLedgerRow = typeof creditLedger.$inferSelect;
export type NewCreditLedgerRow = typeof creditLedger.$inferInsert;
