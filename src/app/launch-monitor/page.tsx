import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import LaunchMonitor from "@/components/LaunchMonitor";
import PageHeader from "@/components/ui/PageHeader";
import { isPlatformAdmin } from "@/lib/access-control";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Launch Monitor" };

/** McLink platform administrators only; client organizations never see this page. */
export default async function LaunchMonitorPage() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (!isPlatformAdmin(user)) redirect("/dashboard");

  return (
    <main className="container page">
      <PageHeader
        eyebrow="MCLINK ADMINISTRATION"
        title="Launch Monitor"
        description="Follow the Event Welcome promotion, see each organization's credits, and read the feedback people have sent."
      />
      <LaunchMonitor />
    </main>
  );
}
