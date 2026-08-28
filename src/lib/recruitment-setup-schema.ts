import { z } from "zod";


const optionalUrl = z.string().trim().max(2000).refine((value) => value === "" || /^https?:\/\//i.test(value), "Enter a valid http(s) URL.");
const editableExperience = z.preprocess((value) => value === null || value === undefined ? "" : String(value), z.string().trim().max(100).default(""));

// Always included for every role - not a toggle, just labeled consistently
// for the UI and the prompt template.
export const BASELINE_EVALUATION_FIELDS = [
  { key: "score", label: "Score", description: "Overall numeric fit score for the role." },
  { key: "recommendation", label: "Recommendation", description: "Proceed / hold / reject recommendation." },
  { key: "strengths", label: "Strengths", description: "Candidate's strongest points for this role." },
  { key: "concerns", label: "Concerns", description: "Gaps or risks HR should be aware of." },
] as const;

// HR toggles these on per role, in addition to the baseline above.
export const EVALUATION_FIELD_CATALOG = [
  { key: "communication_quality", label: "Communication quality", description: "How clearly and professionally the candidate communicates." },
  { key: "culture_fit", label: "Culture fit", description: "Alignment with McLink's values and working style." },
  { key: "leadership_potential", label: "Leadership potential", description: "Evidence of leadership or people-management capability." },
  { key: "customer_service_orientation", label: "Customer service orientation", description: "Evidence of a service-first, customer-facing mindset." },
  { key: "technical_depth", label: "Technical depth", description: "Depth of understanding of the required technical stack." },
  { key: "problem_solving", label: "Problem solving", description: "Ability to reason through role-relevant problems." },
  { key: "attention_to_detail", label: "Attention to detail", description: "Carefulness and accuracy in work and communication." },
  { key: "reliability", label: "Reliability / consistency", description: "Track record of dependable, consistent work history." },
] as const;

export type EvaluationField = { key: string; label: string; description: string };

export function evaluationFieldsForSetup(
  toggles: string[] | string | undefined,
  customFields: EvaluationField[] | undefined = [],
): EvaluationField[] {
  const selectedKeys = new Set(
    (Array.isArray(toggles) ? toggles : String(toggles || "").split(/[\n,]/))
      .map((key) => String(key).trim().toLowerCase())
      .filter(Boolean),
  );
  const fields = [
    ...BASELINE_EVALUATION_FIELDS,
    ...EVALUATION_FIELD_CATALOG.filter((field) => selectedKeys.has(field.key)),
    ...(customFields || []),
  ];
  return fields.filter((field, index, all) => (
    field.key.trim() !== "" && field.label.trim() !== "" &&
    all.findIndex((candidate) => candidate.key === field.key) === index
  ));
}

const catalogKeys = EVALUATION_FIELD_CATALOG.map((field) => field.key);
type CatalogKey = (typeof catalogKeys)[number];

const evaluationFieldKey = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,39}$/, "Use lowercase letters, numbers, and underscores only.");

const customEvaluationField = z.object({
  key: evaluationFieldKey,
  label: z.string().trim().min(1, "Field name is required.").max(60),
  description: z.string().trim().min(1, "Description is required.").max(200),
});

const setupVoiceInterviewSlotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid voice interview date."),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Select a valid voice interview start time."),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Select a valid voice interview end time."),
  timezone: z.string().trim().min(1, "Select a voice interview timezone.").max(100),
}).refine((slot) => slot.startTime < slot.endTime, "Voice interview start time must be before the end time.");

export const recruitmentSetupSchema = z.object({
  jobDescription: z.string().trim().min(1, "Job Description is required.").max(20000),
  screeningCriteria: z.string().trim().min(1, "Screening Criteria is required.").max(10000),
  requiredInterviewQuestion1: z.string().trim().max(2000).default(""),
  requiredInterviewQuestion2: z.string().trim().max(2000).default(""),
  requiredInterviewQuestion3: z.string().trim().max(2000).default(""),
  requiredInterviewQuestion4: z.string().trim().max(2000).default(""),
  requiredInterviewQuestion5: z.string().trim().max(2000).default(""),
  aiSystemPrompt: z.string().trim().max(50000),
  resolvedAiSystemPrompt: z.string().trim().max(50000).optional().default(""),
  initialInterviewBookingLink: optionalUrl,
  hodInterviewBookingLink: optionalUrl,
  postingChannels: z.union([z.string(), z.array(z.string())]).transform((value) => (Array.isArray(value) ? value : value.split(/[\n,]/)).map((item) => item.trim()).filter(Boolean).slice(0, 30)),
  evaluationFieldToggles: z.union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(/[\n,]/)).map((item) => item.trim().toLowerCase()).filter(Boolean))
    .transform((value) => [...new Set(value)].filter((key): key is CatalogKey => catalogKeys.includes(key as CatalogKey)))
    .default([]),
  customEvaluationFields: z.array(customEvaluationField).max(3, "Up to 3 custom fields are allowed.")
    .default([])
    .refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, "Custom field keys must be unique.")
    .refine((fields) => fields.every((field) => !catalogKeys.includes(field.key as CatalogKey)), "Custom field keys must not duplicate a catalog field."),
  licenseOrCertificateRequired: z.string().trim().max(5000).default(""),
  keywordsToLookFor: z.string().trim().max(5000).default(""),
  minimumYearsOfExperience: editableExperience,
  transferableSkillsAccepted: z.string().trim().max(5000).default(""),
  salaryOrBudgetRange: z.string().trim().max(1000).default(""),
  earliestAvailabilityRule: z.string().trim().max(1000).default(""),
  salaryDisclosureStatus: z.string().trim().max(30).default(""),
  experienceRequirementStatus: z.string().trim().max(30).default(""),
  licenseRequirementStatus: z.string().trim().max(30).default(""),
  hodInterviewRequired: z.string().trim().max(30).default(""),
  // Physical venue for the human face-to-face interview: address, floor/room,
  // arrival instructions, on-site contact. Surfaced in the F2F invitation.
  finalInterviewVenue: z.string().trim().max(2000).default(""),
  voiceInterviewAvailabilityMode: z.enum(["none", "manual", "automatic"]).default("none"),
  voiceInterviewSlots: z.preprocess((value) => {
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return []; }
    }
    return value;
  }, z.array(setupVoiceInterviewSlotSchema).max(100, "Up to 100 voice interview slots are allowed.").default([])),
  voiceInterviewAutoStartDate: z.string().trim().max(10).default(""),
  voiceInterviewAutoEndDate: z.string().trim().max(10).default(""),
  voiceInterviewTimezone: z.string().trim().max(100).default("Asia/Singapore"),
  voiceInterviewSlotsGeneratedAt: z.string().trim().max(40).default(""),
  recruitmentSetupStatus: z.string().trim().max(40).default("Draft"),
  setupAction: z.string().trim().max(60).default("save_draft"),
  comments: z.string().trim().max(5000).optional().default(""),
  actionRequestId: z.string().trim().min(1).max(200).optional(),
}).superRefine((setup, context) => {
  if (setup.setupAction === "publish_role" && setup.hodInterviewRequired === "Required" && !setup.finalInterviewVenue.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["finalInterviewVenue"], message: "Enter the face-to-face interview venue and arrival instructions before publishing." });
  }
  if (setup.voiceInterviewAvailabilityMode === "manual" && setup.voiceInterviewSlots.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["voiceInterviewSlots"], message: "Add at least one manual AI Voice Interview slot or choose automatic availability." });
  }
  if (setup.voiceInterviewAvailabilityMode === "automatic" && (!/^\d{4}-\d{2}-\d{2}$/.test(setup.voiceInterviewAutoStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(setup.voiceInterviewAutoEndDate))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["voiceInterviewAutoStartDate"], message: "Choose an automatic AI Voice Interview start and end date." });
  }
  if (setup.voiceInterviewAvailabilityMode === "automatic" && !setup.voiceInterviewTimezone.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["voiceInterviewTimezone"], message: "Choose a timezone for automatic AI Voice Interview availability." });
  }
});

export type RecruitmentSetupInput = z.infer<typeof recruitmentSetupSchema>;
