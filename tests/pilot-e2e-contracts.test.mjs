import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("role creation authenticates the requester and persists a complete Pilot role", () => {
  const route = read("src/app/api/roles/route.ts");
  assert.match(route, /export async function POST/);
  assert.match(route, /verifySessionToken/);
  assert.match(route, /user\.canCreateRole !== true/);
  assert.match(route, /roleRequestSchema\.parse/);
  assert.match(route, /isPostgresRecruitmentTarget\(\)/);
  assert.match(route, /createRole\(/);
  assert.match(route, /status: "pending_hr_discussion"/);
  assert.match(route, /submittedByEmail: sessionEmail/);
  assert.match(route, /actionRequestId: submissionId/);
});

test("role workflow supports draft, HR review, approval, rejection, and idempotent replay", () => {
  const route = read("src/app/api/roles/[roleId]/status/route.ts");
  assert.match(route, /submit_draft_for_hr/);
  assert.match(route, /approve_role/);
  assert.match(route, /reject_role/);
  assert.match(route, /return_for_revision_hr/);
  assert.match(route, /statusRequestSchema/);
  assert.match(route, /actionRequestId/);
  assert.match(route, /idempotentReplay/);
  assert.match(route, /renameRoleExternalId/);
});

test("role setup blocks publishing until required fields are ready", () => {
  const setup = read("src/app/api/roles/[roleId]/recruitment-setup/route.ts");
  const readiness = read("src/lib/recruitment-setup-readiness.ts");
  assert.match(setup, /getSetupReadiness/);
  assert.match(setup, /RECRUITMENT_SETUP_INCOMPLETE/);
  assert.match(setup, /RECRUITMENT_SETUP_NOT_READY/);
  assert.match(setup, /publish_role/);
  assert.match(readiness, /Ready for Publishing/);
  assert.match(readiness, /Job_Description/);
  assert.match(readiness, /AI_System_Prompt/);
  assert.match(readiness, /Required_Interview_Question_3/);
});

test("application intake is authenticated, role-bound, and supports a new applicant identity", () => {
  const route = read("src/app/api/public/applications/route.ts");
  const resolver = read("src/lib/recruitment-role-resolution.ts");
  assert.match(route, /isPostgresRecruitmentTarget\(\)/);
  assert.match(route, /targetCreateApplication/);
  assert.match(route, /candidateEmail/);
  assert.match(route, /consent/);
  assert.match(resolver, /isPublishedRoleForIntake/);
  assert.match(resolver, /targetRoleDetails/);
});

test("screening completes before HR approval can advance the applicant", () => {
  const decisionRoute = read("src/app/api/internal/recruitment/hr-decisions/route.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(decisionRoute, /withInternalAuth\("hr_decisions"/);
  assert.match(decisionRoute, /stage/);
  assert.match(decisionRoute, /applyHrDecision/);
  assert.match(queries, /screening_required/);
  assert.match(queries, /currentStage !== expectedStage/);
  assert.match(queries, /currentStage: targetStage/);
});

test("voice booking creates one scheduled attempt using the persisted slot instant", () => {
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(queries, /export async function bookInterviewSlot/);
  assert.match(queries, /nextStage = slot\.interviewType === "voice" \? "voice_scheduled"/);
  assert.match(queries, /status: "scheduled"/);
  assert.match(queries, /scheduledAt: slot\.startsAt/);
  assert.match(queries, /existing = await tx\.select.*voiceCallAttempts/s);
  assert.match(queries, /voiceCallAttempts\.applicationId/);
});

test("scheduled voice calls are claimed atomically before provider dispatch", () => {
  const claimRoute = read("src/app/api/internal/recruitment/voice/queue/claim/route.ts");
  const dispatchRoute = read("src/app/api/internal/recruitment/voice/dispatch/route.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(claimRoute, /withInternalAuth\("voice_queue"/);
  assert.match(claimRoute, /claimVoiceCalls/);
  assert.match(queries, /FOR UPDATE SKIP LOCKED/);
  assert.match(dispatchRoute, /beginVoiceAttemptDispatch/);
  assert.match(dispatchRoute, /voice_slot_not_due/);
  assert.match(dispatchRoute, /valid_applicant_phone_required/);
  assert.doesNotMatch(dispatchRoute, /api\.vapi\.ai\/call/);
});

test("voice results are authenticated, idempotent, and tied to the current applicant attempt", () => {
  const route = read("src/app/api/internal/recruitment/voice/results/route.ts");
  const queries = read("src/lib/internal-recruitment-queries.ts");
  assert.match(route, /withInternalAuth\("voice_results"/);
  assert.match(route, /ingestVoiceResult/);
  assert.match(route, /voiceResultStatuses/);
  assert.match(queries, /stale_attempt/);
  assert.match(queries, /attempt_not_processable/);
  assert.match(queries, /onConflictDoNothing\(\{ target: voiceCallLogs\.sourceEventKey \}\)/);
});

test("Pilot target mode is explicit and internal routes fail closed", () => {
  const mode = read("src/lib/recruitment-target-mode.ts");
  const auth = read("src/lib/internal-api.ts");
  const env = read(".env.example");
  assert.match(mode, /RECRUITMENT_BACKEND\?\.trim\(\)\.toLowerCase\(\) === "postgres"/);
  assert.match(auth, /INTERNAL_API_ENTITIES/);
  assert.match(auth, /missing configuration is a server failure/);
  assert.match(env, /RECRUITMENT_BACKEND=postgres/);
  assert.match(env, /INTERNAL_API_ENTITIES=.*voice_results/);
});
