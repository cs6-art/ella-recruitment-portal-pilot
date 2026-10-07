import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema-recruitment";

export function releasedEmailKey(organizationId: string, email: string) {
  return `${organizationId}|${email.trim().toLowerCase()}`;
}

/**
 * An organization's explicit invite for an address stops counting once that
 * organization has deactivated the person, so the address can be registered or
 * invited into another organization. Keys are `organizationId|email`.
 */
export async function listReleasedEmailKeys(emails: string[]): Promise<Set<string>> {
  const wanted = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return new Set();
  const rows = await getDb()
    .select({ organizationId: users.organizationId, email: users.email })
    .from(users)
    .where(and(eq(users.active, false), inArray(sql`lower(trim(${users.email}))`, wanted)));
  return new Set(rows.map((row) => releasedEmailKey(row.organizationId, row.email)));
}

/** Drops invited addresses that the organization has released by deactivating them. */
export function withoutReleasedEmails<T extends { id: string; allowedEmails: string[] }>(rules: T[], released: Set<string>): T[] {
  if (!released.size) return rules;
  return rules.map((rule) => ({ ...rule, allowedEmails: rule.allowedEmails.filter((email) => !released.has(releasedEmailKey(rule.id, email))) }));
}
