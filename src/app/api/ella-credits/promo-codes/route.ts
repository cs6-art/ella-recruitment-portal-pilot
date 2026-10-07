import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isDatabaseConfigured } from "@/db/client";
import { canManageAllOrganizationCredits } from "@/lib/access-control";
import { normalizePromoCode, PROMO_CODE_PATTERN } from "@/lib/promo-code-rules";
import { createPromoCode, listPromoCodeRedemptions, listPromoCodes, setPromoCodeActive } from "@/lib/promo-codes";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No credit amount here on purpose: every code is worth PROMO_CODE_CREDITS.
const createSchema = z.object({
  code: z.string().transform(normalizePromoCode).refine((code) => PROMO_CODE_PATTERN.test(code), "Use 4–40 letters, numbers or dashes."),
  organizationId: z.string().trim().uuid("Choose a valid organization.").optional().or(z.literal("")),
  maxRedemptions: z.union([z.literal(""), z.coerce.number().int().min(1, "Use 1 or more, or leave it empty for no limit.").max(100_000)]).optional(),
  expiresAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid expiry date.").optional().or(z.literal("")),
  note: z.string().trim().max(300).optional(),
}).strict();

const updateSchema = z.object({ id: z.string().uuid(), active: z.boolean() }).strict();

/** Promo code management is a McLink platform power (McLink credit managers). */
async function manager() {
  const user = await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { response: NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 }) };
  if (!canManageAllOrganizationCredits(user)) return { response: NextResponse.json({ success: false, error: "Only McLink credit managers can manage promo codes." }, { status: 403 }) };
  if (!isDatabaseConfigured()) return { response: NextResponse.json({ success: false, error: "Promo codes are unavailable." }, { status: 503 }) };
  return { user };
}

export async function GET(request: Request) {
  const loaded = await manager();
  if ("response" in loaded) return loaded.response;
  try {
    const id = new URL(request.url).searchParams.get("redemptionsFor")?.trim();
    if (id) {
      if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ success: false, error: "Promo code not found." }, { status: 404 });
      return NextResponse.json({ success: true, redemptions: await listPromoCodeRedemptions(id) }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ success: true, codes: await listPromoCodes() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Promo Codes] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load promo codes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const loaded = await manager();
  if ("response" in loaded) return loaded.response;
  const rate = consumeRateLimit(`promo-manage:${loaded.user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many changes. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Check the promo code details." }, { status: 422 });
  // A code is valid through the end of its expiry day (Singapore time, the portal default).
  const expiresAt = parsed.data.expiresAt ? new Date(`${parsed.data.expiresAt}T23:59:59.999+08:00`) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) return NextResponse.json({ success: false, error: "Choose an expiry date in the future." }, { status: 422 });
  const maxRedemptions = typeof parsed.data.maxRedemptions === "number" ? parsed.data.maxRedemptions : null;
  try {
    const created = await createPromoCode({
      code: parsed.data.code,
      organizationId: parsed.data.organizationId || null,
      maxRedemptions,
      expiresAt,
      note: parsed.data.note,
      actorEmail: loaded.user.email,
    });
    if (!created) return NextResponse.json({ success: false, error: "That promo code already exists. Choose another code." }, { status: 409 });
    return NextResponse.json({ success: true, codes: await listPromoCodes() }, { status: 201 });
  } catch (error) {
    console.error("[API Promo Codes] POST failed:", error);
    return NextResponse.json({ success: false, error: "Unable to create the promo code." }, { status: 500 });
  }
}

/** Disable or re-enable a code. */
export async function PATCH(request: Request) {
  const loaded = await manager();
  if ("response" in loaded) return loaded.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Promo code not found." }, { status: 422 });
  try {
    const updated = await setPromoCodeActive({ id: parsed.data.id, active: parsed.data.active, actorEmail: loaded.user.email });
    if (!updated) return NextResponse.json({ success: false, error: "Promo code not found." }, { status: 404 });
    return NextResponse.json({ success: true, codes: await listPromoCodes() });
  } catch (error) {
    console.error("[API Promo Codes] PATCH failed:", error);
    return NextResponse.json({ success: false, error: "Unable to update the promo code." }, { status: 500 });
  }
}
