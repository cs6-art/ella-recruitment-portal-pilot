"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import ActionFeedback from "@/components/ActionFeedback";
import UiIcon from "@/components/UiIcon";
import ValidationSummary from "@/components/ValidationSummary";
import { DEPARTMENT_OPTIONS, isKnownDepartment } from "@/lib/department-options";
import { todayDateInputValue, toDateInputValue } from "@/lib/date-only";
import { roleRequestSchema } from "@/lib/role-schema";
import { renderRecruitmentSystemPrompt, STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE } from "@/lib/recruitment-prompt";
import { BASELINE_EVALUATION_FIELDS, EVALUATION_FIELD_CATALOG, evaluationFieldsForSetup } from "@/lib/recruitment-setup-schema";
import { getSetupReadiness } from "@/lib/recruitment-setup-readiness";
import { buildNumberedInterviewQuestions } from "@/lib/interview-question-count";
import type { RoleAiDraft } from "@/lib/role-ai-draft-schema";
import { clientErrorMessage } from "@/lib/client-error";
import { InterviewTypeOptions, saveRoleInterviewType } from "@/components/InterviewTypeCard";
import { DEFAULT_ROLE_INTERVIEW_TYPE, type RoleInterviewType } from "@/lib/interview-type";

type RoleRequestFormProps = {
  user: {
    name: string;
    email: string;
  };
  roleId?: string;
  status?: string;
  initialValues?: Partial<FormState>;
  /** Approvers (every HR account) get their new request approved on submission. */
  canApproveRole?: boolean;
  /** HR creates, configures, and publishes a role from this single form. */
  unified?: boolean;
  /** HR (and the Postgres portal) can choose the role's Interview type here. */
  canSetInterviewType?: boolean;
  initialInterviewType?: RoleInterviewType;
};

const QUESTION_NUMBERS = [1, 2, 3, 4, 5] as const;

// Setup problems are keyed like form fields so they reuse the same error
// summary; each key is also the id of the input it points at.
const SETUP_FIELD_FOR_KEY: Record<string, string> = {
  Screening_Criteria: "setup_screeningCriteria",
  Required_Interview_Question_1: "setup_question1",
  Required_Interview_Question_2: "setup_question2",
  Required_Interview_Question_3: "setup_question3",
  Salary_Disclosure_Status: "setup_salaryDisclosureStatus",
  Salary_or_Budget_Range: "setup_salaryRange",
  License_Requirement_Status: "setup_licenseRequirementStatus",
  License_or_Certificate_Required: "setup_license",
  HOD_Interview_Required: "setup_hodInterviewRequired",
  Final_Interview_Venue: "setup_venue",
};

type RoleSubmissionResult = {
  success?: boolean;
  roleId?: string;
  status?: string;
  notificationStatus?: string;
  notificationError?: string;
  error?: string;
};

type FormState = {
  requestType: string;
  department: string;
  jobTitle: string;
  employmentType: string;
  numberOfVacancies: number;
  reasonForRequest: string;
  jobDescription: string;
  replacementEmployee: string;
  targetHiringDate: string;
  hodEmail: string;
  customScreeningQuestion1: string;
  customScreeningQuestion2: string;
  aiGeneratedScreeningQuestions: string[];
  recruitmentSetupDraft: RoleAiDraft["recruitmentSetup"];
};

export type RoleRequestFormValues = FormState;

// All HR interviews are owned by the shared HR calendar account.
const HR_INTERVIEW_EMAIL = "hrsg@mclinkgroup.com";

const initial: FormState = {
  requestType: "Staff Addition",
  department: "",
  jobTitle: "",
  employmentType: "Full-Time",
  numberOfVacancies: 1,
  reasonForRequest: "",
  jobDescription: "",
  replacementEmployee: "",
  targetHiringDate: "",
  hodEmail: HR_INTERVIEW_EMAIL,
  customScreeningQuestion1: "",
  customScreeningQuestion2: "",
  aiGeneratedScreeningQuestions: [],
  recruitmentSetupDraft: {
    jobDescription: "",
    screeningCriteria: "",
    requiredInterviewQuestion1: "",
    requiredInterviewQuestion2: "",
    requiredInterviewQuestion3: "",
    requiredInterviewQuestion4: "",
    requiredInterviewQuestion5: "",
    keywordsToLookFor: "",
    minimumYearsOfExperience: "",
    transferableSkillsAccepted: "",
    licenseOrCertificateRequired: "",
    salaryOrBudgetRange: "",
    earliestAvailabilityRule: "",
    evaluationFieldToggles: [],
    customEvaluationFields: [],
    postingChannels: [],
    salaryDisclosureStatus: "Not disclosed",
    experienceRequirementStatus: "",
    licenseRequirementStatus: "Not required",
    hodInterviewRequired: "Not required",
    finalInterviewVenue: "",
    // Prefilled with the standard template so it's visible and editable from
    // the start; left as-is it renders through renderRecruitmentSystemPrompt
    // exactly like before this field existed.
    aiSystemPrompt: STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE,
  },
};

const fieldLabels: Record<string, string> = {
  requestType: "Request Type",
  department: "Department",
  jobTitle: "Job Title",
  numberOfVacancies: "Number of Vacancies",
  reasonForRequest: "Reason for Request",
  jobDescription: "Job Description",
  replacementEmployee: "Employee or Position Being Replaced",
  targetHiringDate: "Target Hiring Date",
  hodEmail: "HR interviewer email",
  customScreeningQuestion1: "Custom Screening Question 1",
  customScreeningQuestion2: "Custom Screening Question 2",
  setup_screeningCriteria: "Screening criteria",
  setup_question1: "Interview question 1",
  setup_question2: "Interview question 2",
  setup_question3: "Interview question 3",
  setup_salaryDisclosureStatus: "Salary visibility",
  setup_salaryRange: "Salary or budget range",
  setup_licenseRequirementStatus: "License or certificate requirement",
  setup_license: "License or certificate",
  setup_hodInterviewRequired: "Face-to-face interview requirement",
  setup_venue: "Face-to-face interview venue",
};

export default function RoleRequestForm({ user, roleId, status = "", initialValues, canApproveRole = false, unified = false, canSetInterviewType = false, initialInterviewType = DEFAULT_ROLE_INTERVIEW_TYPE }: RoleRequestFormProps) {
  const router = useRouter();
  const [interviewType, setInterviewType] = useState<RoleInterviewType>(initialInterviewType);
  // Saved through the role's own audited endpoint once the role exists. A
  // failure never undoes the role save: the role keeps its previous (or the
  // default "Both") type and HR can change it from the role page.
  async function persistInterviewType(savedRoleId: string, isNewRole: boolean) {
    if (!canSetInterviewType || !savedRoleId || (!isNewRole && interviewType === initialInterviewType)) return;
    try { await saveRoleInterviewType(savedRoleId, interviewType); } catch (interviewTypeError) { console.error("[Role Request Form] Interview type save failed:", interviewTypeError); }
  }
  const initialForm = useMemo<FormState>(() => ({
    ...initial,
    ...initialValues,
    targetHiringDate: toDateInputValue(initialValues?.targetHiringDate),
    hodEmail: HR_INTERVIEW_EMAIL,
  }), [initialValues]);
  const [form, setForm] = useState<FormState>(() => initialForm);
  const [draftRoleId, setDraftRoleId] = useState(roleId || "");
  const effectiveRoleId = roleId || draftRoleId;
  const isEditing = Boolean(effectiveRoleId);
  const isAutoDraft = !roleId && Boolean(draftRoleId);
  const isDraftRole = isAutoDraft || status === "Draft";
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draftError, setDraftError] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{ roleId: string; status: string; notificationStatus: string; notificationError: string } | null>(null);
  const [jobDescriptionFile, setJobDescriptionFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const draftSaveInFlight = useRef<Promise<void> | null>(null);
  const draftClientId = useRef(globalThis.crypto.randomUUID());
  const initialFormKey = useMemo(() => JSON.stringify(initialForm), [initialForm]);
  const [savedFormKey, setSavedFormKey] = useState(initialFormKey);
  const hasChanges = JSON.stringify(form) !== savedFormKey || interviewType !== initialInterviewType;

  useEffect(() => {
    setSavedFormKey(initialFormKey);
  }, [initialFormKey]);

  function scrollToErrorSummary() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
  }

  function update(name: keyof FormState, value: string | number) {
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "requestType" && value === "Staff Addition"
        ? { replacementEmployee: "" }
        : {}),
    }));
    setError("");
    setFieldErrors((current) => ({ ...current, [name]: "" }));
  }

  function availabilityPayload() {
    return {
      hodEmail: HR_INTERVIEW_EMAIL,
      // Legacy sheet fields stay empty. HR interview times now come from
      // the connected HR Google Calendar rather than manually entered windows.
      hodAvailabilitySlots: [],
      hodAvailabilityDates: "",
      hodAvailabilityTimes: "",
    };
  }

  // Only new requests and drafts autosave. An approved or submitted request is
  // changed by the explicit "Save role request" button; autosaving it would mark
  // the edit as saved and make that button disappear.
  const autosaves = !isEditing || isDraftRole;

  async function autosaveDraft() {
    if (!autosaves || !hasChanges || loading || parsing || draftSaveInFlight.current) return;
    const snapshot = form;
    const request = (async () => {
      setDraftSaving(true);
      setDraftError("");
      try {
        const endpoint = effectiveRoleId ? `/api/roles/${encodeURIComponent(effectiveRoleId)}` : "/api/roles";
        const response = await fetch(endpoint, {
          method: effectiveRoleId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...snapshot,
            ...availabilityPayload(),
            requesterName: user.name,
            requesterEmail: user.email,
            replacementEmployee: snapshot.requestType === "Staff Replacement" ? snapshot.replacementEmployee : "",
            draft: true,
            draftId: draftClientId.current,
          }),
        });
        const result = await response.json() as RoleSubmissionResult;
        if (!response.ok || result.success !== true || !result.roleId) throw new Error(result.error || "Unable to autosave this draft.");
        if (!effectiveRoleId) {
          setDraftRoleId(result.roleId);
          window.history.replaceState(null, "", `/roles/${encodeURIComponent(result.roleId)}/edit`);
        }
        setSavedFormKey(JSON.stringify(snapshot));
        setDraftSavedAt(new Date().toISOString());
      } catch (caught) {
        setDraftError(clientErrorMessage(caught, "Unable to autosave this draft."));
      } finally {
        setDraftSaving(false);
        draftSaveInFlight.current = null;
      }
    })();
    draftSaveInFlight.current = request;
    await request;
  }

  useEffect(() => {
    if (!autosaves || !hasChanges) return;
    const timer = window.setTimeout(() => void autosaveDraft(), 850);
    return () => window.clearTimeout(timer);
  }, [form, hasChanges, effectiveRoleId, loading, parsing, autosaves]);

  async function populateFromJobDescription() {
    if (!jobDescriptionFile && form.jobDescription.trim().length < 20) {
      setParseError("Enter at least 20 characters in the job description or attach a PDF, DOC, or DOCX file.");
      return;
    }

    setParsing(true);
    setParseError("");
    try {
      const body = new FormData();
      if (jobDescriptionFile) body.append("jobDescriptionFile", jobDescriptionFile);
      else {
        body.append("jobDescriptionText", form.jobDescription.trim());
        body.append("jobTitle", form.jobTitle.trim());
        body.append("department", form.department.trim());
      }
      const response = await fetch("/api/roles/parse-description", {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      // A proxy or an interrupted upstream workflow can return an empty body.
      // Do not let Response.json() mask that as a browser-level exception.
      const raw = await response.text();
      let result: { success?: boolean; error?: string; draft?: RoleAiDraft } = {};
      if (raw.trim()) {
        try {
          result = JSON.parse(raw) as typeof result;
        } catch {
          throw new Error("The AI draft service returned an invalid response. Please try again.");
        }
      }
      if (!raw.trim()) {
        throw new Error(`The AI draft service returned an empty response (HTTP ${response.status}). Please try again.`);
      }
      if (!response.ok || result.success !== true || !result.draft) throw new Error(result.error || "Unable to generate the role draft.");

      const questions = [
        result.draft.recruitmentSetup.requiredInterviewQuestion1,
        result.draft.recruitmentSetup.requiredInterviewQuestion2,
        result.draft.recruitmentSetup.requiredInterviewQuestion3,
        result.draft.recruitmentSetup.requiredInterviewQuestion4,
        result.draft.recruitmentSetup.requiredInterviewQuestion5,
      ].filter(Boolean);

      const draft = result.draft;
      setForm((current) => {
        const jobTitle = draft.role.jobTitle || current.jobTitle;
        const requestType = draft.role.requestType || current.requestType;
        // "Populate" should leave nothing for HR to fill in by hand: anything the
        // parser cannot infer gets a sensible, editable default.
        const defaultHiringDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const defaultHiringDateValue = `${defaultHiringDate.getFullYear()}-${String(defaultHiringDate.getMonth() + 1).padStart(2, "0")}-${String(defaultHiringDate.getDate()).padStart(2, "0")}`;
        return {
          ...current,
          ...draft.role,
          jobTitle,
          department: draft.role.department || current.department,
          jobDescription: draft.role.jobDescription || current.jobDescription,
          reasonForRequest: draft.role.reasonForRequest || current.reasonForRequest
            || (requestType === "Staff Replacement" ? `Replacement for the ${jobTitle} position.` : `New ${jobTitle} position to support the team.`),
          targetHiringDate: draft.role.targetHiringDate || current.targetHiringDate || defaultHiringDateValue,
          aiGeneratedScreeningQuestions: questions,
          recruitmentSetupDraft: {
            ...draft.recruitmentSetup,
            // AI should never choose external job boards for the user.
            postingChannels: current.recruitmentSetupDraft.postingChannels,
            aiSystemPrompt: draft.recruitmentSetup.aiSystemPrompt || current.recruitmentSetupDraft.aiSystemPrompt,
          },
        };
      });
    } catch (error) {
      setParseError(clientErrorMessage(error, "Unable to generate the role draft."));
    } finally {
      setParsing(false);
    }
  }

  // ---- Single-form mode: setup values, defaults and payload -------------
  const setupDraft = form.recruitmentSetupDraft;
  const salaryStatus = setupDraft.salaryDisclosureStatus || "Not disclosed";
  const licenseStatus = setupDraft.licenseRequirementStatus || (setupDraft.licenseOrCertificateRequired?.trim() ? "Required" : "Not required");
  const interviewStatus = setupDraft.hodInterviewRequired || (setupDraft.finalInterviewVenue?.trim() ? "Required" : "Not required");

  function updateSetup(key: keyof FormState["recruitmentSetupDraft"], value: string | string[]) {
    setForm((current) => ({ ...current, recruitmentSetupDraft: { ...current.recruitmentSetupDraft, [key]: value } }));
    setError("");
    setFieldErrors((current) => {
      const next = { ...current };
      for (const field of Object.values(SETUP_FIELD_FOR_KEY)) delete next[field];
      return next;
    });
  }

  function toggleEvaluationField(key: string) {
    const selected = setupDraft.evaluationFieldToggles || [];
    updateSetup("evaluationFieldToggles", selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  }

  function customEvaluationFieldKey(label: string, index: number) {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 31);
    return `custom_${slug || `field_${index + 1}`}`.slice(0, 40);
  }

  function updateCustomEvaluationField(index: number, property: "label" | "description", value: string) {
    setForm((current) => {
      const fields = [...(current.recruitmentSetupDraft.customEvaluationFields || [])];
      const existing = fields[index];
      if (!existing) return current;
      fields[index] = {
        ...existing,
        [property]: value,
        ...(property === "label" ? { key: customEvaluationFieldKey(value, index) } : {}),
      };
      return { ...current, recruitmentSetupDraft: { ...current.recruitmentSetupDraft, customEvaluationFields: fields } };
    });
    setError("");
  }

  function addCustomEvaluationField() {
    setForm((current) => {
      const fields = current.recruitmentSetupDraft.customEvaluationFields || [];
      if (fields.length >= 3) return current;
      let suffix = fields.length + 1;
      while (fields.some((field) => field.key === `custom_field_${suffix}`)) suffix += 1;
      return {
        ...current,
        recruitmentSetupDraft: {
          ...current.recruitmentSetupDraft,
          customEvaluationFields: [...fields, { key: `custom_field_${suffix}`, label: "", description: "" }],
        },
      };
    });
  }

  function removeCustomEvaluationField(index: number) {
    setForm((current) => ({
      ...current,
      recruitmentSetupDraft: {
        ...current.recruitmentSetupDraft,
        customEvaluationFields: (current.recruitmentSetupDraft.customEvaluationFields || []).filter((_, itemIndex) => itemIndex !== index),
      },
    }));
    setError("");
  }

  function setupPayload(setupAction: "publish_role" | "save_draft") {
    const questions = QUESTION_NUMBERS.map((number) => String(setupDraft[`requiredInterviewQuestion${number}` as const] || "").trim());
    const licenseText = String(setupDraft.licenseOrCertificateRequired || "").trim();
    // Keep selected requirements intact; validation must ask for their details
    // instead of silently weakening the role's criteria during submission.
    const effectiveLicenseStatus = licenseStatus;
    const licenseRequired = effectiveLicenseStatus === "Not required" ? "" : licenseText;
    const effectiveInterviewStatus = interviewStatus;
    const values = {
      ...setupDraft,
      jobDescription: form.jobDescription,
      salaryDisclosureStatus: salaryStatus,
      licenseRequirementStatus: effectiveLicenseStatus,
      licenseOrCertificateRequired: licenseRequired,
      hodInterviewRequired: effectiveInterviewStatus,
      finalInterviewVenue: effectiveInterviewStatus === "Required" ? String(setupDraft.finalInterviewVenue || "").trim() : "",
      postingChannels: setupDraft.postingChannels || [],
      requiredInterviewQuestion1: questions[0],
      requiredInterviewQuestion2: questions[1],
      requiredInterviewQuestion3: questions[2],
      requiredInterviewQuestion4: questions[3],
      requiredInterviewQuestion5: questions[4],
    };
    // Use the same required baseline and optional fields in the prompt and
    // the saved role configuration so screening and interviews stay aligned.
    const evaluationFields = evaluationFieldsForSetup(values.evaluationFieldToggles, values.customEvaluationFields);
    // Editable on this form (see the "Smile system prompt" field below); an
    // empty draft (e.g. right after applying an AI-generated draft, which
    // never fills this field) falls back to the standard template.
    const rawAiSystemPrompt = String(values.aiSystemPrompt || "").trim() || STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE;
    const resolvedAiSystemPrompt = renderRecruitmentSystemPrompt(rawAiSystemPrompt, {
      roleTitle: form.jobTitle,
      jobDescription: form.jobDescription,
      screeningCriteria: values.screeningCriteria,
      interviewQuestions: buildNumberedInterviewQuestions(questions).join("\n"),
      licenseOrCertificateRequired: values.licenseOrCertificateRequired,
      keywordsToLookFor: values.keywordsToLookFor,
      transferableSkillsAccepted: values.transferableSkillsAccepted,
      experienceRequired: String(values.minimumYearsOfExperience || ""),
      salaryOrBudgetRange: values.salaryOrBudgetRange,
      noticePeriodRequirement: values.earliestAvailabilityRule,
      earliestAvailabilityRule: values.earliestAvailabilityRule,
      evaluationFields,
    });
    return {
      ...values,
      aiSystemPrompt: rawAiSystemPrompt,
      resolvedAiSystemPrompt,
      initialInterviewBookingLink: "",
      hodInterviewBookingLink: "",
      setupAction,
      actionRequestId: globalThis.crypto.randomUUID(),
    };
  }

  function validateSetup() {
    const payload = setupPayload("publish_role");
    const readiness = getSetupReadiness(payload, "ready-for-publishing");
    const customFields = payload.customEvaluationFields || [];
    const customKeys = customFields.map((field) => field.key);
    if (customFields.some((field) => !field.key.trim() || !field.label.trim() || !field.description.trim())
      || new Set(customKeys).size !== customKeys.length) {
      setError("Complete each custom evaluation field or remove it before publishing.");
      return false;
    }
    const salaryRangeMissing = payload.salaryDisclosureStatus === "Disclosed" && !String(payload.salaryOrBudgetRange || "").trim();
    if (readiness.valid && !salaryRangeMissing) return true;
    const messages: Record<string, string> = {
      setup_screeningCriteria: "Describe what a strong candidate looks like.",
      setup_question1: "Write the first interview question.",
      setup_question2: "Write the second interview question.",
      setup_question3: "Write the third interview question.",
      setup_salaryDisclosureStatus: "Choose whether candidates can see the salary range.",
      setup_salaryRange: "Enter the salary or budget range candidates will see.",
      setup_licenseRequirementStatus: "Choose the license or certificate requirement.",
      setup_license: "Say which license or certificate is needed.",
      setup_hodInterviewRequired: "Choose whether a face-to-face interview is part of the process.",
      setup_venue: "Enter the address and arrival instructions for the interview.",
    };
    const next: Record<string, string> = {};
    for (const missing of readiness.missingFields) {
      const field = SETUP_FIELD_FOR_KEY[missing.key];
      if (field) next[field] = messages[field];
    }
    if (salaryRangeMissing) next.setup_salaryRange = messages.setup_salaryRange;
    if (Object.keys(next).length === 0) return true;
    setFieldErrors((current) => ({ ...current, ...next }));
    setError("Please complete the highlighted role and interview details before continuing.");
    scrollToErrorSummary();
    return false;
  }

  async function saveDraftAndExit() {
    setError("");
    if (draftSaveInFlight.current) await draftSaveInFlight.current;
    await autosaveDraft();
    if (draftSaveInFlight.current) await draftSaveInFlight.current;
    await persistInterviewType(roleId || draftRoleId, !roleId);
    router.push("/roles");
  }

  function fieldErrorProps(field: string) {
    return { "aria-invalid": Boolean(fieldErrors[field]) };
  }

  function formatFieldError(field: string, message: string) {
    const readableMessage = message
      .replace(/^String must/, "Must")
      .replace(/^Invalid input/, "Invalid value");
    const label = fieldLabels[field]
      || field.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase()).trim();
    return { label, message: readableMessage };
  }

  function validateForm() {
    const availability = availabilityPayload();
    const parsed = roleRequestSchema.safeParse({
      ...form,
      ...availability,
      requesterName: user.name,
      requesterEmail: user.email,
      replacementEmployee: form.requestType === "Staff Replacement" ? form.replacementEmployee : "",
    });

    if (parsed.success) {
      setFieldErrors({});
      return true;
    }

    const nextErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] || "form");
      if (!nextErrors[field]) nextErrors[field] = issue.message;
    }
    setFieldErrors(nextErrors);
    setError("Please correct the highlighted fields before submitting.");
    scrollToErrorSummary();
    return false;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roleValid = validateForm();
    const setupValid = !unified || validateSetup();
    if (!roleValid || !setupValid) return;

    setLoading(true);
    setStage("Saving the role…");
    setError("");
    setSuccess(null);

    try {
      let response: Response;
      if (isDraftRole) {
        // Do not submit while the initial autosave is still being persisted.
        // Otherwise the PATCH can race the POST that created this draft.
        if (draftSaveInFlight.current) await draftSaveInFlight.current;

        // Save the final form snapshot first, then use the audited status
        // transition so submitting a draft cannot create a duplicate role.
        response = await fetch(`/api/roles/${encodeURIComponent(effectiveRoleId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...form,
            ...availabilityPayload(),
            requesterName: user.name,
            requesterEmail: user.email,
            replacementEmployee: form.requestType === "Staff Replacement" ? form.replacementEmployee : "",
            draft: true,
          }),
        });
        const savedDraft = await response.json() as RoleSubmissionResult;
        if (!response.ok || savedDraft.success !== true) throw new Error(savedDraft.error || "Unable to save this draft.");
        response = await fetch(`/api/roles/${encodeURIComponent(effectiveRoleId)}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "submit_draft_for_hr", comments: "Draft completed and submitted for HR discussion.", actionRequestId: globalThis.crypto.randomUUID() }),
        });
      } else {
        response = await fetch(isEditing ? `/api/roles/${encodeURIComponent(effectiveRoleId)}` : "/api/roles", {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            ...form,
            ...availabilityPayload(),
            requesterName: user.name,
            requesterEmail: user.email,
            replacementEmployee: form.requestType === "Staff Replacement" ? form.replacementEmployee : "",
          }),
        });
      }
      const result = (await response.json()) as RoleSubmissionResult;

      if (!response.ok || result.success !== true) {
        throw new Error(result.error || "Unable to submit role request.");
      }

      const savedRoleId = result.roleId || effectiveRoleId || "";
      let finalStatus = result.status || "Pending HR Discussion";
      if (savedRoleId) {
        setStage("Saving the interview type…");
        await persistInterviewType(savedRoleId, !isEditing || isAutoDraft);
      }
      // An approver submitting a new request is the reviewer too, so approve it
      // in the same step instead of leaving a formality to click through. If
      // this fails the request simply stays pending for a manual approval.
      if (canApproveRole && (!isEditing || isDraftRole) && savedRoleId) {
        setStage("Approving…");
        try {
          const approval = await fetch(`/api/roles/${encodeURIComponent(savedRoleId)}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ action: "approve_role", comments: "Approved on submission.", actionRequestId: globalThis.crypto.randomUUID() }),
          });
          const approved = await approval.json().catch(() => ({})) as RoleSubmissionResult;
          if (approval.ok && approved.success === true) finalStatus = approved.status || "Approved";
        } catch (approvalError) {
          console.error("[Role Request Form] Automatic approval failed:", approvalError);
        }
      }
      if (unified && savedRoleId) {
        if (finalStatus !== "Approved") {
          throw new Error(`The role ${savedRoleId} was saved but could not be approved automatically, so it has not been published. Open it from Role Requests to finish.`);
        }
        setStage("Making the role available…");
        const published = await fetch(`/api/roles/${encodeURIComponent(savedRoleId)}/recruitment-setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(setupPayload("publish_role")),
        });
        const publishResult = await published.json().catch(() => ({})) as RoleSubmissionResult & { message?: string; missingFieldLabels?: string[] };
        if (!published.ok || publishResult.success !== true) {
          const detail = publishResult.missingFieldLabels?.length ? `Missing: ${publishResult.missingFieldLabels.join(", ")}.` : publishResult.error || publishResult.message || "Please try again from the role page.";
          throw new Error(`The role ${savedRoleId} was created and approved, but publishing failed. ${detail}`);
        }
        finalStatus = publishResult.status || "Job Posted";
      }
      setSuccess({
        roleId: savedRoleId || "Not provided",
        status: finalStatus,
        notificationStatus: result.notificationStatus || "not_configured",
        notificationError: result.notificationError || "",
      });
      if (isEditing) {
        router.push(`/roles/${encodeURIComponent(savedRoleId)}?updated=1`);
        router.refresh();
      } else {
        // The new role is written by n8n outside the Next.js process. The
        // detail component fetches its record with no-store, so client routing
        // keeps the persistent portal shell without reusing stale list data.
        router.push(`/roles/${encodeURIComponent(savedRoleId)}`);
      }
      if (!isEditing) setForm(initial);
    } catch (submissionError) {
      console.error("[Role Request Form] Submission failed:", submissionError);
      setError(submissionError instanceof Error ? submissionError.message : "Submission failed.");
      scrollToErrorSummary();
    } finally {
      setLoading(false);
      setStage("");
    }
  }

  return (
    <form onSubmit={submit} noValidate className="form-layout">
      <div className="form-card">
        {success && (
          <div className="section">
            <ActionFeedback kind="success">
              <strong>Role request submitted.</strong><br />
              Role ID: {success.roleId}<br />
              Status: {success.status}<br />
              Email notification: {success.notificationStatus.replace(/_/g, " ")}{success.notificationError ? ` (${success.notificationError})` : ""}
            </ActionFeedback>
          </div>
        )}

        {error && <div className="section"><ValidationSummary error={error} issues={Object.entries(fieldErrors).map(([field, message]) => { const formatted = formatFieldError(field, message); return { field, label: formatted.label, message: formatted.message, href: `#${field}` }; })} summaryRef={errorSummaryRef} /></div>}
        {(isDraftRole || draftSaving || draftSavedAt || draftError) && <div className="draft-autosave-status" role="status"><strong>Draft</strong>{draftSaving ? " · Saving automatically..." : draftError ? ` · ${draftError}` : draftSavedAt ? ` · Saved ${new Date(draftSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " · Changes will be saved automatically"}</div>}

        <section className="section">
          <div className="section-title">
            <span className="section-number">1</span>
          <h2>{isEditing ? "Edit role request" : "Role request"}</h2>
          </div>
          <p className="section-intro">Provide the information HR and Smile need to understand the vacancy.</p>

          <div className="form-stack">
            <div className="field full">
              <div className="ai-draft-panel">
                <div>
                  <strong>Populate from a job description</strong>
                  <small className="field-help">Upload a PDF, DOC, or DOCX, or use the job description below. Smile will prepare role details, screening criteria, and interview questions for HR to review.</small>
                </div>
                <div className="ai-draft-controls">
                  {/* Keep the picker aligned with the server document extractor. */}
                  <input id="jobDescriptionFile" type="file" accept="application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={(event) => { setJobDescriptionFile(event.target.files?.[0] || null); setParseError(""); }} />
                  <button type="button" className="btn btn-secondary" onClick={populateFromJobDescription} disabled={parsing || (!jobDescriptionFile && form.jobDescription.trim().length < 20)}>
                    {parsing ? "Generating AI guidance…" : jobDescriptionFile ? "Generate draft" : "Generate AI questions"}
                  </button>
                </div>
                {jobDescriptionFile && <small className="field-help">Selected: {jobDescriptionFile.name}</small>}
                {parseError && <div className="error-box message-box" role="alert"><span className="message-box-icon" aria-hidden="true"><UiIcon name="alert" size={17} /></span><span>{parseError}</span></div>}
              </div>
              <label htmlFor="jobDescription">Job Description <strong className="required-mark">*</strong></label>
              <textarea id="jobDescription" {...fieldErrorProps("jobDescription")} required value={form.jobDescription} onChange={(event) => update("jobDescription", event.target.value)} placeholder="Describe the purpose and main scope of this role." />
            </div>

            <div className="field">
              <label htmlFor="requestType">Request Type <strong className="required-mark">*</strong></label>
              <select id="requestType" {...fieldErrorProps("requestType")} value={form.requestType} onChange={(event) => update("requestType", event.target.value)}>
                <option>Staff Addition</option>
                <option>Staff Replacement</option>
              </select>
            </div>

            {form.requestType === "Staff Replacement" && (
              <div className="field full">
                <label htmlFor="replacementEmployee">Employee or Position Being Replaced <strong className="required-mark">*</strong></label>
                <input id="replacementEmployee" {...fieldErrorProps("replacementEmployee")} required value={form.replacementEmployee} onChange={(event) => update("replacementEmployee", event.target.value)} placeholder="Name or position" />
              </div>
            )}

            <div className="field">
              <label htmlFor="jobTitle">Job Title <strong className="required-mark">*</strong></label>
              <input id="jobTitle" {...fieldErrorProps("jobTitle")} required value={form.jobTitle} onChange={(event) => update("jobTitle", event.target.value)} placeholder="e.g. Inside Sales Specialist" />
            </div>

            <div className="field">
              <label htmlFor="department">Department <strong className="required-mark">*</strong></label>
              <select id="department" {...fieldErrorProps("department")} required value={form.department} onChange={(event) => update("department", event.target.value)}>
                {form.department && !isKnownDepartment(form.department) && <option value={form.department}>{form.department} (existing)</option>}
                <option value="">Select a department</option>
                {DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </div>

            <div className="field">
              <label htmlFor="employmentType">Employment Type <strong className="required-mark">*</strong></label>
              <select id="employmentType" {...fieldErrorProps("employmentType")} value={form.employmentType} onChange={(event) => update("employmentType", event.target.value)}>
                <option>Full-Time</option>
                <option>Part-Time</option>
                <option>Contract</option>
                <option>Temporary</option>
                <option>Internship</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="numberOfVacancies">Number of Vacancies <strong className="required-mark">*</strong></label>
              <input id="numberOfVacancies" {...fieldErrorProps("numberOfVacancies")} required min="1" max="100" type="number" value={form.numberOfVacancies} onChange={(event) => update("numberOfVacancies", Number(event.target.value))} />
            </div>

            <div className="field">
              <label htmlFor="targetHiringDate">Target Hiring Date <strong className="required-mark">*</strong></label>
              <input id="targetHiringDate" {...fieldErrorProps("targetHiringDate")} required min={todayDateInputValue()} type="date" value={form.targetHiringDate} onChange={(event) => update("targetHiringDate", event.currentTarget.value)} onInput={(event) => update("targetHiringDate", event.currentTarget.value)} />
              <small className="field-help">Select today or a future date. Earlier dates cannot be submitted.</small>
            </div>

            <div className="field full">
              <label htmlFor="reasonForRequest">Reason for Request <strong className="required-mark">*</strong></label>
              <textarea id="reasonForRequest" {...fieldErrorProps("reasonForRequest")} required value={form.reasonForRequest} onChange={(event) => update("reasonForRequest", event.target.value)} placeholder="Why is this additional or replacement staff member needed?" />
            </div>

            {canSetInterviewType && (
              <fieldset className="field full interview-type-field">
                <legend>Interview Type <strong className="required-mark">*</strong></legend>
                <small className="field-help">Which AI interview applicants for this role can be sent. You can change it later from the role page.</small>
                <InterviewTypeOptions name="interviewType" value={interviewType} disabled={loading} onChange={setInterviewType} />
              </fieldset>
            )}
          </div>
        </section>

        {unified ? (
          <>
            <section className="section">
              <div className="section-title">
                <span className="section-number">2</span>
                <h2>Screening and Interview</h2>
              </div>
      <p className="section-intro">Set up candidate screening, evaluation, salary visibility, and interview requirements here. Smile pre-fills screening guidance from the job description, so review and adjust it before creating the role.</p>
              <div className="form-stack">
                <div className="field">
                  <label htmlFor="setup_screeningCriteria">Screening criteria <strong className="required-mark">*</strong></label>
                  <textarea id="setup_screeningCriteria" {...fieldErrorProps("setup_screeningCriteria")} value={setupDraft.screeningCriteria} onChange={(event) => updateSetup("screeningCriteria", event.target.value)} placeholder="What does a strong candidate look like? Must-have experience, skills and qualifications." />
                </div>
                <div className="vapi-builder">
                  <div className="vapi-section-heading">
                    <div><span className="vapi-kicker">CANDIDATE AND INTERVIEW DETAILS</span><h3>Set expectations up front</h3><p>These choices are saved with the role and used in candidate-facing details and interview planning.</p></div>
                  </div>
                  <div className="vapi-policy-grid">
                    <label htmlFor="setup_salaryDisclosureStatus">
                      <span>Salary visibility <strong className="required-mark">*</strong></span>
                      <select id="setup_salaryDisclosureStatus" {...fieldErrorProps("setup_salaryDisclosureStatus")} required value={salaryStatus} onChange={(event) => updateSetup("salaryDisclosureStatus", event.target.value)}>
                        <option value="">Choose one</option>
                        <option>Disclosed</option>
                        <option>Not disclosed</option>
                      </select>
                    </label>
                    <label htmlFor="setup_licenseRequirementStatus">
                      <span>License or certificate <strong className="required-mark">*</strong></span>
                      <select id="setup_licenseRequirementStatus" {...fieldErrorProps("setup_licenseRequirementStatus")} required value={licenseStatus} onChange={(event) => updateSetup("licenseRequirementStatus", event.target.value)}>
                        <option value="">Choose one</option>
                        <option>Required</option>
                        <option>Preferred</option>
                        <option>Not required</option>
                      </select>
                    </label>
                    <label htmlFor="setup_hodInterviewRequired">
                      <span>Face-to-face interview <strong className="required-mark">*</strong></span>
                      <select id="setup_hodInterviewRequired" {...fieldErrorProps("setup_hodInterviewRequired")} required value={interviewStatus} onChange={(event) => updateSetup("hodInterviewRequired", event.target.value)}>
                        <option value="">Choose one</option>
                        <option>Required</option>
                        <option>Not required</option>
                      </select>
                    </label>
                  </div>
                  <div className="field full">
                    <label htmlFor="setup_salaryRange">Salary or budget range {salaryStatus === "Disclosed" ? <strong className="required-mark">*</strong> : <span className="field-optional">(optional)</span>}</label>
                    <input id="setup_salaryRange" {...fieldErrorProps("setup_salaryRange")} required={salaryStatus === "Disclosed"} value={setupDraft.salaryOrBudgetRange || ""} onChange={(event) => updateSetup("salaryOrBudgetRange", event.target.value)} placeholder="e.g. PHP 45,000–60,000 per month" />
                    <small className="field-help">{salaryStatus === "Disclosed" ? "Candidates will see this range." : "This can guide Smile's assessment; candidates will not see it while salary visibility is Not disclosed."}</small>
                  </div>
                  {(licenseStatus === "Required" || licenseStatus === "Preferred") && (
                    <div className="field full">
                      <label htmlFor="setup_license">License or certificate {licenseStatus === "Required" ? <strong className="required-mark">*</strong> : <span className="field-optional">(optional details)</span>}</label>
                      <input id="setup_license" {...fieldErrorProps("setup_license")} required={licenseStatus === "Required"} value={setupDraft.licenseOrCertificateRequired || ""} onChange={(event) => updateSetup("licenseOrCertificateRequired", event.target.value)} placeholder="e.g. CPA license" />
                    </div>
                  )}
                  {interviewStatus === "Required" && (
                    <div className="field full">
                      <label htmlFor="setup_venue">Face-to-face interview venue <strong className="required-mark">*</strong></label>
                      <textarea id="setup_venue" {...fieldErrorProps("setup_venue")} required value={setupDraft.finalInterviewVenue || ""} onChange={(event) => updateSetup("finalInterviewVenue", event.target.value)} placeholder="Full address, floor or room, and arrival instructions" />
                      <small className="field-help">Include the address and who the candidate should ask for on arrival.</small>
                    </div>
                  )}
                  <div className="form-stack">
                    <div className="field full">
                      <label htmlFor="setup_minimumYearsOfExperience">Minimum relevant experience <span className="field-optional">(optional)</span></label>
                      <input id="setup_minimumYearsOfExperience" value={setupDraft.minimumYearsOfExperience || ""} onChange={(event) => updateSetup("minimumYearsOfExperience", event.target.value)} placeholder="e.g. None, 3 years, or 5+ years" />
                      <small className="field-help">Use “None” if there is no experience threshold.</small>
                    </div>
                    <div className="field full">
                      <label htmlFor="setup_keywordsToLookFor">Keywords to look for <span className="field-optional">(optional)</span></label>
                      <input id="setup_keywordsToLookFor" value={setupDraft.keywordsToLookFor || ""} onChange={(event) => updateSetup("keywordsToLookFor", event.target.value)} placeholder="Skills, tools, or experience to look for" />
                    </div>
                    <div className="field full">
                      <label htmlFor="setup_transferableSkillsAccepted">Related experience that may count <span className="field-optional">(optional)</span></label>
                      <textarea id="setup_transferableSkillsAccepted" value={setupDraft.transferableSkillsAccepted || ""} onChange={(event) => updateSetup("transferableSkillsAccepted", event.target.value)} placeholder="Describe adjacent skills or experience Smile should consider." />
                    </div>
                    <div className="field full">
                      <label htmlFor="setup_earliestAvailabilityRule">Start-date guidance <span className="field-optional">(optional)</span></label>
                      <textarea id="setup_earliestAvailabilityRule" value={setupDraft.earliestAvailabilityRule || ""} onChange={(event) => updateSetup("earliestAvailabilityRule", event.target.value)} placeholder="e.g. Ask whether the candidate can start within 30 days." />
                    </div>
                  </div>
                </div>
                <div className="vapi-builder">
                  <div className="vapi-section-heading">
                    <div><span className="vapi-kicker">EVALUATION FIELDS</span><h3>What should Smile score or note?</h3><p>These fields guide both resume screening and the interview. The four standard fields are always included.</p></div>
                  </div>
                  <div className="vapi-baseline-fields">
                    <span className="vapi-kicker">Always included</span>
                    <div className="vapi-baseline-chip-row">
                      {BASELINE_EVALUATION_FIELDS.map((field) => <span className="vapi-chip" key={field.key}>{field.label}</span>)}
                    </div>
                  </div>
                  <fieldset className="vapi-channel-fieldset">
                    <legend>Optional scoring areas</legend>
                    <div className="vapi-channel-options">
                      {EVALUATION_FIELD_CATALOG.map((field) => (
                        <label key={field.key} className="vapi-channel-option" title={field.description}>
                          <input type="checkbox" checked={(setupDraft.evaluationFieldToggles || []).includes(field.key)} onChange={() => toggleEvaluationField(field.key)} />
                          <span>{field.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="vapi-custom-fields">
                    <div className="vapi-section-heading">
                      <div><span className="vapi-kicker">CUSTOM FIELDS</span><h4>Add Criteria Specific to This Role</h4></div>
                      <span className="vapi-count-badge">{(setupDraft.customEvaluationFields || []).length} of 3</span>
                    </div>
                    {(setupDraft.customEvaluationFields || []).map((field, index) => (
                      <div className="vapi-custom-field-row" key={`${field.key}-${index}`}>
                        <div className="field">
                          <label htmlFor={`setup-eval-label-${index}`}>Field name</label>
                          <input id={`setup-eval-label-${index}`} required maxLength={60} value={field.label} onChange={(event) => updateCustomEvaluationField(index, "label", event.target.value)} placeholder="e.g. Product knowledge" />
                        </div>
                        <div className="field">
                          <label htmlFor={`setup-eval-description-${index}`}>What should Smile assess?</label>
                          <input id={`setup-eval-description-${index}`} required maxLength={200} value={field.description} onChange={(event) => updateCustomEvaluationField(index, "description", event.target.value)} placeholder="Explain the evidence Smile should look for." />
                        </div>
                        <button type="button" className="btn btn-secondary" onClick={() => removeCustomEvaluationField(index)}>Remove</button>
                      </div>
                    ))}
                    {(setupDraft.customEvaluationFields || []).length < 3 && (
                      <button type="button" className="btn btn-secondary" onClick={addCustomEvaluationField}>Add a custom field</button>
                    )}
                  </div>
                </div>
                {QUESTION_NUMBERS.map((number) => {
                  const key = `requiredInterviewQuestion${number}` as const;
                  const required = number <= 3;
                  return (
                    <div className="field" key={number}>
                      <label htmlFor={`setup_question${number}`}>Interview question {number} {required ? <strong className="required-mark">*</strong> : <span className="field-optional">(optional)</span>}</label>
                      <textarea id={`setup_question${number}`} {...fieldErrorProps(`setup_question${number}`)} value={setupDraft[key] || ""} onChange={(event) => updateSetup(key, event.target.value)} placeholder={required ? "A question Smile should ask every candidate" : "Add another question if you need one"} />
                    </div>
                  );
                })}
                <div className="field">
                  <label htmlFor="setup_aiSystemPrompt">Smile system prompt <span className="field-optional">(advanced, optional)</span></label>
                  <small className="field-help">The full script Smile follows on the call, built from your answers above. Edit it directly only if you need something the fields above can't express — keep the marker that says system_prompt exactly where it is; that's where your answers get inserted automatically. You can update it later from the role details.</small>
                  <textarea id="setup_aiSystemPrompt" className="vapi-full-prompt" value={setupDraft.aiSystemPrompt || STANDARD_VAPI_SYSTEM_PROMPT_TEMPLATE} onChange={(event) => updateSetup("aiSystemPrompt", event.target.value)} />
                </div>
              </div>
            </section>
          </>
        ) : (
        <section className="section">
          <div className="section-title">
            <span className="section-number">2</span>
            <h2>Face-to-Face Interview and Screening</h2>
          </div>
          <p className="section-intro">Review the shared HR calendar and add up to two optional questions. HR can update these details from the role page later.</p>

          <div className="form-stack">
            <div className="field full">
              <label htmlFor="hodEmail">Shared HR Calendar Account</label>
              <input id="hodEmail" type="text" value="Configured in Settings" readOnly aria-readonly="true" />
              <small className="field-help">HR interview availability is read from the shared account configured in Settings and its connected HR Google Calendar. This role does not choose a personal calendar.</small>
            </div>
            <div className="field full">
              <label htmlFor="customScreeningQuestion1">HR Screening Question 1 <span className="field-optional">(optional)</span></label>
              <textarea id="customScreeningQuestion1" value={form.customScreeningQuestion1} onChange={(event) => update("customScreeningQuestion1", event.target.value)} placeholder="Ask something specific to this role" />
            </div>
            <div className="field full">
              <label htmlFor="customScreeningQuestion2">HR Screening Question 2 <span className="field-optional">(optional)</span></label>
              <textarea id="customScreeningQuestion2" value={form.customScreeningQuestion2} onChange={(event) => update("customScreeningQuestion2", event.target.value)} placeholder="Ask another role-specific question" />
            </div>
            {form.aiGeneratedScreeningQuestions.length > 0 && (
              <div className="field full">
                <div className="ai-question-review">
                  <strong>AI-generated screening questions for HR review</strong>
                    <small className="field-help">These were generated from the role description. HR can review and refine them from the role page before the role is published.</small>
                  <ol>
                    {form.aiGeneratedScreeningQuestions.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}
                  </ol>
                </div>
              </div>
            )}
          </div>
        </section>
        )}

        {(
          <>
          <div className="form-actions">
            <a className="btn btn-secondary" href="/roles">Cancel</a>
            {unified && <button type="button" className="btn btn-secondary" disabled={loading || parsing} onClick={() => void saveDraftAndExit()}>Save as draft</button>}
            <button type="submit" className="btn btn-primary" disabled={loading || (isEditing && !isDraftRole && !hasChanges)}>
              {loading ? (stage || "Submitting…") : unified ? "Create role" : isEditing && !isDraftRole ? "Save role request" : canApproveRole ? "Submit & approve" : "Submit for HR approval"}
            </button>
          </div>
          {unified && <p className="form-actions-hint">Create role saves these settings, approves the role, and makes its Smile application link available to candidates. Save as draft keeps it private so you can finish later.</p>}
          </>
        )}
      </div>

      <aside className="sidebar-card">
        <h3>What Happens Next</h3>
        <div className="sidebar-list">
          {unified
            ? <><div><strong>1. Create role</strong><br />The role is approved and its Smile application link is made available to candidates.</div>
              <div><strong>2. Candidates apply</strong><br />Each candidate gets a link, is screened by Smile and can book an interview.</div>
              <div><strong>3. You decide</strong><br />Review results in Applicants. Update role and interview settings from the role page when needed.</div></>
            : <><div><strong>1. Submit</strong><br />{canApproveRole ? "As HR, your request is approved as soon as you submit it." : "HR reviews your request and approves or rejects it."}</div>
              <div><strong>2. Role details</strong><br />HR reviews the role's saved screening and interview guidance.</div>
              <div><strong>3. Candidates apply</strong><br />Once approved, the role's Smile application link is made available.</div></>}
        </div>
      </aside>
    </form>
  );
}
