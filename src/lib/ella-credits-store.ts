import { EllaCreditsError } from "@/lib/ella-credit-math";

/** Shared types for the Ella Credits storage layer (Sheets and Postgres). */

export type LedgerEntry = {
  entryId: string;
  timestamp: string;
  type: "TopUp" | "Deduction";
  event: string;
  units: number;
  creditsDelta: number;
  balanceAfter: number;
  reference: string;
  roleId: string;
  actorName: string;
  actorEmail: string;
  note: string;
};

export type CreditBalance = {
  balance: number;
  totals: { toppedUp: number; consumed: number };
  entries: LedgerEntry[];
};

export type LedgerAppend = {
  type: "TopUp" | "Deduction";
  event: string;
  units: number;
  creditsDelta: number; // signed
  reference?: string;
  roleId?: string;
  actorName?: string;
  actorEmail?: string;
  note?: string;
  /** Old `LDG-…` id or a deterministic synthetic key — idempotency handle. */
  sourceEntryId: string;
};

export { EllaCreditsError };
