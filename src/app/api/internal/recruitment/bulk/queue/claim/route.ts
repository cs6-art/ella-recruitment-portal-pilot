import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { boundedLimit } from "@/lib/internal-recruitment-http";
import { claimBulkQueue, DEFAULT_BULK_CLAIM_LIMIT } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A worker claim is capped: the n8n screener handles claimed resumes one at a
// time, so a large claim outlives its lease and is re-claimed by overlapping runs.
const MAX_BULK_CLAIM_LIMIT = 5;

export const POST = withInternalAuth("bulk_queue", async (request) => {
  const requested = new URL(request.url).searchParams.get("limit");
  const limit = requested ? Math.min(MAX_BULK_CLAIM_LIMIT, boundedLimit(requested)) : DEFAULT_BULK_CLAIM_LIMIT;
  const items = await claimBulkQueue(limit);
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});
