import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import GoogleCalendarConnect from "@/components/GoogleCalendarConnect";
import EllaCreditsPanel from "@/components/EllaCreditsPanel";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (user.canEditSettings !== true) redirect("/dashboard");
  return <AppShell user={user}>
    <main className="container page settings-page">
      <header className="hero-row settings-header">
        <div><span className="eyebrow-dark">PORTAL ADMINISTRATION</span><h1>Settings</h1><p>Manage the shared HR calendar connection and recruitment credits.</p></div>
      </header>
      <GoogleCalendarConnect canManage />
      <EllaCreditsPanel />
    </main>
  </AppShell>;
}
