import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import RolesList from "@/components/RolesList";
import {
  COOKIE_NAME,
  getActiveSessionUser,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const cookieStore = await cookies();

  const user = await getActiveSessionUser(
    cookieStore.get(COOKIE_NAME)?.value,
  );

  if (!user) {
    redirect("/");
  }

  const canReviewRole =
    user.canReviewRole === true;

  const canApproveRole =
    user.canApproveRole === true;

  const canReviewDepartmentRole =
    user.canReviewDepartmentRole === true;

  if (!user.canCreateRole && !canReviewRole && !canApproveRole && !canReviewDepartmentRole) {
    redirect("/dashboard");
  }

  return (
    <>
      <RolesList
        canCreateRole={
          user.canCreateRole === true
        }
        creatorOnly={
          user.canCreateRole === true &&
          !canReviewRole &&
          !canApproveRole &&
          !canReviewDepartmentRole
        }
        departmentOnly={
          canReviewDepartmentRole &&
          !canReviewRole &&
          !canApproveRole
        }
        userEmail={user.email}
        canReviewRole={canReviewRole}
        canApproveRole={canApproveRole}
      />
    </>
  );
}
