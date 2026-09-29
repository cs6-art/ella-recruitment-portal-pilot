import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db/client";
import { emailTemplates } from "@/db/schema-recruitment";
import { getOrganizationBranding } from "@/lib/organization-branding";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import type { EmailOverride } from "@/lib/email-templates";

export type StoredEmailTemplate = Required<EmailOverride> & { updatedAt: Date; updatedBy: string };

function toOverride(row: typeof emailTemplates.$inferSelect): Required<EmailOverride> {
  return { subject: row.subject, body: row.body, ctaLabel: row.ctaLabel, secondaryCtaLabel: row.secondaryCtaLabel, imageUrl: row.imageUrl, imageAlt: row.imageAlt };
}

export async function listEmailTemplates(organizationId: string): Promise<Map<string, StoredEmailTemplate>> {
  const rows = await getDb().select().from(emailTemplates).where(eq(emailTemplates.organizationId, organizationId));
  return new Map(rows.map((row) => [row.eventType, { ...toOverride(row), updatedAt: row.updatedAt, updatedBy: row.updatedBy }]));
}

export async function saveEmailTemplate(input: { organizationId: string; eventType: string; updatedBy: string } & Required<EmailOverride>) {
  const values = { subject: input.subject, body: input.body, ctaLabel: input.ctaLabel, secondaryCtaLabel: input.secondaryCtaLabel, imageUrl: input.imageUrl, imageAlt: input.imageAlt, updatedBy: input.updatedBy };
  await getDb().insert(emailTemplates).values({ organizationId: input.organizationId, eventType: input.eventType, ...values })
    .onConflictDoUpdate({ target: [emailTemplates.organizationId, emailTemplates.eventType], set: { ...values, updatedAt: new Date() } });
}

/** Removing the row restores the built-in default wording. */
export async function resetEmailTemplate(organizationId: string, eventType: string) {
  await getDb().delete(emailTemplates).where(and(eq(emailTemplates.organizationId, organizationId), eq(emailTemplates.eventType, eventType)));
}

/** The name used in subjects, bodies and sign-offs: the organization's display name. */
export async function companyNameFor(organizationId: string): Promise<string> {
  const { name } = await getOrganizationBranding(organizationId);
  // The original organization was always signed "McLink Group"; keep that until it sets its own name.
  return organizationId === DEFAULT_ORGANIZATION_ID && name === "McLink" ? "McLink Group" : name;
}

export type OrganizationEmailContext = { companyName: string; templates: Map<string, EmailOverride> };

/** Company name and edited templates for each organization in a batch of queued emails. */
export async function loadEmailContexts(organizationIds: string[]): Promise<Map<string, OrganizationEmailContext>> {
  const ids = [...new Set(organizationIds.filter(Boolean))];
  const contexts = new Map<string, OrganizationEmailContext>();
  if (!ids.length) return contexts;
  // Sending must never stop because wording could not be loaded (for example
  // before migrations 0030 and 0031 have been applied): fall back to the default text.
  const rows = await getDb().select().from(emailTemplates).where(inArray(emailTemplates.organizationId, ids)).catch((error: unknown) => {
    console.error("[Email Templates] Could not load organization templates; using defaults:", error);
    return [];
  });
  for (const id of ids) {
    contexts.set(id, {
      companyName: await companyNameFor(id),
      templates: new Map(rows.filter((row) => row.organizationId === id).map((row) => [row.eventType, toOverride(row)])),
    });
  }
  return contexts;
}
