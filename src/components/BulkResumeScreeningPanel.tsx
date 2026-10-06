"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import DriveFilePicker from "@/components/DriveFilePicker";
import EllaCreditsMeter from "@/components/EllaCreditsMeter";
import GoogleDriveIcon from "@/components/GoogleDriveIcon";
import GoogleDriveResumePicker from "@/components/GoogleDriveResumePicker";
import Pagination from "@/components/Pagination";
import StatusBadge from "@/components/ui/StatusBadge";
import { requestEllaCreditsRefresh } from "@/lib/ella-credits-events";
import { buildCloudImportRequest, selectedCloudFiles, type CloudImportSelection } from "@/lib/cloud-import-request";
import { formatPortalDateTime } from "@/lib/portal-time";
import { MAX_CAMPAIGN_FILES, MAX_FILES_PER_SUBMISSION, MAX_RESUME_FILE_BYTES } from "@/lib/bulk-resume-limits";
import { clientErrorMessage } from "@/lib/client-error";
import InterviewAutomationNotice from "@/components/InterviewAutomationNotice";

type RoleOption = { roleId: string; label: string };
type QueueItem = {
  dedupeKey: string;
  submissionId?: string;
  driveFileId: string;
  driveFileName: string;
  driveFileUrl: string;
  roleId: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  source?: string;
  applicationId: string;
  errorMessage: string;
  discoveredAt: string;
  processingStartedAt: string;
  processedAt: string;
  attemptCount: string;
  lastUpdated: string;
  jobId: string;
};

const statusOrder = ["Queued", "Processing", "Screened", "Failed", "Skipped", "Other"];
// The status endpoint performs fresh queue and screening-evidence reads. Keep
// feedback responsive for a newly submitted batch, then back off when the
// queue is unchanged so a stuck historical row cannot create endless load.
const POLL_INTERVALS_MS = [30_000, 60_000, 120_000] as const;
// MAX_FILES_PER_SUBMISSION imported from @/lib/bulk-resume-limits above — a
// dependency-free module client code can safely import (bulk-resume-intake.ts
// itself is server-only). The server also enforces this cap — see bulk/upload
// and drive/import.
const TERMINAL_STATUSES = new Set(["screened", "processed", "failed", "skipped"]);

// The retry endpoint matches the database dedupe key. Older rows may not have
// that field in the UI payload, so retain the historical job/file fallbacks.
function queueIdentity(item: Pick<QueueItem, "dedupeKey" | "jobId" | "driveFileId">) {
  return item.dedupeKey || item.jobId || item.driveFileId;
}

// Human-facing label + result text for the live table, matching the coarse
// Queued / Uploading / Processing / Completed / Failed states HR cares
// about, distinct from the raw sheet status string used for logic.
function displayStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "screened" || normalized === "processed" || normalized === "completed") return { label: "Screened", result: "Screening completed" };
  if (normalized === "processing") return { label: "Processing", result: "AI analysis running" };
  if (normalized === "failed") return { label: "Failed", result: "Retry" };
  if (normalized === "skipped") return { label: "Skipped", result: "Already screened or waiting to be screened" };
  if (normalized === "queued" || !normalized) return { label: "Queued", result: "Waiting" };
  return { label: "Other", result: "Status needs review" };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function LoadingLabel({ children }: { children: string }) {
  return <><span className="bulk-screening-spinner" aria-hidden="true" />{children}</>;
}

async function fileQueueId(roleId: string, file: File, submissionId: string) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const roleKey = roleId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
  return `BULK-${roleKey}-${sha256}-${submissionId.replace(/[^A-Z0-9_-]/gi, "-")}`;
}

export default function BulkResumeScreeningPanel({ roleOptions }: { roleOptions: RoleOption[] }) {
  const [roleId, setRoleId] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatus, setQueueStatus] = useState("All statuses");
  // Dashboard alerts link here with ?status=Failed.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("status") || "";
    if (statusOrder.includes(requested)) setQueueStatus(requested);
  }, []);
  const [queueSource, setQueueSource] = useState("All sources");
  const [queuePage, setQueuePage] = useState(1);
  const [queuePageSize, setQueuePageSize] = useState(10);
  const [queueTotal, setQueueTotal] = useState(0);
  const [lastUpdated, setLastUpdated] = useState("");
  const [retrySupported, setRetrySupported] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<"preparing" | "uploading">("preparing");
  const [uploadMessage, setUploadMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  // Tracks the resumes submitted in the batch currently in flight, keyed by
  // the same content-hash queue ID the server computes, so the live section
  // below can show real-time progress for exactly this upload rather than
  // the role's entire screening history.
  const [activeBatch, setActiveBatch] = useState<Map<string, string>>(new Map());
  const [batchResultStatuses, setBatchResultStatuses] = useState<Map<string, string>>(new Map());
  const [activeSubmissionId, setActiveSubmissionId] = useState("");
  const [submissionItems, setSubmissionItems] = useState<QueueItem[]>([]);
  // "Let it sit" queue state for a selection bigger than one request can take
  // — see runBulkQueue below.
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueProgress, setQueueProgress] = useState<{ done: number; total: number } | null>(null);
  const queueCancelRef = useRef(false);
  const [driveStatus, setDriveStatus] = useState<{ connected: boolean; accountEmail: string } | null>(null);
  const [msDriveStatus, setMsDriveStatus] = useState<{ configured: boolean; connected: boolean; accountEmail: string } | null>(null);
  const [cloudPicker, setCloudPicker] = useState<"google" | "microsoft" | null>(null);
  const [driveImporting, setDriveImporting] = useState(false);
  const [retryingSavedFailures, setRetryingSavedFailures] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const batchFiles = useRef<Map<string, File>>(new Map());
  const refreshInFlight = useRef(false);
  const refreshAbort = useRef<AbortController | null>(null);
  const statusRequestId = useRef(0);
  const pollDelayIndex = useRef(0);
  const statusSignature = useRef("");

  const selectedRole = useMemo(() => roleOptions.find((role) => role.roleId === roleId), [roleId, roleOptions]);

  const refreshStatus = useCallback(async (): Promise<boolean> => {
    if (!roleId || refreshInFlight.current) return false;
    refreshInFlight.current = true;
    const requestId = ++statusRequestId.current;
    const controller = new AbortController();
    refreshAbort.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({ roleId, page: String(queuePage), pageSize: String(queuePageSize), status: queueStatus, source: queueSource });
      if (queueSearch.trim()) params.set("search", queueSearch.trim());
      if (activeSubmissionId) params.set("submissionId", activeSubmissionId);
      const response = await fetch(`/api/resume-screening/bulk?${params}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to load bulk screening status.");
      // Ignore a response that belongs to an older role/request. This keeps a
      // slow poll from overwriting a newer queue snapshot.
      if (requestId !== statusRequestId.current) return false;
      const nextItems = (Array.isArray(result.items) ? result.items : []) as QueueItem[];
      const nextSubmissionItems = (Array.isArray(result.submissionItems) ? result.submissionItems : []) as QueueItem[];
      const nextCounts = (result.counts || result.roleTotals || {}) as Record<string, number>;
      const nextSignature = JSON.stringify({
        counts: Object.entries(nextCounts).sort(([left], [right]) => left.localeCompare(right)),
        items: nextItems.map((item) => [queueIdentity(item), item.status, item.lastUpdated, item.errorMessage]),
        submissionItems: nextSubmissionItems.map((item) => [queueIdentity(item), item.status, item.lastUpdated, item.errorMessage]),
      });
      const changed = Boolean(statusSignature.current) && statusSignature.current !== nextSignature;
      statusSignature.current = nextSignature;
      setItems(nextItems);
      setSubmissionItems(nextSubmissionItems);
      setQueueTotal(Number(result.total) || 0);
      setRetrySupported(result.retrySupported === true);
      // Use the reconciled latest-state counts. Historical retry-event totals
      // are useful for diagnostics but must not make this summary disagree
      // with the live batch bar above it.
      setCounts(nextCounts);
      setConfigured(result.configured !== false);
      setLastUpdated(typeof result.updatedAt === "string" ? result.updatedAt : new Date().toISOString());
      if (result.error) setError(result.error);
      return changed;
    } catch (caught) {
      if (requestId === statusRequestId.current && !(caught instanceof DOMException && caught.name === "AbortError")) setError(clientErrorMessage(caught, "Unable to load bulk screening status."));
      return false;
    } finally {
      if (refreshAbort.current === controller) {
        refreshAbort.current = null;
        refreshInFlight.current = false;
        if (requestId === statusRequestId.current) setLoading(false);
      }
    }
  }, [activeSubmissionId, queuePage, queuePageSize, queueSearch, queueSource, queueStatus, roleId]);

  function selectRole(nextRoleId: string) {
    if (queueRunning) return;
    setCloudPicker(null);
    refreshAbort.current?.abort();
    refreshAbort.current = null;
    refreshInFlight.current = false;
    statusRequestId.current += 1;
    pollDelayIndex.current = 0;
    statusSignature.current = "";
    setRoleId(nextRoleId);
    setItems([]);
    setCounts({});
    setQueueTotal(0);
    setRetrySupported(false);
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());
    setActiveSubmissionId("");
    setSubmissionItems([]);
    setQueueProgress(null);
    batchFiles.current.clear();
    setFiles([]);
    setUploadMessage("");
    setWarning("");
    setError("");
  }

  useEffect(() => {
    pollDelayIndex.current = 0;
    statusSignature.current = "";
  }, [roleId]);

  useEffect(() => {
    if (!roleId) return;
    const timer = window.setTimeout(() => void refreshStatus(), queueSearch.trim() ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      statusRequestId.current += 1;
      refreshAbort.current?.abort();
      refreshAbort.current = null;
      refreshInFlight.current = false;
    };
  }, [queuePage, queuePageSize, queueSearch, queueSource, queueStatus, refreshStatus, roleId]);

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


  // Poll automatically only for a batch submitted in this tab. Historical
  // pending rows can be refreshed manually, but must not keep this page
  // polling forever after a worker or data issue has already gone stale.
  const pendingInBatch = useMemo(() => {
    if (activeBatch.size === 0) return false;
    return Array.from(activeBatch.keys()).some((queueId) => {
      const item = submissionItems.find((entry) => queueIdentity(entry) === queueId) || items.find((entry) => queueIdentity(entry) === queueId);
      const reportedStatus = batchResultStatuses.get(queueId)?.toLowerCase() || "";
      // A successful response without a queue row is still only an accepted
      // handoff. Local validation/request failures may terminate immediately,
      // but successful completion must come from the queue-backed status API.
      const status = item?.status || (["failed", "skipped"].includes(reportedStatus) ? reportedStatus : "Queued");
      return !TERMINAL_STATUSES.has(status.toLowerCase());
    });
  }, [activeBatch, batchResultStatuses, items, submissionItems]);
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
    if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
    if (!roleId || !pendingInBatch) return;
    let cancelled = false;
    const schedulePoll = () => {
      if (cancelled) return;
      const delay = POLL_INTERVALS_MS[pollDelayIndex.current];
      pollTimer.current = setTimeout(async () => {
        if (cancelled) return;
        if (typeof document === "undefined" || document.visibilityState !== "visible") {
          pollDelayIndex.current = Math.min(pollDelayIndex.current + 1, POLL_INTERVALS_MS.length - 1);
          schedulePoll();
          return;
        }
        const changed = await refreshStatus();
        if (cancelled) return;
        pollDelayIndex.current = changed
          ? 0
          : Math.min(pollDelayIndex.current + 1, POLL_INTERVALS_MS.length - 1);
        schedulePoll();
      }, delay);
    };
    schedulePoll();
    // Catch up immediately when the user returns to a tab with a batch running.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        pollDelayIndex.current = 0;
        void refreshStatus();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null; }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [roleId, pendingInBatch, refreshStatus]);

  function addFiles(nextFiles: FileList | File[]) {
    const candidates = Array.from(nextFiles);
    const unsupported = candidates.filter((file) => !/\.(pdf|docx?)$/i.test(file.name)).length;
    const empty = candidates.filter((file) => file.size === 0).length;
    const oversized = candidates.filter((file) => file.size > MAX_RESUME_FILE_BYTES).length;
    const valid = candidates.filter((file) => /\.(pdf|docx?)$/i.test(file.name) && file.size > 0 && file.size <= MAX_RESUME_FILE_BYTES);
    const seen = new Set(files.map((file) => `${file.name.toLowerCase()}:${file.size}`));
    const incoming: File[] = [];
    let duplicates = 0;
    for (const file of valid) {
      const key = `${file.name.toLowerCase()}:${file.size}`;
      if (seen.has(key)) duplicates += 1;
      else { incoming.push(file); seen.add(key); }
    }
    const availableSlots = Math.max(0, MAX_CAMPAIGN_FILES - files.length);
    const limited = incoming.length > availableSlots;
    setFiles([...files, ...incoming.slice(0, availableSlots)]);
    const messages = [
      unsupported ? `${unsupported} file${unsupported === 1 ? "" : "s"} not added: use PDF, DOC, or DOCX.` : "",
      empty ? `${empty} empty file${empty === 1 ? "" : "s"} not added.` : "",
      oversized ? `${oversized} file${oversized === 1 ? "" : "s"} over 10 MB not added.` : "",
      duplicates ? `${duplicates} duplicate selection${duplicates === 1 ? "" : "s"} skipped.` : "",
      limited ? `You can add up to ${MAX_CAMPAIGN_FILES} resumes at a time. Extra files were not added.` : "",
    ].filter(Boolean);
    setError("");
    setWarning(messages.join(" "));
  }

  function removeFile(target: File) {
    setFiles((current) => current.filter((file) => file !== target));
  }

  // Fires exactly one MAX_FILES_PER_SUBMISSION-sized request and reports a
  // structured outcome instead of throwing, so runBulkQueue can decide
  // whether to back off-and-retry (rate limited) or stop the whole run (a
  // real failure, e.g. insufficient credits). Never call this with more than
  // MAX_FILES_PER_SUBMISSION files -- the server rejects it.
  async function submitBatch(fileList: File[], submissionId: string) {
    // Pre-compute each file's queue ID client-side (same hash the server
    // uses) so the live section below can track this exact batch from the
    // moment upload starts, rather than only after the request resolves.
    // Merged onto (not replacing) the existing maps so a multi-batch queue
    // run accumulates one combined progress view across all its batches.
    const fileEntries = await Promise.all(fileList.map(async (file) => [await fileQueueId(roleId, file, submissionId), file] as const));
    const batch = new Map(fileEntries.map(([queueId, file]) => [queueId, file.name]));
    const fileMap = new Map(fileEntries);
    batchFiles.current = new Map([...batchFiles.current, ...fileMap]);
    setActiveBatch((current) => new Map([...current, ...batch]));
    setUploadPhase("uploading");
    setUploadMessage(`Uploading ${fileList.length} resume${fileList.length === 1 ? "" : "s"}…`);

    const formData = new FormData();
    formData.set("roleId", roleId);
    formData.set("submissionId", submissionId);
    fileList.forEach((file) => formData.append("resumes", file));

    // A lost connection or a hard function timeout throws here (a plain
    // TypeError, no response at all) rather than resolving with a status.
    // Files this batch had already finished storing and queuing before the
    // connection died stay durably queued server-side (each file is written
    // to Postgres as it completes, not batched at the end) -- only the
    // confirmation was lost, not the work. Return a structured outcome that
    // says so instead of letting this throw and leave the caller (in
    // particular runBulkQueue's loop) with no message and a stuck spinner.
    const timeoutOutcome = { ok: false as const, retryable: false as const, error: "Lost connection or timed out partway through this batch. Any resumes that finished uploading are already being screened. Check the list below before submitting again; duplicates are detected automatically and skipped." };
    let response: Response;
    try {
      response = await fetch("/api/resume-screening/bulk/upload", { method: "POST", body: formData });
    } catch {
      return timeoutOutcome;
    }
    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("Retry-After")) || 30;
      return { ok: false as const, retryable: true as const, retryAfterSeconds, error: "Too many bulk uploads. Waiting before retrying this batch." };
    }
    const result = await response.json().catch(() => ({}) as Record<string, unknown>);
    if (!response.ok || result.success !== true) {
      // A 502/503/504 with no parsed `error` is the platform (not the app)
      // rejecting the request -- most likely the same lost-connection/timeout
      // case as the catch above, just surfaced as a response instead of a
      // throw. Same accurate message applies.
      if (!result.error && [502, 503, 504].includes(response.status)) return timeoutOutcome;
      return { ok: false as const, retryable: false as const, error: String(result.error || "Unable to submit the bulk resumes.") };
    }
    const failedFileSet = applyBatchResult(result, fileMap);
    return { ok: true as const, failedFileSet };
  }

  async function uploadResumes(fileList: File[]) {
    if (!roleId || fileList.length === 0 || uploading || queueRunning) return;
    setUploading(true);
    setUploadPhase("preparing");
    setError("");
    setWarning("");
    setUploadMessage("Preparing files for secure upload…");
    batchFiles.current = new Map();
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());
    const submissionId = crypto.randomUUID();
    setActiveSubmissionId(submissionId);
    setSubmissionItems([]);
    try {
      const outcome = await submitBatch(fileList, submissionId);
      if (!outcome.ok) throw new Error(outcome.error);
      setFiles((current) => current.filter((file) => !fileList.includes(file) || outcome.failedFileSet.has(file)));
    } catch (caught) {
      setError(clientErrorMessage(caught, "Unable to submit the bulk resumes."));
      setActiveBatch(new Map());
      setSubmissionItems([]);
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
    setUploadPhase("preparing");
    queueCancelRef.current = false;
    setError("");
    setWarning("");
    setUploadMessage("");
    batchFiles.current = new Map();
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());
    const submissionId = crypto.randomUUID();
    setActiveSubmissionId(submissionId);
    setSubmissionItems([]);

    const chunks: File[][] = [];
    for (let index = 0; index < allFiles.length; index += MAX_FILES_PER_SUBMISSION) chunks.push(allFiles.slice(index, index + MAX_FILES_PER_SUBMISSION));
    setQueueProgress({ done: 0, total: chunks.length });

    for (let i = 0; i < chunks.length; i++) {
      if (queueCancelRef.current) { setUploadMessage(`Stopped after batch ${i} of ${chunks.length}. Remaining files stay selected below.`); break; }
      const chunk = chunks[i];
      setUploadMessage(`Submitting batch ${i + 1} of ${chunks.length} (${chunk.length} resumes) — keep this tab open until the queue finishes.`);
      let outcome = await submitBatch(chunk, submissionId);
      if (!outcome.ok && outcome.retryable) {
        const retryAfterSeconds = outcome.retryAfterSeconds;
        setUploadMessage(`Batch ${i + 1} of ${chunks.length} was rate limited; waiting ${retryAfterSeconds}s before retrying it.`);
        await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
        outcome = await submitBatch(chunk, submissionId);
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

  function retryFailedFiles(failedFileList: File[]) {
    if (failedFileList.length > MAX_FILES_PER_SUBMISSION) {
      void runBulkQueue(failedFileList);
      return;
    }
    void uploadResumes(failedFileList);
  }

  async function retrySavedFailures(queueItems: QueueItem[]) {
    if (!roleId || queueItems.length === 0 || retryingSavedFailures || uploading || queueRunning) return;
    setRetryingSavedFailures(true);
    setError("");
    setWarning("");
    try {
      const queueIds = queueItems.map((item) => queueIdentity(item)).filter(Boolean);
      const response = await fetch("/api/resume-screening/bulk/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, queueIds }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to retry the failed resumes.");
      const returnedQueueIds = Array.isArray(result.queueIds) ? result.queueIds.filter((value: unknown): value is string => typeof value === "string" && value.length > 0) : [];
      if (returnedQueueIds.length === 0) throw new Error("No failed resumes could be retried. Refresh the status and try again.");
      const retriedIds = new Set<string>(returnedQueueIds);
      const retriedBatch = new Map(queueItems.filter((item) => retriedIds.has(queueIdentity(item))).map((item) => [queueIdentity(item), item.driveFileName || "Resume"]));
      setActiveBatch(retriedBatch);
      setBatchResultStatuses(new Map([...retriedBatch.keys()].map((queueId) => [queueId, "Queued"])));
      batchFiles.current = new Map([...batchFiles.current].filter(([queueId]) => retriedIds.has(queueId)));
      setQueueProgress(null);
      setUploadMessage(`${retriedBatch.size} failed resume${retriedBatch.size === 1 ? "" : "s"} queued for retry. Screening will resume when credits are available.`);
      await refreshStatus();
    } catch (caught) {
      setError(clientErrorMessage(caught, "Unable to retry the failed resumes."));
    } finally {
      setRetryingSavedFailures(false);
    }
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
        const submittedKeys = [...fileMap.keys()];
        for (const [index, item] of results.entries()) {
          const predictedId = submittedKeys[index];
          if (item.queueId && predictedId && item.queueId !== predictedId) next.delete(predictedId);
          if (item.queueId) next.set(item.queueId, item.fileName || (predictedId ? fileMap.get(predictedId)?.name : "") || "Resume");
          else if (predictedId && String(item.status || "").toLowerCase() === "failed") next.set(predictedId, fileMap.get(predictedId)?.name || "Resume");
        }
        return next;
      });
    }
    setBatchResultStatuses((current) => {
      const next = new Map(current);
      const submittedKeys = [...fileMap.keys()];
      for (const [index, item] of results.entries()) {
        const predictedId = submittedKeys[index];
        if (item.queueId && predictedId && item.queueId !== predictedId) next.delete(predictedId);
        const key = item.queueId || (String(item.status || "").toLowerCase() === "failed" ? predictedId : undefined);
        if (key) next.set(key, String(item.status || "Queued"));
      }
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
    const normalizedSelections = selectedCloudFiles(selections);
    if (!roleId || normalizedSelections.length === 0) {
      setError(`Select a published role and at least one file from ${label}.`);
      return;
    }
    setDriveImporting(true);
    setError("");
    setWarning("");
    setUploadMessage("");
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());
    const submissionId = crypto.randomUUID();
    setActiveSubmissionId(submissionId);
    setSubmissionItems([]);
    batchFiles.current = new Map();
    try {
      const chunks: CloudImportSelection[][] = [];
      for (let index = 0; index < normalizedSelections.length; index += MAX_FILES_PER_SUBMISSION) {
        chunks.push(normalizedSelections.slice(index, index + MAX_FILES_PER_SUBMISSION));
      }
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        setUploadMessage(`Submitting ${label} batch ${index + 1} of ${chunks.length} (${chunk.length} resumes) — keep this tab open until the queue finishes.`);
        const request = buildCloudImportRequest(provider, roleId, chunk, submissionId);
        if (!request) throw new Error(`Unable to prepare the ${label} batch.`);
        console.info("[Cloud Import] request", { roleId, files: chunk.map(({ id, name }) => ({ id, name })), fileIds: JSON.parse(request.init.body).fileIds });
        let response = await fetch(request.endpoint, request.init);
        if (response.status === 429) {
          const retryAfterSeconds = Number(response.headers.get("Retry-After")) || 30;
          setUploadMessage(`${label} batch ${index + 1} was rate limited; waiting ${retryAfterSeconds}s before retrying it.`);
          await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
          response = await fetch(request.endpoint, request.init);
        }
        const result = await response.json();
        if (!response.ok || result.success !== true) throw new Error(result.error || `Unable to import from ${label}.`);
        applyBatchResult(result, new Map());
        if (index < chunks.length - 1) await new Promise((resolve) => setTimeout(resolve, BATCH_GAP_MS));
      }
      setCloudPicker(null);
    } catch (caught) {
      setError(clientErrorMessage(caught, `Unable to import from ${label}.`));
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
      const item = submissionItems.find((entry) => queueIdentity(entry) === queueId) || items.find((entry) => queueIdentity(entry) === queueId);
      const reportedStatus = batchResultStatuses.get(queueId)?.toLowerCase() || "";
      const status = (item?.status || (["failed", "skipped"].includes(reportedStatus) ? reportedStatus : "Queued")).toLowerCase();
      if (status === "screened" || status === "processed") completed += 1;
      else if (status === "skipped") skipped += 1;
      else if (status === "failed") failed += 1;
      else if (status === "processing") processing += 1;
      else queued += 1;
    }
    return { completed, failed, processing, queued, skipped };
  }, [activeBatch, batchResultStatuses, items, submissionItems, batchTotal]);
  const batchProcessed = batchTerminal.completed + batchTerminal.failed + batchTerminal.skipped;
  const batchPercent = batchTotal > 0 ? Math.round((batchProcessed / batchTotal) * 100) : 0;
  // While a multi-batch queue run is in flight, batchTotal only reflects the
  // batches submitted so far, so it can look "finished" between batches
  // before later ones are even sent. Gate on queueRunning too.
  const batchFinished = !queueRunning && batchTotal > 0 && batchTerminal.queued === 0 && batchTerminal.processing === 0;
  const failedFiles = useMemo(() => {
    const failedIds = [...activeBatch.keys()].filter((queueId) => {
      const item = submissionItems.find((entry) => queueIdentity(entry) === queueId) || items.find((entry) => queueIdentity(entry) === queueId);
      return (item?.status || batchResultStatuses.get(queueId) || "").toLowerCase() === "failed";
    });
    return failedIds.map((queueId) => batchFiles.current.get(queueId)).filter((file): file is File => Boolean(file));
  }, [activeBatch, batchResultStatuses, items, submissionItems]);
  const failedQueueItems = useMemo(() => items.filter((item) => item.status.toLowerCase() === "failed"), [items]);
  const retryableFailureCount = retrySupported ? failedQueueItems.length : failedFiles.length;
  const visibleCounts = useMemo(() => {
    const normalized: Record<string, number> = {};
    for (const [rawStatus, count] of Object.entries(counts)) {
      const label = displayStatus(rawStatus).label;
      normalized[label] = (normalized[label] || 0) + count;
    }
    return normalized;
  }, [counts]);

  const queueTotalPages = Math.max(1, Math.ceil(queueTotal / queuePageSize));
  const pageItems = items;

  useEffect(() => {
    setQueuePage(1);
  }, [queueSearch, queueSource, queueStatus, roleId]);

  useEffect(() => {
    if (queuePage > queueTotalPages) setQueuePage(queueTotalPages);
  }, [queuePage, queueTotalPages]);

  return (
    <section className="bulk-screening-panel" aria-labelledby="bulk-screening-title">
      <div className="bulk-screening-header">
        <div>
          <h2 id="bulk-screening-title">Add Resumes for Screening</h2>
          <p>Choose the role, add resumes from your computer or cloud storage, then follow each screening result below.</p>
        </div>
        <span className="bulk-screening-badge">PDF, DOC, or DOCX · up to 10 MB each</span>
      </div>

      <ol className="resume-screening-steps" aria-label="Resume screening steps">
        <li className={roleId ? "is-complete" : "is-current"}><span>1</span><strong>Choose a role</strong></li>
        <li className={files.length ? "is-current" : roleId ? "is-next" : "is-next"}><span>2</span><strong>Add resumes</strong></li>
        <li className={items.length || batchTotal ? "is-current" : "is-next"}><span>3</span><strong>Review progress</strong></li>
      </ol>

      <div className="bulk-screening-body">
        <div className="bulk-screening-controls">
          <label className="field">
            <span>Select the role these resumes are for *</span>
            <select value={roleId} disabled={roleOptions.length === 0} onChange={(event) => selectRole(event.target.value)}>
              <option value="">Choose a published role</option>
              {roleOptions.map((role) => <option key={role.roleId} value={role.roleId}>{role.label}</option>)}
            </select>
            <small>Screening results are compared with this role&apos;s requirements.</small>
            {selectedRole && <small>Selected role: {selectedRole.label} · Role reference: {selectedRole.roleId}</small>}
            {roleId && <InterviewAutomationNotice roleId={roleId} variant="upload" />}
            {roleOptions.length === 0 && <small className="bulk-screening-role-empty">There are no published roles available. Publish a role before adding resumes.</small>}
          </label>
          <div className="bulk-screening-action">
            <div className="bulk-screening-source-option">
              <small>{driveStatus === null ? "Checking Google Drive connection…" : driveStatus.connected ? `Google Drive connected${driveStatus.accountEmail ? ` as ${driveStatus.accountEmail}` : ""}` : "Google Drive is not connected. You can keep uploading files from your computer; connect Drive only if you want to import from it."}</small>
            {driveStatus?.connected
              ? <button type="button" className="btn btn-secondary btn-with-icon" disabled={!roleId || uploading || driveImporting} onClick={() => setCloudPicker("google")}><GoogleDriveIcon />Choose from Google Drive</button>
              : roleId ? <a className="btn btn-secondary btn-with-icon" href="/api/auth/google-drive/connect"><GoogleDriveIcon />Connect Google Drive</a> : <button type="button" className="btn btn-secondary btn-with-icon" disabled><GoogleDriveIcon />Choose a role first</button>}
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
            </div>
            <div className="bulk-screening-source-option">
            {msDriveStatus?.configured && <small>{msDriveStatus.connected ? `OneDrive connected${msDriveStatus.accountEmail ? ` as ${msDriveStatus.accountEmail}` : ""}` : "OneDrive is not connected"}</small>}
            {msDriveStatus?.configured && (msDriveStatus.connected
              ? <button type="button" className="btn btn-secondary" disabled={!roleId || uploading || driveImporting} onClick={() => setCloudPicker("microsoft")}>Choose from OneDrive</button>
              : roleId ? <a className="btn btn-secondary" href="/api/auth/microsoft-drive/connect">Connect OneDrive</a> : <button type="button" className="btn btn-secondary" disabled>Choose a role first</button>)}
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
          <input aria-label="Browse resume files" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple disabled={!roleId || uploading || queueRunning} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          <div className="bulk-screening-dropzone-copy">
            <strong>{roleId ? "Drop resumes here or browse files" : "Choose a role to add resumes"}</strong>
            <span>Up to {MAX_CAMPAIGN_FILES} files per selection. We automatically process more than {MAX_FILES_PER_SUBMISSION} in batches. {files.length > 0 ? `${files.length} selected.` : "PDF, DOC, or DOCX files up to 10 MB each."}</span>
            {roleId && <span className="bulk-screening-browse-hint" aria-hidden="true">Browse files</span>}
          </div>
        </label>

        {files.length > 0 && (
          <div className="bulk-screening-file-list">
            <p className="bulk-screening-file-list-heading">{files.length} resume{files.length === 1 ? "" : "s"} ready</p>
            {files.map((file) => <div key={`${file.name}-${file.size}-${file.lastModified}`} className="bulk-screening-file-row">
              <span className="bulk-screening-file-name"><strong>{file.name}</strong><small>From your computer · {formatFileSize(file.size)} · Ready to screen</small></span>
              <button type="button" aria-label={`Remove ${file.name}`} disabled={uploading || queueRunning} onClick={() => removeFile(file)}>Remove</button>
            </div>)}
          </div>
        )}

        <div className="bulk-screening-upload-box">
          <div className="bulk-screening-count">
            <span>{files.length} resume{files.length === 1 ? "" : "s"} ready to screen</span>
            <EllaCreditsMeter variant="inline" estimateFor={files.length} />
            <span className="bulk-screening-count-hint">Your credit balance and current screening rate are shown above. See the <a href="/credits">Credits page</a> for details.</span>
          </div>
          {queueRunning ? (
            <button type="button" className="btn btn-secondary" onClick={() => { queueCancelRef.current = true; }}>Stop after current batch</button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!roleId || files.length === 0 || uploading || retryingSavedFailures}
              onClick={() => void (files.length > MAX_FILES_PER_SUBMISSION ? runBulkQueue(files) : uploadResumes(files))}
            >
              {uploading ? <LoadingLabel>{uploadPhase === "preparing" ? "Preparing files…" : "Uploading and screening…"}</LoadingLabel> : `Screen ${files.length || "selected"} resume${files.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
        {files.length > MAX_FILES_PER_SUBMISSION && <p className="bulk-screening-batch-explanation" role="status">You selected {files.length} resumes. We&apos;ll process them automatically in {Math.ceil(files.length / MAX_FILES_PER_SUBMISSION)} batches.</p>}

        {queueProgress && (queueRunning || queueProgress.done < queueProgress.total) && (
          <ActionFeedback kind="success" className="bulk-screening-action-feedback" ariaLive="polite">
            Submitting batch {Math.min(queueProgress.done + (queueRunning ? 1 : 0), queueProgress.total)} of {queueProgress.total}. Keep this page open while the remaining batches are submitted.
          </ActionFeedback>
        )}
        {uploadMessage && <ActionFeedback kind="success" className="bulk-screening-action-feedback" ariaLive="polite">{uploading || driveImporting ? <LoadingLabel>{uploadMessage}</LoadingLabel> : uploadMessage}</ActionFeedback>}
        {warning && <ActionFeedback kind="warning" className="bulk-screening-action-feedback">{warning}</ActionFeedback>}
        {retryingSavedFailures && <ActionFeedback kind="success" className="bulk-screening-action-feedback" ariaLive="polite"><LoadingLabel>Retrying failed resumes…</LoadingLabel></ActionFeedback>}
        {retryableFailureCount > 0 && !uploading && !queueRunning && !retryingSavedFailures && !batchFinished && (
          <div className="warning-box bulk-screening-retry-box">
            <span>{retryableFailureCount} saved resume{retryableFailureCount === 1 ? "" : "s"} failed to process.</span>
            <button type="button" className="btn btn-secondary" onClick={() => retrySupported ? void retrySavedFailures(failedQueueItems) : retryFailedFiles(failedFiles)}>Retry failed ({retryableFailureCount})</button>
          </div>
        )}

        <div className="bulk-screening-instructions">
          <strong>{selectedRole ? `Add resumes for ${selectedRole.label}` : "How resume screening works"}</strong>
          <ol>
            <li>Choose the role you are hiring for.</li>
            <li>Add resumes from your computer, Google Drive, or OneDrive.</li>
            <li>Selections larger than {MAX_FILES_PER_SUBMISSION} files are submitted automatically in smaller batches. Keep this page open until all batches have been sent.</li>
            <li>Review each resume&apos;s status below. A resume already being screened is not queued twice; you can intentionally screen it again after the earlier attempt finishes. Failed resumes can be retried below.</li>
          </ol>
        </div>

        {batchTotal > 0 && (
          <div className="bulk-screening-progress" aria-live="polite" aria-busy={uploading || queueRunning}>
            <div className="bulk-screening-progress-header"><strong>Screening progress</strong><span>{batchProcessed} of {batchTotal} resumes processed</span></div>
            <div className="bulk-screening-progress-track"><div className="bulk-screening-progress-fill" style={{ width: `${batchPercent}%` }} /></div>
            <div className="bulk-screening-progress-legend">
              <span>{batchPercent}% complete</span>
              <span>{batchTerminal.queued} queued</span>
              <span>{batchTerminal.processing} processing</span>
              <span>{batchTerminal.completed} screened</span>
              <span>{batchTerminal.failed} failed</span>
              {batchTerminal.skipped > 0 && <span>{batchTerminal.skipped} skipped</span>}
            </div>
          </div>
        )}

        {batchFinished && !uploading && (
          <div className="success-box bulk-screening-finished" role="status" aria-live="polite">
            <div>
              <strong>Bulk screening completed</strong>
              <span>{batchTerminal.completed} screened successfully{batchTerminal.failed ? ` · ${batchTerminal.failed} failed` : ""}{batchTerminal.skipped ? ` · ${batchTerminal.skipped} skipped` : ""}</span>
            </div>
            <div className="bulk-screening-finished-actions">
              <a className="btn btn-primary" href="/applicants">View Processed Applicants</a>
              {retryableFailureCount > 0 && <button type="button" className="btn btn-secondary" onClick={() => retrySupported ? void retrySavedFailures(failedQueueItems) : retryFailedFiles(failedFiles)}>Retry {retryableFailureCount} Failed</button>}
            </div>
          </div>
        )}

        <div className="bulk-screening-status-header">
          <div><strong>Screening records</strong><small>{roleId ? `All saved screening records for ${selectedRole?.label || roleId}` : "Choose a role to view its records"}{lastUpdated ? ` · Updated ${formatPortalDateTime(lastUpdated)}` : ""}</small></div>
            <button type="button" className="btn btn-secondary" onClick={() => void refreshStatus()} disabled={loading} aria-busy={loading}>{loading ? <LoadingLabel>Refreshing status…</LoadingLabel> : "Refresh status"}</button>
        </div>

        {!configured && <div className="warning-box">{error || "Create the Bulk_Resume_Queue tab to view processing status."}</div>}
        {configured && error && <ActionFeedback kind="error" className="bulk-screening-action-feedback">{error}</ActionFeedback>}

        <div className="bulk-screening-counts">
          {statusOrder.map((status) => <div key={status} className="bulk-count-card"><span>{status}</span><strong>{visibleCounts[status] || 0}</strong></div>)}
        </div>

        <div className="bulk-screening-record-filters">
          <label className="field"><span>Search records</span><input value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Candidate, file, email, or application" /></label>
          <label className="field"><span>Filter by source</span><select value={queueSource} onChange={(event) => setQueueSource(event.target.value)}><option>All sources</option><option>Computer upload</option><option>Google Drive</option><option>OneDrive</option><option>Recovered record</option></select></label>
          <label className="field"><span>Filter by status</span><select value={queueStatus} onChange={(event) => setQueueStatus(event.target.value)}><option>All statuses</option>{statusOrder.map((status) => <option key={status}>{status}</option>)}</select></label>
        </div>
        <p className="bulk-screening-status-help">Queued means waiting to be screened. Processing means screening is underway. Screened means a result is saved. Failed items can be retried; skipped items were already submitted or screened. Other covers older or unrecognized records so they remain visible for review.</p>

        {roleId && pageItems.length > 0 ? (
          <div className="bulk-screening-table-wrap">
            <table className="bulk-screening-table">
              <thead><tr><th>Resume</th><th>Candidate</th><th>Source</th><th>Status</th><th>Result</th><th>Updated</th></tr></thead>
              <tbody>
                {pageItems.map((item) => {
                  const { label, result } = displayStatus(item.status || "Queued");
                  return <tr key={item.driveFileId}>
                    <td>{item.driveFileUrl ? <a href={item.driveFileUrl} target="_blank" rel="noreferrer">{item.driveFileName || "Open resume"}</a> : item.driveFileName || "Resume name not available"}</td>
                    <td>{item.candidateName || item.candidateEmail || "Candidate details being prepared"}</td>
                    <td>{item.source === "drive" ? "Google Drive" : item.source === "onedrive" ? "OneDrive" : item.source === "reconciled" ? "Recovered record" : "Computer upload"}</td>
                    <td><StatusBadge value={label} /></td>
                    <td>{item.errorMessage || result}</td>
                    <td>{(() => { const ts = item.lastUpdated || item.processedAt || item.discoveredAt; return ts ? formatPortalDateTime(ts) : "Not available"; })()}</td>
                  </tr>;
                })}
              </tbody>
            </table>
            <Pagination page={queuePage} totalPages={queueTotalPages} totalItems={queueTotal} pageSize={queuePageSize} pageSizeOptions={[10, 25, 50, 100]} onPageChange={setQueuePage} onPageSizeChange={(nextSize) => { setQueuePageSize(nextSize); setQueuePage(1); }} />
          </div>
        ) : <p className="bulk-screening-empty">{!roleId ? "Choose a published role to see its screening records." : queueTotal === 0 && queueSearch === "" && queueStatus === "All statuses" && queueSource === "All sources" ? "No resumes have been added for this role yet." : "No screening records match your search or filters."}</p>}
      </div>

      <GoogleDriveResumePicker
        open={cloudPicker === "google" && Boolean(roleId)}
        maxSelection={MAX_CAMPAIGN_FILES}
        onClose={() => setCloudPicker(null)}
        onError={(message, reconnect) => {
          setError(message);
          if (reconnect) setDriveStatus({ connected: false, accountEmail: "" });
        }}
        onImport={(selections) => void importFromCloud("google", selections)}
      />
      <DriveFilePicker
        open={cloudPicker === "microsoft" && Boolean(roleId)}
        importing={driveImporting}
        maxSelection={MAX_CAMPAIGN_FILES}
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
