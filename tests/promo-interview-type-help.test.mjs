import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

test("a promo code is worth exactly 210 credits and the messages are client-friendly", async () => {
  const { PROMO_CODE_CREDITS, PROMO_CODE_MESSAGES } = await import("../src/lib/promo-code-rules.ts");
  assert.equal(PROMO_CODE_CREDITS, 210);
  assert.equal(PROMO_CODE_MESSAGES.success, "Promo code applied. 210 credits have been added to your account.");
  assert.equal(PROMO_CODE_MESSAGES.invalid, "This promo code is not valid.");
  assert.equal(PROMO_CODE_MESSAGES.expired, "This promo code has expired.");
  assert.equal(PROMO_CODE_MESSAGES.used_up, "This promo code has already been used.");
  assert.equal(PROMO_CODE_MESSAGES.already_redeemed, "Your organization has already redeemed this promotion.");
});

test("promo code availability: disabled, other organization, expired and used-up codes are refused", async () => {
  const { promoCodeAvailability, normalizePromoCode, PROMO_CODE_PATTERN, promoLedgerSourceEntryId } = await import("../src/lib/promo-code-rules.ts");
  const org = "11111111-1111-4111-8111-111111111111";
  const now = new Date("2026-10-07T00:00:00Z");
  const base = { active: true, organizationId: null, expiresAt: null, maxRedemptions: null, redemptionCount: 0 };
  assert.deepEqual(promoCodeAvailability(base, org, now), { ok: true });
  assert.deepEqual(promoCodeAvailability(null, org, now), { ok: false, reason: "invalid" });
  assert.deepEqual(promoCodeAvailability({ ...base, active: false }, org, now), { ok: false, reason: "invalid" });
  // Restricted to another organization: reads as not valid (reveals nothing).
  assert.deepEqual(promoCodeAvailability({ ...base, organizationId: "22222222-2222-4222-8222-222222222222" }, org, now), { ok: false, reason: "invalid" });
  assert.deepEqual(promoCodeAvailability({ ...base, organizationId: org }, org, now), { ok: true });
  assert.deepEqual(promoCodeAvailability({ ...base, expiresAt: "2026-10-06T23:59:59Z" }, org, now), { ok: false, reason: "expired" });
  assert.deepEqual(promoCodeAvailability({ ...base, expiresAt: "2026-10-08T00:00:00Z" }, org, now), { ok: true });
  assert.deepEqual(promoCodeAvailability({ ...base, maxRedemptions: 3, redemptionCount: 3 }, org, now), { ok: false, reason: "used_up" });
  assert.equal(normalizePromoCode(" promo code-123 "), "PROMOCODE-123");
  assert.ok(PROMO_CODE_PATTERN.test("PROMOCODE123"));
  assert.ok(!PROMO_CODE_PATTERN.test("AB"));
  assert.ok(!PROMO_CODE_PATTERN.test("BAD CODE"));
  // One ledger key per code and organization: a replay is an idempotent no-op.
  assert.equal(promoLedgerSourceEntryId("c1", org), promoLedgerSourceEntryId("c1", org));
  assert.notEqual(promoLedgerSourceEntryId("c1", org), promoLedgerSourceEntryId("c2", org));
});

test("redemption locks the code, is unique per organization and reuses the org credit ledger", () => {
  const store = read("src/lib/promo-codes.ts");
  const redeem = store.slice(store.indexOf("export async function redeemPromoCode("), store.indexOf("export type PromoCodeRow"));
  assert.match(redeem, /\.for\("update"\)/, "the code row must be locked so concurrent redemptions serialize");
  assert.match(redeem, /onConflictDoNothing\(\)/, "the unique (code, organization) row is the duplicate backstop");
  assert.match(redeem, /reason: "already_redeemed"/);
  assert.match(redeem, /appendAccountLedgerEntryOnExecutor\(tx,/, "credits go through the existing ledger in the same transaction");
  assert.match(redeem, /event: PROMO_CODE_LEDGER_EVENT/);
  assert.match(redeem, /creditsDelta: promo\.credits/);
  assert.doesNotMatch(redeem, /recordTopUp/, "recordTopUp adds a volume bonus; a promo must be exactly 210");
  const migration = read("drizzle/0040_promo_codes.sql");
  assert.match(migration, /CONSTRAINT "promo_code_redemptions_code_org_uidx" UNIQUE \("promo_code_id", "organization_id"\)/);
  assert.match(read("src/lib/promo-codes.ts"), /credits: PROMO_CODE_CREDITS,/, "created codes are always 210 credits");
});

test("the redeem API takes only the code; organization comes from the session", () => {
  const route = read("src/app/api/ella-credits/promo-codes/redeem/route.ts");
  assert.match(route, /z\.object\(\{ code: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(60\) \}\)\.strict\(\)/);
  assert.match(route, /organizationId: user\.organizationId/);
  assert.match(route, /consumeRateLimit\(`promo-redeem:/);
  assert.doesNotMatch(route, /error: String\(error\)|error\.message/, "raw errors must not reach the user");
  const manage = read("src/app/api/ella-credits/promo-codes/route.ts");
  assert.match(manage, /if \(!canManageAllOrganizationCredits\(user\)\)/, "only McLink credit managers manage codes");
  assert.doesNotMatch(manage, /credits:/, "management cannot set a credit amount");
});

test("the Credits page shows the promo box and labels the ledger entry", () => {
  const panel = read("src/components/EllaCreditsPanel.tsx");
  assert.match(panel, /promo_code: "Promotional Credits"/);
  assert.match(panel, /<PromoCodeRedeem /);
  const redeem = read("src/components/PromoCodeRedeem.tsx");
  assert.match(redeem, /Have a promo code\?/);
  assert.match(redeem, /inFlight\.current/, "double clicks must not send two requests");
});

// ---------------------------------------------------------------------------
// Interview type
// ---------------------------------------------------------------------------

test("interview type defaults to Both for existing roles and gates each interview kind", async () => {
  const { readRoleInterviewType, roleAllowsInterview, approvalInterviewKinds, ROLE_INTERVIEW_TYPE_LABELS } = await import("../src/lib/interview-type.ts");
  assert.equal(readRoleInterviewType({}), "both");
  assert.equal(readRoleInterviewType(null), "both");
  assert.equal(readRoleInterviewType({ interviewType: "nonsense" }), "both");
  assert.equal(readRoleInterviewType({ interviewType: "VOICE" }), "voice");
  assert.equal(readRoleInterviewType({ interviewType: "avatar" }), "avatar");
  assert.equal(roleAllowsInterview("voice", "voice"), true);
  assert.equal(roleAllowsInterview("voice", "avatar"), false);
  assert.equal(roleAllowsInterview("avatar", "voice"), false);
  assert.equal(roleAllowsInterview("both", "avatar"), true);
  assert.deepEqual(approvalInterviewKinds("both"), ["voice", "avatar"]);
  assert.deepEqual(approvalInterviewKinds("voice"), ["voice"]);
  assert.deepEqual(approvalInterviewKinds("avatar"), ["avatar"]);
  assert.equal(ROLE_INTERVIEW_TYPE_LABELS.voice, "Voice Interview only");
  assert.equal(ROLE_INTERVIEW_TYPE_LABELS.avatar, "Avatar Interview only");
  assert.equal(ROLE_INTERVIEW_TYPE_LABELS.both, "Both");
});

test("every invitation path follows the role's interview type on the server", () => {
  const target = read("src/lib/recruitment-target-portal.ts");
  const send = target.slice(target.indexOf("export async function sendInterviewInvitation("), target.indexOf("export async function targetRecordApplicantDecision("));
  assert.match(send, /if \(!roleAllowsInterview\(interviewType, input\.kind\)\) return \{ outcome: "not_allowed_for_role", interviewType \}/);
  assert.match(send, /Voice"\} Interview sent by HR\./);
  const issue = target.slice(target.indexOf("export async function issueInterviewInvitations("), target.indexOf("export async function approveForInterview("));
  assert.match(issue, /approvalInterviewKinds\(type\)/);
  assert.match(issue, /kind: "avatar", expiresAt, notify: true/, "an Avatar-only role emails the avatar link on its own");
  const approve = target.slice(target.indexOf("export async function approveForInterview("), target.indexOf("export type InterviewInvitationKind"));
  assert.match(approve, /issueInterviewInvitations\(input\.applicationExternalId, interviewType\)/);
  assert.match(read("src/lib/bulk-approval.ts"), /not_allowed_for_role: \["skipped because their role doesn't use this interview type"/);
});

test("only HR can change a role's interview type, scoped to the organization and audited", () => {
  const route = read("src/app/api/roles/[roleId]/interview-type/route.ts");
  assert.match(route, /if \(!canEditRecruitmentSetup\(user\)\) return NextResponse\.json\(\{ success: false, error: "Only HR can change the interview type\." \}, \{ status: 403 \}\)/);
  assert.match(route, /getRole\(roleId, user\.organizationId\)/);
  const queries = read("src/lib/internal-recruitment-queries.ts");
  const setter = queries.slice(queries.indexOf("export async function setRoleInterviewType("), queries.indexOf("export class RoleWriteConflictError"));
  assert.match(setter, /'\{interviewType\}'/);
  assert.match(setter, /action: "interview_type_updated"/);
});

test("the applicant page only shows the send actions the role allows", () => {
  const panel = read("src/components/ApplicantDecisionPanel.tsx");
  assert.match(panel, /roleAllowsInterview\(roleInterviewType, "voice"\) && <button.*>Send Phone Interview<\/button>/);
  assert.match(panel, /roleAllowsInterview\(roleInterviewType, "avatar"\) && <button.*>Send Avatar Interview<\/button>/);
  assert.match(panel, /=== "both" && props\.currentStage\.trim\(\)\.toLowerCase\(\) === "voice_booking_pending" && <InterviewTypeSwitch/);
  const form = read("src/components/RoleRequestForm.tsx");
  assert.match(form, /<legend>Interview Type <strong className="required-mark">\*<\/strong><\/legend>/);
});

// ---------------------------------------------------------------------------
// Smile Bot: Help & Feedback tab and mascot launcher
// ---------------------------------------------------------------------------

test("support contact defaults to HRSG and is configurable", async () => {
  const { supportContact, feedbackMailto } = await import("../src/lib/support-contact.ts");
  assert.deepEqual(supportContact({}), { email: "hrsg@mclinkgroup.com", name: "HRSG" });
  assert.deepEqual(supportContact({ SUPPORT_EMAIL: " Help@Example.com ", SUPPORT_NAME: "Helpdesk" }), { email: "help@example.com", name: "Helpdesk" });
  assert.deepEqual(supportContact({ SUPPORT_EMAIL: "not-an-email" }), { email: "hrsg@mclinkgroup.com", name: "HRSG" });
  const link = feedbackMailto({ to: "hrsg@mclinkgroup.com", topic: "Report an issue", message: "Button & page broke", page: "/credits" });
  assert.ok(link.startsWith("mailto:hrsg@mclinkgroup.com?subject="));
  assert.match(decodeURIComponent(link), /Smile Recruitment Portal: Report an issue/);
  assert.match(decodeURIComponent(link), /Button & page broke/);
  assert.match(decodeURIComponent(link), /Page: \/credits/);
});

test("Smile Bot has one mascot launcher and a Help & Feedback tab", () => {
  const bot = read("src/components/HelpBot.tsx");
  assert.match(bot, /import \{ Mascot \} from "page-mascot";/);
  assert.equal((bot.match(/<Mascot /g) || []).length, 1);
  assert.doesNotMatch(bot, /styles\.launcher\b/, "the old pill launcher is replaced, not duplicated");
  assert.match(bot, /setAttribute\("aria-label", open \? "Close Smile help assistant" : "Open Smile help assistant"\)/);
  assert.match(bot, />Help &amp; Feedback</);
  assert.match(bot, /Need help or found an issue\?/);
  assert.match(bot, /Copy email/);
  assert.match(read("src/components/HelpBot.module.css"), /@media \(prefers-reduced-motion: reduce\)[^}]*\.mascotFloat/);
  assert.match(read("src/app/api/help-bot/route.ts"), /support: supportContact\(\)/);
  for (const sheet of ["smile-directions.webp", "smile-reactions.webp"]) assert.ok(fs.existsSync(`public/mascot/${sheet}`), sheet);
});
