"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import UiIcon from "./UiIcon";
import EllaCreditsMeter from "./EllaCreditsMeter";
import HelpBot from "./HelpBot";
import { ConfirmationProvider } from "./ConfirmationModal";
import styles from "./AppShell.module.css";

type AppShellUser = {
  name?: string;
  email?: string;
  accessRole?: string;
  department?: string;
  canCreateRole?: boolean;
  canReviewRole?: boolean;
  canApproveRole?: boolean;
  canEditSettings?: boolean;
  canManageUsers?: boolean;
  canReviewDepartmentRole?: boolean;
  active?: boolean;
};

type AppShellProps = { user: AppShellUser; children: React.ReactNode };
const SIDEBAR_COLLAPSED_STORAGE_KEY = "mclink.sidebar.collapsed";

function getInitials(name?: string, email?: string) {
  const source = name?.trim() || email?.trim() || "User";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export default function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);
  const userName = user.name?.trim() || "McLink User";
  const userEmail = user.email?.trim() || "";
  const initials = getInitials(userName, userEmail);
  const showRoleRequests = user.canReviewRole === true || user.canApproveRole === true || user.canCreateRole === true || user.canReviewDepartmentRole === true;
  // Resume Screening and Bookings are HR operational tools (recruitment
  // setup, scheduling). Management (decision-only) and HOD (department
  // read-only) do not manage the pipeline, so they don't see these.
  const showOperationalTools = user.canReviewRole === true;
  const showApplicants = user.canReviewRole === true || user.canApproveRole === true || user.canReviewDepartmentRole === true;
  const isDashboard = pathname === "/dashboard";
  const isRoleList = pathname === "/roles";
  const isRoleCreate = pathname === "/roles/new";
  const isRoleDetails = pathname.startsWith("/roles/") && pathname !== "/roles/new";
  // Role-specific applicant pages live under /roles/.../applicants. Keep them
  // under Role Requests so the sidebar never highlights two sections at once.
  const isApplicants = pathname === "/applicants" || pathname.startsWith("/applicants/");
  const isApplicantDetail = pathname.startsWith("/applicants/");
  const isResumeScreening = pathname === "/resume-screening";
  const isBookings = pathname === "/bookings" || pathname.startsWith("/bookings/");
  const isProfile = pathname === "/profile";
  const isSettings = pathname === "/settings";
  const isUserAccounts = pathname === "/user-accounts";
  const isRoleRequestArea = pathname === "/roles" || (pathname.startsWith("/roles/") && pathname !== "/roles/new");
  const closeSidebar = () => setSidebarOpen(false);

  useEffect(() => {
    const savedPreference = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (savedPreference === "true") setSidebarCollapsed(true);
    if (savedPreference === "true") document.documentElement.dataset.sidebarCollapsed = "true";
    setSidebarPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!sidebarPreferenceLoaded) return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed));
    if (sidebarCollapsed) document.documentElement.dataset.sidebarCollapsed = "true";
    else delete document.documentElement.dataset.sidebarCollapsed;
  }, [sidebarCollapsed, sidebarPreferenceLoaded]);

  return (
    <ConfirmationProvider>
    <div className={styles.shell}>
      <div className={`${styles.backdrop} ${sidebarOpen ? styles.backdropVisible : ""}`} onClick={closeSidebar} aria-hidden="true" />
      <aside id="portal-navigation" className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`} aria-label="Portal navigation">
        <div className={styles.sidebarTop}>
          <Link href="/dashboard" className={styles.brand} onClick={closeSidebar}>
            <span className={styles.brandIcon}>M</span><span><strong>McLink</strong><small>Recruitment Portal</small></span>
          </Link>
          <button type="button" className={styles.closeButton} onClick={closeSidebar} aria-label="Close navigation"><UiIcon name="close" /></button>
        </div>

        <EllaCreditsMeter variant="sidebar" collapsed={sidebarCollapsed} />

        <div className={styles.workspaceLabel}>WORKSPACE</div>
        <nav className={styles.navigation} aria-label="Main navigation">
          <Link href="/dashboard" onClick={closeSidebar} className={`${styles.navLink} ${isDashboard ? styles.navLinkActive : ""}`}><span className={styles.navIcon}><UiIcon name="dashboard" /></span><span>Dashboard</span></Link>
          {showRoleRequests && <Link href="/roles" onClick={closeSidebar} className={`${styles.navLink} ${isRoleList || isRoleDetails || isRoleCreate ? styles.navLinkActive : ""}`}><span className={styles.navIcon}><UiIcon name="roles" /></span><span>Role Requests</span></Link>}
          {showOperationalTools && <Link href="/resume-screening" onClick={closeSidebar} className={`${styles.navLink} ${isResumeScreening ? styles.navLinkActive : ""}`}><span className={styles.navIcon}><UiIcon name="document" /></span><span>Resume Screening</span></Link>}
          {(showApplicants || showOperationalTools) && <div className={styles.applicantBookingGroup}>
            {showApplicants && <Link href="/applicants" onClick={closeSidebar} className={`${styles.navLink} ${isApplicants ? styles.navLinkActive : ""}`}><span className={styles.navIcon}><UiIcon name="applicants" /></span><span>Applicants</span></Link>}
            <button type="button" className={styles.collapseButton} onClick={() => setSidebarCollapsed((current) => !current)} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!sidebarCollapsed}><UiIcon name={sidebarCollapsed ? "chevron-right" : "chevron-left"} /></button>
            {showOperationalTools && <Link href="/bookings" onClick={closeSidebar} className={`${styles.navLink} ${isBookings ? styles.navLinkActive : ""}`}><span className={styles.navIcon}><UiIcon name="calendar" /></span><span>Bookings</span></Link>}
          </div>}
          {user.canEditSettings === true && <Link href="/settings" onClick={closeSidebar} className={`${styles.navLink} ${isSettings ? styles.navLinkActive : ""}`}><span className={styles.navIcon}><UiIcon name="settings" /></span><span>Settings</span></Link>}
          {(user.canManageUsers === true || user.canEditSettings === true) && <Link href="/user-accounts" onClick={closeSidebar} className={`${styles.navLink} ${isUserAccounts ? styles.navLinkActive : ""}`}><span className={styles.navIcon}><UiIcon name="users" /></span><span>User Accounts</span></Link>}
        </nav>

        <div className={styles.sidebarSpacer} />
        <div className={styles.accountSection}>
          <div className={styles.workspaceLabel}>ACCOUNT</div>
          <Link href="/profile" onClick={closeSidebar} className={`${styles.profileButton} ${isProfile ? styles.profileButtonActive : ""}`}><div className={styles.avatar}>{initials}</div><div className={styles.profileDetails}><strong>{userName}</strong>{userEmail && <span>{userEmail}</span>}{user.accessRole && <small>{user.accessRole}</small>}</div><span className={styles.profileArrow}><UiIcon name="chevron-right" /></span></Link>
          {/* Disabling this button synchronously inside its own click handler
              (the previous `disabled={signingOut}` set from the same onClick)
              raced the browser's native "submit this GET form" default action:
              React re-rendered the button as disabled before that default
              action ran, so the very click meant to sign out silently did
              nothing. Deferring the state update to the next tick lets the
              native navigation kick off first; the disabled/"Signing out..."
              state is then purely a cosmetic cue while the page unloads. */}
          <form action="/api/auth/logout" method="get"><button type="submit" className={styles.signOutButton} onClick={() => { window.setTimeout(() => setSigningOut(true), 0); }} disabled={signingOut}><UiIcon name="logout" /><span className={styles.signOutText}>{signingOut ? "Signing out..." : "Sign Out"}</span></button></form>
        </div>
      </aside>

      <div className={`${styles.main} ${sidebarCollapsed ? styles.mainCollapsed : ""}`}>
        <header className={styles.mobileHeader}><Link href="/dashboard" className={styles.mobileBrand} onClick={closeSidebar}><span className={styles.brandIcon}>M</span><strong>McLink Recruitment Portal</strong></Link><div className={styles.mobileHeaderActions}><EllaCreditsMeter variant="mobile" /><button type="button" className={styles.menuButton} onClick={() => setSidebarOpen(true)} aria-expanded={sidebarOpen} aria-controls="portal-navigation"><UiIcon name="menu" /><span>Menu</span></button></div></header>
        {!isDashboard && !isRoleRequestArea && !isApplicantDetail && <div className={styles.pageToolbar}><Link href="/dashboard" className="portal-back-button" aria-label="Back to Dashboard"><UiIcon name="arrow-left" />Back to Dashboard</Link></div>}
        <div className={styles.content}>{children}</div>
      </div>
      <HelpBot />
    </div>
    </ConfirmationProvider>
  );
}
