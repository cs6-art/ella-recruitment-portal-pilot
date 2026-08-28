/**
 * Pure Ella Credits arithmetic — no Google Sheets or network dependency, so it
 * is unit-testable in isolation. The stateful ledger lives in ella-credits.ts.
 */

/** Published Ella Credits per unit of each metered action. */
export const CREDIT_COST = {
  cv_analysis: 1,
  phone_interview: 10,
} as const;

export type CreditEvent = keyof typeof CREDIT_COST;

export type LedgerDelta = { creditsDelta: number };

export class EllaCreditsError extends Error {
  code = "INSUFFICIENT_CREDITS" as const;
  required: number;
  available: number;

  constructor(required: number, available: number) {
    super(`Not enough Ella Credits: ${required} required, ${available} available.`);
    this.name = "EllaCreditsError";
    this.required = required;
    this.available = available;
  }
}

/** Credits needed for `units` at `cost` each (units below 1 count as 0). */
export function creditsRequired(units: number, cost: number): number {
  return Math.max(0, Math.trunc(units)) * Math.max(0, Math.trunc(cost));
}

/** Balance and lifetime totals from every ledger row's signed delta. */
export function summarizeLedger(entries: LedgerDelta[]): { balance: number; toppedUp: number; consumed: number } {
  let toppedUp = 0;
  let consumed = 0;
  for (const entry of entries) {
    const delta = Math.trunc(entry.creditsDelta) || 0;
    if (delta >= 0) toppedUp += delta;
    else consumed += -delta;
  }
  return { balance: toppedUp - consumed, toppedUp, consumed };
}

/** Throws `EllaCreditsError` when `balance` cannot cover `units` at `cost` each. */
export function assertBalanceCovers(balance: number, units: number, cost: number): number {
  const required = creditsRequired(units, cost);
  if (balance < required) throw new EllaCreditsError(required, balance);
  return balance - required;
}
