import { notFound } from "next/navigation";
import CandidateApplicationForm from "@/components/CandidateApplicationForm";
import LiveAvatarInterview from "@/components/LiveAvatarInterview";
import { getRoleRequestById, isPublishedRoleForIntake } from "@/lib/google-sheets";
import { isLiveAvatarConfigured } from "@/lib/live-avatar";

// Dynamic public role details remain live so publication changes are reflected
// immediately; the application POST route also revalidates the role.
export const dynamic = "force-dynamic";

export default async function ApplyPage({ params }: { params: Promise<{ roleId: string }> }) {
  const { roleId: encodedRoleId } = await params;
  const role = await getRoleRequestById(decodeURIComponent(encodedRoleId));
  if (!role || !isPublishedRoleForIntake(role)) notFound();
  return <main className="container page"><section className="card"><p className="eyebrow">McLink Careers</p><h1>{role.jobTitle}</h1><p>{role.department}</p><p>{role.jobDescription}</p></section>{isLiveAvatarConfigured() && <LiveAvatarInterview roleId={role.roleId} roleTitle={role.jobTitle} />}<CandidateApplicationForm roleId={role.roleId} /></main>;
}
