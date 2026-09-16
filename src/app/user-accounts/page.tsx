import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import UserAccountsEditor from "@/components/UserAccountsEditor";
import { canAdministerAccess } from "@/lib/access-control";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UserAccountsPage() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (!canAdministerAccess(user)) redirect("/dashboard");

  return <AppShell user={user}><UserAccountsEditor currentEmail={user.email} /></AppShell>;
}
