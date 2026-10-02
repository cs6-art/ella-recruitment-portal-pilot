import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import RoleDetails from "@/components/RoleDetails";
import {
  COOKIE_NAME,
  getActiveSessionUser,
} from "@/lib/session";

export const dynamic = "force-dynamic";

type RoleDetailsPageProps = {
  params: Promise<{
    roleId: string;
  }>;
};

export default async function RoleDetailsPage({
  params,
}: RoleDetailsPageProps) {
  const { roleId } = await params;
  const decodedRoleId = decodeURIComponent(roleId);
  const rolePath = `/roles/${encodeURIComponent(decodedRoleId)}`;
  const cookieStore = await cookies();

  const user = await getActiveSessionUser(
    cookieStore.get(COOKIE_NAME)?.value,
  );

  if (!user) {
    // Preserve the exact role link through Google sign-in instead of sending
    // users who arrived from an email notification to the dashboard.
    redirect(`/?next=${encodeURIComponent(rolePath)}`);
  }

  if (
    user.canCreateRole !== true &&
    user.canReviewRole !== true &&
    user.canApproveRole !== true
  ) {
    redirect("/dashboard");
  }

  return (
    <>
      <RoleDetails
        roleId={decodedRoleId}
        userEmail={user.email}
        canReviewRole={user.canReviewRole === true}
        canApproveRole={user.canApproveRole === true}
      />
    </>
  );
}
