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
  assert.deepEqual(EMAIL_EVENTS.filter((event) => event.editable).map((event) => event.key), ["voice_booking_invitation", "voice_booking_confirmation", "job_posted"]);
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
