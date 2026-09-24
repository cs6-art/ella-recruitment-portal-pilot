import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { organizations, userCredentials } from "@/db/schema";
import { getDirectoryUsers, updateDirectoryUser, upsertDirectoryUser, type DirectoryUser } from "@/lib/google-sheets";
import { DEFAULT_ORGANIZATION_ID, syncOrganizationMembership } from "@/lib/organization-accounts";
import { getPostgresDirectoryUsers, upsertPostgresDirectoryUser } from "@/lib/postgres-directory";
import { canAdministerAccess, isPlatformAdmin } from "@/lib/access-control";
import { applyAccessRolePolicy } from "@/lib/access-roles";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/registration";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { runWithTenantDatabase } from "@/lib/tenant-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const userSchema = z.object({
  email: z.string().trim().email().max(200),
  fullName: z.string().trim().min(1).max(160),
  accessRole: z.string().trim().min(1).max(80),
  department: z.string().trim().max(100),
  canCreateRole: z.boolean(),
  canReviewRole: z.boolean(),
  canApproveRole: z.boolean(),
  canEditSettings: z.boolean(),
  canManageUsers: z.boolean(),
  canManageCredits: z.boolean().default(false),
  canReviewDepartmentRole: z.boolean().default(false),
  active: z.boolean(),
});

async function currentUser() {
  return verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
}

function responseError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

async function requireAdmin(request: Request) {
  const user = await currentUser();
  if (!user) return { error: responseError("Authentication required.", 401) } as const;
  if (!canAdministerAccess(user)) return { error: responseError("Only an active HR reviewer can administer user access.", 403) } as const;
  const rate = consumeRateLimit(`user-directory:${user.email}:${requestClientKey(request)}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) {
    return { error: NextResponse.json({ success: false, error: "Too many account updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) }) } as const;
  }
  return { user } as const;
}

async function resolveTargetOrganization(request: Request, user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) return { error: responseError("Authentication required.", 401) } as const;
  const requestedOrganizationId = new URL(request.url).searchParams.get("organizationId")?.trim() || "";
  const platformAdmin = isPlatformAdmin(user);
  const organizationId = requestedOrganizationId || user.organizationId;
  if (!platformAdmin && organizationId !== user.organizationId) {
    return { error: responseError("You can only manage users in your own organization.", 403) } as const;
  }
  if (organizationId === DEFAULT_ORGANIZATION_ID) return { organizationId } as const;
  const [organization] = await getDb().select({ id: organizations.id, active: organizations.active }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) return { error: responseError("Organization not found.", 404) } as const;
  if (!organization.active) return { error: responseError("This organization is inactive.", 409) } as const;
  return { organizationId } as const;
}

/** McLink's directory is the staff Sheet plus accounts that registered themselves in the database. */
async function listOrganizationUsers(organizationId: string): Promise<DirectoryUser[]> {
  const registered = await runWithTenantDatabase(organizationId, () => getPostgresDirectoryUsers(organizationId));
  if (organizationId !== DEFAULT_ORGANIZATION_ID) return registered;
  const sheetUsers = await getDirectoryUsers();
  const sheetEmails = new Set(sheetUsers.map((user) => user.email));
  return [...sheetUsers, ...registered.filter((user) => !sheetEmails.has(user.email))];
}

export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if ("error" in access) return access.error;

  try {
    const target = await resolveTargetOrganization(request, access.user);
    if ("error" in target) return target.error;
    const users = await listOrganizationUsers(target.organizationId);
    return NextResponse.json({ success: true, users, platformAdmin: isPlatformAdmin(access.user) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API User Directory] GET failed:", error);
    return responseError("Unable to load user accounts.", 500);
  }
}

function validateAccountRules(user: DirectoryUser, currentEmail: string, originalEmail?: string) {
  const normalizedCurrentEmail = currentEmail.trim().toLowerCase();
  const normalizedOriginalEmail = originalEmail?.trim().toLowerCase();
  const isEditingSelf = normalizedOriginalEmail === normalizedCurrentEmail;
  const isChangingSelfEmail = isEditingSelf && user.email !== normalizedCurrentEmail;
  const isDeactivatingSelf = isEditingSelf && user.active === false;

  if (isChangingSelfEmail || isDeactivatingSelf) {
    return "You cannot change or deactivate your own signed-in account.";
  }

  return "";
}

async function saveAccount(request: Request, originalEmail?: string) {
  const access = await requireAdmin(request);
  if ("error" in access) return access.error;
  const target = await resolveTargetOrganization(request, access.user);
  if ("error" in target) return target.error;

  try {
    const platformAdmin = isPlatformAdmin(access.user);
    // Organization HR accounts manage their own colleagues in a simple way:
    // people join by registering, and HR can only rename, set the department
    // of, or deactivate them. Roles, permissions and credit top-ups are
    // McLink-administrator controls.
    if (!platformAdmin && !originalEmail) return responseError("Teammates join by registering with their organization email address.", 403);
    const user = userSchema.parse(await request.json());
    const normalizedEmail = user.email.toLowerCase();
    const normalizedUser: DirectoryUser = applyAccessRolePolicy({
      email: normalizedEmail,
      fullName: user.fullName,
      accessRole: user.accessRole,
      department: user.department,
      canCreateRole: user.canCreateRole,
      canReviewRole: user.canReviewRole,
      canApproveRole: user.canApproveRole,
      canEditSettings: user.canEditSettings,
      // User administration is intentionally not delegable to Admin or a
      // custom account. HR reviewers are the only access administrators.
      canManageUsers: user.accessRole.trim().toLowerCase() === "hr",
      canManageCredits: user.canManageCredits,
      canReviewDepartmentRole: user.canReviewDepartmentRole,
      active: user.active,
    });
    const isDefaultOrganization = target.organizationId === DEFAULT_ORGANIZATION_ID;
    const users = await listOrganizationUsers(target.organizationId);
    const normalizedOriginalEmail = originalEmail?.trim().toLowerCase();
    if (!platformAdmin) {
      const current = users.find((existing) => existing.email === normalizedOriginalEmail);
      if (!current) return responseError("The account being edited no longer exists.", 404);
      Object.assign(normalizedUser, current, { email: current.email, fullName: normalizedUser.fullName, department: normalizedUser.department, active: normalizedUser.active });
    }
    const duplicate = users.some((existing) => existing.email === normalizedEmail && existing.email !== normalizedOriginalEmail);
    if (duplicate) return responseError("An account already exists for that email address.", 409);

    const ruleError = validateAccountRules(normalizedUser, access.user.email, originalEmail);
    if (ruleError) return responseError(ruleError, 400);

    if (normalizedOriginalEmail && !users.some((existing) => existing.email === normalizedOriginalEmail)) {
      return responseError("The account being edited no longer exists.", 404);
    }

    const inSheet = isDefaultOrganization && (await getDirectoryUsers()).some((existing) => existing.email === (normalizedOriginalEmail || normalizedEmail));
    if (isDefaultOrganization && (inSheet || !normalizedOriginalEmail)) {
      if (normalizedOriginalEmail) await updateDirectoryUser(normalizedOriginalEmail, normalizedUser);
      else await upsertDirectoryUser(normalizedUser);
    } else {
      await runWithTenantDatabase(target.organizationId, () => upsertPostgresDirectoryUser(target.organizationId, normalizedUser, normalizedOriginalEmail));
    }
    await syncOrganizationMembership({ organizationId: target.organizationId, email: normalizedUser.email, active: normalizedUser.active, previousEmail: normalizedOriginalEmail });

    return NextResponse.json({ success: true, message: "User account saved successfully." });
  } catch (error) {
    if (error instanceof z.ZodError) return responseError("Enter a valid name, email, role, and department.", 400);
    console.error("[API User Directory] SAVE failed:", error);
    return responseError("Unable to save the user account.", 500);
  }
}

export async function POST(request: Request) {
  return saveAccount(request);
}

export async function PATCH(request: Request) {
  const url = new URL(request.url);
  const originalEmail = url.searchParams.get("originalEmail") || undefined;
  if (!originalEmail) return responseError("The original account email is required.", 400);
  return saveAccount(request, originalEmail);
}

/** Reset only a self-registration credential so the same directory identity can register again. */
export async function DELETE(request: Request) {
  const access = await requireAdmin(request);
  if ("error" in access) return access.error;
  if (!isPlatformAdmin(access.user)) return responseError("Only a McLink platform administrator can reset registration credentials.", 403);

  const url = new URL(request.url);
  const email = normalizeEmail(url.searchParams.get("originalEmail"));
  if (!email) return responseError("The account email is required.", 400);
  if (email === normalizeEmail(access.user.email)) return responseError("You cannot reset your own registration credential.", 400);

  try {
    const target = await resolveTargetOrganization(request, access.user);
    if ("error" in target) return target.error;
    const users = await listOrganizationUsers(target.organizationId);
    if (!users.some((user) => user.email === email)) return responseError("The account being reset no longer exists.", 404);

    const [deleted] = await getDb()
      .delete(userCredentials)
      .where(and(eq(userCredentials.email, email), eq(userCredentials.organizationId, target.organizationId)))
      .returning({ id: userCredentials.id });
    if (!deleted) return responseError("No registration credential was found for this account.", 404);

    await syncOrganizationMembership({ organizationId: target.organizationId, email, active: false });
    return NextResponse.json({ success: true, message: "Registration reset. The user can register again with this email address." });
  } catch (error) {
    console.error("[API User Directory] RESET REGISTRATION failed:", error);
    return responseError("Unable to reset the registration.", 500);
  }
}
