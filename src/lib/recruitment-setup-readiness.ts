export type SetupReadinessLevel = "draft" | "recruitment-ready" | "ready-for-publishing";

export type SetupReadinessInput = {
  jobDescription?: string;
  screeningCriteria?: string;
  aiSystemPrompt?: string;
  requiredInterviewQuestion1?: string;
  requiredInterviewQuestion2?: string;
  requiredInterviewQuestion3?: string;
  requiredInterviewQuestion4?: string;
  requiredInterviewQuestion5?: string;
  postingChannels?: string[] | string;
  initialInterviewBookingLink?: string;
  hodInterviewBookingLink?: string;
  salaryOrBudgetRange?: string;
  minimumYearsOfExperience?: string | number;
  salaryDisclosureStatus?: string;
  experienceRequirementStatus?: string;
  licenseRequirementStatus?: string;
  licenseOrCertificateRequired?: string;
  hodInterviewRequired?: string;
  finalInterviewVenue?: string;
};

export type MissingReadinessField = { key: string; label: string };
export type ReadinessResult = { valid: boolean; missingFields: MissingReadinessField[] };

const text = (value: unknown) => String(value ?? "").trim();
const channels = (value: string[] | string | undefined) => Array.isArray(value) ? value.filter(Boolean) : text(value).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
const present = (value: unknown) => text(value) !== "";

export function getSetupReadiness(input: SetupReadinessInput, level: SetupReadinessLevel): ReadinessResult {
  const missingFields: MissingReadinessField[] = [];
  const requireField = (key: string, label: string, value: unknown) => { if (!present(value)) missingFields.push({ key, label }); };

  requireField("Job_Description", "Job Description", input.jobDescription);
  requireField("Screening_Criteria", "Screening Criteria", input.screeningCriteria);

  if (level === "draft") return { valid: missingFields.length === 0, missingFields };

  requireField("AI_System_Prompt", "VAPI System Prompt", input.aiSystemPrompt);
  requireField("Required_Interview_Question_1", "Required Interview Question 1", input.requiredInterviewQuestion1);
  requireField("Required_Interview_Question_2", "Required Interview Question 2", input.requiredInterviewQuestion2);
  requireField("Required_Interview_Question_3", "Required Interview Question 3", input.requiredInterviewQuestion3);
  if (channels(input.postingChannels).length === 0) missingFields.push({ key: "Posting_Channels", label: "At least one Posting Channel" });

  if (level === "recruitment-ready") return { valid: missingFields.length === 0, missingFields };

  if (!['Disclosed', 'Not disclosed'].includes(text(input.salaryDisclosureStatus))) missingFields.push({ key: "Salary_Disclosure_Status", label: "Salary visibility (Disclosed or Not disclosed)" });
  if (!["Required", "Not required"].includes(text(input.hodInterviewRequired))) missingFields.push({ key: "HOD_Interview_Required", label: "HR interview requirement" });
  else if (text(input.hodInterviewRequired) === "Required") requireField("Final_Interview_Venue", "Face-to-Face Interview Venue", input.finalInterviewVenue);
  if (!["Required", "Preferred", "Not required"].includes(text(input.licenseRequirementStatus))) missingFields.push({ key: "License_Requirement_Status", label: "License or certificate requirement" });
  else if (text(input.licenseRequirementStatus) === "Required") requireField("License_or_Certificate_Required", "License or Certificate Required", input.licenseOrCertificateRequired);
  return { valid: missingFields.length === 0, missingFields };
}

export function setupStatusForAction(action: string, current: string): string {
  if (action === "mark_recruitment_ready") return "Recruitment Ready";
  if (action === "mark_ready_for_publishing") return "Ready for Publishing";
  if (action === "publish_role") return "Published";
  return current || "Draft";
}
