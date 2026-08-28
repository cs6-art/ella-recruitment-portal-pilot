import { getPortalConfigValue } from "@/lib/portal-config";

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
  const url = (await getPortalConfigValue("N8N_Application_Invite_Email_Webhook_URL")).trim();
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim();
  if (!url || !secret) return { status: "not_configured" };

  try {
    const response = await fetch(url, {
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
        candidate: { name: input.candidateName, email: input.candidateEmail },
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
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || result.success === false) {
      return { status: "failed", error: String(result.error || `Email sender returned HTTP ${response.status}.`) };
    }
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unable to send the application email." };
  }
}

