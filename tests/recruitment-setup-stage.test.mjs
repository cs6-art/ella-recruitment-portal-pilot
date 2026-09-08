import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readiness = fs.readFileSync("src/lib/recruitment-setup-readiness.ts", "utf8");
const route = fs.readFileSync("src/app/api/roles/[roleId]/recruitment-setup/route.ts", "utf8");
const statusRoute = fs.readFileSync("src/app/api/roles/[roleId]/status/route.ts", "utf8");
const editor = fs.readFileSync("src/components/RecruitmentSetupEditor.tsx", "utf8");
const roleDetails = fs.readFileSync("src/components/RoleDetails.tsx", "utf8");
const rolesList = fs.readFileSync("src/components/RolesList.tsx", "utf8");

test("draft readiness keeps the two minimum fields", () => {
  assert.match(readiness, /Job_Description/);
  assert.match(readiness, /Screening_Criteria/);
  assert.doesNotMatch(readiness, /Initial_Interview_Questions/);
  assert.match(readiness, /level === "draft"/);
});

test("higher readiness requires the VAPI prompt, three questions, and a posting channel", () => {
  assert.match(readiness, /AI_System_Prompt/);
  assert.match(readiness, /Required_Interview_Question_1/);
  assert.match(readiness, /Required_Interview_Question_2/);
  assert.match(readiness, /Required_Interview_Question_3/);
  assert.doesNotMatch(readiness, /Interview_Behavior/);
  assert.match(readiness, /Posting_Channels/);
});

test("publishing uses explicit conditional requirements", () => {
  assert.match(readiness, /Salary_Disclosure_Status/);
  assert.doesNotMatch(readiness, /Experience_Requirement_Status/);
  assert.match(readiness, /HOD_Interview_Required/);
  assert.match(readiness, /HR interview requirement/);
  assert.doesNotMatch(readiness, /hodAvailabilitySlots/);
  assert.match(readiness, /License_Requirement_Status/);
});

test("server rejects incomplete stage actions", () => {
  assert.match(route, /RECRUITMENT_SETUP_INCOMPLETE/);
  assert.match(route, /getSetupReadiness/);
  assert.match(route, /setupAction/);
});

test("publishing is blocked until Ready for Publishing", () => {
  assert.match(route, /RECRUITMENT_SETUP_NOT_READY/);
  assert.match(route, /Ready for Publishing/);
  assert.match(route, /Job Posted/);
});

test("published roles are promoted out of temporary draft IDs", () => {
  assert.match(statusRoute, /renameRoleExternalId/);
  assert.match(statusRoute, /ROLE_ID_PROMOTION_FAILED/);
  assert.match(route, /published role ID could not be repaired/i);
  assert.match(route, /publishedRoleId/);
  assert.match(rolesList, /searchParams\.get\("published"\)/);
});

test("successful publishing returns durable validation and queues notification work", () => {
  assert.match(route, /validation: setupAction === "publish_role"/);
  assert.match(route, /notificationStatus: setupAction === "publish_role" \? "pending"/);
  assert.match(route, /targetUpdateRoleFields\(role\.roleId, persistedFields\)/);
  assert.match(editor, /roles\?published=1/);
  const queries = fs.readFileSync("src/lib/internal-recruitment-queries.ts", "utf8");
  assert.match(queries, /notificationStatus: "pending"/);
  assert.match(queries, /notificationDomain: "role"/);
});

test("voice interview availability is not part of Recruitment Setup", async () => {
  const voiceAvailability = fs.readFileSync("src/lib/voice-interview-availability.ts", "utf8");
  assert.doesNotMatch(editor, /AI VOICE INTERVIEW AVAILABILITY/);
  assert.doesNotMatch(editor, /Enter specific slots now/);
  assert.doesNotMatch(editor, /Generate weekday slots/);
  // The availability library remains available to the Bookings workflow for
  // legacy roles; it is no longer exposed in the setup editor.
  assert.match(route, /Voice_Interview_Availability_Mode/);
  assert.match(voiceAvailability, /9 \* 60/);

  const { generateAutomaticVoiceInterviewSlots } = await import("../src/lib/voice-interview-availability.ts");
  const slots = generateAutomaticVoiceInterviewSlots({ startDate: "2026-08-17", endDate: "2026-08-17", timezone: "Asia/Singapore", durationMinutes: 30 });
  assert.equal(slots.length, 16);
  assert.deepEqual(slots[0], { date: "2026-08-17", startTime: "09:00", endTime: "09:30", timezone: "Asia/Singapore" });
  assert.deepEqual(slots.at(-1), { date: "2026-08-17", startTime: "16:30", endTime: "17:00", timezone: "Asia/Singapore" });
});

test("voice booking defaults to weekday ten-minute availability and creates only future slots", async () => {
  const { generateAutomaticVoiceInterviewSlots } = await import("../src/lib/voice-interview-availability.ts");
  const slots = generateAutomaticVoiceInterviewSlots({ startDate: "2026-08-17", endDate: "2026-08-17", timezone: "Asia/Singapore" });
  assert.equal(slots.length, 48);
  assert.deepEqual(slots.at(-1), { date: "2026-08-17", startTime: "16:50", endTime: "17:00", timezone: "Asia/Singapore" });
  const availabilityRules = fs.readFileSync("src/lib/interview-availability-rules.ts", "utf8");
  assert.match(availabilityRules, /DEFAULT-VOICE-/);
  assert.match(availabilityRules, /slotDurationMinutes: 10/);
  assert.match(availabilityRules, /isCurrentCalendarMonth/);
  assert.match(availabilityRules, /monthLimit/);
  assert.match(availabilityRules, /CALENDAR-FINAL-/);
  assert.match(availabilityRules, /connected HR Google/);
  assert.match(availabilityRules, /interviewType !== "Final Interview"/);
  assert.match(availabilityRules, /startTime: "10:00"/);
  assert.match(availabilityRules, /start === 12 \* 60/);
  assert.match(availabilityRules, /slotDurationMinutes: 60/);
  const workflow = fs.readFileSync("src/lib/applicant-workflow.ts", "utf8");
  assert.match(workflow, /hidden future-month rows/);
  assert.match(workflow, /Unable to verify the HR Google Calendar/);
  const { expandHodAvailabilitySlots } = await import("../src/lib/hod-availability.ts");
  const finalSlots = expandHodAvailabilitySlots([{ date: "2026-08-20", startTime: "10:00", endTime: "16:00", timezone: "Asia/Singapore" }]);
  assert.equal(finalSlots.length, 5);
  assert.deepEqual(finalSlots[0], { date: "2026-08-20", startTime: "10:00", endTime: "11:00", timezone: "Asia/Singapore" });
  assert.deepEqual(finalSlots[1], { date: "2026-08-20", startTime: "11:00", endTime: "12:00", timezone: "Asia/Singapore" });
  assert.deepEqual(finalSlots[2], { date: "2026-08-20", startTime: "13:00", endTime: "14:00", timezone: "Asia/Singapore" });
  assert.deepEqual(finalSlots.at(-1), { date: "2026-08-20", startTime: "15:00", endTime: "16:00", timezone: "Asia/Singapore" });
});

test("August 20 demo voice slots may extend through midnight only", () => {
  const availabilityRules = fs.readFileSync("src/lib/interview-availability-rules.ts", "utf8");
  assert.match(availabilityRules, /slot\.date === "2026-08-20" \? 24 \* 60 : 17 \* 60/);
  assert.match(availabilityRules, /end <= latestEnd && end - start === 10/);
});

test("setup action status is synchronized for legacy and canonical n8n payload readers", () => {
  assert.match(route, /const nextRecruitmentSetupStatus = isAutosaveDraft \? role\.recruitmentSetupStatus/);
  assert.match(route, /recruitmentSetupStatus: nextRecruitmentSetupStatus/);
  assert.match(route, /Recruitment_Setup_Status: setupStatusForAction/);
});

test("setup edits save only explicitly or once when leaving the editor", () => {
  assert.doesNotMatch(editor, /setTimeout\(\(\) => void saveRef\.current\?\.\("autosave_draft"/);
  assert.match(editor, /individual keystrokes never trigger a network write/);
  assert.match(editor, /saveRef\.current\?\.\("autosave_draft"\)/);
  assert.match(route, /isAutosaveDraft/);
  assert.match(route, /workflowConfigured && !isAutosaveDraft/);
  assert.match(route, /!isAutosaveDraft && setup\.voiceInterviewAvailabilityMode/);
});

test("setup payload keeps the five canonical questions compatible with n8n", () => {
  assert.match(route, /requiredInterviewQuestion1/);
  assert.match(route, /requiredInterviewQuestion5/);
  assert.match(route, /initialInterviewQuestions/);
  assert.match(route, /Initial_Interview_Questions: initialInterviewQuestions\.join/);
  assert.match(route, /Required_Interview_Question_1/);
  assert.match(route, /Required_Interview_Question_5/);
});

test("editor exposes separate stage actions and readiness", () => {
  assert.match(editor, />Save<|"Save"/);
  assert.match(editor, /Mark as Recruitment Ready/);
  assert.match(editor, /Mark as Ready for Publishing/);
  assert.match(editor, /Publish Role/);
  assert.match(editor, /setup-readiness/);
});

test("recruitment setup uses one guided editor with simple HR-facing fields", () => {
  assert.match(editor, /Interview Setup/);
  assert.match(editor, /What should Ella listen for\?/);
  assert.match(editor, /Advanced: edit full script/);
  assert.match(editor, /Publishing checklist/);
  // The raw {{curly_brace}} template stays hidden behind an explicit
  // "Advanced" action so HR lands on the simple field-based view by default.
  assert.match(editor, /useState\(false\)/);
  assert.doesNotMatch(roleDetails, /EllaSetupFields/);
});

test("required publishing fields stay visible and checklist opens by default", () => {
  assert.match(editor, /className="vapi-publishing" open/);
  assert.match(editor, /Posting channels \*/);
  assert.match(editor, /Salary visibility \*/);
  assert.match(editor, /License requirement \*/);
  assert.match(editor, /Face-to-Face interview \*/);
  assert.match(editor, /setupFieldAnchors\[field\.key\]/);
  assert.match(route, /hasField\("evaluationFieldToggles"\)/);
  assert.match(route, /hasField\("postingChannels"\)/);
});

test("VAPI prompt is interview-only and has no scheduling context", () => {
  const prompt = fs.readFileSync("src/lib/recruitment-prompt.ts", "utf8");
  assert.match(prompt, /This call is an interview only/);
  assert.match(prompt, /McLink Group's AI HR Recruiting Assistant/);
  assert.match(prompt, /Fair and Consistent Assessment/);
  assert.match(prompt, /Never use or infer a person's name, age, gender/);
  assert.match(prompt, /The AI recommendation is advisory only/);
  assert.doesNotMatch(prompt, /\[Time Management\]/);
  assert.doesNotMatch(prompt, /Current Time: \{\{current_time\}\}/);
  assert.match(prompt, /Never schedule an interview/);
});

test("AI voice interview emails disclose the AI interviewer and human review", () => {
  const contracts = fs.readFileSync("docs/N8N-CONTRACTS.md", "utf8");
  const workflow = fs.readFileSync("docs/WORKING-RECRUITMENT-WORKFLOW.md", "utf8");
  assert.match(contracts, /AI Interview Notice: This interview will be conducted with the assistance of/);
  assert.match(contracts, /may record, transcribe and assess your/);
  assert.match(contracts, /official representation/);
  assert.match(contracts, /commitment or offer by Mclink Group/);
  assert.match(contracts, /Face-to-Face\s+Interview invitations are for the\s+human HR interviewer/);
  assert.match(workflow, /AI Interview Notice: This interview will be conducted with the assistance/);
});

test("evaluation field catalog is shared between the schema, editor, and n8n payload", async () => {
  const schemaSource = fs.readFileSync("src/lib/recruitment-setup-schema.ts", "utf8");
  assert.match(schemaSource, /BASELINE_EVALUATION_FIELDS/);
  assert.match(schemaSource, /EVALUATION_FIELD_CATALOG/);
  assert.match(schemaSource, /evaluationFieldToggles/);
  assert.match(schemaSource, /customEvaluationFields/);
  assert.match(schemaSource, /max\(3, "Up to 3 custom fields are allowed\."\)/);

  assert.match(editor, /toggleEvaluationField/);
  assert.match(editor, /addCustomField/);
  assert.match(editor, /EVALUATION_FIELD_CATALOG\.map/);
  assert.match(editor, /Always included/);

  assert.match(route, /Evaluation_Fields: JSON\.stringify/);
  assert.match(route, /Evaluation_Field_Toggles: setup\.evaluationFieldToggles\.join/);
  assert.match(route, /evaluationFieldsForSetup/);

  const sheetsSource = fs.readFileSync("src/lib/google-sheets.ts", "utf8");
  assert.match(sheetsSource, /Evaluation_Field_Toggles/);
  assert.match(sheetsSource, /dedicated toggle column authoritative/);

  const { recruitmentSetupSchema } = await import("../src/lib/recruitment-setup-schema.ts");
  const base = {
    jobDescription: "Job",
    screeningCriteria: "Criteria",
    aiSystemPrompt: "Prompt",
    postingChannels: [],
    initialInterviewBookingLink: "",
    hodInterviewBookingLink: "",
  };

  const withCustomFields = recruitmentSetupSchema.safeParse({
    ...base,
    evaluationFieldToggles: ["technical_depth", "not-a-real-key"],
    customEvaluationFields: [{ key: "domain_fluency", label: "Domain fluency", description: "Assess fluency in the required domain." }],
  });
  assert.equal(withCustomFields.success, true);
  assert.deepEqual(withCustomFields.data.evaluationFieldToggles, ["technical_depth"]);
  assert.equal(withCustomFields.data.customEvaluationFields[0].key, "domain_fluency");

  const invalidKeyFormat = recruitmentSetupSchema.safeParse({
    ...base,
    customEvaluationFields: [{ key: "Weird Key!!", label: "Domain fluency", description: "Assess fluency in the required domain." }],
  });
  assert.equal(invalidKeyFormat.success, false);

  const tooManyCustomFields = recruitmentSetupSchema.safeParse({
    ...base,
    customEvaluationFields: [
      { key: "a", label: "A", description: "First." },
      { key: "b", label: "B", description: "Second." },
      { key: "c", label: "C", description: "Third." },
      { key: "d", label: "D", description: "Fourth." },
    ],
  });
  assert.equal(tooManyCustomFields.success, false);

  const duplicateCatalogKey = recruitmentSetupSchema.safeParse({
    ...base,
    customEvaluationFields: [{ key: "technical_depth", label: "Dup", description: "Duplicates a catalog key." }],
  });
  assert.equal(duplicateCatalogKey.success, false);
});

test("evaluation fields flow into the rendered voice interview prompt", async () => {
  const { renderRecruitmentSystemPrompt, STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE } = await import("../src/lib/recruitment-prompt.ts");
  const rendered = renderRecruitmentSystemPrompt(STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE, {
    jobDescription: "Job",
    screeningCriteria: "Criteria",
    evaluationFields: [{ key: "technical_depth", label: "Technical depth", description: "Assess how deeply the candidate understands the required technical stack." }],
  });
  assert.match(rendered, /EVALUATION OUTPUT FIELDS/);
  assert.match(rendered, /Score: Overall numeric fit score for the role\./);
  assert.match(rendered, /Technical depth: Assess how deeply the candidate understands the required technical stack\./);

  const withoutEvaluationFields = renderRecruitmentSystemPrompt(STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE, {
    jobDescription: "Job",
    screeningCriteria: "Criteria",
  });
  assert.doesNotMatch(withoutEvaluationFields, /ADDITIONAL EVALUATION FIELDS/);
});
