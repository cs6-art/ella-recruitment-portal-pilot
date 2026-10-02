import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isPlatformAdmin } from "@/lib/access-control";
import { defaultPortalSettings, getPortalSettings, upsertPortalSettings } from "@/lib/google-sheets";
import { PORTAL_CONFIG_CATALOG, resolvePortalConfigValue } from "@/lib/portal-config";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configByKey = new Map(PORTAL_CONFIG_CATALOG.map((entry) => [entry.key, entry]));
// These values live in ONE shared Settings sheet and apply to every
// organization, so only the McLink platform administrator may read or change
// them. Organization HR accounts manage branding and their calendar instead.
// Only expose settings that are backed by live runtime behaviour. Hosting
// environment variables, webhook endpoints, and legacy sheet-only values are
// intentionally kept out of the HR-facing Settings page.
const editableSettingKeys = new Set([
  "Final_Interview_Calendar_Email",
  "Final_Interview_Calendar_ID",
  "Booking_Link_Expiry_Days",
  "Resume_Screening_Link_Expiry_Days",
  "Bulk_Resume_Upload_Concurrency",
  "Bulk_Resume_Notify_On_Success",
  "Voice_Call_Max_Attempts",
  "Voice_Call_Retry_Gap_Hours",
  "Ella_Credit_Discount_Threshold",
  "Ella_Credit_Discount_Percent",
]);
const secretKey = (key: string) => /(secret|password|token|private.?key|credential|api.?key)/i.test(key);

function settingsForEditor(stored: Awaited<ReturnType<typeof getPortalSettings>>) {
  const storedByKey = new Map(stored.map((setting) => [setting.key, setting]));
  return [...defaultPortalSettings.map((setting) => storedByKey.get(setting.key) || setting), ...stored.filter((setting) => !defaultPortalSettings.some((defaultSetting) => defaultSetting.key === setting.key))]
    .filter((setting) => !secretKey(setting.key) && editableSettingKeys.has(setting.key))
    .map((setting) => {
      const storedSetting = storedByKey.get(setting.key);
      const entry = configByKey.get(setting.key);
      if (entry) {
        // Keep the editable value blank when it is not overridden; the effective
        // value is still shown so clearing a field reliably restores its fallback.
        const rawValue = storedSetting?.value?.trim() || "";
        const resolved = resolvePortalConfigValue(setting.key, stored);
        return { ...setting, value: rawValue, effectiveValue: resolved.value, source: resolved.source, type: entry.type, min: entry.min, max: entry.max };
      }

      // Calendar defaults are not part of the env-backed catalog, so resolve
      // their displayed value and source from the stored row or built-in value.
      const rawValue = storedSetting?.value?.trim() || "";
      const fallback = defaultPortalSettings.find((defaultSetting) => defaultSetting.key === setting.key)?.value || "";
      return {
        ...setting,
        value: storedSetting?.value?.trim() || "",
        effectiveValue: rawValue || fallback,
        source: rawValue ? "stored" as const : "default" as const,
        type: "text" as const,
      };
    });
}

function validateConfigValue(key: string, rawValue: string): string | null {
  const entry = configByKey.get(key);
  if (!entry) return null;
  const value = rawValue.trim();
  if (!value) return null; // blank clears the override
  if (entry.type === "url") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `${entry.key} must be an http(s) URL.`;
    } catch {
      return `${entry.key} must be a valid URL.`;
    }
  }
  if (entry.type === "number") {
    const numeric = Number(value);
    if (!Number.isInteger(numeric)) return `${entry.key} must be a whole number.`;
    if (entry.min !== undefined && numeric < entry.min) return `${entry.key} must be at least ${entry.min}.`;
    if (entry.max !== undefined && numeric > entry.max) return `${entry.key} must be at most ${entry.max}.`;
  }
  if (entry.type === "choice" && !["Yes", "No"].includes(value)) {
    return `${entry.key} must be Yes or No.`;
  }
  return null;
}

const settingSchema = z.object({ key: z.string().trim().min(1).max(200), value: z.string().max(10000), category: z.string().trim().max(100), description: z.string().max(1000), updatedAt: z.string().optional(), updatedBy: z.string().optional() });
const settingsSchema = z.object({ settings: z.array(settingSchema).max(500) });

async function currentUser() {
  return await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canEditSettings !== true || !isPlatformAdmin(user)) return NextResponse.json({ success: false, error: "Only the McLink platform administrator can view shared portal settings." }, { status: 403 });
  try {
    const stored = await getPortalSettings();
    const settings = settingsForEditor(stored).map((setting) => ({ ...setting, connectionStatus: "active" as const }));
    return NextResponse.json({ success: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Settings] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load portal settings." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canEditSettings !== true || !isPlatformAdmin(user)) return NextResponse.json({ success: false, error: "Only the McLink platform administrator can change shared portal settings." }, { status: 403 });
  const rate = consumeRateLimit(`settings:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many settings updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const input = settingsSchema.parse(await request.json());
    for (const setting of input.settings) {
      if (!editableSettingKeys.has(setting.key) || secretKey(setting.key)) {
        return NextResponse.json({ success: false, error: `${setting.key} is not editable from the portal.` }, { status: 400 });
      }
      if (setting.key === "Final_Interview_Calendar_Email" && setting.value.trim() && !z.string().email().safeParse(setting.value.trim()).success) {
        return NextResponse.json({ success: false, error: "HR interview calendar email must be a valid email address." }, { status: 400 });
      }
      if (setting.key === "Final_Interview_Calendar_ID" && setting.value.trim() && !/^[A-Za-z0-9._@-]+$/.test(setting.value.trim())) {
        return NextResponse.json({ success: false, error: "HR interview calendar ID contains invalid characters." }, { status: 400 });
      }
      const configError = validateConfigValue(setting.key, setting.value);
      if (configError) return NextResponse.json({ success: false, error: configError }, { status: 400 });
    }
    const existing = await getPortalSettings();
    const submitted = new Map(input.settings.map((setting) => [setting.key, setting]));
    const updatedAt = new Date().toISOString();
    const merged = existing.map((setting) => {
      const incoming = submitted.get(setting.key);
      if (!incoming || secretKey(setting.key)) return setting;
      return { ...setting, value: incoming.value, updatedAt, updatedBy: user.name };
    });
    for (const setting of input.settings) {
      if (existing.some((current) => current.key === setting.key) || secretKey(setting.key)) continue;
      const defaults = defaultPortalSettings.find((current) => current.key === setting.key);
      merged.push({ ...(defaults || setting), value: setting.value, updatedAt, updatedBy: user.name });
    }
    await upsertPortalSettings(merged);
    return NextResponse.json({
      success: true,
      message: "Settings saved successfully.",
      settings: settingsForEditor(merged).map((setting) => ({ ...setting, connectionStatus: "active" as const })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: "Those settings are not valid. Please check them and try again." }, { status: 400 });
    console.error("[API Settings] PUT failed:", error);
    return NextResponse.json({ success: false, error: "Unable to save portal settings." }, { status: 500 });
  }
}
