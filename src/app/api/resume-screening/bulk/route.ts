import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canManagePipeline } from "@/lib/access-control";
import { getBulkResumeQueue, getBulkResumeQueueTotals, getBulkResumeScreeningEvidence } from "@/lib/candidate-applications";
import { bulkResumeEnvironment, bulkResumeIsUatMarked, productionUatBatchId, STALE_PROCESSING_MS } from "@/lib/bulk-resume-config";
import { getRoleRequests, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { logServerTiming, measureServerOperation } from "@/lib/server-timing";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";
function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  let roleCount = 0;
  let queueCount = 0;
  let evidenceCount = 0;
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return errorResponse("Authentication required.", 401);
  if (!canManagePipeline(user)) return errorResponse("Only HR reviewers can view bulk screening status.", 403);

  const roleId = new URL(request.url).searchParams.get("roleId")?.trim() || "";
  try {
    const configuredProductionUatBatchId = productionUatBatchId();
    const roles = await measureServerOperation(timings, "roles", () => getRoleRequests({ liveOnly: true }));
    roleCount = roles.length;
    const publishedRoleIds = new Set(
      roles
        .filter(isPublishedRoleForIntake)
        .map((role) => role.roleId.toLowerCase()),
    );
    if (roleId && !publishedRoleIds.has(roleId.toLowerCase())) return errorResponse("The selected role is not published.", 409);

    // n8n is the writer for this tab, so a cached read can hide a completed
    // screening for the entire 20-second Sheets cache TTL. This endpoint is
    // polled while work is active; read the queue fresh so the UI never turns
    // a stale snapshot into a misleading completion state.
    const queueItems = (await measureServerOperation(timings, "queue", () => getBulkResumeQueue(roleId, { fresh: true }))).filter((item) => publishedRoleIds.has(item.roleId.toLowerCase()));
    queueCount = queueItems.length;
    // Keep the table on the latest state per resume, but count every saved
    // queue event separately so retries and repeated failed batches are not
    // silently collapsed into one historical total.
    const historicalTotals = isPostgresRecruitmentTarget()
      ? queueItems.reduce<Record<string, number>>((result, item) => {
        const status = ["Screened", "Failed", "Skipped", "Processing", "Queued"].includes(item.status) ? item.status : "Queued";
        result[status] = (result[status] || 0) + 1;
        return result;
      }, {})
      : await measureServerOperation(timings, "historicalTotals", () => getBulkResumeQueueTotals(roleId, { fresh: true }));
    // Reconcile every current queue item, including historical rows that were
    // written before jobId existed. The evidence matcher falls back through
    // application ID, SHA, Drive file ID, role-scoped filename, and unique
    // candidate identifiers without allowing cross-role matches.
    const screeningEvidence = await measureServerOperation(timings, "screeningEvidence", () => getBulkResumeScreeningEvidence(queueItems));
    evidenceCount = screeningEvidence.size;
    const now = Date.now();
    const queueAge = (item: (typeof queueItems)[number]) => {
      const timestamp = Date.parse(item.lastUpdated || item.processedAt || item.processingStartedAt || item.discoveredAt);
      return Number.isFinite(timestamp) ? now - timestamp : Number.MAX_SAFE_INTEGER;
    };
    const items = queueItems.map((item) => {
      const rawStatus = item.status.toLowerCase();
      const hasEvidence = screeningEvidence.has(`${item.roleId.toLowerCase()}|${item.driveFileId.toLowerCase()}`);
      if (hasEvidence && ["screened", "processed", "processing"].includes(rawStatus)) {
        return { ...item, status: "Screened", errorMessage: "" };
      }
      if (["screened", "processed"].includes(rawStatus)) {
        // A recent Screened event can briefly precede the applicant write. An
        // old one is no longer active work and must be visible as a durable
        // failure rather than an endless Processing item.
        if (queueAge(item) >= STALE_PROCESSING_MS) {
          return { ...item, status: "Failed", errorMessage: "Applicant result could not be persisted." };
        }
        return { ...item, status: "Processing", errorMessage: "Waiting for the saved applicant screening result." };
      }
      if (rawStatus === "processing" && queueAge(item) >= STALE_PROCESSING_MS) {
        return { ...item, status: "Failed", errorMessage: "Screening did not produce a saved result within 10 minutes." };
      }
      return item;
    });
    const counts = items.reduce<Record<string, number>>((result, item) => {
      const status = item.status || "Queued";
      result[status] = (result[status] || 0) + 1;
      return result;
    }, {});

    logServerTiming(new URL(request.url).pathname, startedAt, timings, { dbOperations: isPostgresRecruitmentTarget() ? 3 : 0, roleCount, queueCount, evidenceCount });
    return NextResponse.json({
      success: true,
      configured: true,
      // This is an authenticated, non-secret readiness signal for the
      // controlled Production canary. It lets operators verify the active
      // deployment without uploading a resume just to inspect its config.
      productionUatActive: Boolean(configuredProductionUatBatchId),
      batchId: configuredProductionUatBatchId,
      environment: bulkResumeIsUatMarked() ? "uat" : bulkResumeEnvironment(),
      isUat: bulkResumeIsUatMarked(),
      counts,
      // The cards below the batch bar describe the role's current queue
      // state, not the number of append-only retry events. Returning the same
      // reconciled counts used by the items prevents Processing and Completed
      // from disagreeing with the live batch bar.
      roleTotals: counts,
      historicalTotals,
      items: items.slice(0, 50),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logServerTiming(new URL(request.url).pathname, startedAt, timings, { dbOperations: isPostgresRecruitmentTarget() ? 3 : 0, roleCount, queueCount, evidenceCount });
    const message = error instanceof Error ? error.message : "Bulk screening status is not configured.";
    const configured = !message.toLowerCase().includes("bulk_resume_queue") && !message.toLowerCase().includes("unable to parse range");
    return NextResponse.json({
      success: true,
      configured: false,
      counts: {},
      items: [],
      error: configured ? message : "Create the Bulk_Resume_Queue tab to view processing status.",
    });
  }
}
