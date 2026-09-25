import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { inFlightVoiceAttempts, reconcileStaleVoiceAttempts } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// n8n "Vapi Call Result Reconciler" reads voice attempts that Vapi accepted but
// that have no terminal result yet, and asks the provider how each call ended.
export const GET = withInternalAuth("voice_attempts", async (request) => {
  // Settle rejected/unanswered calls on every poll instead of waiting for the
  // once-a-day cron. Best-effort: a sweep failure must not block the poll.
  await reconcileStaleVoiceAttempts().catch((error) => console.error("[Voice Attempts] Opportunistic reconciliation failed:", error));
  const minAge = Number(new URL(request.url).searchParams.get("minAgeMinutes") || "2");
  const items = await inFlightVoiceAttempts(Number.isFinite(minAge) ? minAge : 2);
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});
