"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
};

const statusOrder = ["Queued", "Processing", "Completed", "Failed", "Skipped"];
const POLL_INTERVAL_MS = 60000;
const TERMINAL_STATUSES = new Set(["screened", "processed", "failed", "skipped"]);

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

export default function BulkResumeScreeningPanel({ roleOptions, driveUrl }: { roleOptions: RoleOption[]; driveUrl: string }) {
  const [roleId, setRoleId] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [error, setError] = useState("");
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  // Tracks the resumes submitted in the batch currently in flight, keyed by
  // the same content-hash queue ID the server computes, so the live section
  // below can show real-time progress for exactly this upload rather than
  // the role's entire screening history.
  const [activeBatch, setActiveBatch] = useState<Map<string, string>>(new Map());
  const [batchResultStatuses, setBatchResultStatuses] = useState<Map<string, string>>(new Map());
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
      setCounts(result.roleTotals || result.counts || {});
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
    refreshAbort.current?.abort();
    refreshAbort.current = null;
    refreshInFlight.current = false;
    statusRequestId.current += 1;
    setRoleId(nextRoleId);
    setItems([]);
    setCounts({});
    setActiveBatch(new Map());
    setBatchResultStatuses(new Map());
    batchFiles.current.clear();
    setFiles([]);
    setUploadMessage("");
    setError("");
  }

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const loadCreditBalance = useCallback(async () => {
    try {
      const response = await fetch("/api/ella-credits/balance", { cache: "no-store" });
      const result = await response.json();
      if (response.ok && result.success === true) setCreditBalance(Number(result.balance));
    } catch {
      // A missing balance chip is not worth surfacing as an error.
    }
  }, []);

  useEffect(() => {
    void loadCreditBalance();
  }, [loadCreditBalance]);

  // Polls automatically, without requiring a manual refresh, while any
  // tracked item (from the active batch, or otherwise) is still Queued or
  // Processing. Stops on its own once everything reaches a terminal state.
  const pendingInBatch = useMemo(() => {
    if (activeBatch.size === 0) return false;
    return Array.from(activeBatch.keys()).some((queueId) => {
      const item = items.find((entry) => entry.driveFileId === queueId);
      const reportedStatus = batchResultStatuses.get(queueId)?.toLowerCase() || "";
      // A successful response without a queue row is still only an accepted
      // handoff. Local validation/request failures may terminate immediately,
      // but successful completion must come from the queue-backed status API.
      const status = item?.status || (["failed", "skipped"].includes(reportedStatus) ? reportedStatus : "Queued");
      return !TERMINAL_STATUSES.has(status.toLowerCase());
    });
  }, [activeBatch, batchResultStatuses, items]);
  const anyPending = pendingInBatch || items.some((item) => !TERMINAL_STATUSES.has(item.status.toLowerCase()));

  useEffect(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    if (!roleId || !anyPending) return;
    pollTimer.current = setInterval(() => { void refreshStatus(); }, POLL_INTERVAL_MS);
    return () => { if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; } };
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
      return merged;
    });
  }

  function removeFile(target: File) {
    setFiles((current) => current.filter((file) => file !== target));
  }

  async function uploadResumes(fileList: File[]) {
    if (!roleId || fileList.length === 0 || uploading) return;
    setUploading(true);
    setError("");
    setUploadMessage("");
    try {
      // Pre-compute each file's queue ID client-side (same hash the server
      // uses) so the live section below can track this exact batch from the
      // moment upload starts, rather than only after the request resolves.
      const batch = new Map<string, string>();
      const fileMap = new Map<string, File>();
      await Promise.all(fileList.map(async (file) => {
        const queueId = await fileQueueId(roleId, file);
        batch.set(queueId, file.name);
        fileMap.set(queueId, file);
      }));
      batchFiles.current = fileMap;
      setActiveBatch(batch);
      setBatchResultStatuses(new Map());

      const formData = new FormData();
      formData.set("roleId", roleId);
      fileList.forEach((file) => formData.append("resumes", file));
      const response = await fetch("/api/resume-screening/bulk/upload", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error || "Unable to submit the bulk resumes.");
      const submitted = Number(result.submitted || 0);
      const results = (result.results || []) as Array<{ fileName?: string; queueId?: string; status?: string; skipped?: boolean; message?: string }>;
      setBatchResultStatuses(new Map(results.filter((item) => item.queueId).map((item) => [item.queueId as string, String(item.status || "Queued")])));
      const notificationStatus = String(result.notificationStatus || "not_requested");
      const skippedResults = results.filter((item) => item.skipped);
      const alreadyScreened = skippedResults.filter((item) => item.status?.toLowerCase() === "screened").length;
      const alreadyActive = skippedResults.length - alreadyScreened;
      const failed = results.filter((item) => String(item.status || "").toLowerCase() === "failed");
      const failedQueueIds = new Set(failed.map((item) => item.queueId).filter(Boolean));
      const failedFileSet = new Set([...failedQueueIds].map((queueId) => fileMap.get(queueId as string)).filter(Boolean));
      const uploadSummary = submitted ? `${submitted} resume${submitted === 1 ? "" : "s"} submitted for processing` : "No new resumes were submitted";
      const notificationSummary = notificationStatus === "sent"
        ? " Internal completion email sent to HR and management."
        : notificationStatus === "disabled"
          ? " Success email notifications are currently disabled for bulk processing."
          : notificationStatus === "failed"
            ? " The internal completion email failed; resume processing is unaffected."
            : " No internal completion email was requested.";
      setUploadMessage(`${uploadSummary}${failed.length ? `; ${failed.length} failed` : ""}${alreadyScreened ? `; ${alreadyScreened} already screened and skipped` : ""}${alreadyActive ? `; ${alreadyActive} already queued or processing` : ""}.${notificationSummary}`);
      setFiles((current) => current.filter((file) => !fileList.includes(file) || failedFileSet.has(file)));
      await refreshStatus();
      void loadCreditBalance();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit the bulk resumes.");
    } finally {
      setUploading(false);
    }
  }

  function openDriveFolder() {
    if (!driveUrl || !roleId) return;
    window.open(driveUrl, "_blank", "noopener,noreferrer");
  }

  const batchTotal = activeBatch.size;
  const batchTerminal = useMemo(() => {
    if (batchTotal === 0) return { completed: 0, failed: 0, processing: 0, queued: 0, skipped: 0 };
    let completed = 0, failed = 0, processing = 0, queued = 0, skipped = 0;
    for (const queueId of activeBatch.keys()) {
      const item = items.find((entry) => entry.driveFileId === queueId);
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
  const batchFinished = batchTotal > 0 && batchTerminal.queued === 0 && batchTerminal.processing === 0;
  const failedFiles = useMemo(() => {
    const failedIds = [...activeBatch.keys()].filter((queueId) => {
      const item = items.find((entry) => entry.driveFileId === queueId);
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
          <p>Select a published role and upload multiple PDF, DOC, or DOCX resumes directly from this page. Ella processes each file once and records its screening status here.</p>
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
            {driveUrl && <button type="button" className="btn btn-secondary" disabled={!roleId} onClick={openDriveFolder}>Upload from Google Drive</button>}
          </div>
        </div>

        <label
          className={`bulk-screening-dropzone${dragActive ? " is-active" : ""}${!roleId ? " is-disabled" : ""}`}
          onDragOver={(event) => { event.preventDefault(); if (roleId) setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (roleId && !uploading && event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
          }}
        >
          {/* Match the browser picker with the server PDF/DOC/DOCX allowlist. */}
          <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple disabled={!roleId || uploading} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
          <div className="bulk-screening-dropzone-copy">
            <strong>Drag and drop resumes here, or click to choose files</strong>
            <span>Up to 25 PDF, DOC, or DOCX files per batch, 10 MB each. {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"} selected.` : "No files selected yet."}</span>
          </div>
        </label>

        {files.length > 0 && (
          <div className="bulk-screening-file-list">
            {files.map((file) => (
              <span key={`${file.name}-${file.size}-${file.lastModified}`} className="bulk-screening-file-chip">
                {file.name}
                <button type="button" aria-label={`Remove ${file.name}`} disabled={uploading} onClick={() => removeFile(file)}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="bulk-screening-upload-box">
          <span className="bulk-screening-count">
            {files.length} file{files.length === 1 ? "" : "s"} ready to submit
            {creditBalance !== null && ` · ${creditBalance} Ella Credit${creditBalance === 1 ? "" : "s"} left (1 per resume)`}
          </span>
          <button type="button" className="btn btn-primary" disabled={!roleId || files.length === 0 || uploading} onClick={() => void uploadResumes(files)}>{uploading ? "Uploading and screening..." : `Start screening${files.length ? ` (${files.length})` : ""}`}</button>
        </div>

        {uploadMessage && <div className="success-box">{uploadMessage}</div>}
        {failedFiles.length > 0 && !uploading && !batchFinished && (
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
            <li>Ella extracts the candidate details, submits each resume to the screening workflow, and updates the queue below in real time.</li>
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
        {configured && error && <div className="error-box">{error}</div>}

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
                    <td>{item.lastUpdated || item.processedAt || item.discoveredAt || "—"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="bulk-screening-empty">{roleId ? "No bulk resumes have been detected for this role yet." : "Choose a published role to see its bulk screening status."}</p>}
      </div>
    </section>
  );
}
