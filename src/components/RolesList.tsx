"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import Pagination from "@/components/Pagination";
import UiIcon from "@/components/UiIcon";
import { canEditRoleRequest } from "@/lib/access-control";
import { formatPortalDateTime } from "@/lib/portal-time";

const statusFilters = [
  "All",
  "Draft",
  "Pending HR Discussion",
  "Returned for Revision",
  "On Hold",
  "Approved",
  "Rejected",
  "Recruitment Setup",
  "Job Posted",
  "Posted",
] as const;

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
  const { confirm } = useConfirmation();
  const [roles, setRoles] = useState<RoleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<(typeof statusFilters)[number]>("All");
  const [department, setDepartment] = useState("");
  const [requester, setRequester] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRoles, setTotalRoles] = useState(0);
  const [deletingRoleId, setDeletingRoleId] = useState("");
  const [deletingRoleIds, setDeletingRoleIds] = useState<Set<string>>(new Set());
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const apiSort = sort === "target-latest" ? "target" : sort;
      const params = new URLSearchParams({ page: String(page), pageSize: "25", sort: apiSort });
      if (statusFilter !== "All") params.set("status", statusFilter);
      if (department.trim()) params.set("department", department.trim());
      if (requester.trim()) params.set("requester", requester.trim());
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/roles?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
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
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalRoles(data.pagination?.total || 0);
    } catch (loadError) {
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
      setLoading(false);
    }
  }, [department, page, requester, search, sort, statusFilter]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const visibleRoles = sort === "target-latest"
    ? [...roles].sort((left, right) => {
        const leftDate = left.targetHiringDate || "0000-00-00";
        const rightDate = right.targetHiringDate || "0000-00-00";
        return rightDate.localeCompare(leftDate);
      })
    : roles;
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
    setStatusFilter("All");
    setDepartment("");
    setRequester("");
    setSearch("");
    setSort("newest");
    setPage(1);
  }

  function statusClass(status: string) {
    return `status-badge status-${status
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}`;
  }

  function formatDate(value: string, includeTime = false) {
    return formatPortalDateTime(value, includeTime);
  }

  function openRole(roleId: string) {
    router.push(`/roles/${encodeURIComponent(roleId)}`);
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

    const ids = rolesToDelete.map((role) => role.roleId);
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

  return (
    <main className="container page">
      <div className="hero-row roles-page-header">
        <div className="roles-page-heading">
          <h1>{creatorOnly ? "My Role Requests" : departmentOnly ? "Department Role Requests" : "All Role Requests"}</h1>

          <p>
            {creatorOnly
              ? "Track the Role Requests You Submitted."
              : departmentOnly
                ? "Review role requests submitted for your department."
                : "Review Submitted Staff Addition and Replacement Requests."}
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
              {loading
                ? "Loading..."
                : `${visibleRoles.length} ${visibleRoles.length === 1 ? "Request" : "Requests"}`}
            </span>
          </div>

          {selectableRoles.length > 0 && <div className="bulk-selection-toolbar"><span>{selectedRoles.length} selected</span><button type="button" className="btn btn-danger-outline" disabled={selectedRoles.length === 0 || deletingRoleId !== ""} onClick={() => void deleteRoles(selectedRoles)}>Delete selected</button></div>}

          {filtersActive && (
            <button type="button" className="btn btn-secondary roles-clear-button" onClick={clearFilters}>
              <UiIcon name="filter" size={16} />Clear Filters
            </button>
          )}
        </div>

        {actionMessage && <ActionFeedback kind="success" className="roles-action-feedback">{actionMessage}</ActionFeedback>}
        {actionError && <ActionFeedback kind="error" className="roles-action-feedback">{actionError}</ActionFeedback>}

        <div className="roles-filter-grid" aria-label="Role request filters">
          <div className="roles-filter-field">
            <label htmlFor="status-filter">Status</label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(
                  event.target.value as (typeof statusFilters)[number],
                );
                setPage(1);
              }}
            >
              {statusFilters.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="roles-filter-field">
            <label htmlFor="job-title-filter">Job Title</label>
            <div className="roles-input-with-icon">
              <UiIcon name="search" size={16} />
              <span aria-hidden="true">⌕</span>
              <input id="job-title-filter" aria-label="Search by job title or role ID" placeholder="Search Job Title" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
            </div>
          </div>

          <div className="roles-filter-field">
            <label htmlFor="department-filter">Department</label>
            <div className="roles-input-with-icon">
              <UiIcon name="search" size={16} />
              <span aria-hidden="true">⌕</span>
              <input id="department-filter" aria-label="Filter by department" placeholder="Search Department" value={department} onChange={(event) => { setDepartment(event.target.value); setPage(1); }} />
            </div>
          </div>

          <div className="roles-filter-field">
            <label htmlFor="requester-filter">Requester</label>
            <div className="roles-input-with-icon">
              <UiIcon name="search" size={16} />
              <span aria-hidden="true">⌕</span>
              <input id="requester-filter" aria-label="Filter by requester" placeholder="Search Requester" value={requester} onChange={(event) => { setRequester(event.target.value); setPage(1); }} />
            </div>
          </div>

          <div className="roles-filter-field">
            <label htmlFor="sort-filter">Sort By</label>
            <select id="sort-filter" aria-label="Sort role requests" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="target">Target Date: Earliest</option>
              <option value="target-latest">Target Date: Latest</option>
            </select>
          </div>
        </div>

        {loading && (
          <div className="roles-table-skeleton" aria-label="Loading role requests" role="status">
            {Array.from({ length: 5 }, (_, index) => <div className="roles-skeleton-row" key={index}><span /><span /><span /><span /><span /></div>)}
          </div>
        )}

        {!loading && error && (
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

        {!loading &&
          !error &&
          visibleRoles.length === 0 && (
            <div className="empty">
                No role requests match the current filters.
            </div>
          )}

        {!loading &&
          !error &&
          visibleRoles.length > 0 && (
            <div className="table-wrap">
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
                      tabIndex={0}
                      role="link"
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("a,button,input,label")) return;
                        openRole(role.roleId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openRole(role.roleId);
                        }
                      }}
                    >
                      <td className="selection-column"><input type="checkbox" aria-label={`Select ${role.jobTitle || role.roleId}`} checked={selectedRoleIds.has(role.roleId)} disabled={!canEditRole(role) || deletingRoleIds.has(role.roleId)} onChange={() => toggleRoleSelection(role.roleId)} /></td>
                      <td className="roles-column-role">
                        <Link className="roles-role-link" href={`/roles/${encodeURIComponent(role.roleId)}`}>
                          <strong>{role.jobTitle || "Not provided"}</strong>
                          <span>{role.roleId}</span>
                        </Link>
                      </td>
                      <td>
                        {role.department || "Not provided"}
                      </td>
                      <td>
                        {role.requestType || "Not provided"}
                      </td>
                      <td>{role.numberOfVacancies}</td>
                      <td>
                        {role.requesterName || "Not provided"}
                      </td>
                      <td>
                        {formatDate(role.createdAt, true)}
                      </td>
                      <td>{formatDate(role.targetHiringDate)}</td>
                      <td>
                        <span className={statusClass(role.status)}>
                          {role.status || "Submitted"}
                        </span>
                      </td>
                      <td><div className="role-table-actions"><Link href={`/roles/${encodeURIComponent(role.roleId)}`}>View</Link>{canEditRole(role) && <><Link href={`/roles/${encodeURIComponent(role.roleId)}/edit`}>Edit</Link><button type="button" className="table-danger-action" disabled={deletingRoleIds.has(role.roleId) || deletingRoleId === "bulk"} onClick={() => void deleteRoles([role])}>{deletingRoleIds.has(role.roleId) ? "Deleting..." : "Delete"}</button></>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {!loading && !error && totalRoles > 0 && <Pagination page={page} totalPages={totalPages} totalItems={totalRoles} pageSize={25} onPageChange={setPage} />}
      </section>
    </main>
  );
}
