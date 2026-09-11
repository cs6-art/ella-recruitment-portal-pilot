import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDirectoryUsers, updateDirectoryUser, upsertDirectoryUser, type DirectoryUser } from "@/lib/google-sheets";
import { syncOrganizationMembership } from "@/lib/organization-accounts";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

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
  if (user.canManageUsers !== true && user.canEditSettings !== true) return { error: responseError("User account administration permission required.", 403) } as const;
  const rate = consumeRateLimit(`user-directory:${user.email}:${requestClientKey(request)}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) {
    return { error: NextResponse.json({ success: false, error: "Too many account updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) }) } as const;
  }
  return { user } as const;
}

export async function GET(request: Request) {
  const access = await requireAdmin(request);
  if ("error" in access) return access.error;

  try {
    const users = await getDirectoryUsers();
    return NextResponse.json({ success: true, users }, { headers: { "Cache-Control": "no-store" } });
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

  try {
    const user = userSchema.parse(await request.json());
    const normalizedEmail = user.email.toLowerCase();
    const normalizedUser: DirectoryUser = {
      email: normalizedEmail,
      fullName: user.fullName,
      accessRole: user.accessRole,
      department: user.department,
      canCreateRole: user.canCreateRole,
      canReviewRole: user.canReviewRole,
      canApproveRole: user.canApproveRole,
      canEditSettings: user.canEditSettings,
      canManageUsers: user.canManageUsers,
      canReviewDepartmentRole: user.canReviewDepartmentRole,
      active: user.active,
    };
    const users = await getDirectoryUsers();
    const normalizedOriginalEmail = originalEmail?.trim().toLowerCase();
    const duplicate = users.some((existing) => existing.email === normalizedEmail && existing.email !== normalizedOriginalEmail);
    if (duplicate) return responseError("An account already exists for that email address.", 409);

    const ruleError = validateAccountRules(normalizedUser, access.user.email, originalEmail);
    if (ruleError) return responseError(ruleError, 400);

    if (normalizedOriginalEmail && !users.some((existing) => existing.email === normalizedOriginalEmail)) {
      return responseError("The account being edited no longer exists.", 404);
    }

    if (normalizedOriginalEmail) await updateDirectoryUser(normalizedOriginalEmail, normalizedUser);
    else await upsertDirectoryUser(normalizedUser);
    await syncOrganizationMembership({ organizationId: access.user.organizationId, email: normalizedUser.email, active: normalizedUser.active, previousEmail: normalizedOriginalEmail });

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
