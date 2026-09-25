import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import ApplicantEditForm from "@/components/ApplicantEditForm";
import { canEditApplicant } from "@/lib/access-control";
import { getApplicantById } from "@/lib/candidate-applications";
import { countryForPhone } from "@/lib/country-codes";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditApplicantPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) redirect("/");
  if (!canEditApplicant(user)) redirect("/applicants");
  const applicationId = decodeURIComponent((await params).applicationId);
  const applicant = await getApplicantById(applicationId);
  if (!applicant) return <AppShell user={user}><main className="container page"><section className="card"><div className="empty">Applicant not found.</div></section></main></AppShell>;
  return <AppShell user={user}><main className="container page applicant-edit-page"><ApplicantEditForm applicant={{ applicationId: applicant.applicationId, candidateName: applicant.candidateName, email: applicant.email, contactNumber: applicant.contactNumber, roleId: applicant.roleId, selectedRole: applicant.selectedRole, department: applicant.department, applicantCountry: countryForPhone(applicant.contactNumber).country }} /></main></AppShell>;
}
