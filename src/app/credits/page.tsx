import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import EllaCreditsPanel from "@/components/EllaCreditsPanel";
import { canManageCredits } from "@/lib/access-control";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (!canManageCredits(user)) redirect("/dashboard");

  return (
    <AppShell user={user}>
      <main className="container page settings-page">
        <header className="hero-row settings-header">
          <div>
            <span className="eyebrow-dark">ELLA CREDITS</span>
            <h1>Credits</h1>
            <p>View the shared credit balance and manage authorized manual top-ups.</p>
          </div>
        </header>
        <EllaCreditsPanel />
      </main>
    </AppShell>
  );
}
