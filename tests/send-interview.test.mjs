import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Approval comment rule (single and bulk share it)
// ---------------------------------------------------------------------------

test("approving needs no comment; rejecting still needs a reason", async () => {
  const { decisionComment, decisionCommentRequired, REJECTION_REASON_REQUIRED_MESSAGE } = await import("../src/lib/applicant-decision-rules.ts");
  assert.deepEqual(decisionComment("Approve", ""), { ok: true, comment: "" });
  assert.deepEqual(decisionComment("Approve", undefined), { ok: true, comment: "" });
  assert.deepEqual(decisionComment("Approve", "  Strong fit  "), { ok: true, comment: "Strong fit" });
  assert.deepEqual(decisionComment("Manual Review", ""), { ok: true, comment: "" });
  assert.deepEqual(decisionComment("Reject", "  "), { ok: false, error: REJECTION_REASON_REQUIRED_MESSAGE });
  assert.deepEqual(decisionComment("Reject", "Missing licence"), { ok: true, comment: "Missing licence" });
  assert.equal(decisionComment("Approve", "x".repeat(5001)).ok, false);
  assert.equal(decisionCommentRequired("Approve"), false);
  assert.equal(decisionCommentRequired("Reject"), true);
});

test("the single decision API and panel use the shared comment rule", () => {
  const route = read("src/app/api/applicants/[applicationId]/decision/route.ts");
  assert.doesNotMatch(route, /comments: z\.string\(\)\.trim\(\)\.min\(1\)/, "the API must not require a comment for every decision");
  assert.match(route, /const note = decisionComment\(body\.decision, body\.comments\);/);
  assert.match(route, /if \(!note\.ok\) return NextResponse\.json\(\{ error: note\.error \}, \{ status: 422 \}\);/);
  const panel = read("src/components/ApplicantDecisionPanel.tsx");
  assert.doesNotMatch(panel, /Comments are required for every action/);
  assert.match(panel, /if \(!trimmed && decisionCommentRequired\(decision\)\)/);
  assert.doesNotMatch(panel, /<textarea[^>]*\brequired\b/);
  // Bulk approval uses the same rule instead of its own.
  assert.match(read("src/app/api/applicants/bulk-approve/route.ts"), /decisionComment\("Approve", parsed\.data\.comment\)/);
});

// ---------------------------------------------------------------------------
// Skip resume screening + send phone / Live Avatar interview
// ---------------------------------------------------------------------------

test("approval still requires screening unless HR deliberately skips it", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /if \(input\.stage === "resume" && input\.decision === "approve" && !input\.allowWithoutScreening\) \{/);
  assert.match(queries, /if \(!screening\) return \{ updated: false, error: "screening_required" as const \};/);
  const target = read("src/lib/recruitment-target-portal.ts");
  // Only the explicit send-interview path passes the skip flag.
  assert.equal((target.match(/allowWithoutScreening: true/g) || []).length, 1);
});

test("sending an interview is organization-scoped, records the skip and creates no screening result", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  const start = target.indexOf("export async function sendInterviewInvitation(");
  const body = target.slice(start, target.indexOf("export async function targetRecordApplicantDecision(", start));
  assert.match(body, /row\.application\.organizationId !== input\.organizationId\) return \{ outcome: "not_found" \}/);
  assert.match(body, /source: screened \? INTERVIEW_APPROVAL_SOURCES\[mode\] : "portal:screening_skipped"/);
  assert.match(body, /Resume screening skipped by HR\./);
  assert.match(body, /exclusiveInterview: !switching,/);
  assert.doesNotMatch(body, /screeningResults|upsertScreeningResult|copyScreeningResult/, "skipping must not create a screening result");
  assert.match(read("src/lib/applicant-stage-labels.ts"), /"portal:screening_skipped": "Resume screening skipped by HR"/);
});

test("only one live phone or Live Avatar invitation can exist, enforced under the row lock", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  const start = queries.indexOf("export async function createBookingToken(");
  const body = queries.slice(start, start + 4000);
  const lock = body.indexOf('.for("update")');
  const guard = body.indexOf("if ((input.exclusiveInterview || input.replaceInterview)");
  assert.ok(lock > 0 && guard > lock, "the duplicate check must run after the application row is locked");
  assert.match(body, /error: "interview_already_invited" as const/);
});

test("a Live Avatar-only invitation emails the avatar link with the AI notice and no stale call link", () => {
  const labels = read("src/lib/notification-labels.ts");
  assert.match(labels, /if \(!link && avatarLink\) \{/);
  assert.match(labels, /cta: "Start your Live Avatar interview",\s*ctaLink: avatarLink,/);
  // Its wording is the editable "avatar_interview_invitation" event, which carries the AI notice.
  assert.match(labels, /renderEventEmail\("avatar_interview_invitation", templateValues, context\.template\)/);
  assert.match(read("src/lib/internal-recruitment-queries.ts"), /bookingLink: history\.source === "internal_api:avatar_interview_invitation" \? "" : context\.notificationLink,/);
});

test("send-interview routes keep HR authorization and tenant isolation", () => {
  const single = read("src/app/api/applicants/[applicationId]/interview-invitation/route.ts");
  assert.match(single, /canDecideApplicant\(user\)/);
  assert.match(single, /organizationId: user\.organizationId/);
  assert.match(single, /consumeRateLimit\(/);
  const bulk = read("src/app/api/applicants/bulk-approve/route.ts");
  assert.match(bulk, /action: z\.enum\(\["approve", "voice", "avatar"\]\)/);
  assert.match(bulk, /sendInterviewInvitation\(\{ applicationExternalId: applicationId, organizationId: user\.organizationId/);
});

test("HR sees one-click send actions on the applicant page and the list", () => {
  const panel = read("src/components/ApplicantDecisionPanel.tsx");
  assert.match(panel, />Send Phone Interview</);
  assert.match(panel, />Send Avatar Interview</);
  assert.match(panel, /confirmLabel: "Send Interview"/);
  assert.match(panel, /View interview/);
  const list = read("src/components/ApplicantsList.tsx");
  assert.match(list, /runSelectedAction\("voice"\)/);
  assert.match(list, /runSelectedAction\("avatar"\)/);
  assert.match(read("src/lib/recruitment-target-portal.ts"), /"Screening skipped"/);
});

test("send-interview messages tell HR what happened in plain words", async () => {
  const { interviewInvitationMessage, summarizeBulkApproval } = await import("../src/lib/bulk-approval.ts");
  assert.equal(interviewInvitationMessage("avatar", "sent"), "Live Avatar interview sent. The applicant will receive the invitation by email.");
  assert.equal(interviewInvitationMessage("voice", "already_invited", "avatar"), "This applicant already has an active Live Avatar interview invitation, so no new one was sent.");
  assert.equal(interviewInvitationMessage("avatar", "interview_exists", "avatar"), "This applicant already has a Live Avatar interview.");
  assert.equal(summarizeBulkApproval(["approved", "approved", "already_invited"], "voice").message, "2 applicants sent a phone interview. 1 applicant skipped because an interview invitation is already active.");
  assert.equal(summarizeBulkApproval(["approved"]).message, "1 applicant approved for interview.");
});

// ---------------------------------------------------------------------------
// Credits, switching interview type, editable Live Avatar email, late screening
// ---------------------------------------------------------------------------

test("an interview is only sent when the organization can cover it, without holding credits early", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  const covered = target.slice(target.indexOf("export async function interviewCreditsCovered("), target.indexOf("export async function sendInterviewInvitation("));
  assert.match(covered, /assertCreditsAvailable\(LIVE_AVATAR_MAX_MINUTES, "live_avatar_interview", \{ organizationId \}\)/);
  assert.match(covered, /assertCreditsAvailable\(1, "phone_interview", \{ organizationId \}\)/);
  assert.doesNotMatch(covered, /place(Voice|Avatar)InterviewHold/, "sending must check, not hold: holds are placed at booking / interview start");
  assert.match(target, /if \(!\(await interviewCreditsCovered\(input\.organizationId, input\.kind\)\)\) return \{ outcome: "insufficient_credits" \};/);
  // Approval checks the credits of the role's interview type (voice unless the role is Avatar only).
  assert.match(target, /if \(!\(await interviewCreditsCovered\(input\.organizationId, interviewType === "avatar" \? "avatar" : "voice"\)\)\) \{\s*return \{ updated: false as const, duplicate: false as const, error: "insufficient_credits" as const/);
  // The existing holds stay where they were.
  assert.match(read("src/lib/internal-recruitment-queries.ts"), /held = await placeVoiceInterviewHold\(/);
  assert.match(read("src/app/api/live-avatar/session/route.ts"), /placeAvatarInterviewHold\(/);
});

test("switching interview type is only allowed before anything is booked or started", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  const start = queries.indexOf("export async function createBookingToken(");
  const body = queries.slice(start, start + 6000);
  assert.match(body, /if \(bookedCall \|\| session \|\| application\.currentStage !== "voice_booking_pending"\)/);
  assert.match(body, /error: "interview_already_started" as const/);
  assert.match(body, /set\(\{ status: "revoked" \}\)/);
  assert.match(body, /notificationError: "Not sent: replaced by a new interview invitation\."/);
  assert.match(body, /source: "portal:interview_switched"/);
  assert.match(read("src/app/api/applicants/[applicationId]/interview-invitation/route.ts"), /switchType: z\.boolean\(\)\.optional\(\)\.default\(false\)/);
  const panel = read("src/components/ApplicantDecisionPanel.tsx");
  assert.match(panel, /function InterviewTypeSwitch/);
  assert.match(panel, />Switch to Avatar Interview</);
});

test("the Live Avatar invitation wording is editable in Email Templates", async () => {
  const { EMAIL_EVENTS, editableEmailEvent, renderEventEmail } = await import("../src/lib/email-templates.ts");
  const avatar = EMAIL_EVENTS.find((event) => event.key === "avatar_interview_invitation");
  assert.ok(avatar && avatar.editable);
  assert.ok(editableEmailEvent("avatar_interview_invitation"));
  assert.match(avatar.body, /\{\{ai_notice\}\}/);
  const rendered = renderEventEmail("avatar_interview_invitation", { candidate_name: "Ana", role_phrase: "the Accountant position", company_name: "Acme" }, { subject: "Hi {{candidate_name}}", body: "Custom text for {{role_phrase}}." });
  assert.equal(rendered.subject, "Hi Ana");
  assert.equal(rendered.body, "Custom text for the Accountant position.");
  assert.match(read("src/lib/internal-recruitment-queries.ts"), /templates\.get\(history\.source === "internal_api:avatar_interview_invitation" \? "avatar_interview_invitation" : String\(history\.notificationEventType\)\)/);
});

test("skipping screening cancels queued screening, so no late result or credit charge", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  assert.match(target, /if \(!screened\) await skipPendingScreening\(id, input\.organizationId\);/);
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /set\(\{ status: "skipped", errorMessage: "Resume screening skipped by HR\."/);
  assert.match(queries, /if \(queue\.status === "screened" \|\| queue\.status === "skipped"\) return \{ processed: false, duplicate: true, error: null \};/);
  assert.match(queries, /if \(!existing && application\.resumeHrDecision\.trim\(\)\.toLowerCase\(\) === "approve"\) return \{ result: null, error: null, skippedByHr: true as const \};/);
  assert.match(read("src/lib/recruitment-target-screening.ts"), /if \(context\.item\.status === "screened" \|\| context\.item\.status === "skipped"\) return \{ status: "duplicate" as const, dedupeKey \};/);
});

test("credit and switch messages are plain for HR", async () => {
  const { interviewInvitationMessage, summarizeBulkApproval } = await import("../src/lib/bulk-approval.ts");
  assert.equal(interviewInvitationMessage("avatar", "insufficient_credits"), "Not enough Smile Credits for this interview. Top up credits, then send it again.");
  assert.match(interviewInvitationMessage("avatar", "already_invited", "voice", { canSwitch: true }), /You can switch it to a Live Avatar interview instead\./);
  assert.match(interviewInvitationMessage("avatar", "sent", undefined, { switched: true }), /^Interview changed to a Live Avatar interview\./);
  assert.match(summarizeBulkApproval(["insufficient_credits"], "avatar").message, /not enough Smile Credits/);
});
