"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import PageHeader from "@/components/ui/PageHeader";
import { useConfirmation } from "@/components/ConfirmationModal";
import { DEPARTMENT_OPTIONS, isKnownDepartment } from "@/lib/department-options";
import ValidationSummary, { type ValidationIssue } from "@/components/ValidationSummary";
import { ACCESS_ROLE_OPTIONS, getAccessRolePreset, type AccessRolePermissions } from "@/lib/access-roles";
import { clientErrorMessage } from "@/lib/client-error";

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
  canManageCredits: boolean;
  canReviewDepartmentRole: boolean;
  active: boolean;
  isOrganizationOwner?: boolean;
  deactivatedAt?: string;
  deactivatedBy?: string;
  lastLoginAt?: string;
};

type AccountForm = DirectoryUser;

type Organization = {
  name: string;
  slug: string;
  canEditSlug: boolean;
  active: boolean;
  allowedDomains: string[];
  allowedEmails: string[];
  maxMembers: number | null;
  memberCount?: number;
  readiness: {
    ownerEmail: string;
    ownerStatus: "Registered" | "Awaiting registration";
    creditsAdded: boolean;
    recordingStorageApplicable: boolean;
    recordingStorageReady: boolean;
    googleCalendarApplicable: boolean;
    googleCalendarReady: boolean;
    firstRolePublished: boolean;
    hasRoles: boolean;
    overallStatus: "Setup required" | "Partially configured" | "Ready to recruit";
    onboardingEnabled: boolean;
    brandingConfigured: boolean;
    hasCandidates: boolean;
    hasTeammates: boolean;
    automatedEmailsCustomized: boolean;
  } | null;
};

type OrganizationForm = {
  originalSlug?: string;
  name: string;
  slug: string;
  active: boolean;
  // One entry per line in the form; split into arrays when saving.
  allowedDomains: string;
  allowedEmails: string;
  // Blank means no limit on the number of people.
  maxMembers: string;
};

function splitLines(value: string) {
  return value.split(/[\s,;]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

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
  canManageCredits: false,
  canReviewDepartmentRole: false,
  active: true,
};

const emptyOrganizationForm: OrganizationForm = { name: "", slug: "", active: true, allowedDomains: "", allowedEmails: "", maxMembers: "" };
const DEFAULT_ORG_SLUG = "mclinkgroup";

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

function formatWhen(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function permissionLabels(user: DirectoryUser) {
  return [
    user.canCreateRole && "Create roles",
    user.canReviewRole && "Review roles",
    user.canReviewDepartmentRole && "Review own department",
    user.canApproveRole && "Approve roles",
    user.canEditSettings && "Edit settings",
    user.canManageUsers && "Manage users",
    user.canManageCredits && "Manage Smile Credits",
  ].filter(Boolean).join(" · ") || "No elevated permissions";
}

function StatusChip({ label, value, done }: { label: string; value: string; done: boolean }) {
  return <div className="organization-readiness-detail"><span>{label}</span><strong className={`organization-readiness-badge ${done ? "is-ready" : "is-missing"}`}>{value}</strong></div>;
}

export default function UserAccountsEditor({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  // Owners (and McLink platform administrators) manage the team; other HR accounts can only view it.
  const [canManageTeam, setCanManageTeam] = useState(false);
  // Owners of a client organization invite teammates by email address.
  const [invites, setInvites] = useState<Array<{ email: string; registered: boolean }>>([]);
  const [inviteDomains, setInviteDomains] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteMessageKind, setInviteMessageKind] = useState<"success" | "warning">("success");
  const [inviteAvailable, setInviteAvailable] = useState(false);
  const [inviteLimit, setInviteLimit] = useState<number | null>(null);
  const [inviteUsed, setInviteUsed] = useState(0);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [originalEmail, setOriginalEmail] = useState("");
  const [canEditPermissions, setCanEditPermissions] = useState(false);
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
  const [selectedOrganizationSlug, setSelectedOrganizationSlug] = useState(DEFAULT_ORG_SLUG);
  const [expandedOrganizationSlug, setExpandedOrganizationSlug] = useState("");
  const [organizationMessageKind, setOrganizationMessageKind] = useState<"success" | "warning">("success");

  async function loadUsers(organizationSlug = selectedOrganizationSlug) {
    setLoading(true);
    setError("");
    try {
      const query = canManageOrganizations && organizationSlug ? `?organizationSlug=${encodeURIComponent(organizationSlug)}` : "";
      const response = await fetch(`/api/user-directory${query}`, { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to load user accounts.");
      setUsers(data.users || []);
      setCanManageTeam(data.canManageTeam === true);
      setCanEditPermissions(data.canEditPermissions === true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load user accounts.");
    } finally {
      setLoading(false);
    }
  }

  async function loadInvites() {
    try {
      const response = await fetch("/api/organizations/team-invites", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { setInviteAvailable(false); return; }
      const data = await response.json();
      setInvites(data.invites || []);
      setInviteDomains(data.domains || []);
      setInviteLimit(typeof data.limit === "number" ? data.limit : null);
      setInviteUsed(typeof data.used === "number" ? data.used : 0);
      setInviteAvailable(true);
    } catch {
      setInviteAvailable(false);
    }
  }

  async function sendInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError("");
    setInviteMessage("");
    setInviteMessageKind("success");
    const email = inviteEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setInviteError("Enter a valid email address."); return; }
    setInviteSaving(true);
    try {
      const response = await fetch("/api/organizations/team-invites", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to send the invitation.");
      setInviteMessage(data.message || "Invitation saved.");
      setInviteMessageKind(data.emailSent === false ? "warning" : "success");
      setInviteEmail("");
      await loadInvites();
    } catch (caught) {
      setInviteError(clientErrorMessage(caught, "Unable to send the invitation."));
    } finally {
      setInviteSaving(false);
    }
  }

  async function withdrawInvite(email: string) {
    setInviteError("");
    setInviteMessage("");
    try {
      const response = await fetch(`/api/organizations/team-invites?email=${encodeURIComponent(email)}`, { method: "DELETE", credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to withdraw the invitation.");
      setInviteMessage(data.message || "Invitation withdrawn.");
      await loadInvites();
    } catch (caught) {
      setInviteError(clientErrorMessage(caught, "Unable to withdraw the invitation."));
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
      if (!data.organizations?.some((organization: Organization) => organization.slug === selectedOrganizationSlug)) setSelectedOrganizationSlug(data.organizations?.[0]?.slug || DEFAULT_ORG_SLUG);
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
  useEffect(() => { void loadUsers(); void loadOrganizations(); void loadInvites(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (canManageOrganizations) void loadUsers(selectedOrganizationSlug); }, [canManageOrganizations, selectedOrganizationSlug]);

  const showDepartment = canManageOrganizations || users.some((user) => user.department.trim() !== "");
  const activeCount = useMemo(() => users.filter((user) => user.active).length, [users]);
  const adminCount = useMemo(() => users.filter((user) => user.canEditSettings && user.active).length, [users]);
  const editingOrganization = useMemo(() => organizations.find((organization) => organization.slug === organizationForm.originalSlug), [organizations, organizationForm.originalSlug]);
  const organizationSlugLocked = Boolean(editingOrganization && !editingOrganization.canEditSlug);

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
    setOrganizationForm({ originalSlug: organization.slug, name: organization.name, slug: organization.slug, active: organization.active, allowedDomains: organization.allowedDomains.join("\n"), allowedEmails: organization.allowedEmails.join("\n"), maxMembers: organization.maxMembers == null ? "" : String(organization.maxMembers) });
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

  // Admin is locked to credits-only on the server, so changing any permission
  // of an Admin account moves it to Custom access; otherwise the ticks would
  // be silently discarded on save.
  function updatePermission(key: Exclude<keyof AccessRolePermissions, "canManageUsers">, value: boolean) {
    setForm((current) => ({
      ...current,
      ...(current.accessRole.trim().toLowerCase() === "admin" ? { accessRole: "Custom" } : {}),
      [key]: value,
    }));
    setError("");
    setMessage("");
    setSaveError("");
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
        canManageCredits: preset.canManageCredits,
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
      if (canManageOrganizations) params.set("organizationSlug", selectedOrganizationSlug);
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
      await loadUsers(selectedOrganizationSlug);
      router.refresh();
    } catch (caught) {
      setSaveError(clientErrorMessage(caught, "Unable to save the user account."));
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
    if (!organizationForm.originalSlug && splitLines(organizationForm.allowedDomains).length === 0 && splitLines(organizationForm.allowedEmails).length === 0) {
      setOrganizationError("Add an allowed email domain or at least one email address so the first person can register and become the owner.");
      return;
    }
    const limitText = organizationForm.maxMembers.trim();
    if (limitText && !/^[1-9][0-9]{0,5}$/.test(limitText)) {
      setOrganizationError("Enter the member limit as a whole number of at least 1, or leave it blank for no limit.");
      return;
    }
    setOrganizationSaving(true);
    setOrganizationError("");
    setOrganizationMessage("");
    try {
      const response = await fetch(organizationForm.originalSlug ? `/api/organizations?slug=${encodeURIComponent(organizationForm.originalSlug)}` : "/api/organizations", {
        method: organizationForm.originalSlug ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, active: organizationForm.active, allowedDomains: splitLines(organizationForm.allowedDomains), allowedEmails: splitLines(organizationForm.allowedEmails), maxMembers: limitText ? Number(limitText) : null }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to save the organization.");
      setOrganizationMessage(data.message || "Organization saved.");
      setOrganizationMessageKind("success");
      setShowOrganizationForm(false);
      await loadOrganizations();
      router.refresh();
    } catch (caught) {
      setOrganizationError(clientErrorMessage(caught, "Unable to save the organization."));
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
      if (canManageOrganizations) params.set("organizationSlug", selectedOrganizationSlug);
      const response = await fetch(`/api/user-directory?${params.toString()}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...user, active: !user.active }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || `Unable to ${action} the account.`);
      setMessage(user.active ? "User account deactivated." : "User account reactivated.");
      await loadUsers(selectedOrganizationSlug);
      router.refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : `Unable to ${action} the account.`);
    }
  }

  async function resetRegistration(user: DirectoryUser) {
    if (!canManageOrganizations || user.email === currentEmail.trim().toLowerCase()) return;
    if (!(await confirm({ title: "Reset registration?", message: `This clears ${user.fullName || user.email}'s sign-in credential so they can register again. Their directory access and history will be preserved. Continue?`, confirmLabel: "Reset registration", tone: "danger" }))) return;
    setError("");
    setMessage("");
    try {
      const params = new URLSearchParams({ originalEmail: user.email, organizationSlug: selectedOrganizationSlug });
      const response = await fetch(`/api/user-directory?${params.toString()}`, { method: "DELETE", credentials: "same-origin" });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to reset the registration.");
      setMessage(data.message || "Registration reset. The user can register again.");
      await loadUsers(selectedOrganizationSlug);
      router.refresh();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset the registration.");
    }
  }

  // HR reviewers change roles and permissions of other accounts; nobody changes their own.
  const editingOwnAccount = Boolean(originalEmail) && originalEmail.trim().toLowerCase() === currentEmail.trim().toLowerCase();
  const permissionsLocked = !canEditPermissions || editingOwnAccount;

  return (
    <main className="container page user-accounts-page">
      <PageHeader
        className="user-accounts-header"
        eyebrow={canManageOrganizations ? "ACCESS ADMINISTRATION" : "YOUR TEAM"}
        title={canManageOrganizations ? "User Accounts & Organizations" : "Team Members"}
        description={canManageOrganizations ? "Manage organizations, who may register into each one, and their accounts." : canManageTeam ? "Everyone in your organization has full access. As the organization owner, you can deactivate someone here when they should no longer sign in." : "Everyone in your organization has full access. Only the organization owner can deactivate or reactivate accounts."}
        actions={canManageOrganizations ? <button type="button" className="btn btn-primary" onClick={openNewForm}>Add user account</button> : undefined}
      />

      <section className="settings-guide user-accounts-guide">
        <span className="settings-guide-icon">i</span>
        <div>
          <strong>{canManageOrganizations ? "Registration is automatic" : "How teammates join"}</strong>
          <p>{canManageOrganizations ? "People register themselves with an allowed email domain or address, verify their email, and land in that organization as HR. Add domains and addresses to an organization below. Accounts are deactivated, never deleted, so history is preserved." : "Colleagues join by registering with their organization email address and verifying it. There is nothing to set up: they get access automatically. Deactivated accounts are kept for the audit trail."}</p>
        </div>
      </section>

      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
      {saveError && <ValidationSummary error={saveError} title="Save failed" issues={Object.entries(fieldErrors).filter(([, message]) => Boolean(message)).map(([field, message]) => ({ field, label: accountFieldLabels[field] || field, message, href: accountFieldAnchors[field] }))} />}
      {message && <ActionFeedback kind="success">{message}</ActionFeedback>}

      {canManageOrganizations && <section className="card organization-admin-card">
        <div className="card-header organization-card-header"><div className="organization-card-heading"><h2>Organizations</h2><p>Each organization has its own isolated workspace. Invite people by email for the safest access control, and review setup progress here.</p></div><button type="button" className="btn btn-primary" onClick={openNewOrganizationForm}>Add organization</button></div>
        {organizationError && <ActionFeedback kind="error">{organizationError}</ActionFeedback>}
        {organizationMessage && <ActionFeedback kind={organizationMessageKind}>{organizationMessage}</ActionFeedback>}
        {showOrganizationForm && <form className="user-account-form organization-form" noValidate onSubmit={(event) => void saveOrganization(event)}>
          <div className="field"><label htmlFor="organization-name">Organization name</label><input id="organization-name" value={organizationForm.name} onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))} required /></div>
          <div className="field"><label htmlFor="organization-slug">Organization web address</label><input id="organization-slug" value={organizationForm.slug} onChange={(event) => setOrganizationForm((current) => ({ ...current, slug: event.target.value }))} disabled={organizationSlugLocked} required /><small className="field-hint">A short name used in links. Once an organization is set up, it cannot be changed.</small></div>
          <div className="field"><label htmlFor="organization-domains">Allowed email domains </label><textarea id="organization-domains" rows={2} value={organizationForm.allowedDomains} onChange={(event) => setOrganizationForm((current) => ({ ...current, allowedDomains: event.target.value }))} placeholder="company.com" /><small className="field-hint">Anyone registering with an email at these domains gets HR recruitment access. Add a domain, individual emails, or both.</small></div>
          <div className="organization-domain-warning" role="note"><strong>Owner is automatic:</strong> the first person to register with an allowed email and verify it becomes the organization owner. Domain access gives every person using that domain HR access.</div>
          <div className="field"><label htmlFor="organization-emails">Allowed individual emails</label><textarea id="organization-emails" rows={2} value={organizationForm.allowedEmails} onChange={(event) => setOrganizationForm((current) => ({ ...current, allowedEmails: event.target.value }))} placeholder="name@gmail.com" /><small className="field-hint">One address per line. Inviting a person individually is safer than allowing an entire email domain.</small></div>
          <div className="field"><label htmlFor="organization-max-members">Member limit</label><input id="organization-max-members" inputMode="numeric" value={organizationForm.maxMembers} onChange={(event) => setOrganizationForm((current) => ({ ...current, maxMembers: event.target.value }))} placeholder="No limit" /><p className="field-hint">The most active people this organization can have, including its owner and pending invitations. Organizations that sign up on their own start at 5. Leave blank for no limit.</p></div>
          {organizationForm.originalSlug && <label className="user-account-active"><input type="checkbox" checked={organizationForm.active} onChange={(event) => setOrganizationForm((current) => ({ ...current, active: event.target.checked }))} disabled={organizationForm.originalSlug === DEFAULT_ORG_SLUG} /> Organization is active</label>}
          <div className="user-account-form-actions"><button type="button" className="btn btn-secondary" onClick={closeOrganizationForm}>Cancel</button><button type="submit" className="btn btn-primary" disabled={organizationSaving}>{organizationSaving ? "Creating…" : organizationForm.originalSlug ? "Save organization" : "Create organization"}</button></div>
        </form>}
        {organizationLoading ? <div className="empty">Loading organizations…</div> : organizations.length === 0 ? <div className="empty">No organizations found.</div> : <div className="table-wrap"><table className="user-account-table organization-readiness-table"><thead><tr><th>Organization</th><th>Owner</th><th>Setup status</th><th>Actions</th></tr></thead><tbody>{organizations.map((organization) => {
          const readiness = organization.readiness;
          const expanded = expandedOrganizationSlug === organization.slug;
          const ready = readiness?.overallStatus === "Ready to recruit";
          return <Fragment key={organization.slug}>
            <tr key={organization.slug}>
              <td><strong>{organization.name}</strong><span>{organization.slug}{!organization.active ? " · Inactive" : ""}</span><span>{organization.memberCount ?? 0} {organization.maxMembers == null ? "people · no limit" : `of ${organization.maxMembers} people`}</span></td>
              <td><span className={`organization-readiness-badge ${readiness?.ownerStatus === "Registered" ? "is-ready" : "is-pending"}`}>{readiness?.ownerStatus || "Checking…"}</span><span>{readiness?.ownerEmail || "First registrant becomes owner"}</span></td>
              <td><span className={`organization-readiness-badge ${ready ? "is-ready" : readiness?.overallStatus === "Partially configured" ? "is-pending" : "is-missing"}`}>{readiness?.overallStatus || "Unavailable"}</span></td>
              <td><div className="organization-readiness-actions"><button type="button" className="btn btn-secondary btn-small" aria-expanded={expanded} onClick={() => setExpandedOrganizationSlug(expanded ? "" : organization.slug)}>{expanded ? "Close setup" : ready ? "View setup" : "Continue setup"}</button><button type="button" className="btn btn-secondary btn-small" onClick={() => openEditOrganizationForm(organization)}>Edit</button></div></td>
            </tr>
            {/* Keep the expanded setup row as a table cell so its checklist spans the full organization table. */}
            {expanded && <tr key={`${organization.slug}-details`}><td colSpan={4} className="organization-readiness-details-cell"><div className="organization-readiness-details">
              <StatusChip label="Organization owner" value={readiness?.ownerStatus || "Status unavailable"} done={readiness?.ownerStatus === "Registered"} />
              <StatusChip label="Smile Credits" value={readiness?.creditsAdded ? "Added" : "Not added"} done={readiness?.creditsAdded === true} />
              <StatusChip label="Live Avatar recording storage" value={readiness?.recordingStorageApplicable ? readiness.recordingStorageReady ? "Connected" : "Required" : "Not needed yet"} done={!readiness?.recordingStorageApplicable || readiness?.recordingStorageReady === true} />
              <StatusChip label="Google Calendar" value={readiness?.googleCalendarApplicable ? readiness.googleCalendarReady ? "Connected" : "Required" : "Not needed yet"} done={!readiness?.googleCalendarApplicable || readiness?.googleCalendarReady === true} />
              <StatusChip label="First role" value={readiness?.firstRolePublished ? "Published" : "Not published"} done={readiness?.firstRolePublished === true} />
              {readiness?.brandingConfigured && <StatusChip label="Organization branding" value="Configured" done />}
              {readiness?.hasCandidates && <StatusChip label="Candidates" value="Added" done />}
              {readiness?.hasTeammates && <StatusChip label="Teammates" value="Invited" done />}
              {readiness?.automatedEmailsCustomized && <StatusChip label="Email wording" value="Customized" done />}
              {organization.allowedDomains.length > 0 && <p className="field-hint organization-card-note">Domain access: {organization.allowedDomains.map((domain) => `@${domain}`).join(", ")} — anyone with an address at these domains can register with HR access.</p>}
            </div></td></tr>}
          </Fragment>;
        })}</tbody></table></div>}
        <p className="field-hint organization-card-note">All organizations use the same organization-scoped database. Their users, candidates, credits, settings, and connected accounts remain separated by organization.</p>
      </section>}

      {inviteAvailable && !canManageOrganizations && <section className="card organization-admin-card" aria-labelledby="team-invite-title">
        <div className="card-header"><div><h2 id="team-invite-title">Invite a teammate</h2><p>Enter their email address and we’ll send a registration link. After they register, they’ll receive a one-time verification link; confirming it returns them to log in.{inviteLimit !== null && <> Your organization has {inviteUsed} of {inviteLimit} people. Contact McLink support to raise the limit.</>}</p></div></div>
        {inviteError && <ActionFeedback kind="error">{inviteError}</ActionFeedback>}
        {inviteMessage && <ActionFeedback kind={inviteMessageKind}>{inviteMessage}</ActionFeedback>}
        <form className="user-account-form" noValidate onSubmit={(event) => void sendInvite(event)}>
          <div className="field"><label htmlFor="invite-email">Email address</label><input id="invite-email" type="email" value={inviteEmail} onChange={(event) => { setInviteEmail(event.target.value); setInviteError(""); }} placeholder="name@company.com" /></div>
          <div className="user-account-form-actions"><button type="submit" className="btn btn-primary" disabled={inviteSaving}>{inviteSaving ? "Inviting…" : "Invite teammate"}</button></div>
        </form>
        {inviteDomains.length > 0 && <p className="field-hint organization-card-note">Anyone with an email at {inviteDomains.map((domain) => `@${domain}`).join(", ")} can already register without an invitation.</p>}
        {invites.some((invite) => !invite.registered) && <div className="table-wrap"><table className="user-account-table"><thead><tr><th>Invited, not registered yet</th><th>Actions</th></tr></thead><tbody>{invites.filter((invite) => !invite.registered).map((invite) => <tr key={invite.email}><td>{invite.email}</td><td><button type="button" className="btn btn-secondary btn-small" onClick={() => void withdrawInvite(invite.email)}>Withdraw</button></td></tr>)}</tbody></table></div>}
      </section>}

      <section className="user-account-stats" aria-label="Account summary">
        <div className="stat-card"><span>Total accounts</span><strong>{users.length}</strong></div>
        <div className="stat-card"><span>Active accounts</span><strong>{activeCount}</strong></div>
        {canManageOrganizations && <div className="stat-card"><span>Settings administrators</span><strong>{adminCount}</strong></div>}
      </section>

      {showForm && <div className="user-account-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
        <section className="card user-account-form-card" role="dialog" aria-modal="true" aria-labelledby="user-account-form-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="card-header"><div><h2 id="user-account-form-title">{originalEmail ? "Edit user account" : "Add user account"}</h2><p>Set the account identity, department, and allowed actions.</p></div><button type="button" className="btn btn-secondary" onClick={closeForm}>Cancel</button></div>
          <form className="user-account-form" noValidate onSubmit={(event) => void save(event)}>
            <div className="field"><label htmlFor="user-full-name">Full name</label><input id="user-full-name" value={form.fullName} onChange={(event) => updateForm("fullName", event.target.value)} required aria-invalid={Boolean(fieldErrors.fullName)} />{fieldErrors.fullName && <small className="field-error">{fieldErrors.fullName}</small>}</div>
            <div className="field"><label htmlFor="user-email">Email address</label><input id="user-email" type="email" value={form.email} onChange={(event) => updateForm("email", event.target.value)} required aria-invalid={Boolean(fieldErrors.email)} />{fieldErrors.email && <small className="field-error">{fieldErrors.email}</small>}</div>
            <div className="field"><label htmlFor="user-access-role">Access role</label><select id="user-access-role" disabled={permissionsLocked} value={form.accessRole} onChange={(event) => updateAccessRole(event.target.value)} required aria-invalid={Boolean(fieldErrors.accessRole)}>{form.accessRole && !getAccessRolePreset(form.accessRole) && <option value={form.accessRole}>{form.accessRole} (existing)</option>}{ACCESS_ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{getAccessRolePreset(form.accessRole) && <small className="field-hint">{getAccessRolePreset(form.accessRole)?.description} Selecting a role applies recommended permissions; you can adjust them below (changing an Admin's permissions switches it to Custom access).</small>}{fieldErrors.accessRole && <small className="field-error">{fieldErrors.accessRole}</small>}</div>
            <div className="field"><label htmlFor="user-department">Department</label><select id="user-department" value={form.department} onChange={(event) => updateForm("department", event.target.value)}><option value="">Select a department</option>{form.department && !isKnownDepartment(form.department) && <option value={form.department}>{form.department} (existing)</option>}{DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}</select></div>
            <fieldset className="user-account-permissions"><legend>Permissions</legend><p className="field-hint">HR is the only access administrator. Accounts named HR with recruitment review access can manage this list.</p>{permissionsLocked && <p className="field-hint">{editingOwnAccount ? "You cannot change your own role or permissions. Ask another HR reviewer." : "Only HR reviewers can change roles and permissions."}</p>}<label><input type="checkbox" disabled={permissionsLocked} checked={form.canCreateRole} onChange={(event) => updatePermission("canCreateRole", event.target.checked)} /> Create role requests</label><label><input type="checkbox" disabled={permissionsLocked} checked={form.canReviewRole} onChange={(event) => updatePermission("canReviewRole", event.target.checked)} /> Review recruitment (company-wide: setup, applicants, bookings)</label><label><input type="checkbox" disabled={permissionsLocked} checked={form.canReviewDepartmentRole} onChange={(event) => updatePermission("canReviewDepartmentRole", event.target.checked)} /> Review own department only</label><label><input type="checkbox" disabled={permissionsLocked} checked={form.canApproveRole} onChange={(event) => updatePermission("canApproveRole", event.target.checked)} /> Approve role requests and hiring decisions</label><label><input type="checkbox" disabled={permissionsLocked} checked={form.canManageCredits} onChange={(event) => updatePermission("canManageCredits", event.target.checked)} /> Manage Smile Credits</label><label><input type="checkbox" disabled={permissionsLocked} checked={form.canEditSettings} onChange={(event) => updatePermission("canEditSettings", event.target.checked)} /> Edit settings</label></fieldset>
            <label className="user-account-active"><input type="checkbox" checked={form.active} onChange={(event) => updateForm("active", event.target.checked)} /> Account is active</label>
            {canManageOrganizations && originalEmail && selectedOrganizationSlug !== DEFAULT_ORG_SLUG && <label className="user-account-active"><input type="checkbox" disabled={!canManageOrganizations} checked={form.isOrganizationOwner === true} onChange={(event) => updateForm("isOrganizationOwner", event.target.checked)} /> Organization owner (manages the team; only one per organization)</label>}
            <div className="user-account-form-actions"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save account"}</button></div>
          </form>
        </section>
      </div>}

      <section className="card user-account-list-card">
        <div className="card-header directory-card-header"><div className="directory-card-heading"><h2>Directory Accounts</h2><p>{canManageOrganizations ? `Manage accounts for ${organizations.find((organization) => organization.slug === selectedOrganizationSlug)?.name || "the selected organization"}.` : "Manage accounts for your organization."}</p></div><div className="directory-card-actions">{canManageOrganizations && organizations.length > 0 && <div className="field user-account-organization-picker"><label htmlFor="user-account-organization">Manage users for</label><select id="user-account-organization" value={selectedOrganizationSlug} onChange={(event) => { setSelectedOrganizationSlug(event.target.value); setShowForm(false); }}><option value={DEFAULT_ORG_SLUG}>McLink</option>{organizations.filter((organization) => organization.slug !== DEFAULT_ORG_SLUG).map((organization) => <option key={organization.slug} value={organization.slug} disabled={!organization.active}>{organization.name}{organization.active ? "" : " (inactive)"}</option>)}</select></div>}<button type="button" className="btn btn-secondary directory-refresh-button" onClick={() => void loadUsers(selectedOrganizationSlug)} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div></div>
        {loading ? <div className="empty">Loading user accounts…</div> : users.length === 0 ? <div className="empty">No user accounts were found.</div> : <div className="table-wrap user-account-table-wrap"><table className="user-account-table"><thead><tr><th>User</th>{canManageOrganizations && <th>Access role</th>}{showDepartment && <th>Department</th>}<th>Status</th><th>Last sign-in</th>{canManageOrganizations && <th>Permissions</th>}<th>Actions</th></tr></thead><tbody>{users.map((user) => <tr key={user.email}><td><strong>{user.fullName || "Unnamed user"}{user.isOrganizationOwner && <span className="rule-chip">Owner</span>}</strong><span>{user.email}</span></td>{canManageOrganizations && <td>{user.accessRole || "—"}</td>}{showDepartment && <td>{user.department || "—"}</td>}<td><span className={`user-account-status ${user.active ? "is-active" : "is-inactive"}`}>{user.active ? "Active" : "Inactive"}</span>{!user.active && user.deactivatedAt && <span className="field-hint">Deactivated{user.deactivatedBy ? ` by ${user.deactivatedBy}` : ""} on {formatWhen(user.deactivatedAt)}</span>}</td><td>{formatWhen(user.lastLoginAt) || "Never"}</td>{canManageOrganizations && <td>{permissionLabels(user)}</td>}<td><div className="user-account-actions">{canManageOrganizations && <button type="button" className="btn btn-secondary btn-small" onClick={() => openEditForm(user)}>Edit</button>}{canManageOrganizations && <button type="button" className="btn btn-secondary btn-small" onClick={() => void resetRegistration(user)} disabled={user.email === currentEmail.trim().toLowerCase()} title="Clear the sign-in credential so this email can register again">Reset registration</button>}{canManageTeam && <button type="button" className={`btn btn-small ${user.active ? "btn-danger-outline" : "btn-secondary"}`} onClick={() => void toggleActive(user)} disabled={user.email === currentEmail.trim().toLowerCase() || (user.isOrganizationOwner === true && !canManageOrganizations)} title={user.isOrganizationOwner && !canManageOrganizations ? "The organization owner cannot be deactivated" : undefined}>{user.active ? "Deactivate" : "Reactivate"}</button>}</div></td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
