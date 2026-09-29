"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import type { ApplicantMetrics, ApplicantSummary } from "@/lib/candidate-applications";
import Pagination from "@/components/Pagination";
import { formatMatchScore } from "@/lib/score-format";
import { formatPortalDateTime } from "@/lib/portal-time";
import { isNewApplicant, writeApplicantsLastSeen } from "@/lib/new-applicants";
import { applicantStageLabel } from "@/lib/applicant-stage-labels";
import { numericMatchScore } from "@/lib/score-format";

type Props = {
  applicants: ApplicantSummary[];
  initialTotal?: number;
  scopeRoleId?: string;
  title?: string;
  description?: string;
  topContent?: ReactNode;
  publishedRoles?: { roleId: string; label: string }[];
  canManageApplicants?: boolean;
  /** Identifies the current user so the "new since your last visit" watermark is per-person. */
  userEmail?: string;
  /** Historical demo metrics stay visible in the summary while the table is operationally filtered. */
  historyMetrics?: ApplicantMetrics;
  lastUpdatedAt?: string;
};

type RoleOption = { value: string; label: string; roleId?: string };

const DASHBOARD_STAGE_LABELS = [
  "Resume Review",
  "Resume Approved",
  "Interview Choice Pending",
  "Voice Interview Booking Pending",
  "Voice Interview Scheduled",
  "Voice Interview Review",
  "Live Avatar Interview Pending",
  "Live Avatar Interview Scheduled",
  "Avatar Interview Review",
  "Approved for Face-to-Face Interview",
  "Face-to-Face Interview Scheduled",
  "Face-to-Face Decision Pending",
  "Passed Final Interview",
  "Rejected",
  "Withdrawn",
] as const;

const DASHBOARD_STAGE_GROUPS: Record<string, string[]> = {
  "Voice Interview": ["Voice Interview Booking Pending", "Voice Interview Scheduled"],
  "Live Avatar Interview": ["Live Avatar Interview Pending", "Live Avatar Interview Scheduled"],
  "Face-to-Face Interview": ["Approved for Face-to-Face Interview", "Face-to-Face Interview Scheduled"],
  Completed: ["Passed Final Interview", "Rejected"],
};

const DASHBOARD_STAGE_FILTERS = new Set([...DASHBOARD_STAGE_LABELS, ...Object.keys(DASHBOARD_STAGE_GROUPS)]);
const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  scheduled: "Scheduled",
  in_progress: "In progress",
  awaiting_review: "Awaiting review",
  review_complete: "Review complete",
};

/**
 * Map stored workflow keys and legacy sheet wording onto readable, mode-aware
 * stages. The canonical status remains unchanged in the database.
 */
function dashboardStageLabel(stage: string, mode: ApplicantSummary["interviewMode"] = "avatar") {
  const normalizedStage = stage.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const rawStage = stage.trim().toLowerCase();
  if (["voice_review_pending", "voice_hr_review"].includes(normalizedStage) || rawStage.includes("voice interview completed") || rawStage.includes("voice hr review") || rawStage.includes("awaiting hr review")) {
    return applicantStageLabel("voice_review_pending", mode);
  }
  const friendlyLabel = applicantStageLabel(stage, mode);
  if (friendlyLabel !== stage.trim()) return friendlyLabel;
  const value = stage.trim().toLowerCase();
  const interviewLabel = mode === "avatar" ? "Live Avatar Interview" : "Voice Interview";
  if (value.includes("reject")) return "Rejected";
  if (value.includes("passed hr") || value.includes("passed final") || value === "hired") return "Passed Final Interview";
  if (value.includes("hr decision") || value.includes("final interview completed") || value.includes("hr interview completed")) return "Face-to-Face Decision Pending";
  if (value.includes("hr interview scheduled") || value.includes("final interview scheduled")) return "Face-to-Face Interview Scheduled";
  if (value.includes("approved for hr") || value.includes("approved for final")) return "Approved for Face-to-Face Interview";
  if (value.includes("voice interview completed") || value.includes("voice hr review") || value.includes("awaiting hr review")) return applicantStageLabel("voice_review_pending", mode);
  if (value.includes("voice interview scheduled") || value.includes("ai voice interview scheduled")) return `${interviewLabel} Scheduled`;
  if (value.includes("voice interview in progress") || value.includes("voice interview no show") || value.includes("voice interview busy")) return interviewLabel;
  if (value.includes("approved for ai voice") || value.includes("awaiting ai voice") || value.includes("voice booking pending")) return `${interviewLabel} Booking Pending`;
  if (value.includes("resume approved")) return "Resume Approved";
  if (value.includes("pending hr review") || value.includes("resume hr review") || value === "processed") return "Resume Review";
  return stage;
}

function stageClass(stage: string) {
  return `applicant-stage applicant-stage-${stage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function matchesDashboardStageFilter(applicant: ApplicantSummary, filter: string) {
  if (filter === "All Stages") return true;
  const stageLabel = dashboardStageLabel(applicant.currentStage, applicant.interviewMode);
  const group = DASHBOARD_STAGE_GROUPS[filter];
  return group ? group.includes(stageLabel) : stageLabel === filter || applicant.currentStage === filter;
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
  if (!value) return "Not available";
  return formatMatchScore(value);
}

export default function ApplicantsList({ applicants: initialApplicants, initialTotal, scopeRoleId, title = "Applicants", description = "Review candidates across every published role.", topContent, publishedRoles, canManageApplicants = false, userEmail, historyMetrics, lastUpdatedAt }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [applicants, setApplicants] = useState(initialApplicants);
  const [remoteTotal, setRemoteTotal] = useState(initialTotal ?? initialApplicants.length);
  const [metricsData, setMetricsData] = useState(historyMetrics);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [stageFilter, setStageFilter] = useState("All Stages");
  const [resumeFilter, setResumeFilter] = useState("All resume statuses");
  const [interviewTypeFilter, setInterviewTypeFilter] = useState("All interview types");
  const [interviewStatusFilter, setInterviewStatusFilter] = useState("All interview statuses");
  const [sortFilter, setSortFilter] = useState("Newest first");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(lastUpdatedAt || "");
  const [deletingId, setDeletingId] = useState("");
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  // Opening Applicants records the current visit as the viewed watermark.
  // Applicants arriving after that timestamp remain highlighted during this visit.
  const [seenWatermark, setSeenWatermark] = useState<number | null>(null);
  const manualRefreshPending = useRef(false);
  useEffect(() => {
    setApplicants(initialApplicants);
    setRemoteTotal(initialTotal ?? initialApplicants.length);
    setLastUpdated(lastUpdatedAt || "");
  }, [initialApplicants, initialTotal, lastUpdatedAt]);
  useEffect(() => { setMetricsData(historyMetrics); }, [historyMetrics]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedStage = params.get("stage") || "";
    if (DASHBOARD_STAGE_FILTERS.has(requestedStage)) setStageFilter(requestedStage);
    const requestedPage = Number(params.get("page"));
    if (Number.isInteger(requestedPage) && requestedPage > 0) setPage(requestedPage);
    const requestedPageSize = Number(params.get("pageSize"));
    if ([10, 25, 50, 100].includes(requestedPageSize)) setPageSize(requestedPageSize);
    setSearch(params.get("search") || "");
    setRoleFilter(params.get("role") || "All Roles");
    setResumeFilter(params.get("resume") || "All resume statuses");
    setInterviewTypeFilter(params.get("interview") || "All interview types");
    setInterviewStatusFilter(params.get("interviewStatus") || "All interview statuses");
    setSortFilter(params.get("sort") === "oldest" ? "Oldest first" : params.get("sort") === "match" ? "Highest match" : "Newest first");
    setDateFrom(params.get("from") || "");
    setDateTo(params.get("to") || "");
  }, []);
  const firstFetch = useRef(true);
  useEffect(() => {
    if (firstFetch.current) {
      firstFetch.current = false;
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setRecordsLoading(true);
      setRefreshing(manualRefreshPending.current);
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (scopeRoleId) params.set("scopeRole", scopeRoleId);
      if (search.trim()) params.set("search", search.trim());
      if (roleFilter !== "All Roles") params.set("role", roleFilter);
      if (stageFilter !== "All Stages") params.set("stage", stageFilter);
      if (resumeFilter !== "All resume statuses") params.set("resume", resumeFilter);
      if (interviewTypeFilter !== "All interview types") params.set("interview", interviewTypeFilter);
      if (interviewStatusFilter !== "All interview statuses") params.set("interviewStatus", interviewStatusFilter.toLowerCase().replaceAll(" ", "_"));
      if (sortFilter !== "Newest first") params.set("sort", sortFilter === "Oldest first" ? "oldest" : "match");
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      try {
        const response = await fetch(`/api/applicants?${params}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { success?: boolean; applicants?: ApplicantSummary[]; total?: number; metrics?: ApplicantMetrics; lastUpdatedAt?: string; error?: string };
        if (!response.ok || result.success !== true || !Array.isArray(result.applicants)) throw new Error(result.error || "Applicants could not be refreshed. Please try again.");
        setApplicants(result.applicants);
        setRemoteTotal(Number(result.total) || 0);
        if (result.metrics) setMetricsData(result.metrics);
        setLastUpdated(result.lastUpdatedAt || new Date().toISOString());
        setActionError("");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setActionError(error instanceof Error ? error.message : "Applicants could not be refreshed. Please try again.");
      } finally {
        if (!controller.signal.aborted) {
          setRecordsLoading(false);
          setRefreshing(false);
          manualRefreshPending.current = false;
        }
      }
    }, search.trim() ? 300 : 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [dateFrom, dateTo, initialApplicants, initialTotal, interviewStatusFilter, interviewTypeFilter, page, pageSize, refreshSequence, resumeFilter, roleFilter, scopeRoleId, search, sortFilter, stageFilter]);
  useEffect(() => {
    if (!lastUpdatedAt) return;
    setLastUpdated(lastUpdatedAt);
    setRefreshing(false);
  }, [lastUpdatedAt]);
  useEffect(() => {
    const seenAt = Date.now();
    writeApplicantsLastSeen(userEmail, seenAt);
    setSeenWatermark(seenAt);
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
  const activeApplicants = useMemo(() => {
    const seen = new Set<string>();
    return applicants.filter((applicant) => {
      if (removedIds.has(applicant.applicationId) || (applicant.isHistoricalDemo && !showHistoricalDemo)) return false;
      const key = applicant.applicationId.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [applicants, removedIds, showHistoricalDemo]);
  const dashboardStages = useMemo(() => {
    return [...DASHBOARD_STAGE_LABELS];
  }, []);
  const stages = useMemo(() => [...new Set([
    ...dashboardStages,
    ...Object.keys(DASHBOARD_STAGE_GROUPS),
  ])].sort(), [dashboardStages]);

  const visibleApplicants = useMemo(() => {
    const query = search.trim().toLowerCase();
    const selectedRole = roleOptions.find((role) => role.value === roleFilter);
    return activeApplicants.filter((applicant) => {
      const applicantRole = applicant.selectedRole || applicant.roleId;
      const searchable = `${applicant.applicationId} ${applicant.candidateName} ${applicant.email} ${applicant.roleId} ${applicant.selectedRole} ${applicant.department}`.toLowerCase();
      const normalizedResumeStatus = applicant.resumeStatus.trim().toLowerCase();
      const isScreened = ["screened", "processed", "for hr review", "pending hr review"].includes(normalizedResumeStatus);
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
        matchesDashboardStageFilter(applicant, stageFilter) &&
        (resumeFilter === "All resume statuses" || (resumeFilter === "Screened" ? isScreened : !isScreened)) &&
        (interviewTypeFilter === "All interview types" || (interviewTypeFilter === "Voice Interview" ? applicant.interviewMode === "voice" : interviewTypeFilter === "Live Avatar Interview" ? applicant.interviewMode === "avatar" : applicant.interviewMode === "pending"));
    }).sort((left, right) => {
      if (sortFilter === "Oldest first") return applicantSortTimestamp(left) - applicantSortTimestamp(right);
      if (sortFilter === "Highest match") return (numericMatchScore(right.matchScore) ?? -1) - (numericMatchScore(left.matchScore) ?? -1) || applicantSortTimestamp(right) - applicantSortTimestamp(left);
      const dateDifference = applicantSortTimestamp(right) - applicantSortTimestamp(left);
      if (dateDifference !== 0) return dateDifference;
      // Keep ordering deterministic when multiple applications share the same
      // date-only value.
      return right.applicationId.localeCompare(left.applicationId);
    });
  }, [activeApplicants, interviewTypeFilter, resumeFilter, roleFilter, roleOptions, search, sortFilter, stageFilter]);

  const totalPages = Math.max(1, Math.ceil(remoteTotal / pageSize));
  // The API already filters, sorts, and pages the rows. Avoid slicing a second time here.
  const pagedApplicants = visibleApplicants;
  const selectableVisibleApplicants = visibleApplicants.filter((applicant) => !applicant.isHistoricalDemo);
  const selectedApplicants = activeApplicants.filter((applicant) => !applicant.isHistoricalDemo && selectedIds.has(applicant.applicationId));
  const allVisibleSelected = canManageApplicants && selectableVisibleApplicants.length > 0 && selectableVisibleApplicants.every((applicant) => selectedIds.has(applicant.applicationId));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const previousApplicantIds = useRef<Set<string> | null>(null);

  // Return HR to page one only when a genuinely new application arrives.
  // Background screening refreshes also replace the applicants array, but
  // they must not interrupt pagination while HR is reviewing another page.
  useEffect(() => {
    // The endpoint returns one page at a time. Only compare page-one snapshots
    // so ordinary pagination does not look like a wave of new applications.
    if (page !== 1) return;
    const currentApplicantIds = new Set(applicants.map((applicant) => applicant.applicationId.trim()).filter(Boolean));
    const previousIds = previousApplicantIds.current;
    previousApplicantIds.current = currentApplicantIds;
    if (!previousIds) return;
    if ([...currentApplicantIds].some((applicationId) => !previousIds.has(applicationId))) setPage(1);
  }, [applicants, page]);

  const interviewActivityStages = new Set(["voice_booking_pending", "voice_scheduled", "voice_review_pending", "approved_for_final", "final_scheduled", "final_decision_pending", "passed_final"]);
  const hasInterviewActivity = (applicant: ApplicantSummary) => interviewActivityStages.has(applicant.currentStage.trim().toLowerCase()) || Boolean(applicant.voiceStatus.trim());
  const finalInterviewCount = activeApplicants.filter((applicant) => applicant.finalInterviewStatus && applicant.finalInterviewStatus.toLowerCase() !== "pending").length;
  const summaryTotal = metricsData?.total ?? remoteTotal;
  const summaryScreened = metricsData?.screened ?? activeApplicants.filter((applicant) => applicant.resumeStatus.trim().toLowerCase() === "processed").length;
  const summaryVoice = metricsData?.voiceInterviews ?? activeApplicants.filter((applicant) => applicant.interviewMode === "voice" && hasInterviewActivity(applicant)).length;
  const summaryAvatar = metricsData?.liveAvatarInterviews ?? activeApplicants.filter((applicant) => applicant.interviewMode === "avatar" && hasInterviewActivity(applicant)).length;
  const summaryHr = metricsData?.hrActivity ?? finalInterviewCount;
  // Keep the pipeline headline aligned with the history-backed summary. Demo
  // history is read-only and appears only after an explicit stage filter.
  const hasApplicantFilters = Boolean(search.trim()) || roleFilter !== "All Roles" || stageFilter !== "All Stages" || resumeFilter !== "All resume statuses" || interviewTypeFilter !== "All interview types" || interviewStatusFilter !== "All interview statuses" || Boolean(dateFrom || dateTo);
  const matchingApplicantCount = remoteTotal;

  function writeListUrl(overrides: Partial<{ page: number; pageSize: number; search: string; role: string; stage: string; resume: string; interview: string; interviewStatus: string; sort: string; from: string; to: string }> = {}) {
    const values = {
      page: overrides.page ?? page,
      pageSize: overrides.pageSize ?? pageSize,
      search: overrides.search ?? search,
      role: overrides.role ?? roleFilter,
      stage: overrides.stage ?? stageFilter,
      resume: overrides.resume ?? resumeFilter,
      interview: overrides.interview ?? interviewTypeFilter,
      interviewStatus: overrides.interviewStatus ?? interviewStatusFilter,
      sort: overrides.sort ?? sortFilter,
      from: overrides.from ?? dateFrom,
      to: overrides.to ?? dateTo,
    };
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      const fallback = key === "page" ? 1 : key === "pageSize" ? 25 : key === "role" ? "All Roles" : key === "stage" ? "All Stages" : key === "resume" ? "All resume statuses" : key === "interview" ? "All interview types" : key === "interviewStatus" ? "All interview statuses" : key === "sort" ? "Newest first" : "";
      const storedValue = key === "interviewStatus" && typeof value === "string" ? value.toLowerCase().replaceAll(" ", "_") : key === "sort" && typeof value === "string" ? value === "Oldest first" ? "oldest" : value === "Highest match" ? "match" : "" : value;
      if (value === fallback || value === "") params.delete(key);
      else params.set(key, String(storedValue));
    }
    const nextUrl = params.size ? `${window.location.pathname}?${params}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }

  function applicantDetailHref(applicationId: string) {
    const params = new URLSearchParams();
    if (page !== 1) params.set("page", String(page));
    if (pageSize !== 25) params.set("pageSize", String(pageSize));
    if (search.trim()) params.set("search", search.trim());
    if (roleFilter !== "All Roles") params.set("role", roleFilter);
    if (stageFilter !== "All Stages") params.set("stage", stageFilter);
    if (resumeFilter !== "All resume statuses") params.set("resume", resumeFilter);
    if (interviewTypeFilter !== "All interview types") params.set("interview", interviewTypeFilter);
    if (interviewStatusFilter !== "All interview statuses") params.set("interviewStatus", interviewStatusFilter.toLowerCase().replaceAll(" ", "_"));
    if (sortFilter === "Oldest first") params.set("sort", "oldest");
    if (sortFilter === "Highest match") params.set("sort", "match");
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    // usePathname is safe during server rendering; window is not.
    const currentPath = pathname;
    const returnPath = currentPath.startsWith("/roles/") && currentPath.endsWith("/applicants") ? currentPath : "/applicants";
    const returnTo = params.size ? `${returnPath}?${params}` : returnPath;
    return `/applicants/${encodeURIComponent(applicationId)}?returnTo=${encodeURIComponent(returnTo)}`;
  }

  function refreshApplicants() {
    if (refreshing) return;
    setRefreshing(true);
    manualRefreshPending.current = true;
    setRefreshSequence((sequence) => sequence + 1);
    router.refresh();
  }

  async function deleteApplicants(applicantsToDelete: ApplicantSummary[]) {
    if (applicantsToDelete.length === 0) return;
    const countLabel = applicantsToDelete.length === 1 ? applicantsToDelete[0].candidateName || "this applicant" : `${applicantsToDelete.length} applicants`;
    if (!(await confirm({ title: "Delete applicant record?", message: `Delete ${countLabel}? This removes the applicant, screening evidence, history, and linked interview slots.`, confirmLabel: "Delete", tone: "danger" }))) return;

    // A stale merge or legacy snapshot can contain the same application more
    // than once. Deletes are keyed by application ID, so issue one request per
    // identity or the second request incorrectly reports "Applicant not found".
    const ids = [...new Set(applicantsToDelete.map((applicant) => applicant.applicationId.trim()).filter(Boolean))];
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

  // A new selection means the previous delete outcome no longer applies, so
  // clear the banner instead of leaving a stale error on screen.
  function clearActionFeedback() {
    setActionError("");
    setActionMessage("");
  }

  function toggleApplicantSelection(applicationId: string) {
    clearActionFeedback();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(applicationId)) next.delete(applicationId);
      else next.add(applicationId);
      return next;
    });
  }

  function toggleAllVisibleApplicants() {
    clearActionFeedback();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) selectableVisibleApplicants.forEach((applicant) => next.delete(applicant.applicationId));
      else selectableVisibleApplicants.forEach((applicant) => next.add(applicant.applicationId));
      return next;
    });
  }

  return (
    <>
      <main className="container page applicants-page">
      <div className="hero-row applicants-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="applicants-refresh-controls">
            <span className="live-data-note">Applicant records{lastUpdated ? ` · updated ${formatPortalDateTime(lastUpdated)}` : ""}</span>
            <button type="button" className="btn btn-secondary" disabled={refreshing} aria-busy={refreshing} onClick={refreshApplicants}>{refreshing ? "Refreshing applicants…" : "Refresh applicants"}</button>
          </div>
        </div>
      </div>

      {actionMessage && <ActionFeedback kind="success" className="applicants-action-feedback">{actionMessage}</ActionFeedback>}
      {actionError && <ActionFeedback kind="error" className="applicants-action-feedback" dismissAfterMs={12000}>{actionError}</ActionFeedback>}

      {topContent && <div className="applicants-intake-section">{topContent}</div>}

      <div className="applicant-stat-grid">
        <div className="applicant-stat"><span>Applications</span><strong>{summaryTotal}</strong><small>Matching records in the current view</small></div>
        <div className="applicant-stat"><span>Resumes screened</span><strong>{summaryScreened}</strong><small>Matching records with a completed screening</small></div>
        <div className="applicant-stat"><span>Voice interview activity</span><strong>{summaryVoice}</strong><small>Matching call-interview activity</small></div>
        <div className="applicant-stat"><span>Live Avatar activity</span><strong>{summaryAvatar}</strong><small>Matching Live Avatar activity</small></div>
        <div className="applicant-stat"><span>Face-to-face activity</span><strong>{summaryHr}</strong><small>Matching applicants moved beyond interview screening</small></div>
      </div>

      <section className="card applicants-card" aria-busy={recordsLoading}>
        <div className="applicants-toolbar">
          <div><h2>Applicant Pipeline</h2><span>{matchingApplicantCount} matching applicant{matchingApplicantCount === 1 ? "" : "s"}</span></div>
          {canManageApplicants && <div className="bulk-selection-toolbar"><span>{selectedApplicants.length} selected</span><button type="button" className="btn btn-danger-outline" disabled={selectedApplicants.length === 0 || deletingId !== ""} onClick={() => void deleteApplicants(selectedApplicants)}>Delete selected</button></div>}
          <div className="applicants-filters">
            <input aria-label="Search applicants" placeholder="Search candidate, email, role, or application reference" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); writeListUrl({ search: event.target.value, page: 1 }); }} />
            <select aria-label="Filter by role" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPage(1); writeListUrl({ role: event.target.value, page: 1 }); }}><option>All Roles</option>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select>
            <select aria-label="Filter by application status" value={stageFilter} onChange={(event) => { setStageFilter(event.target.value); setPage(1); writeListUrl({ stage: event.target.value, page: 1 }); }}><option>All Stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select>
            <select aria-label="Filter by resume screening status" value={resumeFilter} onChange={(event) => { setResumeFilter(event.target.value); setPage(1); writeListUrl({ resume: event.target.value, page: 1 }); }}><option>All resume statuses</option><option>Screened</option><option>Awaiting screening</option></select>
            <select aria-label="Filter by interview type" value={interviewTypeFilter} onChange={(event) => { setInterviewTypeFilter(event.target.value); setPage(1); writeListUrl({ interview: event.target.value, page: 1 }); }}><option>All interview types</option><option>Voice Interview</option><option>Live Avatar Interview</option><option>Not selected</option></select>
            <select aria-label="Filter by interview status" value={interviewStatusFilter} onChange={(event) => { setInterviewStatusFilter(event.target.value); setPage(1); writeListUrl({ interviewStatus: event.target.value, page: 1 }); }}><option>All interview statuses</option><option value="not_started">Not started</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="awaiting_review">Awaiting review</option><option value="review_complete">Review complete</option></select>
            <select aria-label="Sort applicants" value={sortFilter} onChange={(event) => { setSortFilter(event.target.value); setPage(1); writeListUrl({ sort: event.target.value, page: 1 }); }}><option>Newest first</option><option>Oldest first</option><option>Highest match</option></select>
            <label className="field applicant-date-filter"><span>Applied from</span><input aria-label="Applied from date" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); writeListUrl({ from: event.target.value, page: 1 }); }} /></label>
            <label className="field applicant-date-filter"><span>Applied to</span><input aria-label="Applied to date" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); writeListUrl({ to: event.target.value, page: 1 }); }} /></label>
            <label className="pagination-size-control">Rows
              <select aria-label="Applicants per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                <option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option>
              </select>
            </label>
          </div>
        </div>

        {hasApplicantFilters && <div className="applicants-active-filters" aria-label="Active filters">
          {search.trim() && <span>Search: {search.trim()}</span>}
          {roleFilter !== "All Roles" && <span>Role: {roleOptions.find((role) => role.value === roleFilter)?.label || roleFilter}</span>}
          {stageFilter !== "All Stages" && <span>Stage: {stageFilter}</span>}
          {resumeFilter !== "All resume statuses" && <span>Resume: {resumeFilter}</span>}
          {interviewTypeFilter !== "All interview types" && <span>Interview: {interviewTypeFilter}</span>}
          {interviewStatusFilter !== "All interview statuses" && <span>Interview status: {INTERVIEW_STATUS_LABELS[interviewStatusFilter] || interviewStatusFilter}</span>}
          {dateFrom && <span>From: {dateFrom}</span>}{dateTo && <span>To: {dateTo}</span>}
          <button type="button" className="bulk-screening-link-button" onClick={() => {
            setSearch(""); setRoleFilter("All Roles"); setStageFilter("All Stages"); setResumeFilter("All resume statuses"); setInterviewTypeFilter("All interview types"); setInterviewStatusFilter("All interview statuses"); setDateFrom(""); setDateTo(""); setPage(1);
            writeListUrl({ search: "", role: "All Roles", stage: "All Stages", resume: "All resume statuses", interview: "All interview types", interviewStatus: "All interview statuses", from: "", to: "", page: 1 });
          }}>Clear all filters</button>
        </div>}

        {recordsLoading && <p className="applicants-loading-note" role="status" aria-live="polite">Refreshing applicant records…</p>}
        {visibleApplicants.length === 0 ? (
          <div className="empty">No applicants match the current filters.</div>
        ) : (
          <div className="table-wrap">
            <table className="applicants-table">
              <thead><tr>{canManageApplicants && <th className="selection-column"><input type="checkbox" aria-label="Select all visible applicants" checked={allVisibleSelected} disabled={selectableVisibleApplicants.length === 0} onChange={toggleAllVisibleApplicants} /></th>}<th>Candidate</th><th>Role</th><th>Applied</th><th>Interview type</th><th>Match</th><th>Current status</th><th>Next action</th><th>Action</th></tr></thead>
              <tbody>
                {pagedApplicants.map((applicant, index) => (
                  <tr key={`${applicant.applicationId || "applicant"}-${applicant.roleId || "role"}-${index}`} className={[selectedIds.has(applicant.applicationId) ? "is-selected" : "", newApplicantIds.has(applicant.applicationId) ? "is-new-applicant" : ""].filter(Boolean).join(" ") || undefined}>
                    {canManageApplicants && <td className="selection-column">{applicant.isHistoricalDemo ? <span className="applicant-readonly-label">Demo</span> : <input type="checkbox" aria-label={`Select ${applicant.candidateName || applicant.applicationId}`} checked={selectedIds.has(applicant.applicationId)} disabled={deletingIds.has(applicant.applicationId)} onChange={() => toggleApplicantSelection(applicant.applicationId)} />}</td>}
                    {/* data-label values let the responsive CSS render each row as a
                        labeled card when the table cannot fit the content column. */}
                    <td data-label="Candidate"><Link className="applicant-name-link" href={applicantDetailHref(applicant.applicationId)}><strong>{applicant.candidateName || "Unnamed candidate"}{newApplicantIds.has(applicant.applicationId) && <span className="applicant-new-badge">NEW</span>}</strong><span>{applicant.email || "Email not provided"}</span></Link></td>
                    <td data-label="Role"><strong>{applicant.selectedRole || "Role not provided"}</strong><span className="applicant-subtext">{applicant.roleId || "Role reference not available"}</span></td>
                    <td data-label="Applied">{applicant.appliedAt ? formatDate(applicant.appliedAt) : "Date not provided"}</td>
                    <td data-label="Interview type">{applicant.interviewMode === "pending" ? "Not selected" : applicant.interviewMode === "avatar" ? "Live Avatar Interview" : "Voice Interview"}</td>
                    <td data-label="Match"><strong className="applicant-score">{scoreValue(applicant.matchScore)}</strong>{applicant.recommendation && <span className="applicant-subtext">{applicant.recommendation}</span>}</td>
                    <td data-label="Current stage"><span className={stageClass(applicant.currentStage)}>{applicantStageLabel(applicant.currentStage, applicant.interviewMode) || "Pending HR Review"}</span></td>
                    <td data-label="Next action">{applicant.nextAction || "No next action available"}</td>
                    <td data-label="Action"><div className="applicant-table-actions"><Link href={applicantDetailHref(applicant.applicationId)}>View</Link>{canManageApplicants && !applicant.isHistoricalDemo && <><Link href={`/applicants/${encodeURIComponent(applicant.applicationId)}/edit`}>Edit</Link><button type="button" className="table-danger-action" disabled={deletingIds.has(applicant.applicationId) || deletingId === "bulk"} onClick={() => void deleteApplicants([applicant])}>{deletingIds.has(applicant.applicationId) ? "Deleting..." : "Delete"}</button></>}{applicant.isHistoricalDemo && <span className="applicant-readonly-label">Read-only demo history</span>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {remoteTotal > 0 && <Pagination page={page} totalPages={totalPages} totalItems={remoteTotal} displayTotalItems={matchingApplicantCount} pageSize={pageSize} pageSizeOptions={[10, 25, 50, 100]} onPageChange={(nextPage) => { setPage(nextPage); writeListUrl({ page: nextPage }); }} onPageSizeChange={(nextSize) => { setPageSize(nextSize); setPage(1); writeListUrl({ pageSize: nextSize, page: 1 }); }} />}
      </section>
      </main>
    </>
  );
}
