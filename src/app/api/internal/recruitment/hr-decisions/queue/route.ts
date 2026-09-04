import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { hrDecisionQueue } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// n8n "HR Approval Notifications" reads applications awaiting an HR decision.
export const GET = withInternalAuth("hr_decisions", async (request) => {
  const stage = new URL(request.url).searchParams.get("stage");
  if (stage && !["resume", "voice", "final"].includes(stage)) return internalJson({ ok: false, error: "invalid_stage" }, 422);
  const items = await hrDecisionQueue(stage as "resume" | "voice" | "final" | undefined);
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});
