import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import GoogleCalendarConnect from "@/components/GoogleCalendarConnect";
import OrganizationBrandingEditor from "@/components/OrganizationBrandingEditor";
import SettingsEditor from "@/components/SettingsEditor";
import { isPlatformAdmin } from "@/lib/access-control";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (user.canEditSettings !== true) redirect("/dashboard");
  return <AppShell user={user}>
    {isPlatformAdmin(user)
      ? <SettingsEditor />
      : <main className="container page settings-page">
        <header className="hero-row settings-header">
          <div><span className="eyebrow-dark">YOUR ORGANIZATION</span><h1>Settings</h1><p>Set how your organization appears and connect the calendar used for interviews. Everything else is managed automatically.</p></div>
        </header>
      </main>}
    <OrganizationBrandingEditor />
    <main className="container page settings-page">
      <section className="card settings-section" aria-labelledby="calendar-settings-title">
        <div className="settings-section-header"><div><h2 id="calendar-settings-title">Google Calendar connection</h2><p>Manage the shared HR Google Calendar connection used for face-to-face interviews.</p></div></div>
        <GoogleCalendarConnect canManage />
      </section>
    </main>
  </AppShell>;
}
