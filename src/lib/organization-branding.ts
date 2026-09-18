import { and, eq } from "drizzle-orm";

import { organizations } from "@/db/schema";
import { getTenantDb } from "@/db/client";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import { portalSettings } from "@/db/schema-recruitment";

export const DEFAULT_ORGANIZATION_BRANDING = {
  name: "McLink",
  subtitle: "Recruitment Portal",
} as const;

const NAME_KEY = "Organization_Display_Name";
const SUBTITLE_KEY = "Organization_Display_Subtitle";

function clean(value: unknown, fallback: string, maxLength: number) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);
  return normalized || fallback;
}

async function defaultOrganizationName(organizationId: string) {
  if (organizationId === DEFAULT_ORGANIZATION_ID) return DEFAULT_ORGANIZATION_BRANDING.name;
  const rows = await getTenantDb()
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return clean(rows[0]?.name, DEFAULT_ORGANIZATION_BRANDING.name, 80);
}

export async function getOrganizationBranding(organizationId: string) {
  const rows = await getTenantDb()
    .select({ key: portalSettings.key, value: portalSettings.value })
    .from(portalSettings)
    .where(and(eq(portalSettings.organizationId, organizationId), eq(portalSettings.key, NAME_KEY)));
  const subtitleRows = await getTenantDb()
    .select({ value: portalSettings.value })
    .from(portalSettings)
    .where(and(eq(portalSettings.organizationId, organizationId), eq(portalSettings.key, SUBTITLE_KEY)));
  const fallbackName = await defaultOrganizationName(organizationId);
  return {
    name: clean(rows[0]?.value, fallbackName, 80),
    subtitle: clean(subtitleRows[0]?.value, DEFAULT_ORGANIZATION_BRANDING.subtitle, 80),
  };
}

export async function saveOrganizationBranding(input: { organizationId: string; name: string; subtitle: string; updatedBy: string }) {
  const name = clean(input.name, await defaultOrganizationName(input.organizationId), 80);
  const subtitle = clean(input.subtitle, DEFAULT_ORGANIZATION_BRANDING.subtitle, 80);
  const db = getTenantDb();
  await db
    .insert(portalSettings)
    .values([
      { organizationId: input.organizationId, key: NAME_KEY, value: name, category: "Branding", updatedBy: input.updatedBy },
      { organizationId: input.organizationId, key: SUBTITLE_KEY, value: subtitle, category: "Branding", updatedBy: input.updatedBy },
    ])
    .onConflictDoUpdate({
      target: [portalSettings.organizationId, portalSettings.key],
      set: { value: name, category: "Branding", updatedBy: input.updatedBy, updatedAt: new Date() },
    });

  // The two rows have different values; update the subtitle separately after
  // the shared upsert keeps the operation idempotent for both fresh and old
  // tenant databases.
  await db
    .update(portalSettings)
    .set({ value: subtitle, category: "Branding", updatedBy: input.updatedBy, updatedAt: new Date() })
    .where(and(eq(portalSettings.organizationId, input.organizationId), eq(portalSettings.key, SUBTITLE_KEY)));

  return { name, subtitle };
}
