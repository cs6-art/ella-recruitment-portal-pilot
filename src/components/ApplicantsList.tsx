"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import type { ApplicantMetrics, ApplicantSummary } from "@/lib/candidate-applications";
import Pagination from "@/components/Pagination";
import { formatMatchScore } from "@/lib/score-format";
import { formatPortalDateTime } from "@/lib/portal-time";
import { isNewApplicant, readApplicantsLastSeen, writeApplicantsLastSeen } from "@/lib/new-applicants";
import { applicantStageLabel } from "@/lib/applicant-stage-labels";

type Props = {
  applicants: ApplicantSummary[];
  title?: string;
  description?: string;
  topContent?: ReactNode;
  publishedRoles?: { roleId: string; label: string }[];
  canManageApplicants?: boolean;
  /** Identifies the current user so the "new since your last visit" watermark is per-person. */
  userEmail?: string;
  /** Historical demo metrics stay visible in the summary while the table is operationally filtered. */
  historyMetrics?: ApplicantMetrics;
};

type RoleOption = { value: string; label: string; roleId?: string };

const DASHBOARD_STAGE_LABELS = [
  "Resume Review",
  "Resume Approved",
  "Voice Booking Pending",
  "Voice Interview Scheduled",
  "Voice Interview Review",
  "Approved for Face-to-Face Interview",
  "Face-to-Face Interview Scheduled",
  "Face-to-Face Decision Pending",
  "Passed Final Interview",
  "Rejected",
] as const;

/**
 * Map operational status wording onto the reconciled stage names used by the
 * dashboard. This keeps the Applicants filter useful without changing the
 * labels shown on individual records or the underlying sheet values.
 */
function dashboardStageLabel(stage: string) {
  const friendlyLabel = applicantStageLabel(stage);
  if (friendlyLabel !== stage.trim()) return friendlyLabel;
  const value = stage.trim().toLowerCase();
  if (value.includes("reject")) return "Rejected";
  if (value.includes("passed hr") || value.includes("passed final") || value === "hired") return "Passed Final Interview";
  if (value.includes("hr decision") || value.includes("final interview completed") || value.includes("hr interview completed")) return "Face-to-Face Decision Pending";
  if (value.includes("hr interview scheduled") || value.includes("final interview scheduled")) return "Face-to-Face Interview Scheduled";
  if (value.includes("approved for hr") || value.includes("approved for final")) return "Approved for Face-to-Face Interview";
  if (value.includes("voice interview completed") || value.includes("voice hr review") || value.includes("awaiting hr review")) return "Voice Interview Review";
  if (value.includes("voice interview scheduled") || value.includes("ai voice interview scheduled")) return "Voice Interview Scheduled";
  if (value.includes("voice interview in progress") || value.includes("voice interview no show") || value.includes("voice interview busy")) return "Resume Approved";
  if (value.includes("approved for ai voice") || value.includes("awaiting ai voice") || value.includes("voice booking pending")) return "Voice Booking Pending";
  if (value.includes("resume approved")) return "Resume Approved";
  if (value.includes("pending hr review") || value.includes("resume hr review") || value === "processed") return "Resume Review";
  return stage;
}

function stageClass(stage: string) {
  return `applicant-stage applicant-stage-${stage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function formatDate(value: string) {
  return formatPortalDateTime(value, false);
}

/**
 * Keep the operational table ordered by the actual application timestamp.
 * Some sheet rows contain a date-only value, while live submissions use an
 * ISO timestamp embedded in the application ID; use both when available so
 * a newly submitted applicant cannot fall onto a later pagination page.
 */
function applicantSortTimestamp(applicant: ApplicantSummary) {
  const parsed = Date.parse(applicant.appliedAt);
  if (Number.isFinite(parsed)) {
    // A few legacy/demo rows were written with a Singapore-local clock but a
    // trailing `Z`, making them appear hours in the future. Never let those
    // malformed values outrank a real application submitted just now.
    if (parsed > Date.now() + 5 * 60 * 1000) return 0;
    return parsed;
  }
  const timestampedId = applicant.applicationId.match(/^APP-(\d{13})-/i);
  return timestampedId ? Number(timestampedId[1]) : 0;
}

function scoreValue(value: string) {
  if (!value) return "—";
  return formatMatchScore(value);
}

export default function ApplicantsList({ applicants, title = "Applicants", description = "Review candidates across every published role.", topContent, publishedRoles, canManageApplicants = false, userEmail, historyMetrics }: Props) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [stageFilter, setStageFilter] = useState("All Stages");
  const [deletingId, setDeletingId] = useState("");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  // The "new since your last visit" watermark, read once on mount and then
  // advanced so the next visit starts clean (and the header bell count clears).
  // Holding it fixed for the visit keeps the row highlight stable even when the
  // applicants prop is replaced by a router.refresh() (e.g. after a delete).
  const [seenWatermark, setSeenWatermark] = useState<number | null>(null);

  useEffect(() => {
    setSeenWatermark(readApplicantsLastSeen(userEmail));
    writeApplicantsLastSeen(userEmail);
  }, [userEmail]);

  const newApplicantIds = useMemo(() => {
    if (seenWatermark === null) return new Set<string>();
    return new Set(
      applicants.filter((applicant) => isNewApplicant(applicant, seenWatermark)).map((applicant) => applicant.applicationId),
    );
  }, [applicants, seenWatermark]);

  const hasPublishedRoleScope = publishedRoles !== undefined;
  const roleOptions = useMemo<RoleOption[]>(() => {
    if (hasPublishedRoleScope) {
      const unique = new Map<string, RoleOption>();
      (publishedRoles || []).forEach((role) => {
        const value = role.roleId || role.label;
        if (!unique.has(value)) unique.set(value, { value, label: role.label, roleId: role.roleId });
      });
      return [...unique.values()].sort((left, right) => left.label.localeCompare(right.label));
    }
    return [...new Set(applicants.map((applicant) => applicant.selectedRole || applicant.roleId).filter(Boolean))]
      .sort()
      .map((role) => ({ value: role, label: role }));
  }, [applicants, hasPublishedRoleScope, publishedRoles]);
  // Historical demo rows are hidden during normal browsing, but become
  // visible when HR explicitly chooses a dashboard stage to inspect them.
  const showHistoricalDemo = stageFilter !== "All Stages";
  const activeApplicants = useMemo(() => applicants.filter((applicant) => !removedIds.has(applicant.applicationId) && (!applicant.isHistoricalDemo || showHistoricalDemo)), [applicants, removedIds, showHistoricalDemo]);
  const dashboardStages = useMemo(() => {
    const labels = historyMetrics?.stageCounts.map((stage) => stage.label) ?? [];
    return labels.length > 0 ? labels : [...DASHBOARD_STAGE_LABELS];
  }, [historyMetrics]);
  const stages = useMemo(() => [...new Set([
    ...dashboardStages,
    ...applicants.map((applicant) => dashboardStageLabel(applicant.currentStage)).filter(Boolean),
  ])].sort(), [applicants, dashboardStages]);

  const visibleApplicants = useMemo(() => {
    const query = search.trim().toLowerCase();
    const selectedRole = roleOptions.find((role) => role.value === roleFilter);
    return activeApplicants.filter((applicant) => {
      const applicantRole = applicant.selectedRole || applicant.roleId;
      const searchable = `${applicant.applicationId} ${applicant.candidateName} ${applicant.email} ${applicant.roleId} ${applicant.selectedRole} ${applicant.department}`.toLowerCase();
      return (!query || searchable.includes(query)) &&
        // Generated history is intentionally read-only, so it can still be
        // inspected from a dashboard stage filter even when its synthetic role
        // is not present in the live published-role directory. Operational
        // applicants are always shown: a row written by the screening workflow
        // must remain reviewable even when the role's publication evidence is
        // still being reconciled (for example, a stale Posting_Confirmed flag).
        // Public intake remains gated by isPublishedRoleForIntake; this list is
        // an internal audit view and should not hide a successfully processed
        // applicant merely because the role metadata is behind it.
        (roleFilter === "All Roles" || applicant.roleId === selectedRole?.roleId || applicantRole === roleFilter || applicant.selectedRole === selectedRole?.label) &&
        (stageFilter === "All Stages" || dashboardStageLabel(applicant.currentStage) === stageFilter || applicant.currentStage === stageFilter);
    }).sort((left, right) => {
      const dateDifference = applicantSortTimestamp(right) - applicantSortTimestamp(left);
      if (dateDifference !== 0) return dateDifference;
      // Keep ordering deterministic when multiple applications share the same
      // date-only value.
      return right.applicationId.localeCompare(left.applicationId);
    });
  }, [activeApplicants, roleFilter, roleOptions, search, stageFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleApplicants.length / pageSize));
  const pagedApplicants = visibleApplicants.slice((page - 1) * pageSize, page * pageSize);
  const selectableVisibleApplicants = visibleApplicants.filter((applicant) => !applicant.isHistoricalDemo);
  const selectedApplicants = activeApplicants.filter((applicant) => !applicant.isHistoricalDemo && selectedIds.has(applicant.applicationId));
  const allVisibleSelected = canManageApplicants && selectableVisibleApplicants.length > 0 && selectableVisibleApplicants.every((applicant) => selectedIds.has(applicant.applicationId));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // A refresh after a new submission should return HR to the first page,
  // where the newest applicant is now visible.
  useEffect(() => {
    setPage(1);
  }, [applicants]);

  const voiceCount = activeApplicants.filter((applicant) => applicant.voiceStatus || applicant.finalStatus.toLowerCase().includes("voice")).length;
  const finalInterviewCount = activeApplicants.filter((applicant) => applicant.finalInterviewStatus && applicant.finalInterviewStatus.toLowerCase() !== "pending").length;
  const summaryTotal = historyMetrics?.total ?? activeApplicants.length;
  const summaryScreened = historyMetrics?.screened ?? activeApplicants.filter((applicant) => ["processed", "for hr review", "pending hr review"].includes(applicant.resumeStatus.trim().toLowerCase())).length;
  const summaryVoice = historyMetrics?.voiceActivity ?? voiceCount;
  const summaryHr = historyMetrics?.hrActivity ?? finalInterviewCount;
  // Keep the pipeline headline aligned with the history-backed summary. Demo
  // history is read-only and appears only after an explicit stage filter.
  const hasApplicantFilters = Boolean(search.trim()) || roleFilter !== "All Roles" || stageFilter !== "All Stages";
  const matchingApplicantCount = hasApplicantFilters ? visibleApplicants.length : summaryTotal;

  async function deleteApplicants(applicantsToDelete: ApplicantSummary[]) {
    if (applicantsToDelete.length === 0) return;
    const countLabel = applicantsToDelete.length === 1 ? applicantsToDelete[0].candidateName || "this applicant" : `${applicantsToDelete.length} applicants`;
    if (!(await confirm({ title: "Delete applicant record?", message: `Delete ${countLabel}? This removes the applicant, screening evidence, history, and linked interview slots.`, confirmLabel: "Delete", tone: "danger" }))) return;

    const ids = applicantsToDelete.map((applicant) => applicant.applicationId);
    setDeletingId(ids.length === 1 ? ids[0] : "bulk");
    setDeletingIds(new Set(ids));
    setActionError("");
    setActionMessage("");

    const results: PromiseSettledResult<string>[] = [];
    for (const applicationId of ids) {
      try {
        const response = await fetch(`/api/applicants/${encodeURIComponent(applicationId)}`, { method: "DELETE", credentials: "same-origin" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true) throw new Error(data.error || `Unable to delete ${applicationId}.`);
        results.push({ status: "fulfilled", value: applicationId });
      } catch (error) {
        results.push({ status: "rejected", reason: error });
      }
    }
    const deletedIds = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failedCount = results.length - deletedIds.length;

    if (deletedIds.length > 0) {
      setRemovedIds((current) => new Set([...current, ...deletedIds]));
      setSelectedIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setActionMessage(`${deletedIds.length} applicant${deletedIds.length === 1 ? "" : "s"} deleted successfully.${failedCount ? ` ${failedCount} could not be deleted.` : ""}`);
    }
    if (failedCount > 0) {
      const firstFailure = results.find((result) => result.status === "rejected");
      setActionError(firstFailure?.status === "rejected" && firstFailure.reason instanceof Error ? firstFailure.reason.message : "Some applicants could not be deleted.");
    }
    if (deletedIds.length > 0) router.refresh();
    setDeletingIds(new Set());
    setDeletingId("");
  }

  function toggleApplicantSelection(applicationId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(applicationId)) next.delete(applicationId);
      else next.add(applicationId);
      return next;
    });
  }

  function toggleAllVisibleApplicants() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) selectableVisibleApplicants.forEach((applicant) => next.delete(applicant.applicationId));
      else selectableVisibleApplicants.forEach((applicant) => next.add(applicant.applicationId));
      return next;
    });
  }

  return (
    <main className="container page applicants-page">
      <div className="hero-row applicants-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>

        <div className="applicants-header-meta"><strong>{summaryTotal}</strong><span>Total applications</span></div>
      </div>

      {actionMessage && <ActionFeedback kind="success" className="applicants-action-feedback">{actionMessage}</ActionFeedback>}
      {actionError && <ActionFeedback kind="error" className="applicants-action-feedback">{actionError}</ActionFeedback>}

      {topContent && <div className="applicants-intake-section">{topContent}</div>}

      <div className="applicant-stat-grid">
        <div className="applicant-stat"><span>Applications</span><strong>{summaryTotal}</strong><small>All history and live records</small></div>
        <div className="applicant-stat"><span>Resume Screened</span><strong>{summaryScreened}</strong><small>Processed applications</small></div>
        <div className="applicant-stat"><span>Voice Interview</span><strong>{summaryVoice}</strong><small>With voice workflow activity</small></div>
        <div className="applicant-stat"><span>Face-to-Face Interview</span><strong>{summaryHr}</strong><small>Moved beyond voice screening</small></div>
      </div>

      <section className="card applicants-card">
        <div className="applicants-toolbar">
          <div><h2>Applicant Pipeline</h2><span>{matchingApplicantCount} matching applicant{matchingApplicantCount === 1 ? "" : "s"}</span></div>
          {canManageApplicants && <div className="bulk-selection-toolbar"><span>{selectedApplicants.length} selected</span><button type="button" className="btn btn-danger-outline" disabled={selectedApplicants.length === 0 || deletingId !== ""} onClick={() => void deleteApplicants(selectedApplicants)}>Delete selected</button></div>}
          <div className="applicants-filters">
            <input aria-label="Search applicants" placeholder="Search candidate, role, or ID" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            <select aria-label="Filter by role" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); }}><option>All Roles</option>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select>
            <select aria-label="Filter by stage" value={stageFilter} onChange={(event) => { setStageFilter(event.target.value); setPage(1); }}><option>All Stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select>
            <label className="pagination-size-control">Rows
              <select aria-label="Applicants per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                <option value="10">10</option><option value="25">25</option><option value="50">50</option>
              </select>
            </label>
          </div>
        </div>

        {visibleApplicants.length === 0 ? (
          <div className="empty">No applicants match the current filters.</div>
        ) : (
          <div className="table-wrap">
            <table className="applicants-table">
              <thead><tr>{canManageApplicants && <th className="selection-column"><input type="checkbox" aria-label="Select all visible applicants" checked={allVisibleSelected} disabled={selectableVisibleApplicants.length === 0} onChange={toggleAllVisibleApplicants} /></th>}<th>Candidate</th><th>Role</th><th>Applied</th><th>Match</th><th>Current Stage</th><th>Next Action</th><th>Action</th></tr></thead>
              <tbody>
                {pagedApplicants.map((applicant, index) => (
                  <tr key={`${applicant.applicationId || "applicant"}-${applicant.roleId || "role"}-${index}`} className={[selectedIds.has(applicant.applicationId) ? "is-selected" : "", newApplicantIds.has(applicant.applicationId) ? "is-new-applicant" : ""].filter(Boolean).join(" ") || undefined}>
                    {canManageApplicants && <td className="selection-column">{applicant.isHistoricalDemo ? <span className="applicant-readonly-label">Demo</span> : <input type="checkbox" aria-label={`Select ${applicant.candidateName || applicant.applicationId}`} checked={selectedIds.has(applicant.applicationId)} disabled={deletingIds.has(applicant.applicationId)} onChange={() => toggleApplicantSelection(applicant.applicationId)} />}</td>}
                    {/* data-label values let the responsive CSS render each row as a
                        labeled card when the table cannot fit the content column. */}
                    <td data-label="Candidate"><Link className="applicant-name-link" href={`/applicants/${encodeURIComponent(applicant.applicationId)}`}><strong>{applicant.candidateName || "Unnamed candidate"}{newApplicantIds.has(applicant.applicationId) && <span className="applicant-new-badge">NEW</span>}</strong><span>{applicant.email || applicant.applicationId}</span></Link></td>
                    <td data-label="Role"><strong>{applicant.selectedRole || "Role not provided"}</strong><span className="applicant-subtext">{applicant.roleId}</span></td>
                    <td data-label="Applied">{formatDate(applicant.appliedAt)}</td>
                    <td data-label="Match"><strong className="applicant-score">{scoreValue(applicant.matchScore)}</strong>{applicant.recommendation && <span className="applicant-subtext">{applicant.recommendation}</span>}</td>
                    <td data-label="Current stage"><span className={stageClass(applicant.currentStage)}>{applicantStageLabel(applicant.currentStage) || "Pending HR Review"}</span></td>
                    <td data-label="Next action">{applicant.nextAction}</td>
                    <td data-label="Action"><div className="applicant-table-actions"><Link href={`/applicants/${encodeURIComponent(applicant.applicationId)}`}>View</Link>{canManageApplicants && !applicant.isHistoricalDemo && <><Link href={`/applicants/${encodeURIComponent(applicant.applicationId)}/edit`}>Edit</Link><button type="button" className="table-danger-action" disabled={deletingIds.has(applicant.applicationId) || deletingId === "bulk"} onClick={() => void deleteApplicants([applicant])}>{deletingIds.has(applicant.applicationId) ? "Deleting..." : "Delete"}</button></>}{applicant.isHistoricalDemo && <span className="applicant-readonly-label">Read-only demo history</span>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {visibleApplicants.length > 0 && <Pagination page={page} totalPages={totalPages} totalItems={visibleApplicants.length} displayTotalItems={matchingApplicantCount} pageSize={pageSize} onPageChange={setPage} />}
      </section>
    </main>
  );
}
