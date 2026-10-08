import { sql } from "drizzle-orm";
import { boolean, integer, index, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  databaseKey: text("database_key").notNull().default("mclinkgroup"),
  databaseStatus: text("database_status").notNull().default("ready"),
  active: boolean("active").notNull().default(true),
  /** Email domains (e.g. "mclinkgroup.com") that may self-register into this organization. */
  allowedDomains: text("allowed_domains").array().notNull().default(sql`'{}'::text[]`),
  /** Individual addresses (any domain) that may self-register into this organization. */
  allowedEmails: text("allowed_emails").array().notNull().default(sql`'{}'::text[]`),
  /** Null for organizations that existed before the guided onboarding flow. */
  onboardingStartedAt: timestamp("onboarding_started_at", { withTimezone: true }),
  /** Most active people the organization may have; null means no limit. Raised or removed by a McLink administrator. */
  maxMembers: integer("max_members"),
  /** Days Live Avatar interview recordings are kept; null uses the platform default. Set by an organization's Settings administrator. */
  interviewRecordingRetentionDays: integer("interview_recording_retention_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Email + password login identity created by self-registration. */
export const userCredentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    /** Null until verification creates the new organization for a company domain nobody owns yet. */
    organizationId: uuid("organization_id").references(() => organizations.id),
    fullName: text("full_name").notNull().default(""),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    verificationTokenHash: text("verification_token_hash"),
    verificationExpiresAt: timestamp("verification_expires_at", { withTimezone: true }),
    resetTokenHash: text("reset_token_hash"),
    resetExpiresAt: timestamp("reset_expires_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("user_credentials_email_uidx").on(table.email), index("user_credentials_token_idx").on(table.verificationTokenHash)],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    email: text("email").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("organization_memberships_email_idx").on(table.email, table.active), unique("organization_memberships_org_email_key").on(table.organizationId, table.email)],
);

/**
 * Phase 2 backend migration — first pilot table.
 *
 * The Smile Credits balance lived in an append-only Google Sheet tab, where the
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
    event: text("event").notNull(), // Top-ups/adjustments, CV analysis, voice outcomes, or live-avatar interview billing.
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

/**
 * One shared balance per organization. The owner email is the canonical
 * value `org`; per-actor attribution lives on the ledger rows.
 */
export const creditAccounts = pgTable(
  "credit_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    ownerEmail: text("owner_email").notNull(),
    balance: integer("balance").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("credit_accounts_organization_uidx").on(table.organizationId)],
);

export const creditAccountLedger = pgTable(
  "credit_account_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull().references(() => creditAccounts.id),
    entryTime: timestamp("entry_time", { withTimezone: true }).notNull().defaultNow(),
    type: text("type").notNull(),
    event: text("event").notNull(),
    units: integer("units").notNull(),
    creditsDelta: integer("credits_delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reference: text("reference").notNull().default(""),
    roleId: text("role_id").notNull().default(""),
    actorName: text("actor_name").notNull().default(""),
    actorEmail: text("actor_email").notNull().default(""),
    note: text("note").notNull().default(""),
    sourceEntryId: text("source_entry_id").notNull(),
  },
  (table) => [index("credit_account_ledger_account_time_idx").on(table.accountId, table.entryTime), unique("credit_account_ledger_account_source_key").on(table.accountId, table.sourceEntryId)],
);

/** Promo codes that add Smile Credits to an organization wallet (migration 0040). */
export const promoCodes = pgTable("promo_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  credits: integer("credits").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  maxRedemptions: integer("max_redemptions"),
  redemptionCount: integer("redemption_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  note: text("note").notNull().default(""),
  createdByEmail: text("created_by_email").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  disabledByEmail: text("disabled_by_email").notNull().default(""),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const promoCodeRedemptions = pgTable(
  "promo_code_redemptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promoCodeId: uuid("promo_code_id").notNull().references(() => promoCodes.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    credits: integer("credits").notNull(),
    redeemedByEmail: text("redeemed_by_email").notNull().default(""),
    redeemedByName: text("redeemed_by_name").notNull().default(""),
    ledgerSourceEntryId: text("ledger_source_entry_id").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("promo_code_redemptions_code_org_uidx").on(table.promoCodeId, table.organizationId), index("promo_code_redemptions_org_idx").on(table.organizationId, table.redeemedAt)],
);

/**
 * Event launch promotion: the first `maxAllocations` new organizations receive
 * `credits` welcome credits instead of the normal default (migration 0041).
 * `allocatedCount` is only ever raised by the conditional UPDATE in
 * `launch-promotion.ts`, which is what makes the cap concurrency-safe.
 */
export const launchPromotions = pgTable("launch_promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  credits: integer("credits").notNull(),
  maxAllocations: integer("max_allocations").notNull(),
  allocatedCount: integer("allocated_count").notNull().default(0),
  active: boolean("active").notNull().default(false),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const launchPromotionAllocations = pgTable(
  "launch_promotion_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    promotionId: uuid("promotion_id").notNull().references(() => launchPromotions.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    sequenceNumber: integer("sequence_number").notNull(),
    credits: integer("credits").notNull(),
    ledgerSourceEntryId: text("ledger_source_entry_id").notNull(),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("launch_promotion_allocations_org_uidx").on(table.promotionId, table.organizationId), unique("launch_promotion_allocations_sequence_uidx").on(table.promotionId, table.sequenceNumber)],
);

/** Structured user feedback from the sign-out prompt and Smile Bot (migration 0041). */
export const portalFeedback = pgTable(
  "portal_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    userEmail: text("user_email").notNull().default(""),
    userName: text("user_name").notNull().default(""),
    source: text("source").notNull(),
    navigationEase: smallint("navigation_ease").notNull(),
    taskCompletion: smallint("task_completion").notNull(),
    aiUsefulness: smallint("ai_usefulness").notNull(),
    experiencedIssue: boolean("experienced_issue").notNull(),
    issueDescription: text("issue_description").notNull().default(""),
    improvementSuggestion: text("improvement_suggestion").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("portal_feedback_created_idx").on(table.createdAt), index("portal_feedback_org_idx").on(table.organizationId, table.createdAt)],
);

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
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
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
    uniqueIndex("payments_provider_payment_id_uidx").on(table.providerPaymentId).where(sql`${table.providerPaymentId} is not null`),
    uniqueIndex("payments_provider_reference_uidx").on(table.providerReference).where(sql`${table.providerReference} <> ''`),
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
