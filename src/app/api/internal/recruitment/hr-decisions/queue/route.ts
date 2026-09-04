import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { hrDecisionQueue } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// n8n "HR Approval Notifications" reads applications awaiting an HR decision.
export const GET = withInternalAuth("hr_decisions", async () => {
  const items = await hrDecisionQueue();
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});
