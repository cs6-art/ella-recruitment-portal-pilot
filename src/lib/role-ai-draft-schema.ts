import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).default("");

export const roleAiRecruitmentSetupDraftSchema = z.object({
  jobDescription: text(20000),
  screeningCriteria: text(10000),
  requiredInterviewQuestion1: text(2000),
  requiredInterviewQuestion2: text(2000),
  requiredInterviewQuestion3: text(2000),
  requiredInterviewQuestion4: text(2000),
  requiredInterviewQuestion5: text(2000),
  keywordsToLookFor: text(5000),
  minimumYearsOfExperience: text(100),
  transferableSkillsAccepted: text(5000),
  licenseOrCertificateRequired: text(5000),
  salaryOrBudgetRange: text(1000),
  earliestAvailabilityRule: text(1000),
  evaluationFieldToggles: z.array(z.string().trim().max(60)).max(8).default([]),
  customEvaluationFields: z.array(z.object({ key: text(40), label: text(60), description: text(200) })).max(3).default([]),
  postingChannels: z.array(z.string().trim().max(100)).max(10).default([]),
  // Publishing choices made on the single "create role" form.
  salaryDisclosureStatus: text(30),
  licenseRequirementStatus: text(30),
  hodInterviewRequired: text(30),
  finalInterviewVenue: text(2000),
});

export const roleAiDraftSchema = z.object({
  role: z.object({
    requestType: z.preprocess((value) => String(value ?? "").trim() || "Staff Addition", z.enum(["Staff Addition", "Staff Replacement"])),
    department: z.preprocess((value) => String(value ?? "").trim() || "Not specified", z.string().max(100)),
    jobTitle: text(150),
    numberOfVacancies: z.coerce.number().int().min(1).max(100).default(1),
    reasonForRequest: text(2000),
    jobDescription: text(20000),
    replacementEmployee: text(150),
    targetHiringDate: text(10),
  }),
  recruitmentSetup: roleAiRecruitmentSetupDraftSchema,
}).superRefine((draft, context) => {
  const role = draft.role;
  if (role.department.length < 2) context.addIssue({ code: z.ZodIssueCode.custom, path: ["role", "department"], message: "AI could not determine the department." });
  if (role.jobTitle.length < 2) context.addIssue({ code: z.ZodIssueCode.custom, path: ["role", "jobTitle"], message: "AI could not determine the job title." });
  if (role.jobDescription.length < 20) context.addIssue({ code: z.ZodIssueCode.custom, path: ["role", "jobDescription"], message: "AI could not extract a complete job description." });
  if (draft.recruitmentSetup.screeningCriteria.length < 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recruitmentSetup", "screeningCriteria"], message: "AI could not determine screening criteria." });
});

export type RoleAiDraft = z.infer<typeof roleAiDraftSchema>;
