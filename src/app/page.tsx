import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getPortalConfigValue } from "@/lib/portal-config";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

type HomePageProps = {
  searchParams?: Promise<{
    next?: string | string[];
    invite?: string | string[];
    verify?: string | string[];
    reset?: string | string[];
    register?: string | string[];
    email?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const cookieStore = await cookies();
  const user = await getActiveSessionUser(cookieStore.get(COOKIE_NAME)?.value);
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

  const verifyValue = Array.isArray(query?.verify) ? query.verify[0] : query?.verify;
  const resetToken = (Array.isArray(query?.reset) ? query.reset[0] : query?.reset) || "";
  const registerValue = Array.isArray(query?.register) ? query.register[0] : query?.register;
  const invitedEmail = registerValue === "1" ? (Array.isArray(query?.email) ? query.email[0] : query?.email) || "" : "";
  const verifyNotice = ({
    verified: "Your email is verified. You can now log in.",
    expired: "That verification link has expired. Log in and choose “Resend verification email”.",
    invalid: "That verification link is not valid or was already used.",
    organization_full: "Your organization has reached its limit on the number of people for now. Ask your organization's owner or contact McLink support to raise it, then open the link in your email again.",
    error: "We could not verify your email. Please try again.",
  } as Record<string, string>)[verifyValue || ""];

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-hero">
          <span className="eyebrow">Recruitment Portal</span>
          <h1>Start every hire with the right role.</h1>
          <p>Create a staff addition or replacement request, approve it, and start screening candidates, all in one place.</p>
          <div className="steps-preview">
            <div><span className="step-dot">1</span> Register with your organization email</div>
            <div><span className="step-dot">2</span> Submit a role request. HR accounts approve it instantly</div>
            <div><span className="step-dot">3</span> Set up, publish and screen candidates</div>
          </div>
        </div>
        <div className="login-panel">
          <h2>{invitedEmail ? "You’re invited" : "Welcome"}</h2>
          <p>{invitedEmail ? "Register with this invited email and verify it to join the organization. The first person to register and verify becomes the organization owner." : "New here? Register with your organization email, then click the verification link we send you. Already verified? Log in."}</p>
          {verifyNotice ? <div className="notice" role="status">{verifyNotice}</div> : null}
          <AuthForm redirectTo={redirectTo} resetToken={resetToken} initialEmail={invitedEmail} startInRegistration={Boolean(invitedEmail)} />
          <div className="notice"><strong>Use your work email address.</strong><br />If your company's domain is new, the first person to register and confirm creates the organization. Colleagues with the same domain can join automatically.</div>
        </div>
      </section>
    </main>
  );
}
