"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import { useConfirmation } from "@/components/ConfirmationModal";
import { DEPARTMENT_OPTIONS, isKnownDepartment } from "@/lib/department-options";
import ValidationSummary, { type ValidationIssue } from "@/components/ValidationSummary";
import { ACCESS_ROLE_OPTIONS, getAccessRolePreset } from "@/lib/access-roles";

type DirectoryUser = {
  email: string;
  fullName: string;
  accessRole: string;
  department: string;
  canCreateRole: boolean;
  canReviewRole: boolean;
  canApproveRole: boolean;
  canEditSettings: boolean;
  canManageUsers: boolean;
  canReviewDepartmentRole: boolean;
  active: boolean;
};

type AccountForm = DirectoryUser;

type Organization = {
  id: string;
  name: string;
  slug: string;
  databaseKey: string;
  databaseStatus: string;
  active: boolean;
};

type OrganizationForm = {
  id?: string;
  name: string;
  slug: string;
  active: boolean;
};

const emptyForm: AccountForm = {
  email: "",
  fullName: "",
  accessRole: "HR",
  department: "",
  canCreateRole: false,
  canReviewRole: true,
  canApproveRole: false,
  canEditSettings: false,
  canManageUsers: false,
  canReviewDepartmentRole: false,
  active: true,
};

const emptyOrganizationForm: OrganizationForm = { name: "", slug: "", active: true };
const DEFAULT_ORG_ID = "00000000-0000-4000-8000-000000000001";

const accountFieldLabels: Record<string, string> = {
  fullName: "Full name",
  email: "Email address",
  accessRole: "Access role",
};

const accountFieldAnchors: Record<string, string> = {
  fullName: "#user-full-name",
  email: "#user-email",
  accessRole: "#user-access-role",
};

function permissionLabels(user: DirectoryUser) {
  return [
    user.canCreateRole && "Create roles",
    user.canReviewRole && "Review roles",
    user.canReviewDepartmentRole && "Review own department",
    user.canApproveRole && "Approve roles",
    user.canEditSettings && "Edit settings",
    user.canManageUsers && "Manage users",
  ].filter(Boolean).join(" · ") || "No elevated permissions";
}

export default function UserAccountsEditor({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [originalEmail, setOriginalEmail] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [canManageOrganizations, setCanManageOrganizations] = useState(false);
  const [organizationForm, setOrganizationForm] = useState<OrganizationForm>(emptyOrganizationForm);
  const [showOrganizationForm, setShowOrganizationForm] = useState(false);
  const [organizationLoading, setOrganizationLoading] = useState(true);
  const [organizationSaving, setOrganizationSaving] = useState(false);
  const [organizationError, setOrganizationError] = useState("");
  const [organizationMessage, setOrganizationMessage] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(DEFAULT_ORG_ID);

  async function loadUsers(organizationId = selectedOrganizationId) {
    setLoading(true);
    setError("");
    try {
      const query = canManageOrganizations && organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
      const response = await fetch(`/api/user-directory${query}`, { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load user accounts.");
      setUsers(data.users || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load user accounts.");
    } finally {
      setLoading(false);
    }
  }

  async function loadOrganizations() {
    setOrganizationLoading(true);
    try {
      const response = await fetch("/api/organizations", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 403) {
        setCanManageOrganizations(false);
        return;
      }
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load organizations.");
      setOrganizations(data.organizations || []);
      setCanManageOrganizations(true);
      if (!data.organizations?.some((organization: Organization) => organization.id === selectedOrganizationId)) setSelectedOrganizationId(data.organizations?.[0]?.id || DEFAULT_ORG_ID);
      setOrganizationError("");
    } catch (loadError) {
      setCanManageOrganizations(false);
      setOrganizationError(loadError instanceof Error ? loadError.message : "Unable to load organizations.");
    } finally {
      setOrganizationLoading(false);
    }
  }

  // These loaders intentionally run once on mount; later organization changes
  // invoke loadUsers with the selected organization explicitly.
  useEffect(() => { void loadUsers(); void loadOrganizations(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = useMemo(() => users.filter((user) => user.active).length, [users]);
  const adminCount = useMemo(() => users.filter((user) => user.canEditSettings && user.active).length, [users]);
  const editingOrganization = useMemo(() => organizations.find((organization) => organization.id === organizationForm.id), [organizations, organizationForm.id]);
  const organizationSlugLocked = Boolean(editingOrganization && editingOrganization.databaseStatus !== "pending");

  function openNewForm() {
    setOriginalEmail("");
    setForm(emptyForm);
    setError("");
    setMessage("");
    setSaveError("");
    setFieldErrors({});
    setShowForm(true);
  }

  function openNewOrganizationForm() {
    setOrganizationForm(emptyOrganizationForm);
    setOrganizationError("");
    setOrganizationMessage("");
    setShowOrganizationForm(true);
  }

  function openEditOrganizationForm(organization: Organization) {
    setOrganizationForm({ id: organization.id, name: organization.name, slug: organization.slug, active: organization.active });
    setOrganizationError("");
    setOrganizationMessage("");
    setShowOrganizationForm(true);
  }

  function closeOrganizationForm() {
    setShowOrganizationForm(false);
    setOrganizationError("");
  }

  function openEditForm(user: DirectoryUser) {
    setOriginalEmail(user.email);
    setForm({ ...user });
    setError("");
    setMessage("");
    setSaveError("");
    setFieldErrors({});
    setShowForm(true);
  }

  function updateForm<Key extends keyof AccountForm>(key: Key, value: AccountForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
    setMessage("");
    setSaveError("");
    setFieldErrors((current) => ({ ...current, [String(key)]: "" }));
  }

  function updateAccessRole(value: string) {
    const preset = getAccessRolePreset(value);
    setForm((current) => ({
      ...current,
      accessRole: value,
      ...(preset ? {
        canCreateRole: preset.canCreateRole,
        canReviewRole: preset.canReviewRole,
        canApproveRole: preset.canApproveRole,
        canEditSettings: preset.canEditSettings,
        canManageUsers: preset.canManageUsers,
        canReviewDepartmentRole: preset.canReviewDepartmentRole,
      } : {}),
    }));
    setError("");
    setMessage("");
    setSaveError("");
    setFieldErrors((current) => ({ ...current, accessRole: "" }));
  }

  function closeForm() {
    setShowForm(false);
    setError("");
    setMessage("");
    setSaveError("");
    setFieldErrors({});
  }

  useEffect(() => {
    if (!showForm) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeForm();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showForm]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaveError("");
    setFieldErrors({});

    const issues: ValidationIssue[] = [];
    if (!form.fullName.trim()) issues.push({ field: "fullName", label: accountFieldLabels.fullName, message: "Enter the user's full name.", href: accountFieldAnchors.fullName });
    if (!form.email.trim()) issues.push({ field: "email", label: accountFieldLabels.email, message: "Enter an email address.", href: accountFieldAnchors.email });
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) issues.push({ field: "email", label: accountFieldLabels.email, message: "Enter a valid email address.", href: accountFieldAnchors.email });
    if (!form.accessRole.trim()) issues.push({ field: "accessRole", label: accountFieldLabels.accessRole, message: "Enter an access role.", href: accountFieldAnchors.accessRole });
    if (issues.length > 0) {
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field || issue.label, issue.message])));
      setSaveError("Please correct the highlighted fields before saving.");
      return;
    }

    setSaving(true);
    try {
      const params = new URLSearchParams();
      if (originalEmail) params.set("originalEmail", originalEmail);
      if (canManageOrganizations) params.set("organizationId", selectedOrganizationId);
      const endpoint = `/api/user-directory${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(endpoint, {
        method: originalEmail ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to save the user account.");
      setMessage(data.message || "User account saved successfully.");
      setShowForm(false);
      await loadUsers(selectedOrganizationId);
      router.refresh();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Unable to save the user account.");
    } finally {
      setSaving(false);
    }
  }

  async function saveOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = organizationForm.name.trim();
    const slug = organizationForm.slug.trim().toLowerCase();
    if (name.length < 2 || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      setOrganizationError("Enter a name and a slug using 2–63 lowercase letters, numbers, or hyphens.");
      return;
    }
    setOrganizationSaving(true);
    setOrganizationError("");
    setOrganizationMessage("");
    try {
      const response = await fetch(organizationForm.id ? `/api/organizations?id=${encodeURIComponent(organizationForm.id)}` : "/api/organizations", {
        method: organizationForm.id ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, active: organizationForm.active }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to save the organization.");
      setOrganizationMessage(data.message || "Organization saved.");
      setShowOrganizationForm(false);
      await loadOrganizations();
      router.refresh();
    } catch (caught) {
      setOrganizationError(caught instanceof Error ? caught.message : "Unable to save the organization.");
    } finally {
      setOrganizationSaving(false);
    }
  }

  async function toggleActive(user: DirectoryUser) {
    if (user.email === currentEmail.trim().toLowerCase()) return;
    const action = user.active ? "deactivate" : "reactivate";
    if (!(await confirm({ title: `${action === "deactivate" ? "Deactivate" : "Reactivate"} user account?`, message: `Are you sure you want to ${action} ${user.fullName || user.email}?`, confirmLabel: action === "deactivate" ? "Deactivate" : "Reactivate", tone: action === "deactivate" ? "danger" : "primary" }))) return;
    setError("");
    setMessage("");
    try {
      const params = new URLSearchParams({ originalEmail: user.email });
      if (canManageOrganizations) params.set("organizationId", selectedOrganizationId);
      const response = await fetch(`/api/user-directory?${params.toString()}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...user, active: !user.active }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || `Unable to ${action} the account.`);
      setMessage(user.active ? "User account deactivated." : "User account reactivated.");
      await loadUsers(selectedOrganizationId);
      router.refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : `Unable to ${action} the account.`);
    }
  }

  return (
    <main className="container page user-accounts-page">
      <header className="hero-row user-accounts-header">
        <div>
          <span className="eyebrow-dark">ACCESS ADMINISTRATION</span>
          <h1>User Accounts &amp; Roles</h1>
          <p>Manage who can sign in and which recruitment actions each account can perform.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNewForm}>Add user account</button>
      </header>

      <section className="settings-guide user-accounts-guide">
        <span className="settings-guide-icon">i</span>
        <div>
          <strong>User_Directory is the access source of truth</strong>
          <p>Active accounts can sign in. Permission switches control navigation and API actions. Accounts are deactivated instead of deleted so access history is preserved.</p>
        </div>
      </section>

      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
      {saveError && <ValidationSummary error={saveError} title="Save failed" issues={Object.entries(fieldErrors).filter(([, message]) => Boolean(message)).map(([field, message]) => ({ field, label: accountFieldLabels[field] || field, message, href: accountFieldAnchors[field] }))} />}
      {message && <ActionFeedback kind="success">{message}</ActionFeedback>}

      {canManageOrganizations && <section className="card organization-admin-card">
        <div className="card-header"><div><h2>Organizations</h2><p>Organizations define the tenant boundary. New organizations use the shared database with strict organization-level data isolation.</p></div><button type="button" className="btn btn-primary" onClick={openNewOrganizationForm}>Add organization</button></div>
        {organizationError && <ActionFeedback kind="error">{organizationError}</ActionFeedback>}
        {organizationMessage && <ActionFeedback kind="success">{organizationMessage}</ActionFeedback>}
        {showOrganizationForm && <form className="user-account-form organization-form" noValidate onSubmit={(event) => void saveOrganization(event)}>
          <div className="field"><label htmlFor="organization-name">Organization name</label><input id="organization-name" value={organizationForm.name} onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))} required /></div>
          <div className="field"><label htmlFor="organization-slug">Organization slug</label><input id="organization-slug" value={organizationForm.slug} onChange={(event) => setOrganizationForm((current) => ({ ...current, slug: event.target.value }))} disabled={organizationSlugLocked} required /><small className="field-hint">Used as the database key. A provisioned organization cannot change its slug.</small></div>
          <label className="user-account-active"><input type="checkbox" checked={organizationForm.active} onChange={(event) => setOrganizationForm((current) => ({ ...current, active: event.target.checked }))} disabled={organizationForm.id === "00000000-0000-4000-8000-000000000001"} /> Organization is active</label>
          <div className="user-account-form-actions"><button type="button" className="btn btn-secondary" onClick={closeOrganizationForm}>Cancel</button><button type="submit" className="btn btn-primary" disabled={organizationSaving}>{organizationSaving ? "Saving…" : "Save organization"}</button></div>
        </form>}
        {organizationLoading ? <div className="empty">Loading organizations…</div> : organizations.length === 0 ? <div className="empty">No organizations found.</div> : <div className="table-wrap"><table className="user-account-table"><thead><tr><th>Organization</th><th>Database key</th><th>Database status</th><th>Status</th><th>Actions</th></tr></thead><tbody>{organizations.map((organization) => { const shared = organization.databaseStatus === "shared"; const ready = organization.databaseStatus === "ready"; return <tr key={organization.id}><td><strong>{organization.name}</strong><span>{organization.slug}</span></td><td><code>{organization.databaseKey}</code></td><td><span className={`user-account-status ${ready || shared ? "is-active" : "is-inactive"}`}>{ready ? "Physical database" : shared ? "Shared database" : "Pending database"}</span></td><td><span className={`user-account-status ${organization.active ? "is-active" : "is-inactive"}`}>{organization.active ? "Active" : "Inactive"}</span></td><td><button type="button" className="btn btn-secondary btn-small" onClick={() => openEditOrganizationForm(organization)}>Edit</button></td></tr>; })}</tbody></table></div>}
        <p className="field-hint">Users, roles, applicants, and credits are isolated by organization ID in the shared database. A separate database can be attached later by adding that organization ID to <code>TENANT_DATABASE_URLS</code>.</p>
      </section>}

      <section className="user-account-stats" aria-label="Account summary">
        <div className="stat-card"><span>Total accounts</span><strong>{users.length}</strong></div>
        <div className="stat-card"><span>Active accounts</span><strong>{activeCount}</strong></div>
        <div className="stat-card"><span>Settings administrators</span><strong>{adminCount}</strong></div>
      </section>

      {showForm && <div className="user-account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
        <section className="card user-account-form-card" role="dialog" aria-modal="true" aria-labelledby="user-account-form-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="card-header"><div><h2 id="user-account-form-title">{originalEmail ? "Edit user account" : "Add user account"}</h2><p>Set the account identity, department, and allowed actions.</p></div><button type="button" className="btn btn-secondary" onClick={closeForm}>Cancel</button></div>
          <form className="user-account-form" noValidate onSubmit={(event) => void save(event)}>
            <div className="field"><label htmlFor="user-full-name">Full name</label><input id="user-full-name" value={form.fullName} onChange={(event) => updateForm("fullName", event.target.value)} required aria-invalid={Boolean(fieldErrors.fullName)} />{fieldErrors.fullName && <small className="field-error">{fieldErrors.fullName}</small>}</div>
            <div className="field"><label htmlFor="user-email">Email address</label><input id="user-email" type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} required aria-invalid={Boolean(fieldErrors.email)} />{fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}</div>
            <div className="field"><label htmlFor="user-access-role">Access role</label><select id="user-access-role" value={form.accessRole} onChange={(event) => updateAccessRole(event.target.value)} required aria-invalid={Boolean(fieldErrors.accessRole)}>{form.accessRole && !getAccessRolePreset(form.accessRole) && <option value={form.accessRole}>{form.accessRole} (existing)</option>}{ACCESS_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{getAccessRolePreset(form.accessRole) && <small className="field-hint">{getAccessRolePreset(form.accessRole)?.description} Selecting a role applies recommended permissions; you can adjust them below.</small>}{fieldErrors.accessRole && <small className="field-error">{fieldErrors.accessRole}</small>}</div>
            <div className="field"><label htmlFor="user-department">Department</label><select id="user-department" value={form.department} onChange={(event) => updateForm("department", event.target.value)}><option value="">Select a department</option>{form.department && !isKnownDepartment(form.department) && <option value={form.department}>{form.department} (existing)</option>}{DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}</select></div>
            <fieldset className="user-account-permissions"><legend>Permissions</legend><label><input type="checkbox" checked={form.canCreateRole} onChange={(event) => updateForm("canCreateRole", event.target.checked)} /> Create role requests</label><label><input type="checkbox" checked={form.canReviewRole} onChange={(event) => updateForm("canReviewRole", event.target.checked)} /> Review role requests (company-wide: recruitment setup, applicants, bookings)</label><label><input type="checkbox" checked={form.canReviewDepartmentRole} onChange={(event) => updateForm("canReviewDepartmentRole", event.target.checked)} /> Review own department only (HOD: read-only roles and candidates)</label><label><input type="checkbox" checked={form.canApproveRole} onChange={(event) => updateForm("canApproveRole", event.target.checked)} /> Approve role requests and hiring decisions</label><label><input type="checkbox" checked={form.canEditSettings} onChange={(event) => updateForm("canEditSettings", event.target.checked)} /> Edit settings</label><label><input type="checkbox" checked={form.canManageUsers} onChange={(event) => updateForm("canManageUsers", event.target.checked)} /> Manage user accounts and roles</label></fieldset>
            <label className="user-account-active"><input type="checkbox" checked={form.active} onChange={(event) => updateForm("active", event.target.checked)} /> Account is active</label>
            <div className="user-account-form-actions"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save account"}</button></div>
          </form>
        </section>
      </div>}

      <section className="card user-account-list-card">
        <div className="card-header"><div><h2>Directory accounts</h2><p>{canManageOrganizations ? `Manage accounts for ${organizations.find((organization) => organization.id === selectedOrganizationId)?.name || "the selected organization"}.` : "Manage accounts for your organization."}</p></div><div className="user-account-actions">{canManageOrganizations && organizations.length > 0 && <div className="field"><label htmlFor="user-account-organization">Manage users for</label><select id="user-account-organization" value={selectedOrganizationId} onChange={(event) => { const organizationId = event.target.value; setSelectedOrganizationId(organizationId); setShowForm(false); void loadUsers(organizationId); }}><option value={DEFAULT_ORG_ID}>McLink Group</option>{organizations.filter((organization) => organization.id !== DEFAULT_ORG_ID).map((organization) => <option key={organization.id} value={organization.id} disabled={!organization.active}>{organization.name}{organization.active ? "" : " (inactive)"}</option>)}</select></div>}<button type="button" className="btn btn-secondary" onClick={() => void loadUsers(selectedOrganizationId)} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></div>
        {loading ? <div className="empty">Loading user accounts…</div> : users.length === 0 ? <div className="empty">No user accounts were found.</div> : <div className="table-wrap user-account-table-wrap"><table className="user-account-table"><thead><tr><th>User</th><th>Access role</th><th>Department</th><th>Status</th><th>Permissions</th><th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.email}><td><strong>{user.fullName || "Unnamed user"}</strong><span>{user.email}</span></td><td>{user.accessRole || "—"}</td><td>{user.department || "—"}</td><td><span className={`user-account-status ${user.active ? "is-active" : "is-inactive"}`}>{user.active ? "Active" : "Inactive"}</span></td><td>{permissionLabels(user)}</td><td><div className="user-account-actions"><button type="button" className="btn btn-secondary btn-small" onClick={() => openEditForm(user)}>Edit</button><button type="button" className={`btn btn-small ${user.active ? "btn-danger-outline" : "btn-secondary"}`} onClick={() => void toggleActive(user)} disabled={user.email === currentEmail.trim().toLowerCase()}>{user.active ? "Deactivate" : "Reactivate"}</button></div></td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
