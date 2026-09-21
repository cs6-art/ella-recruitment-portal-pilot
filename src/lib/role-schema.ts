import { z } from "zod";

import { roleAiRecruitmentSetupDraftSchema } from "@/lib/role-ai-draft-schema";
import { isDateOnOrAfterToday } from "@/lib/date-only";

const hodAvailabilitySlotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid availability date."),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid start time."),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid end time."),
  timezone: z.string().trim().min(1).max(100),
}).superRefine((slot, context) => {
  if (slot.startTime >= slot.endTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["endTime"], message: "End time must be after start time." });
  }
});

const optionalMoney = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    return typeof value === "number" ? value : Number(value);
  },
  z.number().finite().min(1, "Salary must be at least 1.").optional(),
);

export const roleRequestSchema = z.object({
  requestType: z.enum(["Staff Addition", "Staff Replacement"]),
  department: z.string().trim().min(2, "Enter the department name, for example Inside Sales.").max(100),
  jobTitle: z.string().trim().min(2, "Enter the job title, for example Inside Sales Specialist.").max(150),
  numberOfVacancies: z.coerce.number().int().min(1).max(100),
  reasonForRequest: z.string().trim().min(10, "Explain why this role is needed.").max(2000),
  jobDescription: z.string().trim().min(20, "Describe the role in at least 20 characters.").max(20000),
  replacementEmployee: z.string().trim().max(150).default(""),
  targetHiringDate: z.string().trim()
    .min(1, "Select a target hiring date.")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Select a valid target hiring date.")
    .refine((value) => isDateOnOrAfterToday(value), "Target hiring date must be today or later."),
  hodAvailabilityDates: z.string().trim().max(5000).default(""),
  hodAvailabilityTimes: z.string().trim().max(5000).default(""),
  hodAvailabilitySlots: z.array(hodAvailabilitySlotSchema).max(30).default([]),
  customScreeningQuestion1: z.string().trim().max(1000).default(""),
  customScreeningQuestion2: z.string().trim().max(1000).default(""),
  aiGeneratedScreeningQuestions: z.array(z.string().trim().min(1).max(1000)).max(5).default([]),
  recruitmentSetupDraft: roleAiRecruitmentSetupDraftSchema.optional().default({}),
  // These legacy requisition columns remain available for existing sheet rows
  // and downstream workflows, but are no longer required during role creation.
  reportingManager: z.string().trim().max(150).default(""),
  workLocation: z.string().trim().max(150).default(""),
  employmentType: z.enum(["Full-Time", "Part-Time", "Contract", "Temporary", "Internship"]).default("Full-Time"),
  jobResponsibilities: z.string().trim().max(5000).default(""),
  requiredSkills: z.string().trim().max(3000).default(""),
  experienceRequired: z.string().trim().max(500).default(""),
  educationRequirements: z.string().trim().max(1000).default(""),
  preferredQualifications: z.string().trim().max(2000).default(""),
  roleExpectations: z.string().trim().max(3000).default(""),
  salaryMin: optionalMoney,
  salaryMax: optionalMoney,
  workSchedule: z.string().trim().max(500).default(""),
  noticePeriodRequirement: z.string().trim().max(1000).default(""),
  salaryExpectationGuidance: z.string().trim().max(1000).default(""),
  requesterName: z.string().trim().min(2).max(150),
  requesterEmail: z.string().trim().toLowerCase().email(),
  hodEmail: z.string().trim().toLowerCase().email().default(""),
}).superRefine((value, context) => {
  if (value.requestType === "Staff Replacement" && !value.replacementEmployee) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["replacementEmployee"],
      message: "Replacement employee is required for staff replacement requests.",
    });
  }

  if (value.salaryMin !== undefined && value.salaryMin !== null && value.salaryMax !== undefined && value.salaryMax !== null && value.salaryMin > value.salaryMax) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salaryMax"],
      message: "Salary minimum cannot be greater than salary maximum.",
    });
  }
});

export type RoleRequestInput = z.infer<typeof roleRequestSchema>;
