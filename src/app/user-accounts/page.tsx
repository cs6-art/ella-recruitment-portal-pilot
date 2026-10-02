import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import UserAccountsEditor from "@/components/UserAccountsEditor";
import { canAdministerAccess } from "@/lib/access-control";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function UserAccountsPage() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (!canAdministerAccess(user)) redirect("/dashboard");

  return <UserAccountsEditor currentEmail={user.email} />;
}
