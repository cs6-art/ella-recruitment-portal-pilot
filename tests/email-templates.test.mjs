import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("default booking emails read exactly as before once the company name is filled in", async () => {
  const { renderEventEmail, emailSignoff } = await import("../src/lib/email-templates.ts");
  const invitation = renderEventEmail("voice_booking_invitation", { candidate_name: "Alex", role_phrase: "the Sales Manager position", company_name: "McLink Group" });
  assert.equal(invitation.subject, "Schedule your AI voice interview | McLink Group");
  assert.match(invitation.body, /^Dear Alex,\n\nWe are pleased to invite you to the next interview step for the Sales Manager position\./);
  assert.match(invitation.body, /Smile, McLink Group's AI interview assistant, will conduct the voice interview/);
  assert.match(invitation.body, /AI Interview Notice: .* offer by McLink Group unless confirmed in writing/);
  // The sign-off is added by the sender after the buttons, so it is not part of the body.
  assert.doesNotMatch(invitation.body, /Kind regards/);
  assert.equal(emailSignoff("McLink Group"), "Kind regards,\nMcLink Group Recruitment Team");
});

test("the final interview invitation uses consistent title capitalization", async () => {
  const { renderEventEmail } = await import("../src/lib/email-templates.ts");
  const invitation = renderEventEmail("final_booking_invitation", {
    candidate_name: "Alex",
    role_phrase: "the General Manager position",
    company_name: "McTest",
  });
  assert.equal(invitation.subject, "Schedule Your Final Interview with McTest");
  const invitationTemplate = read("src/lib/email-templates.ts");
  const notificationCopy = read("src/lib/notification-labels.ts");
  assert.match(invitationTemplate, /buttons: \{ primary: "Schedule Final Interview" \}/);
  assert.match(notificationCopy, /heading: "Schedule Your Final Interview"/);
  assert.match(notificationCopy, /cta: "Schedule Final Interview"/);
});

test("an interview time line is dropped when there is no time", async () => {
  const { renderEventEmail } = await import("../src/lib/email-templates.ts");
  const values = { candidate_name: "Alex", role_phrase: "this position", company_name: "Acme" };
  assert.doesNotMatch(renderEventEmail("voice_booking_confirmation", values).body, /Interview time/);
  assert.match(renderEventEmail("voice_booking_confirmation", { ...values, interview_time: "2026-10-12 14:00 Asia/Singapore" }).body, /Interview time: 2026-10-12 14:00 Asia\/Singapore/);
});

test("an organization's edit replaces the default and other placeholders still fill in", async () => {
  const { renderEventEmail } = await import("../src/lib/email-templates.ts");
  const result = renderEventEmail("voice_booking_invitation", { candidate_name: "Sam", role_title: "Nurse", company_name: "Acme Clinic" }, { subject: "Meet {{company_name}} about {{role_title}}", body: "Hello {{candidate_name}}, we would like to meet you." });
  assert.equal(result.subject, "Meet Acme Clinic about Nurse");
  assert.equal(result.body, "Hello Sam, we would like to meet you.");
});

test("a candidate name cannot inject markup, placeholders or extra header lines", async () => {
  const { renderEventEmail } = await import("../src/lib/email-templates.ts");
  const result = renderEventEmail("voice_booking_invitation", { candidate_name: "<img src=x onerror=alert(1)>{{company_name}}\nBcc: x@y.z", role_phrase: "this position", company_name: "Acme" }, { subject: "Hi {{candidate_name}}", body: "Dear {{candidate_name}}" });
  assert.doesNotMatch(result.subject, /[\n<>]/);
  assert.doesNotMatch(result.body, /[<>]/);
  assert.match(result.body, /\{\{company_name\}\}/);
});

test("template validation rejects unknown placeholders, markup, empty text, multi-line subjects and non-editable emails", async () => {
  const { validateEmailTemplate } = await import("../src/lib/email-templates.ts");
  assert.equal(validateEmailTemplate("voice_booking_invitation", "Hello {{candidate_name}}", "Body {{company_name}}"), null);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Hello", "Body {{interview_time}}"), /cannot be used in this email/);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Hello", "Body {{candidate_name"), /not closed/);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Hello", "Click <a href=x>here</a>"), /< or >/);
  assert.match(validateEmailTemplate("voice_booking_invitation", "  ", "Body"), /subject/i);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Line one\nLine two", "Body"), /single line/);
  assert.match(validateEmailTemplate("nope", "a", "b"), /Unknown email/);
  // No active sender delivers this email with the portal's wording, so it cannot be edited.
  assert.match(validateEmailTemplate("final_booking_invitation", "a", "b"), /Unknown email/);
});

test("only the emails an active sender delivers are offered for editing", async () => {
  const { EMAIL_EVENTS } = await import("../src/lib/email-templates.ts");
  assert.deepEqual(EMAIL_EVENTS.filter((event) => event.editable).map((event) => event.key), ["voice_booking_invitation", "avatar_interview_invitation", "voice_booking_confirmation", "job_posted"]);
  const route = read("src/app/api/email-templates/route.ts");
  assert.match(route, /EMAIL_EVENTS\.filter\(\(event\) => event\.editable\)/);
  assert.match(route, /canEditSettings !== true/);
  assert.match(read("src/app/settings/page.tsx"), /<EmailTemplatesEditor \/>/);
});

test("the queue applies each organization's wording and company name, and the sign-off follows the buttons", () => {
  const query = read("src/lib/internal-recruitment-queries.ts");
  const labels = read("src/lib/notification-labels.ts");
  assert.match(query, /loadEmailContexts\(/);
  assert.match(query, /companyName: emailContexts\.get\(history\.organizationId\)\?\.companyName/);
  assert.match(query, /templates\.get\("job_posted"\)/);
  assert.match(labels, /renderEventEmail\(key, templateValues, context\.template\)/);
  assert.match(labels, /signoff: emailSignoff\(companyName\)/);
  // Loading wording must never stop emails from sending (for example before the migration is applied).
  assert.match(read("src/lib/email-template-store.ts"), /using defaults/);
  assert.match(read("drizzle/0030_email_templates.sql"), /CREATE TABLE IF NOT EXISTS "email_templates"/);
});

test("button text and a header image can be edited, but only where they can work", async () => {
  const { validateEmailTemplate, isValidImageUrl } = await import("../src/lib/email-templates.ts");
  const ok = { ctaLabel: "Book my call", secondaryCtaLabel: "Talk to Smile now", imageUrl: "https://cdn.example.com/banner.png", imageAlt: "Company banner" };
  assert.equal(validateEmailTemplate("voice_booking_invitation", "Hi", "Body", ok), null);
  // The confirmation email has no buttons, so a button label makes no sense there.
  assert.match(validateEmailTemplate("voice_booking_confirmation", "Hi", "Body", { ctaLabel: "Click" }), /does not have that button/);
  // The new-role email has one button only.
  assert.match(validateEmailTemplate("job_posted", "Hi", "Body", { secondaryCtaLabel: "Another" }), /does not have that button/);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Hi", "Body", { ctaLabel: "x".repeat(41) }), /at most 40/);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Hi", "Body", { ctaLabel: "<b>Go</b>" }), /cannot contain/);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Hi", "Body", { imageUrl: "http://cdn.example.com/a.png" }), /https/);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Hi", "Body", { imageUrl: "javascript:alert(1)" }), /https/);
  assert.match(validateEmailTemplate("voice_booking_invitation", "Hi", "Body", { imageAlt: "A banner" }), /image link/);
  for (const bad of ["", "https://", "https://user:pw@example.com/a.png", "https://example.com/a b.png", 'https://example.com/a".png', "https://example.com/<a>.png", "ftp://example.com/a.png", "//example.com/a.png"]) {
    assert.equal(isValidImageUrl(bad), false, bad);
  }
  assert.equal(isValidImageUrl("https://example.com/a.png?x=1&y=2"), true);
});

test("saved button text and image are applied only to buttons that exist and only when the link is valid", async () => {
  const { applyEmailExtras } = await import("../src/lib/email-templates.ts");
  const copy = { cta: "Schedule a call", secondaryCta: "", extra: "kept" };
  const applied = applyEmailExtras(copy, { subject: "s", body: "b", ctaLabel: "Book my call", secondaryCtaLabel: "Ignored", imageUrl: "https://cdn.example.com/a.png", imageAlt: "Banner" });
  assert.deepEqual(applied, { cta: "Book my call", secondaryCta: "", extra: "kept", imageUrl: "https://cdn.example.com/a.png", imageAlt: "Banner" });
  // A button that has no link (empty label) is never brought back by an edit.
  assert.equal(applyEmailExtras({ cta: "", secondaryCta: "" }, { subject: "s", body: "b", ctaLabel: "Click" }).cta, "");
  // Nothing saved: labels stay standard and no image is sent.
  assert.deepEqual(applyEmailExtras(copy, null), { ...copy, imageUrl: "", imageAlt: "" });
  // An unsafe link that somehow reached storage is dropped instead of sent.
  const unsafe = applyEmailExtras(copy, { subject: "s", body: "b", imageUrl: "javascript:alert(1)", imageAlt: "x" });
  assert.equal(unsafe.imageUrl, "");
  assert.equal(unsafe.imageAlt, "");
});

test("the editor, API, storage and queue carry buttons and the image end to end", () => {
  assert.match(read("drizzle/0031_email_template_buttons_image.sql"), /ADD COLUMN IF NOT EXISTS "image_url"/);
  assert.match(read("src/db/schema-recruitment.ts"), /imageUrl: text\("image_url"\)/);
  const route = read("src/app/api/email-templates/route.ts");
  assert.match(route, /imageUrl: z\.string\(\)\.default\(""\)/);
  assert.match(route, /validateEmailTemplate\(input\.eventType, input\.subject, input\.body, input\)/);
  const labels = read("src/lib/notification-labels.ts");
  assert.match(labels, /applyEmailExtras\(copy, context\.template\)/);
  assert.match(labels, /imageUrl: string;/);
  const editor = read("src/components/EmailTemplatesEditor.tsx");
  for (const text of ["Button text", "Header image (optional)", "Image link", "Preview", "Restore Original", "Discard Changes", "Insert:"]) assert.ok(editor.includes(text), text);
  assert.match(editor, /validateEmailTemplate\(selected\.key, draft\.subject, draft\.body, draft\)/);
});

test("the final interview invitation names the interview the candidate actually completed", async () => {
  const { renderEventEmail } = await import("../src/lib/email-templates.ts");
  const values = { candidate_name: "Alex", role_phrase: "the General Manager position", company_name: "McTest" };
  const avatar = renderEventEmail("final_booking_invitation", { ...values, interview_type: "Live Avatar interview" });
  assert.match(avatar.body, /Thank you for completing your Live Avatar interview\./);
  assert.doesNotMatch(avatar.body, /AI voice interview/);
  const voice = renderEventEmail("final_booking_invitation", { ...values, interview_type: "AI voice interview" });
  assert.match(voice.body, /Thank you for completing your AI voice interview\./);
  // The notifier fills interview_type from the candidate's interview mode.
  assert.match(read("src/lib/notification-labels.ts"), /interview_type: context\.interviewMode === "avatar" \? "Live Avatar interview" : context\.interviewMode === "voice" \? "AI voice interview" : "interview"/);
  assert.match(read("src/lib/internal-recruitment-queries.ts"), /interviewMode: mode,/);
});
