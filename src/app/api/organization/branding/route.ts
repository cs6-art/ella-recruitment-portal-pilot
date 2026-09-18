import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrganizationBranding, saveOrganizationBranding } from "@/lib/organization-branding";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const brandingSchema = z.object({
  name: z.string().trim().min(2, "Enter an organization name.").max(80),
  subtitle: z.string().trim().min(2, "Enter a short portal subtitle.").max(80),
});

async function currentUser() {
  return verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  try {
    const branding = await getOrganizationBranding(user.organizationId);
    return NextResponse.json({ success: true, branding }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Organization Branding] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load organization branding." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (user.canEditSettings !== true) return NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403 });
  const rate = consumeRateLimit(`organization-branding:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many branding updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const input = brandingSchema.parse(await request.json());
    const branding = await saveOrganizationBranding({ organizationId: user.organizationId, ...input, updatedBy: user.name });
    return NextResponse.json({ success: true, branding, message: "Organization branding saved successfully." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.issues[0]?.message || "Enter valid organization branding." }, { status: 400 });
    console.error("[API Organization Branding] PUT failed:", error);
    return NextResponse.json({ success: false, error: "Unable to save organization branding." }, { status: 500 });
  }
}
