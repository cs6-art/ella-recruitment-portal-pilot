"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import Pagination from "@/components/Pagination";
import UiIcon from "@/components/UiIcon";
import { canEditRoleRequest } from "@/lib/access-control";
import { formatPortalDateTime } from "@/lib/portal-time";

const statusFilters = [
  { value: "All", label: "All statuses" },
  { value: "Draft", label: "Draft" },
  { value: "Pending HR Discussion", label: "Pending HR review" },
  { value: "Approved", label: "Approved" },
  { value: "Rejected", label: "Rejected" },
  { value: "Recruitment Setup", label: "Recruitment setup" },
  { value: "Job Posted", label: "Job posted" },
  { value: "Posted", label: "Posted" },
] as const;

const sortOptions = ["newest", "oldest", "target", "target-latest"] as const;
const pageSizeOptions = [10, 25, 50] as const;
const defaultPageSize = 10;
type StatusFilter = (typeof statusFilters)[number]["value"];
type SortOption = (typeof sortOptions)[number];

type RoleListQuery = {
  statusFilter: StatusFilter;
  department: string;
  requester: string;
  search: string;
  sort: SortOption;
  page: number;
  pageSize: number;
};

type SearchParamReader = {
  get: (name: string) => string | null;
  toString: () => string;
};

function statusFilterValue(value: string | null): StatusFilter {
  return statusFilters.some((option) => option.value === value)
    ? value as StatusFilter
    : "All";
}

function sortValue(value: string | null): SortOption {
  return sortOptions.includes(value as SortOption) ? value as SortOption : "newest";
}

function pageSizeValue(value: string | null) {
  const parsed = Number(value);
  return pageSizeOptions.includes(parsed as (typeof pageSizeOptions)[number]) ? parsed : defaultPageSize;
}

function readListQuery(params: SearchParamReader): RoleListQuery {
  return {
    statusFilter: statusFilterValue(params.get("status")),
    department: params.get("department")?.trim() || "",
    requester: params.get("requester")?.trim() || "",
    search: params.get("search")?.trim() || "",
    sort: sortValue(params.get("sort")),
    page: Math.max(1, Number(params.get("page") || "1") || 1),
    pageSize: pageSizeValue(params.get("pageSize")),
  };
}

function queryString(query: RoleListQuery) {
  const params = new URLSearchParams();
  if (query.statusFilter !== "All") params.set("status", query.statusFilter);
  if (query.search) params.set("search", query.search);
  if (query.department) params.set("department", query.department);
  if (query.requester) params.set("requester", query.requester);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.pageSize !== defaultPageSize) params.set("pageSize", String(query.pageSize));
  return params.toString();
}

function optionLabel(options: readonly { value: string; label: string }[], value: string) {
  return options.find((option) => option.value === value)?.label || value;
}

type RoleRequest = {
  roleId: string;
  createdAt: string;
  requesterName: string;
  requesterEmail: string;
  department: string;
  requestType: string;
  jobTitle: string;
  numberOfVacancies: number;
  status: string;
  latestComments: string;
  targetHiringDate: string;
};

type RolesApiResponse = {
  success?: boolean;
  roles?: RoleRequest[];
  error?: string;
  pagination?: { page: number; pageSize: number; totalPages: number; total: number };
};

type RolesListProps = {
  canCreateRole: boolean;
  creatorOnly: boolean;
  // HOD-tier: view-only, scoped to the user's own department (not just their
  // own requests, and not the whole company). Distinct from creatorOnly.
  departmentOnly?: boolean;
  userEmail: string;
  canReviewRole: boolean;
  canApproveRole: boolean;
};

export default function RolesList({
  canCreateRole,
  creatorOnly,
  departmentOnly = false,
  userEmail,
  canReviewRole,
  canApproveRole,
}: RolesListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useConfirmation();
  const initialQueryRef = useRef<RoleListQuery | null>(null);
  if (!initialQueryRef.current) initialQueryRef.current = readListQuery(searchParams);
  const initialQuery = initialQueryRef.current;
  const queryStateRef = useRef(initialQuery);
  const lastWrittenQueryRef = useRef(searchParams.toString());
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const [roles, setRoles] = useState<RoleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queryState, setQueryState] = useState<RoleListQuery>(initialQuery);
  const [searchDraft, setSearchDraft] = useState(initialQuery.search);
  const [departmentDraft, setDepartmentDraft] = useState(initialQuery.department);
  const [requesterDraft, setRequesterDraft] = useState(initialQuery.requester);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRoles, setTotalRoles] = useState(0);
  const [deletingRoleId, setDeletingRoleId] = useState("");
  const [deletingRoleIds, setDeletingRoleIds] = useState<Set<string>>(new Set());
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const { statusFilter, department, requester, search, sort, page, pageSize } = queryState;

  const writeListUrl = useCallback((nextQuery: RoleListQuery) => {
    const nextQueryString = queryString(nextQuery);
    lastWrittenQueryRef.current = nextQueryString;
    router.replace(nextQueryString ? `/roles?${nextQueryString}` : "/roles", { scroll: false });
  }, [router]);

  const updateQuery = useCallback((patch: Partial<RoleListQuery>) => {
    const nextQuery = { ...queryStateRef.current, ...patch };
    queryStateRef.current = nextQuery;
    setQueryState(nextQuery);
    writeListUrl(nextQuery);
  }, [writeListUrl]);

  useEffect(() => {
    const serializedParams = searchParams.toString();
    if (serializedParams === lastWrittenQueryRef.current) return;
    const nextQuery = readListQuery(searchParams);
    lastWrittenQueryRef.current = serializedParams;
    queryStateRef.current = nextQuery;
    setQueryState(nextQuery);
    setSearchDraft(nextQuery.search);
    setDepartmentDraft(nextQuery.department);
    setRequesterDraft(nextQuery.requester);
  }, [searchParams]);

  useEffect(() => {
    if (
      searchDraft === search &&
      departmentDraft === department &&
      requesterDraft === requester
    ) return;
    const timeoutId = window.setTimeout(() => {
      updateQuery({
        search: searchDraft.trim(),
        department: departmentDraft.trim(),
        requester: requesterDraft.trim(),
        page: 1,
      });
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [department, departmentDraft, requester, requesterDraft, search, searchDraft, updateQuery]);

  const loadRoles = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort });
      if (statusFilter !== "All") params.set("status", statusFilter);
      if (department.trim()) params.set("department", department.trim());
      if (requester.trim()) params.set("requester", requester.trim());
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/roles?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });

      const rawResponse = await response.text();

      let data: RolesApiResponse;

      try {
        data = rawResponse
          ? JSON.parse(rawResponse)
          : {
              success: false,
              error: "The server returned an empty response.",
            };
      } catch {
        throw new Error(
          `The server returned invalid JSON. Status: ${response.status}`,
        );
      }

      if (!response.ok || data.success !== true) {
        throw new Error(
          data.error || "Unable to load role requests.",
        );
      }

      setRoles(
        Array.isArray(data.roles)
          ? data.roles
          : [],
      );
      setSelectedRoleIds(new Set());
      const nextTotalPages = data.pagination?.totalPages || 1;
      setTotalPages(nextTotalPages);
      setTotalRoles(data.pagination?.total || 0);
      if (page > nextTotalPages) updateQuery({ page: nextTotalPages });
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      if (requestId !== requestIdRef.current) return;
      console.error(
        "[Roles List] Failed to load:",
        loadError,
      );

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load role requests.",
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [department, page, pageSize, requester, search, sort, statusFilter, updateQuery]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    if (searchParams.get("published") !== "1") return;
    setActionMessage("Role published successfully. The published role is now available in the role list.");
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("published");
    const nextQueryString = nextParams.toString();
    lastWrittenQueryRef.current = nextQueryString;
    router.replace(nextQueryString ? `/roles?${nextQueryString}` : "/roles", { scroll: false });
  }, [router, searchParams]);

  const visibleRoles = roles;
  const selectableRoles = visibleRoles.filter((role) => canEditRole(role));
  const selectedRoles = selectableRoles.filter((role) => selectedRoleIds.has(role.roleId));
  const allVisibleRolesSelected = selectableRoles.length > 0 && selectableRoles.every((role) => selectedRoleIds.has(role.roleId));

  const filtersActive =
    statusFilter !== "All" ||
    department.trim() !== "" ||
    requester.trim() !== "" ||
    search.trim() !== "" ||
    sort !== "newest";

  function clearFilters() {
    setSearchDraft("");
    setDepartmentDraft("");
    setRequesterDraft("");
    updateQuery({ statusFilter: "All", department: "", requester: "", search: "", sort: "newest", page: 1 });
  }

  function clearFilter(key: "statusFilter" | "department" | "requester" | "search" | "sort") {
    if (key === "department") setDepartmentDraft("");
    if (key === "requester") setRequesterDraft("");
    if (key === "search") setSearchDraft("");
    updateQuery({ [key]: key === "statusFilter" ? "All" : key === "sort" ? "newest" : "", page: 1 } as Partial<RoleListQuery>);
  }

  function statusClass(status: string) {
    return `status-badge status-${status
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}`;
  }

  function formatDate(value: string, includeTime = false) {
    return formatPortalDateTime(value, includeTime);
  }

  function roleStatusLabel(status: string) {
    const normalized = status.trim().toLowerCase().replace(/[_-]+/g, " ");
    const knownLabels: Record<string, string> = {
      "pending hr discussion": "Pending HR review",
      "recruitment setup": "Recruitment setup",
      "job posted": "Job posted",
    };
    return knownLabels[normalized] || status || "Submitted";
  }

  function targetDateMeta(value: string) {
    const date = value.trim().slice(0, 10);
    if (!date) return { label: "No target date", date: "Not provided", tone: "none" };
    const target = new Date(`${date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const difference = Math.round((target.getTime() - today.getTime()) / 86_400_000);
    if (difference < 0) return { label: "Overdue", date: formatDate(value), tone: "overdue" };
    if (difference === 0) return { label: "Due today", date: formatDate(value), tone: "soon" };
    if (difference <= 3) return { label: `Due in ${difference} days`, date: formatDate(value), tone: "soon" };
    return { label: formatDate(value), date: "", tone: "normal" };
  }

  function canEditRole(role: RoleRequest) {
    return canEditRoleRequest({ email: userEmail, canReviewRole }, role);
  }

  async function deleteRoles(rolesToDelete: RoleRequest[]) {
    if (rolesToDelete.length === 0) return;
    const activeCount = rolesToDelete.filter((role) => ["Approved", "Recruitment Setup", "Job Posted"].includes(role.status.trim())).length;
    const activeWarning = activeCount > 0 ? " This may also remove approved or published roles from the role list." : "";
    const countLabel = rolesToDelete.length === 1 ? rolesToDelete[0].jobTitle || rolesToDelete[0].roleId : `${rolesToDelete.length} role requests`;
    if (!(await confirm({ title: "Delete role requests?", message: `Delete ${countLabel}? These role requests cannot be recovered.${activeWarning}`, confirmLabel: "Delete", tone: "danger" }))) return;

    const ids = [...new Set(rolesToDelete.map((role) => role.roleId.trim()).filter(Boolean))];
    setDeletingRoleId(ids.length === 1 ? ids[0] : "bulk");
    setDeletingRoleIds(new Set(ids));
    setActionError("");
    setActionMessage("");
    const results: PromiseSettledResult<string>[] = [];
    for (const roleId of ids) {
      try {
        const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}`, { method: "DELETE", credentials: "same-origin" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true) throw new Error(data.error || `Unable to delete ${roleId}.`);
        results.push({ status: "fulfilled", value: roleId });
      } catch (error) {
        results.push({ status: "rejected", reason: error });
      }
    }
    const deletedIds = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failedCount = results.length - deletedIds.length;
    if (deletedIds.length > 0) {
      setSelectedRoleIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
      setActionMessage(`${deletedIds.length} role request${deletedIds.length === 1 ? "" : "s"} deleted successfully.${failedCount ? ` ${failedCount} could not be deleted.` : ""}`);
      await loadRoles();
      router.refresh();
    }
    if (failedCount > 0) {
      const firstFailure = results.find((result) => result.status === "rejected");
      setActionError(firstFailure?.status === "rejected" && firstFailure.reason instanceof Error ? firstFailure.reason.message : "Some role requests could not be deleted.");
    }
    setDeletingRoleIds(new Set());
    setDeletingRoleId("");
  }

  function toggleRoleSelection(roleId: string) {
    setSelectedRoleIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  function toggleAllVisibleRoles() {
    setSelectedRoleIds((current) => {
      const next = new Set(current);
      if (allVisibleRolesSelected) selectableRoles.forEach((role) => next.delete(role.roleId));
      else selectableRoles.forEach((role) => next.add(role.roleId));
      return next;
    });
  }

  const activeFilterChips = [
    ...(statusFilter !== "All" ? [{ key: "statusFilter" as const, label: `Status: ${optionLabel(statusFilters, statusFilter)}` }] : []),
    ...(search ? [{ key: "search" as const, label: `Job title or role ID: ${search}` }] : []),
    ...(department ? [{ key: "department" as const, label: `Department: ${department}` }] : []),
    ...(requester ? [{ key: "requester" as const, label: `Requester: ${requester}` }] : []),
    ...(sort !== "newest" ? [{ key: "sort" as const, label: `Sort: ${sort === "oldest" ? "Oldest first" : sort === "target" ? "Target date: earliest" : "Target date: latest"}` }] : []),
  ];

  const initialLoading = loading && roles.length === 0 && !error;
  const refreshing = loading && roles.length > 0;

  return (
    <main className="container page roles-page">
      <div className="hero-row roles-page-header">
        <div className="roles-page-heading">
          <h1>{creatorOnly ? "My Role Requests" : departmentOnly ? "Department Role Requests" : "All Role Requests"}</h1>

          <p>
            {creatorOnly
              ? "Track the role requests you submitted."
              : departmentOnly
                ? "Review role requests submitted for your department."
                : "Review submitted staff addition and replacement requests."}
          </p>
        </div>

        <div className="hero-actions roles-page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="Refresh role requests"
            onClick={() => {
              void loadRoles();
            }}
            disabled={loading}
          >
            <UiIcon name="refresh" size={16} />{loading ? "Refreshing..." : "Refresh"}
          </button>

          {canCreateRole && (
            <Link
              className="btn btn-primary"
              href="/roles/new"
            >
              <UiIcon name="plus" size={17} />Create Role Request
            </Link>
          )}
        </div>
      </div>

      <section className="card">
        <div className="roles-toolbar-header">
          <div className="roles-toolbar-title">
            <h2>Submitted Requests</h2>
            <span className="roles-result-count" aria-live="polite">
              {initialLoading
                ? "Loading requests…"
                : `${totalRoles} ${totalRoles === 1 ? "request" : "requests"}`}
            </span>
            {refreshing && <span className="roles-refreshing" role="status">Updating…</span>}
          </div>

          {selectableRoles.length > 0 && <div className="bulk-selection-toolbar"><span>{selectedRoles.length} selected</span><button type="button" className="btn btn-danger-outline" disabled={selectedRoles.length === 0 || deletingRoleId !== ""} onClick={() => void deleteRoles(selectedRoles)}>Delete selected</button></div>}

          {filtersActive && (
            <button type="button" className="btn btn-secondary roles-clear-button" onClick={clearFilters}>
              <UiIcon name="filter" size={16} />Clear all filters
            </button>
          )}
        </div>

        {actionMessage && <ActionFeedback kind="success" className="roles-action-feedback">{actionMessage}</ActionFeedback>}
        {actionError && <ActionFeedback kind="error" className="roles-action-feedback">{actionError}</ActionFeedback>}

        {activeFilterChips.length > 0 && (
          <div className="roles-active-filters" role="group" aria-label="Active filters">
            <span>Filters:</span>
            {activeFilterChips.map((filter) => (
              <button key={filter.key} type="button" className="roles-filter-chip" onClick={() => clearFilter(filter.key)}>
                {filter.label}<span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}

        <div className="roles-filter-grid" role="group" aria-label="Role request filters">
          <div className="roles-filter-field">
            <label htmlFor="status-filter">Status</label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => updateQuery({ statusFilter: event.target.value as StatusFilter, page: 1 })}
            >
              {statusFilters.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div className="roles-filter-field">
            <label htmlFor="job-title-filter">Job title or role ID</label>
            <div className="roles-input-with-icon">
              <UiIcon name="search" size={16} />
              <input id="job-title-filter" aria-label="Search by job title or role ID" placeholder="Search job title or role ID" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} />
            </div>
          </div>

          <div className="roles-filter-field">
            <label htmlFor="department-filter">Department</label>
            <div className="roles-input-with-icon">
              <UiIcon name="search" size={16} />
              <input id="department-filter" aria-label="Filter by department" placeholder="Search department" value={departmentDraft} onChange={(event) => setDepartmentDraft(event.target.value)} />
            </div>
          </div>

          <div className="roles-filter-field">
            <label htmlFor="requester-filter">Requester</label>
            <div className="roles-input-with-icon">
              <UiIcon name="search" size={16} />
              <input id="requester-filter" aria-label="Filter by requester" placeholder="Search requester" value={requesterDraft} onChange={(event) => setRequesterDraft(event.target.value)} />
            </div>
          </div>

          <div className="roles-filter-field">
            <label htmlFor="sort-filter">Sort by</label>
            <select id="sort-filter" aria-label="Sort role requests" value={sort} onChange={(event) => updateQuery({ sort: event.target.value as SortOption, page: 1 })}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="target">Target date: earliest</option>
              <option value="target-latest">Target date: latest</option>
            </select>
          </div>
        </div>

        {initialLoading && (
          <div className="roles-table-skeleton" aria-label="Loading role requests" role="status">
            {Array.from({ length: 5 }, (_, index) => <div className="roles-skeleton-row" key={index}><span /><span /><span /><span /><span /></div>)}
          </div>
        )}

        {error && roles.length > 0 && (
          <div className="roles-list-error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-secondary" onClick={() => void loadRoles()}>Try again</button>
          </div>
        )}

        {!initialLoading && error && roles.length === 0 && (
          <div className="empty">
            <p>{error}</p>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void loadRoles();
              }}
            >
              Try again
            </button>
          </div>
        )}

        {!initialLoading &&
          !error &&
          visibleRoles.length === 0 && (
            <div className="empty">
              {filtersActive ? <>
                <p>No role requests match the current filters.</p>
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>Clear all filters</button>
              </> : <>
                <p>No role requests have been submitted yet.</p>
                {canCreateRole && <Link className="btn btn-primary" href="/roles/new"><UiIcon name="plus" size={17} />Create Role Request</Link>}
              </>}
            </div>
          )}

        {!initialLoading &&
          visibleRoles.length > 0 && (
            <div className="table-wrap" aria-busy={refreshing}>
              <table className="roles-table">
                <thead>
                  <tr>
                    <th className="selection-column"><input type="checkbox" aria-label="Select all selectable role requests on this page" checked={allVisibleRolesSelected} onChange={toggleAllVisibleRoles} disabled={selectableRoles.length === 0} /></th>
                    <th className="roles-column-role">Role</th>
                    <th>Department</th>
                    <th>Request Type</th>
                    <th>Vacancies</th>
                    <th>Requester</th>
                    <th>Created</th>
                    <th>Target Date</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleRoles.map((role) => (
                    <tr
                      key={role.roleId}
                      className={selectedRoleIds.has(role.roleId) ? "is-selected" : undefined}
                    >
                      <td className="selection-column"><input type="checkbox" aria-label={`Select ${role.jobTitle || role.roleId}`} checked={selectedRoleIds.has(role.roleId)} disabled={!canEditRole(role) || deletingRoleIds.has(role.roleId)} onChange={() => toggleRoleSelection(role.roleId)} /></td>
                      <td className="roles-column-role" data-label="Role">
                        <Link className="roles-role-link" href={`/roles/${encodeURIComponent(role.roleId)}`} aria-label={`View ${role.jobTitle || role.roleId}`}>
                          <strong>{role.jobTitle || "Not provided"}</strong>
                          <span>{role.roleId}</span>
                        </Link>
                      </td>
                      <td data-label="Department">
                        {role.department || "Not provided"}
                      </td>
                      <td data-label="Request type">
                        {role.requestType || "Not provided"}
                      </td>
                      <td data-label="Vacancies">{role.numberOfVacancies}</td>
                      <td data-label="Requester">
                        {role.requesterName || "Not provided"}
                      </td>
                      <td data-label="Created">
                        {formatDate(role.createdAt, true)}
                      </td>
                      <td data-label="Target date">
                        {(() => { const target = targetDateMeta(role.targetHiringDate); return <span className={`role-target-date role-target-date-${target.tone}`}><strong>{target.label}</strong>{target.date && <span>{target.date}</span>}</span>; })()}
                      </td>
                      <td data-label="Status">
                        <span className={statusClass(role.status)}>
                          {roleStatusLabel(role.status)}
                        </span>
                      </td>
                      <td data-label="Action"><div className="role-table-actions"><Link href={`/roles/${encodeURIComponent(role.roleId)}`}>View</Link>{canEditRole(role) && <details className="role-actions-menu"><summary>More <UiIcon name="chevron-down" size={14} /></summary><div><Link href={`/roles/${encodeURIComponent(role.roleId)}/edit`}>Edit</Link><button type="button" className="table-danger-action" disabled={deletingRoleIds.has(role.roleId) || deletingRoleId === "bulk"} onClick={() => void deleteRoles([role])}>{deletingRoleIds.has(role.roleId) ? "Deleting…" : "Delete"}</button></div></details>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {!initialLoading && !error && totalRoles > 0 && <Pagination page={page} totalPages={totalPages} totalItems={totalRoles} pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageChange={(nextPage) => updateQuery({ page: nextPage })} onPageSizeChange={(nextPageSize) => updateQuery({ page: 1, pageSize: nextPageSize })} />}
      </section>
    </main>
  );
}
