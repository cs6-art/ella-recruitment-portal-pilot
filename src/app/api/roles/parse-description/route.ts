import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { extractDocumentText, MAX_DOCUMENT_FILE_BYTES } from "@/lib/document-extraction";
import { getPortalConfigValue } from "@/lib/portal-config";
import { roleAiDraftSchema } from "@/lib/role-ai-draft-schema";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
  try {
    const user = verifySessionToken((await cookies()).get(COOKIE_NAME)?.value);
    if (!user || user.canCreateRole !== true) return failure("Only authorized HR users can create role drafts.", 403);

    const parserUrl = (await getPortalConfigValue("N8N_Role_Description_Parser_Webhook_URL")).trim();
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET?.trim();
    if (!parserUrl || !webhookSecret) return failure("The AI job-description parser is not configured yet.", 503);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_DOCUMENT_FILE_BYTES + 512 * 1024) return failure("Job description files must be 10 MB or smaller.", 413);

    const formData = await request.formData();
    const value = formData.get("jobDescriptionFile");
    const inlineDescription = String(formData.get("jobDescriptionText") || "").trim();
    const submittedJobTitle = String(formData.get("jobTitle") || "").trim();
    const submittedDepartment = String(formData.get("department") || "").trim();

    // The shared extractor normalizes PDF, legacy DOC, and DOCX into text.
    // HR can also generate the same draft from the description they typed
    // directly into the role request, so a document is not required.
    let document: { fileName: string; kind: string; text: string };
    if (value instanceof File) {
      document = await extractDocumentText(value);
    } else if (inlineDescription.length >= 20) {
      document = { fileName: "typed-job-description", kind: "text", text: inlineDescription };
    } else {
      return failure("Enter at least 20 characters in the job description or attach a PDF, DOC, or DOCX file.", 422);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response: Response;
    try {
      response = await fetch(parserUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": webhookSecret },
        body: JSON.stringify({
          eventType: "role_description_parse",
          submittedBy: { name: user.name, email: user.email },
          documentName: document.fileName,
          documentKind: document.kind,
          jobDescriptionText: document.text,
          requestedRole: {
            jobTitle: submittedJobTitle,
            department: submittedDepartment,
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let responseBody: unknown;
    try { responseBody = raw ? JSON.parse(raw) : {}; } catch { responseBody = {}; }
    if (!response.ok) {
      const message = responseBody && typeof responseBody === "object" && "error" in responseBody
        ? String((responseBody as { error?: unknown }).error || "The AI parser rejected the document.")
        : raw.trim() || "The AI parser rejected the document.";
      return failure(message, 502);
    }

    if (!raw.trim()) return failure("The AI parser returned no response. Check the n8n parser workflow and its AI credentials.", 502);

    const candidate = responseBody && typeof responseBody === "object" && "draft" in responseBody
      ? (responseBody as { draft?: unknown }).draft
      : responseBody;
    const parsed = roleAiDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      console.error("[Role Description Parser] Invalid n8n response:", parsed.error.flatten());
      return failure("The AI parser returned an incomplete draft. Please review the document and try again.", 502);
    }

    return NextResponse.json({ success: true, draft: parsed.data });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "The AI parser took too long to respond. Please try again."
      : error instanceof Error ? error.message : "Unable to parse the job description.";
    console.error("[Role Description Parser] POST failed:", message);
    return failure(message, 422);
  }
}
