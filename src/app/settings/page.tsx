import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import EmailTemplatesEditor from "@/components/EmailTemplatesEditor";
import GoogleCalendarConnect from "@/components/GoogleCalendarConnect";
import OrganizationBrandingEditor from "@/components/OrganizationBrandingEditor";
import PageHeader from "@/components/ui/PageHeader";
import RecordingDriveConnect from "@/components/RecordingDriveConnect";
import SettingsEditor from "@/components/SettingsEditor";
import { isPlatformAdmin } from "@/lib/access-control";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (user.canEditSettings !== true) redirect("/dashboard");
  return <>
    {isPlatformAdmin(user)
      ? <SettingsEditor />
      : <main className="container page settings-page">
        <PageHeader
          className="settings-header"
          eyebrow="YOUR ORGANIZATION"
          title="Settings"
          description="Set how your organization appears and connect the services used for interviews."
        />
      </main>}
    <OrganizationBrandingEditor />
    <main className="container page settings-page">
      <RecordingDriveConnect />
      <section className="card settings-section" aria-labelledby="calendar-settings-title">
        <div className="settings-section-header"><div><h2 id="calendar-settings-title">Google Calendar Connection</h2><p>Manage the shared HR Google Calendar connection used for face-to-face interviews.</p></div></div>
        <GoogleCalendarConnect canManage />
      </section>
      <EmailTemplatesEditor />
    </main>
  </>;
}
