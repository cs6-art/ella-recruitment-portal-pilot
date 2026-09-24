import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { isPlatformAdmin } from "@/lib/access-control";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "Use 2–63 lowercase letters, numbers, or hyphens."),
  active: z.boolean().default(true),
  // Who may self-register into this organization: whole email domains
  // ("mcasia.com") and/or individual addresses of any domain.
  allowedDomains: z.array(z.string().trim().toLowerCase().regex(/^(?:@)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "Enter domains like mcasia.com.")).max(20).default([]),
  allowedEmails: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses.")).max(100).default([]),
});

const organizationColumns = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  databaseKey: organizations.databaseKey,
  databaseStatus: organizations.databaseStatus,
  active: organizations.active,
  allowedDomains: organizations.allowedDomains,
  allowedEmails: organizations.allowedEmails,
};

function cleanRules(input: z.infer<typeof organizationSchema>) {
  return {
    allowedDomains: [...new Set(input.allowedDomains.map((domain) => domain.replace(/^@/, "")))],
    allowedEmails: [...new Set(input.allowedEmails)],
  };
}

/** A domain or address may register into only one organization, or its users would be ambiguous. */
async function ruleConflict(rules: ReturnType<typeof cleanRules>, ownId: string) {
  const all = await getDb().select({ id: organizations.id, name: organizations.name, allowedDomains: organizations.allowedDomains, allowedEmails: organizations.allowedEmails }).from(organizations);
  const rows = all.filter((row) => row.id !== ownId);
  for (const other of rows) {
    const domain = rules.allowedDomains.find((value) => other.allowedDomains.includes(value));
    if (domain) return `${domain} already belongs to ${other.name}.`;
    const email = rules.allowedEmails.find((value) => other.allowedEmails.includes(value));
    if (email) return `${email} already belongs to ${other.name}.`;
  }
  return "";
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function requirePlatformAdmin() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { error: errorResponse("Authentication required.", 401) } as const;
  if (!isPlatformAdmin(user)) {
    return { error: errorResponse("Only a McLink platform administrator can manage organizations.", 403) } as const;
  }
  return { user } as const;
}

export async function GET() {
  const access = await requirePlatformAdmin();
  if ("error" in access) return access.error;
  try {
    const items = await getDb().select({ ...organizationColumns, createdAt: organizations.createdAt, updatedAt: organizations.updatedAt }).from(organizations).orderBy(organizations.name);
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
    const rules = cleanRules(input);
    const conflict = await ruleConflict(rules, "");
    if (conflict) return errorResponse(conflict, 409);
    const [organization] = await getDb().insert(organizations).values({ id: randomUUID(), name: input.name, slug: input.slug, databaseKey: input.slug, databaseStatus: "shared", active: input.active, ...rules }).returning(organizationColumns);
    return NextResponse.json({ success: true, organization, message: "Organization created. People with an allowed email can now register and will land in this organization's empty, isolated workspace." }, { status: 201, headers: { "Cache-Control": "no-store" } });
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
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  if (!id) return errorResponse("The organization ID is required.", 400);
  try {
    const input = organizationSchema.parse(await request.json());
    const [existing] = await getDb().select({ id: organizations.id, slug: organizations.slug, databaseKey: organizations.databaseKey, databaseStatus: organizations.databaseStatus }).from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!existing) return errorResponse("Organization not found.", 404);
    if (id === DEFAULT_ORGANIZATION_ID && (!input.active || input.slug !== existing.slug)) return errorResponse("The McLink organization cannot be deactivated or renamed.", 400);
    if (input.slug !== existing.slug && existing.databaseStatus !== "pending") return errorResponse("A provisioned organization cannot change its slug.", 409);
    const rules = cleanRules(input);
    const conflict = await ruleConflict(rules, id);
    if (conflict) return errorResponse(conflict, 409);
    const [organization] = await getDb().update(organizations).set({ name: input.name, slug: input.slug, databaseKey: existing.databaseStatus === "pending" ? input.slug : existing.databaseKey, active: input.active, ...rules, updatedAt: new Date() }).where(and(eq(organizations.id, id), eq(organizations.databaseStatus, existing.databaseStatus))).returning(organizationColumns);
    return NextResponse.json({ success: true, organization, message: "Organization updated." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message || "Enter valid organization details.", 400);
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") return errorResponse("An organization with that slug already exists.", 409);
    console.error("[API Organizations] PATCH failed:", error);
    return errorResponse("Unable to update the organization.", 500);
  }
}
