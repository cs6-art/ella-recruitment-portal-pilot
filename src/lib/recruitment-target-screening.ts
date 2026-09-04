import crypto from "node:crypto";

import { creditCostFor, EllaCreditsError } from "@/lib/ella-credits";
import {
  claimBulkQueueItem,
  finalizeBulkScreening,
  getBulkScreeningContext,
  updateBulkQueueStatus,
} from "@/lib/internal-recruitment-queries";
import { parseScreeningResult, screeningDbValues } from "@/lib/recruitment-screening";

function text(value: unknown) {
  return String(value ?? "").trim();
}

/**
 * Process one claimed target queue item. Queue claim is atomic, and the final
 * result + history + charge is committed by finalizeBulkScreening atomically.
 * AI inference is deliberately performed by the n8n target worker. Vercel
 * validates the worker result and owns persistence/credit idempotency only.
 */
export async function processTargetBulkScreening(input: {
  dedupeKey: string;
  screening: unknown;
  actorEmail?: string;
  actorName?: string;
}) {
  const dedupeKey = input.dedupeKey.trim();
  if (!dedupeKey) return { status: "failed" as const, error: "dedupeKey_required" };

  let context = await getBulkScreeningContext(dedupeKey);
  if (!context) return { status: "failed" as const, error: "unknown_queue" };
  if (context.item.status === "screened") return { status: "duplicate" as const, dedupeKey };
  if (context.item.status === "queued" || context.item.status === "failed") {
    const claimed = await claimBulkQueueItem(dedupeKey);
    if (!claimed) {
      context = await getBulkScreeningContext(dedupeKey);
      if (!context || context.item.status === "screened") return { status: "duplicate" as const, dedupeKey };
      if (context.item.status !== "processing") return { status: "failed" as const, error: "queue_claim_conflict" };
    }
  }
  if (context.item.status !== "processing" && context.item.status !== "queued" && context.item.status !== "failed") {
    return { status: "failed" as const, error: "queue_not_processable" };
  }
  if (!context.application) return { status: "failed" as const, error: "missing_application" };

  try {
    const aiResult = parseScreeningResult(input.screening);
    const cost = await creditCostFor("cv_analysis");
    const result = await finalizeBulkScreening({
      dedupeKey,
      screening: { ...screeningDbValues(aiResult), raw: aiResult },
      ledger: {
        type: "Deduction",
        event: "cv_analysis",
        units: 1,
        creditsDelta: -cost,
        reference: dedupeKey,
        roleId: text(context.role.externalId),
        actorName: input.actorName || "",
        actorEmail: input.actorEmail || "",
        note: "Postgres target bulk resume screening",
        sourceEntryId: `LDG-${crypto.createHash("sha256").update(`cv:${dedupeKey}`).digest("hex")}`,
      },
      actorEmail: input.actorEmail,
      actorName: input.actorName,
    });
    if (result.duplicate) return { status: "duplicate" as const, dedupeKey };
    if (result.error) return { status: "failed" as const, error: result.error };
    return { status: "screened" as const, dedupeKey, applicationId: context.application.externalId, creditApplied: result.credit?.applied === true };
  } catch (error) {
    const message = error instanceof EllaCreditsError ? "insufficient_credits" : error instanceof Error ? error.message : "screening_failed";
    await updateBulkQueueStatus({ dedupeKey, status: "failed", errorMessage: message }).catch(() => undefined);
    return { status: "failed" as const, error: message };
  }
}
