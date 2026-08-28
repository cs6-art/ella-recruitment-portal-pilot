import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import GoogleLogin from "@/components/GoogleLogin";
import { getPortalConfigValue } from "@/lib/portal-config";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

type HomePageProps = {
  searchParams?: Promise<{
    next?: string | string[];
    invite?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const cookieStore = await cookies();
  const user = verifySessionToken(cookieStore.get(COOKIE_NAME)?.value);
  const query = searchParams ? await searchParams : undefined;
  const inviteValue = Array.isArray(query?.invite) ? query.invite[0] : query?.invite;
  const candidatePageBaseUrl = (await getPortalConfigValue("Resume_Screening_Invite_Base_URL")).trim();
  if (inviteValue && candidatePageBaseUrl) {
    let candidatePageUrl: URL | null = null;
    try {
      candidatePageUrl = new URL(candidatePageBaseUrl);
    } catch {
      // Ignore malformed optional configuration and render the normal portal.
    }
    if (candidatePageUrl) {
      candidatePageUrl.searchParams.set("invite", inviteValue);
      redirect(candidatePageUrl.toString());
    }
  }
  const nextValue = Array.isArray(query?.next) ? query.next[0] : query?.next;
  const redirectTo = safeAuthRedirect(nextValue);

  if (user) redirect(redirectTo);

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-hero">
          <span className="eyebrow">Internal recruitment system</span>
          <h1>Start every hire with the right role.</h1>
          <p>Create a staff addition or replacement request, align the job requirements with HR, and get HR approval before recruitment begins.</p>
          <div className="steps-preview">
            <div><span className="step-dot">1</span> HR or the authorised requester submits a request</div>
            <div><span className="step-dot">2</span> HR confirms the role requirements</div>
            <div><span className="step-dot">3</span> HR approves the request before posting</div>
          </div>
        </div>
        <div className="login-panel">
          <h2>Welcome</h2>
          <p>Sign in using your McLink Group Google Workspace account to create and monitor role requests.</p>
          <GoogleLogin redirectTo={redirectTo} />
          <div className="notice"><strong>Company access only.</strong><br />The backend verifies the Google token and only accepts accounts managed under <strong>mclinkgroup.com</strong>.</div>
        </div>
      </section>
    </main>
  );
}
