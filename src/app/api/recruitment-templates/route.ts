import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { canEditRecruitmentSetup } from "@/lib/access-control";
import { deleteRecruitmentTemplate, getRecruitmentTemplates, upsertRecruitmentTemplate, type RecruitmentTemplateRecord } from "@/lib/google-sheets";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { recruitmentSetupSchema } from "@/lib/recruitment-setup-schema";
import { COOKIE_NAME, getActiveSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUser() {
  return await getActiveSessionUser((await cookies()).get(COOKIE_NAME)?.value);
}

function responseError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function sheetSetupError(error: unknown, operation: string) {
  const message = error instanceof Error ? error.message : "";
  if (/Unable to parse range: Recruitment_Templates!/i.test(message)) {
    return responseError(
      `The Recruitment_Templates sheet tab is missing. Create it from data/sheet-templates/Recruitment_Templates.csv before ${operation}.`,
      503,
    );
  }
  return responseError(
    operation === "loading"
      ? "Unable to load recruitment templates."
      : `Unable to ${operation} recruitment template.`,
    operation === "loading" ? 500 : 400,
  );
}

export async function GET() {
  const user = await getUser();
  if (!user) return responseError("Authentication required.", 401);
  if (!canEditRecruitmentSetup(user)) return responseError("Only HR reviewers can manage recruitment templates.", 403);
  try {
    return NextResponse.json({ success: true, templates: await getRecruitmentTemplates() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[API Recruitment Templates] GET failed:", error);
    return sheetSetupError(error, "loading");
  }
}

async function readTemplate(request: Request): Promise<{ id?: string; name: string; sourceRoleId?: string; setup: Record<string, unknown> }> {
  const body = await request.json() as { id?: string; name?: string; sourceRoleId?: string; setup?: Record<string, unknown> };
  const name = String(body.name || "").trim();
  if (name.length < 2 || name.length > 80) throw new Error("Template name must be between 2 and 80 characters.");
  const parsed = recruitmentSetupSchema.parse(body.setup || {});
  return { id: body.id, name, sourceRoleId: String(body.sourceRoleId || "").trim(), setup: parsed as Record<string, unknown> };
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return responseError("Authentication required.", 401);
  if (!canEditRecruitmentSetup(user)) return responseError("Only HR reviewers can manage recruitment templates.", 403);
  const rate = consumeRateLimit(`template-write:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many template updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const input = await readTemplate(request);
    const now = new Date().toISOString();
    const template: RecruitmentTemplateRecord = { id: crypto.randomUUID(), name: input.name, sourceRoleId: input.sourceRoleId || "", setup: input.setup, createdAt: now, updatedAt: now, createdByName: user.name };
    await upsertRecruitmentTemplate(template);
    return NextResponse.json({ success: true, template });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return responseError("Complete the setup fields before saving a template.", 400);
    return sheetSetupError(error, "saving");
  }
}

export async function PUT(request: Request) {
  const user = await getUser();
  if (!user) return responseError("Authentication required.", 401);
  if (!canEditRecruitmentSetup(user)) return responseError("Only HR reviewers can manage recruitment templates.", 403);
  const rate = consumeRateLimit(`template-write:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many template updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const input = await readTemplate(request);
    if (!input.id) return responseError("Template ID is required.", 400);
    const existing = (await getRecruitmentTemplates()).find((template) => template.id === input.id);
    if (!existing) return responseError("Template not found.", 404);
    const template: RecruitmentTemplateRecord = { ...existing, name: input.name, sourceRoleId: input.sourceRoleId || existing.sourceRoleId, setup: input.setup, updatedAt: new Date().toISOString(), createdByName: user.name };
    await upsertRecruitmentTemplate(template);
    return NextResponse.json({ success: true, template });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") return responseError("Complete the setup fields before saving a template.", 400);
    return sheetSetupError(error, "updating");
  }
}

export async function DELETE(request: Request) {
  const user = await getUser();
  if (!user) return responseError("Authentication required.", 401);
  if (!canEditRecruitmentSetup(user)) return responseError("Only HR reviewers can manage recruitment templates.", 403);
  const rate = consumeRateLimit(`template-write:${user.email}:${requestClientKey(request)}`, 30, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many template updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return responseError("Template ID is required.", 400);
  try {
    await deleteRecruitmentTemplate(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API Recruitment Templates] DELETE failed:", error);
    return responseError("Unable to delete recruitment template.", 500);
  }
}
