import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import EllaCreditsPanel from "@/components/EllaCreditsPanel";
import EllaCreditsPurchase from "@/components/EllaCreditsPurchase";
import PageHeader from "@/components/ui/PageHeader";
import { canManageCredits } from "@/lib/access-control";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  const canManage = canManageCredits(user);

  return (
    <>
      <main className="container page settings-page">
        <PageHeader
          className="settings-header"
          eyebrow="SMILE CREDITS"
          title="Credits"
          description="Purchase credits securely, review your organization’s credit history, or manage authorized manual top-ups."
        />
        <EllaCreditsPurchase />
        <EllaCreditsPanel canManage={canManage} />
      </main>
    </>
  );
}
