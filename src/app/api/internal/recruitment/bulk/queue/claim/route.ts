import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { boundedLimit } from "@/lib/internal-recruitment-http";
import { claimBulkQueue } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("bulk_queue", async (request) => {
  const items = await claimBulkQueue(boundedLimit(new URL(request.url).searchParams.get("limit")));
  return internalJson({ ok: true, migrated: true, count: items.length, items });
});
