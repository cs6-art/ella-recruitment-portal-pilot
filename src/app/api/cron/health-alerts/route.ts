import { NextResponse } from "next/server";

import { isPostgresRecruitmentTarget } from "@/lib/recruitment-target-mode";
import { collectHealthIssues, formatHealthDigest } from "@/lib/system-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function suppliedSecret(request: Request) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (bearer || request.headers.get("x-cron-secret") || "").trim();
}

// Reuses the portal's existing n8n email webhook, whose payload carries a
// ready-made subject, heading and message, so no new workflow is required.
async function emailDigest(recipients: string[], digest: string) {
  const url = process.env.N8N_VERIFICATION_EMAIL_WEBHOOK_URL?.trim();
  const secret = process.env.N8N_WEBHOOK_SECRET?.trim();
  if (!url || !secret) return "not_configured" as const;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  let failures = 0;
  for (const email of recipients) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
        body: JSON.stringify({
          eventType: "system_health_alert",
          recipient: { name: "Portal administrator", email },
          actionLink: appUrl,
          email: {
            subject: "Smile Recruitment Portal: items need attention",
            heading: "Items need your attention",
            message: `The daily health check found:\n${digest}`,
            note: "You receive this because your address is set as the portal alert recipient.",
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    }
  }
  return failures === 0 ? ("sent" as const) : ("failed" as const);
}

/** Daily health digest. Always logs; emails HEALTH_ALERT_EMAIL (comma separated) when something needs attention. */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return NextResponse.json({ ok: false, error: "health_alerts_not_configured" }, { status: 503 });
  if (suppliedSecret(request) !== expected) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!isPostgresRecruitmentTarget()) return NextResponse.json({ ok: true, skipped: "not_postgres_target" });
  try {
    const issues = await collectHealthIssues();
    if (issues.length === 0) return NextResponse.json({ ok: true, issues: 0 });
    const digest = formatHealthDigest(issues);
    console.error(`[Health Alert] ${issues.length} item(s) need attention:\n${digest}`);
    const recipients = (process.env.HEALTH_ALERT_EMAIL || "").split(",").map((value) => value.trim()).filter(Boolean);
    const email = recipients.length ? await emailDigest(recipients, digest) : "no_recipient";
    return NextResponse.json({ ok: true, issues: issues.length, email });
  } catch (error) {
    console.error("[Health Alert] Check failed:", error);
    return NextResponse.json({ ok: false, error: "health_check_failed" }, { status: 500 });
  }
}
