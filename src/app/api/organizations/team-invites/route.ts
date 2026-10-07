import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { organizations, userCredentials } from "@/db/schema";
import { isMemberLimitReached, memberSeatUsage } from "@/lib/organization-signup";
import { users } from "@/db/schema-recruitment";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";
import { getPublicAppBaseUrl } from "@/lib/public-url";
import { sendTeamInvitationEmail } from "@/lib/registration";
import { listReleasedEmailKeys, withoutReleasedEmails } from "@/lib/released-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INVITES = 100;
const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200) });

function fail(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store", ...(headers || {}) } });
}

/**
 * The owner of a client organization can invite teammates by email address.
 * Whole email domains stay a McLink administrator decision: an owner adding a
 * common domain such as gmail.com would let anyone register into the workspace.
 */
async function requireOwner() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { error: fail("Authentication required.", 401) } as const;
  if (user.organizationId === DEFAULT_ORGANIZATION_ID) return { error: fail("McLink accounts are managed by a platform administrator.", 403) } as const;
  const [owner] = await getDb().select({ id: users.id }).from(users)
    .where(and(eq(users.organizationId, user.organizationId), eq(users.email, user.email.trim().toLowerCase()), eq(users.isOrganizationOwner, true), eq(users.active, true))).limit(1);
  if (!owner) return { error: fail("Only the organization owner can invite teammates.", 403) } as const;
  return { user } as const;
}

async function loadOrganization(organizationId: string) {
  const [organization] = await getDb().select({ name: organizations.name, allowedEmails: organizations.allowedEmails, allowedDomains: organizations.allowedDomains, maxMembers: organizations.maxMembers }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return organization;
}

export async function GET() {
  const access = await requireOwner();
  if ("error" in access) return access.error;
  try {
    const organization = await loadOrganization(access.user.organizationId);
    if (!organization) return fail("Organization not found.", 404);
    const people = await getDb().select({ email: users.email, active: users.active }).from(users).where(eq(users.organizationId, access.user.organizationId));
    const pending = await getDb().select({ email: userCredentials.email }).from(userCredentials).where(and(eq(userCredentials.organizationId, access.user.organizationId), sql`${userCredentials.emailVerifiedAt} IS NULL`, sql`${userCredentials.verificationExpiresAt} > now()`));
    const registered = new Set(people.map((row) => row.email.trim().toLowerCase()));
    const used = memberSeatUsage({ activeEmails: people.filter((row) => row.active).map((row) => row.email), invitedEmails: organization.allowedEmails, pendingEmails: pending.map((row) => row.email) });
    return NextResponse.json({
      success: true,
      domains: organization.allowedDomains,
      limit: organization.maxMembers,
      used,
      invites: organization.allowedEmails.map((email) => ({ email, registered: registered.has(email) })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Team Invites] GET failed:", error);
    return fail("Unable to load invitations.", 500);
  }
}

export async function POST(request: Request) {
  const access = await requireOwner();
  if ("error" in access) return access.error;
  const rate = consumeRateLimit(`team-invite:${access.user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return fail("Too many invitations. Try again later.", 429, rateLimitHeaders(rate));
  try {
    const { email } = inviteSchema.parse(await request.json());
    const organizationId = access.user.organizationId;
    const organization = await loadOrganization(organizationId);
    if (!organization) return fail("Organization not found.", 404);
    if (organization.allowedEmails.includes(email)) return fail("That email address is already invited.", 409);
    if (organization.maxMembers != null) {
      // Seats in use are the people already in the organization plus invitations still waiting.
      const members = await getDb().select({ email: users.email }).from(users).where(and(eq(users.organizationId, organizationId), eq(users.active, true)));
      const pending = await getDb().select({ email: userCredentials.email }).from(userCredentials).where(and(eq(userCredentials.organizationId, organizationId), sql`${userCredentials.emailVerifiedAt} IS NULL`, sql`${userCredentials.verificationExpiresAt} > now()`));
      const used = memberSeatUsage({ activeEmails: members.map((row) => row.email), invitedEmails: organization.allowedEmails, pendingEmails: pending.map((row) => row.email) });
      if (isMemberLimitReached(organization.maxMembers, used)) return fail(`Your organization is limited to ${organization.maxMembers} people. Contact McLink support to raise the limit.`, 409);
    }
    if (organization.allowedEmails.length >= MAX_INVITES) return fail(`You can invite up to ${MAX_INVITES} addresses.`, 400);
    // An address may register into only one organization.
    const others = await getDb().select({ id: organizations.id, name: organizations.name, allowedEmails: organizations.allowedEmails, allowedDomains: organizations.allowedDomains }).from(organizations);
    const domain = email.split("@")[1] || "";
    // An organization that deactivated this person has released the address.
    const released = await listReleasedEmailKeys([email]);
    const conflict = withoutReleasedEmails(others, released).find((other) => other.id !== organizationId && (other.allowedEmails.includes(email) || other.allowedDomains.includes(domain)));
    if (conflict) return fail("That email address already belongs to another organization.", 409);
    await getDb().update(organizations).set({ allowedEmails: [...organization.allowedEmails, email], updatedAt: new Date() }).where(eq(organizations.id, organizationId));
    const inviteLink = new URL(`${getPublicAppBaseUrl(request)}/`);
    inviteLink.searchParams.set("register", "1");
    inviteLink.searchParams.set("email", email);
    const emailResult = await sendTeamInvitationEmail({ email, organizationName: organization.name, link: inviteLink.toString() });
    if (emailResult.status !== "sent") {
      console.error("[API Team Invites] Invitation email not sent:", emailResult.status, emailResult.error || "");
      return NextResponse.json({
        success: true,
        emailSent: false,
        message: `${email} was added as an invited teammate, but the invitation email could not be sent. Check the email configuration and try again.`,
      });
    }
    return NextResponse.json({ success: true, emailSent: true, message: `Invitation sent to ${email}. They can register from the email and will receive a verification link.` });
  } catch (error) {
    if (error instanceof z.ZodError) return fail(error.issues[0]?.message || "Enter a valid email address.", 400);
    console.error("[API Team Invites] POST failed:", error);
    return fail("Unable to send the invitation.", 500);
  }
}

/** Withdraws an invitation that has not been used. People who already registered are deactivated from the team list instead. */
export async function DELETE(request: Request) {
  const access = await requireOwner();
  if ("error" in access) return access.error;
  const email = (new URL(request.url).searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return fail("The email address is required.", 400);
  try {
    const organizationId = access.user.organizationId;
    const organization = await loadOrganization(organizationId);
    if (!organization) return fail("Organization not found.", 404);
    if (email === access.user.email.trim().toLowerCase()) return fail("You cannot remove your own address.", 400);
    const [registered] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.organizationId, organizationId), eq(users.email, email))).limit(1);
    if (registered) return fail("This person has already registered. Deactivate them from the team list instead.", 409);
    await getDb().update(organizations).set({ allowedEmails: organization.allowedEmails.filter((value) => value !== email), updatedAt: new Date() }).where(eq(organizations.id, organizationId));
    return NextResponse.json({ success: true, message: "Invitation withdrawn." });
  } catch (error) {
    console.error("[API Team Invites] DELETE failed:", error);
    return fail("Unable to withdraw the invitation.", 500);
  }
}
