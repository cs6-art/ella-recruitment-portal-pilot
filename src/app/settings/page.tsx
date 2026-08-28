import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import GoogleCalendarConnect from "@/components/GoogleCalendarConnect";
import SettingsEditor from "@/components/SettingsEditor";
import EllaCreditsPanel from "@/components/EllaCreditsPanel";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  const canManage = user.canEditSettings === true;
  return <AppShell user={user}>
    {!canManage && <main className="container page settings-page settings-readonly-page"><header className="hero-row settings-header"><div><span className="eyebrow-dark">PORTAL CONFIGURATION</span><h1>Settings</h1><p>View shared portal connections and calendar status.</p></div></header></main>}
    <GoogleCalendarConnect canManage={canManage} />
    {canManage ? <>
      <SettingsEditor />
      <section className="container page settings-page"><EllaCreditsPanel /></section>
    </> : <section className="card settings-readonly-note"><strong>Read-only access</strong><span>Only settings administrators can change portal defaults or reconnect the shared calendar.</span></section>}
  </AppShell>;
}
