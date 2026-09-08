import { internalJson, readInternalJson, withInternalAuth } from "@/lib/internal-api-http";
import { record, requiredString } from "@/lib/internal-recruitment-http";
import { createBookingToken, getBookingToken } from "@/lib/internal-recruitment-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withInternalAuth("booking", async (request) => {
  const body = await readInternalJson(request, (value): value is Record<string, unknown> => {
    const item = record(value);
    return Boolean(item && requiredString(item.applicationExternalId) && requiredString(item.kind));
  });
  if (!body) return internalJson({ ok: false, error: "application_kind_required" }, 422);
  if (body.kind !== "voice" && body.kind !== "final") return internalJson({ ok: false, error: "invalid_booking_kind" }, 422);
  const result = await createBookingToken({ applicationExternalId: String(body.applicationExternalId), kind: body.kind, tokenHash: typeof body.tokenHash === "string" ? body.tokenHash : undefined, link: typeof body.link === "string" ? body.link : undefined, expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined });
  if (result.error) return internalJson({ ok: false, error: result.error }, 404);
  return internalJson({ ok: true, migrated: true, created: result.created, token: result.token, notificationHistoryId: result.notificationHistoryId }, result.created ? 201 : 200);
});

export const GET = withInternalAuth("booking", async (request) => {
  const tokenHash = new URL(request.url).searchParams.get("tokenHash")?.trim();
  if (!tokenHash) return internalJson({ ok: false, error: "tokenHash_required" }, 422);
  const result = await getBookingToken(tokenHash);
  if (!result) return internalJson({ ok: false, error: "unknown_booking_token" }, 404);
  return internalJson({ ok: true, migrated: true, token: result });
});
