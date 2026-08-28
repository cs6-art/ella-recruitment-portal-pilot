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
    <GoogleCalendarConnect canManage />
    <section className="container page settings-page ella-credits-page"><EllaCreditsPanel /></section>
  </AppShell>;
}
