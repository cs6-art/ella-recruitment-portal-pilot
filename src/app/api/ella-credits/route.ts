import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, isDatabaseConfigured } from "@/db/client";
import { organizations } from "@/db/schema";
import { canManageAllOrganizationCredits, canManageCredits } from "@/lib/access-control";
import { getCreditBalance, getCreditPricing, recordTopUp } from "@/lib/ella-credits";
import { getDirectoryUsers } from "@/lib/google-sheets";
import { getPostgresDirectoryUsers } from "@/lib/postgres-directory";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization-accounts";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/safe-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual / demo credit top-up. Positive whole number only, a mandatory reason,
// and an optional external reference. Every adjustment is an immutable ledger
// entry that records the actor, amount, reason, reference, timestamp, and
// resulting balance — there is no path that edits the balance without one.
const topUpSchema = z.object({
  amount: z
    .number()
    .int("Amount must be a whole number.")
    .positive("Amount must be greater than zero.")
    .max(1_000_000, "Amount is out of range."),
  note: z.string().trim().min(1, "A reason is required.").max(500),
  reference: z.string().trim().max(200).optional(),
  organizationId: z.string().trim().uuid("Choose a valid organization.").optional(),
});

type CreditOrganization = { id: string; name: string; active: boolean };

async function listCreditOrganizations(): Promise<CreditOrganization[]> {
  if (!isDatabaseConfigured()) return [];
  return await getDb()
    .select({ id: organizations.id, name: organizations.name, active: organizations.active })
    .from(organizations)
    .orderBy(asc(organizations.name));
}

type SessionUserValue = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

// Resolves which organization's shared balance a request targets. Everyone
// defaults to their own org; only McLink credit managers may name another one.
async function resolveTargetOrganization(user: SessionUserValue, requested: string | null | undefined): Promise<{ id: string; name?: string } | { error: string; status: number }> {
  const organizationId = requested?.trim();
  if (!organizationId || organizationId === user.organizationId) return { id: user.organizationId };
  if (!canManageAllOrganizationCredits(user)) return { error: "You can only manage your own organization's credits.", status: 403 };
  if (!isDatabaseConfigured()) return { error: "Organization credits are unavailable.", status: 503 };
  const [organization] = await getDb()
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return { error: "Organization not found.", status: 404 };
  return { id: organization.id, name: organization.name };
}

async function currentUser() {
  return await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
}

async function displayCreditActors<T extends { actorName: string; actorEmail: string }>(entries: T[], organizationId: string) {
  try {
    const directory = organizationId === DEFAULT_ORGANIZATION_ID
      ? await getDirectoryUsers()
      : await getPostgresDirectoryUsers(organizationId);
    const names = new Map<string, string>(directory.map((directoryUser) => [directoryUser.email.trim().toLowerCase(), directoryUser.fullName.trim()] as const).filter(([email, name]) => email && name));
    return entries.map((entry) => {
      const email = entry.actorEmail.trim().toLowerCase();
      const actorName = entry.actorName.trim();
      const directoryName = names.get(email);
      return {
        ...entry,
        actorName: directoryName && (!actorName || actorName.toLowerCase() === email) ? directoryName : actorName,
      };
    });
  } catch (error) {
    // Ledger reads must remain available if an optional directory source is
    // temporarily unavailable; actorEmail remains the audit fallback.
    console.error("[API Smile Credits] actor-name lookup failed:", error);
    return entries;
  }
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  try {
    // Every authenticated member can inspect the immutable, organization-
    // scoped ledger. Mutation remains restricted to canManageCredits below.
    // McLink credit managers may also open another organization's ledger.
    const target = await resolveTargetOrganization(user, new URL(request.url).searchParams.get("organizationId"));
    if ("error" in target) return NextResponse.json({ success: false, error: target.error }, { status: target.status });
    const crossOrganization = canManageAllOrganizationCredits(user);
    const [{ balance, totals, entries }, pricing, organizationList] = await Promise.all([
      getCreditBalance({ organizationId: target.id, ownerEmail: user.email }),
      getCreditPricing(),
      crossOrganization ? listCreditOrganizations() : Promise.resolve(undefined),
    ]);
    return NextResponse.json({
      success: true,
      organizationId: target.id,
      ...(organizationList ? { organizations: organizationList } : {}),
      balance,
      totals,
      // Both storage backends can return a different natural row order. The
      // activity feed is explicitly newest-first so the UI always shows the
      // latest credit changes at the top.
      entries: (await displayCreditActors(entries, target.id))
        .slice()
        .sort((left, right) => {
          const leftTime = Date.parse(left.timestamp);
          const rightTime = Date.parse(right.timestamp);
          if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
          return String(right.timestamp).localeCompare(String(left.timestamp));
        })
        .slice(0, 100),
      pricing,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Smile Credits] GET failed:", error);
    return NextResponse.json({ success: false, error: "Unable to load the Smile Credits ledger." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  if (!canManageCredits(user)) return NextResponse.json({ success: false, error: "Smile Credits permission required." }, { status: 403 });

  const rate = consumeRateLimit(`ella-credits:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many credit updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });

  try {
    const parsed = topUpSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Enter a positive whole number and a short reason." },
        { status: 422 },
      );
    }
    const target = await resolveTargetOrganization(user, parsed.data.organizationId);
    if ("error" in target) return NextResponse.json({ success: false, error: target.error }, { status: target.status });
    // Stable idempotency key so a double-submit (network retry) does not add
    // credits twice: actor + amount + reason + reference, per 15-minute window.
    const window = Math.floor(Date.now() / (15 * 60 * 1000));
    const idempotencyKey =
      request.headers.get("Idempotency-Key")?.trim() ||
      `manual:${target.id}:${user.email}:${parsed.data.amount}:${parsed.data.note}:${parsed.data.reference || ""}:${window}`;

    const { balance, totals, bonus } = await recordTopUp({
      amount: parsed.data.amount,
      event: "manual_topup",
      note: parsed.data.note,
      reference: parsed.data.reference,
      idempotencyKey,
      actorName: user.name,
      actorEmail: user.email,
      organizationId: target.id,
    });
    const recipient = target.name ? ` to ${target.name}` : "";
    const message = bonus > 0
      ? `Added ${parsed.data.amount} credits${recipient} plus a ${bonus}-credit volume discount. Balance is now ${balance}.`
      : `Added ${parsed.data.amount} credits${recipient}. Balance is now ${balance}.`;
    return NextResponse.json({
      success: true,
      organizationId: target.id,
      balance,
      totals,
      bonus,
      message,
      actor: { name: user.name, email: user.email },
      amount: parsed.data.amount,
      reason: parsed.data.note,
      reference: parsed.data.reference || "",
    });
  } catch (error) {
    console.error("[API Smile Credits] POST failed:", error);
    return NextResponse.json({ success: false, error: publicErrorMessage(error, "Unable to update the balance.", "API Ella Credits") }, { status: 500 });
  }
}
