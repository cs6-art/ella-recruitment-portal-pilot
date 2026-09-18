import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import EllaCreditsPanel from "@/components/EllaCreditsPanel";
import EllaCreditsPurchase from "@/components/EllaCreditsPurchase";
import { canManageCredits } from "@/lib/access-control";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  const canManage = canManageCredits(user);

  return (
    <AppShell user={user}>
      <main className="container page settings-page">
        <header className="hero-row settings-header">
          <div>
            <span className="eyebrow-dark">SMILE CREDITS</span>
            <h1>Credits</h1>
            <p>Purchase credits securely, review your organization’s credit history, or manage authorized manual top-ups.</p>
          </div>
        </header>
        <EllaCreditsPurchase />
        <EllaCreditsPanel canManage={canManage} />
      </main>
    </AppShell>
  );
}
