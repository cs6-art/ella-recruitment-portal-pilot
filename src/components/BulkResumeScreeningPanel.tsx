"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import DriveFilePicker from "@/components/DriveFilePicker";
import EllaCreditsMeter from "@/components/EllaCreditsMeter";
import GoogleDriveIcon from "@/components/GoogleDriveIcon";
import { requestEllaCreditsRefresh } from "@/lib/ella-credits-events";
import { buildCloudImportRequest, type CloudImportSelection } from "@/lib/cloud-import-request";
import { formatPortalDateTime } from "@/lib/portal-time";
import { MAX_CAMPAIGN_FILES, MAX_FILES_PER_SUBMISSION } from "@/lib/bulk-resume-limits";

type RoleOption = { roleId: string; label: string };
type QueueItem = {
  driveFileId: string;
  driveFileName: string;
  driveFileUrl: string;
  roleId: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  applicationId: string;
  errorMessage: string;
  discoveredAt: string;
  processingStartedAt: string;
  processedAt: string;
  attemptCount: string;
  lastUpdated: string;
  jobId: string;
};

const statusOrder = ["Queued", "Processing", "Completed", "Failed", "Skipped"];
const POLL_INTERVAL_MS = 90_000;
// MAX_FILES_PER_SUBMISSION imported from @/lib/bulk-resume-limits above — a
// dependency-free module client code can safely import (bulk-resume-intake.ts
// itself is server-only). The server also enforces this cap — see bulk/upload
// and drive/import.
const TERMINAL_STATUSES = new Set(["screened", "processed", "failed", "skipped"]);

// Pilot Postgres keeps the Drive object ID for storage traceability, while
// the upload UI tracks the role-scoped queue/job ID. Legacy rows may not have
// jobId, so retain driveFileId as a compatibility fallback.
function queueIdentity(item: Pick<QueueItem, "jobId" | "driveFileId">) {
  return item.jobId || item.driveFileId;
}

function statusClass(status: string) {
  return `bulk-status bulk-status-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// Human-facing label + result text for the live table, matching the coarse
// Queued / Uploading / Processing / Completed / Failed states HR cares
// about, distinct from the raw sheet status string used for logic.
function displayStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "screened" || normalized === "processed") return { label: "Completed", result: "Screening completed" };
  if (normalized === "processing") return { label: "Processing", result: "AI analysis running" };
  if (normalized === "failed") return { label: "Failed", result: "Retry" };
  if (normalized === "skipped") return { label: "Skipped", result: "Already screened or queued" };
  return { label: "Queued", result: "Waiting" };
}

async function fileQueueId(roleId: string, file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const roleKey = roleId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
  return `BULK-${roleKey}-${sha256}`;
}

export default function BulkResumeScreeningPanel({ roleOptions, driveRootFolderId = "" }: { roleOptions: RoleOption[]; driveRootFolderId?: string }) {
  const [roleId, setRoleId] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  // Tracks the resumes submitted in the batch currently in flight, keyed by
  // the same content-hash queue ID the server computes, so the live section
  // below can show real-time progress for exactly this upload rather than
  // the role's entire screening history.
  const [activeBatch, setActiveBatch] = useState<Map<string, string>>(new Map());
  const [batchResultStatuses, setBatchResultStatuses] = useState<Map<string, string>>(new Map());
  // "Let it sit" queue state for a selection bigger than one request can take
  // — see runBulkQueue below.
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueProgress, setQueueProgress] = useState<{ done: number; total: number } | null>(null);
  const queueCancelRef = useRef(false);
  const [driveStatus, setDriveStatus] = useState<{ connected: boolean; accountEmail: string } | null>(null);
  const [msDriveStatus, setMsDriveStatus] = useState<{ configured: boolean; connected: boolean; accountEmail: string } | null>(null);
  const [cloudPicker, setCloudPicker] = useState<"google" | "microsoft" | null>(null);
  const [driveImporting, setDriveImporting] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchFiles = useRef<Map<string, File>>(new Map());
  const refreshInFlight = useRef(false);
  const refreshAbort = useRef<AbortController | null>(null);
  const statusRequestId = useRef(0);

  const selectedRole = useMemo(() => roleOptions.find((role) => role.roleId === roleId), [roleId, roleOptions]);

  const refreshStatus = useCallback(async () => {
    if (!roleId || refreshInFlight.current) return;
    refreshInFlight.current = true;
    const requestId = ++statusRequestId.current;
    const controller = new AbortController();
    refreshAbort.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/resume-screening/bulk?roleId=${encodeURIComponent(roleId)}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to load bulk screening status.");
      // Ignore a response that belongs to an older role/request. This keeps a
      // slow poll from overwriting a newer queue snapshot.
      if (requestId !== statusRequestId.current) return;
      setItems(result.items || []);
      // Use the reconciled latest-state counts. Historical retry-event totals
      // are useful for diagnostics but must not make this summary disagree
      // with the live batch bar above it.
      setCounts(result.counts || result.roleTotals || {});
      setConfigured(result.configured !== false);
      if (result.error) setError(result.error);
    } catch (caught) {
      if (requestId === statusRequestId.current && !(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "Unable to load bulk screening status.");
    } finally {
      if (refreshAbort.current === controller) {
        refreshAbort.current = null;
        refreshInFlight.current = false;
        if (requestId === statusRequestId.current) setLoading(false);
      }
    }
  }, [roleId]);

  function selectRole(nextRoleId: string) {
    if (queueRunning) return;
    setCloudPicker(null);
    refreshAbort.current?.abort();
    refreshAbort.current = null;
    refreshInFlight.current = false;
    statusRequestId.current += 1;
    setRoleId(nextRoleId);
    setItems([]);
    setCounts({});
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());
    setQueueProgress(null);
    batchFiles.current.clear();
    setFiles([]);
    setUploadMessage("");
    setWarning("");
    setError("");
  }

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const loadDriveStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/google-drive/status", { cache: "no-store" });
      const data = await response.json();
      if (data?.success === true) setDriveStatus({ connected: Boolean(data.connected), accountEmail: data.accountEmail || "" });
    } catch {
      setDriveStatus({ connected: false, accountEmail: "" });
    }
  }, []);

  const loadMsDriveStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/microsoft-drive/status", { cache: "no-store" });
      const data = await response.json();
      if (data?.success === true) setMsDriveStatus({ configured: Boolean(data.configured), connected: Boolean(data.connected), accountEmail: data.accountEmail || "" });
    } catch {
      setMsDriveStatus({ configured: false, connected: false, accountEmail: "" });
    }
  }, []);

  useEffect(() => {
    void loadDriveStatus();
    void loadMsDriveStatus();
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("drive");
    const msOutcome = params.get("onedrive");
    if (outcome === "connected") setUploadMessage("Google Drive connected.");
    else if (outcome === "denied") setError("Google Drive access was not granted.");
    else if (outcome === "error") setError(params.get("drive_reason") || "Google Drive connection failed.");
    if (msOutcome === "connected") setUploadMessage("OneDrive connected.");
    else if (msOutcome === "denied") setError(params.get("onedrive_reason") || "OneDrive access was not granted.");
    else if (msOutcome === "error") setError(params.get("onedrive_reason") || "OneDrive connection failed.");
    if (!outcome && !msOutcome) return;
    ["drive", "drive_reason", "onedrive", "onedrive_reason"].forEach((key) => params.delete(key));
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [loadDriveStatus, loadMsDriveStatus]);


  // Polls automatically, without requiring a manual refresh, while any
  // tracked item (from the active batch, or otherwise) is still Queued or
  // Processing. Stops on its own once everything reaches a terminal state.
  const pendingInBatch = useMemo(() => {
    if (activeBatch.size === 0) return false;
    return Array.from(activeBatch.keys()).some((queueId) => {
      const item = items.find((entry) => queueIdentity(entry) === queueId);
      const reportedStatus = batchResultStatuses.get(queueId)?.toLowerCase() || "";
      // A successful response without a queue row is still only an accepted
      // handoff. Local validation/request failures may terminate immediately,
      // but successful completion must come from the queue-backed status API.
      const status = item?.status || (["failed", "skipped"].includes(reportedStatus) ? reportedStatus : "Queued");
      return !TERMINAL_STATUSES.has(status.toLowerCase());
    });
  }, [activeBatch, batchResultStatuses, items]);
  const anyPending = pendingInBatch || items.some((item) => !TERMINAL_STATUSES.has(item.status.toLowerCase()));

  // The queue only advances while this tab is open and running its own JS
  // loop -- there's no server-side job behind it. Warn before an accidental
  // close mid-run so the reviewer knows the remaining files won't submit.
  useEffect(() => {
    if (!queueRunning) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [queueRunning]);

  useEffect(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    if (!roleId || !anyPending) return;
    // Poll only while a batch is actually processing AND the tab is visible; a
    // backgrounded screening page should not keep hitting the queue API.
    pollTimer.current = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void refreshStatus();
    }, POLL_INTERVAL_MS);
    // Catch up immediately when the user returns to a tab with a batch running.
    const onVisible = () => { if (document.visibilityState === "visible") void refreshStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [roleId, anyPending, refreshStatus]);

  function addFiles(nextFiles: FileList | File[]) {
    const incoming = Array.from(nextFiles).filter((file) => /\.(pdf|docx?|doc)$/i.test(file.name));
    setFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}`));
      const merged = [...current];
      for (const file of incoming) {
        const key = `${file.name}:${file.size}`;
        if (!seen.has(key)) { merged.push(file); seen.add(key); }
      }
      // The server still caps a single request at MAX_FILES_PER_SUBMISSION;
      // selecting more than that is fine here -- "Start screening" below
      // auto-splits a larger selection into that many requests fired one at a
      // time. MAX_CAMPAIGN_FILES is just a sane ceiling on one sitting.
      if (merged.length > MAX_CAMPAIGN_FILES) {
        setWarning(`You can queue up to ${MAX_CAMPAIGN_FILES} resumes in one sitting. Extra files were not added — run another batch after this one finishes.`);
        return merged.slice(0, MAX_CAMPAIGN_FILES);
      }
      return merged;
    });
  }

  function removeFile(target: File) {
    setFiles((current) => current.filter((file) => file !== target));
  }

  // Fires exactly one MAX_FILES_PER_SUBMISSION-sized request and reports a
  // structured outcome instead of throwing, so runBulkQueue can decide
  // whether to back off-and-retry (rate limited) or stop the whole run (a
  // real failure, e.g. insufficient credits). Never call this with more than
  // MAX_FILES_PER_SUBMISSION files -- the server rejects it.
  async function submitBatch(fileList: File[]) {
    // Pre-compute each file's queue ID client-side (same hash the server
    // uses) so the live section below can track this exact batch from the
    // moment upload starts, rather than only after the request resolves.
    // Merged onto (not replacing) the existing maps so a multi-batch queue
    // run accumulates one combined progress view across all its batches.
    const batch = new Map<string, string>();
    const fileMap = new Map<string, File>();
    await Promise.all(fileList.map(async (file) => {
      const queueId = await fileQueueId(roleId, file);
      batch.set(queueId, file.name);
      fileMap.set(queueId, file);
    }));
    batchFiles.current = new Map([...batchFiles.current, ...fileMap]);
    setActiveBatch((current) => new Map([...current, ...batch]));

    const formData = new FormData();
    formData.set("roleId", roleId);
    fileList.forEach((file) => formData.append("resumes", file));
    const response = await fetch("/api/resume-screening/bulk/upload", { method: "POST", body: formData });
    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("Retry-After")) || 30;
      return { ok: false as const, retryable: true as const, retryAfterSeconds, error: "Too many bulk uploads. Waiting before retrying this batch." };
    }
    const result = await response.json().catch(() => ({}) as Record<string, unknown>);
    if (!response.ok || result.success !== true) {
      return { ok: false as const, retryable: false as const, error: String(result.error || "Unable to submit the bulk resumes.") };
    }
    const failedFileSet = applyBatchResult(result, fileMap);
    return { ok: true as const, failedFileSet };
  }

  async function uploadResumes(fileList: File[]) {
    if (!roleId || fileList.length === 0 || uploading || queueRunning) return;
    setUploading(true);
    setError("");
    setWarning("");
    setUploadMessage("");
    batchFiles.current = new Map();
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());
    try {
      const outcome = await submitBatch(fileList);
      if (!outcome.ok) throw new Error(outcome.error);
      setFiles((current) => current.filter((file) => !fileList.includes(file) || outcome.failedFileSet.has(file)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit the bulk resumes.");
    } finally {
      setUploading(false);
    }
  }

  // "Let it sit" flow for a backlog bigger than one request can take. Splits
  // the selection into MAX_FILES_PER_SUBMISSION-sized batches and fires them
  // one at a time -- never in parallel, so concurrent Google Drive API calls
  // (storeResumeFile does 3 per file: folder check, dedupe search, upload)
  // and Postgres writes stay at the same level already tested for a single
  // batch. A short pause between batches adds extra margin against bursting
  // those Drive calls. The user must keep this tab open: the queue lives in
  // this component's state, not on the server, so closing the tab stops it
  // (already-submitted batches keep processing; the rest stay in the file
  // list to resume from).
  const BATCH_GAP_MS = 3_000;

  async function runBulkQueue(allFiles: File[]) {
    if (!roleId || allFiles.length === 0 || uploading || queueRunning) return;
    setQueueRunning(true);
    queueCancelRef.current = false;
    setError("");
    setWarning("");
    setUploadMessage("");
    batchFiles.current = new Map();
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());

    const chunks: File[][] = [];
    for (let index = 0; index < allFiles.length; index += MAX_FILES_PER_SUBMISSION) chunks.push(allFiles.slice(index, index + MAX_FILES_PER_SUBMISSION));
    setQueueProgress({ done: 0, total: chunks.length });

    for (let i = 0; i < chunks.length; i++) {
      if (queueCancelRef.current) { setUploadMessage(`Stopped after batch ${i} of ${chunks.length}. Remaining files stay selected below.`); break; }
      const chunk = chunks[i];
      setUploadMessage(`Submitting batch ${i + 1} of ${chunks.length} (${chunk.length} resumes) — keep this tab open until the queue finishes.`);
      let outcome = await submitBatch(chunk);
      if (!outcome.ok && outcome.retryable) {
        const retryAfterSeconds = outcome.retryAfterSeconds;
        setUploadMessage(`Batch ${i + 1} of ${chunks.length} was rate limited; waiting ${retryAfterSeconds}s before retrying it.`);
        await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
        outcome = await submitBatch(chunk);
      }
      if (!outcome.ok) {
        setError(`Bulk queue stopped after batch ${i} of ${chunks.length}: ${outcome.error} Remaining files stay selected below — fix the issue and click Start screening again.`);
        break;
      }
      setFiles((current) => current.filter((file) => !chunk.includes(file) || outcome.failedFileSet.has(file)));
      setQueueProgress({ done: i + 1, total: chunks.length });
      if (i < chunks.length - 1 && !queueCancelRef.current) await new Promise((resolve) => setTimeout(resolve, BATCH_GAP_MS));
    }
    setQueueRunning(false);
  }

  type BatchResult = { fileName?: string; queueId?: string; status?: string; skipped?: boolean; message?: string };

  // Shared post-response handling for both the local upload and the Google
  // Drive import — same live-batch tracking, summary, status refresh, and
  // credit-meter update.
  function applyBatchResult(result: Record<string, unknown>, fileMap: Map<string, File>): Set<File> {
    const results = (Array.isArray(result.results) ? result.results : []) as BatchResult[];
    // The upload path pre-seeds activeBatch from client-side hashes; the Drive
    // path has no local bytes, so seed it from the server's per-file results.
    // Merged onto (not replacing) the existing map so a multi-batch queue run
    // accumulates one combined progress view across all its batches.
    if (results.length > 0) {
      setActiveBatch((current) => {
        const next = new Map(current);
        for (const item of results) if (item.queueId && !next.has(item.queueId)) next.set(item.queueId, item.fileName || "Resume");
        return next;
      });
    }
    setBatchResultStatuses((current) => {
      const next = new Map(current);
      for (const item of results) if (item.queueId) next.set(item.queueId, String(item.status || "Queued"));
      return next;
    });
    const submitted = Number(result.submitted || 0);
    const notificationStatus = String(result.notificationStatus || "not_requested");
    const skippedResults = results.filter((item) => item.skipped);
    const alreadyScreened = skippedResults.filter((item) => item.status?.toLowerCase() === "screened").length;
    const alreadyActive = skippedResults.length - alreadyScreened;
    const failed = results.filter((item) => String(item.status || "").toLowerCase() === "failed");
    const failedFileSet = new Set([...new Set(failed.map((item) => item.queueId).filter(Boolean))].map((queueId) => fileMap.get(queueId as string)).filter((file): file is File => Boolean(file)));
    const uploadSummary = submitted ? `${submitted} resume${submitted === 1 ? "" : "s"} submitted for processing` : "No new resumes were submitted";
    const notificationSummary = notificationStatus === "sent"
      ? " Internal completion email sent to HR and management."
      : notificationStatus === "disabled"
        ? " Success email notifications are currently disabled for bulk processing."
        : notificationStatus === "failed"
          ? " The internal completion email failed; resume processing is unaffected."
          : " No internal completion email was requested.";
    setUploadMessage(`${uploadSummary}${failed.length ? `; ${failed.length} failed` : ""}${alreadyScreened ? `; ${alreadyScreened} already screened and skipped` : ""}${alreadyActive ? `; ${alreadyActive} already queued or processing` : ""}.${notificationSummary}`);
    void refreshStatus();
    const creditsCharged = Number(result.creditsCharged);
    requestEllaCreditsRefresh(Number.isFinite(creditsCharged) && creditsCharged > 0 ? -creditsCharged : undefined);
    return failedFileSet;
  }

  async function importFromCloud(provider: "google" | "microsoft", selections: CloudImportSelection[]) {
    if (driveImporting) return;
    const label = provider === "microsoft" ? "OneDrive" : "Google Drive";
    const request = buildCloudImportRequest(provider, roleId, selections);
    if (!request) {
      setError(`Select a published role and at least one file from ${label}.`);
      return;
    }
    setDriveImporting(true);
    setError("");
    setWarning("");
    setUploadMessage("");
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());
    batchFiles.current = new Map();
    try {
      console.info("[Cloud Import] request", { roleId, files: selections.map(({ id, name }) => ({ id, name })), fileIds: JSON.parse(request.init.body).fileIds });
      const response = await fetch(request.endpoint, request.init);
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error || `Unable to import from ${label}.`);
      applyBatchResult(result, new Map());
      setCloudPicker(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to import from ${label}.`);
    } finally {
      setCloudPicker(null);
      setDriveImporting(false);
    }
  }

  const batchTotal = activeBatch.size;
  const batchTerminal = useMemo(() => {
    if (batchTotal === 0) return { completed: 0, failed: 0, processing: 0, queued: 0, skipped: 0 };
    let completed = 0, failed = 0, processing = 0, queued = 0, skipped = 0;
    for (const queueId of activeBatch.keys()) {
      const item = items.find((entry) => queueIdentity(entry) === queueId);
      const reportedStatus = batchResultStatuses.get(queueId)?.toLowerCase() || "";
      const status = (item?.status || (["failed", "skipped"].includes(reportedStatus) ? reportedStatus : "Queued")).toLowerCase();
      if (status === "screened" || status === "processed") completed += 1;
      else if (status === "skipped") skipped += 1;
      else if (status === "failed") failed += 1;
      else if (status === "processing") processing += 1;
      else queued += 1;
    }
    return { completed, failed, processing, queued, skipped };
  }, [activeBatch, batchResultStatuses, items, batchTotal]);
  const batchProcessed = batchTerminal.completed + batchTerminal.failed + batchTerminal.skipped;
  const batchPercent = batchTotal > 0 ? Math.round((batchProcessed / batchTotal) * 100) : 0;
  // While a multi-batch queue run is in flight, batchTotal only reflects the
  // batches submitted so far, so it can look "finished" between batches
  // before later ones are even sent. Gate on queueRunning too.
  const batchFinished = !queueRunning && batchTotal > 0 && batchTerminal.queued === 0 && batchTerminal.processing === 0;
  const failedFiles = useMemo(() => {
    const failedIds = [...activeBatch.keys()].filter((queueId) => {
      const item = items.find((entry) => queueIdentity(entry) === queueId);
      return (item?.status || batchResultStatuses.get(queueId) || "").toLowerCase() === "failed";
    });
    return failedIds.map((queueId) => batchFiles.current.get(queueId)).filter((file): file is File => Boolean(file));
  }, [activeBatch, batchResultStatuses, items]);
  const visibleCounts = useMemo(() => {
    const normalized: Record<string, number> = {};
    for (const [rawStatus, count] of Object.entries(counts)) {
      const label = displayStatus(rawStatus).label;
      normalized[label] = (normalized[label] || 0) + count;
    }
    return normalized;
  }, [counts]);

  return (
    <section className="bulk-screening-panel" aria-labelledby="bulk-screening-title">
      <div className="bulk-screening-header">
        <div>
          <span className="form-eyebrow">BULK RESUME SCREENING</span>
          <h2 id="bulk-screening-title">Bulk upload resumes</h2>
          <p>Select a published role and upload multiple PDF, DOC, or DOCX resumes directly from this page. Smile processes each file once and records its screening status here.</p>
        </div>
        <span className="bulk-screening-badge">One-time screening</span>
      </div>

      <div className="bulk-screening-body">
        <div className="bulk-screening-controls">
          <label className="field">
            <span>Published role *</span>
            <select value={roleId} onChange={(event) => selectRole(event.target.value)}>
              <option value="">Select a published role</option>
              {roleOptions.map((role) => <option key={role.roleId} value={role.roleId}>{role.label}</option>)}
            </select>
          </label>
          <div className="bulk-screening-action">
            {driveStatus?.connected
              ? <button type="button" className="btn btn-secondary btn-with-icon" disabled={!roleId || uploading || driveImporting} onClick={() => setCloudPicker("google")}><GoogleDriveIcon />Choose from Google Drive</button>
              : <a className="btn btn-secondary btn-with-icon" href="/api/auth/google-drive/connect"><GoogleDriveIcon />Connect Google Drive</a>}
            {driveStatus?.connected && (
              <button
                type="button"
                className="bulk-screening-link-button"
                onClick={async () => {
                  await fetch("/api/auth/google-drive/disconnect", { method: "POST" });
                  setDriveStatus({ connected: false, accountEmail: "" });
                }}
              >
                Disconnect {driveStatus.accountEmail}
              </button>
            )}
            {msDriveStatus?.configured && (msDriveStatus.connected
              ? <button type="button" className="btn btn-secondary" disabled={!roleId || uploading || driveImporting} onClick={() => setCloudPicker("microsoft")}>Choose from OneDrive</button>
              : <a className="btn btn-secondary" href="/api/auth/microsoft-drive/connect">Connect OneDrive</a>)}
            {msDriveStatus?.configured && msDriveStatus.connected && (
              <button
                type="button"
                className="bulk-screening-link-button"
                onClick={async () => {
                  await fetch("/api/auth/microsoft-drive/disconnect", { method: "POST" });
                  setMsDriveStatus({ configured: true, connected: false, accountEmail: "" });
                }}
              >
                Disconnect {msDriveStatus.accountEmail}
              </button>
            )}
          </div>
        </div>

        <label
          className={`bulk-screening-dropzone${dragActive ? " is-active" : ""}${!roleId ? " is-disabled" : ""}`}
          onDragOver={(event) => { event.preventDefault(); if (roleId) setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (roleId && !uploading && !queueRunning && event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
          }}
        >
          {/* Match the browser picker with the server PDF/DOC/DOCX allowlist. */}
          <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple disabled={!roleId || uploading || queueRunning} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          <div className="bulk-screening-dropzone-copy">
            <strong>Drag and drop resumes here, or click to choose files</strong>
            <span>Up to {MAX_CAMPAIGN_FILES} PDF, DOC, or DOCX files at once, 10 MB each — selections over {MAX_FILES_PER_SUBMISSION} are queued and processed automatically in batches. {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"} selected.` : "No files selected yet."}</span>
          </div>
        </label>

        {files.length > 0 && (
          <div className="bulk-screening-file-list">
            {files.map((file) => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="bulk-screening-file-chip">
                {file.name}
                <button type="button" aria-label={`Remove ${file.name}`} disabled={uploading || queueRunning} onClick={() => removeFile(file)}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="bulk-screening-upload-box">
          <div className="bulk-screening-count">
            <span>{files.length} file{files.length === 1 ? "" : "s"} ready to submit</span>
            <EllaCreditsMeter variant="inline" />
            <span className="bulk-screening-count-hint">Current CV screening cost is shown on the Credits page.</span>
          </div>
          {queueRunning ? (
            <button type="button" className="btn btn-secondary" onClick={() => { queueCancelRef.current = true; }}>Stop after current batch</button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!roleId || files.length === 0 || uploading}
              onClick={() => void (files.length > MAX_FILES_PER_SUBMISSION ? runBulkQueue(files) : uploadResumes(files))}
            >
              {uploading ? "Uploading and screening..." : `Start screening${files.length ? ` (${files.length})` : ""}`}
            </button>
          )}
        </div>

        {queueProgress && (queueRunning || queueProgress.done < queueProgress.total) && (
          <ActionFeedback kind="success" className="bulk-screening-action-feedback">
            Batch {Math.min(queueProgress.done + (queueRunning ? 1 : 0), queueProgress.total)} of {queueProgress.total} — keep this tab open; the rest will queue on their own.
          </ActionFeedback>
        )}
        {uploadMessage && <ActionFeedback kind="success" className="bulk-screening-action-feedback">{uploadMessage}</ActionFeedback>}
        {warning && <ActionFeedback kind="warning" className="bulk-screening-action-feedback">{warning}</ActionFeedback>}
        {failedFiles.length > 0 && !uploading && !queueRunning && !batchFinished && (
          <div className="warning-box bulk-screening-retry-box">
            <span>{failedFiles.length} resume{failedFiles.length === 1 ? "" : "s"} failed to process.</span>
            <button type="button" className="btn btn-secondary" onClick={() => void uploadResumes(failedFiles)}>Retry failed ({failedFiles.length})</button>
          </div>
        )}

        <div className="bulk-screening-instructions">
          <strong>{selectedRole ? `Upload resumes for ${selectedRole.label}` : "How bulk screening works"}</strong>
          <ol>
            <li>Choose a published role.</li>
            <li>Drag in (or select) multiple PDF, DOC, or DOCX files and start screening.</li>
            <li>Up to {MAX_FILES_PER_SUBMISSION} files submit immediately; a larger selection queues automatically in batches of {MAX_FILES_PER_SUBMISSION} a few seconds apart — leave the tab open and it runs unattended.</li>
            <li>Smile extracts the candidate details, submits each resume to the screening workflow, and updates the queue below in real time.</li>
            <li>Files marked Completed are identified by role and file hash and are never analyzed again for that role. Failed files can be retried without re-uploading the whole batch.</li>
          </ol>
        </div>

        {batchTotal > 0 && (
          <div className="bulk-screening-progress" aria-live="polite">
            <div className="bulk-screening-progress-header"><strong>Bulk Resume Processing</strong><span>{batchProcessed} / {batchTotal} resumes processed</span></div>
            <div className="bulk-screening-progress-track"><div className="bulk-screening-progress-fill" style={{ width: `${batchPercent}%` }} /></div>
            <div className="bulk-screening-progress-legend">
              <span>{batchPercent}% complete</span>
              <span>{batchTerminal.queued} queued</span>
              <span>{batchTerminal.processing} processing</span>
              <span>{batchTerminal.completed} completed</span>
              <span>{batchTerminal.failed} failed</span>
              {batchTerminal.skipped > 0 && <span>{batchTerminal.skipped} skipped</span>}
            </div>
          </div>
        )}

        {batchFinished && !uploading && (
          <div className="success-box bulk-screening-finished" aria-live="polite">
            <div>
              <strong>Bulk screening completed</strong>
              <span>{batchTerminal.completed} successfully processed{batchTerminal.failed ? ` · ${batchTerminal.failed} failed` : ""}{batchTerminal.skipped ? ` · ${batchTerminal.skipped} skipped` : ""}</span>
            </div>
            <div className="bulk-screening-finished-actions">
              <a className="btn btn-primary" href="/applicants">View Processed Applicants</a>
              {failedFiles.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => void uploadResumes(failedFiles)}>Retry {failedFiles.length} Failed</button>}
            </div>
          </div>
        )}

        <div className="bulk-screening-status-header">
          <div><strong>Role Total</strong><small>{roleId ? `All saved screening records for ${roleId}${anyPending ? " · latest status updates automatically every minute" : ""}` : "Select a role to view its records"}</small></div>
          <button type="button" className="btn btn-secondary" onClick={() => void refreshStatus()} disabled={loading}>{loading ? "Refreshing..." : "Refresh status"}</button>
        </div>

        {!configured && <div className="warning-box">{error || "Create the Bulk_Resume_Queue tab to view processing status."}</div>}
        {configured && error && <ActionFeedback kind="error" className="bulk-screening-action-feedback">{error}</ActionFeedback>}

        <div className="bulk-screening-counts">
          {statusOrder.map((status) => <div key={status} className="bulk-count-card"><span>{status}</span><strong>{visibleCounts[status] || 0}</strong></div>)}
        </div>

        {roleId && items.length > 0 ? (
          <div className="bulk-screening-table-wrap">
            <table className="bulk-screening-table">
              <thead><tr><th>Resume</th><th>Candidate</th><th>Status</th><th>Result</th><th>Updated</th></tr></thead>
              <tbody>
                {items.map((item) => {
                  const { label, result } = displayStatus(item.status || "Queued");
                  return <tr key={item.driveFileId}>
                    <td>{item.driveFileUrl ? <a href={item.driveFileUrl} target="_blank" rel="noreferrer">{item.driveFileName || item.driveFileId}</a> : item.driveFileName || item.driveFileId}</td>
                    <td>{item.candidateName || item.candidateEmail || "Pending extraction"}</td>
                    <td><span className={statusClass(label)}>{label}</span></td>
                    <td>{item.errorMessage || result}</td>
                    <td>{(() => { const ts = item.lastUpdated || item.processedAt || item.discoveredAt; return ts ? formatPortalDateTime(ts) : "—"; })()}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="bulk-screening-empty">{roleId ? "No bulk resumes have been detected for this role yet." : "Choose a published role to see its bulk screening status."}</p>}
      </div>

      <DriveFilePicker
        open={cloudPicker === "google" && Boolean(roleId)}
        importing={driveImporting}
        maxSelection={MAX_FILES_PER_SUBMISSION}
        initialFolderId={driveRootFolderId || "root"}
        onClose={() => setCloudPicker(null)}
        onImport={(selections) => void importFromCloud("google", selections)}
      />
      <DriveFilePicker
        open={cloudPicker === "microsoft" && Boolean(roleId)}
        importing={driveImporting}
        maxSelection={MAX_FILES_PER_SUBMISSION}
        listUrl="/api/resume-screening/onedrive/list"
        pageParam="pageUrl"
        providerLabel="OneDrive"
        rootName="OneDrive"
        onClose={() => setCloudPicker(null)}
        onImport={(selections) => void importFromCloud("microsoft", selections)}
      />
    </section>
  );
}
