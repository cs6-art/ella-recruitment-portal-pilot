import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import RoleRequestForm from "@/components/RoleRequestForm";
import PageHeader from "@/components/ui/PageHeader";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import {
  COOKIE_NAME,
  getActiveSessionUser,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewRolePage() {
  const cookieStore = await cookies();

  const user = await getActiveSessionUser(
    cookieStore.get(COOKIE_NAME)?.value,
  );

  if (!user) {
    redirect("/");
  }

  if (user.canCreateRole !== true) {
    redirect("/dashboard");
  }

  return (
    <>
      <main className="container page">
        <PageHeader
          title="Create Role Request"
          description="Submit a Staff Addition or Replacement Request for HR Review."
        />

        <RoleRequestForm
          user={{
            name: String(
              user.name ?? "",
            ),
            email: String(
              user.email ?? "",
            ),
          }}
          canApproveRole={user.canApproveRole === true}
          unified={user.canReviewRole === true && user.canApproveRole === true}
          canSetInterviewType={isPostgresRecruitmentTarget() && user.canReviewRole === true}
        />
      </main>
    </>
  );
}
