/**
 * Pure Ella Credits arithmetic — no Google Sheets or network dependency, so it
 * is unit-testable in isolation. The stateful ledger lives in ella-credits.ts.
 */

/** Published Ella Credits per unit of each metered action. */
export const CREDIT_COST = {
  cv_analysis: 1,
  phone_interview: 10,
  phone_interview_no_answer: 5,
  phone_interview_incomplete: 8,
} as const;

export type CreditEvent = keyof typeof CREDIT_COST;

export type VoiceInterviewBillingOutcome = "completed" | "no_answer" | "incomplete";

export const VOICE_INTERVIEW_BILLING_COST = {
  completed: CREDIT_COST.phone_interview,
  no_answer: CREDIT_COST.phone_interview_no_answer,
  incomplete: CREDIT_COST.phone_interview_incomplete,
} as const satisfies Record<VoiceInterviewBillingOutcome, number>;

const NO_ANSWER_SIGNALS = new Set([
  "no_answer",
  "no-answer",
  "no answer",
  "no_show",
  "no-show",
  "busy",
  "voicemail",
  "customer-did-not-answer",
  "customer_did_not_answer",
]);

const INCOMPLETE_SIGNALS = new Set([
  "incomplete",
  "partial",
  "ended-before-completion",
  "ended_before_completion",
]);

function normalizedSignal(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Classify one terminal voice attempt for outcome billing. A booking is not a
 * billable event: the call must reach a terminal outcome first.
 *
 * `isComplete`/`completenessScore` are optional because older Vapi payloads do
 * not send them. In that case a non-empty transcript is the completion proof.
 */
export function classifyVoiceInterviewBillingOutcome(input: {
  outcome?: string;
  callStatus?: string;
  callFinalStatus?: string;
  transcript?: string;
  isComplete?: boolean;
  completenessScore?: number | null;
}): VoiceInterviewBillingOutcome | null {
  const signals = [input.outcome, input.callStatus, input.callFinalStatus].map(normalizedSignal).filter(Boolean);
  if (signals.some((signal) => NO_ANSWER_SIGNALS.has(signal))) return "no_answer";
  if (signals.some((signal) => INCOMPLETE_SIGNALS.has(signal)) || input.isComplete === false) return "incomplete";

  const transcript = String(input.transcript ?? "").trim();
  const terminal = signals.some((signal) => signal === "completed" || signal === "complete" || signal === "ended" || signal === "finished") || Boolean(transcript);
  if (!terminal) return null;
  if (input.completenessScore !== undefined && input.completenessScore !== null && input.completenessScore < 100) return "incomplete";
  return transcript ? "completed" : "incomplete";
}

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
