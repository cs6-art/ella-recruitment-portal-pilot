import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { staleVoiceStageApplications } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// n8n "Voice Result Status Sync" safety net: applications that have a voice
// result but are still at voice_scheduled (all organizations). The fix is
// POST /api/internal/recruitment/status-history -> voice_review_pending.
export const GET = withInternalAuth("voice_results", async () => {
  const items = await staleVoiceStageApplications();
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});
