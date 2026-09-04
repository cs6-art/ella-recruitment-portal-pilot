import { internalJson, withInternalAuth } from "@/lib/internal-api-http";
import { getApplication } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalAuth("applications", async (request) => {
  const externalId = new URL(request.url).searchParams.get("externalId")?.trim();
  if (!externalId) return internalJson({ ok: false, error: "externalId_required" }, 422);
  const application = await getApplication(externalId);
  if (!application) return internalJson({ ok: false, error: "unknown_application" }, 404);
  return internalJson({ ok: true, migrated: true, application });
});
