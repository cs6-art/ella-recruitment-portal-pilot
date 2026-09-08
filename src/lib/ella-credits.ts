import crypto from "node:crypto";

import { assertBalanceCovers, CREDIT_COST, type CreditEvent, type VoiceInterviewBillingOutcome, VOICE_INTERVIEW_BILLING_COST } from "@/lib/ella-credit-math";
import { getPortalConfig } from "@/lib/portal-config";
import { isDatabaseConfigured } from "@/db/client";
import { appendSheetLedgerEntry, getSheetCreditBalance } from "@/lib/ella-credits-sheets";
import { appendPostgresLedgerEntry, getPostgresCreditBalance } from "@/lib/ella-credits-postgres";
import type { CreditBalance, LedgerAppend } from "@/lib/ella-credits-store";

export { CREDIT_COST, EllaCreditsError } from "@/lib/ella-credit-math";
export type { CreditEvent } from "@/lib/ella-credit-math";
export type { CreditBalance, LedgerEntry } from "@/lib/ella-credits-store";

/**
 * Ella Credits — single org-wide balance metering every AI action.
 *
 * Storage is switchable via `CREDITS_BACKEND` (Phase 2 backend migration):
 *  - `sheets`   (default): the original Google Sheet ledger.
 *  - `dual`     : Sheets stays authoritative; every write is mirrored to
 *                 Postgres best-effort and divergence is logged. Reads = Sheets.
 *  - `postgres` : Neon Postgres is authoritative — atomic balance, no overspend.
 *
 * The public API and every caller are unchanged across all three modes.
 */

type CreditsBackend = "sheets" | "dual" | "postgres";

function creditsBackend(): CreditsBackend {
  const raw = (process.env.CREDITS_BACKEND || "sheets").trim().toLowerCase();
  if (raw === "dual" || raw === "postgres") {
    if (!isDatabaseConfigured()) {
      console.error(`[Credits] CREDITS_BACKEND=${raw} but DATABASE_URL is unset — falling back to sheets.`);
      return "sheets";
    }
    return raw;
  }
  return "sheets";
}

/**
 * The idempotency handle for a ledger write.
 * - No `idempotencyKey`: a fresh random `LDG-<uuid>` (never collides — the
 *   historical behaviour; a *caller-level* retry would double-charge).
 * - With an `idempotencyKey`: a deterministic `LDG-<sha256(key)>`. A retry of
 *   the same logical operation (same key) is then a no-op on the unique
 *   `source_entry_id` in Postgres, and is skipped by the Sheets append too.
 */
function newSourceEntryId(idempotencyKey?: string): string {
  const key = idempotencyKey?.trim();
  if (key) return `LDG-${crypto.createHash("sha256").update(key).digest("hex")}`;
  return `LDG-${crypto.randomUUID()}`;
}

async function mirrorToPostgres(entry: LedgerAppend): Promise<void> {
  try {
    const { applied } = await appendPostgresLedgerEntry(entry, { guard: false });
    if (!applied) return; // idempotent replay — already mirrored
  } catch (error) {
    console.error("[Credits] Postgres mirror write failed (Sheets remains authoritative):", error);
  }
}

// --- Reads --------------------------------------------------------------------

export async function getCreditBalance(options: { fresh?: boolean } = {}): Promise<CreditBalance> {
  const backend = creditsBackend();
  if (backend === "postgres") return getPostgresCreditBalance();
  const balance = await getSheetCreditBalance(options);
  // Divergence check only on a fresh sheet read. The Postgres balance is always
  // fresh (O(1) query); comparing it against a *cached* sheet value (20s TTL,
  // and stale-served on a quota error) produces false "divergence" for up to
  // the cache window right after any write. `assertCreditsAvailable` and
  // `recordTopUp` both read fresh, so real divergence is still caught on every
  // deduction batch and every top-up — fresh-vs-fresh.
  if (backend === "dual" && options.fresh) {
    void getPostgresCreditBalance()
      .then((pg) => {
        if (pg.balance !== balance.balance) {
          console.error(`[Credits] Divergence: sheets balance ${balance.balance} vs postgres ${pg.balance}.`);
        }
      })
      .catch((error) => console.error("[Credits] Divergence check failed:", error));
  }
  return balance;
}

// --- Pricing (unchanged) -----------------------------------------------------

export type CreditPricing = {
  cvAnalysis: number;
  phoneInterview: number;
  phoneInterviewNoAnswer: number;
  phoneInterviewIncomplete: number;
  discountThreshold: number;
  discountPercent: number;
};

function configuredWholeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

export async function getCreditPricing(): Promise<CreditPricing> {
  const config = await getPortalConfig();
  return {
    cvAnalysis: CREDIT_COST.cv_analysis,
    phoneInterview: CREDIT_COST.phone_interview,
    phoneInterviewNoAnswer: CREDIT_COST.phone_interview_no_answer,
    phoneInterviewIncomplete: CREDIT_COST.phone_interview_incomplete,
    discountThreshold: configuredWholeNumber(config.Ella_Credit_Discount_Threshold, 2000),
    discountPercent: configuredWholeNumber(config.Ella_Credit_Discount_Percent, 10),
  };
}

export async function creditCostFor(event: CreditEvent): Promise<number> {
  const pricing = await getCreditPricing();
  switch (event) {
    case "cv_analysis": return pricing.cvAnalysis;
    case "phone_interview_no_answer": return pricing.phoneInterviewNoAnswer;
    case "phone_interview_incomplete": return pricing.phoneInterviewIncomplete;
    default: return pricing.phoneInterview;
  }
}

export async function volumeDiscountBonus(amount: number): Promise<{ bonus: number; percent: number; threshold: number }> {
  const { discountThreshold: threshold, discountPercent: percent } = await getCreditPricing();
  if (amount <= 0 || threshold <= 0 || percent <= 0 || amount < threshold) return { bonus: 0, percent, threshold };
  return { bonus: Math.floor(amount * (percent / 100)), percent, threshold };
}

// --- Writes ------------------------------------------------------------------

/**
 * Best-effort pre-check that the balance can cover `units` of `event`. In
 * postgres mode the authoritative guard is the atomic `recordDeduction`; this
 * is still used up front (e.g. to fail a whole bulk batch before any work).
 */
export async function assertCreditsAvailable(units: number, event: CreditEvent): Promise<number> {
  const [{ balance }, cost] = await Promise.all([getCreditBalance({ fresh: true }), creditCostFor(event)]);
  return assertBalanceCovers(balance, units, cost);
}

async function append(entry: LedgerAppend, opts: { guard: boolean }): Promise<{ balanceAfter: number }> {
  const backend = creditsBackend();
  if (backend === "postgres") {
    const { balanceAfter } = await appendPostgresLedgerEntry(entry, opts);
    return { balanceAfter };
  }
  const { balanceAfter } = await appendSheetLedgerEntry(entry);
  if (backend === "dual") await mirrorToPostgres(entry);
  return { balanceAfter };
}

export async function recordDeduction(input: {
  event: CreditEvent;
  units: number;
  reference: string;
  roleId?: string;
  actorName?: string;
  actorEmail?: string;
  note?: string;
  /**
   * Stable caller-level idempotency key. When set, retrying the same logical
   * charge (same key) does not create a second billing identity — the write
   * dedupes on `source_entry_id`. Recommended: the queueId / applicationId /
   * bookingId the charge is "for".
   */
  idempotencyKey?: string;
}): Promise<void> {
  const units = Math.max(1, Math.trunc(input.units));
  const cost = await creditCostFor(input.event);
  await append(
    {
      type: "Deduction",
      event: input.event,
      units,
      creditsDelta: -units * cost,
      reference: input.reference,
      roleId: input.roleId,
      actorName: input.actorName,
      actorEmail: input.actorEmail,
      note: input.note,
      sourceEntryId: newSourceEntryId(input.idempotencyKey),
    },
    // Only postgres mode enforces the guard; sheets/dual keep the Sheets
    // "append and only log on failure" posture.
    { guard: true },
  );
}

/**
 * Bill a completed voice attempt after Vapi has produced a terminal outcome.
 * The attempt id is the billing identity, so result/log/status retries cannot
 * charge the same call twice.
 */
export async function recordVoiceInterviewDeduction(input: {
  applicationId: string;
  attemptId: string;
  outcome: VoiceInterviewBillingOutcome;
  actorEmail?: string;
}): Promise<number> {
  const event = input.outcome === "completed"
    ? "phone_interview"
    : input.outcome === "no_answer"
      ? "phone_interview_no_answer"
      : "phone_interview_incomplete";
  const cost = VOICE_INTERVIEW_BILLING_COST[input.outcome];
  await recordDeduction({
    event,
    units: 1,
    reference: input.applicationId,
    idempotencyKey: `voice-attempt:${input.attemptId}`,
    actorEmail: input.actorEmail,
    note: `AI voice interview outcome: ${input.outcome}`,
  });
  return cost;
}

export async function recordTopUp(input: {
  amount: number;
  actorName: string;
  actorEmail: string;
  note: string;
  /** Event tag override (default manual_topup / manual_adjustment). e.g. "purchase". */
  event?: string;
  reference?: string;
  /**
   * Stable idempotency key. When set (e.g. a payment reference), replaying the
   * same top-up does not add credits twice. The volume-discount bonus row, if
   * any, is keyed deterministically off the same key.
   */
  idempotencyKey?: string;
}): Promise<CreditBalance & { bonus: number }> {
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new Error("Top-up amount must be a non-zero whole number.");

  const primaryEvent = input.event?.trim() || (amount > 0 ? "manual_topup" : "manual_adjustment");
  await append(
    {
      type: "TopUp",
      event: primaryEvent,
      units: Math.abs(amount),
      creditsDelta: amount,
      reference: input.reference,
      actorName: input.actorName,
      actorEmail: input.actorEmail,
      note: input.note,
      sourceEntryId: newSourceEntryId(input.idempotencyKey),
    },
    { guard: false },
  );

  const { bonus, percent } = await volumeDiscountBonus(amount);
  if (bonus > 0) {
    await append(
      {
        type: "TopUp",
        event: "volume_discount",
        units: bonus,
        creditsDelta: bonus,
        reference: input.reference,
        actorName: input.actorName,
        actorEmail: input.actorEmail,
        note: `${percent}% volume discount on a ${amount}-credit top-up`,
        sourceEntryId: newSourceEntryId(input.idempotencyKey ? `${input.idempotencyKey}:bonus` : undefined),
      },
      { guard: false },
    );
  }

  return { ...(await getCreditBalance({ fresh: true })), bonus };
}
