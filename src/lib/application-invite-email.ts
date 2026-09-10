import { getPortalConfigValue } from "@/lib/portal-config";
import { pilotEmailRecipient } from "@/lib/pilot-test-safety";
import { fetchWithTimeout, timeoutFromEnv } from "@/lib/fetch-with-timeout";

export type ApplicationInviteEmailStatus = "sent" | "failed" | "not_configured";

export async function sendApplicationInviteEmail(input: {
  invitationId: string;
  roleId: string;
  roleTitle: string;
  candidateName: string;
  candidateEmail: string;
  link: string;
  expiresAt: string;
  createdByName: string;
  createdByEmail: string;
}): Promise<{ status: ApplicationInviteEmailStatus; error?: string }> {
  const targetMode = process.env.RECRUITMENT_BACKEND?.trim().toLowerCase() === "postgres";
  const url = (targetMode
    ? process.env.N8N_APPLICATION_INVITE_EMAIL_TARGET_WEBHOOK_URL || await getPortalConfigValue("N8N_Application_Invite_Email_Target_Webhook_URL")
    : await getPortalConfigValue("N8N_Application_Invite_Email_Webhook_URL")).trim();
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim();
  if (!url || !secret) return { status: "not_configured" };

  try {
    const recipient = pilotEmailRecipient(input.candidateEmail);
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
        "X-Idempotency-Key": input.invitationId,
      },
      body: JSON.stringify({
        eventType: "application_invite_email_requested",
        invitationId: input.invitationId,
        roleId: input.roleId,
        roleTitle: input.roleTitle,
        // The downstream mail workflow sends candidate.email and copies the
        // configured internal monitoring recipients.
        candidate: { name: input.candidateName, email: recipient.to, intendedEmail: recipient.intendedTo },
        delivery: { to: recipient.to, cc: recipient.cc, intendedTo: recipient.intendedTo, redirected: recipient.redirected },
        applicationLink: input.link,
        expiresAt: input.expiresAt,
        createdBy: { name: input.createdByName, email: input.createdByEmail },
        email: {
          subject: `Application invitation for ${input.roleTitle}`,
          heading: "You are invited to apply",
          message: "Please use the link below to upload your resume and complete your application.",
          note: "This link is personal, can be used once, and expires automatically.",
        },
      }),
      cache: "no-store",
    }, timeoutFromEnv("N8N_APPLICATION_INVITE_EMAIL_TIMEOUT_MS", 15_000));
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || result.success === false) {
      return { status: "failed", error: String(result.error || `Email sender returned HTTP ${response.status}.`) };
    }
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unable to send the application email." };
  }
}

