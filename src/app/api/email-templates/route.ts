import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { listEmailTemplates, resetEmailTemplate, saveEmailTemplate } from "@/lib/email-template-store";
import { EMAIL_EVENTS, editableEmailEvent, validateEmailTemplate } from "@/lib/email-templates";
import { consumeRateLimit, rateLimitHeaders, requestClientKey } from "@/lib/rate-limit";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function settingsUser() {
  const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
  if (!user) return { error: NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 }) };
  if (user.canEditSettings !== true) return { error: NextResponse.json({ success: false, error: "Settings permission required." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const { user, error } = await settingsUser();
  if (!user) return error;
  try {
    const saved = await listEmailTemplates(user.organizationId);
    const templates = EMAIL_EVENTS.filter((event) => event.editable).map((event) => {
      const custom = saved.get(event.key);
      return {
        key: event.key,
        label: event.label,
        audience: event.audience,
        when: event.when,
        placeholders: event.placeholders,
        defaultSubject: event.subject,
        defaultBody: event.body,
        subject: custom?.subject || event.subject,
        body: custom?.body || event.body,
        customized: Boolean(custom),
        updatedBy: custom?.updatedBy || "",
        updatedAt: custom?.updatedAt.toISOString() || "",
      };
    });
    return NextResponse.json({ success: true, templates }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    console.error("[API Email Templates] GET failed:", caught);
    return NextResponse.json({ success: false, error: "Unable to load the email templates." }, { status: 500 });
  }
}

const saveSchema = z.object({ eventType: z.string().trim().min(1), subject: z.string(), body: z.string() });

export async function PUT(request: Request) {
  const { user, error } = await settingsUser();
  if (!user) return error;
  const rate = consumeRateLimit(`email-templates:${user.email}:${requestClientKey(request)}`, 60, 15 * 60 * 1000);
  if (!rate.allowed) return NextResponse.json({ success: false, error: "Too many updates. Try again later." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const input = saveSchema.parse(await request.json());
    const problem = validateEmailTemplate(input.eventType, input.subject, input.body);
    if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });
    await saveEmailTemplate({ organizationId: user.organizationId, eventType: input.eventType, subject: input.subject.trim(), body: input.body.replace(/\r\n/g, "\n").trim(), updatedBy: user.name || user.email });
    return NextResponse.json({ success: true, message: "Email saved. It applies to emails sent from now on." });
  } catch (caught) {
    if (caught instanceof z.ZodError) return NextResponse.json({ success: false, error: "Enter a subject and the email text." }, { status: 400 });
    console.error("[API Email Templates] PUT failed:", caught);
    return NextResponse.json({ success: false, error: "Unable to save the email." }, { status: 500 });
  }
}

/** Restores the built-in wording for one email. */
export async function DELETE(request: Request) {
  const { user, error } = await settingsUser();
  if (!user) return error;
  const eventType = new URL(request.url).searchParams.get("eventType")?.trim() || "";
  if (!editableEmailEvent(eventType)) return NextResponse.json({ success: false, error: "Unknown email." }, { status: 400 });
  try {
    await resetEmailTemplate(user.organizationId, eventType);
    return NextResponse.json({ success: true, message: "The original wording was restored." });
  } catch (caught) {
    console.error("[API Email Templates] DELETE failed:", caught);
    return NextResponse.json({ success: false, error: "Unable to restore the email." }, { status: 500 });
  }
}
