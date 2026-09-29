import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { portalSettings } from "@/db/schema-recruitment";
import { currentTenantOrganizationId } from "@/lib/tenant-database";

export type StoredPortalSetting = { key: string; value: string; category: string; updatedAt: string; updatedBy: string };

/** Operational portal settings for one organization (previously the shared "Settings" sheet tab). */
export async function readPortalSettingRows(organizationId = currentTenantOrganizationId()): Promise<StoredPortalSetting[]> {
  const rows = await getDb().select().from(portalSettings).where(eq(portalSettings.organizationId, organizationId));
  return rows.map((row) => ({ key: row.key, value: row.value, category: row.category, updatedAt: row.updatedAt.toISOString(), updatedBy: row.updatedBy }));
}

export async function writePortalSettingRows(settings: { key: string; value: string; category: string; updatedBy: string }[], organizationId = currentTenantOrganizationId()): Promise<void> {
  const rows = settings.filter((setting) => setting.key.trim());
  if (rows.length === 0) return;
  await getDb().transaction(async (tx) => {
    for (const setting of rows) {
      await tx.insert(portalSettings).values({ organizationId, key: setting.key, value: setting.value, category: setting.category, updatedBy: setting.updatedBy })
        .onConflictDoUpdate({
          target: [portalSettings.organizationId, portalSettings.key],
          set: { value: setting.value, category: setting.category, updatedBy: setting.updatedBy, updatedAt: new Date() },
        });
    }
  });
}
