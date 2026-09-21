import { notFound } from "next/navigation";
import CandidateApplicationForm from "@/components/CandidateApplicationForm";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { resolvePublishedRecruitmentRole } from "@/lib/recruitment-role-resolution";

// Dynamic public role details remain live so publication changes are reflected
// immediately; the application POST route also revalidates the role.
export const dynamic = "force-dynamic";

type ApplyPageProps = {
  params: Promise<{ roleId: string }>;
  searchParams: Promise<{ organizationId?: string | string[] }>;
};

export default async function ApplyPage({ params, searchParams }: ApplyPageProps) {
  const { roleId: encodedRoleId } = await params;
  const query = await searchParams;
  const organizationId = Array.isArray(query.organizationId) ? query.organizationId[0] || "" : query.organizationId || "";
  const role = isPostgresRecruitmentTarget()
    ? await resolvePublishedRecruitmentRole(encodedRoleId, organizationId)
    : await getRoleRequestById(decodeURIComponent(encodedRoleId));
  if (!role || !isPublishedRoleForIntake(role)) notFound();
  return <main className="container page"><section className="card"><p className="eyebrow">McLink Careers</p><h1>{role.jobTitle}</h1><p>{role.department}</p><p>{role.jobDescription}</p></section><CandidateApplicationForm roleId={role.roleId} organizationId={role.organizationId} /></main>;
}
