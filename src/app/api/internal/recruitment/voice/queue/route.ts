import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { pendingVoiceCalls } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// n8n "Scheduled Voice Calling" reads this instead of polling Voice_Call_Queue.
export const GET = withInternalAuth("voice_queue", async () => {
  const items = await pendingVoiceCalls();
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});
