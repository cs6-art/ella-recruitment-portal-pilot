import { boolean, integer, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

/**
 * Credit purchases via HitPay (sandbox for the pilot).
 *
 * `payments` is the authoritative record of a purchase. Money never lives in
 * Google Sheets. A purchase only adds credits once its webhook is verified and
 * the `credit_ledger` grant succeeds — a frontend redirect alone changes
 * nothing here. `credit_ledger_source_id` is the deterministic idempotency key
 * used for the grant, so a duplicate webhook cannot double-credit.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Our stable reference, generated before contacting the provider and sent
    // to HitPay as `reference_number`. Unique — the anchor for idempotency.
    reference: text("reference").notNull().unique(),
    provider: text("provider").notNull().default("hitpay"),
    // HitPay payment-request id (from the create call).
    providerPaymentId: text("provider_payment_id"),
    // HitPay's own payment id from the webhook / status pull.
    providerReference: text("provider_reference").notNull().default(""),
    status: text("status").notNull().default("pending"), // pending | paid | failed | expired | canceled | refunded
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("SGD"),
    credits: integer("credits").notNull(), // credits granted on success
    packId: text("pack_id").notNull().default(""),
    actorEmail: text("actor_email").notNull().default(""),
    actorName: text("actor_name").notNull().default(""),
    // Deterministic `LDG-…` id used for the credit grant. Set once credited.
    creditLedgerSourceId: text("credit_ledger_source_id"),
    creditedAt: timestamp("credited_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // Optional caller idempotency key (e.g. from an Idempotency-Key header).
    idempotencyKey: text("idempotency_key").unique(),
    lastEvent: jsonb("last_event"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payments_status_idx").on(table.status),
    index("payments_provider_payment_id_idx").on(table.providerPaymentId),
    index("payments_actor_email_idx").on(table.actorEmail),
    index("payments_created_at_idx").on(table.createdAt),
  ],
);

/** Append-only audit of every provider callback / status change on a payment. */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().default("webhook"), // webhook | reconcile | create
    event: text("event").notNull().default(""),
    status: text("status").notNull().default(""),
    signatureValid: boolean("signature_valid").notNull().default(false),
    // A provider-supplied de-dupe handle (payment id + status), UNIQUE so a
    // replayed webhook is a no-op insert.
    dedupeKey: text("dedupe_key").unique(),
    detail: jsonb("detail"),
  },
  (table) => [index("payment_events_payment_id_idx").on(table.paymentId)],
);

export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
