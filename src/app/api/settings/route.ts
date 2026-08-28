import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { defaultPortalSettings, getPortalSettings, upsertPortalSettings } from "@/lib/google-sheets";
import { PORTAL_CONFIG_CATALOG, resolvePortalConfigValue } from "@/lib/portal-config";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configByKey = new Map(PORTAL_CONFIG_CATALOG.map((entry) => [entry.key, entry]));
const runtimeSettingKeys = new Set([
  "Voice_Interview_Duration_Minutes",
  "Final_Interview_Calendar_Email",
  "Final_Interview_Calendar_ID",
  ...PORTAL_CONFIG_CATALOG.map((entry) => entry.key),
]);

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
const secretKey = (key: string) => /(secret|password|token|private.?key|credential|api.?key)/i.test(key);

async function currentUser() {
  return verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403 });
  try {
    const stored = await getPortalSettings();
    const storedByKey = new Map(stored.map((setting) => [setting.key, setting]));
    const settings = [...defaultPortalSettings.map((setting) => storedByKey.get(setting.key) || setting), ...stored.filter((setting) => !defaultPortalSettings.some((defaultSetting) => defaultSetting.key === setting.key))]
      .filter((setting) => !secretKey(setting.key))
      .map((setting) => {
        const base = { ...setting, connectionStatus: runtimeSettingKeys.has(setting.key) ? "active" : "stored" };
        // Config keys keep their raw sheet value (blank = not overridden) so a
        // save never accidentally freezes the env value into the sheet. The
        // resolved value is exposed separately for display, with `source`
        // driving the UI badge.
        const entry = configByKey.get(setting.key);
        if (entry) {
          const rawValue = storedByKey.get(setting.key)?.value?.trim() || "";
          const resolved = resolvePortalConfigValue(setting.key, stored);
          return { ...base, value: rawValue, effectiveValue: resolved.value, source: resolved.source, type: entry.type };
        }
        return { ...base, source: "stored" as const };
      });
    return NextResponse.json({ success: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Settings] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load portal settings." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403 });
  const rate = consumeRateLimit(`settings:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many settings updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const input = settingsSchema.parse(await request.json());
    for (const setting of input.settings) {
      if (setting.key === "Final_Interview_Calendar_Email" && !z.string().email().safeParse(setting.value.trim()).success) {
        return NextResponse.json({ success: false, error: "HR interview calendar email must be a valid email address." }, { status: 400 });
      }
      if (setting.key === "Final_Interview_Calendar_ID" && !/^[A-Za-z0-9._@-]+$/.test(setting.value.trim())) {
        return NextResponse.json({ success: false, error: "HR interview calendar ID contains invalid characters." }, { status: 400 });
      }
      const configError = validateConfigValue(setting.key, setting.value);
      if (configError) return NextResponse.json({ success: false, error: configError }, { status: 400 });
    }
    const existing = await getPortalSettings();
    const submitted = new Map(input.settings.map((setting) => [setting.key, setting]));
    const merged = existing.map((setting) => secretKey(setting.key) ? setting : (submitted.get(setting.key) || setting));
    for (const setting of input.settings) if (!existing.some((current) => current.key === setting.key) && !secretKey(setting.key)) merged.push({ ...setting, updatedAt: new Date().toISOString(), updatedBy: user.name });
    await upsertPortalSettings(merged.map((setting) => ({ ...setting, updatedAt: new Date().toISOString(), updatedBy: user.name })));
    return NextResponse.json({ success: true, message: "Settings saved successfully." });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: "Invalid settings payload." }, { status: 400 });
    console.error("[API Settings] PUT failed:", error);
    return NextResponse.json({ success: false, error: "Unable to save portal settings." }, { status: 500 });
  }
}
