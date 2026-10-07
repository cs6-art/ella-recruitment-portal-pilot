import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { portalSettings, users } from "@/db/schema-recruitment";
import { isPlatformAdmin } from "@/lib/access-control";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import { grantWelcomeCredits } from "@/lib/organization-welcome-credits";
import { getOrganizationReadiness } from "@/lib/organization-readiness";
import { listReleasedEmailKeys, withoutReleasedEmails } from "@/lib/released-emails";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Use 2–63 lowercase letters, numbers, or hyphens."),
  active: z.boolean().default(true),
  // Domain access is intentionally optional; each domain grants HR access to
  // every person who registers with an address at that domain.
  allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^(?:@)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "Enter domains like mcasia.com.")).max(20).default([]),
  allowedEmails: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses.")).max(100).default([]),
  // Most active people the organization may have. null removes the limit; leaving it out keeps the current one.
  maxMembers: z.number().int("Enter a whole number of people.").min(1, "The limit must be at least 1 person.").max(100000).nullable().optional(),
});

function cleanRules(input: z.infer<typeof organizationSchema>) {
  return {
    allowedDomains: [...new Set(input.allowedDomains.map((domain) => domain.replace(/^@/, "")))],
    allowedEmails: [...new Set(input.allowedEmails)],
  };
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

/**
 * Reject registrations that would match more than one organization's explicit
 * invite rules. An individual email is allowed to be an exception to another
 * organization's domain-wide rule because registration resolves exact email
 * matches before domain matches.
 */
async function ruleConflict(rules: ReturnType<typeof cleanRules>, ownId: string) {
  const rows = await getDb().select({ id: organizations.id, name: organizations.name, allowedDomains: organizations.allowedDomains, allowedEmails: organizations.allowedEmails }).from(organizations);
  // An address another organization has deactivated is released for reuse.
  const all = withoutReleasedEmails(rows, await listReleasedEmailKeys(rules.allowedEmails));
  for (const other of all.filter((row) => row.id !== ownId)) {
    const otherDomains = other.allowedDomains.map(normalizeDomain);
    const otherEmails = other.allowedEmails.map((email) => email.trim().toLowerCase());
    const duplicateDomain = rules.allowedDomains.find((value) => otherDomains.includes(normalizeDomain(value)));
    if (duplicateDomain) return `The @${duplicateDomain} domain already belongs to ${other.name}.`;
    const duplicateEmail = rules.allowedEmails.find((value) =>
      otherEmails.includes(value.trim().toLowerCase()),
    );
    if (duplicateEmail) return `${duplicateEmail} is already assigned to ${other.name}.`;
    const domainWithExistingInvite = rules.allowedDomains.find((domain) => otherEmails.some((email) => normalizeDomain(email.split("@")[1] || "") === normalizeDomain(domain)));
    if (domainWithExistingInvite) return `The @${domainWithExistingInvite} domain includes an email already invited to ${other.name}. Invite people individually instead.`;
  }
  return "";
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function requirePlatformAdmin() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { error: errorResponse("Authentication required.", 401) } as const;
  if (!isPlatformAdmin(user)) {
    return { error: errorResponse("Only a McLink platform administrator can manage organizations.", 403) } as const;
  }
  return { user } as const;
}

function publicOrganization(row: {
  id: string;
  name: string;
  slug: string;
  databaseStatus: string;
  active: boolean;
  allowedDomains: string[];
  allowedEmails: string[];
  maxMembers?: number | null;
  memberCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  // The internal tenant ID and database key stay server-side. Slugs are the
  // public, stable selector used by platform-admin UI requests.
  return {
    name: row.name,
    slug: row.slug,
    canEditSlug: row.databaseStatus === "pending",
    active: row.active,
    allowedDomains: row.allowedDomains,
    allowedEmails: row.allowedEmails,
    maxMembers: row.maxMembers ?? null,
    ...(row.memberCount === undefined ? {} : { memberCount: row.memberCount }),
    ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}),
    ...(row.updatedAt ? { updatedAt: row.updatedAt.toISOString() } : {}),
  };
}

export async function GET() {
  const access = await requirePlatformAdmin();
  if ("error" in access) return access.error;
  try {
    const rows = await getDb().select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      databaseStatus: organizations.databaseStatus,
      active: organizations.active,
      allowedDomains: organizations.allowedDomains,
      allowedEmails: organizations.allowedEmails,
      maxMembers: organizations.maxMembers,
      createdAt: organizations.createdAt,
      updatedAt: organizations.updatedAt,
    }).from(organizations).orderBy(organizations.name);
    const counts = await getDb().select({ organizationId: users.organizationId, total: sql<number>`count(*)::int` }).from(users).where(eq(users.active, true)).groupBy(users.organizationId);
    const memberCounts = new Map(counts.map((row) => [row.organizationId, Number(row.total)]));
    const items = await Promise.all(rows.map(async (row) => ({
      ...publicOrganization({ ...row, memberCount: memberCounts.get(row.id) ?? 0 }),
      readiness: await getOrganizationReadiness(row.id),
    })));
    return NextResponse.json({ success: true, organizations: items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Organizations] GET failed:", error);
    return errorResponse("Unable to load organizations.", 500);
  }
}

export async function POST(request: Request) {
  const access = await requirePlatformAdmin();
  if ("error" in access) return access.error;
  try {
    const input = organizationSchema.parse(await request.json());
    if (input.slug === "mclinkgroup") return errorResponse("The McLink organization already exists.", 409);
    // Ownership is automatic (the first verified registrant), so someone must be allowed to register.
    const rules = cleanRules(input);
    if (rules.allowedDomains.length === 0 && rules.allowedEmails.length === 0) return errorResponse("Add an allowed email domain or at least one email address so the first person can register and become the owner.", 400);
    const conflict = await ruleConflict(rules, "");
    if (conflict) return errorResponse(conflict, 409);

    const db = getDb();
    const id = randomUUID();
    const now = new Date();
    const [created] = await db.transaction(async (tx) => {
      const [organization] = await tx.insert(organizations).values({
        id,
        name: input.name,
        slug: input.slug,
        databaseKey: input.slug,
        databaseStatus: "shared",
        active: true,
        onboardingStartedAt: now,
        maxMembers: input.maxMembers ?? null,
        ...rules,
      }).returning({ id: organizations.id, name: organizations.name, slug: organizations.slug, databaseStatus: organizations.databaseStatus, active: organizations.active, allowedDomains: organizations.allowedDomains, allowedEmails: organizations.allowedEmails, maxMembers: organizations.maxMembers });
      await tx.insert(portalSettings).values([
        { organizationId: id, key: "Organization_Display_Name", value: input.name, category: "Branding", updatedBy: access.user.email },
        { organizationId: id, key: "Organization_Display_Subtitle", value: "Recruitment Portal", category: "Branding", updatedBy: access.user.email },
      ]);
      await grantWelcomeCredits(tx, id);
      return [organization];
    });

    return NextResponse.json({
      success: true,
      organization: publicOrganization(created),
      message: "Organization created. The first person to register with an allowed email and verify it becomes the organization owner.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message || "Enter a valid organization name and slug.", 400);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") return errorResponse("An organization with that slug already exists.", 409);
    console.error("[API Organizations] POST failed:", error);
    return errorResponse("Unable to create the organization.", 500);
  }
}

export async function PATCH(request: Request) {
  const access = await requirePlatformAdmin();
  if ("error" in access) return access.error;
  const slug = new URL(request.url).searchParams.get("slug")?.trim().toLowerCase() || "";
  if (!slug) return errorResponse("The organization slug is required.", 400);
  try {
    const input = organizationSchema.parse(await request.json());
    const [existing] = await getDb().select({ id: organizations.id, slug: organizations.slug, databaseKey: organizations.databaseKey, databaseStatus: organizations.databaseStatus }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (!existing) return errorResponse("Organization not found.", 404);
    if (existing.id === DEFAULT_ORGANIZATION_ID && (!input.active || input.slug !== existing.slug)) return errorResponse("The McLink organization cannot be deactivated or renamed.", 400);
    if (input.slug !== existing.slug && existing.databaseStatus !== "pending") return errorResponse("A provisioned organization cannot change its slug.", 409);
    const rules = cleanRules(input);
    const conflict = await ruleConflict(rules, existing.id);
    if (conflict) return errorResponse(conflict, 409);
    const [organization] = await getDb().update(organizations).set({ name: input.name, slug: input.slug, databaseKey: existing.databaseStatus === "pending" ? input.slug : existing.databaseKey, active: input.active, ...rules, ...(input.maxMembers === undefined ? {} : { maxMembers: input.maxMembers }), updatedAt: new Date() }).where(and(eq(organizations.id, existing.id), eq(organizations.databaseStatus, existing.databaseStatus))).returning({ id: organizations.id, name: organizations.name, slug: organizations.slug, databaseStatus: organizations.databaseStatus, active: organizations.active, allowedDomains: organizations.allowedDomains, allowedEmails: organizations.allowedEmails, maxMembers: organizations.maxMembers });
    return NextResponse.json({ success: true, organization: publicOrganization(organization), message: "Organization updated." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message || "Enter valid organization details.", 400);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") return errorResponse("An organization with that slug already exists.", 409);
    console.error("[API Organizations] PATCH failed:", error);
    return errorResponse("Unable to update the organization.", 500);
  }
}
