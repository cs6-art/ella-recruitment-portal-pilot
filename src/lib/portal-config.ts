import { getPortalSettings } from "@/lib/google-sheets";
import {
  PORTAL_CONFIG_CATALOG,
  resolvePortalConfigValue,
  type PortalConfigKey,
} from "@/lib/portal-config-catalog";

export {
  PORTAL_CONFIG_CATALOG,
  isEnabledChoice,
  resolvePortalConfigValue,
  type PortalConfigEntry,
  type PortalConfigKey,
  type PortalConfigSource,
  type PortalConfigType,
} from "@/lib/portal-config-catalog";

/**
 * Resolves operational portal configuration. A non-empty value in the Settings
 * sheet wins; the env var is the fallback / first-run default; the catalog
 * default is the last resort.
 */

export type PortalConfig = Record<string, string>;

/** Resolve every catalog key. One cached Settings read. */
export async function getPortalConfig(): Promise<PortalConfig> {
  let settings: { key: string; value: string }[] = [];
  try {
    settings = await getPortalSettings();
  } catch (error) {
    // A Settings read failure must not take down a workflow route — fall back
    // to env + defaults, which is exactly the pre-Settings behaviour.
    console.error("[Portal Config] Falling back to env/defaults; Settings read failed:", error);
  }
  const config: PortalConfig = {};
  for (const entry of PORTAL_CONFIG_CATALOG) {
    config[entry.key] = resolvePortalConfigValue(entry.key, settings).value;
  }
  return config;
}

export async function getPortalConfigValue(key: PortalConfigKey): Promise<string> {
  return (await getPortalConfig())[key] ?? "";
}

export async function getPortalConfigNumber(key: PortalConfigKey, fallback: number): Promise<number> {
  const parsed = Number(await getPortalConfigValue(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}
